import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { stableStringify } from '@pp/artifacts';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult, type ProvenanceRecord } from '@pp/diagnostics';
import { ModelService, type ModelCompositionResult } from '@pp/model';
import {
  ConnectionReferenceService,
  EnvironmentVariableService,
  type ConnectionReferenceValidationResult,
  type DataverseClient,
  type EntityDefinition,
  type EnvironmentVariableSummary,
} from '@pp/dataverse';

export interface SolutionSummary {
  solutionid: string;
  uniquename: string;
  friendlyname?: string;
  version?: string;
  ismanaged?: boolean;
  publisher?: SolutionPublisherSummary;
}

export interface SolutionPublisherSummary {
  publisherid: string;
  uniquename?: string;
  friendlyname?: string;
  customizationprefix?: string;
  customizationoptionvalueprefix?: number;
}

export interface SolutionCreateOptions {
  friendlyName?: string;
  version?: string;
  description?: string;
  publisherId?: string;
  publisherUniqueName?: string;
}

export interface SolutionSetMetadataOptions {
  version?: string;
  publisherId?: string;
  publisherUniqueName?: string;
}

export interface SolutionListOptions {
  uniqueName?: string;
  prefix?: string;
}

export interface SolutionDeleteResult {
  removed: boolean;
  solution: SolutionSummary;
}

interface PublisherSummary {
  publisherid: string;
  uniquename?: string;
  friendlyname?: string;
  customizationprefix?: string;
}

interface SolutionInspectRecord {
  solutionid: string;
  uniquename: string;
  friendlyname?: string;
  version?: string;
  ismanaged?: boolean;
  _publisherid_value?: string;
  publisherid?: SolutionPublisherSummary;
}

export interface SolutionComponentRecord {
  solutioncomponentid: string;
  objectid?: string;
  componenttype?: number;
  ismetadata?: boolean;
  rootcomponentbehavior?: number;
}

export interface SolutionComponentSummary {
  id: string;
  objectId?: string;
  componentType?: number;
  componentTypeLabel: string;
  name?: string;
  logicalName?: string;
  table?: string;
  entitySetName?: string;
  isMetadata?: boolean;
  rootComponentBehavior?: number;
}

export interface SolutionDependencyRecord {
  dependencyid: string;
  dependencytype?: number;
  requiredcomponentobjectid?: string;
  requiredcomponenttype?: number;
  dependentcomponentobjectid?: string;
  dependentcomponenttype?: number;
}

export interface SolutionDependencySummary {
  id: string;
  dependencyType?: number;
  requiredComponentObjectId?: string;
  requiredComponentType?: number;
  requiredComponentTypeLabel: string;
  requiredComponentTypeHint?: string;
  requiredComponentName?: string;
  requiredComponentLogicalName?: string;
  requiredComponentTable?: string;
  requiredComponentCustom?: boolean;
  dependentComponentObjectId?: string;
  dependentComponentType?: number;
  dependentComponentTypeLabel: string;
  dependentComponentTypeHint?: string;
  dependentComponentName?: string;
  dependentComponentLogicalName?: string;
  dependentComponentTable?: string;
  missingRequiredComponent: boolean;
  importRisk: SolutionDependencyImportRisk;
}

export interface SolutionDependencyImportRisk {
  classification: 'resolved' | 'expected-external' | 'likely-import-blocker' | 'review-required';
  severity: 'none' | 'info' | 'warning';
  reason: string;
  suggestedAction?: string;
}

interface SolutionDependencyComponentResolution {
  name?: string;
  logicalName?: string;
  table?: string;
  entitySetName?: string;
  custom?: boolean;
}

interface ComponentResolutionRequests {
  entityIds: Set<string>;
  appModuleIds: Set<string>;
  canvasAppIds: Set<string>;
  workflowIds: Set<string>;
  webResourceIds: Set<string>;
  sitemapIds: Set<string>;
  formIds: Set<string>;
  viewIds: Set<string>;
  connectionReferenceIds: Set<string>;
  environmentVariableDefinitionIds: Set<string>;
}

export interface SolutionModelDrivenAppAnalysis {
  appId: string;
  uniqueName?: string;
  name?: string;
  composition?: ModelCompositionResult;
  compositionSkippedReason?: string;
}

export interface SolutionModelDrivenAnalysis {
  apps: SolutionModelDrivenAppAnalysis[];
  summary: {
    appCount: number;
    artifactCount: number;
    missingArtifactCount: number;
  };
}

export interface SolutionAnalysis {
  solution: SolutionSummary;
  components: SolutionComponentSummary[];
  dependencies: SolutionDependencySummary[];
  missingDependencies: SolutionDependencySummary[];
  invalidConnectionReferences: ConnectionReferenceValidationResult[];
  missingEnvironmentVariables: EnvironmentVariableSummary[];
  modelDriven: SolutionModelDrivenAnalysis;
  origin: {
    kind: 'environment' | 'zip' | 'unpacked';
    path?: string;
  };
  artifacts: SolutionArtifactInventoryEntry[];
}

export interface SolutionAnalyzeOptions {
  includeModelComposition?: boolean;
}

export interface SolutionModelDrivenAppDrift {
  appId?: string;
  uniqueName?: string;
  name?: string;
  missingArtifactsChanged: boolean;
  artifactsOnlyInSource: string[];
  artifactsOnlyInTarget: string[];
}

export interface SolutionCompareResult {
  uniqueName: string;
  source: SolutionAnalysis;
  target?: SolutionAnalysis;
  drift: {
    versionChanged: boolean;
    componentsOnlyInSource: SolutionComponentSummary[];
    componentsOnlyInTarget: SolutionComponentSummary[];
    artifactsOnlyInSource: SolutionArtifactInventoryEntry[];
    artifactsOnlyInTarget: SolutionArtifactInventoryEntry[];
    changedArtifacts: SolutionArtifactInventoryChange[];
    modelDriven: {
      appsOnlyInSource: SolutionModelDrivenAppAnalysis[];
      appsOnlyInTarget: SolutionModelDrivenAppAnalysis[];
      changedApps: SolutionModelDrivenAppDrift[];
    };
  };
  missingDependencies: {
    source: SolutionDependencySummary[];
    target: SolutionDependencySummary[];
  };
  missingConfig: {
    invalidConnectionReferences: {
      source: ConnectionReferenceValidationResult[];
      target: ConnectionReferenceValidationResult[];
    };
    environmentVariablesMissingValues: {
      source: EnvironmentVariableSummary[];
      target: EnvironmentVariableSummary[];
    };
  };
}

export type SolutionPackageType = 'managed' | 'unmanaged' | 'both';

export interface SolutionArtifactInventoryEntry {
  relativePath: string;
  sha256: string;
  bytes: number;
}

export interface SolutionArtifactInventoryChange {
  relativePath: string;
  source: SolutionArtifactInventoryEntry;
  target: SolutionArtifactInventoryEntry;
}

export interface SolutionArtifactFile {
  role: 'solution-zip' | 'manifest' | 'unpacked-root';
  path: string;
  relativePath?: string;
  sha256?: string;
  bytes?: number;
}

export interface SolutionReleaseManifest {
  schemaVersion: 1;
  kind: 'pp-solution-release';
  generatedAt: string;
  solution: {
    uniqueName: string;
    friendlyName?: string;
    version?: string;
    packageType: Exclude<SolutionPackageType, 'both'>;
  };
  source?: {
    environmentUrl?: string;
  };
  analysis?: {
    componentCount: number;
    dependencyCount: number;
    missingDependencyCount: number;
    invalidConnectionReferenceCount: number;
    missingEnvironmentVariableCount: number;
  };
  recovery?: {
    rollbackCandidateVersion?: string;
  };
  files: SolutionArtifactFile[];
}

export interface SolutionExportOptions {
  managed?: boolean;
  outDir?: string;
  outPath?: string;
  manifestPath?: string;
  requestTimeoutMs?: number;
}

export interface SolutionExportResult {
  solution: SolutionSummary;
  packageType: Exclude<SolutionPackageType, 'both'>;
  artifact: SolutionArtifactFile;
  manifest?: SolutionReleaseManifest;
  manifestPath?: string;
}

export interface SolutionImportOptions {
  publishWorkflows?: boolean;
  overwriteUnmanagedCustomizations?: boolean;
  holdingSolution?: boolean;
  skipProductUpdateDependencies?: boolean;
  importJobId?: string;
}

export interface SolutionImportResult {
  packagePath: string;
  manifestPath?: string;
  packageType?: Exclude<SolutionPackageType, 'both'>;
  imported: boolean;
  options: Required<Omit<SolutionImportOptions, 'importJobId'>> & { importJobId?: string };
  manifest?: SolutionReleaseManifest;
}

export interface SolutionPublishOptions {
  waitForExport?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  exportOptions?: SolutionExportOptions;
  onProgress?: (event: SolutionPublishProgressEvent) => void;
}

export interface SolutionPublishProgressEvent {
  stage: 'accepted' | 'polling' | 'confirmed';
  attempt?: number;
  elapsedMs?: number;
  remainingMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  latestExportDiagnostic?: Pick<Diagnostic, 'code' | 'message'>;
  readBack?: SolutionPublishReadback;
}

export interface SolutionPublishCanvasReadback {
  id: string;
  name?: string;
  logicalName?: string;
  lastPublishTime?: string;
}

export interface SolutionPublishWorkflowReadback {
  id: string;
  name?: string;
  logicalName?: string;
  category?: number;
  workflowState?: string;
  stateCode?: number;
  statusCode?: number;
  definitionAvailable?: boolean;
}

export interface SolutionPublishReadbackSummary {
  componentCount: number;
  componentTypeCounts: Record<string, number>;
  canvasAppCount: number;
  workflowCount: number;
  modelDrivenAppCount: number;
}

export interface SolutionPublishReadbackSignals {
  canvasApps: {
    total: number;
    published: number;
    unknown: number;
  };
  workflows: {
    total: number;
    activated: number;
    draft: number;
    suspended: number;
    other: number;
    blocked: number;
  };
  modelDrivenApps: {
    total: number;
    published: number;
    unknown: number;
  };
}

export interface SolutionPublishReadback {
  summary: SolutionPublishReadbackSummary;
  signals: SolutionPublishReadbackSignals;
  canvasApps: SolutionPublishCanvasReadback[];
  workflows: SolutionPublishWorkflowReadback[];
  modelDrivenApps: SolutionPublishModelDrivenAppReadback[];
}

export interface SolutionPublishModelDrivenAppReadback {
  id: string;
  name?: string;
  uniqueName?: string;
  stateCode?: number;
  publishedOn?: string;
}

export interface SolutionSyncStatusExportCheckFailure {
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
  suggestedNextActions?: string[];
  details?: unknown;
}

export interface SolutionSyncStatusExportCheck {
  attempted: boolean;
  confirmed: boolean;
  packageType: Exclude<SolutionPackageType, 'both'>;
  artifact?: SolutionArtifactFile;
  manifest?: SolutionReleaseManifest;
  manifestPath?: string;
  failure?: SolutionSyncStatusExportCheckFailure;
}

export interface SolutionSyncStatusOptions extends SolutionExportOptions {
  includeExportCheck?: boolean;
  onProgress?: (event: SolutionSyncStatusProgressEvent) => void;
}

export interface SolutionManagedStateContradictionDetails {
  diagnosticCode?: string;
  message: string;
  detail?: string;
}

export interface SolutionExportFailureDetails {
  solution: SolutionSummary;
  packageType: Exclude<SolutionPackageType, 'both'>;
  managedStateContradiction?: {
    inspect: Pick<SolutionSummary, 'solutionid' | 'uniquename' | 'friendlyname' | 'version' | 'ismanaged'>;
    export: SolutionManagedStateContradictionDetails;
  };
}

export interface SolutionPackageMetadata {
  uniqueName?: string;
  friendlyName?: string;
  version?: string;
  packageType?: Exclude<SolutionPackageType, 'both'>;
  manifestPath?: string;
  source: 'manifest' | 'archive';
}

export interface SolutionSyncStatusProgressEvent {
  stage: 'readback-complete' | 'export-check-started' | 'export-check-complete';
  elapsedMs?: number;
  packageType?: Exclude<SolutionPackageType, 'both'>;
  readBack?: SolutionPublishReadback;
  exportConfirmed?: boolean;
  latestExportDiagnostic?: Pick<Diagnostic, 'code' | 'message'>;
}

export interface SolutionSyncStatusBlocker {
  kind: 'workflow-state';
  componentType: 'workflow';
  id: string;
  name?: string;
  logicalName?: string;
  category?: number;
  workflowState?: string;
  stateCode?: number;
  statusCode?: number;
  definitionAvailable?: boolean;
  reason: string;
  remediation?: {
    kind: 'inspect-only' | 'activate-in-place';
    mcpMutationAvailable: boolean;
    mcpTool?: {
      name: 'pp.flow.activate' | 'pp.flow.deploy';
      arguments: Record<string, string>;
    };
    alternativeMcpTools?: Array<{
      name: 'pp.flow.activate' | 'pp.flow.deploy';
      arguments: Record<string, string>;
      summary: string;
    }>;
    cliCommand?: string;
    alternativeCliCommands?: string[];
    limitationCode?: string;
    summary: string;
  };
}

function buildModernFlowActivationLimitationSummary(identifier: string, solutionUniqueName: string): string {
  return `Use MCP \`pp.flow.activate\` or \`pp flow activate ${identifier} --environment <alias> --solution ${solutionUniqueName} --format json\` for one bounded in-session activation attempt. If you also have the local artifact, \`pp.flow.deploy\` can redeploy it back to ${identifier} in the same solution, but if either path returns \`FLOW_ACTIVATE_DEFINITION_REQUIRED\`, \`pp\` does not currently have another native completion path from draft modern flow to export-ready synchronized solution for this workflow.`;
}

export interface SolutionReadinessAssessment {
  state: 'ready' | 'blocked' | 'unconfirmed';
  summary: string;
  exportReadinessConfirmed: boolean;
  blockerCount: number;
  publishAccepted?: boolean;
  prePublishBlockerCount?: number;
  unchangedFromPrePublish?: boolean;
  primaryBlocker?: {
    kind: 'workflow-state';
    componentType: 'workflow';
    id: string;
    name?: string;
    logicalName?: string;
    workflowState?: string;
    definitionAvailable?: boolean;
    reason: string;
    remediation?: SolutionSyncStatusBlocker['remediation'];
  };
}

export interface SolutionSyncStatusResult {
  solution: SolutionSummary;
  synchronization: {
    kind: 'solution-export';
    confirmed: boolean;
  };
  readiness: SolutionReadinessAssessment;
  blockers: SolutionSyncStatusBlocker[];
  readBack: SolutionPublishReadback;
  exportCheck: SolutionSyncStatusExportCheck;
}

export interface SolutionPublishResult {
  solution: SolutionSummary;
  published: true;
  action: {
    name: 'PublishAllXml';
    accepted: boolean;
  };
  waitForExport: boolean;
  export?: SolutionExportResult;
  synchronization?: {
    kind: 'none' | 'solution-export';
    confirmed: boolean;
    attempts?: number;
    elapsedMs?: number;
  };
  readiness?: SolutionReadinessAssessment;
  readBack?: SolutionPublishReadback;
  blockers?: SolutionSyncStatusBlocker[];
  exportCheck?: SolutionSyncStatusExportCheck;
}

interface SolutionPublishPrecheckContext {
  readBack?: SolutionPublishReadback;
  blockers: SolutionSyncStatusBlocker[];
  warnings: Diagnostic[];
  provenance: ProvenanceRecord[];
}

export interface SolutionPackOptions {
  outPath: string;
  packageType?: SolutionPackageType;
  pacExecutable?: string;
  mapFile?: string;
}

export interface SolutionPackResult {
  packageType: SolutionPackageType;
  artifact: SolutionArtifactFile;
  sourceFolder: string;
}

export interface SolutionUnpackOptions {
  outDir: string;
  packageType?: SolutionPackageType;
  pacExecutable?: string;
  allowDelete?: boolean;
  mapFile?: string;
}

export interface SolutionUnpackResult {
  packageType: SolutionPackageType;
  sourcePackage: SolutionArtifactFile;
  unpackedRoot: SolutionArtifactFile;
}

export interface SolutionArtifactAnalyzeOptions {
  packagePath?: string;
  unpackedPath?: string;
  pacExecutable?: string;
}

export interface SolutionCommandInvocation {
  executable: string;
  args: string[];
  cwd?: string;
}

export interface SolutionCommandResult extends SolutionCommandInvocation {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SolutionCommandRunner {
  run(invocation: SolutionCommandInvocation): Promise<OperationResult<SolutionCommandResult>>;
}

function escapeODataString(value: string): string {
  return value.replaceAll("'", "''");
}

function buildSolutionListFilter(options: { uniqueName?: string; prefix?: string }): string | undefined {
  const clauses: string[] = [];

  if (options.uniqueName) {
    clauses.push(`uniquename eq '${escapeODataString(options.uniqueName)}'`);
  }

  if (options.prefix) {
    const escapedPrefix = escapeODataString(options.prefix);
    clauses.push(`(startswith(uniquename,'${escapedPrefix}') or startswith(friendlyname,'${escapedPrefix}'))`);
  }

  return clauses.length > 0 ? clauses.join(' and ') : undefined;
}

function filterSolutions(solutions: SolutionSummary[], options: { uniqueName?: string; prefix?: string }): SolutionSummary[] {
  const normalizedPrefix = options.prefix?.toLowerCase();

  return solutions.filter((solution) => {
    if (options.uniqueName && solution.uniquename !== options.uniqueName) {
      return false;
    }

    if (!normalizedPrefix) {
      return true;
    }

    const uniqueName = solution.uniquename.toLowerCase();
    const friendlyName = solution.friendlyname?.toLowerCase() ?? '';
    return uniqueName.startsWith(normalizedPrefix) || friendlyName.startsWith(normalizedPrefix);
  });
}

export class SolutionService {
  private readonly commandRunner: SolutionCommandRunner;

  constructor(
    private readonly dataverseClient: DataverseClient,
    options: {
      commandRunner?: SolutionCommandRunner;
    } = {}
  ) {
    this.commandRunner = options.commandRunner ?? new DefaultSolutionCommandRunner();
  }

  async create(uniqueName: string, options: SolutionCreateOptions = {}): Promise<OperationResult<SolutionSummary>> {
    const availablePublishers =
      options.publisherId || options.publisherUniqueName ? undefined : await this.loadPublisherSummaries();
    const inferredPublisher =
      !options.publisherId && !options.publisherUniqueName ? this.inferCreatePublisher(uniqueName, availablePublishers) : undefined;
    const publisherId = options.publisherId ?? inferredPublisher?.publisherid ?? (await this.resolvePublisherId(options.publisherUniqueName));

    if (!publisherId) {
      const publisherSummary = this.formatPublisherList(availablePublishers);
      return fail(
        createDiagnostic(
          'error',
          options.publisherUniqueName ? 'SOLUTION_PUBLISHER_NOT_FOUND' : 'SOLUTION_PUBLISHER_REQUIRED',
          options.publisherUniqueName
            ? `Publisher ${options.publisherUniqueName} was not found.`
            : 'A publisher is required. Use --publisher-id or --publisher-unique-name.',
          {
            source: '@pp/solution',
            detail: publisherSummary ? `Available publishers: ${publisherSummary}.` : undefined,
            hint: availablePublishers?.length
              ? 'Retry with one of the listed publisher unique names or ids.'
              : 'Inspect available publishers in the target environment, then retry with --publisher-id or --publisher-unique-name.',
          }
        ),
        {
          supportTier: 'preview',
          suggestedNextActions: this.buildPublisherSuggestions(uniqueName, availablePublishers),
        }
      );
    }

    const createResult = await this.dataverseClient.create<
      Record<string, unknown>,
      {
        solutionid?: string;
        uniquename?: string;
        friendlyname?: string;
        version?: string;
      }
    >(
      'solutions',
      {
        uniquename: uniqueName,
        friendlyname: options.friendlyName ?? uniqueName,
        version: options.version ?? '1.0.0.0',
        ...(options.description ? { description: options.description } : {}),
        'publisherid@odata.bind': `/publishers(${publisherId})`,
      },
      {
        returnRepresentation: true,
      }
    );

    if (!createResult.success) {
      return createResult as unknown as OperationResult<SolutionSummary>;
    }

    return ok(
      {
        solutionid: createResult.data?.entity?.solutionid ?? createResult.data?.entityId ?? '',
        uniquename: createResult.data?.entity?.uniquename ?? uniqueName,
        friendlyname: createResult.data?.entity?.friendlyname ?? options.friendlyName ?? uniqueName,
        version: createResult.data?.entity?.version ?? options.version ?? '1.0.0.0',
      },
      {
        supportTier: 'preview',
        diagnostics: createResult.diagnostics,
        warnings: [
          ...createResult.warnings,
          ...(inferredPublisher
            ? [
                createDiagnostic(
                  'warning',
                  'SOLUTION_PUBLISHER_INFERRED',
                  `Inferred publisher ${inferredPublisher.uniquename ?? inferredPublisher.publisherid} from solution unique name ${uniqueName}.`,
                  {
                    source: '@pp/solution',
                    detail: inferredPublisher.customizationprefix
                      ? `Matched publisher customization prefix ${inferredPublisher.customizationprefix}.`
                      : undefined,
                    hint: 'Pass --publisher-unique-name or --publisher-id to override the inferred publisher.',
                  }
                ),
              ]
            : []),
        ],
      }
    );
  }

  async setMetadata(uniqueName: string, options: SolutionSetMetadataOptions = {}): Promise<OperationResult<SolutionSummary>> {
    if (!options.version && !options.publisherId && !options.publisherUniqueName) {
      return fail(
        createDiagnostic(
          'error',
          'SOLUTION_METADATA_UPDATE_REQUIRED',
          'Provide --version, --publisher-id, or --publisher-unique-name when updating solution metadata.',
          {
            source: '@pp/solution',
          }
        ),
        {
          supportTier: 'preview',
        }
      );
    }

    const solution = await this.inspect(uniqueName);

    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionSummary>;
    }

    if (!solution.data) {
      return fail(
        [
          ...solution.diagnostics,
          createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`, {
            source: '@pp/solution',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: solution.warnings,
          suggestedNextActions: solution.suggestedNextActions,
        }
      );
    }

    const publisherId = options.publisherId ?? (await this.resolvePublisherId(options.publisherUniqueName));

    if ((options.publisherId || options.publisherUniqueName) && !publisherId) {
      return fail(
        [
          ...solution.diagnostics,
          createDiagnostic(
            'error',
            'SOLUTION_PUBLISHER_NOT_FOUND',
            `Publisher ${options.publisherUniqueName ?? options.publisherId} was not found.`,
            {
              source: '@pp/solution',
            }
          ),
        ],
        {
          supportTier: 'preview',
          warnings: solution.warnings,
        }
      );
    }

    const updateBody: Record<string, unknown> = {};

    if (options.version) {
      updateBody.version = options.version;
    }

    if (publisherId) {
      updateBody['publisherid@odata.bind'] = `/publishers(${publisherId})`;
    }

    const update = await this.dataverseClient.update<
      Record<string, unknown>,
      {
        solutionid?: string;
        uniquename?: string;
        friendlyname?: string;
        version?: string;
      }
    >('solutions', solution.data.solutionid, updateBody, {
      returnRepresentation: true,
    });

    if (!update.success) {
      return update as unknown as OperationResult<SolutionSummary>;
    }

    const refreshed = await this.inspect(uniqueName);

    if (!refreshed.success) {
      return refreshed as unknown as OperationResult<SolutionSummary>;
    }

    return ok(
      refreshed.data ?? {
        solutionid: update.data?.entity?.solutionid ?? solution.data.solutionid,
        uniquename: update.data?.entity?.uniquename ?? solution.data.uniquename,
        friendlyname: update.data?.entity?.friendlyname ?? solution.data.friendlyname,
        version: update.data?.entity?.version ?? options.version ?? solution.data.version,
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(solution.diagnostics, update.diagnostics, refreshed.diagnostics),
        warnings: mergeDiagnosticLists(solution.warnings, update.warnings, refreshed.warnings),
      }
    );
  }

  async delete(uniqueName: string): Promise<OperationResult<SolutionDeleteResult>> {
    const solution = await this.inspect(uniqueName);

    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionDeleteResult>;
    }

    if (!solution.data) {
      return fail(
        [
          ...solution.diagnostics,
          createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`, {
            source: '@pp/solution',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: solution.warnings,
        }
      );
    }

    const removed = await this.dataverseClient.delete('solutions', solution.data.solutionid);

    if (!removed.success) {
      return removed as unknown as OperationResult<SolutionDeleteResult>;
    }

    return ok(
      {
        removed: true,
        solution: solution.data,
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(solution.diagnostics, removed.diagnostics),
        warnings: mergeDiagnosticLists(solution.warnings, removed.warnings),
      }
    );
  }

  async list(options: SolutionListOptions = {}): Promise<OperationResult<SolutionSummary[]>> {
    const normalizedUniqueName = options.uniqueName?.trim();
    const normalizedPrefix = options.prefix?.trim();
    const filteredQuery = buildSolutionListFilter({
      uniqueName: normalizedUniqueName,
      prefix: normalizedPrefix,
    });
    const result = await this.dataverseClient.queryAll<SolutionSummary>({
      table: 'solutions',
      select: ['solutionid', 'uniquename', 'friendlyname', 'version', 'ismanaged'],
      filter: filteredQuery,
    });

    if (!result.success) {
      return result;
    }

    const filtered = filterSolutions(result.data ?? [], {
      uniqueName: normalizedUniqueName,
      prefix: normalizedPrefix,
    });

    if (filtered.length > 0 || !filteredQuery) {
      return ok(filtered, {
        supportTier: 'preview',
        diagnostics: result.diagnostics,
        warnings: result.warnings,
      });
    }

    const fallback = await this.dataverseClient.queryAll<SolutionSummary>({
      table: 'solutions',
      select: ['solutionid', 'uniquename', 'friendlyname', 'version', 'ismanaged'],
    });

    if (!fallback.success) {
      return fallback;
    }

    return ok(filterSolutions(fallback.data ?? [], {
      uniqueName: normalizedUniqueName,
      prefix: normalizedPrefix,
    }), {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(result.diagnostics, fallback.diagnostics),
      warnings: mergeDiagnosticLists(result.warnings, fallback.warnings),
    });
  }

  async inspect(uniqueName: string): Promise<OperationResult<SolutionSummary | undefined>> {
    const solutions = await this.dataverseClient.query<SolutionInspectRecord>({
      table: 'solutions',
      select: ['solutionid', 'uniquename', 'friendlyname', 'version', 'ismanaged', '_publisherid_value'],
      expand: ['publisherid($select=publisherid,uniquename,friendlyname,customizationprefix,customizationoptionvalueprefix)'],
      filter: `uniquename eq '${escapeODataString(uniqueName)}'`,
      top: 1,
    });

    if (!solutions.success) {
      return solutions as unknown as OperationResult<SolutionSummary | undefined>;
    }

    const summary = await this.enrichSolutionSummary(solutions.data?.[0]);
    const missingSuggestions = !summary ? await this.buildMissingSolutionSuggestions(uniqueName) : undefined;
    const warnings = !summary ? rewriteMissingSolutionWarnings(uniqueName, solutions.warnings) : solutions.warnings;

    return ok(summary, {
      supportTier: 'preview',
      diagnostics: solutions.diagnostics,
      warnings,
      suggestedNextActions: missingSuggestions,
    });
  }

  async components(uniqueName: string): Promise<OperationResult<SolutionComponentSummary[]>> {
    const solution = await this.inspect(uniqueName);

    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionComponentSummary[]>;
    }

    if (!solution.data) {
      return fail(
        [
          ...solution.diagnostics,
          createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`, {
            source: '@pp/solution',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: solution.warnings,
        }
      );
    }

    const components = await this.dataverseClient.queryAll<SolutionComponentRecord>({
      table: 'solutioncomponents',
      select: ['solutioncomponentid', 'objectid', 'componenttype', 'ismetadata', 'rootcomponentbehavior'],
      filter: `_solutionid_value eq ${solution.data.solutionid}`,
    });

    if (!components.success) {
      return components as unknown as OperationResult<SolutionComponentSummary[]>;
    }

    const normalizedComponents = (components.data ?? []).map(normalizeSolutionComponent);
    const resolutions = await this.resolveComponentNames(normalizedComponents);

    if (!resolutions.success) {
      return resolutions as unknown as OperationResult<SolutionComponentSummary[]>;
    }

    return ok(applyComponentResolutions(normalizedComponents, resolutions.data ?? new Map()), {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(solution.diagnostics, components.diagnostics, resolutions.diagnostics),
      warnings: mergeDiagnosticLists(solution.warnings, components.warnings, resolutions.warnings),
    });
  }

  async dependencies(uniqueName: string): Promise<OperationResult<SolutionDependencySummary[]>> {
    const components = await this.components(uniqueName);

    if (!components.success) {
      return components as unknown as OperationResult<SolutionDependencySummary[]>;
    }

    const componentIds = new Set((components.data ?? []).map((component) => component.objectId).filter(Boolean) as string[]);
    const dependencies = await this.dataverseClient.queryAll<SolutionDependencyRecord>({
      table: 'dependencies',
      select: [
        'dependencyid',
        'dependencytype',
        'requiredcomponentobjectid',
        'requiredcomponenttype',
        'dependentcomponentobjectid',
        'dependentcomponenttype',
      ],
    });

    if (!dependencies.success) {
      return dependencies as unknown as OperationResult<SolutionDependencySummary[]>;
    }

    const relevant = (dependencies.data ?? [])
      .filter((dependency) => dependency.dependentcomponentobjectid && componentIds.has(dependency.dependentcomponentobjectid))
      .map((dependency) => normalizeSolutionDependency(dependency, componentIds));
    const resolutions = await this.resolveDependencyComponentNames(relevant);

    if (!resolutions.success) {
      return resolutions as unknown as OperationResult<SolutionDependencySummary[]>;
    }

    return ok(applyDependencyComponentResolutions(relevant, resolutions.data ?? new Map()), {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(components.diagnostics, dependencies.diagnostics, resolutions.diagnostics),
      warnings: mergeDiagnosticLists(components.warnings, dependencies.warnings, resolutions.warnings),
    });
  }

  private async resolveDependencyComponentNames(
    dependencies: SolutionDependencySummary[]
  ): Promise<OperationResult<Map<string, SolutionDependencyComponentResolution>>> {
    const requested = collectDependencyResolutionRequests(dependencies);
    return this.resolveComponentNamesByRequest(requested);
  }

  private async resolveComponentNames(
    components: SolutionComponentSummary[]
  ): Promise<OperationResult<Map<string, SolutionDependencyComponentResolution>>> {
    const requested = collectComponentResolutionRequests(components);
    return this.resolveComponentNamesByRequest(requested);
  }

  private async resolveComponentNamesByRequest(
    requested: ComponentResolutionRequests
  ): Promise<OperationResult<Map<string, SolutionDependencyComponentResolution>>> {
    const [
      tables,
      appModules,
      canvasApps,
      workflows,
      webResources,
      sitemaps,
      forms,
      views,
      connectionReferences,
      environmentVariables,
    ] = await Promise.all([
      requested.entityIds.size > 0
        ? this.dataverseClient.listTables({
            select: ['MetadataId', 'LogicalName', 'SchemaName', 'DisplayName', 'EntitySetName', 'IsCustomEntity'],
            all: true,
          })
        : ok([] as EntityDefinition[], { supportTier: 'preview' }),
      queryAllOrEmpty<{ appmoduleid: string; uniquename?: string; name?: string }>(
        this.dataverseClient,
        requested.appModuleIds,
        'appmodules',
        'appmoduleid',
        ['appmoduleid', 'uniquename', 'name']
      ),
      queryAllOrEmpty<{ canvasappid: string; displayname?: string; name?: string }>(
        this.dataverseClient,
        requested.canvasAppIds,
        'canvasapps',
        'canvasappid',
        ['canvasappid', 'displayname', 'name']
      ),
      queryAllOrEmpty<{ workflowid: string; name?: string; uniquename?: string }>(
        this.dataverseClient,
        requested.workflowIds,
        'workflows',
        'workflowid',
        ['workflowid', 'name', 'uniquename']
      ),
      queryAllOrEmpty<{ webresourceid: string; name?: string; displayname?: string }>(
        this.dataverseClient,
        requested.webResourceIds,
        'webresourceset',
        'webresourceid',
        ['webresourceid', 'name', 'displayname']
      ),
      queryAllOrEmpty<{ sitemapid: string; sitemapname?: string }>(
        this.dataverseClient,
        requested.sitemapIds,
        'sitemaps',
        'sitemapid',
        ['sitemapid', 'sitemapname']
      ),
      queryAllOrEmpty<{ formid: string; name?: string; objecttypecode?: string }>(
        this.dataverseClient,
        requested.formIds,
        'systemforms',
        'formid',
        ['formid', 'name', 'objecttypecode']
      ),
      queryAllOrEmpty<{ savedqueryid: string; name?: string; returnedtypecode?: string }>(
        this.dataverseClient,
        requested.viewIds,
        'savedqueries',
        'savedqueryid',
        ['savedqueryid', 'name', 'returnedtypecode']
      ),
      queryAllOrEmpty<{
        connectionreferenceid: string;
        connectionreferencelogicalname?: string;
        connectionreferencedisplayname?: string;
        displayname?: string;
      }>(
        this.dataverseClient,
        requested.connectionReferenceIds,
        'connectionreferences',
        'connectionreferenceid',
        ['connectionreferenceid', 'connectionreferencelogicalname', 'connectionreferencedisplayname', 'displayname']
      ),
      queryAllOrEmpty<{ environmentvariabledefinitionid: string; schemaname?: string; displayname?: string }>(
        this.dataverseClient,
        requested.environmentVariableDefinitionIds,
        'environmentvariabledefinitions',
        'environmentvariabledefinitionid',
        ['environmentvariabledefinitionid', 'schemaname', 'displayname']
      ),
    ]);

    const map = new Map<string, SolutionDependencyComponentResolution>();
    addComponentResolutions(map, 1, tables.data ?? [], (record) => typeof record.MetadataId === 'string' ? record.MetadataId : undefined, (record) => ({
      name: extractDisplayName(record.DisplayName) ?? readString(record.LogicalName),
      logicalName: readString(record.LogicalName),
      table: readString(record.LogicalName),
      entitySetName: readString(record.EntitySetName),
      custom: typeof record.IsCustomEntity === 'boolean' ? record.IsCustomEntity : undefined,
    }));
    addComponentResolutions(map, 80, appModules.data ?? [], (record) => record.appmoduleid, (record) => ({
      name: record.name ?? record.uniquename,
      logicalName: record.uniquename,
    }));
    addComponentResolutions(map, 300, canvasApps.data ?? [], (record) => record.canvasappid, (record) => ({
      name: record.displayname ?? record.name,
      logicalName: record.name,
    }));
    addComponentResolutions(map, 29, workflows.data ?? [], (record) => record.workflowid, (record) => ({
      name: record.name ?? record.uniquename,
      logicalName: record.uniquename,
    }));
    addComponentResolutions(map, 61, webResources.data ?? [], (record) => record.webresourceid, (record) => ({
      name: record.displayname ?? record.name,
      logicalName: record.name,
    }));
    addComponentResolutions(map, 62, sitemaps.data ?? [], (record) => record.sitemapid, (record) => ({
      name: record.sitemapname,
    }));
    addComponentResolutions(map, 24, forms.data ?? [], (record) => record.formid, (record) => ({
      name: record.name,
      table: record.objecttypecode,
    }));
    addComponentResolutions(map, 60, forms.data ?? [], (record) => record.formid, (record) => ({
      name: record.name,
      table: record.objecttypecode,
    }));
    addComponentResolutions(map, 26, views.data ?? [], (record) => record.savedqueryid, (record) => ({
      name: record.name,
      table: record.returnedtypecode,
    }));
    addComponentResolutions(map, 371, connectionReferences.data ?? [], (record) => record.connectionreferenceid, (record) => ({
      name: record.connectionreferencedisplayname ?? record.displayname ?? record.connectionreferencelogicalname,
      logicalName: record.connectionreferencelogicalname,
    }));
    addComponentResolutions(
      map,
      380,
      environmentVariables.data ?? [],
      (record) => record.environmentvariabledefinitionid,
      (record) => ({
        name: record.displayname ?? record.schemaname,
        logicalName: record.schemaname,
      })
    );

    return ok(map, {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(
        tables.diagnostics,
        appModules.diagnostics,
        canvasApps.diagnostics,
        workflows.diagnostics,
        webResources.diagnostics,
        sitemaps.diagnostics,
        forms.diagnostics,
        views.diagnostics,
        connectionReferences.diagnostics,
        environmentVariables.diagnostics
      ),
      warnings: mergeDiagnosticLists(
        tables.warnings,
        appModules.warnings,
        canvasApps.warnings,
        workflows.warnings,
        webResources.warnings,
        sitemaps.warnings,
        forms.warnings,
        views.warnings,
        connectionReferences.warnings,
        environmentVariables.warnings
      ),
    });
  }

  async analyze(uniqueName: string, options: SolutionAnalyzeOptions = {}): Promise<OperationResult<SolutionAnalysis | undefined>> {
    const solution = await this.inspect(uniqueName);

    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!solution.data) {
      return fail(
        [
          ...solution.diagnostics,
          createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`, {
            source: '@pp/solution',
            hint: solution.suggestedNextActions?.[0],
          }),
        ],
        {
          supportTier: 'preview',
          warnings: solution.warnings,
          suggestedNextActions: solution.suggestedNextActions,
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse solutions',
            },
          ],
        }
      );
    }

    const provenance = [
      {
        kind: 'official-api' as const,
        source: 'Dataverse solutions',
      },
      {
        kind: 'official-api' as const,
        source: 'Dataverse solutioncomponents',
      },
      {
        kind: 'official-api' as const,
        source: 'Dataverse dependencies',
      },
      {
        kind: 'official-api' as const,
        source: 'Dataverse connectionreferences',
      },
      {
        kind: 'official-api' as const,
        source: 'Dataverse environmentvariabledefinitions',
      },
      {
        kind: 'official-api' as const,
        source: 'Dataverse environmentvariablevalues',
      },
      {
        kind: 'official-api' as const,
        source: 'Dataverse appmodules',
      },
    ];

    const modelService = new ModelService(this.dataverseClient);
    const [components, dependencies, connectionReferences, environmentVariables, modelApps] = await Promise.all([
      this.components(uniqueName),
      this.dependencies(uniqueName),
      new ConnectionReferenceService(this.dataverseClient).validate({ solutionUniqueName: uniqueName }),
      new EnvironmentVariableService(this.dataverseClient).list({ solutionUniqueName: uniqueName }),
      modelService.list({ solutionUniqueName: uniqueName }),
    ]);

    if (!components.success) {
      return components as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!dependencies.success) {
      return dependencies as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!connectionReferences.success) {
      return connectionReferences as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!environmentVariables.success) {
      return environmentVariables as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!modelApps.success) {
      return modelApps as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    const includeModelComposition = options.includeModelComposition ?? true;
    const modelDrivenApps: SolutionModelDrivenAppAnalysis[] = [];
    let modelDiagnostics = [...modelApps.diagnostics];
    let modelWarnings = [...modelApps.warnings];
    const unresolvedModelAppIds = new Set(
      (dependencies.data ?? [])
        .filter((dependency) => dependency.missingRequiredComponent && dependency.dependentComponentType === 80)
        .map((dependency) => dependency.dependentComponentObjectId)
        .filter((value): value is string => Boolean(value))
    );

    for (const app of modelApps.data ?? []) {
      if (unresolvedModelAppIds.has(app.id)) {
        const compositionSkippedReason = 'Skipped model composition because the app still has unresolved solution dependencies.';
        modelDrivenApps.push({
          appId: app.id,
          uniqueName: app.uniqueName,
          name: app.name,
          compositionSkippedReason,
        });
        modelWarnings = [
          ...modelWarnings,
          createDiagnostic(
            'warning',
            'SOLUTION_MODEL_ANALYZE_SKIPPED_UNRESOLVED_DEPENDENCIES',
            `Skipped model composition for app ${app.name ?? app.uniqueName ?? app.id} because the solution still has unresolved required components.`,
            {
              source: '@pp/solution',
              hint: `Re-run \`pp solution analyze ${uniqueName} --environment <alias>\` after the missing model-driven dependencies are added to the solution.`,
            }
          ),
        ];
        continue;
      }

      if (!includeModelComposition) {
        modelDrivenApps.push({
          appId: app.id,
          uniqueName: app.uniqueName,
          name: app.name,
          compositionSkippedReason:
            'Skipped model composition during solution compare; rerun with --include-model-composition for app-level artifact drift.',
        });
        continue;
      }

      const composition = await modelService.composition(app.id, { solutionUniqueName: uniqueName });

      if (!composition.success || !composition.data) {
        return composition as unknown as OperationResult<SolutionAnalysis | undefined>;
      }

      modelDrivenApps.push({
        appId: app.id,
        uniqueName: app.uniqueName,
        name: app.name,
        composition: composition.data,
      });
      modelDiagnostics = [...modelDiagnostics, ...composition.diagnostics];
      modelWarnings = [...modelWarnings, ...composition.warnings];
    }

    const analysis: SolutionAnalysis = {
      solution: solution.data,
      components: components.data ?? [],
      dependencies: dependencies.data ?? [],
      missingDependencies: (dependencies.data ?? []).filter((dependency) => dependency.missingRequiredComponent),
      invalidConnectionReferences: (connectionReferences.data ?? []).filter((reference) => !reference.valid),
      missingEnvironmentVariables: (environmentVariables.data ?? []).filter((variable) => !variable.effectiveValue),
      modelDriven: {
        apps: modelDrivenApps,
        summary: {
          appCount: modelDrivenApps.length,
          artifactCount: modelDrivenApps.reduce((count, app) => count + (app.composition?.summary.totalArtifacts ?? 0), 0),
          missingArtifactCount: modelDrivenApps.reduce((count, app) => count + (app.composition?.summary.missingArtifacts ?? 0), 0),
        },
      },
      origin: {
        kind: 'environment',
      },
      artifacts: [],
    };

    return ok(analysis, {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(
        solution.diagnostics,
        components.diagnostics,
        dependencies.diagnostics,
        connectionReferences.diagnostics,
        environmentVariables.diagnostics,
        modelDiagnostics
      ),
      warnings: mergeDiagnosticLists(
        solution.warnings,
        components.warnings,
        dependencies.warnings,
        connectionReferences.warnings,
        environmentVariables.warnings,
        modelWarnings
      ),
      suggestedNextActions: solution.suggestedNextActions,
      provenance,
    });
  }

  async compare(uniqueName: string, target: SolutionService): Promise<OperationResult<SolutionCompareResult | undefined>> {
    const [sourceAnalysis, targetAnalysis] = await Promise.all([this.analyze(uniqueName), target.analyze(uniqueName)]);

    if (!sourceAnalysis.success) {
      return sourceAnalysis as unknown as OperationResult<SolutionCompareResult | undefined>;
    }

    if (!targetAnalysis.success) {
      return targetAnalysis as unknown as OperationResult<SolutionCompareResult | undefined>;
    }

    if (!sourceAnalysis.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: sourceAnalysis.diagnostics,
        warnings: mergeDiagnosticLists(sourceAnalysis.warnings, targetAnalysis.warnings),
      });
    }

    return ok(buildCompareResult(uniqueName, sourceAnalysis.data, targetAnalysis.data), {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(sourceAnalysis.diagnostics, targetAnalysis.diagnostics),
      warnings: mergeDiagnosticLists(sourceAnalysis.warnings, targetAnalysis.warnings),
    });
  }

  compareLocal(uniqueName: string, source: SolutionAnalysis, target: SolutionAnalysis): OperationResult<SolutionCompareResult> {
    return ok(buildCompareResult(uniqueName, source, target), {
      supportTier: 'preview',
    });
  }

  async analyzeArtifact(options: SolutionArtifactAnalyzeOptions): Promise<OperationResult<SolutionAnalysis>> {
    if (!options.packagePath && !options.unpackedPath) {
      return fail(
        createDiagnostic('error', 'SOLUTION_ARTIFACT_SOURCE_REQUIRED', 'Provide either a solution package path or an unpacked solution path.', {
          source: '@pp/solution',
        }),
        {
          supportTier: 'preview',
        }
      );
    }

    if (options.packagePath && options.unpackedPath) {
      return fail(
        createDiagnostic('error', 'SOLUTION_ARTIFACT_SOURCE_AMBIGUOUS', 'Provide only one solution artifact source at a time.', {
          source: '@pp/solution',
        }),
        {
          supportTier: 'preview',
        }
      );
    }

    if (options.unpackedPath) {
      return analyzeUnpackedArtifact(resolve(options.unpackedPath), {
        kind: 'unpacked',
      });
    }

    const packagePath = resolve(options.packagePath!);
    const tempDir = await mkdtemp(join(tmpdir(), 'pp-solution-compare-'));

    try {
      const unpack = await this.unpack(packagePath, {
        outDir: tempDir,
        packageType: 'both',
        pacExecutable: options.pacExecutable,
      });

      if (!unpack.success) {
        return unpack as unknown as OperationResult<SolutionAnalysis>;
      }

      return await analyzeUnpackedArtifact(tempDir, {
        kind: 'zip',
        packagePath,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async exportSolution(uniqueName: string, options: SolutionExportOptions = {}): Promise<OperationResult<SolutionExportResult>> {
    const solution = await this.inspect(uniqueName);

    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionExportResult>;
    }

    if (!solution.data) {
      return fail(
        [
          ...solution.diagnostics,
          createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`, {
            source: '@pp/solution',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: solution.warnings,
        }
      );
    }

    const analysis = await this.analyze(uniqueName);

    if (!analysis.success) {
      return analysis as unknown as OperationResult<SolutionExportResult>;
    }

    const packageType: Exclude<SolutionPackageType, 'both'> = options.managed ? 'managed' : 'unmanaged';
    const outputPath = resolveOutputPath(uniqueName, packageType, options.outPath, options.outDir);
    await mkdir(dirname(outputPath), { recursive: true });

    const exportResult = await this.dataverseClient.invokeAction<{ ExportSolutionFile?: string }>('ExportSolution', {
      SolutionName: uniqueName,
      Managed: packageType === 'managed',
    }, {
      timeoutMs: options.requestTimeoutMs,
    });

    if (!exportResult.success) {
      const workflowExportContext = await this.describeWorkflowExportContext(uniqueName);
      const exportContradictionContext = describeManagedExportContradiction(
        uniqueName,
        packageType,
        solution.data,
        exportResult.diagnostics
      );

      return fail(
        mergeDiagnosticLists(
          solution.diagnostics,
          analysis.diagnostics,
          exportResult.diagnostics,
          workflowExportContext?.diagnostics,
          exportContradictionContext?.diagnostics
        ),
        {
          supportTier: 'preview',
          details: {
            solution: solution.data,
            packageType,
            managedStateContradiction: exportContradictionContext?.details,
          } satisfies SolutionExportFailureDetails,
          warnings: mergeDiagnosticLists(
            solution.warnings,
            analysis.warnings,
            exportResult.warnings,
            workflowExportContext?.warnings,
            exportContradictionContext?.warnings
          ),
          suggestedNextActions: Array.from(
            new Set([
              ...(exportContradictionContext?.suggestedNextActions ?? []),
              ...(workflowExportContext?.suggestedNextActions ?? []),
            ])
          ),
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse ExportSolution',
            },
            ...(workflowExportContext?.provenance ?? []),
          ],
        }
      );
    }

    const exportFile = exportResult.data?.body?.ExportSolutionFile;

    if (!exportFile) {
      return fail(
        [
          ...solution.diagnostics,
          ...analysis.diagnostics,
          ...exportResult.diagnostics,
          createDiagnostic('error', 'SOLUTION_EXPORT_EMPTY', `Solution ${uniqueName} did not return an export payload.`, {
            source: '@pp/solution',
            path: outputPath,
          }),
        ],
        {
          supportTier: 'preview',
          warnings: mergeDiagnosticLists(solution.warnings, analysis.warnings, exportResult.warnings),
        }
      );
    }

    const content = Buffer.from(exportFile, 'base64');
    await writeFile(outputPath, content);
    const normalizedPackage = await normalizeSolutionArchivePackageType(outputPath, packageType);

    if (!normalizedPackage.success) {
      return fail(
        mergeDiagnosticLists(solution.diagnostics, analysis.diagnostics, exportResult.diagnostics, normalizedPackage.diagnostics),
        {
          supportTier: 'preview',
          warnings: mergeDiagnosticLists(solution.warnings, analysis.warnings, exportResult.warnings, normalizedPackage.warnings),
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse ExportSolution',
            },
          ],
        }
      );
    }

    const artifact = await buildArtifactFile('solution-zip', outputPath);
    const manifestPath = resolveManifestPath(outputPath, options.manifestPath);
    const manifest = createReleaseManifest(solution.data, packageType, artifact, analysis.data);
    await writeReleaseManifest(manifestPath, manifest, dirname(outputPath));

    return ok(
      {
        solution: solution.data,
        packageType,
        artifact,
        manifest,
        manifestPath,
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(solution.diagnostics, analysis.diagnostics, exportResult.diagnostics),
        warnings: mergeDiagnosticLists(solution.warnings, analysis.warnings, exportResult.warnings, normalizedPackage.warnings),
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse ExportSolution',
          },
        ],
      }
    );
  }

  async publish(uniqueName: string, options: SolutionPublishOptions = {}): Promise<OperationResult<SolutionPublishResult>> {
    const solution = await this.inspect(uniqueName);
    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionPublishResult>;
    }

    if (!solution.data) {
      return fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`), {
        supportTier: 'preview',
        suggestedNextActions: solution.suggestedNextActions,
      });
    }

    const prePublish = await this.collectPublishPrecheckContext(uniqueName);

    const publishResult = await this.dataverseClient.invokeAction<void>(
      'PublishAllXml',
      {},
      {
        responseType: 'void',
      }
    );

    if (!publishResult.success) {
      return fail(publishResult.diagnostics, {
        supportTier: 'preview',
        warnings: publishResult.warnings,
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse PublishAllXml',
          },
        ],
      });
    }

    if (!options.waitForExport) {
      const syncStatus = await this.syncStatus(uniqueName, {
        includeExportCheck: true,
        managed: options.exportOptions?.managed,
        outDir: options.exportOptions?.outDir,
        outPath: options.exportOptions?.outPath,
        manifestPath: options.exportOptions?.manifestPath,
        requestTimeoutMs: options.exportOptions?.requestTimeoutMs,
      });
      if (!syncStatus.success || !syncStatus.data) {
        return fail(mergeDiagnosticLists(solution.diagnostics, publishResult.diagnostics, syncStatus.diagnostics), {
          supportTier: 'preview',
          warnings: prioritizeExportReadinessWarnings(mergeDiagnosticLists(solution.warnings, publishResult.warnings, syncStatus.warnings)),
          suggestedNextActions: syncStatus.suggestedNextActions,
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse PublishAllXml',
            },
            ...(syncStatus.provenance ?? []),
          ],
        });
      }
      const blockingWorkflowActions = buildBlockingWorkflowSuggestedNextActions(uniqueName, syncStatus.data.readBack);
      const readiness = buildSolutionReadinessAssessment(
        uniqueName,
        syncStatus.data.blockers,
        syncStatus.data.exportCheck,
        { publishAccepted: true, prePublishBlockers: prePublish.blockers }
      );
      const unchangedBlockerWarning = buildUnchangedPublishBlockerWarning(uniqueName, prePublish.blockers, syncStatus.data.blockers);
      return ok(
        {
          solution: solution.data,
          published: true,
          action: {
            name: 'PublishAllXml',
            accepted: true,
          },
          waitForExport: false,
          synchronization: syncStatus.data.synchronization,
          readiness,
          readBack: syncStatus.data.readBack,
          blockers: syncStatus.data.blockers,
          exportCheck: syncStatus.data.exportCheck,
        },
        {
          supportTier: 'preview',
          diagnostics: mergeDiagnosticLists(solution.diagnostics, publishResult.diagnostics, syncStatus.diagnostics),
          warnings: prioritizeExportReadinessWarnings(
            mergeDiagnosticLists(
              solution.warnings,
              prePublish.warnings,
              publishResult.warnings,
              syncStatus.warnings,
              buildBlockingWorkflowWarning(uniqueName, syncStatus.data.readBack)
                ? [buildBlockingWorkflowWarning(uniqueName, syncStatus.data.readBack)!]
                : undefined,
              unchangedBlockerWarning ? [unchangedBlockerWarning] : undefined,
              syncStatus.data.exportCheck.confirmed
                ? undefined
                : [
                    createDiagnostic(
                      'warning',
                      'SOLUTION_PUBLISH_SYNC_NOT_CONFIRMED',
                      `Publish for solution ${uniqueName} was accepted, but an immediate export-backed synchronization probe still did not confirm readiness.`,
                      {
                        source: '@pp/solution',
                        detail: describePublishReadBackSummary(syncStatus.data.readBack),
                        hint:
                          blockingWorkflowActions[0] ??
                          `Re-run \`pp solution publish ${uniqueName} --environment <alias> --wait-for-export\` when you need repeated export polling until one checkpoint succeeds.`,
                      }
                    ),
                  ]
            )
          ),
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse PublishAllXml',
            },
            ...prePublish.provenance,
            ...(syncStatus.provenance ?? []),
          ],
        }
      );
    }

    const pollIntervalMs = Math.max(1_000, options.pollIntervalMs ?? 5_000);
    const timeoutMs = Math.max(pollIntervalMs, options.timeoutMs ?? 120_000);
    const startedAt = Date.now();
    let attempts = 0;
    let lastExportResult: OperationResult<SolutionExportResult> | undefined;
    let lastExportDiagnostic: Pick<Diagnostic, 'code' | 'message'> | undefined;
    let lastObservedReadBack: SolutionPublishReadback | undefined;
    options.onProgress?.({
      stage: 'accepted',
      elapsedMs: 0,
      pollIntervalMs,
      timeoutMs,
      remainingMs: timeoutMs,
    });

    while (Date.now() - startedAt <= timeoutMs) {
      attempts += 1;
      lastObservedReadBack = (await this.describePublishReadBack(uniqueName))?.data;
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
      const blockedWorkflowExportCheck = buildBlockedWorkflowExportCheck(
        uniqueName,
        options.exportOptions?.managed ? 'managed' : 'unmanaged',
        lastObservedReadBack
      );
      if (blockedWorkflowExportCheck) {
        lastExportDiagnostic = selectPrimaryExportReadinessDiagnostic(
          blockedWorkflowExportCheck.failure?.diagnostics,
          blockedWorkflowExportCheck.failure?.warnings
        );
      }
      options.onProgress?.({
        stage: 'polling',
        attempt: attempts,
        elapsedMs: Date.now() - startedAt,
        remainingMs,
        pollIntervalMs,
        timeoutMs,
        latestExportDiagnostic: lastExportDiagnostic,
        readBack: lastObservedReadBack,
      });
      if (blockedWorkflowExportCheck) {
        const blockers = buildSolutionSyncStatusBlockers(lastObservedReadBack);
        const unchangedBlockerWarning = buildUnchangedPublishBlockerWarning(uniqueName, prePublish.blockers, blockers);
        return fail(
          [
            createDiagnostic(
              'error',
              'SOLUTION_PUBLISH_EXPORT_BLOCKED_WORKFLOW_STATE',
              `Publish for solution ${uniqueName} was accepted, but packaged workflow state already shows export readiness is blocked.`,
              {
                source: '@pp/solution',
                detail: describePublishReadBackSummary(lastObservedReadBack),
                hint: buildBlockingWorkflowSuggestedNextActions(uniqueName, lastObservedReadBack)[0],
              }
            ),
            ...solution.diagnostics,
            ...publishResult.diagnostics,
          ],
          {
            supportTier: 'preview',
            details: {
              solution: solution.data,
              published: false,
              action: {
                name: 'PublishAllXml',
                accepted: true,
              },
              waitForExport: true,
              synchronization: {
                kind: 'solution-export',
                confirmed: false,
                attempts,
                elapsedMs: Date.now() - startedAt,
              },
              readiness: buildSolutionReadinessAssessment(uniqueName, blockers, blockedWorkflowExportCheck, {
                publishAccepted: true,
                prePublishBlockers: prePublish.blockers,
              }),
              blockers,
              readBack: lastObservedReadBack,
              exportCheck: blockedWorkflowExportCheck,
            },
            warnings: prioritizeExportReadinessWarnings(
              mergeDiagnosticLists(
                solution.warnings,
                prePublish.warnings,
                publishResult.warnings,
                blockedWorkflowExportCheck.failure?.warnings,
                unchangedBlockerWarning ? [unchangedBlockerWarning] : undefined
              )
            ),
            suggestedNextActions: blockedWorkflowExportCheck.failure?.suggestedNextActions,
            provenance: [
              {
                kind: 'official-api',
                source: 'Dataverse PublishAllXml',
              },
              ...prePublish.provenance,
            ],
          }
        );
      }
      lastExportResult = await this.exportSolution(uniqueName, {
        ...options.exportOptions,
        requestTimeoutMs: remainingMs,
      });

      if (lastExportResult.success && lastExportResult.data) {
        const readBack = await this.describePublishReadBack(uniqueName);
        options.onProgress?.({
          stage: 'confirmed',
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
          remainingMs: Math.max(0, timeoutMs - (Date.now() - startedAt)),
          pollIntervalMs,
          timeoutMs,
        });
        return ok(
          {
            solution: solution.data,
            published: true,
            action: {
              name: 'PublishAllXml',
              accepted: true,
            },
            waitForExport: true,
            export: lastExportResult.data,
            synchronization: {
              kind: 'solution-export',
              confirmed: true,
              attempts,
              elapsedMs: Date.now() - startedAt,
            },
            readBack: readBack?.data,
            blockers: buildSolutionSyncStatusBlockers(readBack?.data),
          },
          {
            supportTier: 'preview',
            diagnostics: mergeDiagnosticLists(solution.diagnostics, publishResult.diagnostics, lastExportResult.diagnostics),
            warnings: mergeDiagnosticLists(
              solution.warnings,
              prePublish.warnings,
              publishResult.warnings,
              lastExportResult.warnings,
              readBack?.warnings
            ),
            provenance: [
              {
                kind: 'official-api',
                source: 'Dataverse PublishAllXml',
              },
              ...prePublish.provenance,
              {
                kind: 'official-api',
                source: 'Dataverse ExportSolution',
              },
              ...(readBack?.provenance ?? []),
            ],
          }
        );
      }

      lastExportDiagnostic = selectPrimaryExportReadinessDiagnostic(
        lastExportResult.diagnostics,
        mergeDiagnosticLists(
          lastExportResult.warnings,
          buildBlockingWorkflowWarning(uniqueName, lastObservedReadBack)
            ? [buildBlockingWorkflowWarning(uniqueName, lastObservedReadBack)!]
            : undefined
        )
      );

      if (Date.now() - startedAt >= timeoutMs) {
        break;
      }

      await sleep(pollIntervalMs);
    }

    const lastExportSplit = splitWarningDiagnostics(lastExportResult?.diagnostics);
    const finalBlockers = buildSolutionSyncStatusBlockers(lastObservedReadBack);
    const finalExportCheck: SolutionSyncStatusExportCheck = {
      attempted: true,
      confirmed: false,
      packageType: options.exportOptions?.managed ? 'managed' : 'unmanaged',
      failure: lastExportResult
        ? {
            ...normalizeExportCheckFailure(lastExportResult.diagnostics, lastExportResult.warnings),
            suggestedNextActions: lastExportResult.suggestedNextActions,
            details: lastExportResult.details,
          }
        : undefined,
    };
    const unchangedBlockerWarning = buildUnchangedPublishBlockerWarning(uniqueName, prePublish.blockers, finalBlockers);
    return fail(
      mergeDiagnosticLists(
        [
          createDiagnostic(
            'error',
            'SOLUTION_PUBLISH_EXPORT_TIMEOUT',
            `Publish for solution ${uniqueName} was accepted, but no solution export checkpoint succeeded within ${timeoutMs}ms.`,
            {
              source: '@pp/solution',
              hint: 'Retry with a longer timeout, or inspect the latest export diagnostics to see why packaging never stabilized.',
            }
          ),
        ],
        solution.diagnostics,
        publishResult.diagnostics,
        lastExportSplit.diagnostics
      ),
      {
        supportTier: 'preview',
        details: {
          solution: solution.data,
          published: false,
          action: {
            name: 'PublishAllXml',
            accepted: true,
          },
          waitForExport: true,
          synchronization: {
            kind: 'solution-export',
            confirmed: false,
            attempts,
            elapsedMs: Date.now() - startedAt,
          },
          readiness: buildSolutionReadinessAssessment(uniqueName, finalBlockers, finalExportCheck, {
            publishAccepted: true,
            prePublishBlockers: prePublish.blockers,
          }),
          blockers: finalBlockers,
          readBack: lastObservedReadBack,
          exportCheck: finalExportCheck,
        },
        warnings: prioritizeExportReadinessWarnings(
          mergeDiagnosticLists(
            solution.warnings,
            prePublish.warnings,
            publishResult.warnings,
            lastExportSplit.warnings,
            lastExportResult?.warnings,
            buildBlockingWorkflowWarning(uniqueName, lastObservedReadBack)
              ? [buildBlockingWorkflowWarning(uniqueName, lastObservedReadBack)!]
              : undefined,
            unchangedBlockerWarning ? [unchangedBlockerWarning] : undefined,
            lastObservedReadBack
              ? [
                  createDiagnostic(
                    'warning',
                    'SOLUTION_PUBLISH_LAST_READBACK',
                    `Latest component read-back for solution ${uniqueName} was captured before the export checkpoint timed out.`,
                    {
                      source: '@pp/solution',
                      detail: describePublishReadBackSummary(lastObservedReadBack),
                      hint: `Run \`pp solution sync-status ${uniqueName} --environment <alias> --format json\` to capture the same component read-back alongside a fresh export probe.`,
                    }
                  ),
                ]
              : undefined
          )
        ),
        suggestedNextActions: [
          ...buildBlockingWorkflowSuggestedNextActions(uniqueName, lastObservedReadBack),
          `Retry with \`pp solution publish ${uniqueName} --environment <alias> --wait-for-export --timeout-ms ${timeoutMs * 2}\`.`,
          `Run \`pp solution sync-status ${uniqueName} --environment <alias> --format json\` to capture component read-back and the current export probe in one response.`,
          `Run \`pp solution export ${uniqueName} --environment <alias> --format json\` to inspect the current packaging failure directly.`,
        ],
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse PublishAllXml',
          },
          ...prePublish.provenance,
          {
            kind: 'official-api',
            source: 'Dataverse ExportSolution',
          },
        ],
      }
    );
  }

  async syncStatus(uniqueName: string, options: SolutionSyncStatusOptions = {}): Promise<OperationResult<SolutionSyncStatusResult>> {
    const startedAt = Date.now();
    const solution = await this.inspect(uniqueName);
    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionSyncStatusResult>;
    }

    if (!solution.data) {
      return fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`), {
        supportTier: 'preview',
        suggestedNextActions: solution.suggestedNextActions,
      });
    }

    const readBackResult = await this.readPublishReadBack(uniqueName);
    if (!readBackResult.success || !readBackResult.data) {
      return readBackResult as unknown as OperationResult<SolutionSyncStatusResult>;
    }
    const blockingWorkflowActions = buildBlockingWorkflowSuggestedNextActions(uniqueName, readBackResult.data);
    options.onProgress?.({
      stage: 'readback-complete',
      elapsedMs: Date.now() - startedAt,
      readBack: readBackResult.data,
    });

    const packageType: Exclude<SolutionPackageType, 'both'> = options.managed ? 'managed' : 'unmanaged';
    const includeExportCheck = options.includeExportCheck ?? true;
    let tempOutDir: string | undefined;
    let tempManifestPath: string | undefined;
    let exportCheck: SolutionSyncStatusExportCheck = {
      attempted: false,
      confirmed: false,
      packageType,
    };

    if (includeExportCheck) {
      options.onProgress?.({
        stage: 'export-check-started',
        elapsedMs: Date.now() - startedAt,
        packageType,
        readBack: readBackResult.data,
      });
      const blockedWorkflowExportCheck = buildBlockedWorkflowExportCheck(uniqueName, packageType, readBackResult.data);
      if (blockedWorkflowExportCheck) {
        exportCheck = blockedWorkflowExportCheck;
        options.onProgress?.({
          stage: 'export-check-complete',
          elapsedMs: Date.now() - startedAt,
          packageType,
          readBack: readBackResult.data,
          exportConfirmed: false,
          latestExportDiagnostic: selectPrimaryExportReadinessDiagnostic(
            blockedWorkflowExportCheck.failure?.diagnostics,
            blockedWorkflowExportCheck.failure?.warnings
          ),
        });
      } else {
        if (!options.outDir && !options.outPath) {
          tempOutDir = await mkdtemp(join(tmpdir(), 'pp-solution-sync-status-'));
        }
        if (!options.manifestPath && tempOutDir) {
          tempManifestPath = join(tempOutDir, `${uniqueName}.${packageType}.pp-solution.json`);
        }

        try {
          const exportResult = await this.exportSolution(uniqueName, {
            managed: options.managed,
            outDir: options.outDir ?? tempOutDir,
            outPath: options.outPath,
            manifestPath: options.manifestPath ?? tempManifestPath,
            requestTimeoutMs: options.requestTimeoutMs,
          });

          if (exportResult.success && exportResult.data) {
            exportCheck = {
              attempted: true,
              confirmed: true,
              packageType,
              artifact: options.outDir || options.outPath ? exportResult.data.artifact : undefined,
              manifest: options.outDir || options.outPath || options.manifestPath ? exportResult.data.manifest : undefined,
              manifestPath: options.outDir || options.outPath || options.manifestPath ? exportResult.data.manifestPath : undefined,
            };
            options.onProgress?.({
              stage: 'export-check-complete',
              elapsedMs: Date.now() - startedAt,
              packageType,
              readBack: readBackResult.data,
              exportConfirmed: true,
            });
          } else {
            const normalizedExportFailure = normalizeExportCheckFailure(
              exportResult.diagnostics,
              mergeDiagnosticLists(
                exportResult.warnings,
                buildBlockingWorkflowWarning(uniqueName, readBackResult.data)
                  ? [buildBlockingWorkflowWarning(uniqueName, readBackResult.data)!]
                  : undefined
              )
            );
            exportCheck = {
              attempted: true,
              confirmed: false,
              packageType,
              failure: {
                diagnostics: normalizedExportFailure.diagnostics,
                warnings: normalizedExportFailure.warnings,
                suggestedNextActions: [...new Set([...(blockingWorkflowActions ?? []), ...(exportResult.suggestedNextActions ?? [])])],
                details: exportResult.details,
              },
            };
            options.onProgress?.({
              stage: 'export-check-complete',
              elapsedMs: Date.now() - startedAt,
              packageType,
              readBack: readBackResult.data,
              exportConfirmed: false,
              latestExportDiagnostic: selectPrimaryExportReadinessDiagnostic(
                exportResult.diagnostics,
                mergeDiagnosticLists(
                  exportResult.warnings,
                  buildBlockingWorkflowWarning(uniqueName, readBackResult.data)
                    ? [buildBlockingWorkflowWarning(uniqueName, readBackResult.data)!]
                    : undefined
                )
              ),
            });
          }
        } finally {
          if (tempOutDir) {
            await rm(tempOutDir, { recursive: true, force: true });
          }
        }
      }
    }

    const blockers = buildSolutionSyncStatusBlockers(readBackResult.data);
    return ok(
      {
        solution: solution.data,
        synchronization: {
          kind: 'solution-export',
          confirmed: exportCheck.confirmed,
        },
        readiness: buildSolutionReadinessAssessment(uniqueName, blockers, exportCheck),
        blockers,
        readBack: readBackResult.data,
        exportCheck,
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(solution.diagnostics, readBackResult.diagnostics),
        warnings: prioritizeExportReadinessWarnings(
          mergeDiagnosticLists(solution.warnings, readBackResult.warnings, exportCheck.failure?.warnings)
        ),
        provenance: [
          ...(readBackResult.provenance ?? []),
        ],
      }
    );
  }

  private async collectPublishPrecheckContext(uniqueName: string): Promise<SolutionPublishPrecheckContext> {
    const readBack = await this.describePublishReadBack(uniqueName);
    if (!readBack?.data) {
      return {
        blockers: [],
        warnings: [],
        provenance: [],
      };
    }

    return {
      readBack: readBack.data,
      blockers: buildSolutionSyncStatusBlockers(readBack.data),
      warnings: readBack.warnings ?? [],
      provenance: readBack.provenance ?? [],
    };
  }

  private async buildMissingSolutionSuggestions(uniqueName: string): Promise<string[]> {
    const [listed, publishers] = await Promise.all([this.list(), this.loadPublisherSummaries()]);

    if (!listed.success) {
      return [
        `Run \`pp solution list --environment <alias> --format json\` to inspect the visible solution unique names before retrying ${uniqueName}.`,
        `If ${uniqueName} has not been created or imported into this environment yet, do that first; \`pp solution publish\` and \`pp solution sync-status\` only work after the target solution exists remotely.`,
        `Run \`pp solution publishers --environment <alias> --format json\` to choose a safe publisher before creating ${uniqueName}.`,
      ];
    }

    const available = listed.data ?? [];
    const relatedVisibleCandidate = chooseLatestVisibleSolution(
      available.filter((solution) => isCredibleMissingSolutionAlternative(uniqueName, solution))
    );
    const creationSuggestions = [
      `If ${uniqueName} has not been created or imported into this environment yet, do that first; \`pp solution publish\` and \`pp solution sync-status\` only work after the target solution exists remotely.`,
      `Run \`pp solution publishers --environment <alias> --format json\` to choose a safe publisher before creating ${uniqueName}.`,
      ...this.buildPublisherSuggestions(uniqueName, publishers),
      `If ${uniqueName} should come from a package artifact instead of a new shell, import that solution into this environment before retrying publish or sync-status.`,
    ];

    return Array.from(
      new Set(
        [
          available.length > 0
            ? `Run \`pp solution list --environment <alias> --format json\` to inspect the ${available.length} visible solution unique name${available.length === 1 ? '' : 's'} before retrying ${uniqueName}.`
            : `Run \`pp solution list --environment <alias> --format json\` to confirm which solutions are visible before retrying ${uniqueName}.`,
          relatedVisibleCandidate
            ? `Closest visible candidate: \`${relatedVisibleCandidate.uniquename}\`${relatedVisibleCandidate.version ? ` (version ${relatedVisibleCandidate.version})` : ''}. Inspect it with \`pp solution inspect ${relatedVisibleCandidate.uniquename} --environment <alias> --format json\` only if you expected a renamed or newer shell from the same solution family instead of ${uniqueName}.`
            : undefined,
          ...creationSuggestions,
        ].filter((value): value is string => Boolean(value))
      )
    );
  }

  private async describeWorkflowExportContext(uniqueName: string): Promise<{
    diagnostics?: Diagnostic[];
    warnings?: Diagnostic[];
    suggestedNextActions?: string[];
    provenance?: Array<{ kind: 'official-api'; source: string }>;
  } | undefined> {
    const components = await this.components(uniqueName);

    if (!components.success) {
      return undefined;
    }

    const workflowIds = new Set(
      (components.data ?? [])
        .filter((component) => component.componentType === 29 && component.objectId)
        .map((component) => component.objectId!.toLowerCase())
    );

    if (workflowIds.size === 0) {
      return undefined;
    }

    const workflows = await queryAllOrEmpty<{
      workflowid: string;
      name?: string;
      uniquename?: string;
      category?: number;
      statecode?: number;
      statuscode?: number;
    }>(this.dataverseClient, workflowIds, 'workflows', 'workflowid', ['workflowid', 'name', 'uniquename', 'category', 'statecode', 'statuscode']);

    if (!workflows.success) {
      return undefined;
    }

    const workflowDetails = (workflows.data ?? [])
      .map((workflow) => {
        const label = workflow.name ?? workflow.uniquename ?? workflow.workflowid;
        const workflowState = describeWorkflowState(workflow.statecode, workflow.statuscode);
        return {
          id: workflow.workflowid,
          label,
          uniqueName: workflow.uniquename,
          workflowState,
          category: workflow.category,
          stateCode: workflow.statecode,
          statusCode: workflow.statuscode,
          summary: `${label} [id=${workflow.workflowid}; category=${workflow.category ?? 'unknown'}; state=${workflowState}]`,
        };
      })
      .sort((left, right) => left.summary.localeCompare(right.summary));

    const workflowSummaries = workflowDetails.map((workflow) => workflow.summary);

    if (workflowSummaries.length === 0) {
      return undefined;
    }

    const blockingWorkflowDetails = workflowDetails.filter((workflow) => workflow.workflowState !== 'activated');
    const blockingWorkflowActions = blockingWorkflowDetails.flatMap((workflow) => {
      const identifier = workflow.uniqueName ?? workflow.label ?? workflow.id;
      const inspectFilter = buildWorkflowInspectFilter(workflow);
      const sharedActions = [
        `Run \`pp flow inspect ${identifier} --environment <alias> --solution ${uniqueName} --format json\` to compare definition availability with the packaged workflow state ${workflow.workflowState}.`,
        inspectFilter
          ? `Run \`pp dv query workflows --environment <alias> --filter "${inspectFilter}" --select workflowid,name,uniquename,category,statecode,statuscode --format json\` to inspect the raw Dataverse workflow rows for this blocker without relying on unsupported solution scoping.`
          : 'Query Dataverse workflows environment-wide with `pp dv query workflows --environment <alias> --select workflowid,name,uniquename,category,statecode,statuscode --format json` if you need the raw workflow row for this blocker.',
      ];

      if (workflow.category === 5) {
        return [
          ...sharedActions,
          buildModernFlowActivationLimitationSummary(identifier, uniqueName),
        ];
      }

      return [
        ...sharedActions,
        `If ${identifier} should already be runnable, activate it in place with \`pp flow activate ${identifier} --environment <alias> --solution ${uniqueName} --format json\`.`,
      ];
    });

    return {
      warnings: [
        createDiagnostic(
          'warning',
          'SOLUTION_EXPORT_WORKFLOW_CONTEXT',
          `Solution ${uniqueName} includes ${workflowSummaries.length} workflow component(s), which can block ExportSolution when a flow remains draft or otherwise fails Dataverse workflow packaging.`,
          {
            source: '@pp/solution',
            detail: workflowSummaries.join('; '),
            hint: 'Inspect the listed workflow with `pp flow inspect <name|id|uniqueName> --environment <alias>` before retrying export.',
          }
        ),
        ...(blockingWorkflowDetails.length > 0
          ? [
              createDiagnostic(
                'warning',
                'SOLUTION_EXPORT_BLOCKED_WORKFLOW_STATE',
                `Solution ${uniqueName} still has packaged workflow components in a non-runnable state, so ExportSolution is likely to keep failing until those flows become runnable.`,
                {
                  source: '@pp/solution',
                  detail: blockingWorkflowDetails
                    .map(
                      (workflow) =>
                        `${workflow.label} state=${workflow.workflowState} (statecode=${workflow.stateCode ?? 'unknown'}, statuscode=${workflow.statusCode ?? 'unknown'})`
                    )
                    .join('; '),
                  hint: blockingWorkflowActions[0],
                }
              ),
            ]
          : []),
      ],
      suggestedNextActions: [
        ...blockingWorkflowActions,
        `Run \`pp solution components ${uniqueName} --environment <alias> --format json\` to confirm which workflow components are packaged.`,
        'Inspect any draft or unexpected workflow state before retrying export.',
      ],
      provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse workflows',
        },
      ],
    };
  }

  private async describePublishReadBack(uniqueName: string): Promise<{
    data: SolutionPublishReadback;
    warnings?: Diagnostic[];
    provenance?: ProvenanceRecord[];
  } | undefined> {
    const result = await this.readPublishReadBack(uniqueName);
    if (!result.success || !result.data) {
      return undefined;
    }

    return {
      data: result.data,
      warnings: result.warnings,
      provenance: result.provenance,
    };
  }

  private async readPublishReadBack(uniqueName: string): Promise<OperationResult<SolutionPublishReadback>> {
    const components = await this.components(uniqueName);

    if (!components.success || !components.data) {
      return components as unknown as OperationResult<SolutionPublishReadback>;
    }

    const componentTypeCounts = summarizeComponentTypeCounts(components.data);
    const canvasIds = new Set(
      components.data
        .filter((component) => component.componentType === 300 && component.objectId)
        .map((component) => component.objectId!.toLowerCase())
    );
    const workflowIds = new Set(
      components.data
        .filter((component) => component.componentType === 29 && component.objectId)
        .map((component) => component.objectId!.toLowerCase())
    );
    const modelDrivenAppIds = new Set(
      components.data
        .filter((component) => component.componentType === 80 && component.objectId)
        .map((component) => component.objectId!.toLowerCase())
    );

    const [canvasApps, workflows, modelDrivenApps] = await Promise.all([
      queryAllOrEmpty<{ canvasappid: string; displayname?: string; name?: string; lastpublishtime?: string }>(
        this.dataverseClient,
        canvasIds,
        'canvasapps',
        'canvasappid',
        ['canvasappid', 'displayname', 'name', 'lastpublishtime']
      ),
      queryAllOrEmpty<{
        workflowid: string;
        name?: string;
        uniquename?: string;
        category?: number;
        statecode?: number;
        statuscode?: number;
        clientdata?: string;
      }>(
        this.dataverseClient,
        workflowIds,
        'workflows',
        'workflowid',
        ['workflowid', 'name', 'uniquename', 'category', 'statecode', 'statuscode', 'clientdata']
      ),
      queryAllOrEmpty<{ appmoduleid: string; name?: string; uniquename?: string; statecode?: number; publishedon?: string }>(
        this.dataverseClient,
        modelDrivenAppIds,
        'appmodules',
        'appmoduleid',
        ['appmoduleid', 'name', 'uniquename', 'statecode', 'publishedon']
      ),
    ]);

    if (!canvasApps.success || !workflows.success || !modelDrivenApps.success) {
      return fail(
        mergeDiagnosticLists(canvasApps.diagnostics, workflows.diagnostics, modelDrivenApps.diagnostics),
        {
          supportTier: 'preview',
          warnings: mergeDiagnosticLists(components.warnings, canvasApps.warnings, workflows.warnings, modelDrivenApps.warnings),
        }
      );
    }

    const readBackCanvasApps = (canvasApps.data ?? [])
      .map((app) => ({
        id: app.canvasappid,
        name: app.displayname ?? app.name,
        logicalName: app.name,
        lastPublishTime: app.lastpublishtime,
      }))
      .sort(compareNamedReadBackItems);
    const readBackWorkflows = (workflows.data ?? [])
      .map((workflow) => ({
        id: workflow.workflowid,
        name: workflow.name ?? workflow.uniquename,
        logicalName: workflow.uniquename,
        category: workflow.category,
        workflowState: describeWorkflowState(workflow.statecode, workflow.statuscode),
        stateCode: workflow.statecode,
        statusCode: workflow.statuscode,
        definitionAvailable: hasWorkflowDefinition(workflow.clientdata),
      }))
      .sort(compareNamedReadBackItems);
    const readBackModelDrivenApps = (modelDrivenApps.data ?? [])
      .map((app) => ({
        id: app.appmoduleid,
        name: app.name ?? app.uniquename,
        uniqueName: app.uniquename,
        stateCode: app.statecode,
        publishedOn: app.publishedon,
      }))
      .sort(compareNamedReadBackItems);

    return ok(
      {
        summary: {
          componentCount: components.data.length,
          componentTypeCounts,
          canvasAppCount: canvasApps.data?.length ?? 0,
          workflowCount: workflows.data?.length ?? 0,
          modelDrivenAppCount: modelDrivenApps.data?.length ?? 0,
        },
        signals: summarizePublishReadBackSignals(readBackCanvasApps, readBackWorkflows, readBackModelDrivenApps),
        canvasApps: readBackCanvasApps,
        workflows: readBackWorkflows,
        modelDrivenApps: readBackModelDrivenApps,
      },
      {
        supportTier: 'preview',
        diagnostics: components.diagnostics,
        warnings: mergeDiagnosticLists(components.warnings, canvasApps.warnings, workflows.warnings, modelDrivenApps.warnings),
        provenance: [
        {
          kind: 'official-api',
          source: 'Dataverse canvasapps',
        },
        {
          kind: 'official-api',
          source: 'Dataverse workflows',
        },
        {
          kind: 'official-api',
          source: 'Dataverse appmodules',
        },
        ],
      }
    );
  }

  async importSolution(packagePath: string, options: SolutionImportOptions = {}): Promise<OperationResult<SolutionImportResult>> {
    const resolvedPackagePath = resolve(packagePath);
    const packageBytes = await readFile(resolvedPackagePath);
    const manifestPath = resolveAdjacentManifestPath(resolvedPackagePath);
    const manifest = await readReleaseManifest(manifestPath);
    const normalizedOptions = {
      publishWorkflows: options.publishWorkflows ?? true,
      overwriteUnmanagedCustomizations: options.overwriteUnmanagedCustomizations ?? false,
      holdingSolution: options.holdingSolution ?? false,
      skipProductUpdateDependencies: options.skipProductUpdateDependencies ?? false,
      importJobId: options.importJobId ?? randomUUID(),
    };

    const importResult = await this.dataverseClient.invokeAction<void>('ImportSolution', {
      CustomizationFile: packageBytes.toString('base64'),
      PublishWorkflows: normalizedOptions.publishWorkflows,
      OverwriteUnmanagedCustomizations: normalizedOptions.overwriteUnmanagedCustomizations,
      HoldingSolution: normalizedOptions.holdingSolution,
      SkipProductUpdateDependencies: normalizedOptions.skipProductUpdateDependencies,
      ImportJobId: normalizedOptions.importJobId,
    }, {
      responseType: 'void',
    });

    if (!importResult.success) {
      return fail(importResult.diagnostics, {
        supportTier: 'preview',
        warnings: importResult.warnings,
        suggestedNextActions: explainImportFailure(importResult.diagnostics, manifest.data),
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse ImportSolution',
          },
        ],
      });
    }

    return ok(
      {
        packagePath: resolvedPackagePath,
        manifestPath: manifest.success ? manifestPath : undefined,
        packageType: manifest.data?.solution.packageType,
        imported: true,
        options: normalizedOptions,
        manifest: manifest.data,
      },
      {
        supportTier: 'preview',
        diagnostics: importResult.diagnostics,
        warnings: mergeDiagnosticLists(importResult.warnings, manifest.warnings),
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse ImportSolution',
          },
        ],
      }
    );
  }

  async pack(sourceFolder: string, options: SolutionPackOptions): Promise<OperationResult<SolutionPackResult>> {
    const resolvedSourceFolder = resolve(sourceFolder);
    const outputPath = resolve(options.outPath);
    await mkdir(dirname(outputPath), { recursive: true });

    const packageType = options.packageType ?? 'unmanaged';
    const command = await this.runPacCommand({
      pacExecutable: options.pacExecutable,
      args: [
        'solution',
        'pack',
        '--folder',
        resolvedSourceFolder,
        '--zipfile',
        outputPath,
        '--packagetype',
        toPacPackageType(packageType),
        ...(options.mapFile ? ['--map', resolve(options.mapFile)] : []),
      ],
    });

    if (!command.success) {
      return command as unknown as OperationResult<SolutionPackResult>;
    }

    const artifact = await buildArtifactFile('solution-zip', outputPath);

    return ok(
      {
        packageType,
        artifact,
        sourceFolder: resolvedSourceFolder,
      },
      {
        supportTier: 'preview',
        diagnostics: command.diagnostics,
        warnings: command.warnings,
        provenance: [
          {
            kind: 'official-artifact',
            source: 'pac solution pack',
          },
        ],
      }
    );
  }

  async unpack(packagePath: string, options: SolutionUnpackOptions): Promise<OperationResult<SolutionUnpackResult>> {
    const resolvedPackagePath = resolve(packagePath);
    const outputDir = resolve(options.outDir);
    await mkdir(outputDir, { recursive: true });

    const resolvedPackageType = await resolveSolutionUnpackPackageType(resolvedPackagePath, options.packageType);

    if (!resolvedPackageType.success || !resolvedPackageType.data) {
      return resolvedPackageType as unknown as OperationResult<SolutionUnpackResult>;
    }

    const packageType = resolvedPackageType.data;
    const command = await this.runPacCommand({
      pacExecutable: options.pacExecutable,
      args: [
        'solution',
        'unpack',
        '--zipfile',
        resolvedPackagePath,
        '--folder',
        outputDir,
        '--packagetype',
        toPacPackageType(packageType),
        ...(options.allowDelete ? ['--allowDelete', 'true'] : []),
        ...(options.mapFile ? ['--map', resolve(options.mapFile)] : []),
      ],
    });

    if (!command.success) {
      return command as unknown as OperationResult<SolutionUnpackResult>;
    }

    const sourcePackage = await buildArtifactFile('solution-zip', resolvedPackagePath);
    const unpackedRoot = await buildDirectoryArtifact(outputDir);

    return ok(
      {
        packageType,
        sourcePackage,
        unpackedRoot,
      },
      {
        supportTier: 'preview',
        diagnostics: command.diagnostics,
        warnings: mergeDiagnosticLists(resolvedPackageType.warnings, command.warnings),
        provenance: [
          {
            kind: 'official-artifact',
            source: 'pac solution unpack',
          },
        ],
      }
    );
  }

  async readReleaseManifest(path: string): Promise<OperationResult<SolutionReleaseManifest | undefined>> {
    return readReleaseManifest(resolve(path));
  }

  async inspectPackageMetadata(packagePath: string): Promise<OperationResult<SolutionPackageMetadata | undefined>> {
    const resolvedPackagePath = resolve(packagePath);
    const manifestPath = resolveAdjacentManifestPath(resolvedPackagePath);
    const manifest = await readReleaseManifest(manifestPath);

    if (!manifest.success) {
      return manifest as unknown as OperationResult<SolutionPackageMetadata | undefined>;
    }

    if (manifest.data) {
      return ok(
        {
          uniqueName: manifest.data.solution.uniqueName,
          friendlyName: manifest.data.solution.friendlyName,
          version: manifest.data.solution.version,
          packageType: manifest.data.solution.packageType,
          manifestPath,
          source: 'manifest',
        },
        {
          supportTier: 'preview',
          warnings: manifest.warnings,
          provenance: [
            {
              kind: 'official-artifact',
              source: 'pp solution release manifest',
            },
          ],
        }
      );
    }

    const archivePackageType = await readSolutionArchivePackageType(resolvedPackagePath);
    if (!archivePackageType.success || !archivePackageType.data) {
      return archivePackageType as unknown as OperationResult<SolutionPackageMetadata | undefined>;
    }

    const archiveMetadata = await readSolutionArchiveMetadata(resolvedPackagePath);
    if (!archiveMetadata.success) {
      return archiveMetadata as unknown as OperationResult<SolutionPackageMetadata | undefined>;
    }

    return ok(
      {
        uniqueName: archiveMetadata.data?.uniqueName,
        friendlyName: archiveMetadata.data?.friendlyName,
        version: archiveMetadata.data?.version,
        packageType: archivePackageType.data,
        manifestPath,
        source: 'archive',
      },
      {
        supportTier: 'preview',
        warnings: mergeDiagnosticLists(archivePackageType.warnings, archiveMetadata.warnings),
        provenance: [
          {
            kind: 'official-artifact',
            source: 'solution package metadata',
          },
        ],
      }
    );
  }

  async listPublishers(): Promise<OperationResult<SolutionPublisherSummary[]>> {
    const publishers = await this.dataverseClient.query<PublisherSummary>({
      table: 'publishers',
      select: ['publisherid', 'uniquename', 'friendlyname'],
      orderBy: ['uniquename asc'],
    });

    if (!publishers.success) {
      return publishers as unknown as OperationResult<SolutionPublisherSummary[]>;
    }

    return ok(
      (publishers.data ?? [])
        .filter((publisher): publisher is PublisherSummary => Boolean(publisher.publisherid))
        .map((publisher) => ({
          publisherid: publisher.publisherid,
          uniquename: publisher.uniquename,
          friendlyname: publisher.friendlyname,
        })),
      {
        supportTier: 'preview',
        diagnostics: publishers.diagnostics,
        warnings: publishers.warnings,
      }
    );
  }

  private async resolvePublisherId(uniqueName: string | undefined): Promise<string | undefined> {
    if (!uniqueName) {
      return undefined;
    }

    const publishers = await this.dataverseClient.query<PublisherSummary>({
      table: 'publishers',
      select: ['publisherid', 'uniquename'],
      filter: `uniquename eq '${escapeODataString(uniqueName)}'`,
      top: 1,
    });

    if (!publishers.success) {
      return undefined;
    }

    return publishers.data?.[0]?.publisherid;
  }

  private async loadPublisherSummaries(): Promise<PublisherSummary[]> {
    const publishers = await this.dataverseClient.query<PublisherSummary>({
      table: 'publishers',
      select: ['publisherid', 'uniquename', 'friendlyname', 'customizationprefix'],
      top: 10,
    });

    if (!publishers.success) {
      return [];
    }

    return (publishers.data ?? []).filter((publisher): publisher is PublisherSummary => Boolean(publisher.publisherid));
  }

  private formatPublisherList(publishers: PublisherSummary[] | undefined): string | undefined {
    if (!publishers?.length) {
      return undefined;
    }

    return publishers
      .map((publisher) => {
        const label = publisher.uniquename ?? publisher.publisherid;
        return publisher.friendlyname && publisher.friendlyname !== publisher.uniquename
          ? `${label} (${publisher.friendlyname}, ${publisher.publisherid})`
          : `${label} (${publisher.publisherid})`;
      })
      .join(', ');
  }

  private inferCreatePublisher(uniqueName: string, publishers: PublisherSummary[] | undefined): PublisherSummary | undefined {
    if (!publishers?.length) {
      return undefined;
    }

    const normalizedUniqueName = uniqueName.trim().toLowerCase();
    if (!normalizedUniqueName) {
      return undefined;
    }

    const matches = publishers
      .filter((publisher) => publisher.customizationprefix?.trim())
      .filter((publisher) => normalizedUniqueName.startsWith(publisher.customizationprefix!.trim().toLowerCase()))
      .sort((left, right) => (right.customizationprefix?.length ?? 0) - (left.customizationprefix?.length ?? 0));

    if (matches.length === 0) {
      return publishers.length === 1 ? publishers[0] : undefined;
    }

    const bestPrefixLength = matches[0]?.customizationprefix?.trim().length ?? 0;
    const bestMatches = matches.filter((publisher) => (publisher.customizationprefix?.trim().length ?? 0) === bestPrefixLength);

    return bestMatches.length === 1 ? bestMatches[0] : undefined;
  }

  private buildPublisherSuggestions(uniqueName: string, publishers: PublisherSummary[] | undefined): string[] {
    if (!publishers?.length) {
      return [
        `Run \`pp dv query publishers --environment <alias> --select publisherid,uniquename,friendlyname --format json\` to inspect available publishers before retrying \`pp solution create ${uniqueName}\`.`,
      ];
    }

    return publishers.slice(0, 3).map((publisher) =>
      publisher.uniquename
        ? `Retry with \`pp solution create ${uniqueName} --environment <alias> --publisher-unique-name ${publisher.uniquename}\`.`
        : `Retry with \`pp solution create ${uniqueName} --environment <alias> --publisher-id ${publisher.publisherid}\`.`
    );
  }

  private async enrichSolutionSummary(record: SolutionInspectRecord | undefined): Promise<SolutionSummary | undefined> {
    if (!record) {
      return undefined;
    }

    const publisherFromExpand = normalizePublisherSummary(record.publisherid);

    if (publisherFromExpand) {
      return {
        solutionid: record.solutionid,
        uniquename: record.uniquename,
        friendlyname: record.friendlyname,
        version: record.version,
        ismanaged: record.ismanaged,
        publisher: publisherFromExpand,
      };
    }

    const publisherId = record._publisherid_value;

    if (!publisherId) {
      return {
        solutionid: record.solutionid,
        uniquename: record.uniquename,
        friendlyname: record.friendlyname,
        version: record.version,
        ismanaged: record.ismanaged,
      };
    }

    const publisher = await this.dataverseClient.getById<SolutionPublisherSummary>('publishers', publisherId, {
      select: ['publisherid', 'uniquename', 'friendlyname', 'customizationprefix', 'customizationoptionvalueprefix'],
    });

    return {
      solutionid: record.solutionid,
      uniquename: record.uniquename,
      friendlyname: record.friendlyname,
      version: record.version,
      ismanaged: record.ismanaged,
      publisher: normalizePublisherSummary(publisher.success ? publisher.data : undefined) ?? { publisherid: publisherId },
    };
  }

  private async runPacCommand(options: { pacExecutable?: string; args: string[]; cwd?: string }) {
    return this.commandRunner.run({
      executable: options.pacExecutable ?? 'pac',
      args: options.args,
      cwd: options.cwd,
    });
  }
}

function rewriteMissingSolutionWarnings(uniqueName: string, warnings: Diagnostic[]): Diagnostic[] {
  const retained = warnings.filter((warning) => warning.code !== 'DATAVERSE_QUERY_EMPTY_RESULT_AMBIGUOUS_SCOPE');
  const hadAmbiguousEmptyResult = retained.length !== warnings.length;

  if (!hadAmbiguousEmptyResult) {
    return warnings;
  }

  return [
    ...retained,
    createDiagnostic(
      'warning',
      'SOLUTION_NOT_VISIBLE_IN_SCOPE',
      `Solution ${uniqueName} was not visible in the current Dataverse scope.`,
      {
        source: '@pp/solution',
        hint: 'This usually means the solution is absent, but security-filtered visibility can still hide rows. If you expected it to exist, confirm the active identity or run a broader known-good solution list before treating the absence as authoritative.',
      }
    ),
  ];
}

class DefaultSolutionCommandRunner implements SolutionCommandRunner {
  async run(invocation: SolutionCommandInvocation): Promise<OperationResult<SolutionCommandResult>> {
    return new Promise((resolvePromise) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const spawnInvocation = normalizeCommandInvocationForCurrentPlatform(invocation);
      const child = spawn(spawnInvocation.executable, spawnInvocation.args, {
        cwd: invocation.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error) => {
        resolvePromise(
          fail(
            createDiagnostic(
              'error',
              'SOLUTION_TOOL_EXECUTION_FAILED',
              `Failed to launch ${invocation.executable}: ${error.message}`,
              {
                source: '@pp/solution',
                detail: invocation.args.join(' '),
              }
            ),
            {
              supportTier: 'preview',
            }
          )
        );
      });
      child.on('close', (exitCode) => {
        const result: SolutionCommandResult = {
          ...invocation,
          exitCode: exitCode ?? 0,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        };

        if ((exitCode ?? 0) !== 0) {
          resolvePromise(
            fail(
              createDiagnostic(
                'error',
                'SOLUTION_TOOL_COMMAND_FAILED',
                `${invocation.executable} exited with code ${exitCode ?? 0}.`,
                {
                  source: '@pp/solution',
                  detail: result.stderr || result.stdout || invocation.args.join(' '),
                }
              ),
              {
                supportTier: 'preview',
              }
            )
          );
          return;
        }

        resolvePromise(
          ok(result, {
            supportTier: 'preview',
          })
        );
      });
    });
  }
}

export function normalizeCommandInvocationForCurrentPlatform(invocation: SolutionCommandInvocation): SolutionCommandInvocation {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(invocation.executable)) {
    return invocation;
  }

  return {
    executable: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', invocation.executable, ...invocation.args],
    cwd: invocation.cwd,
  };
}

function normalizeSolutionComponent(component: SolutionComponentRecord): SolutionComponentSummary {
  return {
    id: component.solutioncomponentid,
    objectId: component.objectid,
    componentType: component.componenttype,
    componentTypeLabel: describeComponentType(component.componenttype),
    isMetadata: component.ismetadata,
    rootComponentBehavior: component.rootcomponentbehavior,
  };
}

function applyComponentResolutions(
  components: SolutionComponentSummary[],
  resolutions: Map<string, SolutionDependencyComponentResolution>
): SolutionComponentSummary[] {
  return components.map((component) => {
    const resolution = getDependencyComponentResolution(resolutions, component.componentType, component.objectId);

    if (!resolution) {
      return component;
    }

    return {
      ...component,
      name: resolution.name,
      logicalName: resolution.logicalName,
      table: resolution.table,
      entitySetName: resolution.entitySetName,
    };
  });
}

function normalizePublisherSummary(publisher: SolutionPublisherSummary | undefined): SolutionPublisherSummary | undefined {
  if (!publisher?.publisherid) {
    return undefined;
  }

  return {
    publisherid: publisher.publisherid,
    uniquename: publisher.uniquename,
    friendlyname: publisher.friendlyname,
    customizationprefix: publisher.customizationprefix,
    customizationoptionvalueprefix: publisher.customizationoptionvalueprefix,
  };
}

function normalizeSolutionDependency(
  dependency: SolutionDependencyRecord,
  componentIds: Set<string>
): SolutionDependencySummary {
  const normalized: Omit<SolutionDependencySummary, 'importRisk'> = {
    id: dependency.dependencyid,
    dependencyType: dependency.dependencytype,
    requiredComponentObjectId: dependency.requiredcomponentobjectid,
    requiredComponentType: dependency.requiredcomponenttype,
    requiredComponentTypeLabel: describeComponentType(dependency.requiredcomponenttype),
    requiredComponentTypeHint: describeUnknownComponentTypeHint(dependency.requiredcomponenttype),
    dependentComponentObjectId: dependency.dependentcomponentobjectid,
    dependentComponentType: dependency.dependentcomponenttype,
    dependentComponentTypeLabel: describeComponentType(dependency.dependentcomponenttype),
    dependentComponentTypeHint: describeUnknownComponentTypeHint(dependency.dependentcomponenttype),
    missingRequiredComponent: Boolean(
      dependency.requiredcomponentobjectid && !componentIds.has(dependency.requiredcomponentobjectid)
    ),
  };

  return {
    ...normalized,
    importRisk: classifySolutionDependencyImportRisk(normalized),
  };
}

function classifySolutionDependencyImportRisk(
  dependency: Omit<SolutionDependencySummary, 'importRisk'>
): SolutionDependencyImportRisk {
  if (!dependency.missingRequiredComponent) {
    return {
      classification: 'resolved',
      severity: 'none',
      reason: 'The required component is already present in the solution.',
    };
  }

  if (dependency.requiredComponentType === 1 && dependency.requiredComponentCustom === false) {
    return {
      classification: 'expected-external',
      severity: 'info',
      reason: `The missing ${dependency.requiredComponentLogicalName ?? dependency.requiredComponentName ?? 'Dataverse table'} is a standard Dataverse table, so it is usually expected to exist in the target environment outside this solution package.`,
      suggestedAction:
        'Confirm the target environment already has access to the standard table and any required security roles instead of treating this as a same-solution packaging defect.',
    };
  }

  if (dependency.requiredComponentType === 1 && dependency.requiredComponentCustom === true) {
    return {
      classification: 'likely-import-blocker',
      severity: 'warning',
      reason: `The missing ${dependency.requiredComponentLogicalName ?? dependency.requiredComponentName ?? 'custom table'} is a custom Dataverse table, so target environments usually need it deployed by this solution or by a coordinated prerequisite solution.`,
      suggestedAction:
        'Add the custom table to the solution or document and validate the prerequisite solution in the target environment before export/import.',
    };
  }

  if ([24, 26, 29, 60, 61, 62, 80, 300, 371, 380].includes(dependency.requiredComponentType ?? -1)) {
    return {
      classification: 'likely-import-blocker',
      severity: 'warning',
      reason: `The missing ${dependency.requiredComponentTypeLabel} is another solution component rather than a standard platform table, so cross-environment import usually stays blocked until that component is packaged or provisioned separately.`,
      suggestedAction:
        'Package the component with the solution or capture an explicit prerequisite/install step for the target environment.',
    };
  }

  return {
    classification: 'review-required',
    severity: 'warning',
    reason:
      'pp could not confidently classify this missing component from the available metadata, so export/import risk still needs manual review.',
    suggestedAction:
      'Inspect the dependency in Maker or Dataverse metadata and decide whether it is a platform prerequisite or a missing same-solution component.',
  };
}

function summarizeComponentTypeCounts(components: SolutionComponentSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const component of components) {
    counts[component.componentTypeLabel] = (counts[component.componentTypeLabel] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function compareNamedReadBackItems<T extends { name?: string; id: string }>(left: T, right: T): number {
  return (left.name ?? left.id).localeCompare(right.name ?? right.id);
}

function describePublishReadBackSummary(readBack: SolutionPublishReadback | undefined): string | undefined {
  if (!readBack) {
    return undefined;
  }

  const parts: string[] = [];
  const canvasSignals = readBack.signals.canvasApps;
  const workflowSignals = readBack.signals.workflows;
  const modelSignals = readBack.signals.modelDrivenApps;

  if (canvasSignals.total > 0 || workflowSignals.total > 0 || modelSignals.total > 0) {
    parts.push(
      [
        canvasSignals.total > 0
          ? `canvas publish observed=${canvasSignals.published}/${canvasSignals.total}${canvasSignals.unknown > 0 ? ` unknown=${canvasSignals.unknown}` : ''}`
          : undefined,
        workflowSignals.total > 0
          ? `workflow activation observed=${workflowSignals.activated}/${workflowSignals.total}${workflowSignals.blocked > 0 ? ` blocked=${workflowSignals.blocked}` : ''}${workflowSignals.other > 0 ? ` other=${workflowSignals.other}` : ''}`
          : undefined,
        modelSignals.total > 0
          ? `model-driven publish observed=${modelSignals.published}/${modelSignals.total}${modelSignals.unknown > 0 ? ` unknown=${modelSignals.unknown}` : ''}`
          : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' | ')
    );
  }

  if (readBack.canvasApps.length > 0) {
    parts.push(
      `canvas apps: ${readBack.canvasApps
        .map((app) => `${app.name ?? app.logicalName ?? app.id} lastPublishTime=${app.lastPublishTime ?? 'unknown'}`)
        .join('; ')}`
    );
  }

  if (readBack.workflows.length > 0) {
    parts.push(
      `workflows: ${readBack.workflows
        .map((workflow) => `${workflow.name ?? workflow.logicalName ?? workflow.id} state=${describeWorkflowReadBackState(workflow)}`)
        .join('; ')}`
    );
  }

  if (readBack.modelDrivenApps.length > 0) {
    parts.push(
      `model-driven apps: ${readBack.modelDrivenApps
        .map((app) => `${app.name ?? app.uniqueName ?? app.id} publishedOn=${app.publishedOn ?? 'unknown'}`)
        .join('; ')}`
    );
  }

  return parts.length > 0 ? parts.join(' | ') : undefined;
}

function summarizePublishReadBackSignals(
  canvasApps: SolutionPublishCanvasReadback[],
  workflows: SolutionPublishWorkflowReadback[],
  modelDrivenApps: SolutionPublishModelDrivenAppReadback[]
): SolutionPublishReadbackSignals {
  return {
    canvasApps: {
      total: canvasApps.length,
      published: canvasApps.filter((app) => Boolean(app.lastPublishTime)).length,
      unknown: canvasApps.filter((app) => !app.lastPublishTime).length,
    },
    workflows: {
      total: workflows.length,
      activated: workflows.filter((workflow) => workflow.workflowState === 'activated').length,
      draft: workflows.filter((workflow) => workflow.workflowState === 'draft').length,
      suspended: workflows.filter((workflow) => workflow.workflowState === 'suspended').length,
      other: workflows.filter(
        (workflow) =>
          workflow.workflowState !== undefined &&
          workflow.workflowState !== 'activated' &&
          workflow.workflowState !== 'draft' &&
          workflow.workflowState !== 'suspended'
      ).length,
      blocked: workflows.filter((workflow) => workflow.workflowState === 'draft' || workflow.workflowState === 'suspended').length,
    },
    modelDrivenApps: {
      total: modelDrivenApps.length,
      published: modelDrivenApps.filter((app) => Boolean(app.publishedOn)).length,
      unknown: modelDrivenApps.filter((app) => !app.publishedOn).length,
    },
  };
}

function getBlockingWorkflowReadBacks(readBack: SolutionPublishReadback | undefined): SolutionPublishWorkflowReadback[] {
  return (readBack?.workflows ?? []).filter(
    (workflow) => workflow.workflowState === 'draft' || workflow.workflowState === 'suspended'
  );
}

function hasBlockingWorkflowReadBacks(readBack: SolutionPublishReadback | undefined): boolean {
  return getBlockingWorkflowReadBacks(readBack).length > 0;
}

function formatWorkflowIdentifier(workflow: SolutionPublishWorkflowReadback): string {
  return workflow.logicalName ?? workflow.name ?? workflow.id;
}

function isModernFlowReadBack(workflow: SolutionPublishWorkflowReadback): boolean {
  return workflow.category === 5;
}

function describeWorkflowReadBackState(workflow: SolutionPublishWorkflowReadback): string {
  const state = workflow.workflowState ?? 'unknown';
  const definitionLabel =
    workflow.definitionAvailable === undefined ? undefined : `definitionAvailable=${workflow.definitionAvailable ? 'true' : 'false'}`;

  if (workflow.stateCode === undefined && workflow.statusCode === undefined) {
    return definitionLabel ? `${state} (${definitionLabel})` : state;
  }

  const parts = [
    `statecode=${workflow.stateCode ?? 'unknown'}`,
    `statuscode=${workflow.statusCode ?? 'unknown'}`,
    ...(definitionLabel ? [definitionLabel] : []),
  ];
  return `${state} (${parts.join(', ')})`;
}

function buildWorkflowInspectFilter(workflow: {
  id?: string;
  uniqueName?: string;
  label?: string;
}): string | undefined {
  const clauses: string[] = [];

  if (workflow.id) {
    clauses.push(`workflowid eq ${workflow.id}`);
  }

  if (workflow.uniqueName) {
    clauses.push(`uniquename eq '${workflow.uniqueName.replace(/'/g, "''")}'`);
  }

  if (workflow.label && workflow.label !== workflow.uniqueName) {
    clauses.push(`name eq '${workflow.label.replace(/'/g, "''")}'`);
  }

  if (clauses.length === 0) {
    return undefined;
  }

  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' or ')})`;
}

function buildWorkflowBlockerReason(workflow: SolutionPublishWorkflowReadback): string {
  const label = workflow.name ?? workflow.logicalName ?? workflow.id;
  const definitionDetail =
    workflow.definitionAvailable === true
      ? ' even though the workflow definition payload is available in Dataverse'
      : workflow.definitionAvailable === false
        ? ' and Dataverse readback does not expose a workflow definition payload'
        : '';
  return `Workflow ${label} is still ${describeWorkflowReadBackState(workflow)}${definitionDetail}, so solution export readiness remains blocked.`;
}

function hasWorkflowDefinition(clientdata: string | undefined): boolean {
  if (!clientdata) {
    return false;
  }

  try {
    const parsed = JSON.parse(clientdata) as { definition?: unknown; properties?: { definition?: unknown } };
    return isJsonRecord(parsed.definition) || isJsonRecord(parsed.properties?.definition);
  } catch {
    return false;
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildBlockingWorkflowSuggestedNextActions(
  solutionUniqueName: string,
  readBack: SolutionPublishReadback | undefined
): string[] {
  const blocking = getBlockingWorkflowReadBacks(readBack);

  if (blocking.length === 0) {
    return [];
  }

  const actions = blocking.flatMap((workflow) => {
    const identifier = formatWorkflowIdentifier(workflow);
    const inspectFilter = buildWorkflowInspectFilter({
      id: workflow.id,
      uniqueName: workflow.logicalName,
      label: workflow.name,
    });
    const sharedActions = [
      `Run \`pp flow inspect ${identifier} --environment <alias> --solution ${solutionUniqueName} --format json\` to compare definition availability with the packaged workflow state ${describeWorkflowReadBackState(workflow)}.`,
      inspectFilter
        ? `Run \`pp dv query workflows --environment <alias> --filter "${inspectFilter}" --select workflowid,name,uniquename,category,statecode,statuscode --format json\` to inspect the raw Dataverse workflow rows for this blocker without relying on unsupported solution scoping.`
        : 'Query Dataverse workflows environment-wide with `pp dv query workflows --environment <alias> --select workflowid,name,uniquename,category,statecode,statuscode --format json` if you need the raw workflow row for this blocker.',
    ];

    if (isModernFlowReadBack(workflow)) {
      return [
        ...sharedActions,
        buildModernFlowActivationLimitationSummary(identifier, solutionUniqueName),
      ];
    }

    return [
      ...sharedActions,
      `If ${identifier} should already be runnable, activate it in place with \`pp flow activate ${identifier} --environment <alias> --solution ${solutionUniqueName} --format json\`.`,
    ];
  });

  return [...new Set(actions)];
}

function buildBlockingWorkflowWarning(
  solutionUniqueName: string,
  readBack: SolutionPublishReadback | undefined
): Diagnostic | undefined {
  const blocking = getBlockingWorkflowReadBacks(readBack);

  if (blocking.length === 0) {
    return undefined;
  }

  return createDiagnostic(
    'warning',
    'SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE',
    `Solution ${solutionUniqueName} still has packaged workflow components in a non-runnable state, so export readiness is expected to stay false until those flows become runnable.`,
    {
      source: '@pp/solution',
      detail: blocking
        .map((workflow) => `${workflow.name ?? workflow.logicalName ?? workflow.id} state=${describeWorkflowReadBackState(workflow)}`)
        .join('; '),
      hint: buildBlockingWorkflowSuggestedNextActions(solutionUniqueName, readBack)[0],
    }
  );
}

function buildUnchangedPublishBlockerWarning(
  solutionUniqueName: string,
  prePublishBlockers: SolutionSyncStatusBlocker[],
  postPublishBlockers: SolutionSyncStatusBlocker[]
): Diagnostic | undefined {
  const unchanged = postPublishBlockers.filter((blocker) => findEquivalentWorkflowBlocker(blocker, prePublishBlockers));
  if (unchanged.length === 0) {
    return undefined;
  }

  return createDiagnostic(
    'warning',
    'SOLUTION_PUBLISH_BLOCKERS_UNCHANGED',
    `PublishAllXml for solution ${solutionUniqueName} completed, but the same workflow blockers observed before publish still remain afterward.`,
    {
      source: '@pp/solution',
      detail: unchanged.map(describeWorkflowBlockerForComparison).join('; '),
      hint: unchanged[0]?.remediation?.cliCommand ?? `Run \`pp solution sync-status ${solutionUniqueName} --environment <alias> --format json\` to inspect the remaining blockers.`,
    }
  );
}

function buildBlockedWorkflowExportCheck(
  solutionUniqueName: string,
  packageType: Exclude<SolutionPackageType, 'both'>,
  readBack: SolutionPublishReadback | undefined
): SolutionSyncStatusExportCheck | undefined {
  if (!hasBlockingWorkflowReadBacks(readBack)) {
    return undefined;
  }

  const blockingWarning = buildBlockingWorkflowWarning(solutionUniqueName, readBack);
  const skipWarning = createDiagnostic(
    'warning',
    'SOLUTION_EXPORT_CHECK_SKIPPED_BLOCKED_WORKFLOW_STATE',
    `Skipped the export-readiness probe for solution ${solutionUniqueName} because packaged workflow state already shows export readiness is blocked.`,
    {
      source: '@pp/solution',
      detail: describePublishReadBackSummary(readBack),
      hint: buildBlockingWorkflowSuggestedNextActions(solutionUniqueName, readBack)[0],
    }
  );

  return {
    attempted: false,
    confirmed: false,
    packageType,
    failure: {
      diagnostics: [],
      warnings: prioritizeExportReadinessWarnings([skipWarning, ...(blockingWarning ? [blockingWarning] : [])]),
      suggestedNextActions: buildBlockingWorkflowSuggestedNextActions(solutionUniqueName, readBack),
      details: {
        reason: 'blocked-workflow-state',
        readBack,
      },
    },
  };
}

function buildSolutionSyncStatusBlockers(readBack: SolutionPublishReadback | undefined): SolutionSyncStatusBlocker[] {
  return getBlockingWorkflowReadBacks(readBack).map((workflow) => ({
    kind: 'workflow-state',
    componentType: 'workflow',
    id: workflow.id,
    name: workflow.name,
    logicalName: workflow.logicalName,
    category: workflow.category,
    workflowState: workflow.workflowState,
    stateCode: workflow.stateCode,
    statusCode: workflow.statusCode,
    definitionAvailable: workflow.definitionAvailable,
    reason: buildWorkflowBlockerReason(workflow),
    remediation: isModernFlowReadBack(workflow)
      ? {
          kind: 'activate-in-place',
          mcpMutationAvailable: true,
          mcpTool: {
            name: 'pp.flow.activate',
            arguments: {
              environment: '<alias>',
              identifier: formatWorkflowIdentifier(workflow),
              solutionUniqueName: '<solution>',
            },
          },
          alternativeMcpTools: [
            {
              name: 'pp.flow.deploy',
              arguments: {
                environment: '<alias>',
                path: '<local-flow-artifact>',
                solutionUniqueName: '<solution>',
                target: formatWorkflowIdentifier(workflow),
                workflowState: 'activated',
              },
              summary:
                'Redeploy the local flow artifact back onto this workflow when you need a richer pp-native retry than in-place activation alone.',
            },
          ],
          cliCommand: `pp flow activate ${formatWorkflowIdentifier(workflow)} --environment <alias> --solution <solution> --format json`,
          alternativeCliCommands: [
            `pp flow deploy <local-flow-artifact> --environment <alias> --solution <solution> --target ${formatWorkflowIdentifier(workflow)} --workflow-state activated --format json`,
          ],
          limitationCode: 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
          summary: buildModernFlowActivationLimitationSummary(formatWorkflowIdentifier(workflow), '<solution>'),
        }
      : {
          kind: 'activate-in-place',
          mcpMutationAvailable: true,
          mcpTool: {
            name: 'pp.flow.activate',
            arguments: {
              environment: '<alias>',
              identifier: formatWorkflowIdentifier(workflow),
              solutionUniqueName: '<solution>',
            },
          },
          cliCommand: `pp flow activate ${formatWorkflowIdentifier(workflow)} --environment <alias> --solution <solution> --format json`,
          summary:
            'Retry in-place activation through MCP `pp.flow.activate` or the CLI when this workflow should already be runnable.',
        },
  }));
}

function findEquivalentWorkflowBlocker(
  blocker: SolutionSyncStatusBlocker,
  candidates: ReadonlyArray<SolutionSyncStatusBlocker>
): SolutionSyncStatusBlocker | undefined {
  return candidates.find((candidate) => (
    candidate.kind === 'workflow-state' &&
    blocker.kind === 'workflow-state' &&
    candidate.componentType === blocker.componentType &&
    candidate.id === blocker.id &&
    candidate.logicalName === blocker.logicalName &&
    candidate.workflowState === blocker.workflowState &&
    candidate.definitionAvailable === blocker.definitionAvailable
  ));
}

function describeWorkflowBlockerForComparison(blocker: SolutionSyncStatusBlocker): string {
  const definitionDetail =
    blocker.definitionAvailable === true
      ? 'definitionAvailable=true'
      : blocker.definitionAvailable === false
        ? 'definitionAvailable=false'
        : 'definitionAvailable=unknown';
  return `${describeWorkflowBlockerLabel(blocker)} state=${blocker.workflowState ?? 'unknown'} (${definitionDetail})`;
}

function describeWorkflowBlockerLabel(blocker: SolutionSyncStatusBlocker): string {
  return blocker.name ?? blocker.logicalName ?? blocker.id;
}

function buildSolutionReadinessAssessment(
  solutionUniqueName: string,
  blockers: SolutionSyncStatusBlocker[],
  exportCheck: SolutionSyncStatusExportCheck,
  options: {
    publishAccepted?: boolean;
    prePublishBlockers?: SolutionSyncStatusBlocker[];
  } = {}
): SolutionReadinessAssessment {
  const primaryBlocker = blockers[0];
  const publishPrefix = options.publishAccepted
    ? `PublishAllXml was accepted for solution ${solutionUniqueName}, but`
    : `Solution ${solutionUniqueName}`;
  const prePublishPrimaryBlocker = primaryBlocker
    ? findEquivalentWorkflowBlocker(primaryBlocker, options.prePublishBlockers ?? [])
    : undefined;
  const prePublishBlockerCount = options.prePublishBlockers?.length;

  if (primaryBlocker) {
    const primaryDefinitionDetail =
      primaryBlocker.definitionAvailable === true
        ? ' even though Dataverse readback shows definitionAvailable=true'
        : primaryBlocker.definitionAvailable === false
          ? ' and Dataverse readback still shows definitionAvailable=false'
          : '';
    return {
      state: 'blocked',
      summary:
        prePublishPrimaryBlocker && options.publishAccepted
          ? `${publishPrefix} export readiness is still blocked by the same workflow ${describeWorkflowBlockerLabel(primaryBlocker)} in state ${primaryBlocker.workflowState ?? 'unknown'}${primaryDefinitionDetail}; that blocker was already present before publish.`
          : `${publishPrefix} export readiness is still blocked by workflow ${describeWorkflowBlockerLabel(primaryBlocker)} in state ${primaryBlocker.workflowState ?? 'unknown'}${primaryDefinitionDetail}.`,
      exportReadinessConfirmed: false,
      blockerCount: blockers.length,
      ...(options.publishAccepted !== undefined ? { publishAccepted: options.publishAccepted } : {}),
      ...(prePublishBlockerCount !== undefined ? { prePublishBlockerCount } : {}),
      ...(prePublishPrimaryBlocker ? { unchangedFromPrePublish: true } : {}),
      primaryBlocker: {
        kind: primaryBlocker.kind,
        componentType: primaryBlocker.componentType,
        id: primaryBlocker.id,
        name: primaryBlocker.name,
        logicalName: primaryBlocker.logicalName,
        workflowState: primaryBlocker.workflowState,
        definitionAvailable: primaryBlocker.definitionAvailable,
        reason: primaryBlocker.reason,
        remediation: primaryBlocker.remediation,
      },
    };
  }

  if (exportCheck.confirmed) {
    return {
      state: 'ready',
      summary: options.publishAccepted
        ? prePublishBlockerCount && prePublishBlockerCount > 0
          ? `PublishAllXml was accepted for solution ${solutionUniqueName}, and export readiness is confirmed after clearing ${prePublishBlockerCount} pre-publish workflow blocker${prePublishBlockerCount === 1 ? '' : 's'}.`
          : `PublishAllXml was accepted for solution ${solutionUniqueName}, and export readiness is confirmed.`
        : `Solution ${solutionUniqueName} is export-ready.`,
      exportReadinessConfirmed: true,
      blockerCount: 0,
      ...(options.publishAccepted !== undefined ? { publishAccepted: options.publishAccepted } : {}),
      ...(prePublishBlockerCount !== undefined ? { prePublishBlockerCount } : {}),
    };
  }

  if (!exportCheck.attempted) {
    return {
      state: 'unconfirmed',
      summary: options.publishAccepted
        ? prePublishBlockerCount && prePublishBlockerCount > 0
          ? `PublishAllXml was accepted for solution ${solutionUniqueName}, and pre-publish workflow blockers no longer appear in readback, but export readiness is still unconfirmed because no export probe completed.`
          : `PublishAllXml was accepted for solution ${solutionUniqueName}, but export readiness is still unconfirmed because no export probe completed.`
        : `Solution ${solutionUniqueName} read-back completed, but export readiness is still unconfirmed because no export probe completed.`,
      exportReadinessConfirmed: false,
      blockerCount: 0,
      ...(options.publishAccepted !== undefined ? { publishAccepted: options.publishAccepted } : {}),
      ...(prePublishBlockerCount !== undefined ? { prePublishBlockerCount } : {}),
    };
  }

  return {
    state: 'unconfirmed',
    summary: options.publishAccepted
      ? prePublishBlockerCount && prePublishBlockerCount > 0
        ? `PublishAllXml was accepted for solution ${solutionUniqueName}, and pre-publish workflow blockers no longer appear in readback, but the immediate export-backed synchronization probe did not confirm readiness.`
        : `PublishAllXml was accepted for solution ${solutionUniqueName}, but the immediate export-backed synchronization probe did not confirm readiness.`
      : `Solution ${solutionUniqueName} has no explicit packaged workflow blockers, but the export probe still did not confirm readiness.`,
    exportReadinessConfirmed: false,
    blockerCount: 0,
    ...(options.publishAccepted !== undefined ? { publishAccepted: options.publishAccepted } : {}),
    ...(prePublishBlockerCount !== undefined ? { prePublishBlockerCount } : {}),
  };
}

function applyDependencyComponentResolutions(
  dependencies: SolutionDependencySummary[],
  resolutions: Map<string, SolutionDependencyComponentResolution>
): SolutionDependencySummary[] {
  return dependencies.map((dependency) => {
    const required = getDependencyComponentResolution(resolutions, dependency.requiredComponentType, dependency.requiredComponentObjectId);
    const dependent = getDependencyComponentResolution(
      resolutions,
      dependency.dependentComponentType,
      dependency.dependentComponentObjectId
    );

    return {
      ...dependency,
      requiredComponentName: required?.name ?? dependency.requiredComponentName,
      requiredComponentLogicalName: required?.logicalName ?? dependency.requiredComponentLogicalName,
      requiredComponentTable: required?.table ?? dependency.requiredComponentTable,
      requiredComponentCustom: required?.custom ?? dependency.requiredComponentCustom,
      dependentComponentName: dependent?.name ?? dependency.dependentComponentName,
      dependentComponentLogicalName: dependent?.logicalName ?? dependency.dependentComponentLogicalName,
      dependentComponentTable: dependent?.table ?? dependency.dependentComponentTable,
      importRisk: classifySolutionDependencyImportRisk({
        ...dependency,
        requiredComponentName: required?.name ?? dependency.requiredComponentName,
        requiredComponentLogicalName: required?.logicalName ?? dependency.requiredComponentLogicalName,
        requiredComponentTable: required?.table ?? dependency.requiredComponentTable,
        requiredComponentCustom: required?.custom ?? dependency.requiredComponentCustom,
        dependentComponentName: dependent?.name ?? dependency.dependentComponentName,
        dependentComponentLogicalName: dependent?.logicalName ?? dependency.dependentComponentLogicalName,
        dependentComponentTable: dependent?.table ?? dependency.dependentComponentTable,
      }),
    };
  });
}

function getDependencyComponentResolution(
  resolutions: Map<string, SolutionDependencyComponentResolution>,
  componentType: number | undefined,
  objectId: string | undefined
): SolutionDependencyComponentResolution | undefined {
  if (componentType === undefined || !objectId) {
    return undefined;
  }

  return resolutions.get(buildDependencyResolutionKey(componentType, objectId));
}

function collectDependencyResolutionRequests(dependencies: SolutionDependencySummary[]): ComponentResolutionRequests {
  const requests: ComponentResolutionRequests = {
    entityIds: new Set<string>(),
    appModuleIds: new Set<string>(),
    canvasAppIds: new Set<string>(),
    workflowIds: new Set<string>(),
    webResourceIds: new Set<string>(),
    sitemapIds: new Set<string>(),
    formIds: new Set<string>(),
    viewIds: new Set<string>(),
    connectionReferenceIds: new Set<string>(),
    environmentVariableDefinitionIds: new Set<string>(),
  };

  for (const dependency of dependencies) {
    collectDependencyResolutionRequest(requests, dependency.requiredComponentType, dependency.requiredComponentObjectId);
    collectDependencyResolutionRequest(requests, dependency.dependentComponentType, dependency.dependentComponentObjectId);
  }

  return requests;
}

function collectDependencyResolutionRequest(
  requests: ComponentResolutionRequests,
  componentType: number | undefined,
  objectId: string | undefined
): void {
  if (componentType === undefined || !objectId) {
    return;
  }

  switch (componentType) {
    case 1:
      requests.entityIds.add(objectId.toLowerCase());
      break;
    case 24:
    case 60:
      requests.formIds.add(objectId.toLowerCase());
      break;
    case 26:
      requests.viewIds.add(objectId.toLowerCase());
      break;
    case 29:
      requests.workflowIds.add(objectId.toLowerCase());
      break;
    case 61:
      requests.webResourceIds.add(objectId.toLowerCase());
      break;
    case 62:
      requests.sitemapIds.add(objectId.toLowerCase());
      break;
    case 80:
      requests.appModuleIds.add(objectId.toLowerCase());
      break;
    case 300:
      requests.canvasAppIds.add(objectId.toLowerCase());
      break;
    case 371:
      requests.connectionReferenceIds.add(objectId.toLowerCase());
      break;
    case 380:
      requests.environmentVariableDefinitionIds.add(objectId.toLowerCase());
      break;
    default:
      break;
  }
}

function collectComponentResolutionRequests(components: SolutionComponentSummary[]): ComponentResolutionRequests {
  const requests: ComponentResolutionRequests = {
    entityIds: new Set<string>(),
    appModuleIds: new Set<string>(),
    canvasAppIds: new Set<string>(),
    workflowIds: new Set<string>(),
    webResourceIds: new Set<string>(),
    sitemapIds: new Set<string>(),
    formIds: new Set<string>(),
    viewIds: new Set<string>(),
    connectionReferenceIds: new Set<string>(),
    environmentVariableDefinitionIds: new Set<string>(),
  };

  for (const component of components) {
    collectDependencyResolutionRequest(requests, component.componentType, component.objectId);
  }

  return requests;
}

async function queryAllOrEmpty<T extends Record<string, unknown>>(
  dataverseClient: DataverseClient,
  ids: Set<string>,
  table: string,
  idColumn: string,
  select: string[]
): Promise<OperationResult<T[]>> {
  if (ids.size === 0) {
    return ok([] as T[], { supportTier: 'preview' });
  }

  return dataverseClient.queryAll<T>({
    table,
    select,
    filter: buildGuidOrFilter(idColumn, ids),
  });
}

function buildGuidOrFilter(column: string, ids: Set<string>): string | undefined {
  const clauses = Array.from(ids)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => `${column} eq ${id}`);

  return clauses.length > 0 ? clauses.join(' or ') : undefined;
}

function addComponentResolutions<T>(
  resolutions: Map<string, SolutionDependencyComponentResolution>,
  componentType: number,
  records: T[],
  readId: (record: T) => string | undefined,
  normalize: (record: T) => SolutionDependencyComponentResolution
): void {
  for (const record of records) {
    const id = readId(record);

    if (!id) {
      continue;
    }

    resolutions.set(buildDependencyResolutionKey(componentType, id), normalize(record));
  }
}

function buildDependencyResolutionKey(componentType: number, objectId: string): string {
  return `${componentType}:${objectId.toLowerCase()}`;
}

function describeComponentType(componentType: number | undefined): string {
  const labels: Record<number, string> = {
    1: 'entity',
    2: 'attribute',
    24: 'form',
    26: 'view',
    29: 'workflow',
    31: 'dashboard',
    60: 'system-form',
    61: 'web-resource',
    62: 'site-map',
    80: 'app-module',
    300: 'canvas-app',
    371: 'connection-reference',
    380: 'environment-variable-definition',
  };

  return componentType !== undefined ? labels[componentType] ?? `component-${componentType}` : 'unknown';
}

function describeUnknownComponentTypeHint(componentType: number | undefined): string | undefined {
  if (componentType === undefined) {
    return undefined;
  }

  const label = describeComponentType(componentType);
  if (!label.startsWith('component-')) {
    return undefined;
  }

  return `Unknown Dataverse solution component type ${componentType}. Inspect the dependency in Maker or solution component metadata to identify the blocker.`;
}

function describeWorkflowState(stateCode: number | undefined, statusCode: number | undefined): string {
  if (stateCode === 0) {
    return 'draft';
  }

  if (stateCode === 1) {
    return 'activated';
  }

  if (stateCode === 2) {
    return 'suspended';
  }

  if (stateCode !== undefined || statusCode !== undefined) {
    return `statecode=${stateCode ?? 'unknown'}, statuscode=${statusCode ?? 'unknown'}`;
  }

  return 'unknown';
}

function mergeDiagnosticLists(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
}

function splitWarningDiagnostics(diagnostics: Diagnostic[] | undefined): {
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
} {
  const allDiagnostics = mergeDiagnosticLists(diagnostics);
  return {
    diagnostics: allDiagnostics.filter((diagnostic) => diagnostic.level !== 'warning'),
    warnings: allDiagnostics.filter((diagnostic) => diagnostic.level === 'warning'),
  };
}

function compareExportReadinessWarningPriority(left: Diagnostic, right: Diagnostic): number {
  const priority = new Map<string, number>([
    ['SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE', 0],
    ['SOLUTION_EXPORT_BLOCKED_WORKFLOW_STATE', 1],
    ['SOLUTION_EXPORT_WORKFLOW_CONTEXT', 2],
    ['SOLUTION_PUBLISH_LAST_READBACK', 3],
    ['DATAVERSE_CONNREF_SCOPE_EMPTY', 4],
    ['DATAVERSE_CONNREF_VALIDATE_EMPTY', 5],
  ]);

  return (priority.get(left.code) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.code) ?? Number.MAX_SAFE_INTEGER);
}

function prioritizeExportReadinessWarnings(warnings: Diagnostic[] | undefined): Diagnostic[] {
  return [...mergeDiagnosticLists(warnings)].sort((left, right) => {
    const priorityCompare = compareExportReadinessWarningPriority(left, right);
    if (priorityCompare !== 0) {
      return priorityCompare;
    }

    return left.code.localeCompare(right.code);
  });
}

function selectPrimaryExportReadinessDiagnostic(
  diagnostics: Diagnostic[] | undefined,
  warnings: Diagnostic[] | undefined
): Pick<Diagnostic, 'code' | 'message'> | undefined {
  const prioritizedWarnings = prioritizeExportReadinessWarnings(warnings);
  const prioritizedDiagnostics = splitWarningDiagnostics(diagnostics);
  const primary = prioritizedWarnings[0] ?? prioritizedDiagnostics.diagnostics[0] ?? prioritizedDiagnostics.warnings[0];
  return primary ? { code: primary.code, message: primary.message } : undefined;
}

function normalizeExportCheckFailure(
  diagnostics: Diagnostic[] | undefined,
  warnings: Diagnostic[] | undefined
): Pick<SolutionSyncStatusExportCheckFailure, 'diagnostics' | 'warnings'> {
  const splitDiagnostics = splitWarningDiagnostics(diagnostics);
  return {
    diagnostics: splitDiagnostics.diagnostics,
    warnings: prioritizeExportReadinessWarnings(mergeDiagnosticLists(warnings, splitDiagnostics.warnings)),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractDisplayName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const userLabel = (value as { UserLocalizedLabel?: { Label?: unknown } }).UserLocalizedLabel?.Label;
  const label = (value as { Label?: unknown }).Label;
  return readString(userLabel) ?? readString(label);
}

function buildCompareResult(
  uniqueName: string,
  source: SolutionAnalysis,
  target?: SolutionAnalysis
): SolutionCompareResult {
  const sourceComponents = source.components;
  const targetComponents = target?.components ?? [];
  const targetComponentIds = new Set(targetComponents.map((component) => component.objectId).filter(Boolean) as string[]);
  const sourceComponentIds = new Set(sourceComponents.map((component) => component.objectId).filter(Boolean) as string[]);
  const sourceArtifacts = new Map(source.artifacts.map((artifact) => [artifact.relativePath, artifact]));
  const targetArtifacts = new Map((target?.artifacts ?? []).map((artifact) => [artifact.relativePath, artifact]));
  const artifactPaths = new Set([...sourceArtifacts.keys(), ...targetArtifacts.keys()]);
  const artifactsOnlyInSource: SolutionArtifactInventoryEntry[] = [];
  const artifactsOnlyInTarget: SolutionArtifactInventoryEntry[] = [];
  const changedArtifacts: SolutionArtifactInventoryChange[] = [];
  const sourceModelApps = new Map(source.modelDriven.apps.map((app) => [app.uniqueName ?? app.appId, app]));
  const targetModelApps = new Map((target?.modelDriven.apps ?? []).map((app) => [app.uniqueName ?? app.appId, app]));

  for (const relativePath of Array.from(artifactPaths).sort()) {
    const sourceArtifact = sourceArtifacts.get(relativePath);
    const targetArtifact = targetArtifacts.get(relativePath);

    if (sourceArtifact && !targetArtifact) {
      artifactsOnlyInSource.push(sourceArtifact);
      continue;
    }

    if (!sourceArtifact && targetArtifact) {
      artifactsOnlyInTarget.push(targetArtifact);
      continue;
    }

    if (sourceArtifact && targetArtifact && sourceArtifact.sha256 !== targetArtifact.sha256) {
      changedArtifacts.push({
        relativePath,
        source: sourceArtifact,
        target: targetArtifact,
      });
    }
  }

  const appsOnlyInSource = Array.from(sourceModelApps.entries())
    .filter(([key]) => !targetModelApps.has(key))
    .map(([, app]) => app);
  const appsOnlyInTarget = Array.from(targetModelApps.entries())
    .filter(([key]) => !sourceModelApps.has(key))
    .map(([, app]) => app);
  const changedApps: SolutionModelDrivenAppDrift[] = [];

  for (const [key, sourceApp] of sourceModelApps.entries()) {
    const targetApp = targetModelApps.get(key);

    if (!targetApp || !sourceApp.composition || !targetApp.composition) {
      continue;
    }

    const sourceArtifactKeys = new Set(sourceApp.composition.artifacts.map((artifact) => artifact.key));
    const targetArtifactKeys = new Set(targetApp.composition.artifacts.map((artifact) => artifact.key));
    const artifactOnlyInSource = Array.from(sourceArtifactKeys).filter((artifactKey) => !targetArtifactKeys.has(artifactKey)).sort();
    const artifactOnlyInTarget = Array.from(targetArtifactKeys).filter((artifactKey) => !sourceArtifactKeys.has(artifactKey)).sort();
    const missingArtifactsChanged = sourceApp.composition.summary.missingArtifacts !== targetApp.composition.summary.missingArtifacts;

    if (artifactOnlyInSource.length > 0 || artifactOnlyInTarget.length > 0 || missingArtifactsChanged) {
      changedApps.push({
        appId: sourceApp.appId,
        uniqueName: sourceApp.uniqueName,
        name: sourceApp.name,
        missingArtifactsChanged,
        artifactsOnlyInSource: artifactOnlyInSource,
        artifactsOnlyInTarget: artifactOnlyInTarget,
      });
    }
  }

  return {
    uniqueName,
    source,
    target,
    drift: {
      versionChanged: source.solution.version !== target?.solution.version,
      componentsOnlyInSource: sourceComponents.filter((component) => component.objectId && !targetComponentIds.has(component.objectId)),
      componentsOnlyInTarget: targetComponents.filter((component) => component.objectId && !sourceComponentIds.has(component.objectId)),
      artifactsOnlyInSource,
      artifactsOnlyInTarget,
      changedArtifacts,
      modelDriven: {
        appsOnlyInSource,
        appsOnlyInTarget,
        changedApps,
      },
    },
    missingDependencies: {
      source: source.missingDependencies,
      target: target?.missingDependencies ?? [],
    },
    missingConfig: {
      invalidConnectionReferences: {
        source: source.invalidConnectionReferences,
        target: target?.invalidConnectionReferences ?? [],
      },
      environmentVariablesMissingValues: {
        source: source.missingEnvironmentVariables,
        target: target?.missingEnvironmentVariables ?? [],
      },
    },
  };
}

function resolveOutputPath(
  uniqueName: string,
  packageType: Exclude<SolutionPackageType, 'both'>,
  explicitOutPath?: string,
  explicitOutDir?: string
): string {
  if (explicitOutPath) {
    return resolve(explicitOutPath);
  }

  return resolve(explicitOutDir ?? process.cwd(), `${uniqueName}_${packageType}.zip`);
}

function resolveManifestPath(outputPath: string, explicitManifestPath?: string): string {
  if (explicitManifestPath) {
    return resolve(explicitManifestPath);
  }

  return outputPath.replace(/\.zip$/i, '.pp-solution.json');
}

function resolveAdjacentManifestPath(packagePath: string): string {
  if (extname(packagePath).toLowerCase() === '.zip') {
    return packagePath.replace(/\.zip$/i, '.pp-solution.json');
  }

  return `${packagePath}.pp-solution.json`;
}

async function resolveSolutionUnpackPackageType(
  packagePath: string,
  requestedPackageType: SolutionPackageType | undefined
): Promise<OperationResult<SolutionPackageType>> {
  if (requestedPackageType) {
    return ok(requestedPackageType, {
      supportTier: 'preview',
    });
  }

  const manifest = await readReleaseManifest(resolveAdjacentManifestPath(packagePath));

  if (!manifest.success) {
    return ok('both', {
      supportTier: 'preview',
      warnings: [
        createDiagnostic(
          'warning',
          'SOLUTION_UNPACK_PACKAGE_TYPE_AUTO_DETECT_FAILED',
          `Could not read the adjacent release manifest for ${packagePath}; defaulting solution unpack to package type both.`,
          {
            source: '@pp/solution',
            path: packagePath,
            detail: manifest.diagnostics.map((diagnostic) => diagnostic.message).join('; '),
            hint: 'Pass --package-type explicitly when unpacking a package without readable release metadata.',
          }
        ),
        ...manifest.warnings,
      ],
    });
  }

  if (manifest.data?.solution.packageType) {
    return ok(manifest.data.solution.packageType, {
      supportTier: 'preview',
      warnings: manifest.warnings,
    });
  }

  const archivePackageType = await readSolutionArchivePackageType(packagePath);

  if (archivePackageType.success && archivePackageType.data) {
    return ok(archivePackageType.data, {
      supportTier: 'preview',
      warnings: mergeDiagnosticLists(manifest.warnings, archivePackageType.warnings),
    });
  }

  return ok('both', {
    supportTier: 'preview',
    warnings: mergeDiagnosticLists(
      manifest.warnings,
      archivePackageType.warnings,
      [
        createDiagnostic(
          'warning',
          'SOLUTION_UNPACK_PACKAGE_TYPE_AUTO_DETECT_FAILED',
          `Could not infer whether ${packagePath} is managed or unmanaged; defaulting solution unpack to package type both.`,
          {
            source: '@pp/solution',
            path: packagePath,
            detail: archivePackageType.diagnostics.map((diagnostic) => diagnostic.message).join('; '),
            hint: 'Pass --package-type explicitly when unpacking a package without readable embedded metadata.',
          }
        ),
      ]
    ),
  });
}

async function buildArtifactFile(role: SolutionArtifactFile['role'], path: string): Promise<SolutionArtifactFile> {
  const resolvedPath = resolve(path);
  const content = await readFile(resolvedPath);
  const info = await stat(resolvedPath);

  return {
    role,
    path: resolvedPath,
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: info.size,
  };
}

async function buildDirectoryArtifact(path: string): Promise<SolutionArtifactFile> {
  const resolvedPath = resolve(path);

  return {
    role: 'unpacked-root',
    path: resolvedPath,
    relativePath: basename(resolvedPath),
  };
}

async function analyzeUnpackedArtifact(
  root: string,
  options: {
    kind: 'zip' | 'unpacked';
    packagePath?: string;
  }
): Promise<OperationResult<SolutionAnalysis>> {
  const artifacts = await collectArtifactInventory(root);
  const metadata = await resolveLocalSolutionMetadata(root, options.packagePath);

  return ok(
    {
      solution: {
        solutionid: options.packagePath ?? root,
        uniquename: metadata.uniqueName ?? basename(root),
        friendlyname: metadata.friendlyName,
        version: metadata.version,
      },
      components: [],
      dependencies: [],
      missingDependencies: [],
      invalidConnectionReferences: [],
      missingEnvironmentVariables: [],
      modelDriven: {
        apps: [],
        summary: {
          appCount: 0,
          artifactCount: 0,
          missingArtifactCount: 0,
        },
      },
      origin: {
        kind: options.kind,
        path: options.packagePath ?? root,
      },
      artifacts,
    },
    {
      supportTier: 'preview',
    }
  );
}

async function collectArtifactInventory(root: string): Promise<SolutionArtifactInventoryEntry[]> {
  const entries = await walkFiles(root);
  const inventory = await Promise.all(
    entries.map(async (path) => {
      const content = await readFile(path);
      const info = await stat(path);

      return {
        relativePath: relative(root, path).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(content).digest('hex'),
        bytes: info.size,
      };
    })
  );

  return inventory.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = join(root, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      found.push(fullPath);
    }
  }

  return found;
}

async function resolveLocalSolutionMetadata(
  root: string,
  packagePath?: string
): Promise<{ uniqueName?: string; friendlyName?: string; version?: string }> {
  if (packagePath) {
    const manifest = await readReleaseManifest(resolveAdjacentManifestPath(packagePath));

    if (manifest.success && manifest.data) {
      return {
        uniqueName: manifest.data.solution.uniqueName,
        friendlyName: manifest.data.solution.friendlyName,
        version: manifest.data.solution.version,
      };
    }
  }

  const metadataCandidates = ['Other.xml', 'Solution.xml', 'solution.xml'];

  for (const candidate of metadataCandidates) {
    const path = await findFileByBasename(root, candidate);

    if (!path) {
      continue;
    }

    const content = await readFile(path, 'utf8');
    const uniqueName = readXmlTag(content, ['UniqueName', 'uniquename']);
    const friendlyName = readXmlTag(content, ['LocalizedName', 'FriendlyName', 'friendlyname']);
    const version = readXmlTag(content, ['Version', 'version']);

    if (uniqueName || friendlyName || version) {
      return {
        uniqueName,
        friendlyName,
        version,
      };
    }
  }

  return {};
}

async function findFileByBasename(root: string, name: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(root, entry.name);

    if (entry.isFile() && entry.name === name) {
      return fullPath;
    }

    if (entry.isDirectory()) {
      const nested = await findFileByBasename(fullPath, name);

      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function readXmlTag(content: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const match = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i').exec(content);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

async function normalizeSolutionArchivePackageType(
  packagePath: string,
  expectedPackageType: Exclude<SolutionPackageType, 'both'>
): Promise<OperationResult<{ normalized: boolean }>> {
  const inspectedPackageType = await readSolutionArchivePackageType(packagePath);

  if (!inspectedPackageType.success || !inspectedPackageType.data) {
    return inspectedPackageType as unknown as OperationResult<{ normalized: boolean }>;
  }

  if (inspectedPackageType.data === expectedPackageType) {
    return ok(
      {
        normalized: false,
      },
      {
        supportTier: 'preview',
        warnings: inspectedPackageType.warnings,
      }
    );
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'pp-solution-export-normalize-'));

  try {
    const extracted = await extractZipArchive(packagePath, tempDir);

    if (!extracted.success) {
      return extracted as unknown as OperationResult<{ normalized: boolean }>;
    }

    const metadataPath = await findFileByBasename(tempDir, 'solution.xml')
      ?? await findFileByBasename(tempDir, 'Solution.xml')
      ?? await findFileByBasename(tempDir, 'Other.xml');

    if (!metadataPath) {
      return fail(
        createDiagnostic(
          'error',
          'SOLUTION_EXPORT_PACKAGE_METADATA_MISSING',
          `Exported solution package ${packagePath} does not contain solution metadata for package-type verification.`,
          {
            source: '@pp/solution',
            path: packagePath,
            hint: 'Inspect the exported archive contents and retry the export.',
          }
        ),
        {
          supportTier: 'preview',
          warnings: mergeDiagnosticLists(inspectedPackageType.warnings, extracted.warnings),
        }
      );
    }

    const metadata = await readFile(metadataPath, 'utf8');
    const rewritten = rewriteManagedTag(metadata, expectedPackageType);

    if (!rewritten) {
      return fail(
        createDiagnostic(
          'error',
          'SOLUTION_EXPORT_MANAGED_FLAG_MISSING',
          `Exported solution metadata in ${packagePath} does not contain a <Managed> flag.`,
          {
            source: '@pp/solution',
            path: metadataPath,
            hint: 'Inspect the exported solution.xml/Other.xml payload and retry the export.',
          }
        ),
        {
          supportTier: 'preview',
          warnings: mergeDiagnosticLists(inspectedPackageType.warnings, extracted.warnings),
        }
      );
    }

    await writeFile(metadataPath, rewritten, 'utf8');
    const rebuiltPath = join(tempDir, 'normalized.zip');
    const rebuilt = await createZipArchive(tempDir, rebuiltPath);

    if (!rebuilt.success) {
      return rebuilt as unknown as OperationResult<{ normalized: boolean }>;
    }

    const rebuiltBytes = await readFile(rebuiltPath);
    await writeFile(packagePath, rebuiltBytes);

    const verifiedPackageType = await readSolutionArchivePackageType(packagePath);

    if (!verifiedPackageType.success || !verifiedPackageType.data) {
      return verifiedPackageType as unknown as OperationResult<{ normalized: boolean }>;
    }

    if (verifiedPackageType.data !== expectedPackageType) {
      return fail(
        createDiagnostic(
          'error',
          'SOLUTION_EXPORT_PACKAGE_TYPE_MISMATCH',
          `Exported solution package ${packagePath} still reports ${verifiedPackageType.data} after normalization; expected ${expectedPackageType}.`,
          {
            source: '@pp/solution',
            path: packagePath,
            hint: 'Retry the export or inspect the archive contents manually.',
          }
        ),
        {
          supportTier: 'preview',
          warnings: mergeDiagnosticLists(inspectedPackageType.warnings, extracted.warnings, rebuilt.warnings, verifiedPackageType.warnings),
        }
      );
    }

    return ok(
      {
        normalized: true,
      },
      {
        supportTier: 'preview',
        warnings: mergeDiagnosticLists(
          inspectedPackageType.warnings,
          extracted.warnings,
          rebuilt.warnings,
          verifiedPackageType.warnings,
          [
            createDiagnostic(
              'warning',
              'SOLUTION_EXPORT_PACKAGE_TYPE_NORMALIZED',
              `Exported solution package metadata reported ${inspectedPackageType.data}; rewrote the archive to ${expectedPackageType} so downstream unpack/import stays consistent.`,
              {
                source: '@pp/solution',
                path: packagePath,
                hint: 'The Dataverse export payload did not match the requested package type, so pp normalized the archive before writing the release manifest.',
              }
            ),
          ]
        ),
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readSolutionArchivePackageType(
  packagePath: string
): Promise<OperationResult<Exclude<SolutionPackageType, 'both'>>> {
  const metadata = await readSolutionArchiveMetadataContent(packagePath);

  if (!metadata.success || !metadata.data) {
    return metadata as unknown as OperationResult<Exclude<SolutionPackageType, 'both'>>;
  }

  const managedValue = readXmlTag(metadata.data.toString('utf8'), ['Managed']);

  if (managedValue === '1') {
    return ok('managed', {
      supportTier: 'preview',
      warnings: metadata.warnings,
    });
  }

  if (managedValue === '0') {
    return ok('unmanaged', {
      supportTier: 'preview',
      warnings: metadata.warnings,
    });
  }

  return fail(
    createDiagnostic(
      'error',
      'SOLUTION_EXPORT_MANAGED_FLAG_INVALID',
      `Exported solution metadata in ${packagePath} does not contain a valid <Managed> flag.`,
      {
        source: '@pp/solution',
        path: packagePath,
        detail: managedValue ? `Observed value: ${managedValue}.` : undefined,
        hint: 'Inspect the solution metadata and retry the export.',
      }
    ),
    {
      supportTier: 'preview',
      warnings: metadata.warnings,
    }
  );
}

async function readSolutionArchiveMetadata(
  packagePath: string
): Promise<OperationResult<{ uniqueName?: string; friendlyName?: string; version?: string }>> {
  const metadata = await readSolutionArchiveMetadataContent(packagePath);

  if (!metadata.success || !metadata.data) {
    return metadata as unknown as OperationResult<{ uniqueName?: string; friendlyName?: string; version?: string }>;
  }

  const content = metadata.data.toString('utf8');
  return ok(
    {
      uniqueName: readXmlTag(content, ['UniqueName', 'uniquename']),
      friendlyName: readXmlTag(content, ['LocalizedName', 'FriendlyName', 'friendlyname']),
      version: readXmlTag(content, ['Version', 'version']),
    },
    {
      supportTier: 'preview',
      warnings: metadata.warnings,
    }
  );
}

async function readSolutionArchiveMetadataContent(packagePath: string): Promise<OperationResult<Buffer>> {
  const entries = await listZipEntries(packagePath);

  if (!entries.success || !entries.data) {
    return entries as unknown as OperationResult<Buffer>;
  }

  const metadataEntry = entries.data.find((entry) => {
    const normalized = entry.replaceAll('\\', '/').toLowerCase();
    return normalized.endsWith('/other.xml') || normalized.endsWith('/solution.xml') || normalized === 'other.xml' || normalized === 'solution.xml';
  });

  if (!metadataEntry) {
    return fail(
      createDiagnostic(
        'error',
        'SOLUTION_EXPORT_PACKAGE_METADATA_MISSING',
        `Exported solution package ${packagePath} does not contain solution metadata for package-type verification.`,
        {
          source: '@pp/solution',
          path: packagePath,
          hint: 'Inspect the exported archive contents and retry the export.',
        }
      ),
      {
        supportTier: 'preview',
        warnings: entries.warnings,
      }
    );
  }

  return extractZipEntry(packagePath, metadataEntry);
}

function rewriteManagedTag(
  content: string,
  packageType: Exclude<SolutionPackageType, 'both'>
): string | undefined {
  const nextValue = packageType === 'managed' ? '1' : '0';

  if (!/<Managed>[^<]*<\/Managed>/i.test(content)) {
    return undefined;
  }

  return content.replace(/<Managed>[^<]*<\/Managed>/i, `<Managed>${nextValue}</Managed>`);
}

async function listZipEntries(packagePath: string): Promise<OperationResult<string[]>> {
  try {
    const zip = new AdmZip(packagePath);
    return ok(
      zip
        .getEntries()
        .map((entry: { entryName: string }) => entry.entryName)
        .filter((entry) => entry.length > 0),
      {
        supportTier: 'preview',
      }
    );
  } catch (error) {
    return fail(
      createDiagnostic('error', 'SOLUTION_ARCHIVE_COMMAND_FAILED', 'Failed to read solution archive.', {
        source: '@pp/solution',
        detail: error instanceof Error ? error.message : String(error),
        hint: 'Inspect the archive path and contents, then retry.',
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

async function extractZipEntry(packagePath: string, entry: string): Promise<OperationResult<Buffer>> {
  try {
    const zip = new AdmZip(packagePath);
    const archiveEntry = zip.getEntry(entry);

    if (!archiveEntry) {
      return fail(
        createDiagnostic('error', 'SOLUTION_ARCHIVE_COMMAND_FAILED', `Archive entry ${entry} was not found.`, {
          source: '@pp/solution',
          path: packagePath,
        }),
        {
          supportTier: 'preview',
        }
      );
    }

    return ok(archiveEntry.getData(), {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'SOLUTION_ARCHIVE_COMMAND_FAILED', 'Failed to read solution archive entry.', {
        source: '@pp/solution',
        detail: error instanceof Error ? error.message : String(error),
        hint: 'Inspect the archive path and contents, then retry.',
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

async function extractZipArchive(packagePath: string, outDir: string): Promise<OperationResult<undefined>> {
  try {
    const zip = new AdmZip(packagePath);
    zip.extractAllTo(outDir, true, true);
    return ok(undefined, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'SOLUTION_ARCHIVE_COMMAND_FAILED', 'Failed to extract solution archive.', {
        source: '@pp/solution',
        detail: error instanceof Error ? error.message : String(error),
        hint: 'Inspect the archive path and contents, then retry.',
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

async function createZipArchive(sourceDir: string, outPath: string): Promise<OperationResult<undefined>> {
  try {
    const zip = new AdmZip();
    zip.addLocalFolder(sourceDir, '');
    zip.writeZip(outPath);
    return ok(undefined, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'SOLUTION_ARCHIVE_COMMAND_FAILED', 'Failed to create solution archive.', {
        source: '@pp/solution',
        detail: error instanceof Error ? error.message : String(error),
        hint: 'Inspect the source folder and destination path, then retry.',
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

function createReleaseManifest(
  solution: SolutionSummary,
  packageType: Exclude<SolutionPackageType, 'both'>,
  artifact: SolutionArtifactFile,
  analysis: SolutionAnalysis | undefined
): SolutionReleaseManifest {
  return {
    schemaVersion: 1,
    kind: 'pp-solution-release',
    generatedAt: new Date().toISOString(),
    solution: {
      uniqueName: solution.uniquename,
      friendlyName: solution.friendlyname,
      version: solution.version,
      packageType,
    },
    analysis: analysis
      ? {
          componentCount: analysis.components.length,
          dependencyCount: analysis.dependencies.length,
          missingDependencyCount: analysis.missingDependencies.length,
          invalidConnectionReferenceCount: analysis.invalidConnectionReferences.length,
          missingEnvironmentVariableCount: analysis.missingEnvironmentVariables.length,
        }
      : undefined,
    recovery: {
      rollbackCandidateVersion: solution.version,
    },
    files: [artifact],
  };
}

async function writeReleaseManifest(path: string, manifest: SolutionReleaseManifest, baseDir: string): Promise<void> {
  const manifestWithRelativeFiles: SolutionReleaseManifest = {
    ...manifest,
    files: manifest.files.map((file) => ({
      ...file,
      relativePath: relative(baseDir, file.path),
    })),
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stableStringify(manifestWithRelativeFiles as unknown as Parameters<typeof stableStringify>[0]) + '\n', 'utf8');
}

async function readReleaseManifest(path: string): Promise<OperationResult<SolutionReleaseManifest | undefined>> {
  try {
    const content = await readFile(path, 'utf8');
    return ok(JSON.parse(content) as SolutionReleaseManifest, {
      supportTier: 'preview',
    });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return ok(undefined, {
        supportTier: 'preview',
      });
    }

    return fail(
      createDiagnostic('error', 'SOLUTION_RELEASE_MANIFEST_READ_FAILED', `Failed to read solution release manifest ${path}.`, {
        source: '@pp/solution',
        path,
        detail: error instanceof Error ? error.message : String(error),
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

function toPacPackageType(packageType: SolutionPackageType): string {
  switch (packageType) {
    case 'managed':
      return 'Managed';
    case 'unmanaged':
      return 'Unmanaged';
    case 'both':
    default:
      return 'Both';
  }
}

function explainImportFailure(diagnostics: Diagnostic[], manifest?: SolutionReleaseManifest): string[] {
  const joined = diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.message} ${diagnostic.detail ?? ''}`).join(' ').toLowerCase();
  const actions: string[] = [];

  if (joined.includes('dependency')) {
    actions.push('Review solution dependencies in the target environment before retrying the import.');
  }

  if (joined.includes('connection reference')) {
    actions.push('Validate connection references in the target environment with `pp connref validate --env <alias>`.');
  }

  if (joined.includes('environment variable')) {
    actions.push('Populate required Dataverse environment variables before retrying the import.');
  }

  if (manifest?.solution.uniqueName) {
    actions.push(`Re-run \`pp solution analyze ${manifest.solution.uniqueName} --env <alias>\` to inspect target-side blockers.`);
  }

  return Array.from(new Set(actions));
}

function describeManagedExportContradiction(
  uniqueName: string,
  packageType: Exclude<SolutionPackageType, 'both'>,
  solution: SolutionSummary,
  diagnostics: Diagnostic[] | undefined
): {
  diagnostics?: Diagnostic[];
  warnings?: Diagnostic[];
  suggestedNextActions?: string[];
  details?: SolutionExportFailureDetails['managedStateContradiction'];
} | undefined {
  if (packageType !== 'unmanaged' || solution.ismanaged !== false) {
    return undefined;
  }

  const conflictingDiagnostic = (diagnostics ?? []).find((diagnostic) => {
    const haystack = `${diagnostic.message ?? ''}\n${diagnostic.detail ?? ''}`;
    return /managed solutions cannot be exported/i.test(haystack);
  });

  if (!conflictingDiagnostic) {
    return undefined;
  }

  return {
    warnings: [
      createDiagnostic(
        'warning',
        'SOLUTION_EXPORT_MANAGED_STATE_CONTRADICTION',
        `Solution ${uniqueName} inspected as unmanaged, but ExportSolution reported that managed solutions cannot be exported.`,
        {
          source: '@pp/solution',
          detail: `Inspect reported ismanaged=false for ${uniqueName}, but ${conflictingDiagnostic.code} said: ${conflictingDiagnostic.message}`,
          hint: `Run \`pp solution sync-status ${uniqueName} --environment <alias> --format json\` to capture solution read-back plus a fresh export probe before retrying export.`,
        }
      ),
    ],
    suggestedNextActions: [
      `Run \`pp solution sync-status ${uniqueName} --environment <alias> --format json\` to capture solution read-back and a fresh export probe in one response.`,
      `Re-run \`pp solution inspect ${uniqueName} --environment <alias> --format json\` to confirm whether Dataverse still reports \`ismanaged=false\` before retrying export.`,
    ],
    details: {
      inspect: {
        solutionid: solution.solutionid,
        uniquename: solution.uniquename,
        friendlyname: solution.friendlyname,
        version: solution.version,
        ismanaged: solution.ismanaged,
      },
      export: {
        diagnosticCode: conflictingDiagnostic.code,
        message: conflictingDiagnostic.message,
        detail: conflictingDiagnostic.detail,
      },
    },
  };
}

function chooseLatestVisibleSolution(solutions: SolutionSummary[]): SolutionSummary | undefined {
  return [...solutions].sort(compareSolutionRecency).at(0);
}

function isCredibleMissingSolutionAlternative(requestedUniqueName: string, candidate: SolutionSummary): boolean {
  const normalizedRequested = normalizeSolutionNameForMatch(requestedUniqueName);
  if (!normalizedRequested) {
    return false;
  }

  return [candidate.uniquename, candidate.friendlyname].some((value) => {
    const normalizedCandidate = normalizeSolutionNameForMatch(value);
    if (!normalizedCandidate) {
      return false;
    }

    return normalizedCandidate.includes(normalizedRequested) || normalizedRequested.includes(normalizedCandidate);
  });
}

function normalizeSolutionNameForMatch(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value.toLowerCase().replace(/shell$/i, '').replace(/[^a-z0-9]+/g, '');
}

function compareSolutionRecency(left: SolutionSummary, right: SolutionSummary): number {
  const timestampCompare = compareSolutionEmbeddedTimestamps(left, right);
  if (timestampCompare !== 0) {
    return timestampCompare;
  }

  const versionCompare = compareVersionStrings(right.version, left.version);
  if (versionCompare !== 0) {
    return versionCompare;
  }

  const friendlyCompare = (right.friendlyname ?? '').localeCompare(left.friendlyname ?? '');
  if (friendlyCompare !== 0) {
    return friendlyCompare;
  }

  return (right.uniquename ?? '').localeCompare(left.uniquename ?? '');
}

function compareSolutionEmbeddedTimestamps(left: SolutionSummary, right: SolutionSummary): number {
  const leftTimestamp = extractSolutionRecencyTimestamp(left);
  const rightTimestamp = extractSolutionRecencyTimestamp(right);

  if (!leftTimestamp && !rightTimestamp) {
    return 0;
  }

  if (!leftTimestamp) {
    return -1;
  }

  if (!rightTimestamp) {
    return 1;
  }

  return rightTimestamp.localeCompare(leftTimestamp);
}

function extractSolutionRecencyTimestamp(solution: SolutionSummary): string | undefined {
  const candidates = [solution.uniquename, solution.friendlyname];

  for (const candidate of candidates) {
    const match = candidate?.match(/(20\d{6}(?:T?\d{6,9}Z?)?)/i);
    if (match?.[1]) {
      return match[1].replace(/[^0-9]/g, '');
    }
  }

  return undefined;
}

function compareVersionStrings(left: string | undefined, right: string | undefined): number {
  if (left === right) {
    return 0;
  }

  if (!left) {
    return -1;
  }

  if (!right) {
    return 1;
  }

  const leftParts = left.split(/[^0-9]+/).filter(Boolean).map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(/[^0-9]+/).filter(Boolean).map((part) => Number.parseInt(part, 10));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return left.localeCompare(right);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
