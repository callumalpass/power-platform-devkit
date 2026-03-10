import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { generateContextPack, generatePortfolioReport, type AnalysisContextPack } from '@pp/analysis';
import { listEnvironments, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import {
  ConnectionReferenceService,
  EnvironmentVariableService,
  resolveDataverseClient,
  type ConnectionReferenceSummary,
  type EnvironmentVariableSummary,
} from '@pp/dataverse';
import { executeDeploy, executeDeployPlan, type DeployExecutionMode, type DeployPlan } from '@pp/deploy';
import { createDiagnostic, fail, type Diagnostic, type OperationResult, type ProvenanceRecord, type SupportTier, ok } from '@pp/diagnostics';
import { ModelService, type ModelAppSummary, type ModelInspectResult } from '@pp/model';
import { discoverProject, type ProjectContext } from '@pp/project';
import { SolutionService, type SolutionAnalysis, type SolutionSummary } from '@pp/solution';
import { z } from 'zod';

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
}

export interface PpMcpServerOptions {
  configDir?: string;
  projectPath?: string;
  allowInteractiveAuth?: boolean;
}

export interface SupportedDomainSummary {
  name: string;
  kind: 'local-context' | 'platform' | 'provider' | 'interface';
  supportTier: SupportTier;
  readTools: string[];
  mutationToolsAvailable: boolean;
  mutationTools?: string[];
  notes?: string;
}

interface RemoteToolArgs {
  environment: string;
  configDir?: string;
  allowInteractiveAuth?: boolean;
}

interface ResolvedRemoteRuntime {
  client: Awaited<ReturnType<typeof resolveDataverseClient>> extends OperationResult<infer T>
    ? T extends { client: infer C }
      ? C
      : never
    : never;
}

interface DeploySessionRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
  workspaceRoot: string;
  selectedStage?: string;
  plan: DeployPlan;
}

interface ToolMutationPolicyReadOnly {
  mode: 'read-only';
  mutationsExposed: false;
  optInStrategy: string;
}

interface ToolMutationPolicyControlled {
  mode: 'controlled';
  mutationsExposed: true;
  approvalRequired: boolean;
  approvalStrategy: string;
  supportedExecutionModes: DeployExecutionMode[];
  sessionRequired: boolean;
}

type ToolMutationPolicy = ToolMutationPolicyReadOnly | ToolMutationPolicyControlled;

const DEPLOY_SESSION_TTL_MS = 30 * 60 * 1000;

const diagnosticSchema = z.object({
  level: z.enum(['error', 'warning', 'info']),
  code: z.string(),
  message: z.string(),
  source: z.string().optional(),
  path: z.string().optional(),
  hint: z.string().optional(),
  detail: z.string().optional(),
});

const provenanceSchema = z.object({
  kind: z.enum(['official-api', 'official-artifact', 'harvested', 'inferred']),
  source: z.string(),
  detail: z.string().optional(),
});

const mutationPolicySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('read-only'),
    mutationsExposed: z.literal(false),
    optInStrategy: z.string(),
  }),
  z.object({
    mode: z.literal('controlled'),
    mutationsExposed: z.literal(true),
    approvalRequired: z.boolean(),
    approvalStrategy: z.string(),
    supportedExecutionModes: z.array(z.enum(['apply', 'dry-run', 'plan'])),
    sessionRequired: z.boolean(),
  }),
]);

const outputEnvelopeSchema = z
  .object({
    tool: z.object({
      name: z.string(),
      mutationPolicy: mutationPolicySchema,
    }),
    success: z.boolean(),
    data: z.unknown().optional(),
    diagnostics: z.array(diagnosticSchema),
    warnings: z.array(diagnosticSchema),
    suggestedNextActions: z.array(z.string()),
    supportTier: z.enum(['stable', 'preview', 'experimental']),
    provenance: z.array(provenanceSchema).optional(),
    knownLimitations: z.array(z.string()).optional(),
  })
  .passthrough();

const remoteBaseSchema = z.object({
  environment: z.string().min(1),
  configDir: z.string().min(1).optional(),
  allowInteractiveAuth: z.boolean().optional(),
});

const solutionScopeSchema = remoteBaseSchema.extend({
  solutionUniqueName: z.string().min(1).optional(),
});

const projectScopeSchema = z.object({
  projectPath: z.string().min(1).optional(),
  stage: z.string().min(1).optional(),
});

const portfolioScopeSchema = z.object({
  projectPaths: z.array(z.string().min(1)).optional(),
  stage: z.string().min(1).optional(),
  allowedProviderKinds: z.array(z.string().min(1)).optional(),
  focusAsset: z.string().min(1).optional(),
});

const deployScopeSchema = z.object({
  projectPath: z.string().min(1).optional(),
  stage: z.string().min(1).optional(),
});

const deployApplySchema = z.object({
  sessionId: z.string().uuid(),
  mode: z.enum(['apply', 'dry-run']).optional(),
  parameterOverrides: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  approval: z
    .object({
      confirmed: z.boolean(),
      sessionId: z.string().uuid(),
      reason: z.string().min(1).optional(),
    })
    .optional(),
});

export const initialMcpTools: McpToolDefinition[] = [
  {
    name: 'pp.environment.list',
    title: 'List Environments',
    description: 'List configured Dataverse environment aliases from the local pp config registry.',
  },
  {
    name: 'pp.solution.list',
    title: 'List Solutions',
    description: 'List solutions visible in a configured Dataverse environment.',
  },
  {
    name: 'pp.solution.inspect',
    title: 'Inspect Solution',
    description: 'Inspect one solution with dependencies, invalid connection references, and missing environment variables.',
  },
  {
    name: 'pp.dataverse.query',
    title: 'Query Dataverse',
    description: 'Run a read-only Dataverse table query with structured rows and diagnostics.',
  },
  {
    name: 'pp.connection-reference.inspect',
    title: 'Inspect Connection References',
    description: 'List or inspect Dataverse connection references, preserving support tier and diagnostics.',
  },
  {
    name: 'pp.environment-variable.inspect',
    title: 'Inspect Environment Variables',
    description: 'List or inspect Dataverse environment variables and their effective values.',
  },
  {
    name: 'pp.model-app.inspect',
    title: 'Inspect Model-Driven Apps',
    description: 'List model-driven apps or inspect one app with forms, views, tables, and dependencies.',
  },
  {
    name: 'pp.project.inspect',
    title: 'Inspect Project',
    description: 'Inspect the local pp project context resolved from the working tree.',
  },
  {
    name: 'pp.analysis.context',
    title: 'Generate Analysis Context',
    description: 'Generate a structured project and deploy context pack for agent workflows.',
  },
  {
    name: 'pp.analysis.portfolio',
    title: 'Analyze Portfolio',
    description: 'Aggregate multiple projects into a structured portfolio governance and drift report.',
  },
  {
    name: 'pp.analysis.drift',
    title: 'Inspect Portfolio Drift',
    description: 'Inspect cross-project drift across stages, provider bindings, parameters, and assets.',
  },
  {
    name: 'pp.analysis.usage',
    title: 'Inspect Portfolio Usage',
    description: 'Inspect ownership, asset usage, provider usage, and parameter inventories across projects.',
  },
  {
    name: 'pp.analysis.policy',
    title: 'Inspect Portfolio Policy',
    description: 'Inspect governance findings such as missing ownership, missing provenance, and unsupported connectors.',
  },
  {
    name: 'pp.deploy.plan',
    title: 'Plan Deploy Apply',
    description: 'Resolve a bounded deploy plan, preflight it, and store an MCP plan session for later apply.',
  },
  {
    name: 'pp.deploy.apply',
    title: 'Apply Planned Deploy',
    description: 'Execute a previously planned deploy session in dry-run or apply mode with explicit approval for live writes.',
  },
  {
    name: 'pp.domain.list',
    title: 'List Supported Domains',
    description: 'Describe the current MCP read surface and the mutation boundary for each exposed domain.',
  },
];

const initialSupportedDomains: SupportedDomainSummary[] = [
  {
    name: 'project',
    kind: 'local-context',
    supportTier: 'preview',
    readTools: ['pp.project.inspect', 'pp.analysis.context', 'pp.analysis.portfolio', 'pp.analysis.drift', 'pp.analysis.usage', 'pp.analysis.policy'],
    mutationToolsAvailable: true,
    mutationTools: ['pp.deploy.plan', 'pp.deploy.apply'],
    notes: 'Reads local project topology and can drive bounded deploy plan-then-apply workflows against the resolved workspace.',
  },
  {
    name: 'dataverse',
    kind: 'platform',
    supportTier: 'preview',
    readTools: [
      'pp.environment.list',
      'pp.solution.list',
      'pp.solution.inspect',
      'pp.dataverse.query',
      'pp.connection-reference.inspect',
      'pp.environment-variable.inspect',
      'pp.model-app.inspect',
    ],
    mutationToolsAvailable: false,
    notes: 'The first MCP release exposes read-first Dataverse-backed inspection only.',
  },
  {
    name: 'analysis',
    kind: 'local-context',
    supportTier: 'preview',
    readTools: ['pp.analysis.context', 'pp.analysis.portfolio', 'pp.analysis.drift', 'pp.analysis.usage', 'pp.analysis.policy', 'pp.domain.list'],
    mutationToolsAvailable: false,
    notes: 'Returns structured agent context and interface metadata instead of rendered prose.',
  },
  {
    name: 'mcp',
    kind: 'interface',
    supportTier: 'preview',
    readTools: initialMcpTools
      .filter((tool) => tool.name !== 'pp.deploy.plan' && tool.name !== 'pp.deploy.apply')
      .map((tool) => tool.name),
    mutationToolsAvailable: true,
    mutationTools: ['pp.deploy.plan', 'pp.deploy.apply'],
    notes: 'Mutation tools are exposed through stored plan sessions plus explicit approval for live apply.',
  },
];

export function createReadFirstMcpServer(options: PpMcpServerOptions = {}): McpServer {
  return createPpMcpServer(options);
}

export function createPpMcpServer(options: PpMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: '@pp/mcp',
    version: '0.1.0',
    title: 'pp MCP',
  });

  registerTools(server, options);
  return server;
}

export async function startReadFirstMcpServer(options: PpMcpServerOptions = {}): Promise<{ server: McpServer; transport: StdioServerTransport }> {
  return startPpMcpServer(options);
}

export async function startPpMcpServer(options: PpMcpServerOptions = {}): Promise<{ server: McpServer; transport: StdioServerTransport }> {
  const server = createReadFirstMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, transport };
}

function registerTools(server: McpServer, defaults: PpMcpServerOptions): void {
  const deploySessions = new Map<string, DeploySessionRecord>();

  server.registerTool(
    'pp.environment.list',
    {
      title: 'List Environments',
      description: 'List configured Dataverse environment aliases from the local pp config registry.',
      inputSchema: z.object({
        configDir: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('List Environments'),
    },
    async ({ configDir }) => {
      const result = await listEnvironments(readConfigOptions(configDir, defaults));
      return toToolResult('pp.environment.list', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.solution.list',
    {
      title: 'List Solutions',
      description: 'List solutions visible in a configured Dataverse environment.',
      inputSchema: remoteBaseSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('List Solutions'),
    },
    async (args) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.solution.list', resolution, readOnlyPolicy());
      }

      const result = await new SolutionService(resolution.data.client).list();
      return toToolResult('pp.solution.list', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.solution.inspect',
    {
      title: 'Inspect Solution',
      description: 'Inspect one solution with dependencies, invalid connection references, and missing environment variables.',
      inputSchema: remoteBaseSchema.extend({
        uniqueName: z.string().min(1),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Solution'),
    },
    async ({ uniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.solution.inspect', resolution, readOnlyPolicy());
      }

      const result = await new SolutionService(resolution.data.client).analyze(uniqueName);
      return toToolResult('pp.solution.inspect', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.dataverse.query',
    {
      title: 'Query Dataverse',
      description: 'Run a read-only Dataverse table query with structured rows and diagnostics.',
      inputSchema: remoteBaseSchema.extend({
        table: z.string().min(1),
        select: z.array(z.string().min(1)).optional(),
        top: z.number().int().positive().optional(),
        filter: z.string().min(1).optional(),
        expand: z.array(z.string().min(1)).optional(),
        orderBy: z.array(z.string().min(1)).optional(),
        count: z.boolean().optional(),
        maxPageSize: z.number().int().positive().optional(),
        includeAnnotations: z.array(z.string().min(1)).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Query Dataverse'),
    },
    async ({ table, select, top, filter, expand, orderBy, count, maxPageSize, includeAnnotations, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.dataverse.query', resolution, readOnlyPolicy());
      }

      const result = await resolution.data.client.queryAll<Record<string, unknown>>({
        table,
        select,
        top,
        filter,
        expand,
        orderBy,
        count,
        maxPageSize,
        includeAnnotations,
      });

      return toToolResult('pp.dataverse.query', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.connection-reference.inspect',
    {
      title: 'Inspect Connection References',
      description: 'List or inspect Dataverse connection references, preserving support tier and diagnostics.',
      inputSchema: solutionScopeSchema.extend({
        identifier: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Connection References'),
    },
    async ({ identifier, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.connection-reference.inspect', resolution, readOnlyPolicy());
      }

      const service = new ConnectionReferenceService(resolution.data.client);
      if (identifier) {
        return toToolResult('pp.connection-reference.inspect', await service.inspect(identifier, { solutionUniqueName }), readOnlyPolicy());
      }

      return toToolResult('pp.connection-reference.inspect', await service.list({ solutionUniqueName }), readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.environment-variable.inspect',
    {
      title: 'Inspect Environment Variables',
      description: 'List or inspect Dataverse environment variables and their effective values.',
      inputSchema: solutionScopeSchema.extend({
        identifier: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Environment Variables'),
    },
    async ({ identifier, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.environment-variable.inspect', resolution, readOnlyPolicy());
      }

      const service = new EnvironmentVariableService(resolution.data.client);
      if (identifier) {
        return toToolResult('pp.environment-variable.inspect', await service.inspect(identifier, { solutionUniqueName }), readOnlyPolicy());
      }

      return toToolResult('pp.environment-variable.inspect', await service.list({ solutionUniqueName }), readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.model-app.inspect',
    {
      title: 'Inspect Model-Driven Apps',
      description: 'List model-driven apps or inspect one app with forms, views, tables, and dependencies.',
      inputSchema: solutionScopeSchema.extend({
        identifier: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Model-Driven Apps'),
    },
    async ({ identifier, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.model-app.inspect', resolution, readOnlyPolicy());
      }

      const service = new ModelService(resolution.data.client);
      if (identifier) {
        return toToolResult('pp.model-app.inspect', await service.inspect(identifier, { solutionUniqueName }), readOnlyPolicy());
      }

      return toToolResult('pp.model-app.inspect', await service.list({ solutionUniqueName }), readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.project.inspect',
    {
      title: 'Inspect Project',
      description: 'Inspect the local pp project context resolved from the working tree.',
      inputSchema: projectScopeSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Project'),
    },
    async ({ projectPath, stage }) => {
      const result = await discoverProject(resolveProjectPath(projectPath, defaults), {
        stage,
        environment: process.env,
      });
      return toToolResult('pp.project.inspect', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.analysis.context',
    {
      title: 'Generate Analysis Context',
      description: 'Generate a structured project and deploy context pack for agent workflows.',
      inputSchema: projectScopeSchema.extend({
        focusAsset: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Generate Analysis Context'),
    },
    async ({ projectPath, stage, focusAsset }) => {
      const project = await discoverProject(resolveProjectPath(projectPath, defaults), {
        stage,
        environment: process.env,
      });

      if (!project.success || !project.data) {
        return toToolResult('pp.analysis.context', project, readOnlyPolicy());
      }

      const result = generateContextPack(project.data, focusAsset);
      return toToolResult('pp.analysis.context', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.analysis.portfolio',
    {
      title: 'Analyze Portfolio',
      description: 'Aggregate multiple projects into a structured portfolio governance and drift report.',
      inputSchema: portfolioScopeSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Analyze Portfolio'),
    },
    async ({ projectPaths, stage, allowedProviderKinds, focusAsset }) =>
      runPortfolioTool('pp.analysis.portfolio', defaults, {
        projectPaths,
        stage,
        allowedProviderKinds,
        focusAsset,
        view: 'portfolio',
      })
  );

  server.registerTool(
    'pp.analysis.drift',
    {
      title: 'Inspect Portfolio Drift',
      description: 'Inspect cross-project drift across stages, provider bindings, parameters, and assets.',
      inputSchema: portfolioScopeSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Portfolio Drift'),
    },
    async ({ projectPaths, stage, allowedProviderKinds, focusAsset }) =>
      runPortfolioTool('pp.analysis.drift', defaults, {
        projectPaths,
        stage,
        allowedProviderKinds,
        focusAsset,
        view: 'drift',
      })
  );

  server.registerTool(
    'pp.analysis.usage',
    {
      title: 'Inspect Portfolio Usage',
      description: 'Inspect ownership, asset usage, provider usage, and parameter inventories across projects.',
      inputSchema: portfolioScopeSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Portfolio Usage'),
    },
    async ({ projectPaths, stage, allowedProviderKinds, focusAsset }) =>
      runPortfolioTool('pp.analysis.usage', defaults, {
        projectPaths,
        stage,
        allowedProviderKinds,
        focusAsset,
        view: 'usage',
      })
  );

  server.registerTool(
    'pp.analysis.policy',
    {
      title: 'Inspect Portfolio Policy',
      description: 'Inspect governance findings such as missing ownership, missing provenance, and unsupported connectors.',
      inputSchema: portfolioScopeSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Portfolio Policy'),
    },
    async ({ projectPaths, stage, allowedProviderKinds, focusAsset }) =>
      runPortfolioTool('pp.analysis.policy', defaults, {
        projectPaths,
        stage,
        allowedProviderKinds,
        focusAsset,
        view: 'policy',
      })
  );

  server.registerTool(
    'pp.deploy.plan',
    {
      title: 'Plan Deploy Apply',
      description: 'Resolve a bounded deploy plan, preflight it, and store an MCP plan session for later apply.',
      inputSchema: deployScopeSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Plan Deploy Apply'),
    },
    async ({ projectPath, stage }) => {
      const project = await discoverProject(resolveProjectPath(projectPath, defaults), {
        stage,
        environment: process.env,
      });

      if (!project.success || !project.data) {
        return toToolResult('pp.deploy.plan', project, controlledMutationPolicy(true));
      }

      const preview = await executeDeploy(project.data, {
        mode: 'plan',
      });

      if (!preview.success || !preview.data) {
        return toToolResult('pp.deploy.plan', preview, controlledMutationPolicy(true));
      }

      const session = createDeploySession(project.data, preview.data.plan);
      deploySessions.set(session.id, session);

      return toToolResult(
        'pp.deploy.plan',
        ok(
          {
            session: summarizeDeploySession(session),
            workspace: {
              projectRoot: project.data.root,
              selectedStage: project.data.topology.selectedStage,
              activeEnvironment: project.data.topology.activeEnvironment,
              activeSolution: project.data.topology.activeSolution?.uniqueName,
            },
            preview: preview.data,
          },
          {
            diagnostics: preview.diagnostics,
            warnings: preview.warnings,
            supportTier: preview.supportTier,
            suggestedNextActions: [
              `Call pp.deploy.apply with sessionId ${session.id} and mode dry-run to re-check the stored plan without writing.`,
              `Call pp.deploy.apply with sessionId ${session.id} and approval.confirmed=true to authorize live apply for this exact plan session.`,
              ...(preview.suggestedNextActions ?? []),
            ],
            provenance: [
              ...(preview.provenance ?? []),
              {
                kind: 'inferred',
                source: '@pp/mcp deploy session',
                detail: `Stored plan session ${session.id} for ${project.data.root} until ${session.expiresAt}.`,
              },
            ],
            knownLimitations: preview.knownLimitations,
          }
        ),
        controlledMutationPolicy(true)
      );
    }
  );

  server.registerTool(
    'pp.deploy.apply',
    {
      title: 'Apply Planned Deploy',
      description: 'Execute a previously planned deploy session in dry-run or apply mode with explicit approval for live writes.',
      inputSchema: deployApplySchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Apply Planned Deploy'),
    },
    async ({ sessionId, mode, parameterOverrides, approval }) => {
      pruneExpiredDeploySessions(deploySessions);
      const session = deploySessions.get(sessionId);

      if (!session) {
        return toToolResult(
          'pp.deploy.apply',
          fail(
            [
              createDiagnostic('error', 'MCP_DEPLOY_SESSION_NOT_FOUND', `Deploy session ${sessionId} was not found or has expired.`, {
                source: '@pp/mcp',
                detail: `sessionId=${sessionId}`,
              }),
            ],
            {
              supportTier: 'preview',
              suggestedNextActions: ['Call pp.deploy.plan again to create a fresh bounded plan session before applying it.'],
              knownLimitations: ['Deploy apply currently depends on an in-memory MCP plan session and does not persist sessions across server restarts.'],
            }
          ),
          controlledMutationPolicy(true)
        );
      }

      const executionMode = mode ?? 'apply';
      const confirmed = executionMode === 'apply' && approval?.confirmed === true && approval.sessionId === sessionId;
      const result = await executeDeployPlan(session.plan, {
        mode: executionMode,
        confirmed,
        parameterOverrides,
      });

      return toToolResult(
        'pp.deploy.apply',
        ok(
          {
            session: summarizeDeploySession(session),
            approval: {
              required: executionMode === 'apply',
              confirmed,
              matchedSession: approval?.sessionId === sessionId,
              reason: approval?.reason,
            },
            result: result.data,
          },
          {
            diagnostics: result.diagnostics,
            warnings: result.warnings,
            supportTier: result.supportTier,
            suggestedNextActions: [
              executionMode === 'apply' && !confirmed
                ? `Re-run pp.deploy.apply with sessionId ${sessionId} and approval { confirmed: true, sessionId: "${sessionId}" } to authorize live apply.`
                : `Re-run pp.deploy.plan if the workspace changed and you need a fresh bounded plan.`,
              ...(result.suggestedNextActions ?? []),
            ],
            provenance: [
              ...(result.provenance ?? []),
              {
                kind: 'inferred',
                source: '@pp/mcp deploy session',
                detail: `Executed ${executionMode} against stored plan session ${session.id}.`,
              },
            ],
            knownLimitations: result.knownLimitations,
          }
        ),
        controlledMutationPolicy(true),
        !result.success
      );
    }
  );

  server.registerTool(
    'pp.domain.list',
    {
      title: 'List Supported Domains',
      description: 'Describe the current MCP read surface and the mutation boundary for each exposed domain.',
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('List Supported Domains'),
    },
    async () => toToolResult('pp.domain.list', ok(initialSupportedDomains, { supportTier: 'preview' }), readOnlyPolicy())
  );
}

function readOnlyAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;
}

function readConfigOptions(configDir: string | undefined, defaults: PpMcpServerOptions): ConfigStoreOptions {
  return {
    configDir: configDir ?? defaults.configDir,
  };
}

function resolveProjectPath(projectPath: string | undefined, defaults: PpMcpServerOptions): string {
  return resolve(projectPath ?? defaults.projectPath ?? process.cwd());
}

async function resolvePortfolioProjects(
  projectPaths: string[] | undefined,
  stage: string | undefined,
  defaults: PpMcpServerOptions
): Promise<OperationResult<ProjectContext[]>> {
  const requested = (projectPaths && projectPaths.length > 0 ? projectPaths : [resolveProjectPath(undefined, defaults)]).map((path) =>
    resolve(path)
  );
  const projects: ProjectContext[] = [];
  const warnings: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const projectPath of requested) {
    if (seen.has(projectPath)) {
      warnings.push(
        createDiagnostic('warning', 'ANALYSIS_PORTFOLIO_DUPLICATE_PROJECT', `Skipping duplicate portfolio project ${projectPath}`, {
          source: '@pp/mcp',
        })
      );
      continue;
    }

    seen.add(projectPath);
    const result = await discoverProject(projectPath, {
      stage,
      environment: process.env,
    });

    if (!result.success || !result.data) {
      return fail([...warnings, ...result.diagnostics], {
        warnings: [...warnings, ...result.warnings],
        supportTier: result.supportTier,
        suggestedNextActions: result.suggestedNextActions,
        provenance: result.provenance,
        knownLimitations: result.knownLimitations,
      });
    }

    warnings.push(...result.warnings);
    projects.push(result.data);
  }

  return ok(projects, {
    warnings,
    supportTier: 'preview',
  });
}

async function runPortfolioTool(
  toolName: string,
  defaults: PpMcpServerOptions,
  args: {
    projectPaths?: string[];
    stage?: string;
    allowedProviderKinds?: string[];
    focusAsset?: string;
    view: 'portfolio' | 'drift' | 'usage' | 'policy';
  }
) {
  const projects = await resolvePortfolioProjects(args.projectPaths, args.stage, defaults);

  if (!projects.success || !projects.data) {
    return toToolResult(toolName, projects, readOnlyPolicy());
  }

  const result = generatePortfolioReport(projects.data, {
    allowedProviderKinds: args.allowedProviderKinds,
    focusAsset: args.focusAsset,
  });

  if (!result.success || !result.data) {
    return toToolResult(toolName, result, readOnlyPolicy());
  }

  const data =
    args.view === 'portfolio'
      ? result.data
      : args.view === 'drift'
        ? result.data.drift
        : args.view === 'usage'
          ? result.data.inventories
          : result.data.governance;

  return toToolResult(
    toolName,
    ok(data, {
      diagnostics: [...projects.diagnostics, ...result.diagnostics],
      warnings: [...projects.warnings, ...result.warnings],
      supportTier: result.supportTier,
      suggestedNextActions: result.suggestedNextActions,
      provenance: result.provenance,
      knownLimitations: result.knownLimitations,
    }),
    readOnlyPolicy()
  );
}

async function resolveRemoteRuntime(args: RemoteToolArgs, defaults: PpMcpServerOptions): Promise<OperationResult<ResolvedRemoteRuntime>> {
  const allowInteractiveAuth = args.allowInteractiveAuth ?? defaults.allowInteractiveAuth ?? false;
  const resolution = await resolveDataverseClient(args.environment, {
    ...readConfigOptions(args.configDir, defaults),
    publicClientLoginOptions: {
      allowInteractive: allowInteractiveAuth,
    },
  });

  if (!resolution.success || !resolution.data) {
    return resolution as unknown as OperationResult<ResolvedRemoteRuntime>;
  }

  return ok(
    {
      client: resolution.data.client,
    },
    {
      diagnostics: resolution.diagnostics,
      warnings: resolution.warnings,
      supportTier: resolution.supportTier,
      suggestedNextActions: resolution.suggestedNextActions,
      provenance: resolution.provenance,
      knownLimitations: resolution.knownLimitations,
    }
  );
}

function toToolResult<T>(toolName: string, result: OperationResult<T>, mutationPolicy: ToolMutationPolicy, forceError = !result.success) {
  const envelope = {
    tool: {
      name: toolName,
      mutationPolicy,
    },
    success: result.success,
    ...(result.data !== undefined ? { data: result.data } : {}),
    diagnostics: result.diagnostics,
    warnings: result.warnings,
    suggestedNextActions: result.suggestedNextActions ?? [],
    supportTier: result.supportTier,
    provenance: result.provenance,
    knownLimitations: result.knownLimitations,
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: summarizeEnvelope(toolName, envelope),
      },
    ],
    structuredContent: envelope,
    isError: forceError,
  };
}

function readOnlyPolicy(): ToolMutationPolicyReadOnly {
  return {
    mode: 'read-only',
    mutationsExposed: false,
    optInStrategy: 'No mutation tools are exposed by this tool.',
  };
}

function controlledMutationPolicy(approvalRequired: boolean): ToolMutationPolicyControlled {
  return {
    mode: 'controlled',
    mutationsExposed: true,
    approvalRequired,
    approvalStrategy: 'Plan first, then execute a stored MCP deploy session. Live apply requires explicit approval bound to the exact session id.',
    supportedExecutionModes: ['plan', 'dry-run', 'apply'],
    sessionRequired: true,
  };
}

function controlledMutationAnnotations(title: string) {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  } as const;
}

function createDeploySession(project: ProjectContext, plan: DeployPlan): DeploySessionRecord {
  const createdAt = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt,
    expiresAt: new Date(Date.now() + DEPLOY_SESSION_TTL_MS).toISOString(),
    workspaceRoot: project.root,
    selectedStage: project.topology.selectedStage,
    plan,
  };
}

function summarizeDeploySession(session: DeploySessionRecord) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    workspaceRoot: session.workspaceRoot,
    selectedStage: session.selectedStage,
    target: session.plan.target,
    operationCount: session.plan.operations.length,
    operationKinds: [...new Set(session.plan.operations.map((operation) => operation.kind))],
  };
}

function pruneExpiredDeploySessions(sessions: Map<string, DeploySessionRecord>): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (Date.parse(session.expiresAt) <= now) {
      sessions.delete(sessionId);
    }
  }
}

function summarizeEnvelope(
  toolName: string,
  envelope: {
    success: boolean;
    data?: unknown;
    diagnostics: Diagnostic[];
    warnings: Diagnostic[];
    supportTier: SupportTier;
    provenance?: ProvenanceRecord[];
  }
): string {
  const subject = toolName.replace(/^pp\./, '');
  const parts = [`${subject} ${envelope.success ? 'completed' : 'failed'}`, `support=${envelope.supportTier}`];

  if (Array.isArray(envelope.data)) {
    parts.push(`items=${envelope.data.length}`);
  } else if (envelope.data && typeof envelope.data === 'object') {
    parts.push('shape=object');
  }

  if (envelope.diagnostics.length > 0) {
    parts.push(`diagnostics=${envelope.diagnostics.length}`);
  }

  if (envelope.warnings.length > 0) {
    parts.push(`warnings=${envelope.warnings.length}`);
  }

  if ((envelope.provenance ?? []).length > 0) {
    parts.push(`provenance=${envelope.provenance!.length}`);
  }

  return parts.join(' ');
}

export type {
  AnalysisContextPack,
  ConnectionReferenceSummary,
  EnvironmentAlias,
  EnvironmentVariableSummary,
  ModelAppSummary,
  ModelInspectResult,
  ProjectContext,
  SolutionAnalysis,
  SolutionSummary,
};
