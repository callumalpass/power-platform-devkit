import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { stableStringify } from '@pp/artifacts';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { ModelService, type ModelCompositionResult } from '@pp/model';
import {
  ConnectionReferenceService,
  EnvironmentVariableService,
  type ConnectionReferenceValidationResult,
  type DataverseClient,
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
  dependentComponentObjectId?: string;
  dependentComponentType?: number;
  dependentComponentTypeLabel: string;
  missingRequiredComponent: boolean;
}

export interface SolutionModelDrivenAppAnalysis {
  appId: string;
  uniqueName?: string;
  name?: string;
  composition: ModelCompositionResult;
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
      options.publisherId || options.publisherUniqueName ? undefined : await this.listPublishers();
    const publisherId = options.publisherId ?? (await this.resolvePublisherId(options.publisherUniqueName));

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
        warnings: createResult.warnings,
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
      select: ['solutionid', 'uniquename', 'friendlyname', 'version'],
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
      select: ['solutionid', 'uniquename', 'friendlyname', 'version'],
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

    return ok(summary, {
      supportTier: 'preview',
      diagnostics: solutions.diagnostics,
      warnings: solutions.warnings,
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

    return ok((components.data ?? []).map(normalizeSolutionComponent), {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(solution.diagnostics, components.diagnostics),
      warnings: mergeDiagnosticLists(solution.warnings, components.warnings),
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

    return ok(relevant, {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(components.diagnostics, dependencies.diagnostics),
      warnings: mergeDiagnosticLists(components.warnings, dependencies.warnings),
    });
  }

  async analyze(uniqueName: string): Promise<OperationResult<SolutionAnalysis | undefined>> {
    const solution = await this.inspect(uniqueName);

    if (!solution.success) {
      return solution as unknown as OperationResult<SolutionAnalysis | undefined>;
    }

    if (!solution.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: solution.diagnostics,
        warnings: solution.warnings,
      });
    }

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

    const modelDrivenApps: SolutionModelDrivenAppAnalysis[] = [];
    let modelDiagnostics = [...modelApps.diagnostics];
    let modelWarnings = [...modelApps.warnings];

    for (const app of modelApps.data ?? []) {
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
          artifactCount: modelDrivenApps.reduce((count, app) => count + app.composition.summary.totalArtifacts, 0),
          missingArtifactCount: modelDrivenApps.reduce((count, app) => count + app.composition.summary.missingArtifacts, 0),
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
    });

    if (!exportResult.success) {
      return exportResult as unknown as OperationResult<SolutionExportResult>;
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
        warnings: mergeDiagnosticLists(solution.warnings, analysis.warnings, exportResult.warnings),
        provenance: [
          {
            kind: 'official-api',
            source: 'Dataverse ExportSolution',
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
      importJobId: options.importJobId,
    };

    const importResult = await this.dataverseClient.invokeAction<void>('ImportSolution', {
      CustomizationFile: packageBytes.toString('base64'),
      PublishWorkflows: normalizedOptions.publishWorkflows,
      OverwriteUnmanagedCustomizations: normalizedOptions.overwriteUnmanagedCustomizations,
      HoldingSolution: normalizedOptions.holdingSolution,
      SkipProductUpdateDependencies: normalizedOptions.skipProductUpdateDependencies,
      ...(normalizedOptions.importJobId ? { ImportJobId: normalizedOptions.importJobId } : {}),
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

    const packageType = options.packageType ?? 'both';
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
        warnings: command.warnings,
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

  private async listPublishers(): Promise<PublisherSummary[]> {
    const publishers = await this.dataverseClient.query<PublisherSummary>({
      table: 'publishers',
      select: ['publisherid', 'uniquename', 'friendlyname'],
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

    const publisher = await this.dataverseClient.query<SolutionPublisherSummary>({
      table: 'publishers',
      select: ['publisherid', 'uniquename', 'friendlyname', 'customizationprefix', 'customizationoptionvalueprefix'],
      filter: `publisherid eq ${publisherId}`,
      top: 1,
    });

    return {
      solutionid: record.solutionid,
      uniquename: record.uniquename,
      friendlyname: record.friendlyname,
      version: record.version,
      ismanaged: record.ismanaged,
      publisher: normalizePublisherSummary(publisher.success ? publisher.data?.[0] : undefined) ?? { publisherid: publisherId },
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

class DefaultSolutionCommandRunner implements SolutionCommandRunner {
  async run(invocation: SolutionCommandInvocation): Promise<OperationResult<SolutionCommandResult>> {
    return new Promise((resolvePromise) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const child = spawn(invocation.executable, invocation.args, {
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
  return {
    id: dependency.dependencyid,
    dependencyType: dependency.dependencytype,
    requiredComponentObjectId: dependency.requiredcomponentobjectid,
    requiredComponentType: dependency.requiredcomponenttype,
    requiredComponentTypeLabel: describeComponentType(dependency.requiredcomponenttype),
    dependentComponentObjectId: dependency.dependentcomponentobjectid,
    dependentComponentType: dependency.dependentcomponenttype,
    dependentComponentTypeLabel: describeComponentType(dependency.dependentcomponenttype),
    missingRequiredComponent: Boolean(
      dependency.requiredcomponentobjectid && !componentIds.has(dependency.requiredcomponentobjectid)
    ),
  };
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
    371: 'connection-reference',
    380: 'environment-variable-definition',
  };

  return componentType !== undefined ? labels[componentType] ?? `component-${componentType}` : 'unknown';
}

function mergeDiagnosticLists(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
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

    if (!targetApp) {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
