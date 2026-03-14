import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { stableStringify } from '@pp/artifacts';
import { generateContextPack, generatePortfolioReport, type AnalysisContextPack } from '@pp/analysis';
import { AuthService, summarizeProfile } from '@pp/auth';
import { CanvasService } from '@pp/canvas';
import { getEnvironmentAlias, listEnvironments, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import {
  ConnectionReferenceService,
  EnvironmentVariableService,
  parseColumnCreateSpec,
  parseColumnUpdateSpec,
  parseCustomerRelationshipCreateSpec,
  parseGlobalOptionSetCreateSpec,
  parseGlobalOptionSetUpdateSpec,
  parseManyToManyRelationshipCreateSpec,
  parseManyToManyRelationshipUpdateSpec,
  parseMetadataApplyPlan,
  normalizeEntityDefinition,
  normalizeRelationshipDefinition,
  parseOneToManyRelationshipCreateSpec,
  parseOneToManyRelationshipUpdateSpec,
  parseTableCreateSpec,
  parseTableUpdateSpec,
  resolveDataverseClient,
  type ConnectionReferenceSummary,
  type DataverseClient,
  type DataverseMetadataApplyResult,
  type EnvironmentVariableSummary,
  type MetadataApplyPlan,
} from '@pp/dataverse';
import { executeDeploy, executeDeployPlan, type DeployExecutionMode, type DeployPlan } from '@pp/deploy';
import { createDiagnostic, fail, type Diagnostic, type OperationResult, type ProvenanceRecord, type SupportTier, ok } from '@pp/diagnostics';
import { FlowService, type FlowMonitorReport } from '@pp/flow';
import { ModelService, type ModelAppSummary, type ModelInspectResult } from '@pp/model';
import {
  cancelInitSession,
  compareProjectRuntimeTarget,
  discoverProject,
  doctorProject,
  feedbackProject,
  getInitSession,
  resumeInitSession,
  startInitSession,
  type InitSessionAnswers,
  type ProjectContext,
  summarizeProject,
  summarizeProjectContract,
} from '@pp/project';
import {
  SolutionService,
  type SolutionAnalysis,
  type SolutionCompareResult,
  type SolutionSummary,
  type SolutionSyncStatusResult,
} from '@pp/solution';
import YAML from 'yaml';
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
  environment: Awaited<ReturnType<typeof resolveDataverseClient>> extends OperationResult<infer T>
    ? T extends { environment: infer E }
      ? E
      : never
    : never;
  authProfile: Awaited<ReturnType<typeof resolveDataverseClient>> extends OperationResult<infer T>
    ? T extends { authProfile: infer A }
      ? A
      : never
    : never;
  client: Awaited<ReturnType<typeof resolveDataverseClient>> extends OperationResult<infer T>
    ? T extends { client: infer C }
      ? C
      : never
    : never;
}

interface EnvironmentCleanupCandidate {
  solutionid: string;
  uniquename: string;
  friendlyname?: string;
  version?: string;
  ismanaged?: boolean;
}

type EnvironmentCleanupAssetKind =
  | 'canvas-app'
  | 'cloud-flow'
  | 'model-app'
  | 'connection-reference'
  | 'environment-variable';

interface EnvironmentCleanupAssetCandidate {
  kind: EnvironmentCleanupAssetKind;
  table: 'canvasapps' | 'workflows' | 'appmodules' | 'connectionreferences' | 'environmentvariabledefinitions';
  id: string;
  primaryName: string;
  secondaryName?: string;
  matchedFields: string[];
}

interface EnvironmentCleanupPlanResult {
  environment: {
    alias: string;
    url: string;
    authProfile: string;
    defaultSolution?: string;
    makerEnvironmentId?: string;
  };
  prefix: string;
  matchStrategy: {
    kind: string;
    fields: string[];
  };
  remoteResetSupported: boolean;
  cleanupCandidates: EnvironmentCleanupCandidate[];
  assetCandidates: EnvironmentCleanupAssetCandidate[];
  candidateCount: number;
  solutionCandidateCount: number;
  assetCandidateCount: number;
  candidateSummary: Record<string, number>;
}

interface EnvironmentCleanupExecutionResult {
  mode: 'dry-run' | 'apply';
  environment: EnvironmentCleanupPlanResult['environment'];
  prefix: string;
  candidateCount: number;
  solutionCandidateCount: number;
  assetCandidateCount: number;
  deletedCount: number;
  failedCount: number;
  cleanupCandidates: EnvironmentCleanupCandidate[];
  assetCandidates: EnvironmentCleanupAssetCandidate[];
  deletedSolutions: Array<{
    removed: boolean;
    solution: EnvironmentCleanupCandidate;
  }>;
  deletedAssets: Array<{
    removed: boolean;
    asset: EnvironmentCleanupAssetCandidate;
  }>;
  failures: Array<{
    candidate: EnvironmentCleanupCandidate | EnvironmentCleanupAssetCandidate;
    diagnostics: Diagnostic[];
  }>;
  verification: {
    planTool: 'pp.environment.cleanup-plan';
    cleanupTool: 'pp.environment.cleanup';
    inspectTool: 'pp.solution.inspect';
  };
}

interface SolutionCompareToolResult {
  uniqueName: string;
  sourceEnvironment: string;
  targetEnvironment: string;
  compare: SolutionCompareResult;
  installState: {
    sourcePresent: boolean;
    targetPresent: boolean;
  };
}

interface SolutionCheckpointDocument {
  schemaVersion: 1;
  kind: 'pp-solution-checkpoint';
  generatedAt: string;
  environment: {
    alias: string;
    url?: string;
    pacOrganizationUrl?: string;
  };
  solution: {
    uniqueName: string;
    packageType: 'managed' | 'unmanaged';
    export: unknown;
    manifestPath?: string;
    rollbackCandidateVersion?: string;
  };
  synchronization?: {
    confirmed: boolean;
    blockers: SolutionSyncStatusResult['blockers'];
    readBack: SolutionSyncStatusResult['readBack'];
  };
  inspection: {
    solution: unknown;
    components: unknown[];
    componentCount: number;
  };
}

interface ToolResultLocalWrite {
  kind: 'tool-result-json';
  path: string;
}

interface AuthProfileInspectResult {
  mode?: 'profile' | 'catalog';
  name: string;
  type: string;
  tenantId?: string;
  clientId?: string;
  tokenCacheKey?: string;
  loginHint?: string;
  accountUsername?: string;
  homeAccountId?: string;
  localAccountId?: string;
  browserProfile?: string;
  prompt?: string;
  fallbackToDeviceCode?: boolean;
  environmentVariable?: string;
  clientSecretEnv?: string;
  hasToken?: boolean;
  defaultResource?: string;
  resolvedFromEnvironment?: string;
  resolvedEnvironmentUrl?: string;
  targetResource?: string;
  profileDefaultResource?: string;
  defaultResourceMatchesResolvedEnvironment?: boolean;
  relationships: {
    environmentAliases: string[];
    environmentCount: number;
  };
  profiles?: Array<{
    name: string;
    type: string;
    defaultResource?: string;
    relationships: {
      environmentAliases: string[];
      environmentCount: number;
    };
  }>;
}

export function addSolutionInspectRecoveryGuidance<T>(
  result: OperationResult<T>,
  environment: string,
  uniqueName: string
): OperationResult<T> {
  const diagnostics = result.diagnostics ?? [];
  const isTransportFailure = diagnostics.some(
    (diagnostic) =>
      diagnostic.code === 'HTTP_UNHANDLED_ERROR' ||
      diagnostic.code === 'HTTP_REQUEST_TIMEOUT' ||
      /fetch failed|network/i.test(diagnostic.message),
  );

  if (!isTransportFailure) {
    return result;
  }

  const suggestedNextActions = Array.from(
    new Set([
      ...(result.suggestedNextActions ?? []),
      `Run \`pp solution inspect ${uniqueName} --environment ${environment} --format json\` to determine whether the failure is MCP transport-specific or a live Dataverse inspect error.`,
      'If the CLI succeeds while MCP still fails, capture the MCP diagnostic detail and treat the issue as an MCP/HTTP transport boundary problem.',
    ]),
  );
  const knownLimitations = Array.from(
    new Set([
      ...(result.knownLimitations ?? []),
      'MCP solution inspect can still fail before Dataverse returns a response when the underlying HTTP transport reports fetch failed.',
    ]),
  );

  return {
    ...result,
    suggestedNextActions,
    knownLimitations,
  };
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
    details: z.unknown().optional(),
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

const flowInspectSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1).optional(),
});

const flowConnrefsSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  since: z.string().min(1).optional(),
});

const flowRunsSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  status: z.string().min(1).optional(),
  since: z.string().min(1).optional(),
});

const flowErrorsSchema = flowRunsSchema.extend({
  groupBy: z.enum(['errorCode', 'errorMessage', 'connectionReference']).optional(),
});

const flowMonitorSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  since: z.string().min(1).optional(),
  baseline: z.record(z.string(), z.unknown()).optional(),
});

const flowMutationSchema = solutionScopeSchema.extend({
  target: z.string().min(1).optional(),
  workflowState: z.enum(['draft', 'activated', 'suspended']).optional(),
});

const flowActivateSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
});

const flowDeploySchema = flowMutationSchema.extend({
  inputPath: z.string().min(1),
  createIfMissing: z.boolean().optional(),
  resultOutPath: z.string().min(1).optional(),
});

const flowExportSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  outPath: z.string().min(1),
});

const canvasInspectSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1).optional(),
});

const modelInspectSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1).optional(),
});

const modelCreateSchema = solutionScopeSchema.extend({
  uniqueName: z.string().min(1),
  name: z.string().min(1).optional(),
});

const modelAttachSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  solutionUniqueName: z.string().min(1),
  addRequiredComponents: z.boolean().optional(),
});

const canvasAccessSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
});

const canvasAttachPlanSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  solutionUniqueName: z.string().min(1),
});

const canvasAttachSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  solutionUniqueName: z.string().min(1),
  addRequiredComponents: z.boolean().optional(),
});

const canvasDownloadSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  outPath: z.string().min(1).optional(),
  extractToDirectory: z.string().min(1).optional(),
});

const canvasImportSchema = solutionScopeSchema.extend({
  identifier: z.string().min(1),
  importPath: z.string().min(1),
  publishWorkflows: z.boolean().optional(),
  overwriteUnmanagedCustomizations: z.boolean().optional(),
});

const solutionExportSchema = remoteBaseSchema.extend({
  uniqueName: z.string().min(1),
  outPath: z.string().min(1),
  manifestPath: z.string().min(1).optional(),
  managed: z.boolean().optional(),
  requestTimeoutMs: z.number().int().positive().optional(),
});

const solutionListSchema = remoteBaseSchema.extend({
  prefix: z.string().min(1).optional(),
  uniqueName: z.string().min(1).optional(),
});

const solutionImportSchema = remoteBaseSchema.extend({
  packagePath: z.string().min(1),
  publishWorkflows: z.boolean().optional(),
  overwriteUnmanagedCustomizations: z.boolean().optional(),
  holdingSolution: z.boolean().optional(),
  skipProductUpdateDependencies: z.boolean().optional(),
  importJobId: z.string().min(1).optional(),
});

const solutionCheckpointSchema = solutionExportSchema.extend({
  checkpointPath: z.string().min(1).optional(),
});

const dataverseMetadataApplySchema = solutionScopeSchema.extend({
  manifestPath: z.string().min(1),
  mode: z.enum(['dry-run', 'apply']).optional(),
  publish: z.boolean().optional(),
});

const dataverseMetadataTableInspectSchema = remoteBaseSchema.extend({
  logicalName: z.string().min(1),
  view: z.enum(['normalized', 'raw']).optional(),
  select: z.array(z.string().min(1)).optional(),
  expand: z.array(z.string().min(1)).optional(),
  includeAnnotations: z.array(z.string().min(1)).optional(),
});

const dataverseMetadataRelationshipInspectSchema = remoteBaseSchema.extend({
  schemaName: z.string().min(1),
  kind: z.enum(['auto', 'one-to-many', 'many-to-many']).optional(),
  view: z.enum(['normalized', 'raw']).optional(),
  select: z.array(z.string().min(1)).optional(),
  expand: z.array(z.string().min(1)).optional(),
  includeAnnotations: z.array(z.string().min(1)).optional(),
});

const solutionCreateSchema = remoteBaseSchema.extend({
  uniqueName: z.string().min(1),
  friendlyName: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  publisherId: z.string().uuid().optional(),
  publisherUniqueName: z.string().min(1).optional(),
});

const solutionSetMetadataSchema = remoteBaseSchema.extend({
  uniqueName: z.string().min(1),
  version: z.string().min(1).optional(),
  publisherId: z.string().uuid().optional(),
  publisherUniqueName: z.string().min(1).optional(),
});

const solutionPublishSchema = remoteBaseSchema.extend({
  uniqueName: z.string().min(1),
  waitForExport: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  managed: z.boolean().optional(),
  outPath: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  requestTimeoutMs: z.number().int().positive().optional(),
});

const environmentCleanupPlanSchema = remoteBaseSchema.extend({
  prefix: z.string().min(1),
});

const environmentCleanupSchema = environmentCleanupPlanSchema.extend({
  mode: z.enum(['dry-run', 'apply']).optional(),
});

const authProfileInspectSchema = z.object({
  name: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
  configDir: z.string().min(1).optional(),
});

const solutionSyncStatusSchema = remoteBaseSchema.extend({
  uniqueName: z.string().min(1),
  managed: z.boolean().optional(),
});

const solutionCompareSchema = z.object({
  uniqueName: z.string().min(1),
  sourceEnvironment: z.string().min(1),
  targetEnvironment: z.string().min(1),
  configDir: z.string().min(1).optional(),
  allowInteractiveAuth: z.boolean().optional(),
  includeModelComposition: z.boolean().optional(),
});

const dataverseDeleteSchema = remoteBaseSchema.extend({
  table: z.string().min(1),
  id: z.string().min(1),
  ifMatch: z.string().min(1).optional(),
});

const dataverseCreateSchema = remoteBaseSchema.extend({
  table: z.string().min(1),
  body: z.record(z.string(), z.unknown()),
  select: z.array(z.string().min(1)).optional(),
  expand: z.array(z.string().min(1)).optional(),
  includeAnnotations: z.array(z.string().min(1)).optional(),
  returnRepresentation: z.boolean().optional(),
  ifNoneMatch: z.string().min(1).optional(),
  ifMatch: z.string().min(1).optional(),
});

const projectScopeSchema = z.object({
  projectPath: z.string().min(1).optional(),
  stage: z.string().min(1).optional(),
  environmentAlias: z.string().min(1).optional(),
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

const initAnswerSchema = z.object({
  goal: z.enum(['dataverse', 'maker', 'project', 'full']).optional(),
  authMode: z.enum(['user', 'device-code', 'environment-token', 'client-secret', 'static-token']).optional(),
  authProfileName: z.string().min(1).optional(),
  loginHint: z.string().optional(),
  tokenEnvVar: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecretEnv: z.string().min(1).optional(),
  staticToken: z.string().min(1).optional(),
  environmentAlias: z.string().min(1).optional(),
  environmentUrl: z.string().url().optional(),
  browserProfileName: z.string().min(1).optional(),
  browserProfileKind: z.enum(['chrome', 'edge', 'chromium', 'custom']).optional(),
  browserBootstrapUrl: z.string().url().optional(),
  projectName: z.string().min(1).optional(),
  solutionName: z.string().min(1).optional(),
  stageName: z.string().min(1).optional(),
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
    name: 'pp.environment.cleanup-plan',
    title: 'Plan Environment Cleanup',
    description: 'List run-scoped disposable solutions that match a prefix before bootstrap cleanup.',
  },
  {
    name: 'pp.environment.cleanup',
    title: 'Clean Up Environment',
    description: 'Preview or delete run-scoped disposable solutions that match a prefix for bootstrap reset workflows.',
  },
  {
    name: 'pp.auth-profile.inspect',
    title: 'Inspect Auth Profile',
    description: 'Inspect one auth profile directly or resolve it from an environment alias for baseline verification.',
  },
  {
    name: 'pp.solution.list',
    title: 'List Solutions',
    description: 'List solutions visible in a configured Dataverse environment, with optional run-prefix or exact-name filters.',
  },
  {
    name: 'pp.solution.inspect',
    title: 'Inspect Solution',
    description: 'Inspect one solution with dependencies, invalid connection references, and missing environment variables.',
  },
  {
    name: 'pp.solution.compare',
    title: 'Compare Solution Across Environments',
    description: 'Compare one solution across two Dataverse environments and return structured install-state drift instead of failing when one side is absent.',
  },
  {
    name: 'pp.solution.sync-status',
    title: 'Preflight Solution Export Readiness',
    description: 'Inspect one solution for publish readback, packaged export blockers, and one export-backed readiness probe.',
  },
  {
    name: 'pp.solution.create',
    title: 'Create Solution',
    description: 'Create one unmanaged solution shell in a configured Dataverse environment with explicit or inferable publisher binding.',
  },
  {
    name: 'pp.solution.set-metadata',
    title: 'Set Solution Metadata',
    description: 'Update the version and publisher metadata for one solution in a configured Dataverse environment.',
  },
  {
    name: 'pp.solution.publish',
    title: 'Publish Solution',
    description: 'Publish one solution and optionally wait for an export-backed readiness checkpoint inside MCP.',
  },
  {
    name: 'pp.solution.export',
    title: 'Export Solution',
    description: 'Export one bounded solution package to an explicit local path with optional managed packaging.',
  },
  {
    name: 'pp.solution.import',
    title: 'Import Solution',
    description: 'Import one explicit local solution package into one configured Dataverse environment.',
  },
  {
    name: 'pp.solution.checkpoint',
    title: 'Capture Solution Checkpoint',
    description: 'Capture a rollback-oriented solution checkpoint with export, release manifest, readback, and component inventory in one bounded operation.',
  },
  {
    name: 'pp.dataverse.metadata.apply',
    title: 'Apply Dataverse Metadata Manifest',
    description: 'Preview or apply one repo-local Dataverse metadata manifest for tables, columns, option sets, and relationships.',
  },
  {
    name: 'pp.dataverse.metadata.table',
    title: 'Inspect Dataverse Table Metadata',
    description: 'Inspect one Dataverse table definition through MCP with normalized or raw metadata output.',
  },
  {
    name: 'pp.dataverse.metadata.relationship',
    title: 'Inspect Dataverse Relationship Metadata',
    description: 'Inspect one Dataverse relationship definition through MCP with normalized or raw metadata output.',
  },
  {
    name: 'pp.dataverse.query',
    title: 'Query Dataverse',
    description: 'Run a read-only Dataverse table query with structured rows and diagnostics.',
  },
  {
    name: 'pp.dataverse.create',
    title: 'Create Dataverse Row',
    description: 'Create one explicit Dataverse row through the MCP mutation surface.',
  },
  {
    name: 'pp.dataverse.delete',
    title: 'Delete Dataverse Row',
    description: 'Delete one explicit Dataverse row by table and id through the MCP mutation surface.',
  },
  {
    name: 'pp.dataverse.whoami',
    title: 'Who Am I',
    description: 'Resolve the current Dataverse caller identity and organization through a harmless read-only route.',
  },
  {
    name: 'pp.flow.inspect',
    title: 'Inspect Flows',
    description: 'List remote cloud flows or inspect one flow with workflow metadata, connection references, and environment-variable dependencies.',
  },
  {
    name: 'pp.flow.connrefs',
    title: 'Inspect Flow Connection Health',
    description: 'Inspect one remote flow with connection-reference health, environment-variable state, and source-node correlation.',
  },
  {
    name: 'pp.flow.runs',
    title: 'List Flow Runs',
    description: 'List one remote flow\'s recent runs with structured runtime diagnostics.',
  },
  {
    name: 'pp.flow.errors',
    title: 'Summarize Flow Errors',
    description: 'Group one remote flow\'s recent failures by error or connection reference.',
  },
  {
    name: 'pp.flow.doctor',
    title: 'Diagnose Flow Runtime',
    description: 'Summarize one remote flow\'s runtime blockers, connection-reference health, and next actions.',
  },
  {
    name: 'pp.flow.monitor',
    title: 'Monitor Flow Runtime',
    description: 'Summarize one remote flow with recent run health, grouped errors, and follow-up monitoring findings.',
  },
  {
    name: 'pp.flow.activate',
    title: 'Activate Flow',
    description: 'Attempt one bounded in-place activation for one remote flow and preserve structured blocker diagnostics when Dataverse rejects the update.',
  },
  {
    name: 'pp.flow.deploy',
    title: 'Deploy Flow Artifact',
    description: 'Create or update one remote flow from a local artifact path, including solution-scoped create-if-missing authoring plus workflow-state follow-up guidance.',
  },
  {
    name: 'pp.flow.export',
    title: 'Export Flow Artifact',
    description: 'Export one remote flow into a local artifact path for repo-local inspection or patching.',
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
    name: 'pp.model-app.create',
    title: 'Create Model-Driven App',
    description: 'Create one model-driven app through the MCP mutation surface with optional solution attachment.',
  },
  {
    name: 'pp.model-app.attach',
    title: 'Attach Model-Driven App',
    description: 'Attach one existing model-driven app to a solution through the MCP mutation surface.',
  },
  {
    name: 'pp.canvas-app.inspect',
    title: 'Inspect Canvas Apps',
    description: 'List remote canvas apps or inspect one canvas app within an optional solution scope.',
  },
  {
    name: 'pp.canvas-app.access',
    title: 'Inspect Canvas Access',
    description: 'Inspect ownership and explicit share state for one remote canvas app within an optional solution scope.',
  },
  {
    name: 'pp.canvas-app.plan-attach',
    title: 'Plan Canvas App Attach',
    description: 'Preview one remote canvas app attach against a target solution without mutating Dataverse.',
  },
  {
    name: 'pp.canvas-app.attach',
    title: 'Attach Canvas App',
    description: 'Attach one remote canvas app to a solution and summarize the resulting solution impact.',
  },
  {
    name: 'pp.canvas-app.download',
    title: 'Download Canvas App',
    description: 'Download one remote canvas app as an `.msapp` artifact with optional extracted source output.',
  },
  {
    name: 'pp.canvas-app.import',
    title: 'Import Canvas App',
    description: 'Replace one remote canvas app inside a named solution from one explicit local `.msapp` artifact.',
  },
  {
    name: 'pp.project.inspect',
    title: 'Inspect Project',
    description: 'Inspect the local pp project context resolved from the working tree.',
  },
  {
    name: 'pp.project.doctor',
    title: 'Doctor Project',
    description: 'Validate the local project layout and expose the canonical stage-to-bundle route in structured form.',
  },
  {
    name: 'pp.project.feedback',
    title: 'Project Feedback',
    description: 'Capture conceptual feedback about the local project structure without leaving the MCP surface.',
  },
  {
    name: 'pp.init.start',
    title: 'Start Init Session',
    description: 'Start a guided, resumable pp init session for local setup.',
  },
  {
    name: 'pp.init.status',
    title: 'Inspect Init Session',
    description: 'Inspect the state of a persisted pp init session.',
  },
  {
    name: 'pp.init.answer',
    title: 'Answer Init Session',
    description: 'Apply one or more user answers to a persisted pp init session.',
  },
  {
    name: 'pp.init.resume',
    title: 'Resume Init Session',
    description: 'Resume a persisted pp init session after an external step completes.',
  },
  {
    name: 'pp.init.cancel',
    title: 'Cancel Init Session',
    description: 'Cancel a persisted pp init session.',
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
    readTools: [
      'pp.project.inspect',
      'pp.project.doctor',
      'pp.project.feedback',
      'pp.init.status',
      'pp.analysis.context',
      'pp.analysis.portfolio',
      'pp.analysis.drift',
      'pp.analysis.usage',
      'pp.analysis.policy',
    ],
    mutationToolsAvailable: true,
    mutationTools: ['pp.init.start', 'pp.init.answer', 'pp.init.resume', 'pp.init.cancel', 'pp.deploy.plan', 'pp.deploy.apply'],
    notes: 'Reads local project topology and can drive guided init sessions plus bounded deploy plan-then-apply workflows against the resolved workspace.',
  },
  {
    name: 'auth',
    kind: 'local-context',
    supportTier: 'preview',
    readTools: ['pp.auth-profile.inspect', 'pp.environment.list'],
    mutationToolsAvailable: false,
    notes: 'Reads local pp auth-profile metadata directly or by resolving an environment alias to its bound auth profile.',
  },
  {
    name: 'dataverse',
    kind: 'platform',
    supportTier: 'preview',
    readTools: [
      'pp.environment.list',
      'pp.environment.cleanup-plan',
      'pp.solution.list',
      'pp.solution.inspect',
      'pp.solution.compare',
      'pp.dataverse.metadata.table',
      'pp.dataverse.metadata.relationship',
      'pp.dataverse.query',
      'pp.dataverse.whoami',
      'pp.flow.inspect',
      'pp.flow.connrefs',
      'pp.canvas-app.inspect',
      'pp.canvas-app.access',
      'pp.canvas-app.plan-attach',
      'pp.connection-reference.inspect',
      'pp.environment-variable.inspect',
      'pp.model-app.inspect',
    ],
    mutationToolsAvailable: true,
    mutationTools: [
      'pp.environment.cleanup',
      'pp.dataverse.metadata.apply',
      'pp.dataverse.create',
      'pp.dataverse.delete',
      'pp.model-app.create',
      'pp.model-app.attach',
    ],
    notes:
      'The MCP Dataverse surface stays inspect-first but now includes bounded bootstrap cleanup by run prefix, manifest-driven metadata apply for repo-local schema specs, first-class table/relationship metadata inspection, explicit single-row create/delete, alongside solution/environment inspection, Dataverse queries that auto-resolve logical names like `solution` to entity sets like `solutions`, and harmless identity reads via pp.dataverse.whoami.',
  },
  {
    name: 'solution-lifecycle',
    kind: 'platform',
    supportTier: 'preview',
    readTools: ['pp.solution.list', 'pp.solution.inspect', 'pp.solution.compare', 'pp.solution.sync-status', 'pp.domain.list'],
    mutationToolsAvailable: true,
    mutationTools: ['pp.solution.create', 'pp.solution.set-metadata', 'pp.solution.publish', 'pp.solution.export', 'pp.solution.import', 'pp.solution.checkpoint'],
    notes:
      'Use solution list/inspect/compare to choose a publisher-backed shell and assess cross-environment drift, pp.solution.create to create one bounded unmanaged solution when needed with explicit or inferable publisher binding, pp.solution.set-metadata to update version or publisher bindings in place, pp.solution.publish to trigger PublishAllXml plus the same export-backed confirmation path used by the CLI, pp.solution.sync-status to capture publish readback plus one export-backed readiness probe, pp.solution.import to apply one explicit package artifact, and pp.solution.checkpoint to capture one rollback-oriented pre-import export plus inventory bundle.',
  },
  {
    name: 'flow-lifecycle',
    kind: 'platform',
    supportTier: 'preview',
    readTools: ['pp.flow.inspect', 'pp.flow.connrefs', 'pp.flow.runs', 'pp.flow.errors', 'pp.flow.doctor', 'pp.flow.monitor', 'pp.domain.list'],
    mutationToolsAvailable: true,
    mutationTools: ['pp.flow.activate', 'pp.flow.deploy', 'pp.flow.export'],
    notes:
      'Use pp.flow.inspect to discover or inspect remote cloud flows inside one environment, pp.flow.runs/errors/doctor for the core runtime evidence slices, pp.flow.connrefs to map runtime/dependency health back to connection references and environment variables, pp.flow.monitor to capture one higher-level runtime follow-up summary, pp.flow.activate for one bounded in-place remediation attempt on draft solution flows, and pp.flow.deploy with createIfMissing=true when you need to create or update one explicit solution-scoped flow artifact inside MCP while still getting workflow-state follow-up guidance in the result.',
  },
  {
    name: 'model-lifecycle',
    kind: 'platform',
    supportTier: 'preview',
    readTools: ['pp.model-app.inspect', 'pp.domain.list'],
    mutationToolsAvailable: true,
    mutationTools: ['pp.model-app.create', 'pp.model-app.attach'],
    notes:
      'Use pp.model-app.inspect to discover or inspect model-driven apps inside one environment or solution scope, pp.model-app.create to provision one model-driven app with optional solution attachment, and pp.model-app.attach to keep existing-app solution attachment inside the MCP surface.',
  },
  {
    name: 'canvas-lifecycle',
    kind: 'platform',
    supportTier: 'preview',
    readTools: ['pp.canvas-app.inspect', 'pp.canvas-app.access', 'pp.canvas-app.plan-attach', 'pp.domain.list'],
    mutationToolsAvailable: true,
    mutationTools: ['pp.canvas-app.attach', 'pp.canvas-app.download', 'pp.canvas-app.import'],
    notes:
      'Use pp.canvas-app.inspect to discover or inspect remote canvas apps inside one environment or solution scope, pp.canvas-app.access to inspect ownership and explicit share state, pp.canvas-app.plan-attach to preview target-solution baseline plus containing-solution context before mutating, pp.canvas-app.download to export one remote `.msapp` with optional extracted source output, pp.canvas-app.import to replace one remote app from one explicit local `.msapp`, and pp.canvas-app.attach to keep bounded remote solution attachment inside MCP with post-attach solution-impact readback.',
  },
  {
    name: 'flow-local-artifacts',
    kind: 'local-context',
    supportTier: 'preview',
    readTools: ['pp.domain.list'],
    mutationToolsAvailable: false,
    notes:
      'Local flow artifact inspect/unpack/normalize/validate/patch routes are CLI-only today: `pp flow inspect`, `pp flow unpack`, `pp flow normalize`, `pp flow validate`, and `pp flow patch`.',
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
      .filter(
        (tool) =>
          ![
            'pp.deploy.plan',
            'pp.deploy.apply',
            'pp.solution.create',
            'pp.solution.set-metadata',
            'pp.solution.publish',
            'pp.solution.export',
            'pp.solution.import',
            'pp.solution.checkpoint',
            'pp.dataverse.metadata.apply',
            'pp.model-app.create',
            'pp.model-app.attach',
            'pp.flow.deploy',
            'pp.flow.export',
            'pp.canvas-app.plan-attach',
            'pp.canvas-app.attach',
            'pp.canvas-app.download',
            'pp.canvas-app.import',
          ].includes(tool.name)
      )
      .map((tool) => tool.name),
    mutationToolsAvailable: true,
    mutationTools: [
      'pp.environment.cleanup',
      'pp.dataverse.metadata.apply',
      'pp.dataverse.create',
      'pp.dataverse.delete',
      'pp.model-app.create',
      'pp.model-app.attach',
      'pp.init.start',
      'pp.init.answer',
      'pp.init.resume',
      'pp.init.cancel',
      'pp.solution.create',
      'pp.solution.set-metadata',
      'pp.solution.publish',
      'pp.solution.export',
      'pp.solution.import',
      'pp.solution.checkpoint',
      'pp.flow.activate',
      'pp.flow.deploy',
      'pp.flow.export',
      'pp.canvas-app.attach',
      'pp.canvas-app.download',
      'pp.canvas-app.import',
      'pp.deploy.plan',
      'pp.deploy.apply',
    ],
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
    'pp.environment.cleanup-plan',
    {
      title: 'Plan Environment Cleanup',
      description: 'List run-scoped disposable solutions that match a prefix before bootstrap cleanup.',
      inputSchema: environmentCleanupPlanSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Plan Environment Cleanup'),
    },
    async ({ prefix, ...args }) => {
      const result = await buildEnvironmentCleanupPlan({ ...args, prefix }, defaults);
      return toToolResult('pp.environment.cleanup-plan', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.environment.cleanup',
    {
      title: 'Clean Up Environment',
      description: 'Preview or delete run-scoped disposable solutions that match a prefix for bootstrap reset workflows.',
      inputSchema: environmentCleanupSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Clean Up Environment'),
    },
    async ({ prefix, mode, ...args }) => {
      const result = await executeEnvironmentCleanup({ ...args, prefix, mode }, defaults);
      return toToolResult(
        'pp.environment.cleanup',
        result,
        previewableRemoteMutationPolicy(
          'This tool performs one bounded bootstrap cleanup by listing or deleting only solutions whose unique name or friendly name starts with the provided prefix.',
        ),
      );
    }
  );

  server.registerTool(
    'pp.auth-profile.inspect',
    {
      title: 'Inspect Auth Profile',
      description: 'Inspect one auth profile directly or resolve it from an environment alias for baseline verification.',
      inputSchema: authProfileInspectSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Auth Profile'),
    },
    async (args) => {
      const result = await inspectAuthProfile(args, defaults);
      return toToolResult('pp.auth-profile.inspect', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.solution.list',
    {
      title: 'List Solutions',
      description: 'List solutions visible in a configured Dataverse environment, with optional run-prefix or exact-name filters.',
      inputSchema: solutionListSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('List Solutions'),
    },
    async ({ prefix, uniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.solution.list', resolution, readOnlyPolicy());
      }

      const result = await new SolutionService(resolution.data.client).list({
        prefix,
        uniqueName,
      });
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

      const result = addSolutionInspectRecoveryGuidance(
        await new SolutionService(resolution.data.client).analyze(uniqueName),
        args.environment,
        uniqueName,
      );
      return toToolResult('pp.solution.inspect', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.solution.compare',
    {
      title: 'Compare Solution Across Environments',
      description: 'Compare one solution across two Dataverse environments and return structured install-state drift instead of failing when one side is absent.',
      inputSchema: solutionCompareSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Compare Solution Across Environments'),
    },
    async ({ uniqueName, sourceEnvironment, targetEnvironment, includeModelComposition, ...args }) => {
      const result = await compareSolutionAcrossEnvironments(
        {
          ...args,
          uniqueName,
          sourceEnvironment,
          targetEnvironment,
          includeModelComposition,
        },
        defaults,
      );
      return toToolResult('pp.solution.compare', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.solution.sync-status',
    {
      title: 'Preflight Solution Export Readiness',
      description: 'Inspect one solution for publish readback, packaged export blockers, and one export-backed readiness probe.',
      inputSchema: solutionSyncStatusSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Preflight Solution Export Readiness'),
    },
    async ({ uniqueName, managed, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.solution.sync-status', resolution, readOnlyPolicy());
      }

      const result = await new SolutionService(resolution.data.client).syncStatus(uniqueName, {
        includeExportCheck: true,
        managed,
      });
      return toToolResult('pp.solution.sync-status', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.solution.create',
    {
      title: 'Create Solution',
      description: 'Create one unmanaged solution shell in a configured Dataverse environment with explicit or inferable publisher binding.',
      inputSchema: solutionCreateSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Create Solution'),
    },
    async ({ uniqueName, friendlyName, version, description, publisherId, publisherUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.solution.create',
          resolution,
          remoteMutationPolicy(
            'This tool performs one bounded Dataverse solution create action for one explicit unique name and explicit or inferred publisher binding.',
            false,
          ),
        );
      }

      const result = await new SolutionService(resolution.data.client).create(uniqueName, {
        friendlyName,
        version,
        description,
        publisherId,
        publisherUniqueName,
      });
      return toToolResult(
        'pp.solution.create',
        result,
        remoteMutationPolicy(
          'This tool performs one bounded Dataverse solution create action for one explicit unique name and explicit or inferred publisher binding.',
          false,
        ),
      );
    }
  );

  server.registerTool(
    'pp.solution.set-metadata',
    {
      title: 'Set Solution Metadata',
      description: 'Update the version and publisher metadata for one solution in a configured Dataverse environment.',
      inputSchema: solutionSetMetadataSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Set Solution Metadata'),
    },
    async ({ uniqueName, version, publisherId, publisherUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.solution.set-metadata',
          resolution,
          remoteMutationPolicy(
            'This tool performs one bounded Dataverse solution metadata update for one explicit unique name.',
            false,
          ),
        );
      }

      const result = await new SolutionService(resolution.data.client).setMetadata(uniqueName, {
        version,
        publisherId,
        publisherUniqueName,
      });
      return toToolResult(
        'pp.solution.set-metadata',
        result,
        remoteMutationPolicy(
          'This tool performs one bounded Dataverse solution metadata update for one explicit unique name.',
          false,
        ),
      );
    }
  );

  server.registerTool(
    'pp.solution.publish',
    {
      title: 'Publish Solution',
      description: 'Publish one solution and optionally wait for an export-backed readiness checkpoint inside MCP.',
      inputSchema: solutionPublishSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Publish Solution'),
    },
    async ({ uniqueName, waitForExport, timeoutMs, pollIntervalMs, managed, outPath, manifestPath, requestTimeoutMs, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.solution.publish',
          resolution,
          remoteMutationPolicy(
            'This tool performs one bounded solution publish action and can optionally wait for one export-backed readiness checkpoint.',
            Boolean(outPath || manifestPath),
          ),
        );
      }

      const workspaceRoot = resolveProjectPath(undefined, defaults);
      const result = await new SolutionService(resolution.data.client).publish(uniqueName, {
        waitForExport,
        timeoutMs,
        pollIntervalMs,
        exportOptions: {
          managed,
          outPath: outPath ? resolveWorkspacePath(outPath, workspaceRoot) : undefined,
          manifestPath: manifestPath ? resolveWorkspacePath(manifestPath, workspaceRoot) : undefined,
          requestTimeoutMs,
        },
      });
      return toToolResult(
        'pp.solution.publish',
        result,
        remoteMutationPolicy(
          'This tool performs one bounded solution publish action and can optionally wait for one export-backed readiness checkpoint.',
          Boolean(outPath || manifestPath),
        ),
      );
    }
  );

  server.registerTool(
    'pp.solution.export',
    {
      title: 'Export Solution',
      description: 'Export one bounded solution package to an explicit local path with optional managed packaging.',
      inputSchema: solutionExportSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Export Solution'),
    },
    async ({ uniqueName, outPath, manifestPath, managed, requestTimeoutMs, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.solution.export',
          resolution,
          remoteMutationPolicy('This tool performs one bounded remote export action and writes the package to an explicit local path.', true)
        );
      }

      const workspaceRoot = resolveProjectPath(undefined, defaults);
      const result = await new SolutionService(resolution.data.client).exportSolution(uniqueName, {
        outPath: resolveWorkspacePath(outPath, workspaceRoot),
        manifestPath: manifestPath ? resolveWorkspacePath(manifestPath, workspaceRoot) : undefined,
        managed,
        requestTimeoutMs,
      });
      return toToolResult(
        'pp.solution.export',
        result,
        remoteMutationPolicy('This tool performs one bounded remote export action and writes the package to an explicit local path.', true)
      );
    }
  );

  server.registerTool(
    'pp.solution.import',
    {
      title: 'Import Solution',
      description: 'Import one explicit local solution package into one configured Dataverse environment.',
      inputSchema: solutionImportSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Import Solution'),
    },
    async ({ packagePath, publishWorkflows, overwriteUnmanagedCustomizations, holdingSolution, skipProductUpdateDependencies, importJobId, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.solution.import',
          resolution,
          remoteMutationPolicy('This tool imports one explicit local solution package into one named Dataverse environment.', true)
        );
      }

      const workspaceRoot = resolveProjectPath(undefined, defaults);
      const result = await new SolutionService(resolution.data.client).importSolution(resolveWorkspacePath(packagePath, workspaceRoot), {
        publishWorkflows,
        overwriteUnmanagedCustomizations,
        holdingSolution,
        skipProductUpdateDependencies,
        importJobId,
      });
      return toToolResult(
        'pp.solution.import',
        result,
        remoteMutationPolicy('This tool imports one explicit local solution package into one named Dataverse environment.', true)
      );
    }
  );

  server.registerTool(
    'pp.solution.checkpoint',
    {
      title: 'Capture Solution Checkpoint',
      description: 'Capture a rollback-oriented solution checkpoint with export, release manifest, readback, and component inventory in one bounded operation.',
      inputSchema: solutionCheckpointSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Capture Solution Checkpoint'),
    },
    async ({ uniqueName, outPath, manifestPath, checkpointPath, managed, requestTimeoutMs, ...args }) => {
      const result = await executeSolutionCheckpoint(
        {
          ...args,
          uniqueName,
          outPath,
          manifestPath,
          checkpointPath,
          managed,
          requestTimeoutMs,
        },
        defaults,
      );
      return toToolResult(
        'pp.solution.checkpoint',
        result,
        remoteMutationPolicy(
          'This tool captures one bounded rollback-oriented checkpoint for one named solution and writes the package, manifest, and checkpoint document to explicit local paths.',
          true,
        ),
      );
    }
  );

  server.registerTool(
    'pp.dataverse.metadata.apply',
    {
      title: 'Apply Dataverse Metadata Manifest',
      description: 'Preview or apply one repo-local Dataverse metadata manifest for tables, columns, option sets, and relationships.',
      inputSchema: dataverseMetadataApplySchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Apply Dataverse Metadata Manifest'),
    },
    async ({ manifestPath, solutionUniqueName, mode, publish, ...args }) => {
      const result = await executeDataverseMetadataApply(
        {
          ...args,
          manifestPath,
          solutionUniqueName,
          mode,
          publish,
        },
        defaults,
      );
      return toToolResult(
        'pp.dataverse.metadata.apply',
        result,
        previewableRemoteMutationPolicy(
          'This tool reads one explicit repo-local metadata manifest, previews the ordered operations on dry-run, or applies that bounded manifest to one environment.',
        ),
      );
    }
  );

  server.registerTool(
    'pp.dataverse.metadata.table',
    {
      title: 'Inspect Dataverse Table Metadata',
      description: 'Inspect one Dataverse table definition through MCP with normalized or raw metadata output.',
      inputSchema: dataverseMetadataTableInspectSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Dataverse Table Metadata'),
    },
    async ({ logicalName, view, select, expand, includeAnnotations, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.dataverse.metadata.table', resolution, readOnlyPolicy());
      }

      const result = await resolution.data.client.getTable(logicalName, {
        select,
        expand,
        includeAnnotations,
      });

      if (!result.success || !result.data) {
        return toToolResult('pp.dataverse.metadata.table', result, readOnlyPolicy());
      }

      return toToolResult(
        'pp.dataverse.metadata.table',
        ok(view === 'raw' ? result.data : normalizeEntityDefinition(result.data), {
          supportTier: result.supportTier,
          diagnostics: result.diagnostics,
          warnings: result.warnings,
          provenance: result.provenance,
          suggestedNextActions: result.suggestedNextActions,
          knownLimitations: result.knownLimitations,
        }),
        readOnlyPolicy(),
      );
    }
  );

  server.registerTool(
    'pp.dataverse.metadata.relationship',
    {
      title: 'Inspect Dataverse Relationship Metadata',
      description: 'Inspect one Dataverse relationship definition through MCP with normalized or raw metadata output.',
      inputSchema: dataverseMetadataRelationshipInspectSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Dataverse Relationship Metadata'),
    },
    async ({ schemaName, kind, view, select, expand, includeAnnotations, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.dataverse.metadata.relationship', resolution, readOnlyPolicy());
      }

      const result = await resolution.data.client.getRelationship(schemaName, {
        kind,
        select,
        expand,
        includeAnnotations,
      });

      if (!result.success || !result.data) {
        return toToolResult('pp.dataverse.metadata.relationship', result, readOnlyPolicy());
      }

      return toToolResult(
        'pp.dataverse.metadata.relationship',
        ok(view === 'raw' ? result.data : normalizeRelationshipDefinition(result.data), {
          supportTier: result.supportTier,
          diagnostics: result.diagnostics,
          warnings: result.warnings,
          provenance: result.provenance,
          suggestedNextActions: result.suggestedNextActions,
          knownLimitations: result.knownLimitations,
        }),
        readOnlyPolicy(),
      );
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
    'pp.dataverse.create',
    {
      title: 'Create Dataverse Row',
      description: 'Create one explicit Dataverse row through the MCP mutation surface.',
      inputSchema: dataverseCreateSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Create Dataverse Row'),
    },
    async ({ table, body, select, expand, includeAnnotations, returnRepresentation, ifNoneMatch, ifMatch, ...args }) => {
      const result = await executeDataverseCreate(
        {
          ...args,
          table,
          body,
          select,
          expand,
          includeAnnotations,
          returnRepresentation,
          ifNoneMatch,
          ifMatch,
        },
        defaults,
      );
      return toToolResult(
        'pp.dataverse.create',
        result,
        remoteMutationPolicy(
          'This tool performs one bounded Dataverse row create for one explicit table and JSON body so seeding can stay inside the MCP surface.',
          false,
        ),
      );
    }
  );

  server.registerTool(
    'pp.dataverse.delete',
    {
      title: 'Delete Dataverse Row',
      description: 'Delete one explicit Dataverse row by table and id through the MCP mutation surface.',
      inputSchema: dataverseDeleteSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Delete Dataverse Row'),
    },
    async ({ table, id, ifMatch, ...args }) => {
      const result = await executeDataverseDelete({ ...args, table, id, ifMatch }, defaults);
      return toToolResult(
        'pp.dataverse.delete',
        result,
        remoteMutationPolicy(
          'This tool performs one bounded Dataverse row delete for one explicit table/id pair so cleanup can stay inside the MCP surface.',
          false,
        ),
      );
    }
  );

  server.registerTool(
    'pp.dataverse.whoami',
    {
      title: 'Who Am I',
      description: 'Resolve the current Dataverse caller identity and organization through a harmless read-only route.',
      inputSchema: remoteBaseSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Who Am I'),
    },
    async (args) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.dataverse.whoami', resolution, readOnlyPolicy());
      }

      const result = await resolution.data.client.whoAmI();
      return toToolResult('pp.dataverse.whoami', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.flow.inspect',
    {
      title: 'Inspect Flows',
      description: 'List remote cloud flows or inspect one flow with workflow metadata, connection references, and environment-variable dependencies.',
      inputSchema: flowInspectSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Flows'),
    },
    async ({ identifier, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.flow.inspect', resolution, readOnlyPolicy());
      }

      const service = new FlowService(resolution.data.client);
      if (identifier) {
        return toToolResult('pp.flow.inspect', await service.inspect(identifier, { solutionUniqueName }), readOnlyPolicy());
      }

      return toToolResult('pp.flow.inspect', await service.list({ solutionUniqueName }), readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.flow.connrefs',
    {
      title: 'Inspect Flow Connection Health',
      description: 'Inspect one remote flow with connection-reference health, environment-variable state, and source-node correlation.',
      inputSchema: flowConnrefsSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Flow Connection Health'),
    },
    async ({ identifier, solutionUniqueName, since, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.flow.connrefs', resolution, readOnlyPolicy());
      }

      const result = await new FlowService(resolution.data.client).connrefs(identifier, {
        solutionUniqueName,
        since,
      });
      return toToolResult('pp.flow.connrefs', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.flow.runs',
    {
      title: 'List Flow Runs',
      description: 'List one remote flow\'s recent runs with structured runtime diagnostics.',
      inputSchema: flowRunsSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('List Flow Runs'),
    },
    async ({ identifier, solutionUniqueName, status, since, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.flow.runs', resolution, readOnlyPolicy());
      }

      const result = await new FlowService(resolution.data.client).runs(identifier, {
        solutionUniqueName,
        status,
        since,
      });
      return toToolResult('pp.flow.runs', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.flow.errors',
    {
      title: 'Summarize Flow Errors',
      description: 'Group one remote flow\'s recent failures by error or connection reference.',
      inputSchema: flowErrorsSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Summarize Flow Errors'),
    },
    async ({ identifier, solutionUniqueName, status, since, groupBy, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.flow.errors', resolution, readOnlyPolicy());
      }

      const result = await new FlowService(resolution.data.client).errors(identifier, {
        solutionUniqueName,
        status,
        since,
        groupBy,
      });
      return toToolResult('pp.flow.errors', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.flow.doctor',
    {
      title: 'Diagnose Flow Runtime',
      description: 'Summarize one remote flow\'s runtime blockers, connection-reference health, and next actions.',
      inputSchema: flowConnrefsSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Diagnose Flow Runtime'),
    },
    async ({ identifier, solutionUniqueName, since, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.flow.doctor', resolution, readOnlyPolicy());
      }

      const result = await new FlowService(resolution.data.client).doctor(identifier, {
        solutionUniqueName,
        since,
      });
      return toToolResult('pp.flow.doctor', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.flow.monitor',
    {
      title: 'Monitor Flow Runtime',
      description: 'Summarize one remote flow with recent run health, grouped errors, and follow-up monitoring findings.',
      inputSchema: flowMonitorSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Monitor Flow Runtime'),
    },
    async ({ identifier, solutionUniqueName, since, baseline, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.flow.monitor', resolution, readOnlyPolicy());
      }

      const normalizedBaseline = normalizeFlowMonitorBaseline(baseline);

      if (!normalizedBaseline.success) {
        return toToolResult('pp.flow.monitor', normalizedBaseline, readOnlyPolicy());
      }

      const result = await new FlowService(resolution.data.client).monitor(identifier, {
        solutionUniqueName,
        since,
        baseline: normalizedBaseline.data,
      });
      return toToolResult('pp.flow.monitor', result, readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.flow.activate',
    {
      title: 'Activate Flow',
      description: 'Attempt one bounded in-place activation for one remote flow and preserve structured blocker diagnostics when Dataverse rejects the update.',
      inputSchema: flowActivateSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Activate Flow'),
    },
    async ({ identifier, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.flow.activate',
          resolution,
          remoteMutationPolicy(
            'This tool attempts one bounded in-place activation update for one explicit remote flow in one named environment.',
            false,
          ),
        );
      }

      const result = await new FlowService(resolution.data.client).activate(identifier, {
        solutionUniqueName,
      });
      return toToolResult(
        'pp.flow.activate',
        result,
        remoteMutationPolicy(
          'This tool attempts one bounded in-place activation update for one explicit remote flow in one named environment.',
          false,
        ),
      );
    }
  );

  server.registerTool(
    'pp.flow.deploy',
    {
      title: 'Deploy Flow Artifact',
      description:
        'Create or update one remote flow from a local artifact path, including solution-scoped create-if-missing authoring plus returned workflow-state/readiness follow-up guidance and optional run-local JSON receipt output.',
      inputSchema: flowDeploySchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Deploy Flow Artifact'),
    },
    async ({ inputPath, solutionUniqueName, target, createIfMissing, workflowState, resultOutPath, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.flow.deploy',
          resolution,
          remoteMutationPolicy(
            'This tool deploys one explicit local flow artifact into one named environment, optionally creating the target inside one named solution.',
            false,
          ),
        );
      }

      const workspaceRoot = resolveProjectPath(undefined, defaults);
      const result = await new FlowService(resolution.data.client).deployArtifact(resolveWorkspacePath(inputPath, workspaceRoot), {
        solutionUniqueName,
        target,
        createIfMissing,
        workflowState,
      });
      let toolResult = toToolResult(
        'pp.flow.deploy',
        result,
        remoteMutationPolicy(
          'This tool deploys one explicit local flow artifact into one named environment, optionally creating the target inside one named solution.',
          false,
        ),
      );

      if (resultOutPath) {
        const resolvedResultPath = resolveWorkspacePath(resultOutPath, workspaceRoot);
        await mkdir(dirname(resolvedResultPath), { recursive: true });
        await writeFile(
          resolvedResultPath,
          stableStringify(toolResult.structuredContent as Record<string, unknown>) + '\n',
          'utf8',
        );
        toolResult = appendToolResultLocalWrite(toolResult, {
          kind: 'tool-result-json',
          path: resolvedResultPath,
        });
      }

      return toolResult;
    },
  );

  server.registerTool(
    'pp.flow.export',
    {
      title: 'Export Flow Artifact',
      description: 'Export one remote flow into a local artifact path for repo-local inspection or patching.',
      inputSchema: flowExportSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Export Flow Artifact'),
    },
    async ({ identifier, outPath, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.flow.export',
          resolution,
          remoteMutationPolicy('This tool exports one explicit remote flow artifact to one explicit local path.', true),
        );
      }

      const result = await new FlowService(resolution.data.client).exportArtifact(
        identifier,
        resolveWorkspacePath(outPath, resolveProjectPath(undefined, defaults)),
        {
          solutionUniqueName,
        }
      );
      return toToolResult(
        'pp.flow.export',
        result,
        remoteMutationPolicy('This tool exports one explicit remote flow artifact to one explicit local path.', true),
      );
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
      inputSchema: modelInspectSchema,
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
    'pp.model-app.create',
    {
      title: 'Create Model-Driven App',
      description: 'Create one model-driven app through the MCP mutation surface with optional solution attachment.',
      inputSchema: modelCreateSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Create Model-Driven App'),
    },
    async ({ uniqueName, name, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.model-app.create',
          resolution,
          remoteMutationPolicy(
            'This tool creates one explicit model-driven app in one named environment and can attach it to one named solution when requested.',
            false,
          ),
        );
      }

      const result = await new ModelService(resolution.data.client).create(uniqueName, {
        name,
        solutionUniqueName,
      });
      return toToolResult(
        'pp.model-app.create',
        result,
        remoteMutationPolicy(
          'This tool creates one explicit model-driven app in one named environment and can attach it to one named solution when requested.',
          false,
        ),
      );
    }
  );

  server.registerTool(
    'pp.model-app.attach',
    {
      title: 'Attach Model-Driven App',
      description: 'Attach one existing model-driven app to a solution through the MCP mutation surface.',
      inputSchema: modelAttachSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Attach Model-Driven App'),
    },
    async ({ identifier, solutionUniqueName, addRequiredComponents, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.model-app.attach',
          resolution,
          remoteMutationPolicy(
            'This tool attaches one existing model-driven app to one named solution inside one named environment.',
            false,
          ),
        );
      }

      const result = await new ModelService(resolution.data.client).attach(identifier, {
        solutionUniqueName,
        addRequiredComponents,
      });
      return toToolResult(
        'pp.model-app.attach',
        result,
        remoteMutationPolicy(
          'This tool attaches one existing model-driven app to one named solution inside one named environment.',
          false,
        ),
      );
    }
  );

  server.registerTool(
    'pp.canvas-app.inspect',
    {
      title: 'Inspect Canvas Apps',
      description: 'List remote canvas apps or inspect one canvas app within an optional solution scope.',
      inputSchema: canvasInspectSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Canvas Apps'),
    },
    async ({ identifier, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.canvas-app.inspect', resolution, readOnlyPolicy());
      }

      const service = new CanvasService(resolution.data.client);
      if (identifier) {
        return toToolResult('pp.canvas-app.inspect', await service.inspectRemote(identifier, { solutionUniqueName }), readOnlyPolicy());
      }

      return toToolResult('pp.canvas-app.inspect', await service.listRemote({ solutionUniqueName }), readOnlyPolicy());
    }
  );

  server.registerTool(
    'pp.canvas-app.access',
    {
      title: 'Inspect Canvas Access',
      description: 'Inspect ownership and explicit share state for one remote canvas app within an optional solution scope.',
      inputSchema: canvasAccessSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Canvas Access'),
    },
    async ({ identifier, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.canvas-app.access', resolution, readOnlyPolicy());
      }

      return toToolResult(
        'pp.canvas-app.access',
        await new CanvasService(resolution.data.client).accessRemote(identifier, { solutionUniqueName }),
        readOnlyPolicy()
      );
    }
  );

  server.registerTool(
    'pp.canvas-app.plan-attach',
    {
      title: 'Plan Canvas App Attach',
      description: 'Preview one remote canvas app attach against a target solution without mutating Dataverse.',
      inputSchema: canvasAttachPlanSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Plan Canvas App Attach'),
    },
    async ({ identifier, solutionUniqueName, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult('pp.canvas-app.plan-attach', resolution, readOnlyPolicy());
      }

      return toToolResult(
        'pp.canvas-app.plan-attach',
        await new CanvasService(resolution.data.client).planRemoteAttach(identifier, {
          solutionUniqueName,
        }),
        readOnlyPolicy()
      );
    }
  );

  server.registerTool(
    'pp.canvas-app.attach',
    {
      title: 'Attach Canvas App',
      description: 'Attach one remote canvas app to a solution and summarize the resulting solution impact.',
      inputSchema: canvasAttachSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Attach Canvas App'),
    },
    async ({ identifier, solutionUniqueName, addRequiredComponents, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.canvas-app.attach',
          resolution,
          remoteMutationPolicy(
            'This tool performs one bounded Dataverse solution attach for one explicit remote canvas app and returns the post-attach solution impact readback.',
            false,
          ),
        );
      }

      const result = await new CanvasService(resolution.data.client).attachRemote(identifier, {
        solutionUniqueName,
        addRequiredComponents,
      });
      return toToolResult(
        'pp.canvas-app.attach',
        result,
        remoteMutationPolicy(
          'This tool performs one bounded Dataverse solution attach for one explicit remote canvas app and returns the post-attach solution impact readback.',
          false,
        ),
      );
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
    async ({ projectPath, stage, environmentAlias }) => {
      const result = await discoverProject(resolveProjectPath(projectPath, defaults), {
        stage,
        environment: process.env,
      });
      if (!result.success || !result.data) {
        return toToolResult('pp.project.inspect', result, readOnlyPolicy());
      }
      const configOptions = readConfigOptions(undefined, defaults);
      const targetComparison = environmentAlias
        ? await compareProjectRuntimeTarget(result.data, environmentAlias, configOptions)
        : undefined;
      return toToolResult(
        'pp.project.inspect',
        ok(
          {
            summary: summarizeProject(result.data),
            contract: summarizeProjectContract(result.data),
            targetComparison,
            ...result.data,
          },
          {
            diagnostics: result.diagnostics,
            warnings: result.warnings,
            supportTier: result.supportTier,
            suggestedNextActions: result.suggestedNextActions,
            provenance: result.provenance,
            knownLimitations: result.knownLimitations,
          }
        ),
        readOnlyPolicy()
      );
    }
  );

  server.registerTool(
    'pp.project.doctor',
    {
      title: 'Doctor Project',
      description: 'Validate the local project layout and expose the canonical stage-to-bundle route in structured form.',
      inputSchema: projectScopeSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Doctor Project'),
    },
    async ({ projectPath, stage, environmentAlias }) => {
      const resolvedProjectPath = resolveProjectPath(projectPath, defaults);
      const result = await doctorProject(resolvedProjectPath, {
        stage,
        environment: process.env,
      });
      if (!result.success || !result.data) {
        return toToolResult('pp.project.doctor', result, readOnlyPolicy());
      }

      const project =
        environmentAlias !== undefined
          ? await discoverProject(resolvedProjectPath, {
              stage,
              environment: process.env,
            })
          : undefined;
      const targetComparison =
        environmentAlias && project?.success && project.data
          ? await compareProjectRuntimeTarget(project.data, environmentAlias, readConfigOptions(undefined, defaults))
          : undefined;

      return toToolResult(
        'pp.project.doctor',
        ok(
          {
            ...result.data,
            targetComparison,
          },
          {
            diagnostics: result.diagnostics,
            warnings: result.warnings,
            supportTier: result.supportTier,
            suggestedNextActions: result.suggestedNextActions,
            provenance: result.provenance,
            knownLimitations: result.knownLimitations,
          }
        ),
        readOnlyPolicy()
      );
    }
  );

  server.registerTool(
    'pp.project.feedback',
    {
      title: 'Project Feedback',
      description: 'Capture conceptual feedback about the local project structure without leaving the MCP surface.',
      inputSchema: projectScopeSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Project Feedback'),
    },
    async ({ projectPath, stage, environmentAlias }) => {
      const resolvedProjectPath = resolveProjectPath(projectPath, defaults);
      const result = await feedbackProject(resolvedProjectPath, {
        stage,
        environment: process.env,
      });
      if (!result.success || !result.data) {
        return toToolResult('pp.project.feedback', result, readOnlyPolicy());
      }

      const project =
        environmentAlias !== undefined
          ? await discoverProject(resolvedProjectPath, {
              stage,
              environment: process.env,
            })
          : undefined;
      const targetComparison =
        environmentAlias && project?.success && project.data
          ? await compareProjectRuntimeTarget(project.data, environmentAlias, readConfigOptions(undefined, defaults))
          : undefined;

      return toToolResult(
        'pp.project.feedback',
        ok(
          {
            ...result.data,
            targetComparison,
          },
          {
            diagnostics: result.diagnostics,
            warnings: result.warnings,
            supportTier: result.supportTier,
            suggestedNextActions: result.suggestedNextActions,
            provenance: result.provenance,
            knownLimitations: result.knownLimitations,
          }
        ),
        readOnlyPolicy()
      );
    }
  );

  server.registerTool(
    'pp.canvas-app.download',
    {
      title: 'Download Canvas App',
      description: 'Download one remote canvas app as an `.msapp` artifact with optional extracted source output.',
      inputSchema: canvasDownloadSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Download Canvas App'),
    },
    async ({ identifier, solutionUniqueName, outPath, extractToDirectory, ...args }) => {
      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.canvas-app.download',
          resolution,
          remoteMutationPolicy(
            'This tool exports one remote canvas app through its containing solution and writes one `.msapp` artifact plus optional extracted source to explicit local paths.',
            Boolean(outPath || extractToDirectory),
          ),
        );
      }

      const workspaceRoot = resolveProjectPath(undefined, defaults);
      const result = await new CanvasService(resolution.data.client).downloadRemote(identifier, {
        solutionUniqueName,
        outPath: outPath ? resolveWorkspacePath(outPath, workspaceRoot) : undefined,
        extractToDirectory: extractToDirectory ? resolveWorkspacePath(extractToDirectory, workspaceRoot) : undefined,
      });
      return toToolResult(
        'pp.canvas-app.download',
        result,
        remoteMutationPolicy(
          'This tool exports one remote canvas app through its containing solution and writes one `.msapp` artifact plus optional extracted source to explicit local paths.',
          Boolean(outPath || extractToDirectory),
        ),
      );
    }
  );

  server.registerTool(
    'pp.canvas-app.import',
    {
      title: 'Import Canvas App',
      description: 'Replace one remote canvas app inside a named solution from one explicit local `.msapp` artifact.',
      inputSchema: canvasImportSchema,
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Import Canvas App'),
    },
    async ({ identifier, solutionUniqueName, importPath, publishWorkflows, overwriteUnmanagedCustomizations, ...args }) => {
      if (!solutionUniqueName) {
        throw new Error('pp.canvas-app.import requires solutionUniqueName');
      }

      const resolution = await resolveRemoteRuntime(args, defaults);

      if (!resolution.success || !resolution.data) {
        return toToolResult(
          'pp.canvas-app.import',
          resolution,
          remoteMutationPolicy(
            'This tool replaces one explicit remote canvas app inside one named solution from one explicit local `.msapp` artifact.',
            true,
          ),
        );
      }

      const workspaceRoot = resolveProjectPath(undefined, defaults);
      const result = await new CanvasService(resolution.data.client).importRemote(identifier, {
        solutionUniqueName,
        importPath: resolveWorkspacePath(importPath, workspaceRoot),
        publishWorkflows,
        overwriteUnmanagedCustomizations,
      });
      return toToolResult(
        'pp.canvas-app.import',
        result,
        remoteMutationPolicy(
          'This tool replaces one explicit remote canvas app inside one named solution from one explicit local `.msapp` artifact.',
          true,
        ),
      );
    }
  );

  server.registerTool(
    'pp.init.start',
    {
      title: 'Start Init Session',
      description: 'Start a guided, resumable pp init session rooted at the selected project path.',
      inputSchema: initAnswerSchema.extend({
        projectPath: z.string().min(1).optional(),
        configDir: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Start Init Session'),
    },
    async ({ projectPath, configDir, ...answers }) =>
      toToolResult(
        'pp.init.start',
        await startInitSession(
          {
            root: resolveProjectPath(projectPath, defaults),
            ...(answers as Partial<InitSessionAnswers>),
          },
          readConfigOptions(configDir, defaults)
        ),
        localMutationPolicy()
      )
  );

  server.registerTool(
    'pp.init.status',
    {
      title: 'Inspect Init Session',
      description: 'Inspect the current state of a persisted pp init session.',
      inputSchema: z.object({
        sessionId: z.string().uuid(),
        configDir: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: readOnlyAnnotations('Inspect Init Session'),
    },
    async ({ sessionId, configDir }) =>
      toToolResult('pp.init.status', await getInitSession(sessionId, readConfigOptions(configDir, defaults)), readOnlyPolicy())
  );

  server.registerTool(
    'pp.init.answer',
    {
      title: 'Answer Init Session',
      description: 'Apply one or more user answers to a persisted pp init session.',
      inputSchema: z.object({
        sessionId: z.string().uuid(),
        configDir: z.string().min(1).optional(),
        answers: initAnswerSchema,
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Answer Init Session'),
    },
    async ({ sessionId, configDir, answers }) =>
      toToolResult('pp.init.answer', await resumeInitSession(sessionId, { answers }, readConfigOptions(configDir, defaults)), localMutationPolicy())
  );

  server.registerTool(
    'pp.init.resume',
    {
      title: 'Resume Init Session',
      description: 'Resume a persisted pp init session after an external step completes.',
      inputSchema: z.object({
        sessionId: z.string().uuid(),
        configDir: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Resume Init Session'),
    },
    async ({ sessionId, configDir }) =>
      toToolResult('pp.init.resume', await resumeInitSession(sessionId, {}, readConfigOptions(configDir, defaults)), localMutationPolicy())
  );

  server.registerTool(
    'pp.init.cancel',
    {
      title: 'Cancel Init Session',
      description: 'Cancel a persisted pp init session.',
      inputSchema: z.object({
        sessionId: z.string().uuid(),
        configDir: z.string().min(1).optional(),
      }),
      outputSchema: outputEnvelopeSchema,
      annotations: controlledMutationAnnotations('Cancel Init Session'),
    },
    async ({ sessionId, configDir }) =>
      toToolResult('pp.init.cancel', await cancelInitSession(sessionId, readConfigOptions(configDir, defaults)), localMutationPolicy())
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
    async ({ projectPath, stage, focusAsset, environmentAlias }) => {
      const project = await discoverProject(resolveProjectPath(projectPath, defaults), {
        stage,
        environment: process.env,
      });

      if (!project.success || !project.data) {
        return toToolResult('pp.analysis.context', project, readOnlyPolicy());
      }

      const result = generateContextPack(project.data, focusAsset);
      if (!result.success || !result.data) {
        return toToolResult('pp.analysis.context', result, readOnlyPolicy());
      }

      const targetComparison = environmentAlias
        ? await compareProjectRuntimeTarget(project.data, environmentAlias, readConfigOptions(undefined, defaults))
        : undefined;

      return toToolResult(
        'pp.analysis.context',
        ok(
          {
            ...result.data,
            targetComparison,
          },
          {
            diagnostics: result.diagnostics,
            warnings: result.warnings,
            supportTier: result.supportTier,
            suggestedNextActions: result.suggestedNextActions,
            provenance: result.provenance,
            knownLimitations: result.knownLimitations,
          }
        ),
        readOnlyPolicy()
      );
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

function resolveWorkspacePath(targetPath: string, workspaceRoot: string): string {
  return resolve(workspaceRoot, targetPath);
}

async function readMetadataApplyPlan(manifestPath: string): Promise<OperationResult<MetadataApplyPlan>> {
  const manifest = await readStructuredSpecFile(manifestPath);

  if (!manifest.success || manifest.data === undefined) {
    return manifest as OperationResult<MetadataApplyPlan>;
  }

  if (!isRecord(manifest.data)) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_INVALID', 'Structured spec files must parse to an object.', {
        source: '@pp/mcp',
        path: manifestPath,
      }),
    );
  }

  const operationsValue = manifest.data.operations;

  if (!Array.isArray(operationsValue) || operationsValue.length === 0) {
    return fail(
      createDiagnostic('error', 'DV_METADATA_APPLY_OPERATIONS_REQUIRED', 'Metadata apply manifests require a non-empty operations array.', {
        source: '@pp/mcp',
        path: manifestPath,
      }),
    );
  }

  const loadedOperations: unknown[] = [];

  for (let index = 0; index < operationsValue.length; index += 1) {
    const entry = operationsValue[index];

    if (!isRecord(entry)) {
      return fail(
        createDiagnostic('error', 'DV_METADATA_APPLY_OPERATION_INVALID', `Operation ${index + 1} must be an object.`, {
          source: '@pp/mcp',
          path: manifestPath,
        }),
      );
    }

    const kind = typeof entry.kind === 'string' ? entry.kind : undefined;
    const specFile = typeof entry.file === 'string' ? entry.file : undefined;

    if (!kind || !specFile) {
      return fail(
        createDiagnostic('error', 'DV_METADATA_APPLY_OPERATION_INVALID', `Operation ${index + 1} must include string values for kind and file.`, {
          source: '@pp/mcp',
          path: manifestPath,
        }),
      );
    }

    const childPath = resolve(dirname(manifestPath), specFile);
    const childSpec = await readStructuredSpecFile(childPath);

    if (!childSpec.success || childSpec.data === undefined) {
      return childSpec as unknown as OperationResult<MetadataApplyPlan>;
    }

    switch (kind) {
      case 'create-table': {
        const spec = parseTableCreateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-table': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;
        if (!tableLogicalName) {
          return fail(
            createDiagnostic('error', 'DV_METADATA_APPLY_TABLE_REQUIRED', `Operation ${index + 1} must include tableLogicalName for update-table.`, {
              source: '@pp/mcp',
              path: manifestPath,
            }),
          );
        }
        const spec = parseTableUpdateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, tableLogicalName, spec: spec.data });
        break;
      }
      case 'add-column': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;
        if (!tableLogicalName) {
          return fail(
            createDiagnostic('error', 'DV_METADATA_APPLY_TABLE_REQUIRED', `Operation ${index + 1} must include tableLogicalName for add-column.`, {
              source: '@pp/mcp',
              path: manifestPath,
            }),
          );
        }
        const spec = parseColumnCreateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, tableLogicalName, spec: spec.data });
        break;
      }
      case 'update-column': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;
        const columnLogicalName = typeof entry.columnLogicalName === 'string' ? entry.columnLogicalName : undefined;
        if (!tableLogicalName || !columnLogicalName) {
          return fail(
            createDiagnostic('error', 'DV_METADATA_APPLY_COLUMN_REQUIRED', `Operation ${index + 1} must include tableLogicalName and columnLogicalName for update-column.`, {
              source: '@pp/mcp',
              path: manifestPath,
            }),
          );
        }
        const spec = parseColumnUpdateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, tableLogicalName, columnLogicalName, spec: spec.data });
        break;
      }
      case 'create-option-set': {
        const spec = parseGlobalOptionSetCreateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-option-set': {
        const spec = parseGlobalOptionSetUpdateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'create-relationship': {
        const spec = parseOneToManyRelationshipCreateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-relationship': {
        const schemaName = typeof entry.schemaName === 'string' ? entry.schemaName : undefined;
        const relationshipKind =
          entry.relationshipKind === 'one-to-many' || entry.relationshipKind === 'many-to-many'
            ? entry.relationshipKind
            : undefined;
        if (!schemaName || !relationshipKind) {
          return fail(
            createDiagnostic('error', 'DV_METADATA_APPLY_RELATIONSHIP_REQUIRED', `Operation ${index + 1} must include schemaName and relationshipKind for update-relationship.`, {
              source: '@pp/mcp',
              path: manifestPath,
            }),
          );
        }
        const spec =
          relationshipKind === 'one-to-many'
            ? parseOneToManyRelationshipUpdateSpec(childSpec.data)
            : parseManyToManyRelationshipUpdateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, schemaName, relationshipKind, spec: spec.data });
        break;
      }
      case 'create-many-to-many': {
        const spec = parseManyToManyRelationshipCreateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'create-customer-relationship': {
        const spec = parseCustomerRelationshipCreateSpec(childSpec.data);
        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }
        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      default:
        return fail(
          createDiagnostic('error', 'DV_METADATA_APPLY_KIND_INVALID', `Unsupported metadata apply kind ${kind}.`, {
            source: '@pp/mcp',
            path: manifestPath,
          }),
        );
    }
  }

  return parseMetadataApplyPlan({ operations: loadedOperations });
}

function orderMetadataApplyPlanForMcp(plan: MetadataApplyPlan): MetadataApplyPlan {
  const precedence: Record<MetadataApplyPlan['operations'][number]['kind'], number> = {
    'create-option-set': 10,
    'update-option-set': 20,
    'create-table': 30,
    'update-table': 40,
    'add-column': 50,
    'update-column': 60,
    'create-relationship': 70,
    'update-relationship': 80,
    'create-many-to-many': 90,
    'create-customer-relationship': 100,
  };

  return {
    operations: [...plan.operations].sort((left, right) => precedence[left.kind] - precedence[right.kind]),
  };
}

function summarizeMetadataApplyPlanKinds(plan: MetadataApplyPlan): Partial<Record<MetadataApplyPlan['operations'][number]['kind'], number>> {
  const counts: Partial<Record<MetadataApplyPlan['operations'][number]['kind'], number>> = {};

  for (const operation of plan.operations) {
    counts[operation.kind] = (counts[operation.kind] ?? 0) + 1;
  }

  return counts;
}

async function readStructuredSpecFile(path: string): Promise<OperationResult<unknown>> {
  try {
    const contents = await readFile(path, 'utf8');
    const parsed = parseStructuredText(contents, path);

    if (!parsed.success || parsed.data === undefined) {
      return parsed;
    }

    if (!isRecord(parsed.data)) {
      return fail(
        createDiagnostic('error', 'CLI_SPEC_INVALID', 'Structured spec files must parse to an object.', {
          source: '@pp/mcp',
          path,
        }),
      );
    }

    return parsed;
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_READ_FAILED', 'Failed to read structured spec file.', {
        source: '@pp/mcp',
        path,
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function parseStructuredText(contents: string, sourcePath: string): OperationResult<unknown> {
  try {
    const trimmed = contents.trim();
    const lowerPath = sourcePath.toLowerCase();
    const data =
      lowerPath.endsWith('.json')
        ? JSON.parse(trimmed)
        : lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')
          ? YAML.parse(contents)
          : tryParseJsonOrYaml(contents);

    return ok(data, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_PARSE_FAILED', 'Failed to parse structured spec file as JSON or YAML.', {
        source: '@pp/mcp',
        path: sourcePath,
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function tryParseJsonOrYaml(contents: string): unknown {
  const trimmed = contents.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    return YAML.parse(contents);
  }
}

function normalizeFlowMonitorBaseline(value: unknown): OperationResult<FlowMonitorReport | undefined> {
  if (value === undefined) {
    return ok(undefined, {
      supportTier: 'preview',
    });
  }

  if (isFlowMonitorReport(value)) {
    return ok(value, {
      supportTier: 'preview',
    });
  }

  if (isRecord(value) && isFlowMonitorReport(value.data)) {
    return ok(value.data, {
      supportTier: 'preview',
    });
  }

  return fail(
    createDiagnostic(
      'error',
      'FLOW_MONITOR_BASELINE_INVALID',
      'pp.flow.monitor baseline must be a prior monitor report object or the saved MCP/CLI success payload that contains one.',
      {
        source: '@pp/mcp',
      }
    )
  );
}

function isFlowMonitorReport(value: unknown): value is FlowMonitorReport {
  return (
    isRecord(value) &&
    typeof value.checkedAt === 'string' &&
    isRecord(value.health) &&
    typeof value.health.status === 'string' &&
    typeof value.health.telemetryState === 'string' &&
    isRecord(value.recentRuns) &&
    typeof value.recentRuns.total === 'number' &&
    typeof value.recentRuns.failed === 'number' &&
    Array.isArray(value.errorGroups) &&
    Array.isArray(value.findings)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

export async function buildEnvironmentCleanupPlan(
  args: RemoteToolArgs & { prefix: string },
  defaults: PpMcpServerOptions = {}
): Promise<OperationResult<EnvironmentCleanupPlanResult>> {
  const allowInteractiveAuth = args.allowInteractiveAuth ?? defaults.allowInteractiveAuth ?? false;
  const resolution = await resolveDataverseClient(args.environment, {
    ...readConfigOptions(args.configDir, defaults),
    publicClientLoginOptions: {
      allowInteractive: allowInteractiveAuth,
    },
  });

  if (!resolution.success || !resolution.data) {
    return resolution as unknown as OperationResult<EnvironmentCleanupPlanResult>;
  }

  const prefix = args.prefix.trim();
  const solutions = await new SolutionService(resolution.data.client).list({ prefix });

  if (!solutions.success) {
    return solutions as unknown as OperationResult<EnvironmentCleanupPlanResult>;
  }

  const cleanupCandidates = (solutions.data ?? []).map((solution) => ({
    solutionid: solution.solutionid,
    uniquename: solution.uniquename,
    friendlyname: solution.friendlyname,
    version: solution.version,
    ismanaged: solution.ismanaged,
  }));
  const assetCandidates = await listEnvironmentCleanupAssetCandidates(resolution.data.client, prefix, cleanupCandidates);
  if (!assetCandidates.success || !assetCandidates.data) {
    return assetCandidates as unknown as OperationResult<EnvironmentCleanupPlanResult>;
  }
  const solutionCandidateCount = cleanupCandidates.length;
  const assetCandidateCount = assetCandidates.data.length;
  const candidateCount = solutionCandidateCount + assetCandidateCount;

  return ok(
    {
      environment: {
        alias: resolution.data.environment.alias,
        url: resolution.data.environment.url,
        authProfile: resolution.data.authProfile.name,
        defaultSolution: resolution.data.environment.defaultSolution,
        makerEnvironmentId: resolution.data.environment.makerEnvironmentId,
      },
      prefix,
      matchStrategy: {
        kind: 'case-insensitive-prefix',
        fields: ['uniquename', 'friendlyname', 'name', 'displayname', 'schemaname', 'connectionreferencelogicalname'],
      },
      remoteResetSupported: true,
      cleanupCandidates,
      assetCandidates: assetCandidates.data,
      candidateCount,
      solutionCandidateCount,
      assetCandidateCount,
      candidateSummary: summarizeCleanupCandidates(cleanupCandidates, assetCandidates.data),
    },
    {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(solutions.diagnostics, assetCandidates.diagnostics),
      warnings: mergeDiagnosticLists(solutions.warnings, assetCandidates.warnings),
      suggestedNextActions:
        candidateCount > 0
          ? [
              'Review the matching disposable assets before deleting anything remotely.',
              `Call pp.environment.cleanup with environment ${resolution.data.environment.alias}, prefix ${prefix}, and mode dry-run to preview the bounded cleanup result.`,
              `Call pp.environment.cleanup with environment ${resolution.data.environment.alias}, prefix ${prefix}, and mode apply to delete the listed disposable solutions and orphaned prefixed assets through MCP.`,
            ]
          : [
              'No matching disposable solutions or orphaned prefixed assets were found for this prefix.',
              'Proceed with bootstrap using the same prefix or choose a new run-scoped prefix if you still want quarantine semantics.',
            ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse solutions',
        },
        {
          kind: 'inferred',
          source: '@pp/mcp environment cleanup',
          detail:
            'Cleanup candidates are filtered by a case-insensitive prefix match across solution, app, flow, connection reference, and environment variable naming fields. Assets already contained in a matched disposable solution are not duplicated as direct-delete candidates.',
        },
      ],
      knownLimitations: [
        'This bounded cleanup covers disposable solutions plus orphaned prefixed canvas apps, cloud flows, model-driven apps, connection references, and environment variable definitions. Other prefixed asset classes still need their own cleanup surface.',
      ],
    }
  );
}

export async function compareSolutionAcrossEnvironments(
  args: {
    uniqueName: string;
    sourceEnvironment: string;
    targetEnvironment: string;
    includeModelComposition?: boolean;
    configDir?: string;
    allowInteractiveAuth?: boolean;
  },
  defaults: PpMcpServerOptions = {}
): Promise<OperationResult<SolutionCompareToolResult>> {
  const sourceResolution = await resolveRemoteRuntime(
    {
      environment: args.sourceEnvironment,
      configDir: args.configDir,
      allowInteractiveAuth: args.allowInteractiveAuth,
    },
    defaults,
  );
  if (!sourceResolution.success || !sourceResolution.data) {
    return sourceResolution as unknown as OperationResult<SolutionCompareToolResult>;
  }

  const targetResolution = await resolveRemoteRuntime(
    {
      environment: args.targetEnvironment,
      configDir: args.configDir,
      allowInteractiveAuth: args.allowInteractiveAuth,
    },
    defaults,
  );
  if (!targetResolution.success || !targetResolution.data) {
    return targetResolution as unknown as OperationResult<SolutionCompareToolResult>;
  }

  const sourceService = new SolutionService(sourceResolution.data.client);
  const targetService = new SolutionService(targetResolution.data.client);
  const [sourceAnalysis, targetAnalysis] = await Promise.all([
    sourceService.analyze(args.uniqueName, {
      includeModelComposition: args.includeModelComposition,
    }),
    targetService.analyze(args.uniqueName, {
      includeModelComposition: args.includeModelComposition,
    }),
  ]);

  if (!sourceAnalysis.success) {
    return sourceAnalysis as unknown as OperationResult<SolutionCompareToolResult>;
  }
  const targetMissing = isSolutionNotFoundResult(targetAnalysis);
  if (!targetAnalysis.success && !targetMissing) {
    return targetAnalysis as unknown as OperationResult<SolutionCompareToolResult>;
  }
  if (!sourceAnalysis.data) {
    return fail(
      [
        ...sourceAnalysis.diagnostics,
        createDiagnostic(
          'error',
          'SOLUTION_NOT_FOUND',
          `Solution ${args.uniqueName} was not found in environment ${args.sourceEnvironment}.`,
          { source: '@pp/mcp' },
        ),
      ],
      {
        supportTier: 'preview',
        warnings: mergeDiagnosticLists(sourceAnalysis.warnings, targetAnalysis.warnings),
      },
    );
  }

  const compare =
    targetAnalysis.success && targetAnalysis.data
      ? sourceService.compareLocal(args.uniqueName, sourceAnalysis.data, targetAnalysis.data)
      : ok(
          {
            uniqueName: args.uniqueName,
            source: sourceAnalysis.data,
            drift: {
              versionChanged: false,
              componentsOnlyInSource: sourceAnalysis.data.components,
              componentsOnlyInTarget: [],
              artifactsOnlyInSource: sourceAnalysis.data.artifacts,
              artifactsOnlyInTarget: [],
              changedArtifacts: [],
              modelDriven: {
                appsOnlyInSource: sourceAnalysis.data.modelDriven.apps,
                appsOnlyInTarget: [],
                changedApps: [],
              },
            },
            missingDependencies: {
              source: sourceAnalysis.data.dependencies,
              target: [],
            },
            missingConfig: {
              invalidConnectionReferences: {
                source: sourceAnalysis.data.invalidConnectionReferences,
                target: [],
              },
              environmentVariablesMissingValues: {
                source: sourceAnalysis.data.missingEnvironmentVariables,
                target: [],
              },
            },
          },
          {
            supportTier: 'preview',
          },
        );
  if (!compare.success || !compare.data) {
    return compare as unknown as OperationResult<SolutionCompareToolResult>;
  }

  const targetPresent = Boolean(targetAnalysis.success && targetAnalysis.data);
  return ok(
    {
      uniqueName: args.uniqueName,
      sourceEnvironment: args.sourceEnvironment,
      targetEnvironment: args.targetEnvironment,
      compare: compare.data,
      installState: {
        sourcePresent: true,
        targetPresent,
      },
    },
    {
      diagnostics: mergeDiagnosticLists(
        sourceAnalysis.diagnostics,
        targetPresent ? targetAnalysis.diagnostics : undefined,
        compare.diagnostics,
      ),
      warnings: mergeDiagnosticLists(sourceAnalysis.warnings, targetAnalysis.warnings, compare.warnings),
      supportTier: 'preview',
      suggestedNextActions: targetPresent
        ? [
            `Call pp.solution.compare again with sourceEnvironment ${args.sourceEnvironment} and targetEnvironment ${args.targetEnvironment} after additional promotion changes if you need an updated drift snapshot.`,
          ]
        : [
            `Solution ${args.uniqueName} is present in ${args.sourceEnvironment} but absent from ${args.targetEnvironment}; use this install-state drift as the compare result instead of treating the compare as a terminal failure.`,
            `If you expected ${args.uniqueName} to be installed in ${args.targetEnvironment}, re-run the promotion/import workflow and then call pp.solution.compare again.`,
          ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse solution analysis',
        },
      ],
      knownLimitations: targetPresent
        ? compare.knownLimitations
        : [
            ...(compare.knownLimitations ?? []),
            'When the target environment does not contain the solution, compare returns structured install-state drift with targetPresent=false instead of a terminal not-found failure.',
          ],
    },
  );
}

function isSolutionNotFoundResult(result: OperationResult<unknown>): boolean {
  return !result.success && result.diagnostics.some((diagnostic) => diagnostic.code === 'SOLUTION_NOT_FOUND');
}

export async function executeEnvironmentCleanup(
  args: RemoteToolArgs & { prefix: string; mode?: 'dry-run' | 'apply' },
  defaults: PpMcpServerOptions = {}
): Promise<OperationResult<EnvironmentCleanupExecutionResult>> {
  const plan = await buildEnvironmentCleanupPlan(args, defaults);

  if (!plan.success || !plan.data) {
    return plan as unknown as OperationResult<EnvironmentCleanupExecutionResult>;
  }

  const planData = plan.data;
  const mode = args.mode ?? 'apply';
  const baseResult: EnvironmentCleanupExecutionResult = {
    mode,
    environment: planData.environment,
    prefix: planData.prefix,
    candidateCount: planData.candidateCount,
    solutionCandidateCount: planData.solutionCandidateCount,
    assetCandidateCount: planData.assetCandidateCount,
    deletedCount: 0,
    failedCount: 0,
    cleanupCandidates: planData.cleanupCandidates,
    assetCandidates: planData.assetCandidates,
    deletedSolutions: [],
    deletedAssets: [],
    failures: [],
    verification: {
      planTool: 'pp.environment.cleanup-plan',
      cleanupTool: 'pp.environment.cleanup',
      inspectTool: 'pp.solution.inspect',
    },
  };

  if (mode === 'dry-run') {
    return ok(baseResult, {
      supportTier: 'preview',
      diagnostics: plan.diagnostics,
      warnings: plan.warnings,
      suggestedNextActions:
        planData.candidateCount > 0
          ? [
              `Call pp.environment.cleanup with environment ${planData.environment.alias}, prefix ${planData.prefix}, and mode apply to delete the listed disposable solutions and orphaned prefixed assets.`,
              `Call pp.environment.cleanup-plan with environment ${planData.environment.alias} and prefix ${planData.prefix} after apply to confirm the environment is clean before bootstrap.`,
            ]
          : ['No cleanup apply step is needed because no matching disposable solutions were found.'],
      provenance: plan.provenance,
      knownLimitations: plan.knownLimitations,
    });
  }

  const resolution = await resolveRemoteRuntime(args, defaults);

  if (!resolution.success || !resolution.data) {
    return resolution as unknown as OperationResult<EnvironmentCleanupExecutionResult>;
  }

  const service = new SolutionService(resolution.data.client);
  const deletedSolutions: EnvironmentCleanupExecutionResult['deletedSolutions'] = [];
  const deletedAssets: EnvironmentCleanupExecutionResult['deletedAssets'] = [];
  const failures: EnvironmentCleanupExecutionResult['failures'] = [];
  const warnings: Diagnostic[] = [...plan.warnings];

  for (const candidate of planData.assetCandidates) {
    const result = await resolution.data.client.delete(candidate.table, candidate.id);

    if (!result.success) {
      failures.push({
        candidate,
        diagnostics: result.diagnostics,
      });
      continue;
    }

    deletedAssets.push({
      removed: true,
      asset: candidate,
    });
  }

  for (const candidate of planData.cleanupCandidates) {
    const result = await service.delete(candidate.uniquename);
    warnings.push(...result.warnings);

    if (!result.success || !result.data) {
      failures.push({
        candidate,
        diagnostics: result.diagnostics,
      });
      continue;
    }

    deletedSolutions.push({
      removed: result.data.removed,
      solution: {
        solutionid: result.data.solution.solutionid,
        uniquename: result.data.solution.uniquename,
        friendlyname: result.data.solution.friendlyname,
        version: result.data.solution.version,
        ismanaged: result.data.solution.ismanaged,
      },
    });
  }

  const summary: EnvironmentCleanupExecutionResult = {
    ...baseResult,
    deletedCount: deletedSolutions.length + deletedAssets.length,
    failedCount: failures.length,
    deletedSolutions,
    deletedAssets,
    failures,
  };

  if (failures.length > 0) {
    return fail(failures.flatMap((failure) => failure.diagnostics), {
      details: summary,
      warnings,
      supportTier: 'preview',
      suggestedNextActions: [
        'Inspect the failing cleanup diagnostics to see whether dependencies, managed-state restrictions, or table-specific delete rules blocked deletion.',
        `Call pp.environment.cleanup-plan with environment ${planData.environment.alias} and prefix ${planData.prefix} to confirm which disposable assets remain after the attempted cleanup.`,
      ],
      provenance: plan.provenance,
      knownLimitations: plan.knownLimitations,
    });
  }

  return ok(summary, {
    supportTier: 'preview',
    diagnostics: plan.diagnostics,
    warnings,
    suggestedNextActions: [
      `Call pp.environment.cleanup-plan with environment ${planData.environment.alias} and prefix ${planData.prefix} to confirm the environment is clean before bootstrap.`,
      ...deletedSolutions.map(
        (entry) =>
          `If you need an authoritative completion check for ${entry.solution.uniquename}, call pp.solution.inspect with environment ${planData.environment.alias} and uniqueName ${entry.solution.uniquename} until it reports a not-found path.`,
      ),
    ],
    provenance: plan.provenance,
    knownLimitations: plan.knownLimitations,
  });
}

async function listEnvironmentCleanupAssetCandidates(
  client: DataverseClient,
  prefix: string,
  cleanupCandidates: EnvironmentCleanupCandidate[]
): Promise<OperationResult<EnvironmentCleanupAssetCandidate[]>> {
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (!normalizedPrefix) {
    return ok([], {
      supportTier: 'preview',
    });
  }

  const containedIds = await listContainedCleanupAssetIds(client, cleanupCandidates);
  if (!containedIds.success || !containedIds.data) {
    return containedIds as unknown as OperationResult<EnvironmentCleanupAssetCandidate[]>;
  }
  const containedAssetIds = containedIds.data;

  const [canvasApps, flows, modelApps, connectionReferences, environmentVariables] = await Promise.all([
    new CanvasService(client).listRemote(),
    new FlowService(client).list(),
    new ModelService(client).list(),
    new ConnectionReferenceService(client).list(),
    new EnvironmentVariableService(client).list(),
  ]);

  const diagnostics = mergeDiagnosticLists(
    canvasApps.diagnostics,
    flows.diagnostics,
    modelApps.diagnostics,
    connectionReferences.diagnostics,
    environmentVariables.diagnostics,
    containedIds.diagnostics
  );
  const warnings = mergeDiagnosticLists(
    canvasApps.warnings,
    flows.warnings,
    modelApps.warnings,
    connectionReferences.warnings,
    environmentVariables.warnings,
    containedIds.warnings
  );

  if (!canvasApps.success) {
    return canvasApps as unknown as OperationResult<EnvironmentCleanupAssetCandidate[]>;
  }
  if (!flows.success) {
    return flows as unknown as OperationResult<EnvironmentCleanupAssetCandidate[]>;
  }
  if (!modelApps.success) {
    return modelApps as unknown as OperationResult<EnvironmentCleanupAssetCandidate[]>;
  }
  if (!connectionReferences.success) {
    return connectionReferences as unknown as OperationResult<EnvironmentCleanupAssetCandidate[]>;
  }
  if (!environmentVariables.success) {
    return environmentVariables as unknown as OperationResult<EnvironmentCleanupAssetCandidate[]>;
  }

  const candidates: EnvironmentCleanupAssetCandidate[] = [
    ...(canvasApps.data ?? [])
      .filter((app) => !containedAssetIds.canvasApps.has(app.id))
      .map((app) =>
        createCleanupAssetCandidate(
          'canvas-app',
          'canvasapps',
          app.id,
          app.displayName ?? app.name ?? app.id,
          app.name,
          normalizedPrefix,
          { displayname: app.displayName, name: app.name }
        )
      )
      .filter((value): value is EnvironmentCleanupAssetCandidate => Boolean(value)),
    ...(flows.data ?? [])
      .filter((flow) => !containedAssetIds.flows.has(flow.id))
      .map((flow) =>
        createCleanupAssetCandidate(
          'cloud-flow',
          'workflows',
          flow.id,
          flow.name ?? flow.uniqueName ?? flow.id,
          flow.uniqueName,
          normalizedPrefix,
          { name: flow.name, uniquename: flow.uniqueName }
        )
      )
      .filter((value): value is EnvironmentCleanupAssetCandidate => Boolean(value)),
    ...(modelApps.data ?? [])
      .filter((app) => !containedAssetIds.modelApps.has(app.id))
      .map((app) =>
        createCleanupAssetCandidate(
          'model-app',
          'appmodules',
          app.id,
          app.name ?? app.uniqueName ?? app.id,
          app.uniqueName,
          normalizedPrefix,
          { name: app.name, uniquename: app.uniqueName }
        )
      )
      .filter((value): value is EnvironmentCleanupAssetCandidate => Boolean(value)),
    ...(connectionReferences.data ?? [])
      .filter((reference) => !containedAssetIds.connectionReferences.has(reference.id))
      .map((reference) =>
        createCleanupAssetCandidate(
          'connection-reference',
          'connectionreferences',
          reference.id,
          reference.displayName ?? reference.logicalName ?? reference.id,
          reference.logicalName,
          normalizedPrefix,
          { displayname: reference.displayName, connectionreferencelogicalname: reference.logicalName }
        )
      )
      .filter((value): value is EnvironmentCleanupAssetCandidate => Boolean(value)),
    ...(environmentVariables.data ?? [])
      .filter((variable) => !containedAssetIds.environmentVariables.has(variable.definitionId))
      .map((variable) =>
        createCleanupAssetCandidate(
          'environment-variable',
          'environmentvariabledefinitions',
          variable.definitionId,
          variable.schemaName ?? variable.displayName ?? variable.definitionId,
          variable.displayName,
          normalizedPrefix,
          { schemaname: variable.schemaName, displayname: variable.displayName }
        )
      )
      .filter((value): value is EnvironmentCleanupAssetCandidate => Boolean(value)),
  ];

  return ok(candidates.sort(compareCleanupAssetCandidates), {
    supportTier: 'preview',
    diagnostics,
    warnings: filterCleanupEnumerationWarnings(warnings),
  });
}

async function listContainedCleanupAssetIds(
  client: DataverseClient,
  cleanupCandidates: EnvironmentCleanupCandidate[]
): Promise<
  OperationResult<{
    canvasApps: Set<string>;
    flows: Set<string>;
    modelApps: Set<string>;
    connectionReferences: Set<string>;
    environmentVariables: Set<string>;
  }>
> {
  const empty = {
    canvasApps: new Set<string>(),
    flows: new Set<string>(),
    modelApps: new Set<string>(),
    connectionReferences: new Set<string>(),
    environmentVariables: new Set<string>(),
  };

  if (cleanupCandidates.length === 0) {
    return ok(empty, {
      supportTier: 'preview',
    });
  }

  const solutionIds = new Set(cleanupCandidates.map((candidate) => candidate.solutionid));
  const components = await client.queryAll<{ objectid?: string; componenttype?: number; _solutionid_value?: string }>({
    table: 'solutioncomponents',
    select: ['objectid', 'componenttype', '_solutionid_value'],
  });

  if (!components.success) {
    return components as unknown as OperationResult<typeof empty>;
  }

  for (const component of components.data ?? []) {
    if (!component.objectid || !component._solutionid_value || !solutionIds.has(component._solutionid_value)) {
      continue;
    }

    switch (component.componenttype) {
      case 300:
        empty.canvasApps.add(component.objectid);
        break;
      case 29:
        empty.flows.add(component.objectid);
        break;
      case 80:
        empty.modelApps.add(component.objectid);
        break;
      case 371:
        empty.connectionReferences.add(component.objectid);
        break;
      case 380:
        empty.environmentVariables.add(component.objectid);
        break;
      default:
        break;
    }
  }

  return ok(empty, {
    supportTier: 'preview',
    diagnostics: components.diagnostics,
    warnings: components.warnings,
  });
}

function createCleanupAssetCandidate(
  kind: EnvironmentCleanupAssetKind,
  table: EnvironmentCleanupAssetCandidate['table'],
  id: string,
  primaryName: string,
  secondaryName: string | undefined,
  normalizedPrefix: string,
  fields: Record<string, string | undefined>
): EnvironmentCleanupAssetCandidate | undefined {
  const matchedFields = Object.entries(fields)
    .filter(([, value]) => value?.toLowerCase().startsWith(normalizedPrefix))
    .map(([field]) => field);

  if (matchedFields.length === 0) {
    return undefined;
  }

  return {
    kind,
    table,
    id,
    primaryName,
    secondaryName,
    matchedFields,
  };
}

function compareCleanupAssetCandidates(left: EnvironmentCleanupAssetCandidate, right: EnvironmentCleanupAssetCandidate): number {
  const kindCompare = left.kind.localeCompare(right.kind);
  if (kindCompare !== 0) {
    return kindCompare;
  }

  return left.primaryName.localeCompare(right.primaryName);
}

function summarizeCleanupCandidates(
  cleanupCandidates: EnvironmentCleanupCandidate[],
  assetCandidates: EnvironmentCleanupAssetCandidate[]
): Record<string, number> {
  return assetCandidates.reduce<Record<string, number>>(
    (summary, candidate) => {
      summary[candidate.kind] = (summary[candidate.kind] ?? 0) + 1;
      return summary;
    },
    {
      solutions: cleanupCandidates.length,
      total: cleanupCandidates.length + assetCandidates.length,
    }
  );
}

function filterCleanupEnumerationWarnings(warnings: Diagnostic[]): Diagnostic[] {
  return warnings.filter((warning) => warning.code !== 'DATAVERSE_CONNREF_OPTIONAL_COLUMNS_UNAVAILABLE');
}

function dedupeStringArray(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function inspectAuthProfile(
  args: { name?: string; environment?: string; configDir?: string },
  defaults: PpMcpServerOptions = {}
): Promise<OperationResult<AuthProfileInspectResult>> {
  const configOptions = readConfigOptions(args.configDir, defaults);
  let profileName = args.name?.trim();
  let resolvedEnvironmentAlias: string | undefined;
  let resolvedEnvironmentUrl: string | undefined;
  const auth = new AuthService(configOptions);

  if (args.environment) {
    const environment = await getEnvironmentAlias(args.environment, configOptions);

    if (!environment.success) {
      return environment as unknown as OperationResult<AuthProfileInspectResult>;
    }

    if (!environment.data) {
      return fail(
        createDiagnostic('error', 'ENV_NOT_FOUND', `Environment alias ${args.environment} was not found.`, {
          source: '@pp/mcp',
        }),
      );
    }

    profileName = environment.data.authProfile;
    resolvedEnvironmentAlias = environment.data.alias;
    resolvedEnvironmentUrl = environment.data.url;
  }

  if (!profileName) {
    const [profiles, environments] = await Promise.all([auth.listProfiles(), listEnvironments(configOptions)]);

    if (!profiles.success) {
      return profiles as unknown as OperationResult<AuthProfileInspectResult>;
    }

    if (!environments.success) {
      return environments as unknown as OperationResult<AuthProfileInspectResult>;
    }

    const environmentAliasesByProfile = new Map<string, string[]>();
    for (const environment of environments.data ?? []) {
      const aliases = environmentAliasesByProfile.get(environment.authProfile) ?? [];
      aliases.push(environment.alias);
      aliases.sort();
      environmentAliasesByProfile.set(environment.authProfile, aliases);
    }

    const profilesSummary = (profiles.data ?? [])
      .map((profile) => ({
        name: profile.name,
        type: profile.type,
        defaultResource: profile.defaultResource,
        relationships: {
          environmentAliases: environmentAliasesByProfile.get(profile.name) ?? [],
          environmentCount: (environmentAliasesByProfile.get(profile.name) ?? []).length,
        },
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return ok(
      {
        mode: 'catalog',
        name: 'catalog',
        type: 'catalog',
        relationships: {
          environmentAliases: [],
          environmentCount: 0,
        },
        profiles: profilesSummary,
      },
      {
        supportTier: 'preview',
        diagnostics: [],
        warnings: mergeDiagnosticLists(profiles.warnings, environments.warnings),
        suggestedNextActions:
          profilesSummary.length > 0
            ? dedupeStringArray([
                'Call pp.auth-profile.inspect again with an environment alias when you want the alias-bound auth profile resolved in one step.',
                ...profilesSummary
                  .flatMap((profile) => profile.relationships.environmentAliases.slice(0, 2))
                  .map((alias) => `Call pp.auth-profile.inspect with environment ${alias} to inspect that alias binding directly.`),
                ...profilesSummary
                  .slice(0, 2)
                  .map((profile) => `Call pp.auth-profile.inspect with name ${profile.name} to inspect that auth profile directly.`),
              ])
            : ['No auth profiles were found in local pp config. Add or import one before trying to inspect remote environment bindings.'],
        provenance: [
          {
            kind: 'official-api',
            source: '@pp/config authProfiles',
          },
          {
            kind: 'official-api',
            source: '@pp/config environments',
          },
        ],
        knownLimitations: [
          'Catalog mode summarizes local pp config only; it does not prove any listed profile still has a live Dataverse token.',
        ],
      }
    );
  }

  const profile = await auth.getProfile(profileName);

  if (!profile.success) {
    return profile as unknown as OperationResult<AuthProfileInspectResult>;
  }

  if (!profile.data) {
    return fail(
      createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${profileName} was not found.`, {
        source: '@pp/mcp',
      }),
    );
  }

  const environments = await listEnvironments(configOptions);
  if (!environments.success) {
    return environments as unknown as OperationResult<AuthProfileInspectResult>;
  }

  const environmentAliases = (environments.data ?? [])
    .filter((environment) => environment.authProfile === profile.data?.name)
    .map((environment) => environment.alias)
    .sort();
  const summary = summarizeProfile(profile.data) as Omit<AuthProfileInspectResult, 'relationships'>;
  const defaultResource = typeof summary.defaultResource === 'string' ? summary.defaultResource : undefined;
  const normalizedDefaultResource = normalizeComparableUrl(defaultResource);
  const normalizedEnvironmentUrl = normalizeComparableUrl(resolvedEnvironmentUrl);

  return ok(
    {
      mode: 'profile',
      ...(resolvedEnvironmentAlias
        ? {
            ...omitAuthProfileDefaultResource(summary),
            resolvedFromEnvironment: resolvedEnvironmentAlias,
            resolvedEnvironmentUrl,
            targetResource: resolvedEnvironmentUrl,
            profileDefaultResource: defaultResource,
            defaultResourceMatchesResolvedEnvironment:
              normalizedDefaultResource && normalizedEnvironmentUrl
                ? normalizedDefaultResource === normalizedEnvironmentUrl
                : undefined,
          }
        : summary),
      relationships: {
        environmentAliases,
        environmentCount: environmentAliases.length,
      },
    },
    {
      supportTier: 'preview',
      diagnostics: profile.diagnostics,
      warnings: [...profile.warnings, ...environments.warnings],
      suggestedNextActions: [
        resolvedEnvironmentAlias
          ? `Call pp.dataverse.whoami with environment ${resolvedEnvironmentAlias} to confirm the resolved profile still has live Dataverse access.`
          : `Call pp.environment.list to see which environment aliases are bound to auth profile ${profile.data.name}.`,
        ...(resolvedEnvironmentAlias
          ? [`Call pp.solution.list with environment ${resolvedEnvironmentAlias} to capture the rest of the baseline evidence slice in-session.`]
          : []),
      ],
      provenance: [
        {
          kind: 'official-api',
          source: '@pp/config authProfiles',
        },
        {
          kind: 'inferred',
          source: '@pp/mcp auth profile inspect',
          detail: 'Environment relationships are inferred from local pp environment aliases that reference the inspected auth profile.',
        },
      ],
      knownLimitations: [
        'Auth-profile inspection is local-config evidence only; it does not prove that cached credentials are still valid until a live Dataverse call succeeds.',
      ],
    }
  );
}

export async function executeDataverseDelete(
  args: RemoteToolArgs & { table: string; id: string; ifMatch?: string },
  defaults: PpMcpServerOptions = {}
): Promise<
  OperationResult<{
    deleted: true;
    table: string;
    id: string;
    result: unknown;
  }>
> {
  const resolution = await resolveRemoteRuntime(args, defaults);

  if (!resolution.success || !resolution.data) {
    return resolution as unknown as OperationResult<{
      deleted: true;
      table: string;
      id: string;
      result: unknown;
    }>;
  }

  const result = await resolution.data.client.delete(args.table, args.id, {
    ifMatch: args.ifMatch,
  });

  if (!result.success || !result.data) {
    return result as unknown as OperationResult<{
      deleted: true;
      table: string;
      id: string;
      result: unknown;
    }>;
  }

  return ok(
    {
      deleted: true,
      table: args.table,
      id: args.id,
      result: result.data,
    },
    {
      diagnostics: result.diagnostics,
      warnings: result.warnings,
      supportTier: result.supportTier,
      suggestedNextActions: [
        `Call pp.dataverse.query with environment ${args.environment} and a filter that targets ${args.id} if you need read-side confirmation that the row is gone.`,
      ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse Web API',
        },
      ],
      knownLimitations: [
        'This tool deletes one explicit row only; broader quarantine workflows still need dedicated bounded tools for other asset classes.',
      ],
    }
  );
}

export async function executeDataverseCreate(
  args: RemoteToolArgs & {
    table: string;
    body: Record<string, unknown>;
    select?: string[];
    expand?: string[];
    includeAnnotations?: string[];
    returnRepresentation?: boolean;
    ifNoneMatch?: string;
    ifMatch?: string;
  },
  defaults: PpMcpServerOptions = {}
): Promise<
  OperationResult<{
    created: true;
    table: string;
    result: unknown;
  }>
> {
  const resolution = await resolveRemoteRuntime(args, defaults);

  if (!resolution.success || !resolution.data) {
    return resolution as unknown as OperationResult<{
      created: true;
      table: string;
      result: unknown;
    }>;
  }

  const result = await resolution.data.client.create(args.table, args.body, {
    select: args.select,
    expand: args.expand,
    includeAnnotations: args.includeAnnotations,
    returnRepresentation: args.returnRepresentation,
    ifNoneMatch: args.ifNoneMatch,
    ifMatch: args.ifMatch,
  });

  if (!result.success || !result.data) {
    return result as unknown as OperationResult<{
      created: true;
      table: string;
      result: unknown;
    }>;
  }

  const entityId =
    result.data && typeof result.data === 'object' && !Array.isArray(result.data) && 'entityId' in result.data
      ? (result.data as { entityId?: unknown }).entityId
      : undefined;
  const readbackHint =
    typeof entityId === 'string' && entityId.length > 0
      ? `Call pp.dataverse.query with environment ${args.environment} and a filter that targets ${entityId} if you need read-side confirmation of the inserted row.`
      : `Call pp.dataverse.query with environment ${args.environment} and a narrow filter on the seeded fields if you need read-side confirmation of the inserted row.`;

  return ok(
    {
      created: true,
      table: args.table,
      result: result.data,
    },
    {
      diagnostics: result.diagnostics,
      warnings: result.warnings,
      supportTier: result.supportTier,
      suggestedNextActions: [readbackHint],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse Web API',
        },
      ],
      knownLimitations: [
        'This MCP mutation creates one explicit row per call; bulk row seeding still belongs in repeated calls or CLI row-manifest workflows.',
      ],
    }
  );
}

export async function executeDataverseMetadataApply(
  args: RemoteToolArgs & {
    manifestPath: string;
    solutionUniqueName?: string;
    mode?: 'dry-run' | 'apply';
    publish?: boolean;
  },
  defaults: PpMcpServerOptions = {},
): Promise<
  OperationResult<{
    mode: 'dry-run' | 'apply';
    manifestPath: string;
    operationCount: number;
    operationsByKind: Partial<Record<MetadataApplyPlan['operations'][number]['kind'], number>>;
    solutionUniqueName?: string;
    publishRequested: boolean;
    plan: MetadataApplyPlan;
    result?: DataverseMetadataApplyResult;
  }>
> {
  const workspaceRoot = resolveProjectPath(undefined, defaults);
  const manifestPath = resolveWorkspacePath(args.manifestPath, workspaceRoot);
  const plan = await readMetadataApplyPlan(manifestPath);

  if (!plan.success || !plan.data) {
    return plan as unknown as OperationResult<{
      mode: 'dry-run' | 'apply';
      manifestPath: string;
      operationCount: number;
      operationsByKind: Partial<Record<MetadataApplyPlan['operations'][number]['kind'], number>>;
      solutionUniqueName?: string;
      publishRequested: boolean;
      plan: MetadataApplyPlan;
      result?: DataverseMetadataApplyResult;
    }>;
  }

  const mode = args.mode ?? 'apply';
  const orderedPlan = orderMetadataApplyPlanForMcp(plan.data);
  const publishRequested = args.publish !== false;

  if (mode === 'dry-run') {
    return ok(
      {
        mode,
        manifestPath,
        operationCount: orderedPlan.operations.length,
        operationsByKind: summarizeMetadataApplyPlanKinds(orderedPlan),
        solutionUniqueName: args.solutionUniqueName,
        publishRequested,
        plan: orderedPlan,
      },
      {
        supportTier: 'preview',
        suggestedNextActions: [
          `Call pp.dataverse.metadata.apply with environment ${args.environment}, manifestPath ${args.manifestPath}, and mode apply when you are ready to execute this bounded metadata plan.`,
        ],
        provenance: [
          {
            kind: 'harvested',
            source: manifestPath,
          },
        ],
        knownLimitations: [
          'Dry-run validates and orders one repo-local metadata manifest, but it does not prove that the target Dataverse environment will accept every operation until apply runs.',
        ],
      },
    );
  }

  const resolution = await resolveRemoteRuntime(args, defaults);

  if (!resolution.success || !resolution.data) {
    return resolution as unknown as OperationResult<{
      mode: 'dry-run' | 'apply';
      manifestPath: string;
      operationCount: number;
      operationsByKind: Partial<Record<MetadataApplyPlan['operations'][number]['kind'], number>>;
      solutionUniqueName?: string;
      publishRequested: boolean;
      plan: MetadataApplyPlan;
      result?: DataverseMetadataApplyResult;
    }>;
  }

  const result = await resolution.data.client.applyMetadataPlan(orderedPlan, {
    solutionUniqueName: args.solutionUniqueName,
    publish: publishRequested,
  });

  if (!result.success || !result.data) {
    return result as unknown as OperationResult<{
      mode: 'dry-run' | 'apply';
      manifestPath: string;
      operationCount: number;
      operationsByKind: Partial<Record<MetadataApplyPlan['operations'][number]['kind'], number>>;
      solutionUniqueName?: string;
      publishRequested: boolean;
      plan: MetadataApplyPlan;
      result?: DataverseMetadataApplyResult;
    }>;
  }

  return ok(
    {
      mode,
      manifestPath,
      operationCount: orderedPlan.operations.length,
      operationsByKind: summarizeMetadataApplyPlanKinds(orderedPlan),
      solutionUniqueName: args.solutionUniqueName,
      publishRequested,
      plan: orderedPlan,
      result: result.data,
    },
    {
      diagnostics: result.diagnostics,
      warnings: result.warnings,
      supportTier: result.supportTier,
      suggestedNextActions: [
        `Call pp.dataverse.metadata.apply with environment ${args.environment}, manifestPath ${args.manifestPath}, and mode dry-run if you need to re-check the ordered manifest without mutating the target environment.`,
      ],
      provenance: [
        {
          kind: 'harvested',
          source: manifestPath,
        },
        {
          kind: 'official-api',
          source: 'Dataverse metadata write APIs',
        },
      ],
      knownLimitations: [
        'This tool applies only the metadata operations described by one local manifest; it does not infer broader environment drift outside those declared table, column, option-set, or relationship changes.',
      ],
    },
  );
}

export async function executeSolutionCheckpoint(
  args: RemoteToolArgs & {
    uniqueName: string;
    outPath: string;
    manifestPath?: string;
    checkpointPath?: string;
    managed?: boolean;
    requestTimeoutMs?: number;
  },
  defaults: PpMcpServerOptions = {},
): Promise<OperationResult<SolutionCheckpointDocument & { checkpointPath: string }>> {
  const resolution = await resolveRemoteRuntime(args, defaults);

  if (!resolution.success || !resolution.data) {
    return resolution as unknown as OperationResult<SolutionCheckpointDocument & { checkpointPath: string }>;
  }

  const workspaceRoot = resolveProjectPath(undefined, defaults);
  const outPath = resolveWorkspacePath(args.outPath, workspaceRoot);
  const manifestPath = args.manifestPath ? resolveWorkspacePath(args.manifestPath, workspaceRoot) : undefined;
  const service = new SolutionService(resolution.data.client);
  const exported = await service.exportSolution(args.uniqueName, {
    managed: args.managed,
    outPath,
    manifestPath,
    requestTimeoutMs: args.requestTimeoutMs,
  });

  if (!exported.success || !exported.data) {
    return exported as unknown as OperationResult<SolutionCheckpointDocument & { checkpointPath: string }>;
  }

  const [syncStatus, components] = await Promise.all([
    service.syncStatus(args.uniqueName, {
      includeExportCheck: false,
      managed: args.managed,
    }),
    service.components(args.uniqueName),
  ]);

  if (!syncStatus.success || !syncStatus.data) {
    return syncStatus as unknown as OperationResult<SolutionCheckpointDocument & { checkpointPath: string }>;
  }

  if (!components.success || !components.data) {
    return components as unknown as OperationResult<SolutionCheckpointDocument & { checkpointPath: string }>;
  }

  const checkpointDocument: SolutionCheckpointDocument = {
    schemaVersion: 1,
    kind: 'pp-solution-checkpoint',
    generatedAt: new Date().toISOString(),
    environment: {
      alias: resolution.data.environment.alias,
      url: resolution.data.environment.url,
      pacOrganizationUrl: derivePacOrganizationUrl(resolution.data.environment.url),
    },
    solution: {
      uniqueName: args.uniqueName,
      packageType: args.managed ? 'managed' : 'unmanaged',
      export: exported.data,
      manifestPath: exported.data.manifestPath,
      rollbackCandidateVersion: exported.data.manifest?.recovery?.rollbackCandidateVersion ?? exported.data.solution.version,
    },
    synchronization: {
      confirmed: syncStatus.data.synchronization.confirmed,
      blockers: syncStatus.data.blockers,
      readBack: syncStatus.data.readBack,
    },
    inspection: {
      solution: exported.data.solution,
      components: components.data,
      componentCount: components.data.length,
    },
  };

  const checkpointPath = resolveSolutionCheckpointPath(exported.data.artifact.path, args.checkpointPath);
  await writeFile(checkpointPath, stableStringify(checkpointDocument as unknown as Parameters<typeof stableStringify>[0]) + '\n', 'utf8');

  return ok(
    {
      ...checkpointDocument,
      checkpointPath,
    },
    {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(exported.diagnostics, syncStatus.diagnostics, components.diagnostics),
      warnings: mergeDiagnosticLists(exported.warnings, syncStatus.warnings, components.warnings),
      suggestedNextActions: [
        `If the next import regresses, re-import ${exported.data.artifact.path} into environment ${resolution.data.environment.alias} and compare the result against ${checkpointPath}.`,
        `Call pp.solution.inspect with environment ${resolution.data.environment.alias} and uniqueName ${args.uniqueName} if you need to re-check live solution metadata before rollback.`,
      ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse ExportSolution',
        },
        {
          kind: 'official-api',
          source: 'Dataverse solution components/readback',
        },
      ],
      knownLimitations: [
        'This checkpoint is solution-scoped only; it does not snapshot Dataverse row data or dependencies outside the exported solution boundary.',
      ],
    },
  );
}

function omitAuthProfileDefaultResource(summary: Omit<AuthProfileInspectResult, 'relationships'>): Omit<AuthProfileInspectResult, 'relationships'> {
  const { defaultResource: _defaultResource, ...rest } = summary;
  return rest;
}

function normalizeComparableUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function resolveSolutionCheckpointPath(packagePath: string, explicitPath: string | undefined): string {
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const extension = extname(packagePath);
  const base = extension ? packagePath.slice(0, -extension.length) : packagePath;
  return resolve(dirname(packagePath), `${basename(base)}.pp-checkpoint.json`);
}

function derivePacOrganizationUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('.api.')) {
      parsed.hostname = parsed.hostname.replace('.api.', '.');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
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
      environment: resolution.data.environment,
      authProfile: resolution.data.authProfile,
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
    ...(result.details !== undefined ? { details: result.details } : {}),
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

function appendToolResultLocalWrite(
  toolResult: ReturnType<typeof toToolResult>,
  localWrite: ToolResultLocalWrite,
): ReturnType<typeof toToolResult> {
  const structuredContent = toolResult.structuredContent as Record<string, unknown>;
  const existingLocalWrites = Array.isArray(structuredContent.localWrites)
    ? (structuredContent.localWrites as unknown[]).filter(
        (entry): entry is ToolResultLocalWrite =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          (entry as { kind?: unknown }).kind === 'tool-result-json' &&
          typeof (entry as { path?: unknown }).path === 'string',
      )
    : [];
  const data =
    structuredContent.data && typeof structuredContent.data === 'object' && !Array.isArray(structuredContent.data)
      ? {
          ...(structuredContent.data as Record<string, unknown>),
          resultLog: {
            kind: localWrite.kind,
            path: localWrite.path,
          },
        }
      : structuredContent.data;

  return {
    ...toolResult,
    structuredContent: {
      ...structuredContent,
      ...(data !== undefined ? { data } : {}),
      localWrites: [...existingLocalWrites, localWrite],
    },
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

function remoteMutationPolicy(optInStrategy: string, approvalRequired: boolean): ToolMutationPolicyControlled {
  return {
    mode: 'controlled',
    mutationsExposed: true,
    approvalRequired,
    approvalStrategy: optInStrategy,
    supportedExecutionModes: ['apply'],
    sessionRequired: false,
  };
}

function previewableRemoteMutationPolicy(optInStrategy: string, approvalRequired = false): ToolMutationPolicyControlled {
  return {
    mode: 'controlled',
    mutationsExposed: true,
    approvalRequired,
    approvalStrategy: optInStrategy,
    supportedExecutionModes: ['dry-run', 'apply'],
    sessionRequired: false,
  };
}

function localMutationPolicy(): ToolMutationPolicyControlled {
  return {
    mode: 'controlled',
    mutationsExposed: true,
    approvalRequired: false,
    approvalStrategy: 'This tool mutates only local pp config or workspace files and returns the resulting session state for inspection.',
    supportedExecutionModes: ['apply'],
    sessionRequired: false,
  };
}

function mergeDiagnosticLists(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
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
