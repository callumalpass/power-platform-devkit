import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { generateContextPack, type AnalysisContextPack } from '@pp/analysis';
import { listEnvironments, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import {
  ConnectionReferenceService,
  EnvironmentVariableService,
  resolveDataverseClient,
  type ConnectionReferenceSummary,
  type EnvironmentVariableSummary,
} from '@pp/dataverse';
import { type Diagnostic, type OperationResult, type ProvenanceRecord, type SupportTier, ok } from '@pp/diagnostics';
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

const outputEnvelopeSchema = z
  .object({
    tool: z.object({
      name: z.string(),
      mutationPolicy: z.object({
        mode: z.literal('read-only'),
        mutationsExposed: z.literal(false),
        optInStrategy: z.string(),
      }),
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
    readTools: ['pp.project.inspect', 'pp.analysis.context'],
    mutationToolsAvailable: false,
    notes: 'Reads local project topology, parameters, and analysis context without mutating the filesystem.',
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
    readTools: ['pp.analysis.context', 'pp.domain.list'],
    mutationToolsAvailable: false,
    notes: 'Returns structured agent context and interface metadata instead of rendered prose.',
  },
  {
    name: 'mcp',
    kind: 'interface',
    supportTier: 'preview',
    readTools: initialMcpTools.map((tool) => tool.name),
    mutationToolsAvailable: false,
    notes: 'Mutation tools are intentionally absent from this server release.',
  },
];

export function createReadFirstMcpServer(options: PpMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: '@pp/mcp',
    version: '0.1.0',
    title: 'pp MCP',
  });

  registerReadFirstTools(server, options);
  return server;
}

export async function startReadFirstMcpServer(options: PpMcpServerOptions = {}): Promise<{ server: McpServer; transport: StdioServerTransport }> {
  const server = createReadFirstMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, transport };
}

function registerReadFirstTools(server: McpServer, defaults: PpMcpServerOptions): void {
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
      return toToolResult('pp.environment.list', result);
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
        return toToolResult('pp.solution.list', resolution);
      }

      const result = await new SolutionService(resolution.data.client).list();
      return toToolResult('pp.solution.list', result);
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
        return toToolResult('pp.solution.inspect', resolution);
      }

      const result = await new SolutionService(resolution.data.client).analyze(uniqueName);
      return toToolResult('pp.solution.inspect', result);
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
        return toToolResult('pp.dataverse.query', resolution);
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

      return toToolResult('pp.dataverse.query', result);
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
        return toToolResult('pp.connection-reference.inspect', resolution);
      }

      const service = new ConnectionReferenceService(resolution.data.client);
      if (identifier) {
        return toToolResult('pp.connection-reference.inspect', await service.inspect(identifier, { solutionUniqueName }));
      }

      return toToolResult('pp.connection-reference.inspect', await service.list({ solutionUniqueName }));
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
        return toToolResult('pp.environment-variable.inspect', resolution);
      }

      const service = new EnvironmentVariableService(resolution.data.client);
      if (identifier) {
        return toToolResult('pp.environment-variable.inspect', await service.inspect(identifier, { solutionUniqueName }));
      }

      return toToolResult('pp.environment-variable.inspect', await service.list({ solutionUniqueName }));
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
        return toToolResult('pp.model-app.inspect', resolution);
      }

      const service = new ModelService(resolution.data.client);
      if (identifier) {
        return toToolResult('pp.model-app.inspect', await service.inspect(identifier, { solutionUniqueName }));
      }

      return toToolResult('pp.model-app.inspect', await service.list({ solutionUniqueName }));
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
      return toToolResult('pp.project.inspect', result);
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
        return toToolResult('pp.analysis.context', project);
      }

      const result = generateContextPack(project.data, focusAsset);
      return toToolResult('pp.analysis.context', result);
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
    async () => toToolResult('pp.domain.list', ok(initialSupportedDomains, { supportTier: 'preview' }))
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

function toToolResult<T>(toolName: string, result: OperationResult<T>) {
  const envelope = {
    tool: {
      name: toolName,
      mutationPolicy: {
        mode: 'read-only' as const,
        mutationsExposed: false as const,
        optInStrategy: 'No mutation tools are exposed by this MCP server release.',
      },
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
    isError: !result.success,
  };
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
