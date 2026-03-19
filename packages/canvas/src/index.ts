import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify, writeJsonFile } from '@pp/artifacts';
import {
  type AssetAccessReport,
  CanvasAppService,
  type CanvasAppAttachResult,
  type CanvasAppSummary as DataverseCanvasAppSummary,
  type DataverseClient,
} from '@pp/dataverse';
import { createDiagnostic, fail, ok, withWarning, type Diagnostic, type OperationResult, type ProvenanceClass } from '@pp/diagnostics';
import { SolutionService, type SolutionComponentSummary, type SolutionDependencySummary, type SolutionSummary } from '@pp/solution';
import { buildCanvasMsappFromUnpackedSource } from './msapp-build';
import { createZipArchive, extractCanvasMsappArchive, extractZipArchive, extractZipEntry, listZipEntries, mergeDiagnosticLists } from './archive';
import type {
  CanvasBuildMode,
  CanvasBuildResult,
  CanvasBuildSummary,
  CanvasColumnMetadata,
  CanvasControlDefinition,
  CanvasControlSummary,
  CanvasEntityMetadata,
  CanvasFormulaCheck,
  CanvasInspectReport,
  CanvasJsonValue,
  CanvasLintCategory,
  CanvasLintDiagnostic,
  CanvasLintRelatedContext,
  CanvasLintReport,
  CanvasManifest,
  CanvasMetadataCatalog,
  CanvasNodeSourceInfo,
  CanvasOptionSetMetadata,
  CanvasOptionValueMetadata,
  CanvasPropertyCheck,
  CanvasRegistryBundle,
  CanvasRegistryImportRequest,
  CanvasRegistryLoadOptions,
  CanvasRemoteProofCheck,
  CanvasRemoteProofExpectation,
  CanvasRemoteProofReport,
  CanvasRegistrySourceSummary,
  CanvasRelationshipMetadata,
  CanvasScreenDefinition,
  CanvasScreenReference,
  CanvasSourceLoadOptions,
  CanvasSourceModel,
  CanvasSourcePosition,
  CanvasSourceSpan,
  CanvasSupportMatrixEntry,
  CanvasSupportResolution,
  CanvasSupportStatus,
  CanvasTemplateAliases,
  CanvasTemplateLookup,
  CanvasTemplateMatchType,
  CanvasTemplateProvenance,
  CanvasTemplateRequirementReport,
  CanvasTemplateReportRecord,
  CanvasTemplateReportResolution,
  CanvasTemplateRecord,
  CanvasTemplateRegistryAuditReport,
  CanvasTemplateRegistryDiffResult,
  CanvasTemplateRegistryDocument,
  CanvasTemplateRegistryInspectReport,
  CanvasTemplateRegistryPinResult,
  CanvasTemplateRegistryRefreshResult,
  CanvasTemplateRequirementResolution,
  CanvasTemplateResolution,
  CanvasTemplateUsageIssue,
  CanvasValidationReport,
  CanvasWorkspaceAppEntry,
  CanvasWorkspaceCatalogEntry,
  CanvasWorkspaceDocument,
  CanvasWorkspaceInspectReport,
  CanvasWorkspaceResolvedApp,
} from './canvas-types';
import { type CanvasDataSourceSummary, loadCanvasPaYamlSource, resolveCanvasPaYamlRoot, type CanvasSourceReadOptions } from './pa-yaml';
import { parsePowerFxExpression } from './power-fx';
import { buildCanvasSemanticModel, collectCanvasFormulaChecks, type CanvasFormulaSemantic } from './semantic-model';
import { buildCanvasTemplateSurface } from './template-surface';
export type {
  CanvasBuildMode,
  CanvasBuildResult,
  CanvasBuildSummary,
  CanvasColumnMetadata,
  CanvasControlDefinition,
  CanvasControlSummary,
  CanvasEntityMetadata,
  CanvasFormulaCheck,
  CanvasInspectReport,
  CanvasJsonValue,
  CanvasLintCategory,
  CanvasLintDiagnostic,
  CanvasLintRelatedContext,
  CanvasLintReport,
  CanvasManifest,
  CanvasMetadataCatalog,
  CanvasNodeSourceInfo,
  CanvasOptionSetMetadata,
  CanvasOptionValueMetadata,
  CanvasPropertyCheck,
  CanvasRegistryBundle,
  CanvasRegistryImportRequest,
  CanvasRegistryLoadOptions,
  CanvasRemoteProofCheck,
  CanvasRemoteProofExpectation,
  CanvasRemoteProofReport,
  CanvasRegistrySourceSummary,
  CanvasRelationshipMetadata,
  CanvasScreenDefinition,
  CanvasScreenReference,
  CanvasSourceLoadOptions,
  CanvasSourceModel,
  CanvasSourcePosition,
  CanvasSourceSpan,
  CanvasSupportMatrixEntry,
  CanvasSupportResolution,
  CanvasSupportStatus,
  CanvasTemplateAliases,
  CanvasTemplateLookup,
  CanvasTemplateMatchType,
  CanvasTemplateProvenance,
  CanvasTemplateRequirementReport,
  CanvasTemplateReportRecord,
  CanvasTemplateReportResolution,
  CanvasTemplateRecord,
  CanvasTemplateRegistryAuditReport,
  CanvasTemplateRegistryDiffResult,
  CanvasTemplateRegistryDocument,
  CanvasTemplateRegistryInspectReport,
  CanvasTemplateRegistryPinResult,
  CanvasTemplateRegistryRefreshResult,
  CanvasTemplateRequirementResolution,
  CanvasTemplateResolution,
  CanvasTemplateUsageIssue,
  CanvasValidationReport,
  CanvasWorkspaceAppEntry,
  CanvasWorkspaceCatalogEntry,
  CanvasWorkspaceDocument,
  CanvasWorkspaceInspectReport,
  CanvasWorkspaceResolvedApp,
} from './canvas-types';

export interface CanvasControlDiff {
  controlPath: string;
  kind: 'added' | 'removed' | 'changed';
  changedProperties?: string[];
}

export interface CanvasDiffResult {
  left: string;
  right: string;
  appChanged: boolean;
  screensAdded: string[];
  screensRemoved: string[];
  controls: CanvasControlDiff[];
  templateChanges: {
    added: string[];
    removed: string[];
  };
}

export interface CanvasPatchControlDefinition {
  name: string;
  templateName: string;
  templateVersion: string;
  properties?: Record<string, CanvasJsonValue>;
  children?: CanvasPatchControlDefinition[];
}

export type CanvasPatchOperation =
  | {
      op: 'set-property';
      controlPath: string;
      property: string;
      value: CanvasJsonValue;
    }
  | {
      op: 'remove-property';
      controlPath: string;
      property: string;
    }
  | {
      op: 'add-control';
      screen: string;
      parentPath?: string;
      control: CanvasPatchControlDefinition;
    }
  | {
      op: 'remove-control';
      controlPath: string;
    };

export interface CanvasPatchDocument {
  schemaVersion: 1;
  operations: CanvasPatchOperation[];
}

export interface CanvasPatchPlanStep {
  index: number;
  op: CanvasPatchOperation['op'];
  controlPath?: string;
  screen?: string;
  status: 'ready' | 'error';
  description: string;
}

export interface CanvasPatchPlanResult {
  path: string;
  sourceKind: CanvasSourceModel['kind'];
  valid: boolean;
  operations: CanvasPatchPlanStep[];
}

export interface CanvasPatchApplyResult {
  path: string;
  outPath: string;
  appliedOperations: number;
  filesWritten: string[];
  sourceHash: string;
}

export interface CanvasCliResolution {
  path: string;
  registries: string[];
  workspace?: {
    path: string;
    name: string;
  };
}

export type CanvasAppSummary = DataverseCanvasAppSummary & {
  inSolution?: boolean;
};

const CANVAS_REMOTE_PROGRESS_HEARTBEAT_MS = 10_000;

export interface CanvasRemoteDownloadResult {
  app: CanvasAppSummary;
  solutionUniqueName: string;
  outPath: string;
  exportedEntry: string;
  availableEntries: string[];
  extractedPath?: string;
  extractedEntries?: string[];
  solutionResolution: CanvasRemoteDownloadResolution;
}

export interface CanvasRemoteAttachImpact {
  addedComponents: SolutionComponentSummary[];
  addedRequiredComponents: SolutionComponentSummary[];
  missingDependencies: SolutionDependencySummary[];
  summary: {
    componentCountBefore: number;
    componentCountAfter: number;
    addedComponentCount: number;
    addedRequiredComponentCount: number;
    missingDependencyCount: number;
  };
}

export interface CanvasRemoteAttachResult extends CanvasAppAttachResult {
  solutionImpact?: CanvasRemoteAttachImpact;
}

export interface CanvasRemoteAttachPlanResult {
  app: CanvasAppSummary;
  targetSolution: Pick<SolutionSummary, 'solutionid' | 'uniquename' | 'friendlyname' | 'version' | 'ismanaged'>;
  alreadyInTargetSolution: boolean;
  containingSolutions: CanvasRemoteDownloadCandidateSolution[];
  targetSolutionBaseline: {
    components: SolutionComponentSummary[];
    missingDependencies: SolutionDependencySummary[];
    summary: {
      componentCount: number;
      canvasAppCount: number;
      missingDependencyCount: number;
    };
  };
  previewLimitations: string[];
}

export interface CanvasRemoteImportResult {
  app: CanvasAppSummary;
  solutionUniqueName: string;
  sourcePath: string;
  importedEntry: string;
  availableEntries: string[];
  importOptions: {
    publishWorkflows: boolean;
    overwriteUnmanagedCustomizations: boolean;
  };
}

export type CanvasRemoteDownloadStage =
  | 'resolve-app'
  | 'export-solution'
  | 'read-solution-archive'
  | 'extract-solution-archive'
  | 'replace-msapp'
  | 'rebuild-solution'
  | 'import-solution'
  | 'write-msapp'
  | 'extract-source';

export interface CanvasRemoteDownloadProgressEvent {
  stage: CanvasRemoteDownloadStage;
  detail?: string;
}

export type CanvasLocalProgressStage =
  | 'load-source'
  | 'load-registries'
  | 'resolve-templates'
  | 'build-semantic-model'
  | 'validate'
  | 'build-package';

export interface CanvasLocalProgressEvent {
  stage: CanvasLocalProgressStage;
  detail?: string;
}

export interface CanvasRemoteDownloadCandidateSolution {
  solutionId: string;
  uniqueName?: string;
  friendlyName?: string;
  isManaged?: boolean;
}

export interface CanvasRemoteDownloadResolution {
  status: 'ready' | 'requires-solution-membership' | 'solution-ambiguous';
  requestedSolutionUniqueName?: string;
  resolvedSolutionUniqueName?: string;
  autoResolved: boolean;
  candidateSolutions: CanvasRemoteDownloadCandidateSolution[];
}

interface CanvasTemplateCandidate {
  template: CanvasTemplateRecord;
  matchedBy: CanvasTemplateMatchType;
}

interface LoadedRegistryDocument {
  path: string;
  hash: string;
  document: CanvasTemplateRegistryDocument;
}

interface CanvasComparable {
  source: CanvasSourceModel;
  packageKind: 'source';
}

interface PreparedCanvasValidation {
  source: CanvasSourceModel;
  templateRequirements: CanvasTemplateRequirementResolution;
  semanticModel: Awaited<ReturnType<typeof buildCanvasSemanticModel>>;
  invalidPropertyChecks: CanvasPropertyCheck[];
  unresolvedTemplates: CanvasTemplateUsageIssue[];
  unsupportedTemplates: CanvasTemplateUsageIssue[];
  report: CanvasValidationReport;
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
}

const DEFAULT_SUPPORTED_MODES: CanvasBuildMode[] = ['strict', 'seeded', 'registry'];

export class CanvasService {
  constructor(private readonly dataverseClient?: DataverseClient) {}

  async inspect(
    path: string,
    options: CanvasSourceLoadOptions & {
      mode?: CanvasBuildMode;
    } = {}
  ): Promise<OperationResult<CanvasInspectReport>> {
    return inspectCanvasApp(path, options);
  }

  async validate(
    path: string,
    options: CanvasSourceLoadOptions & {
      mode?: CanvasBuildMode;
      onProgress?: (event: CanvasLocalProgressEvent) => void;
    } = {}
  ): Promise<OperationResult<CanvasValidationReport>> {
    return validateCanvasApp(path, options);
  }

  async lint(
    path: string,
    options: CanvasSourceLoadOptions & {
      mode?: CanvasBuildMode;
      onProgress?: (event: CanvasLocalProgressEvent) => void;
    } = {}
  ): Promise<OperationResult<CanvasLintReport>> {
    return lintCanvasApp(path, options);
  }

  async build(
    path: string,
    options: CanvasSourceLoadOptions & {
      mode?: CanvasBuildMode;
      outPath?: string;
      onProgress?: (event: CanvasLocalProgressEvent) => void;
    } = {}
  ): Promise<OperationResult<CanvasBuildResult>> {
    return buildCanvasApp(path, options);
  }

  async diff(leftPath: string, rightPath: string): Promise<OperationResult<CanvasDiffResult>> {
    return diffCanvasApps(leftPath, rightPath);
  }

  async loadRegistries(options: CanvasRegistryLoadOptions = {}): Promise<OperationResult<CanvasRegistryBundle>> {
    return loadCanvasTemplateRegistryBundle(options);
  }

  async importRegistry(request: CanvasRegistryImportRequest): Promise<OperationResult<CanvasTemplateRegistryDocument>> {
    return importCanvasTemplateRegistry(request);
  }

  async inspectWorkspace(path: string): Promise<OperationResult<CanvasWorkspaceInspectReport>> {
    return inspectCanvasWorkspace(path);
  }

  async resolveWorkspaceTarget(
    target: string,
    options: {
      workspacePath: string;
      registries?: string[];
    }
  ): Promise<OperationResult<CanvasCliResolution>> {
    return resolveCanvasWorkspaceTarget(target, options);
  }

  async inspectRegistry(path: string): Promise<OperationResult<CanvasTemplateRegistryInspectReport>> {
    return inspectCanvasTemplateRegistry(path);
  }

  async diffRegistries(leftPath: string, rightPath: string): Promise<OperationResult<CanvasTemplateRegistryDiffResult>> {
    return diffCanvasTemplateRegistries(leftPath, rightPath);
  }

  async auditRegistry(path: string): Promise<OperationResult<CanvasTemplateRegistryAuditReport>> {
    return auditCanvasTemplateRegistry(path);
  }

  async pinRegistry(path: string, outPath: string): Promise<OperationResult<CanvasTemplateRegistryPinResult>> {
    return pinCanvasTemplateRegistry(path, outPath);
  }

  async refreshRegistry(
    request: CanvasRegistryImportRequest & {
      currentPath?: string;
    }
  ): Promise<OperationResult<CanvasTemplateRegistryRefreshResult>> {
    return refreshCanvasTemplateRegistry(request);
  }

  async planPatch(path: string, patch: CanvasPatchDocument): Promise<OperationResult<CanvasPatchPlanResult>> {
    return planCanvasPatch(path, patch);
  }

  async applyPatch(
    path: string,
    patch: CanvasPatchDocument,
    outPath?: string
  ): Promise<OperationResult<CanvasPatchApplyResult>> {
    return applyCanvasPatch(path, patch, outPath);
  }

  async listRemote(options: { solutionUniqueName?: string } = {}): Promise<OperationResult<CanvasAppSummary[]>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'CANVAS_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote canvas app listing.', {
          source: '@pp/canvas',
        })
      );
    }

    const records = await new CanvasAppService(this.dataverseClient).list();

    if (!records.success) {
      return records as unknown as OperationResult<CanvasAppSummary[]>;
    }

    let allowedIds: Set<string> | undefined;
    let diagnostics = records.diagnostics;
    let warnings = records.warnings;

    if (options.solutionUniqueName) {
      const components = await new SolutionService(this.dataverseClient).components(options.solutionUniqueName);

      if (!components.success) {
        return components as unknown as OperationResult<CanvasAppSummary[]>;
      }

      allowedIds = new Set(
        (components.data ?? [])
          .map((component) => component.objectId)
          .filter((componentId): componentId is string => Boolean(componentId))
      );
      diagnostics = [...diagnostics, ...components.diagnostics];
      warnings = [...warnings, ...components.warnings];
    }

    return ok(
      (records.data ?? [])
        .filter((record) => !allowedIds || allowedIds.has(record.id))
        .map((record) => ({
          ...record,
          inSolution: allowedIds ? allowedIds.has(record.id) : undefined,
        }))
        .sort((left, right) => (left.displayName ?? left.name ?? left.id).localeCompare(right.displayName ?? right.name ?? right.id)),
      {
        supportTier: 'preview',
        diagnostics,
        warnings,
      }
    );
  }

  async inspectRemote(
    identifier: string,
    options: {
      solutionUniqueName?: string;
    } = {}
  ): Promise<OperationResult<CanvasAppSummary | undefined>> {
    const apps = await this.listRemote(options);

    if (!apps.success) {
      return apps as unknown as OperationResult<CanvasAppSummary | undefined>;
    }

    const normalized = identifier.toLowerCase();
    const match = (apps.data ?? []).find(
      (app) => app.id.toLowerCase() === normalized || app.name?.toLowerCase() === normalized || app.displayName?.toLowerCase() === normalized
    );

    return ok(match, {
      supportTier: 'preview',
      diagnostics: apps.diagnostics,
      warnings: apps.warnings,
    });
  }

  async accessRemote(
    identifier: string,
    options: {
      solutionUniqueName?: string;
    } = {}
  ): Promise<OperationResult<AssetAccessReport | undefined>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'CANVAS_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote canvas access inspection.', {
          source: '@pp/canvas',
        })
      );
    }

    const app = await this.inspectRemote(identifier, options);

    if (!app.success) {
      return app as unknown as OperationResult<AssetAccessReport | undefined>;
    }

    if (!app.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: app.diagnostics,
        warnings: app.warnings,
      });
    }

    const access = await new CanvasAppService(this.dataverseClient).access(app.data.id);

    if (!access.success) {
      return access as unknown as OperationResult<AssetAccessReport | undefined>;
    }

    return ok(access.data, {
      supportTier: access.supportTier,
      diagnostics: mergeDiagnosticLists(app.diagnostics, access.diagnostics),
      warnings: mergeDiagnosticLists(app.warnings, access.warnings),
    });
  }

  async planRemoteDownload(
    identifier: string,
    options: {
      solutionUniqueName?: string;
    } = {}
  ): Promise<OperationResult<{ app: CanvasAppSummary; resolution: CanvasRemoteDownloadResolution } | undefined>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'CANVAS_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote canvas app download.', {
          source: '@pp/canvas',
        })
      );
    }

    const app = await this.inspectRemote(identifier, {
      solutionUniqueName: options.solutionUniqueName,
    });

    if (!app.success) {
      return app as unknown as OperationResult<{ app: CanvasAppSummary; resolution: CanvasRemoteDownloadResolution } | undefined>;
    }

    if (!app.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: app.diagnostics,
        warnings: app.warnings,
      });
    }

    if (options.solutionUniqueName) {
      return ok(
        {
          app: app.data,
          resolution: {
            status: 'ready',
            requestedSolutionUniqueName: options.solutionUniqueName,
            resolvedSolutionUniqueName: options.solutionUniqueName,
            autoResolved: false,
            candidateSolutions: [],
          },
        },
        {
          supportTier: 'preview',
          diagnostics: app.diagnostics,
          warnings: app.warnings,
        }
      );
    }

    const containingSolutions = await this.listContainingSolutions(app.data.id);

    if (!containingSolutions.success || !containingSolutions.data) {
      return containingSolutions as unknown as OperationResult<{ app: CanvasAppSummary; resolution: CanvasRemoteDownloadResolution } | undefined>;
    }

    const candidates = containingSolutions.data;
    const readyCandidate = candidates.length === 1 ? candidates[0] : undefined;

    return ok(
      {
        app: app.data,
        resolution: {
          status:
            candidates.length === 0
              ? 'requires-solution-membership'
              : candidates.length === 1 && readyCandidate?.uniqueName
                ? 'ready'
                : 'solution-ambiguous',
          resolvedSolutionUniqueName: readyCandidate?.uniqueName,
          autoResolved: Boolean(readyCandidate?.uniqueName),
          candidateSolutions: candidates,
        },
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(app.diagnostics, containingSolutions.diagnostics),
        warnings: mergeDiagnosticLists(app.warnings, containingSolutions.warnings),
      }
    );
  }

  async downloadRemote(
    identifier: string,
    options: {
      solutionUniqueName?: string;
      outPath?: string;
      extractToDirectory?: string;
      onProgress?: (event: CanvasRemoteDownloadProgressEvent) => void | Promise<void>;
    }
  ): Promise<OperationResult<CanvasRemoteDownloadResult>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'CANVAS_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote canvas app download.', {
          source: '@pp/canvas',
        })
      );
    }

    await options.onProgress?.({
      stage: 'resolve-app',
      detail: options.solutionUniqueName
        ? `Resolving canvas app ${identifier} in solution ${options.solutionUniqueName}.`
        : `Resolving canvas app ${identifier} and its containing solution.`,
    });
    const planned = await this.planRemoteDownload(identifier, {
      solutionUniqueName: options.solutionUniqueName,
    });

    if (!planned.success) {
      return planned as unknown as OperationResult<CanvasRemoteDownloadResult>;
    }

    if (!planned.data) {
        return fail(
          [
            ...planned.diagnostics,
            createDiagnostic('error', 'CANVAS_REMOTE_NOT_FOUND', `Canvas app ${identifier} was not found${options.solutionUniqueName ? ` in solution ${options.solutionUniqueName}` : ''}.`, {
              source: '@pp/canvas',
            }),
          ],
          {
            supportTier: 'preview',
            warnings: planned.warnings,
          }
        );
    }

    const app = planned.data.app;
    const solutionResolution = planned.data.resolution;
    const resolvedSolutionUniqueName = solutionResolution.resolvedSolutionUniqueName;

    if (solutionResolution.status === 'requires-solution-membership' || !resolvedSolutionUniqueName) {
      return fail(
        [
          ...planned.diagnostics,
          createDiagnostic(
            'error',
            'CANVAS_REMOTE_DOWNLOAD_SOLUTION_REQUIRED',
            `Canvas app ${identifier} is discoverable in the target environment but not currently downloadable because it is not attached to an exportable solution.`,
            {
              source: '@pp/canvas',
              hint: 'Attach the app to a solution first, or retry with --solution when you know the correct containing solution.',
            }
          ),
        ],
        {
          supportTier: 'preview',
          warnings: planned.warnings,
        }
      );
    }

    if (solutionResolution.status === 'solution-ambiguous') {
      return fail(
        [
          ...planned.diagnostics,
          createDiagnostic(
            'error',
            'CANVAS_REMOTE_DOWNLOAD_SOLUTION_AMBIGUOUS',
            `Canvas app ${identifier} belongs to multiple solutions, so pp needs an explicit --solution to choose the correct export package.`,
            {
              source: '@pp/canvas',
              detail: solutionResolution.candidateSolutions
                .map((candidate) => candidate.uniqueName ?? candidate.solutionId)
                .join(', '),
              hint: 'Retry with --solution <unique-name> to pick the intended containing solution.',
            }
          ),
        ],
        {
          supportTier: 'preview',
          warnings: planned.warnings,
        }
      );
    }

    const exportRoot = await mkdtemp(join(tmpdir(), 'pp-canvas-remote-download-'));

    try {
      const packagePath = join(exportRoot, `${resolvedSolutionUniqueName}.zip`);
      await options.onProgress?.({
        stage: 'export-solution',
        detail: `Exporting solution ${resolvedSolutionUniqueName}.${solutionResolution.autoResolved ? ' (auto-resolved from solution membership)' : ''}`,
      });
      const stopExportHeartbeat = startCanvasRemoteProgressHeartbeat(options.onProgress, 'export-solution', `Still exporting solution ${resolvedSolutionUniqueName}...`);
      let exported: Awaited<ReturnType<SolutionService['exportSolution']>>;
      try {
        exported = await new SolutionService(this.dataverseClient).exportSolution(resolvedSolutionUniqueName, {
          outPath: packagePath,
        });
      } finally {
        stopExportHeartbeat();
      }

      if (!exported.success || !exported.data) {
        return exported as unknown as OperationResult<CanvasRemoteDownloadResult>;
      }

      await options.onProgress?.({
        stage: 'read-solution-archive',
        detail: `Inspecting CanvasApps entries from exported solution ${resolvedSolutionUniqueName}.`,
      });
      const listedEntries = await listZipEntries(packagePath);

      if (!listedEntries.success || !listedEntries.data) {
        return listedEntries as unknown as OperationResult<CanvasRemoteDownloadResult>;
      }

      const availableEntries = listedEntries.data.filter((entry) => /^CanvasApps\/.+\.msapp$/i.test(entry));

      if (availableEntries.length === 0) {
        return fail(
          [
            ...planned.diagnostics,
            ...exported.diagnostics,
            createDiagnostic(
              'error',
              'CANVAS_REMOTE_EXPORT_MISSING_MSAPP',
              `Solution ${resolvedSolutionUniqueName} exported successfully but did not contain any CanvasApps/*.msapp entries.`,
              {
                source: '@pp/canvas',
                path: packagePath,
                hint: 'Confirm the target app is part of the specified solution and has been saved into solution-aware exportable state.',
              }
            ),
          ],
          {
            supportTier: 'preview',
            warnings: [...planned.warnings, ...exported.warnings],
          }
        );
      }

      const matchedEntry = resolveCanvasMsappEntry(app, availableEntries);

      if (!matchedEntry) {
        return fail(
          [
            ...planned.diagnostics,
            ...exported.diagnostics,
            createDiagnostic(
              'error',
              'CANVAS_REMOTE_EXPORT_ENTRY_AMBIGUOUS',
              `Could not map canvas app ${identifier} to a single CanvasApps/*.msapp entry in solution ${resolvedSolutionUniqueName}.`,
              {
                source: '@pp/canvas',
                hint: `Available entries: ${availableEntries.join(', ')}`,
              }
            ),
          ],
          {
            supportTier: 'preview',
            warnings: [...planned.warnings, ...exported.warnings],
          }
        );
      }

      const content = await extractZipEntry(packagePath, matchedEntry);

      if (!content.success || content.data === undefined) {
        return content as unknown as OperationResult<CanvasRemoteDownloadResult>;
      }

      const outPath = resolve(options.outPath ?? `${defaultCanvasDownloadBaseName(app)}.msapp`);
      await options.onProgress?.({
        stage: 'write-msapp',
        detail: `Writing ${matchedEntry} to ${outPath}.`,
      });
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, content.data);

      let extractedPath: string | undefined;
      let extractedEntries: string[] | undefined;

      if (options.extractToDirectory) {
        await options.onProgress?.({
          stage: 'extract-source',
          detail: `Extracting ${outPath} into ${resolve(options.extractToDirectory)}.`,
        });
        const extracted = await extractCanvasMsappArchive(outPath, resolve(options.extractToDirectory));

        if (!extracted.success || !extracted.data) {
          return extracted as unknown as OperationResult<CanvasRemoteDownloadResult>;
        }

        extractedPath = extracted.data.outPath;
        extractedEntries = extracted.data.entries;
      }

      return ok(
        {
          app,
          solutionUniqueName: resolvedSolutionUniqueName,
          outPath,
          exportedEntry: matchedEntry,
          availableEntries,
          extractedPath,
          extractedEntries,
          solutionResolution,
        },
        {
          supportTier: 'preview',
          diagnostics: [...planned.diagnostics, ...exported.diagnostics],
          warnings: [...planned.warnings, ...exported.warnings],
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse ExportSolution',
            },
          ],
        }
      );
    } finally {
      await rm(exportRoot, { recursive: true, force: true });
    }
  }

  async proveRemote(
    identifier: string,
    options: {
      solutionUniqueName: string;
      expectations: CanvasRemoteProofExpectation[];
    }
  ): Promise<OperationResult<CanvasRemoteProofReport>> {
    const proofRoot = await mkdtemp(join(tmpdir(), 'pp-canvas-remote-proof-'));

    try {
      const downloaded = await this.downloadRemote(identifier, {
        solutionUniqueName: options.solutionUniqueName,
        outPath: join(proofRoot, 'remote.msapp'),
        extractToDirectory: join(proofRoot, 'source'),
      });

      if (!downloaded.success || !downloaded.data?.extractedPath) {
        return downloaded as unknown as OperationResult<CanvasRemoteProofReport>;
      }

      const loaded = await loadCanvasSource(downloaded.data.extractedPath);

      if (!loaded.success || !loaded.data) {
        return loaded as unknown as OperationResult<CanvasRemoteProofReport>;
      }

      const harvestedProofs = await loadHarvestedCanvasPropertyProofs(downloaded.data.extractedPath);

      if (!harvestedProofs.success || !harvestedProofs.data) {
        return harvestedProofs as unknown as OperationResult<CanvasRemoteProofReport>;
      }

      const loadedSource = loaded.data;
      const harvestedProofMap = harvestedProofs.data;
      const expectations = options.expectations.map((expectation) =>
        buildCanvasRemoteProofCheck(
          loadedSource,
          expectation,
          harvestedProofMap.get(buildCanvasProofKey(expectation.controlPath, expectation.property))
        )
      );
      const mismatchDiagnostics = buildCanvasRemoteProofDiagnostics(expectations);
      const conflictDiagnostics = buildCanvasRemoteProofConflictDiagnostics(expectations);

      return ok(
        {
          valid: expectations.every((expectation) => expectation.matched),
          appId: downloaded.data.app.id,
          sourceHash: loaded.data.sourceHash,
          screenCount: loaded.data.screens.length,
          controlCount: loaded.data.controls.length,
          dataSources: uniqueSorted((loaded.data.dataSources ?? []).map((source) => source.name)),
          expectations,
        },
        {
          supportTier: 'preview',
          diagnostics: [...downloaded.diagnostics, ...loaded.diagnostics, ...mismatchDiagnostics, ...conflictDiagnostics],
          warnings: [...downloaded.warnings, ...loaded.warnings, ...harvestedProofs.warnings],
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse ExportSolution',
            },
            {
              kind: 'inferred',
              source: '@pp/canvas remote proof',
              detail: 'Proof expectations were evaluated from the exported remote canvas source tree, preferring harvested control rules when exported YAML and control metadata disagree.',
            },
          ],
        }
      );
    } finally {
      await rm(proofRoot, { recursive: true, force: true });
    }
  }

  async attachRemote(
    identifier: string,
    options: {
      solutionUniqueName: string;
      addRequiredComponents?: boolean;
    }
  ): Promise<OperationResult<CanvasRemoteAttachResult>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'CANVAS_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote canvas app attachment.', {
          source: '@pp/canvas',
        })
      );
    }

    const solutionService = new SolutionService(this.dataverseClient);
    const beforeComponents = await solutionService.components(options.solutionUniqueName);
    const attached = await new CanvasAppService(this.dataverseClient).attachToSolution(identifier, options.solutionUniqueName, {
      addRequiredComponents: options.addRequiredComponents,
    });

    if (!attached.success || !attached.data) {
      return attached as OperationResult<CanvasRemoteAttachResult>;
    }

    const diagnostics = [...attached.diagnostics];
    const warnings = [...attached.warnings];
    const suggestedNextActions = [...(attached.suggestedNextActions ?? [])];

    if (beforeComponents.success) {
      diagnostics.push(...beforeComponents.diagnostics);
      warnings.push(...beforeComponents.warnings);
    }

    const afterComponents = await solutionService.components(options.solutionUniqueName);
    const afterDependencies = await solutionService.dependencies(options.solutionUniqueName);

    if (!afterComponents.success || !afterDependencies.success || !beforeComponents.success) {
      const failureDetail = [
        !beforeComponents.success ? `Pre-attach components: ${beforeComponents.diagnostics.map((item) => item.message).join('; ')}` : undefined,
        !afterComponents.success ? `Post-attach components: ${afterComponents.diagnostics.map((item) => item.message).join('; ')}` : undefined,
        !afterDependencies.success ? `Post-attach dependencies: ${afterDependencies.diagnostics.map((item) => item.message).join('; ')}` : undefined,
      ]
        .filter(Boolean)
        .join(' ');

      return ok(attached.data, {
        supportTier: attached.supportTier,
        diagnostics,
        warnings: [
          ...warnings,
          createDiagnostic(
            'warning',
            'CANVAS_ATTACH_IMPACT_UNAVAILABLE',
            `Canvas app ${attached.data.app.displayName ?? attached.data.app.name ?? attached.data.app.id} was attached, but pp could not summarize the resulting solution impact in-band.`,
            {
              source: '@pp/canvas',
              detail: failureDetail || undefined,
              hint: `Run \`pp solution inspect ${options.solutionUniqueName} --environment <alias> --format json\` or \`pp solution components ${options.solutionUniqueName} --environment <alias> --format json\` for the authoritative post-attach readback.`,
            }
          ),
        ],
        suggestedNextActions: [
          ...suggestedNextActions,
          `Run \`pp solution inspect ${options.solutionUniqueName} --environment <alias> --format json\` to inspect the current post-attach solution state.`,
        ],
      });
    }

    diagnostics.push(...afterComponents.diagnostics, ...afterDependencies.diagnostics);
    warnings.push(...afterComponents.warnings, ...afterDependencies.warnings);

    const solutionImpact = buildCanvasAttachImpact(attached.data.app.id, beforeComponents.data ?? [], afterComponents.data ?? [], afterDependencies.data ?? []);

    if (solutionImpact.summary.missingDependencyCount > 0) {
      suggestedNextActions.push(
        `Review \`pp solution inspect ${options.solutionUniqueName} --environment <alias> --format json\` to resolve the ${solutionImpact.summary.missingDependencyCount} missing dependenc${solutionImpact.summary.missingDependencyCount === 1 ? 'y' : 'ies'} still present after attach.`
      );
    }

    return ok(
      {
        ...attached.data,
        solutionImpact,
      },
      {
        supportTier: attached.supportTier,
        diagnostics,
        warnings,
        suggestedNextActions: suggestedNextActions.length > 0 ? uniqueSorted(suggestedNextActions) : undefined,
      }
    );
  }

  async planRemoteAttach(
    identifier: string,
    options: {
      solutionUniqueName: string;
    }
  ): Promise<OperationResult<CanvasRemoteAttachPlanResult | undefined>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'CANVAS_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote canvas app attach planning.', {
          source: '@pp/canvas',
        })
      );
    }

    const solutionService = new SolutionService(this.dataverseClient);
    const [app, targetSolution, targetComponents, targetDependencies] = await Promise.all([
      this.inspectRemote(identifier),
      solutionService.inspect(options.solutionUniqueName),
      solutionService.components(options.solutionUniqueName),
      solutionService.dependencies(options.solutionUniqueName),
    ]);

    if (!app.success) {
      return app as unknown as OperationResult<CanvasRemoteAttachPlanResult | undefined>;
    }

    if (!targetSolution.success) {
      return targetSolution as unknown as OperationResult<CanvasRemoteAttachPlanResult | undefined>;
    }

    if (!targetComponents.success) {
      return targetComponents as unknown as OperationResult<CanvasRemoteAttachPlanResult | undefined>;
    }

    if (!targetDependencies.success) {
      return targetDependencies as unknown as OperationResult<CanvasRemoteAttachPlanResult | undefined>;
    }

    if (!app.data) {
      return ok(undefined, {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(
          app.diagnostics,
          targetSolution.diagnostics,
          targetComponents.diagnostics,
          targetDependencies.diagnostics
        ),
        warnings: mergeDiagnosticLists(app.warnings, targetSolution.warnings, targetComponents.warnings, targetDependencies.warnings),
      });
    }

    if (!targetSolution.data) {
      return fail(
        [
          ...mergeDiagnosticLists(app.diagnostics, targetSolution.diagnostics, targetComponents.diagnostics, targetDependencies.diagnostics),
          createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${options.solutionUniqueName} was not found.`, {
            source: '@pp/canvas',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: mergeDiagnosticLists(app.warnings, targetSolution.warnings, targetComponents.warnings, targetDependencies.warnings),
        }
      );
    }

    const containingSolutions = await this.listContainingSolutions(app.data.id);

    if (!containingSolutions.success || !containingSolutions.data) {
      return containingSolutions as unknown as OperationResult<CanvasRemoteAttachPlanResult | undefined>;
    }

    const components = targetComponents.data ?? [];
    const dependencies = targetDependencies.data ?? [];
    const alreadyInTargetSolution = components.some(
      (component) => component.componentType === 300 && component.objectId === app.data?.id
    );
    const previewLimitations = [
      'This preview is read-only and cannot predict the exact component set Dataverse will add during AddSolutionComponent.',
      'Required-component expansion and any new missing dependencies remain authoritative only after a real attach plus post-attach solution readback.',
    ];

    return ok(
      {
        app: app.data,
        targetSolution: {
          solutionid: targetSolution.data.solutionid,
          uniquename: targetSolution.data.uniquename,
          friendlyname: targetSolution.data.friendlyname,
          version: targetSolution.data.version,
          ismanaged: targetSolution.data.ismanaged,
        },
        alreadyInTargetSolution,
        containingSolutions: containingSolutions.data,
        targetSolutionBaseline: {
          components,
          missingDependencies: dependencies.filter((dependency) => dependency.missingRequiredComponent),
          summary: {
            componentCount: components.length,
            canvasAppCount: components.filter((component) => component.componentType === 300).length,
            missingDependencyCount: dependencies.filter((dependency) => dependency.missingRequiredComponent).length,
          },
        },
        previewLimitations,
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(
          app.diagnostics,
          targetSolution.diagnostics,
          targetComponents.diagnostics,
          targetDependencies.diagnostics,
          containingSolutions.diagnostics
        ),
        warnings: mergeDiagnosticLists(
          app.warnings,
          targetSolution.warnings,
          targetComponents.warnings,
          targetDependencies.warnings,
          containingSolutions.warnings
        ),
        suggestedNextActions: uniqueSorted(
          [
            alreadyInTargetSolution
              ? `Canvas app ${app.data.displayName ?? app.data.name ?? app.data.id} is already in solution ${options.solutionUniqueName}; prefer \`pp canvas inspect ${JSON.stringify(app.data.displayName ?? app.data.name ?? app.data.id)} --environment <alias> --solution ${options.solutionUniqueName}\` for readback instead of re-attaching.`
              : undefined,
            containingSolutions.data.length > 0
              ? `Inspect containing solutions with \`pp canvas inspect ${JSON.stringify(app.data.displayName ?? app.data.name ?? app.data.id)} --environment <alias>\` before attaching when you need to compare candidate solution context.`
              : undefined,
            `Use \`pp canvas attach ${JSON.stringify(app.data.displayName ?? app.data.name ?? app.data.id)} --environment <alias> --solution ${options.solutionUniqueName}\` only when you are ready to mutate the target solution.`,
          ].filter((value): value is string => Boolean(value))
        ),
        knownLimitations: previewLimitations,
      }
    );
  }

  async importRemote(
    identifier: string,
    options: {
      solutionUniqueName: string;
      importPath: string;
      publishWorkflows?: boolean;
      overwriteUnmanagedCustomizations?: boolean;
      onProgress?: (event: CanvasRemoteDownloadProgressEvent) => void | Promise<void>;
    }
  ): Promise<OperationResult<CanvasRemoteImportResult>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'CANVAS_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote canvas app import.', {
          source: '@pp/canvas',
        })
      );
    }

    const sourcePath = resolve(options.importPath);
    let sourceBytes: Buffer;
    try {
      sourceBytes = await readFile(sourcePath);
    } catch (error) {
      return fail(
        createDiagnostic('error', 'CANVAS_IMPORT_SOURCE_READ_FAILED', `Failed to read canvas app package ${sourcePath}.`, {
          source: '@pp/canvas',
          path: sourcePath,
          detail: error instanceof Error ? error.message : String(error),
        })
      );
    }

    await options.onProgress?.({
      stage: 'resolve-app',
      detail: `Resolving target canvas app ${identifier} in solution ${options.solutionUniqueName}.`,
    });
    const planned = await this.planRemoteDownload(identifier, {
      solutionUniqueName: options.solutionUniqueName,
    });

    if (!planned.success) {
      return planned as unknown as OperationResult<CanvasRemoteImportResult>;
    }

    if (!planned.data) {
      return fail(
        [
          ...planned.diagnostics,
          createDiagnostic(
            'error',
            'CANVAS_REMOTE_IMPORT_TARGET_NOT_FOUND',
            `Canvas app ${identifier} was not found in solution ${options.solutionUniqueName}.`,
            {
              source: '@pp/canvas',
              hint: 'Run `pp canvas list --environment <alias> --solution <unique-name>` to pick the exact app to replace.',
            }
          ),
        ],
        {
          supportTier: 'preview',
          warnings: planned.warnings,
        }
      );
    }

    const app = planned.data.app;
    const exportRoot = await mkdtemp(join(tmpdir(), 'pp-canvas-remote-import-'));

    try {
      const packagePath = join(exportRoot, `${options.solutionUniqueName}.zip`);
      await options.onProgress?.({
        stage: 'export-solution',
        detail: `Exporting solution ${options.solutionUniqueName} before replacing ${app.displayName ?? app.name ?? app.id}.`,
      });
      const exported = await new SolutionService(this.dataverseClient).exportSolution(options.solutionUniqueName, {
        outPath: packagePath,
      });

      if (!exported.success || !exported.data) {
        return exported as unknown as OperationResult<CanvasRemoteImportResult>;
      }

      await options.onProgress?.({
        stage: 'read-solution-archive',
        detail: `Inspecting CanvasApps entries from exported solution ${options.solutionUniqueName}.`,
      });
      const listedEntries = await listZipEntries(packagePath);

      if (!listedEntries.success || !listedEntries.data) {
        return listedEntries as unknown as OperationResult<CanvasRemoteImportResult>;
      }

      const availableEntries = listedEntries.data.filter((entry) => /^CanvasApps\/.+\.msapp$/i.test(entry));

      if (availableEntries.length === 0) {
        return fail(
          [
            ...planned.diagnostics,
            ...exported.diagnostics,
            createDiagnostic(
              'error',
              'CANVAS_REMOTE_IMPORT_EXPORT_MISSING_MSAPP',
              `Solution ${options.solutionUniqueName} exported successfully but did not contain any CanvasApps/*.msapp entries.`,
              {
                source: '@pp/canvas',
                path: packagePath,
                hint: 'Confirm the target app is part of the specified solution and has been saved into solution-aware exportable state.',
              }
            ),
          ],
          {
            supportTier: 'preview',
            warnings: [...planned.warnings, ...exported.warnings],
          }
        );
      }

      const matchedEntry = resolveCanvasMsappEntry(app, availableEntries);

      if (!matchedEntry) {
        return fail(
          [
            ...planned.diagnostics,
            ...exported.diagnostics,
            createDiagnostic(
              'error',
              'CANVAS_REMOTE_IMPORT_ENTRY_AMBIGUOUS',
              `Could not map canvas app ${identifier} to a single CanvasApps/*.msapp entry in solution ${options.solutionUniqueName}.`,
              {
                source: '@pp/canvas',
                hint: `Available entries: ${availableEntries.join(', ')}`,
              }
            ),
          ],
          {
            supportTier: 'preview',
            warnings: [...planned.warnings, ...exported.warnings],
          }
        );
      }

      const unpackedRoot = join(exportRoot, 'solution');
      await options.onProgress?.({
        stage: 'extract-solution-archive',
        detail: `Extracting ${options.solutionUniqueName} for in-place canvas replacement.`,
      });
      const extracted = await extractZipArchive(packagePath, unpackedRoot);

      if (!extracted.success) {
        return extracted as unknown as OperationResult<CanvasRemoteImportResult>;
      }

      await options.onProgress?.({
        stage: 'replace-msapp',
        detail: `Replacing ${matchedEntry} with ${sourcePath}.`,
      });
      const entryPath = join(unpackedRoot, ...matchedEntry.split('/'));
      await mkdir(dirname(entryPath), { recursive: true });
      await writeFile(entryPath, sourceBytes);

      await rm(packagePath, { force: true });
      await options.onProgress?.({
        stage: 'rebuild-solution',
        detail: `Repacking ${options.solutionUniqueName} after the canvas replacement.`,
      });
      const rebuilt = await createZipArchive(unpackedRoot, packagePath);

      if (!rebuilt.success) {
        return rebuilt as unknown as OperationResult<CanvasRemoteImportResult>;
      }

      const importOptions = {
        publishWorkflows: options.publishWorkflows ?? true,
        overwriteUnmanagedCustomizations: options.overwriteUnmanagedCustomizations ?? false,
      };
      await options.onProgress?.({
        stage: 'import-solution',
        detail: `Importing the rebuilt ${options.solutionUniqueName} package back into Dataverse.`,
      });
      const imported = await new SolutionService(this.dataverseClient).importSolution(packagePath, importOptions);

      if (!imported.success || !imported.data) {
        return imported as unknown as OperationResult<CanvasRemoteImportResult>;
      }

      return ok(
        {
          app,
          solutionUniqueName: options.solutionUniqueName,
          sourcePath,
          importedEntry: matchedEntry,
          availableEntries,
          importOptions,
        },
        {
          supportTier: 'preview',
          diagnostics: mergeDiagnosticLists(planned.diagnostics, exported.diagnostics, imported.diagnostics),
          warnings: mergeDiagnosticLists(planned.warnings, exported.warnings, imported.warnings),
          provenance: [
            {
              kind: 'official-api',
              source: 'Dataverse ExportSolution',
            },
            {
              kind: 'official-api',
              source: 'Dataverse ImportSolution',
            },
          ],
        }
      );
    } finally {
      await rm(exportRoot, { recursive: true, force: true });
    }
  }

  private async listContainingSolutions(appId: string): Promise<OperationResult<CanvasRemoteDownloadCandidateSolution[]>> {
    const client = this.dataverseClient;
    if (!client) {
      return fail(
        createDiagnostic('error', 'CANVAS_REMOTE_DATAVERSE_UNAVAILABLE', 'Dataverse client is not configured for solution lookup.', {
          source: '@pp/canvas',
        }),
        {
          supportTier: 'preview',
        }
      );
    }

    const membership = await client.queryAll<{ _solutionid_value?: string; solutionid?: string }>({
      table: 'solutioncomponents',
      select: ['_solutionid_value', 'solutionid'],
      filter: `objectid eq ${appId} and componenttype eq 300`,
    });

    if (!membership.success) {
      return membership as unknown as OperationResult<CanvasRemoteDownloadCandidateSolution[]>;
    }

    const solutionIds = uniqueSorted(
      (membership.data ?? [])
        .map((record) => record._solutionid_value ?? record.solutionid)
        .filter((value): value is string => Boolean(value))
    );

    if (solutionIds.length === 0) {
      return ok([], {
        supportTier: 'preview',
        diagnostics: membership.diagnostics,
        warnings: membership.warnings,
      });
    }

    const solutionFilter = solutionIds.map((solutionId) => `solutionid eq ${solutionId}`).join(' or ');
    const solutions = await client.queryAll<{
      solutionid: string;
      uniquename?: string;
      friendlyname?: string;
      ismanaged?: boolean;
    }>({
      table: 'solutions',
      select: ['solutionid', 'uniquename', 'friendlyname', 'ismanaged'],
      filter: solutionFilter,
    });

    if (!solutions.success) {
      return solutions as unknown as OperationResult<CanvasRemoteDownloadCandidateSolution[]>;
    }

    const byId = new Map((solutions.data ?? []).map((solution) => [solution.solutionid, solution]));
    const candidates = solutionIds.map((solutionId) => {
      const solution = byId.get(solutionId);
      return {
        solutionId,
        uniqueName: solution?.uniquename,
        friendlyName: solution?.friendlyname,
        isManaged: solution?.ismanaged,
      };
    });

    return ok(candidates, {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(membership.diagnostics, solutions.diagnostics),
      warnings: mergeDiagnosticLists(membership.warnings, solutions.warnings),
    });
  }
}

function buildCanvasAttachImpact(
  attachedAppId: string,
  beforeComponents: SolutionComponentSummary[],
  afterComponents: SolutionComponentSummary[],
  dependencies: SolutionDependencySummary[]
): CanvasRemoteAttachImpact {
  const beforeKeys = new Set(beforeComponents.map((component) => solutionComponentKey(component)));
  const addedComponents = afterComponents.filter((component) => !beforeKeys.has(solutionComponentKey(component)));
  const addedRequiredComponents = addedComponents.filter((component) => component.objectId !== attachedAppId);
  const missingDependencies = dependencies.filter((dependency) => dependency.missingRequiredComponent);

  return {
    addedComponents,
    addedRequiredComponents,
    missingDependencies,
    summary: {
      componentCountBefore: beforeComponents.length,
      componentCountAfter: afterComponents.length,
      addedComponentCount: addedComponents.length,
      addedRequiredComponentCount: addedRequiredComponents.length,
      missingDependencyCount: missingDependencies.length,
    },
  };
}

function solutionComponentKey(component: SolutionComponentSummary): string {
  return `${component.componentType ?? 'unknown'}:${component.objectId ?? component.id}`;
}

function defaultCanvasDownloadBaseName(app: CanvasAppSummary): string {
  return sanitizeCanvasArtifactName(app.displayName ?? app.name ?? app.id);
}

function buildCanvasRemoteProofCheck(
  source: CanvasSourceModel,
  expectation: CanvasRemoteProofExpectation,
  harvestedActualValueText?: string
): CanvasRemoteProofCheck {
  const control = findCanvasControlByPath(source, expectation.controlPath);
  const actualValue = control?.properties[expectation.property];
  const sourceActualValueText = actualValue === undefined ? undefined : formatCanvasProofValue(actualValue);
  const actualValueText = harvestedActualValueText ?? sourceActualValueText;
  const normalizedExpectedValueText = normalizeCanvasProofFormulaText(expectation.expectedValue);
  const normalizedSourceActualValueText = normalizeCanvasProofFormulaText(sourceActualValueText);
  const normalizedHarvestedActualValueText = normalizeCanvasProofFormulaText(harvestedActualValueText);
  const normalizedActualValueText = normalizeCanvasProofFormulaText(actualValueText);
  const conflict =
    harvestedActualValueText !== undefined &&
    sourceActualValueText !== undefined &&
    normalizedHarvestedActualValueText !== normalizedSourceActualValueText;

  return {
    controlPath: expectation.controlPath,
    property: expectation.property,
    found: actualValueText !== undefined,
    matched: normalizedActualValueText === normalizedExpectedValueText,
    expectedValue: expectation.expectedValue,
    actualValue: harvestedActualValueText !== undefined ? harvestedActualValueText : actualValue,
    actualValueText,
    sourceActualValueText,
    harvestedActualValueText,
    evidence: harvestedActualValueText !== undefined ? 'harvested' : sourceActualValueText !== undefined ? 'source' : undefined,
    conflict,
  };
}

function buildCanvasRemoteProofDiagnostics(expectations: CanvasRemoteProofCheck[]): Diagnostic[] {
  const mismatches = expectations.filter((expectation) => !expectation.matched);

  if (mismatches.length === 0) {
    return [];
  }

  const detail = mismatches
    .map((expectation) =>
      expectation.found
        ? `${expectation.controlPath}.${expectation.property}: expected ${expectation.expectedValue}, actual ${expectation.actualValueText ?? '<missing>'}`
        : `${expectation.controlPath}.${expectation.property}: control property was not found; expected ${expectation.expectedValue}`
    )
    .join('\n');

  return [
    createDiagnostic(
      'warning',
      'CANVAS_REMOTE_PROOF_MISMATCH',
      `Remote canvas proof found ${mismatches.length} unmatched expectation${mismatches.length === 1 ? '' : 's'}.`,
      {
        source: '@pp/canvas remote proof',
        detail,
        hint: 'Re-run with the returned proof payload to compare actualValueText against the expected control path and property.',
      }
    ),
  ];
}

function buildCanvasRemoteProofConflictDiagnostics(expectations: CanvasRemoteProofCheck[]): Diagnostic[] {
  return expectations
    .filter((expectation) => expectation.conflict)
    .map((expectation) =>
      createDiagnostic(
        'warning',
        'CANVAS_REMOTE_PROOF_SOURCE_CONFLICT',
        `Remote canvas proof found conflicting exported values for ${expectation.controlPath}.${expectation.property}.`,
        {
          source: '@pp/canvas remote proof',
          detail: `Source YAML: ${expectation.sourceActualValueText ?? '<missing>'}\nHarvested Controls: ${expectation.harvestedActualValueText ?? '<missing>'}`,
          hint: 'The proof result used harvested Controls/*.json rule metadata because it more directly reflects the exported runtime control binding.',
        }
      )
    );
}

function formatCanvasProofValue(value: CanvasJsonValue): string {
  return typeof value === 'string' ? value : stableStringify(value as Parameters<typeof stableStringify>[0]);
}

function normalizeCanvasProofFormulaText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  return trimmed.startsWith('=') ? trimmed : `=${trimmed}`;
}

function buildCanvasProofKey(controlPath: string, property: string): string {
  return `${controlPath}::${property}`.toLowerCase();
}

function startCanvasRemoteProgressHeartbeat(
  onProgress: ((event: CanvasRemoteDownloadProgressEvent) => void | Promise<void>) | undefined,
  stage: CanvasRemoteDownloadStage,
  detail: string
): () => void {
  if (!onProgress) {
    return () => {};
  }

  const timer = setInterval(() => {
    void onProgress({
      stage,
      detail,
    });
  }, CANVAS_REMOTE_PROGRESS_HEARTBEAT_MS);

  return () => clearInterval(timer);
}

async function loadHarvestedCanvasPropertyProofs(root: string): Promise<OperationResult<Map<string, string>>> {
  const controlsDir = join(root, 'Controls');

  try {
    const directory = await stat(controlsDir);
    if (!directory.isDirectory()) {
      return ok(new Map(), {
        supportTier: 'preview',
      });
    }
  } catch {
    return ok(new Map(), {
      supportTier: 'preview',
    });
  }

  const files = await readdir(controlsDir, { withFileTypes: true });
  const proofs = new Map<string, string>();

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) {
      continue;
    }

    const document = await readJsonFile<unknown>(join(controlsDir, file.name));
    collectHarvestedCanvasPropertyProofs(document, [], proofs);
  }

  return ok(proofs, {
    supportTier: 'preview',
  });
}

function collectHarvestedCanvasPropertyProofs(value: unknown, path: string[], proofs: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectHarvestedCanvasPropertyProofs(item, path, proofs);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const template = isRecord(value.Template) ? value.Template : undefined;
  const controlName = readStringValue(value.Name);
  const isControlInfo = readStringValue(value.Type) === 'ControlInfo' && template;
  const nextPath = isControlInfo && controlName ? [...path, controlName] : path;

  if (isControlInfo && nextPath.length > 0 && Array.isArray(value.Rules)) {
    for (const rule of value.Rules) {
      if (!isRecord(rule)) {
        continue;
      }

      const property = readStringValue(rule.Property);
      const invariantScript = readStringValue(rule.InvariantScript);

      if (property && invariantScript !== undefined) {
        proofs.set(buildCanvasProofKey(nextPath.join('/'), property), invariantScript);
      }
    }
  }

  for (const nested of Object.values(value)) {
    collectHarvestedCanvasPropertyProofs(nested, nextPath, proofs);
  }
}

function resolveCanvasMsappEntry(app: CanvasAppSummary, entries: string[]): string | undefined {
  if (entries.length === 1) {
    return entries[0];
  }

  const candidates = new Set(
    [app.displayName, app.name, app.id]
      .filter((value): value is string => Boolean(value))
      .map(normalizeCanvasArtifactToken)
      .filter((value) => value.length > 0)
  );

  const matches = entries.filter((entry) => {
    const fileName = basename(entry, extname(entry));
    const normalized = normalizeCanvasArtifactToken(fileName);
    return candidates.has(normalized);
  });

  return matches.length === 1 ? matches[0] : undefined;
}

function sanitizeCanvasArtifactName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();
  return normalized || 'canvas-app';
}

function normalizeCanvasArtifactToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function loadCanvasTemplateRegistryBundle(
  options: CanvasRegistryLoadOptions = {}
): Promise<OperationResult<CanvasRegistryBundle>> {
  const registryPaths = resolveCanvasTemplateRegistryPaths(options);

  if (!registryPaths.success || !registryPaths.data) {
    return registryPaths as unknown as OperationResult<CanvasRegistryBundle>;
  }

  if (registryPaths.data.length === 0) {
    return withWarning(
      ok(
        {
          sources: [],
          templates: [],
          supportMatrix: [],
          hash: sha256Hex(stringifyCanvasJson({ templates: [], supportMatrix: [] })),
        },
        {
          supportTier: 'preview',
        }
      ),
      createDiagnostic(
        'warning',
        'CANVAS_TEMPLATE_REGISTRY_NOT_CONFIGURED',
        'No canvas template registries were configured.',
        {
          source: '@pp/canvas',
          hint: 'Add templateRegistries entries to pp.config.* or provide registry paths explicitly.',
        }
      )
    );
  }

  const warnings: Diagnostic[] = [];
  const diagnostics: Diagnostic[] = [];
  const mergedTemplates = new Map<string, CanvasTemplateRecord>();
  const supportMatrix: CanvasSupportMatrixEntry[] = [];
  const sources: CanvasRegistrySourceSummary[] = [];

  for (const path of registryPaths.data) {
    const document = await loadCanvasTemplateRegistryDocument(path);

    if (!document.success || !document.data) {
      return document as unknown as OperationResult<CanvasRegistryBundle>;
    }

    warnings.push(...document.warnings);
    diagnostics.push(...document.diagnostics);
    sources.push({
      path: document.data.path,
      hash: document.data.hash,
      generatedAt: document.data.document.generatedAt,
      templateCount: document.data.document.templates.length,
      supportRuleCount: document.data.document.supportMatrix.length,
    });

    for (const template of document.data.document.templates) {
      mergedTemplates.set(makeTemplateKey(template.templateName, template.templateVersion), template);
    }

    supportMatrix.push(...document.data.document.supportMatrix);
  }

  const templates = Array.from(mergedTemplates.values()).sort(compareTemplates);

  return ok(
    {
      sources,
      templates,
      supportMatrix,
      hash: sha256Hex(stringifyCanvasJson({ templates, supportMatrix })),
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings,
    }
  );
}

export async function importCanvasTemplateRegistry(
  request: CanvasRegistryImportRequest
): Promise<OperationResult<CanvasTemplateRegistryDocument>> {
  const document = await readCanvasJsonFile(request.sourcePath);

  if (!document.success || document.data === undefined) {
    return document as unknown as OperationResult<CanvasTemplateRegistryDocument>;
  }

  const normalized = normalizeCanvasTemplateRegistry(document.data, request.sourcePath, request.provenance);

  if (!normalized.success || !normalized.data) {
    return normalized;
  }

  if (request.outPath) {
    await writeJsonFile(request.outPath, normalized.data as unknown as Parameters<typeof writeJsonFile>[1]);
  }

  return normalized;
}

export async function inspectCanvasWorkspace(path: string): Promise<OperationResult<CanvasWorkspaceInspectReport>> {
  const loaded = await loadCanvasWorkspace(path);

  if (!loaded.success || !loaded.data) {
    return loaded as unknown as OperationResult<CanvasWorkspaceInspectReport>;
  }

  const workspace = loaded.data;

  return ok(
    {
      path: workspace.path,
      workspace: workspace.document,
      apps: workspace.document.apps.map((app) => resolveWorkspaceAppEntry(workspace.document, app, workspace.root)),
      registries: workspace.document.registries ?? [],
      catalogs: workspace.document.catalogs ?? [],
    },
    {
      supportTier: 'preview',
      diagnostics: loaded.diagnostics,
      warnings: loaded.warnings,
    }
  );
}

export async function resolveCanvasWorkspaceTarget(
  target: string,
  options: {
    workspacePath: string;
    registries?: string[];
  }
): Promise<OperationResult<CanvasCliResolution>> {
  const loaded = await loadCanvasWorkspace(options.workspacePath);

  if (!loaded.success || !loaded.data) {
    return loaded as unknown as OperationResult<CanvasCliResolution>;
  }

  const workspace = loaded.data;

  const matched =
    workspace.document.apps.find((app) => app.name.toLowerCase() === target.toLowerCase()) ??
    workspace.document.apps.find((app) => resolve(workspace.root, app.path) === resolve(target));

  if (!matched) {
    return fail(
      [
        ...loaded.diagnostics,
        createDiagnostic('error', 'CANVAS_WORKSPACE_APP_NOT_FOUND', `Canvas workspace ${workspace.document.name} does not define app ${target}.`, {
          source: '@pp/canvas',
        }),
      ],
      {
        supportTier: 'preview',
        warnings: loaded.warnings,
      }
    );
  }

  const resolved = resolveWorkspaceAppEntry(workspace.document, matched, workspace.root);
  const registries = options.registries && options.registries.length > 0 ? options.registries : resolved.registries;

  return ok(
    {
      path: resolved.path,
      registries,
      workspace: {
        path: loaded.data.path,
        name: loaded.data.document.name,
      },
    },
    {
      supportTier: 'preview',
      diagnostics: loaded.diagnostics,
      warnings: loaded.warnings,
    }
  );
}

export async function inspectCanvasTemplateRegistry(
  path: string
): Promise<OperationResult<CanvasTemplateRegistryInspectReport>> {
  const loaded = await loadCanvasTemplateRegistryDocument(resolve(path));

  if (!loaded.success || !loaded.data) {
    return loaded as unknown as OperationResult<CanvasTemplateRegistryInspectReport>;
  }

  return ok(summarizeRegistry(loaded.data), {
    supportTier: 'preview',
    diagnostics: loaded.diagnostics,
    warnings: loaded.warnings,
  });
}

export async function diffCanvasTemplateRegistries(
  leftPath: string,
  rightPath: string
): Promise<OperationResult<CanvasTemplateRegistryDiffResult>> {
  const [left, right] = await Promise.all([
    loadCanvasTemplateRegistryDocument(resolve(leftPath)),
    loadCanvasTemplateRegistryDocument(resolve(rightPath)),
  ]);

  if (!left.success || !left.data) {
    return left as unknown as OperationResult<CanvasTemplateRegistryDiffResult>;
  }

  if (!right.success || !right.data) {
    return right as unknown as OperationResult<CanvasTemplateRegistryDiffResult>;
  }

  return ok(
    diffLoadedCanvasRegistries(left.data, right.data),
    {
      supportTier: 'preview',
      diagnostics: [...left.diagnostics, ...right.diagnostics],
      warnings: [...left.warnings, ...right.warnings],
    }
  );
}

export async function auditCanvasTemplateRegistry(
  path: string
): Promise<OperationResult<CanvasTemplateRegistryAuditReport>> {
  const loaded = await loadCanvasTemplateRegistryDocument(resolve(path));

  if (!loaded.success || !loaded.data) {
    return loaded as unknown as OperationResult<CanvasTemplateRegistryAuditReport>;
  }

  const provenanceKinds = new Map<string, number>();

  for (const template of loaded.data.document.templates) {
    provenanceKinds.set(template.provenance.kind, (provenanceKinds.get(template.provenance.kind) ?? 0) + 1);
  }

  return ok(
    {
      path: loaded.data.path,
      templateCount: loaded.data.document.templates.length,
      supportRuleCount: loaded.data.document.supportMatrix.length,
      missingImportedFromCount: loaded.data.document.templates.filter((template) => !template.provenance.importedFrom).length,
      missingSourceArtifactCount: loaded.data.document.templates.filter((template) => !template.provenance.sourceArtifact).length,
      missingPlatformVersionCount: loaded.data.document.templates.filter((template) => !template.provenance.platformVersion).length,
      missingAppVersionCount: loaded.data.document.templates.filter((template) => !template.provenance.appVersion).length,
      provenanceKinds: Object.fromEntries(Array.from(provenanceKinds.entries()).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))),
      sources: uniqueSorted(loaded.data.document.templates.map((template) => template.provenance.source)),
      importedFrom: uniqueSorted(loaded.data.document.templates.map((template) => template.provenance.importedFrom)),
      sourceArtifacts: uniqueSorted(loaded.data.document.templates.map((template) => template.provenance.sourceArtifact)),
      platformVersions: uniqueSorted(loaded.data.document.templates.map((template) => template.provenance.platformVersion)),
      appVersions: uniqueSorted(loaded.data.document.templates.map((template) => template.provenance.appVersion)),
    },
    {
      supportTier: 'preview',
      diagnostics: loaded.diagnostics,
      warnings: loaded.warnings,
    }
  );
}

export async function pinCanvasTemplateRegistry(
  path: string,
  outPath: string
): Promise<OperationResult<CanvasTemplateRegistryPinResult>> {
  const loaded = await loadCanvasTemplateRegistryDocument(resolve(path));

  if (!loaded.success || !loaded.data) {
    return loaded as unknown as OperationResult<CanvasTemplateRegistryPinResult>;
  }

  await writeJsonFile(outPath, loaded.data.document as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      outPath: resolve(outPath),
      hash: loaded.data.hash,
      generatedAt: loaded.data.document.generatedAt,
      templateCount: loaded.data.document.templates.length,
      supportRuleCount: loaded.data.document.supportMatrix.length,
    },
    {
      supportTier: 'preview',
      diagnostics: loaded.diagnostics,
      warnings: loaded.warnings,
    }
  );
}

export async function refreshCanvasTemplateRegistry(
  request: CanvasRegistryImportRequest & {
    currentPath?: string;
  }
): Promise<OperationResult<CanvasTemplateRegistryRefreshResult>> {
  const current =
    request.currentPath
      ? await loadCanvasTemplateRegistryDocument(resolve(request.currentPath))
      : undefined;
  if (current && (!current.success || !current.data)) {
    return current as unknown as OperationResult<CanvasTemplateRegistryRefreshResult>;
  }
  const imported = await importCanvasTemplateRegistry(request);

  if (!imported.success || !imported.data) {
    return imported as unknown as OperationResult<CanvasTemplateRegistryRefreshResult>;
  }

  const path = resolve(request.outPath ?? request.currentPath ?? request.sourcePath);
  const hash = sha256Hex(stringifyCanvasJson(imported.data));
  const registry = summarizeRegistry({
    path,
    hash,
    document: imported.data,
  });
  let diff: CanvasTemplateRegistryDiffResult | undefined;

  if (current?.data) {
    diff = diffLoadedCanvasRegistries(current.data, {
      path,
      hash,
      document: imported.data,
    });
  }

  return ok(
    {
      registry,
      ...(diff ? { diff } : {}),
    },
    {
      supportTier: 'preview',
      diagnostics: imported.diagnostics,
      warnings: imported.warnings,
    }
  );
}

export async function planCanvasPatch(
  path: string,
  patch: CanvasPatchDocument
): Promise<OperationResult<CanvasPatchPlanResult>> {
  const source = await loadCanvasSource(path);

  if (!source.success || !source.data) {
    return source as unknown as OperationResult<CanvasPatchPlanResult>;
  }

  const sourceModel = source.data;

  if (sourceModel.kind !== 'json-manifest') {
    return fail(
      createDiagnostic('error', 'CANVAS_PATCH_KIND_UNSUPPORTED', `Canvas patch currently supports json-manifest sources only; received ${sourceModel.kind ?? 'unknown'}.`, {
        source: '@pp/canvas',
      })
    );
  }

  const validation = normalizeCanvasPatchDocument(patch);

  if (!validation.success || !validation.data) {
    return validation as unknown as OperationResult<CanvasPatchPlanResult>;
  }

  const operations = validation.data.operations.map((operation, index) => planCanvasPatchOperation(sourceModel, operation, index));

  return ok(
    {
      path: resolve(path),
      sourceKind: sourceModel.kind,
      valid: operations.every((operation) => operation.status === 'ready'),
      operations,
    },
    {
      supportTier: 'preview',
      diagnostics: source.diagnostics,
      warnings: source.warnings,
    }
  );
}

export async function applyCanvasPatch(
  path: string,
  patch: CanvasPatchDocument,
  outPath?: string
): Promise<OperationResult<CanvasPatchApplyResult>> {
  const plan = await planCanvasPatch(path, patch);

  if (!plan.success || !plan.data) {
    return plan as unknown as OperationResult<CanvasPatchApplyResult>;
  }

  if (!plan.data.valid) {
    return fail(
      [
        ...plan.diagnostics,
        createDiagnostic('error', 'CANVAS_PATCH_PLAN_INVALID', `Canvas patch plan for ${path} contains invalid operations.`, {
          source: '@pp/canvas',
        }),
      ],
      {
        supportTier: 'preview',
        warnings: plan.warnings,
      }
    );
  }

  const source = await loadCanvasSource(path);

  if (!source.success || !source.data || source.data.kind !== 'json-manifest') {
    return source as unknown as OperationResult<CanvasPatchApplyResult>;
  }

  const targetRoot = outPath ? resolve(outPath) : source.data.root;

  if (outPath) {
    await cp(source.data.root, targetRoot, { recursive: true });
  }

  const manifest = await readCanvasJsonFile(resolve(targetRoot, basename(source.data.manifestPath)));

  if (!manifest.success || manifest.data === undefined) {
    return manifest as unknown as OperationResult<CanvasPatchApplyResult>;
  }

  const manifestRecord = asRecord(manifest.data);

  if (!manifestRecord || !Array.isArray(manifestRecord.screens)) {
    return fail(
      createDiagnostic('error', 'CANVAS_PATCH_MANIFEST_INVALID', `Canvas manifest ${source.data.manifestPath} is not patchable.`, {
        source: '@pp/canvas',
      })
    );
  }

  const screenRecords = new Map<string, { path: string; document: Record<string, unknown> }>();

  for (const screen of source.data.manifest.screens) {
    const screenPath = resolve(targetRoot, screen.file);
    const screenDocument = await readCanvasJsonFile(screenPath);

    if (!screenDocument.success || screenDocument.data === undefined) {
      return screenDocument as unknown as OperationResult<CanvasPatchApplyResult>;
    }

    const screenRecord = asRecord(screenDocument.data);

    if (!screenRecord) {
      return fail(
        createDiagnostic('error', 'CANVAS_PATCH_SCREEN_INVALID', `Canvas screen ${screenPath} is not patchable.`, {
          source: '@pp/canvas',
        })
      );
    }

    if (!Array.isArray(screenRecord.controls)) {
      screenRecord.controls = [];
    }

    screenRecords.set(screen.name, {
      path: screenPath,
      document: screenRecord,
    });
  }

  for (const operation of patch.operations) {
    applyCanvasPatchOperation(screenRecords, operation);
  }

  const filesWritten: string[] = [];

  await writeJsonFile(resolve(targetRoot, basename(source.data.manifestPath)), manifestRecord as unknown as Parameters<typeof writeJsonFile>[1]);
  filesWritten.push(resolve(targetRoot, basename(source.data.manifestPath)));

  for (const screen of Array.from(screenRecords.values()).sort((left, right) => left.path.localeCompare(right.path))) {
    await writeJsonFile(screen.path, screen.document as unknown as Parameters<typeof writeJsonFile>[1]);
    filesWritten.push(screen.path);
  }

  const reloaded = await loadCanvasSource(targetRoot);

  return ok(
    {
      path: resolve(path),
      outPath: targetRoot,
      appliedOperations: patch.operations.length,
      filesWritten,
      sourceHash: reloaded.success && reloaded.data ? reloaded.data.sourceHash : source.data.sourceHash,
    },
    {
      supportTier: 'preview',
      diagnostics: [...plan.diagnostics, ...(reloaded.success ? reloaded.diagnostics : [])],
      warnings: [...plan.warnings, ...(reloaded.success ? reloaded.warnings : [])],
    }
  );
}

export async function inspectCanvasApp(
  path: string,
  options: CanvasSourceLoadOptions & {
    mode?: CanvasBuildMode;
  } = {}
): Promise<OperationResult<CanvasInspectReport>> {
  const prepared = await prepareCanvasValidation(path, options);

  if (!prepared.success || !prepared.data) {
    return prepared as unknown as OperationResult<CanvasInspectReport>;
  }

  return ok(
    {
      ...prepared.data.report,
      screens: prepared.data.source.screens.map((screen) => ({
        name: screen.name,
        file: screen.file,
        controlCount: flattenControlDefinitions(screen.controls).length,
      })),
      controls: prepared.data.source.controls,
    },
    {
      supportTier: 'preview',
      diagnostics: prepared.data.diagnostics,
      warnings: prepared.data.warnings,
      suggestedNextActions: prepared.suggestedNextActions,
    }
  );
}

export async function validateCanvasApp(
  path: string,
  options: CanvasSourceLoadOptions & {
    mode?: CanvasBuildMode;
    onProgress?: (event: CanvasLocalProgressEvent) => void;
  } = {}
): Promise<OperationResult<CanvasValidationReport>> {
  const prepared = await prepareCanvasValidation(path, options);

  if (!prepared.success || !prepared.data) {
    return prepared as unknown as OperationResult<CanvasValidationReport>;
  }

  return ok(prepared.data.report, {
    supportTier: 'preview',
    diagnostics: prepared.data.diagnostics,
    warnings: prepared.data.warnings,
    suggestedNextActions: prepared.suggestedNextActions,
  });
}

export async function lintCanvasApp(
  path: string,
  options: CanvasSourceLoadOptions & {
    mode?: CanvasBuildMode;
    onProgress?: (event: CanvasLocalProgressEvent) => void;
  } = {}
): Promise<OperationResult<CanvasLintReport>> {
  const prepared = await prepareCanvasValidation(path, options);

  if (!prepared.success || !prepared.data) {
    return prepared as unknown as OperationResult<CanvasLintReport>;
  }

  const lintDiagnostics = buildCanvasLintDiagnostics(prepared.data);
  const diagnostics = lintDiagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => toOperationDiagnostic(diagnostic));
  const warnings = lintDiagnostics
    .filter((diagnostic) => diagnostic.severity === 'warning')
    .map((diagnostic) => toOperationDiagnostic(diagnostic));

  return ok(
    {
      valid: diagnostics.length === 0,
      mode: prepared.data.report.mode,
      source: prepared.data.report.source,
      ...(prepared.data.source.dataSources && prepared.data.source.dataSources.length > 0 ? { dataSources: prepared.data.source.dataSources } : {}),
      registries: prepared.data.report.registries,
      summary: {
        errorCount: diagnostics.length,
        warningCount: warnings.length,
        infoCount: lintDiagnostics.filter((diagnostic) => diagnostic.severity === 'info').length,
      },
      diagnostics: lintDiagnostics,
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings,
    }
  );
}

export async function buildCanvasApp(
  path: string,
  options: CanvasSourceLoadOptions & {
    mode?: CanvasBuildMode;
    outPath?: string;
    onProgress?: (event: CanvasLocalProgressEvent) => void;
  } = {}
): Promise<OperationResult<CanvasBuildResult>> {
  const prepared = await prepareCanvasValidation(path, options);

  if (!prepared.success || !prepared.data) {
    return prepared as unknown as OperationResult<CanvasBuildResult>;
  }

  const outPath = options.outPath ?? resolve(prepared.data.source.root, 'dist', `${prepared.data.source.manifest.name}.msapp`);

  if (!prepared.data.report.valid) {
    return fail(
      prepared.data.diagnostics.length > 0
        ? prepared.data.diagnostics
        : createDiagnostic('error', 'CANVAS_BUILD_INVALID', `Canvas app ${prepared.data.source.manifest.name} is not valid for build.`, {
            source: '@pp/canvas',
          }),
      {
        details: {
          ...prepared.data.report,
          buildable: false,
          outPath,
        },
        supportTier: 'preview',
        warnings: prepared.data.warnings,
        suggestedNextActions: buildCanvasTemplateResolutionNextActions(prepared.data.source, prepared.data.report.mode),
      }
    );
  }

  const resolvedTemplates = prepared.data.templateRequirements.resolutions
    .filter((resolution): resolution is CanvasTemplateResolution & { template: CanvasTemplateRecord } => Boolean(resolution.template))
    .map((resolution) => ({
      requested: resolution.requested,
      templateName: resolution.template.templateName,
      templateVersion: resolution.template.templateVersion,
      contentHash: resolution.template.contentHash,
      matchedBy: resolution.matchedBy,
    }));
  options.onProgress?.({ stage: 'build-package' });
  if (prepared.data.source.kind === 'pa-yaml-unpacked') {
    const nativeBuild = await buildCanvasMsappFromUnpackedSource(
      prepared.data.source,
      prepared.data.templateRequirements,
      outPath
    );

    if (!nativeBuild.success || !nativeBuild.data) {
      return nativeBuild;
    }

    return ok(nativeBuild.data, {
      supportTier: 'preview',
      diagnostics: prepared.data.diagnostics,
      warnings: prepared.data.warnings,
    });
  }

  const packagePayload = {
    schemaVersion: 1,
    kind: 'pp.canvas.package',
    mode: prepared.data.report.mode,
    app: {
      name: prepared.data.source.manifest.name,
      displayName: prepared.data.source.manifest.displayName,
      version: prepared.data.source.manifest.version,
      screens: prepared.data.source.screens,
    },
    sourceHash: prepared.data.source.sourceHash,
    registries: prepared.data.report.registries,
    templates: resolvedTemplates,
  };
  const packageHash = sha256Hex(stringifyCanvasJson(packagePayload));
  const outFileSha256 = sha256Hex(stableStringify(packagePayload as unknown as Parameters<typeof writeJsonFile>[1]) + '\n');

  await writeJsonFile(outPath, packagePayload as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      outPath,
      mode: prepared.data.report.mode,
      sourceHash: prepared.data.source.sourceHash,
      templateHash: sha256Hex(stringifyCanvasJson(resolvedTemplates)),
      packageHash,
      outFileSha256,
      supported: true,
    },
    {
      supportTier: 'preview',
      diagnostics: prepared.data.diagnostics,
      warnings: prepared.data.warnings,
    }
  );
}

export async function diffCanvasApps(leftPath: string, rightPath: string): Promise<OperationResult<CanvasDiffResult>> {
  const [left, right] = await Promise.all([loadCanvasSource(leftPath), loadCanvasSource(rightPath)]);

  if (!left.success || !left.data) {
    return left as unknown as OperationResult<CanvasDiffResult>;
  }

  if (!right.success || !right.data) {
    return right as unknown as OperationResult<CanvasDiffResult>;
  }

  const leftScreens = new Set(left.data.screens.map((screen) => screen.name));
  const rightScreens = new Set(right.data.screens.map((screen) => screen.name));
  const leftControls = new Map(left.data.controls.map((control) => [control.path, control]));
  const rightControls = new Map(right.data.controls.map((control) => [control.path, control]));
  const controlPaths = new Set([...leftControls.keys(), ...rightControls.keys()]);
  const controls: CanvasControlDiff[] = [];

  for (const controlPath of Array.from(controlPaths).sort()) {
    const before = leftControls.get(controlPath);
    const after = rightControls.get(controlPath);

    if (before && !after) {
      controls.push({
        controlPath,
        kind: 'removed',
      });
      continue;
    }

    if (!before && after) {
      controls.push({
        controlPath,
        kind: 'added',
      });
      continue;
    }

    if (before && after) {
      const changedProperties: string[] = [];
      const beforeControl = findCanvasControlByPath(left.data, controlPath);
      const afterControl = findCanvasControlByPath(right.data, controlPath);

      if (before.templateName !== after.templateName) {
        changedProperties.push('templateName');
      }

      if (before.templateVersion !== after.templateVersion) {
        changedProperties.push('templateVersion');
      }

      if (beforeControl && afterControl) {
        changedProperties.push(...diffCanvasControlProperties(beforeControl.properties, afterControl.properties));
      } else if (before.propertyCount !== after.propertyCount) {
        changedProperties.push('properties');
      }

      if (before.childCount !== after.childCount) {
        changedProperties.push('children');
      }

      if (changedProperties.length > 0) {
        controls.push({
          controlPath,
          kind: 'changed',
          changedProperties,
        });
      }
    }
  }

  const leftTemplates = new Set(left.data.templateRequirements.map((item) => `${item.name}@${item.version ?? ''}`));
  const rightTemplates = new Set(right.data.templateRequirements.map((item) => `${item.name}@${item.version ?? ''}`));

  return ok(
    {
      left: leftPath,
      right: rightPath,
      appChanged:
        left.data.manifest.name !== right.data.manifest.name ||
        left.data.manifest.displayName !== right.data.manifest.displayName ||
        left.data.manifest.version !== right.data.manifest.version,
      screensAdded: Array.from(rightScreens).filter((screen) => !leftScreens.has(screen)).sort(),
      screensRemoved: Array.from(leftScreens).filter((screen) => !rightScreens.has(screen)).sort(),
      controls,
      templateChanges: {
        added: Array.from(rightTemplates).filter((item) => !leftTemplates.has(item)).sort(),
        removed: Array.from(leftTemplates).filter((item) => !rightTemplates.has(item)).sort(),
      },
    },
    {
      supportTier: 'preview',
      diagnostics: [...left.diagnostics, ...right.diagnostics],
      warnings: [...left.warnings, ...right.warnings],
    }
  );
}

function mergeCanvasRegistryLoadOptions(
  options: CanvasSourceLoadOptions,
  source: CanvasSourceModel
): CanvasRegistryLoadOptions {
  const registries = [...(options.registries ?? [])];

  for (const path of source.embeddedRegistryPaths ?? []) {
    if (!registries.includes(path)) {
      registries.push(path);
    }
  }

  return {
    root: options.root,
    cacheDir: options.cacheDir,
    registries,
  };
}

function diffCanvasControlProperties(
  before: Record<string, CanvasJsonValue>,
  after: Record<string, CanvasJsonValue>
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: string[] = [];

  for (const key of Array.from(keys).sort()) {
    if (stringifyCanvasJson(before[key]) !== stringifyCanvasJson(after[key])) {
      changes.push(`properties.${key}`);
    }
  }

  return changes;
}

interface LoadedCanvasWorkspace {
  path: string;
  root: string;
  document: CanvasWorkspaceDocument;
}

async function loadCanvasWorkspace(path: string): Promise<OperationResult<LoadedCanvasWorkspace>> {
  const workspacePath = await resolveCanvasWorkspacePath(path);

  if (!workspacePath.success || !workspacePath.data) {
    return workspacePath as unknown as OperationResult<LoadedCanvasWorkspace>;
  }

  const document = await readCanvasJsonFile(workspacePath.data);

  if (!document.success || document.data === undefined) {
    return document as unknown as OperationResult<LoadedCanvasWorkspace>;
  }

  const normalized = normalizeCanvasWorkspaceDocument(document.data, workspacePath.data);

  if (!normalized.success || !normalized.data) {
    return normalized as unknown as OperationResult<LoadedCanvasWorkspace>;
  }

  return ok(
    {
      path: workspacePath.data,
      root: dirname(workspacePath.data),
      document: normalized.data,
    },
    {
      supportTier: 'preview',
      diagnostics: normalized.diagnostics,
      warnings: normalized.warnings,
    }
  );
}

async function resolveCanvasWorkspacePath(path: string): Promise<OperationResult<string>> {
  const candidates = path.endsWith('.json')
    ? [resolve(path)]
    : [resolve(path, 'canvas.workspace.json'), resolve(path, 'canvas-workspace.json')];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return ok(candidate, {
        supportTier: 'preview',
      });
    }
  }

  return fail(
    createDiagnostic('error', 'CANVAS_WORKSPACE_NOT_FOUND', `No canvas workspace manifest was found at ${path}.`, {
      source: '@pp/canvas',
      hint: 'Provide a workspace directory with canvas.workspace.json or a direct manifest path.',
    })
  );
}

function normalizeCanvasWorkspaceDocument(value: unknown, workspacePath: string): OperationResult<CanvasWorkspaceDocument> {
  const workspace = asRecord(value);

  if (!workspace) {
    return fail(
      createDiagnostic('error', 'CANVAS_WORKSPACE_INVALID', `Canvas workspace ${workspacePath} must be a JSON object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const name = readString(workspace.name);
  const schemaVersion = workspace.schemaVersion;
  const appsValue = Array.isArray(workspace.apps) ? workspace.apps : [];
  const catalogsValue = Array.isArray(workspace.catalogs) ? workspace.catalogs : [];

  if (!name || schemaVersion !== 1 || appsValue.length === 0) {
    return fail(
      createDiagnostic('error', 'CANVAS_WORKSPACE_FIELDS_REQUIRED', `Canvas workspace ${workspacePath} must include schemaVersion: 1, name, and at least one app.`, {
        source: '@pp/canvas',
      })
    );
  }

  const apps = appsValue.map((entry, index) => normalizeCanvasWorkspaceApp(entry, workspacePath, index));

  for (const app of apps) {
    if (!app.success || !app.data) {
      return app as unknown as OperationResult<CanvasWorkspaceDocument>;
    }
  }

  const catalogs = catalogsValue.map((entry, index) => normalizeCanvasWorkspaceCatalog(entry, workspacePath, index));

  for (const catalog of catalogs) {
    if (!catalog.success || !catalog.data) {
      return catalog as unknown as OperationResult<CanvasWorkspaceDocument>;
    }
  }

  return ok(
    {
      schemaVersion: 1,
      name,
      ...(Array.isArray(workspace.registries) ? { registries: normalizeStringArray(workspace.registries) } : {}),
      catalogs: catalogs.map((entry) => entry.data!),
      apps: apps.map((entry) => entry.data!),
    },
    {
      supportTier: 'preview',
    }
  );
}

function normalizeCanvasWorkspaceCatalog(
  value: unknown,
  workspacePath: string,
  index: number
): OperationResult<CanvasWorkspaceCatalogEntry> {
  const catalog = asRecord(value);

  if (!catalog) {
    return fail(
      createDiagnostic('error', 'CANVAS_WORKSPACE_CATALOG_INVALID', `Catalog ${index} in ${workspacePath} must be an object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const name = readString(catalog.name);
  const registries = Array.isArray(catalog.registries) ? normalizeStringArray(catalog.registries) : [];

  if (!name || registries.length === 0) {
    return fail(
      createDiagnostic('error', 'CANVAS_WORKSPACE_CATALOG_FIELDS_REQUIRED', `Catalog ${index} in ${workspacePath} must include name and at least one registry.`, {
        source: '@pp/canvas',
      })
    );
  }

  return ok(
    {
      name,
      registries,
      ...(Array.isArray(catalog.notes) ? { notes: normalizeStringArray(catalog.notes) } : {}),
    },
    {
      supportTier: 'preview',
    }
  );
}

function normalizeCanvasWorkspaceApp(
  value: unknown,
  workspacePath: string,
  index: number
): OperationResult<CanvasWorkspaceAppEntry> {
  const app = asRecord(value);

  if (!app) {
    return fail(
      createDiagnostic('error', 'CANVAS_WORKSPACE_APP_INVALID', `App ${index} in ${workspacePath} must be an object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const name = readString(app.name);
  const path = readString(app.path);

  if (!name || !path) {
    return fail(
      createDiagnostic('error', 'CANVAS_WORKSPACE_APP_FIELDS_REQUIRED', `App ${index} in ${workspacePath} must include name and path.`, {
        source: '@pp/canvas',
      })
    );
  }

  return ok(
    {
      name,
      path,
      ...(Array.isArray(app.registries) ? { registries: normalizeStringArray(app.registries) } : {}),
      ...(Array.isArray(app.catalogs) ? { catalogs: normalizeStringArray(app.catalogs) } : {}),
      ...(Array.isArray(app.notes) ? { notes: normalizeStringArray(app.notes) } : {}),
    },
    {
      supportTier: 'preview',
    }
  );
}

function resolveWorkspaceAppEntry(
  workspace: CanvasWorkspaceDocument,
  app: CanvasWorkspaceAppEntry,
  workspaceRoot: string
): CanvasWorkspaceResolvedApp {
  const catalogs = (app.catalogs ?? []).map((name) => workspace.catalogs?.find((entry) => entry.name === name)).filter(Boolean) as CanvasWorkspaceCatalogEntry[];

  return {
    name: app.name,
    path: resolve(workspaceRoot, app.path),
    registries: [...(workspace.registries ?? []), ...catalogs.flatMap((entry) => entry.registries), ...(app.registries ?? [])],
    catalogs: catalogs.map((entry) => entry.name),
    notes: [...catalogs.flatMap((entry) => entry.notes ?? []), ...(app.notes ?? [])],
  };
}

function summarizeRegistry(document: LoadedRegistryDocument): CanvasTemplateRegistryInspectReport {
  return {
    path: document.path,
    hash: document.hash,
    generatedAt: document.document.generatedAt,
    templateCount: document.document.templates.length,
    supportRuleCount: document.document.supportMatrix.length,
    templates: document.document.templates.map((template) => ({
      templateName: template.templateName,
      templateVersion: template.templateVersion,
      provenanceKind: template.provenance.kind,
      source: template.provenance.source,
      importedFrom: template.provenance.importedFrom,
      appVersion: template.provenance.appVersion,
      platformVersion: template.provenance.platformVersion,
      aliases: {
        displayNames: template.aliases?.displayNames?.length ?? 0,
        constructors: template.aliases?.constructors?.length ?? 0,
        yamlNames: template.aliases?.yamlNames?.length ?? 0,
      },
    })),
  };
}

function diffLoadedCanvasRegistries(
  left: LoadedRegistryDocument,
  right: LoadedRegistryDocument
): CanvasTemplateRegistryDiffResult {
  const leftTemplates = new Map(left.document.templates.map((template) => [makeTemplateKey(template.templateName, template.templateVersion), template] as const));
  const rightTemplates = new Map(right.document.templates.map((template) => [makeTemplateKey(template.templateName, template.templateVersion), template] as const));
  const templateKeys = new Set([...leftTemplates.keys(), ...rightTemplates.keys()]);
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const key of Array.from(templateKeys).sort()) {
    const leftTemplate = leftTemplates.get(key);
    const rightTemplate = rightTemplates.get(key);

    if (!leftTemplate && rightTemplate) {
      added.push(formatTemplateKey(rightTemplate.templateName, rightTemplate.templateVersion));
      continue;
    }

    if (leftTemplate && !rightTemplate) {
      removed.push(formatTemplateKey(leftTemplate.templateName, leftTemplate.templateVersion));
      continue;
    }

    if (leftTemplate && rightTemplate && leftTemplate.contentHash !== rightTemplate.contentHash) {
      changed.push(formatTemplateKey(leftTemplate.templateName, leftTemplate.templateVersion));
    }
  }

  const leftRules = new Set(left.document.supportMatrix.map((rule) => stringifyCanvasJson(rule)));
  const rightRules = new Set(right.document.supportMatrix.map((rule) => stringifyCanvasJson(rule)));

  return {
    left: summarizeRegistry(left),
    right: summarizeRegistry(right),
    templates: {
      added,
      removed,
      changed,
    },
    supportRules: {
      added: Array.from(rightRules).filter((entry) => !leftRules.has(entry)).sort(),
      removed: Array.from(leftRules).filter((entry) => !rightRules.has(entry)).sort(),
    },
  };
}

function formatTemplateKey(templateName: string, templateVersion: string): string {
  return `${templateName}@${templateVersion}`;
}

function buildCanvasTemplateResolutionHint(source: CanvasSourceModel, mode: CanvasBuildMode): string {
  if (source.kind === 'json-manifest' && source.seedRegistryPath) {
    return `Inspect ${basename(source.seedRegistryPath)} to confirm it includes every required control template, or retry with --mode seeded if formula-only validation is sufficient for this legacy manifest.`;
  }

  if (source.kind === 'pa-yaml-unpacked') {
    return mode === 'registry'
      ? 'Add a matching pinned registry with --registry or pp.config.* templateRegistries because registry mode ignores embedded References/Templates.json payloads.'
      : 'Confirm the unpacked app still includes References/Templates.json or add a matching pinned registry with --registry or pp.config.* templateRegistries.';
  }

  return 'Provide seeded metadata or load a matching template registry with --registry or pp.config.* templateRegistries.';
}

function buildCanvasTemplateResolutionNextActions(source: CanvasSourceModel, mode: CanvasBuildMode): string[] {
  const manifestArg = source.root;
  const actions = [
    `Run \`pp canvas inspect ${manifestArg} --mode ${mode} --format json\` to review the resolved registry stack and missing template requirements.`,
  ];

  if (source.kind === 'json-manifest' && source.seedRegistryPath) {
    actions.push(
      `Review \`${source.seedRegistryPath}\` and add the missing control templates before retrying strict mode.`,
      `If formula-only coverage is acceptable for this legacy manifest, retry with \`pp canvas validate ${manifestArg} --mode seeded --format json\`.`
    );
  } else {
    actions.push(`Add a pinned registry with \`--registry <file>\` or \`templateRegistries\` in \`pp.config.*\`, then rerun the canvas command.`);
  }

  if (source.kind === 'pa-yaml-unpacked' && mode !== 'registry') {
    actions.push('Confirm the unpacked source still contains `References/Templates.json`; strict mode can auto-consume that embedded registry.');
  }

  return uniqueSorted(actions);
}

function buildCanvasUnsupportedTemplateDetail(issue: CanvasTemplateUsageIssue, nextActions: string[]): string | undefined {
  const details = [
    issue.modes.length > 0 ? `Supported modes: ${issue.modes.join(', ')}` : 'No supported modes were declared.',
    nextActions[0],
  ];

  return details.join(' ');
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeStringArray(values: unknown[]): string[] {
  return values
    .map((value) => readString(value))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeCanvasPatchDocument(value: unknown): OperationResult<CanvasPatchDocument> {
  const patch = asRecord(value);

  if (!patch || patch.schemaVersion !== 1 || !Array.isArray(patch.operations) || patch.operations.length === 0) {
    return fail(
      createDiagnostic('error', 'CANVAS_PATCH_INVALID', 'Canvas patch documents must include schemaVersion: 1 and a non-empty operations array.', {
        source: '@pp/canvas',
      })
    );
  }

  return ok(
    {
      schemaVersion: 1,
      operations: patch.operations as CanvasPatchOperation[],
    },
    {
      supportTier: 'preview',
    }
  );
}

function planCanvasPatchOperation(source: CanvasSourceModel, operation: CanvasPatchOperation, index: number): CanvasPatchPlanStep {
  switch (operation.op) {
    case 'set-property': {
      const control = source.controls.find((entry) => entry.path === operation.controlPath);
      return control
        ? {
            index,
            op: operation.op,
            controlPath: operation.controlPath,
            status: 'ready',
            description: `Set ${operation.property} on ${operation.controlPath}.`,
          }
        : {
            index,
            op: operation.op,
            controlPath: operation.controlPath,
            status: 'error',
            description: `Control ${operation.controlPath} was not found.`,
          };
    }
    case 'remove-property': {
      const control = findCanvasControlByPath(source, operation.controlPath);
      const hasProperty = control ? Object.prototype.hasOwnProperty.call(control.properties, operation.property) : false;
      return control && hasProperty
        ? {
            index,
            op: operation.op,
            controlPath: operation.controlPath,
            status: 'ready',
            description: `Remove ${operation.property} from ${operation.controlPath}.`,
          }
        : {
            index,
            op: operation.op,
            controlPath: operation.controlPath,
            status: 'error',
            description: `Property ${operation.property} was not found on ${operation.controlPath}.`,
          };
    }
    case 'add-control': {
      const parentPath = operation.parentPath;
      const parent = parentPath ? source.controls.find((entry) => entry.path === parentPath) : undefined;
      const screenExists = source.screens.some((screen) => screen.name === operation.screen);
      const duplicate = parentPath
        ? false
        : source.controls.some((entry) => entry.path === `${operation.screen}/${operation.control.name}`);

      if (!screenExists) {
        return {
          index,
          op: operation.op,
          screen: operation.screen,
          status: 'error',
          description: `Screen ${operation.screen} was not found.`,
        };
      }

      if (parentPath && !parent) {
        return {
          index,
          op: operation.op,
          screen: operation.screen,
          controlPath: parentPath,
          status: 'error',
          description: `Parent control ${parentPath} was not found.`,
        };
      }

      if (duplicate) {
        return {
          index,
          op: operation.op,
          screen: operation.screen,
          status: 'error',
          description: `Top-level control ${operation.screen}/${operation.control.name} already exists.`,
        };
      }

      return {
        index,
        op: operation.op,
        screen: operation.screen,
        controlPath: parentPath,
        status: 'ready',
        description: `Add ${operation.control.name} to ${parentPath ?? operation.screen}.`,
      };
    }
    case 'remove-control': {
      const control = source.controls.find((entry) => entry.path === operation.controlPath);
      return control
        ? {
            index,
            op: operation.op,
            controlPath: operation.controlPath,
            status: 'ready',
            description: `Remove ${operation.controlPath}.`,
          }
        : {
            index,
            op: operation.op,
            controlPath: operation.controlPath,
            status: 'error',
            description: `Control ${operation.controlPath} was not found.`,
          };
    }
  }
}

function applyCanvasPatchOperation(
  screenRecords: Map<string, { path: string; document: Record<string, unknown> }>,
  operation: CanvasPatchOperation
): void {
  switch (operation.op) {
    case 'set-property': {
      const control = resolvePatchControl(screenRecords, operation.controlPath);

      if (control) {
        const properties = asRecord(control.properties) ?? {};
        properties[operation.property] = operation.value;
        control.properties = properties;
      }
      return;
    }
    case 'remove-property': {
      const control = resolvePatchControl(screenRecords, operation.controlPath);

      if (control && asRecord(control.properties)) {
        delete (control.properties as Record<string, unknown>)[operation.property];
      }
      return;
    }
    case 'add-control': {
      const screen = screenRecords.get(operation.screen);

      if (!screen) {
        return;
      }

      const controls = Array.isArray(screen.document.controls) ? screen.document.controls : [];
      const parent = operation.parentPath ? resolvePatchControl(screenRecords, operation.parentPath) : undefined;
      const targetChildren =
        parent && Array.isArray(parent.children)
          ? parent.children
          : parent
            ? ((parent.children = []) as unknown[])
            : controls;

      targetChildren.push(serializePatchControl(operation.control));
      screen.document.controls = controls;
      return;
    }
    case 'remove-control': {
      removePatchControl(screenRecords, operation.controlPath);
      return;
    }
  }
}

function findCanvasControlByPath(source: CanvasSourceModel, controlPath: string): CanvasControlDefinition | undefined {
  const parts = controlPath.split('/').filter((part) => part.length > 0);
  const screen = source.screens.find((entry) => entry.name === parts[0]);

  if (!screen) {
    return undefined;
  }

  let controls = screen.controls;
  let current: CanvasControlDefinition | undefined;

  for (const segment of parts.slice(1)) {
    current = controls.find((control) => control.name === segment);

    if (!current) {
      return undefined;
    }

    controls = current.children;
  }

  return current;
}

function resolvePatchControl(
  screenRecords: Map<string, { path: string; document: Record<string, unknown> }>,
  controlPath: string
): Record<string, unknown> | undefined {
  const parts = controlPath.split('/').filter((part) => part.length > 0);
  const screen = screenRecords.get(parts[0] ?? '');

  if (!screen) {
    return undefined;
  }

  let currentChildren = Array.isArray(screen.document.controls) ? screen.document.controls : [];
  let current: Record<string, unknown> | undefined;

  for (const segment of parts.slice(1)) {
    current = currentChildren.map((entry) => asRecord(entry)).find((entry) => entry && readString(entry.name) === segment);

    if (!current) {
      return undefined;
    }

    currentChildren = Array.isArray(current.children) ? current.children : [];
  }

  return current;
}

function removePatchControl(
  screenRecords: Map<string, { path: string; document: Record<string, unknown> }>,
  controlPath: string
): boolean {
  const parts = controlPath.split('/').filter((part) => part.length > 0);
  const screen = screenRecords.get(parts[0] ?? '');

  if (!screen) {
    return false;
  }

  let children = Array.isArray(screen.document.controls) ? screen.document.controls : [];

  for (const [index, segment] of parts.slice(1).entries()) {
    const childIndex = children.findIndex((entry) => readString(asRecord(entry)?.name) === segment);

    if (childIndex < 0) {
      return false;
    }

    if (index === parts.slice(1).length - 1) {
      children.splice(childIndex, 1);
      return true;
    }

    const next = asRecord(children[childIndex]);

    if (!next) {
      return false;
    }

    children = Array.isArray(next.children) ? next.children : [];
  }

  return false;
}

function serializePatchControl(control: CanvasPatchControlDefinition): Record<string, unknown> {
  return {
    name: control.name,
    templateName: control.templateName,
    templateVersion: control.templateVersion,
    ...(control.properties ? { properties: control.properties } : {}),
    ...(control.children && control.children.length > 0
      ? { children: control.children.map((child) => serializePatchControl(child)) }
      : {}),
  };
}

export async function loadCanvasSource(path: string, options: CanvasSourceReadOptions = {}): Promise<OperationResult<CanvasSourceModel>> {
  const paYamlRoot = await resolveCanvasPaYamlRoot(path);

  if (paYamlRoot) {
    return loadCanvasPaYamlSource(paYamlRoot, options);
  }

  const manifestPath = await resolveCanvasManifestPath(path);

  if (!manifestPath.success || !manifestPath.data) {
    return manifestPath as unknown as OperationResult<CanvasSourceModel>;
  }

  const manifestDocument = await readCanvasJsonFile(manifestPath.data, options);

  if (!manifestDocument.success || manifestDocument.data === undefined) {
    return manifestDocument as unknown as OperationResult<CanvasSourceModel>;
  }

  const manifest = normalizeCanvasManifest(manifestDocument.data, manifestPath.data);

  if (!manifest.success || !manifest.data) {
    return manifest as unknown as OperationResult<CanvasSourceModel>;
  }

  const root = dirname(manifestPath.data);
  const screens: CanvasScreenDefinition[] = [];

  for (const screenReference of manifest.data.screens) {
    const screenPath = resolve(root, screenReference.file);
    const screenDocument = await readCanvasJsonFile(screenPath, options);

    if (!screenDocument.success || screenDocument.data === undefined) {
      return screenDocument as unknown as OperationResult<CanvasSourceModel>;
    }

    const screen = normalizeCanvasScreen(screenDocument.data, screenReference, screenPath);

    if (!screen.success || !screen.data) {
      return screen as unknown as OperationResult<CanvasSourceModel>;
    }

    screens.push(screen.data);
  }

  const controls = summarizeCanvasControls(screens);
  const templateRequirements = Array.from(
    new Map(
      controls.map((control) => [
        `${control.templateName}@${control.templateVersion}`,
        {
          name: control.templateName,
          version: control.templateVersion,
        },
      ])
    ).values()
  ).sort((left, right) => left.name.localeCompare(right.name) || (left.version ?? '').localeCompare(right.version ?? ''));
  const sourceHash = sha256Hex(
    stringifyCanvasJson({
      manifest: manifest.data,
      screens,
    })
  );
  const seedRegistryPath = await fileExists(resolve(root, 'seed.templates.json'))
    ? resolve(root, 'seed.templates.json')
    : undefined;

  return ok(
    {
      kind: 'json-manifest',
      root,
      manifestPath: manifestPath.data,
      manifest: manifest.data,
      screens,
      controls,
      templateRequirements,
      sourceHash,
      seedRegistryPath,
    },
    {
      supportTier: 'preview',
    }
  );
}

export function resolveCanvasTemplateRegistryPaths(
  options: CanvasRegistryLoadOptions = {}
): OperationResult<string[]> {
  const root = resolve(options.root ?? process.cwd());
  const paths = new Set<string>();

  for (const entry of options.registries ?? []) {
    if (entry.startsWith('cache:')) {
      if (!options.cacheDir) {
        return fail(
          createDiagnostic(
            'error',
            'CANVAS_TEMPLATE_CACHE_DIR_REQUIRED',
            `Template registry ${entry} uses a cache reference but no cacheDir was provided.`,
            {
              source: '@pp/canvas',
              hint: 'Provide a cacheDir when resolving cache-backed registry entries.',
            }
          )
        );
      }

      paths.add(resolve(options.cacheDir, `${entry.slice('cache:'.length)}.json`));
      continue;
    }

    paths.add(resolve(root, entry));
  }

  return ok(Array.from(paths), {
    supportTier: 'preview',
  });
}

export function resolveCanvasTemplate(
  bundle: CanvasRegistryBundle,
  lookup: CanvasTemplateLookup
): CanvasTemplateResolution {
  const candidates = bundle.templates
    .flatMap((template) => matchTemplateCandidate(template, lookup.name))
    .filter((candidate) => (lookup.version ? candidate.template.templateVersion === lookup.version : true))
    .sort(compareTemplateCandidates);

  const selected = candidates[0];

  if (!selected) {
    return {
      requested: lookup,
      support: {
        status: 'unsupported',
        modes: [],
        notes: ['Required template metadata was not found in the loaded registries.'],
      },
    };
  }

  return {
    requested: lookup,
    template: selected.template,
    matchedBy: selected.matchedBy,
    support: resolveCanvasSupport(bundle.supportMatrix, selected.template.templateName, selected.template.templateVersion),
  };
}

export function resolveCanvasTemplateRequirements(
  requests: CanvasTemplateLookup[],
  options: {
    mode: CanvasBuildMode;
    seeded?: CanvasRegistryBundle;
    registry?: CanvasRegistryBundle;
  }
): CanvasTemplateRequirementResolution {
  const resolutions = requests.map((request) => resolveCanvasTemplateForMode(request, options));
  const missing = resolutions.filter((resolution) => !resolution.template).map((resolution) => resolution.requested);

  return {
    mode: options.mode,
    resolutions,
    missing,
    supported: resolutions.every(
      (resolution) =>
        Boolean(resolution.template) &&
        resolution.support.status === 'supported' &&
        resolution.support.modes.includes(options.mode)
    ),
  };
}

function summarizeCanvasTemplateForReport(template: CanvasTemplateRecord): CanvasTemplateReportRecord {
  return {
    templateName: template.templateName,
    templateVersion: template.templateVersion,
    contentHash: template.contentHash,
    aliases: template.aliases,
    files: Object.keys(template.files ?? {}).sort((left, right) => left.localeCompare(right)),
    provenance: template.provenance,
  };
}

function summarizeCanvasTemplateRequirementResolution(
  resolution: CanvasTemplateResolution
): CanvasTemplateReportResolution {
  return {
    requested: resolution.requested,
    matchedBy: resolution.matchedBy,
    support: resolution.support,
    ...(resolution.template ? { template: summarizeCanvasTemplateForReport(resolution.template) } : {}),
  };
}

function buildCanvasTemplateRequirementReport(
  templateRequirements: CanvasTemplateRequirementResolution
): CanvasTemplateRequirementReport {
  return {
    ...templateRequirements,
    resolutions: templateRequirements.resolutions.map(summarizeCanvasTemplateRequirementResolution),
  };
}

export function resolveCanvasSupport(
  supportMatrix: CanvasSupportMatrixEntry[],
  templateName: string,
  templateVersion: string
): CanvasSupportResolution {
  const scored = supportMatrix
    .map((rule, index) => ({
      index,
      rule,
      score: getSupportRuleScore(rule, templateName, templateVersion),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || right.index - left.index);

  const matched = scored[0]?.rule;

  if (!matched) {
    return {
      status: 'unsupported',
      modes: [],
      notes: [`No support-matrix rule matched ${templateName}@${templateVersion}.`],
    };
  }

  return {
    status: matched.status,
    modes: matched.modes ?? DEFAULT_SUPPORTED_MODES,
    matchedRule: matched,
    notes: matched.notes ?? [],
  };
}

export function summarizeCanvasTemplateRegistry(bundle: CanvasRegistryBundle): {
  sourceCount: number;
  templateCount: number;
  supportRuleCount: number;
  hash: string;
} {
  return {
    sourceCount: bundle.sources.length,
    templateCount: bundle.templates.length,
    supportRuleCount: bundle.supportMatrix.length,
    hash: bundle.hash,
  };
}

async function prepareCanvasValidation(
  path: string,
  options: CanvasSourceLoadOptions & {
    mode?: CanvasBuildMode;
    onProgress?: (event: CanvasLocalProgressEvent) => void;
  }
): Promise<OperationResult<PreparedCanvasValidation>> {
  const onProgress = options.onProgress;

  onProgress?.({ stage: 'load-source' });
  const source = await loadCanvasSource(path, options);

  if (!source.success || !source.data) {
    return source as unknown as OperationResult<PreparedCanvasValidation>;
  }

  const mode = options.mode ?? 'strict';
  const registryOptions = mergeCanvasRegistryLoadOptions(options, source.data);
  onProgress?.({ stage: 'load-registries' });
  const [seeded, registry] = await Promise.all([
    loadCanvasSeedRegistry(source.data),
    loadCanvasTemplateRegistryBundle(registryOptions),
  ]);

  if (!seeded.success || !seeded.data) {
    return seeded as unknown as OperationResult<PreparedCanvasValidation>;
  }

  if (!registry.success || !registry.data) {
    return registry as unknown as OperationResult<PreparedCanvasValidation>;
  }

  onProgress?.({ stage: 'resolve-templates' });
  const templateRequirements = resolveCanvasTemplateRequirements(source.data.templateRequirements, {
    mode,
    seeded: seeded.data,
    registry: registry.data,
  });
  onProgress?.({ stage: 'build-semantic-model' });
  const semanticModel = await buildCanvasSemanticModel(source.data, {
    templateResolutions: templateRequirements.resolutions,
  });
  onProgress?.({ stage: 'validate' });
  const formulas = collectCanvasFormulaChecks(semanticModel);
  const propertyChecks = collectPropertyChecks(source.data, templateRequirements);
  const invalidPropertyChecks = propertyChecks.filter((property) => !property.valid);
  const unresolvedTemplates = collectUnresolvedTemplateIssues(source.data, templateRequirements);
  const unsupportedTemplates = collectUnsupportedTemplateIssues(source.data, templateRequirements, mode);
  const templateResolutionHint = buildCanvasTemplateResolutionHint(source.data, mode);
  const templateResolutionNextActions = buildCanvasTemplateResolutionNextActions(source.data, mode);
  const diagnostics = [
    ...source.diagnostics,
    ...seeded.diagnostics,
    ...registry.diagnostics,
    ...formulas
      .filter((formula) => !formula.valid)
      .map((formula) =>
        createDiagnostic(
          'error',
          'CANVAS_FORMULA_PROPERTY_INVALID',
          `Formula property ${formula.property} on ${formula.controlPath} is not supported by the current Power Fx semantic slice.`,
          {
            source: '@pp/canvas',
          }
      )
      ),
    ...collectUnresolvedDataSourceDiagnostics(semanticModel.formulas),
    ...collectUnresolvedMetadataReferenceDiagnostics(semanticModel.formulas),
    ...invalidPropertyChecks
      .map((property) =>
        createDiagnostic(
          'error',
          'CANVAS_CONTROL_PROPERTY_INVALID',
          property.reason
            ? `Property ${property.property} is not valid for ${property.templateName}@${property.templateVersion} on ${property.controlPath}: ${property.reason}`
            : `Property ${property.property} is not valid for ${property.templateName}@${property.templateVersion} on ${property.controlPath}.`,
          {
            source: '@pp/canvas',
            detail: [property.source ? `Validated from ${property.source}.` : undefined, property.reason].filter(Boolean).join(' '),
          }
        )
      ),
    ...unresolvedTemplates.map((issue) =>
      createDiagnostic(
        'error',
        'CANVAS_TEMPLATE_METADATA_MISSING',
        `Template metadata for ${issue.templateName}@${issue.templateVersion} was not resolved for ${issue.controlPath}.`,
        {
          source: '@pp/canvas',
          hint: templateResolutionHint,
        }
      )
    ),
    ...unsupportedTemplates.map((issue) =>
      createDiagnostic(
        issue.status === 'partial' ? 'warning' : 'error',
        'CANVAS_TEMPLATE_UNSUPPORTED',
        `Template ${issue.templateName}@${issue.templateVersion} for ${issue.controlPath} is ${issue.status} in ${mode} mode.`,
        {
          source: '@pp/canvas',
          detail: buildCanvasUnsupportedTemplateDetail(issue, templateResolutionNextActions),
        }
      )
    ),
  ];
  const warnings = [
    ...source.warnings,
    ...seeded.warnings,
    ...registry.warnings,
  ];
  const valid = diagnostics.every((diagnostic) => diagnostic.level !== 'error');

  return ok(
    {
      source: source.data,
      templateRequirements,
      semanticModel,
      invalidPropertyChecks,
      unresolvedTemplates,
      unsupportedTemplates,
      report: {
        valid,
        mode,
        source: {
          root: source.data.root,
          manifestPath: source.data.manifestPath,
          name: source.data.manifest.name,
          displayName: source.data.manifest.displayName,
          version: source.data.manifest.version,
          screenCount: source.data.screens.length,
          controlCount: source.data.controls.length,
          sourceHash: source.data.sourceHash,
          seedRegistryPath: source.data.seedRegistryPath,
        },
        ...(source.data.dataSources && source.data.dataSources.length > 0 ? { dataSources: source.data.dataSources } : {}),
        templateRequirements: buildCanvasTemplateRequirementReport(templateRequirements),
        unresolvedTemplates,
        unsupportedTemplates,
        formulas,
        ...(invalidPropertyChecks.length > 0 ? { propertyChecks: invalidPropertyChecks } : {}),
        registries: mergeRegistrySources(seeded.data.sources, registry.data.sources),
      },
      diagnostics,
      warnings,
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings,
      suggestedNextActions: templateResolutionNextActions,
    }
  );
}

function collectUnresolvedDataSourceDiagnostics(formulas: CanvasFormulaSemantic[]): Diagnostic[] {
  const dataSourceProperties = new Set(['items', 'datasource']);

  return formulas.flatMap((formula) => {
    if (!dataSourceProperties.has(formula.property.toLowerCase())) {
      return [];
    }

    const hasResolvedDataSource = formula.bindings.some((binding) => binding.kind === 'dataSource' && binding.resolved);
    if (hasResolvedDataSource) {
      return [];
    }

    const unresolvedNames = Array.from(
      new Set(
        formula.bindings
          .filter((binding) => binding.kind === 'unresolved' && binding.name.trim().length > 0)
          .map((binding) => binding.name)
      )
    );

    return unresolvedNames.map((name) =>
      createDiagnostic(
        'error',
        'CANVAS_DATA_SOURCE_REFERENCE_UNRESOLVED',
        `Formula property ${formula.property} on ${formula.controlPath} references unresolved data source ${name}.`,
        {
          source: '@pp/canvas',
          hint: 'Add the data source to References/DataSources.json or update the formula to use an existing source.',
        }
      )
    );
  });
}

function collectUnresolvedMetadataReferenceDiagnostics(formulas: CanvasFormulaSemantic[]): Diagnostic[] {
  return formulas.flatMap((formula) => {
    const unresolvedNames = Array.from(
      new Set(
        formula.bindings
          .filter((binding) => binding.metadataBacked && !binding.resolved && binding.name.trim().length > 0)
          .map((binding) => binding.name)
      )
    );

    return unresolvedNames.map((name) =>
      createDiagnostic(
        'error',
        'CANVAS_METADATA_REFERENCE_UNRESOLVED',
        `Metadata-backed reference ${name} in ${formula.property} on ${formula.controlPath} could not be resolved.`,
        {
          source: '@pp/canvas',
          hint: 'Update the formula to use an existing column, relationship, or option value from the referenced data source metadata.',
        }
      )
    );
  });
}

async function loadCanvasTemplateRegistryDocument(path: string): Promise<OperationResult<LoadedRegistryDocument>> {
  try {
    await stat(path);
  } catch {
    return fail(
      createDiagnostic('error', 'CANVAS_TEMPLATE_REGISTRY_NOT_FOUND', `Canvas template registry ${path} was not found.`, {
        source: '@pp/canvas',
      })
    );
  }

  const document = await readCanvasJsonFile(path);

  if (!document.success || document.data === undefined) {
    return document as unknown as OperationResult<LoadedRegistryDocument>;
  }

  if (basename(path).toLowerCase() === 'controltemplates.json') {
    const controlTemplates = await normalizeCanvasControlTemplatesCatalog(document.data, path);

    if (controlTemplates.success && controlTemplates.data) {
      return ok(
        {
          path,
          hash: sha256Hex(stringifyCanvasJson(controlTemplates.data)),
          document: controlTemplates.data,
        },
        {
          supportTier: 'preview',
          diagnostics: controlTemplates.diagnostics,
          warnings: controlTemplates.warnings,
        }
      );
    }
  }

  const normalized = normalizeCanvasTemplateRegistry(document.data, path);

  if (!normalized.success || !normalized.data) {
    return normalized as unknown as OperationResult<LoadedRegistryDocument>;
  }

  return ok(
    {
      path,
      hash: sha256Hex(stringifyCanvasJson(normalized.data)),
      document: normalized.data,
    },
    {
      supportTier: 'preview',
      diagnostics: normalized.diagnostics,
      warnings: normalized.warnings,
    }
  );
}

async function normalizeCanvasControlTemplatesCatalog(
  value: unknown,
  sourcePath: string
): Promise<OperationResult<CanvasTemplateRegistryDocument>> {
  const objectValue = asRecord(value);

  if (!objectValue) {
    return fail(
      createDiagnostic('error', 'CANVAS_TEMPLATE_REGISTRY_INVALID', `Canvas template registry ${sourcePath} must be a JSON object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const templates: CanvasTemplateRecord[] = [];
  const supportMatrix: CanvasSupportMatrixEntry[] = [];
  const warnings: Diagnostic[] = [];
  const pkgsDir = join(dirname(sourcePath), 'pkgs');

  for (const [entryName, rawTemplate] of Object.entries(objectValue).sort(([left], [right]) => left.localeCompare(right))) {
    const template = asRecord(rawTemplate);
    const templateVersion = readString(template?.Version) ?? readString(template?.version);

    if (!template || !templateVersion) {
      continue;
    }

    const canonicalName = canonicalizeControlTemplateName(entryName, template);
    const xmlBaseName = (readString(template.Name) ?? entryName).replaceAll('/', '_');
    const xmlPath = join(pkgsDir, `${xmlBaseName}_${templateVersion}.xml`);
    const templateXml = (await fileExists(xmlPath)) ? await readFile(xmlPath, 'utf8') : undefined;

    if (!templateXml) {
      warnings.push(
        createDiagnostic(
          'warning',
          'CANVAS_CONTROL_TEMPLATE_XML_MISSING',
          `Canvas control template ${canonicalName}@${templateVersion} did not include sibling pkgs XML at ${xmlPath}.`,
          {
            source: '@pp/canvas',
            hint: 'Build and strict property validation will stay limited until the unpack includes the matching pkgs/*.xml template payload.',
          }
        )
      );
    }

    const aliases = buildControlTemplateAliases(entryName, canonicalName);
    const normalized = normalizeTemplateRecord(
      {
        templateName: canonicalName,
        templateVersion,
        aliases,
        files: {
          'Controls/EmbeddedTemplate.json': template,
          ...(templateXml
            ? {
                'References/Templates.json': {
                  name: canonicalName,
                  version: templateVersion,
                  templateXml,
                },
              }
            : {}),
        },
        provenance: {
          kind: 'official-artifact',
          source: 'UnpackedControlTemplates',
          importedFrom: sourcePath,
          sourceArtifact: basename(sourcePath),
        },
      },
      sourcePath
    );

    if (!normalized.success || !normalized.data) {
      return normalized as unknown as OperationResult<CanvasTemplateRegistryDocument>;
    }

    templates.push(normalized.data);
    supportMatrix.push({
      templateName: canonicalName,
      version: templateVersion,
      status: 'supported',
      modes: ['strict', 'registry'],
      notes: ['Imported from an unpacked ControlTemplates.json catalog and sibling pkgs/*.xml template payloads.'],
    });
  }

  if (templates.length === 0) {
    return fail(
      createDiagnostic('error', 'CANVAS_TEMPLATE_REGISTRY_EMPTY', `Canvas template registry ${sourcePath} did not contain any templates.`, {
        source: '@pp/canvas',
      })
    );
  }

  return ok(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      templates: templates.sort(compareTemplates),
      supportMatrix,
    },
    {
      supportTier: 'preview',
      warnings,
    }
  );
}

function canonicalizeControlTemplateName(entryName: string, template: Record<string, unknown>): string {
  const rawName = readString(template.Name) ?? entryName;
  const id = readString(template.Id)?.toLowerCase() ?? '';

  if (id.includes('/icon') || rawName.toLowerCase() === 'icon') {
    return 'icon';
  }

  return rawName;
}

function buildControlTemplateAliases(entryName: string, canonicalName: string): CanvasTemplateAliases {
  const yamlNames = uniqueSorted([entryName, canonicalName]);
  const constructors = uniqueSorted(inferRawTemplateConstructors(canonicalName));

  if (normalizeName(canonicalName) === normalizeName('icon') && !constructors.includes('Classic/Icon')) {
    constructors.push('Classic/Icon');
    constructors.sort((left, right) => left.localeCompare(right));
  }

  return {
    yamlNames,
    constructors,
  };
}

async function resolveCanvasManifestPath(path: string): Promise<OperationResult<string>> {
  const candidates = path.endsWith('.json')
    ? [resolve(path)]
    : [resolve(path, 'canvas.json'), resolve(path, 'app.canvas.json'), resolve(path, 'app.json')];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return ok(candidate, {
        supportTier: 'preview',
      });
    }
  }

  return fail(
    createDiagnostic(
      'error',
      'CANVAS_MANIFEST_NOT_FOUND',
      `No supported canvas manifest was found at ${path}.`,
      {
        source: '@pp/canvas',
        hint: 'Provide a canvas source directory with canvas.json or a direct manifest path.',
      }
    )
  );
}

async function readCanvasJsonFile(path: string, options: CanvasSourceReadOptions = {}): Promise<OperationResult<unknown>> {
  try {
    const value = options.sourceFiles?.[resolve(path)] !== undefined ? JSON.parse(options.sourceFiles[resolve(path)]!) : await readJsonFile<unknown>(path);

    return ok(value, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CANVAS_JSON_READ_FAILED', `Failed to read JSON content from ${path}.`, {
        source: '@pp/canvas',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

async function loadCanvasSeedRegistry(source: CanvasSourceModel): Promise<OperationResult<CanvasRegistryBundle>> {
  if (!source.seedRegistryPath) {
    return ok(
      {
        sources: [],
        templates: [],
        supportMatrix: [],
        hash: sha256Hex(stringifyCanvasJson({ templates: [], supportMatrix: [] })),
      },
      {
        supportTier: 'preview',
      }
    );
  }

  return loadCanvasTemplateRegistryBundle({
    root: source.root,
    registries: ['./seed.templates.json'],
  });
}

function normalizeCanvasManifest(value: unknown, manifestPath: string): OperationResult<CanvasManifest> {
  const manifest = asRecord(value);

  if (!manifest) {
    return fail(
      createDiagnostic('error', 'CANVAS_MANIFEST_INVALID', `Canvas manifest ${manifestPath} must be a JSON object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const name = readString(manifest.name);
  const rawScreens = Array.isArray(manifest.screens) ? manifest.screens : undefined;

  if (!name || !rawScreens || rawScreens.length === 0) {
    return fail(
      createDiagnostic(
        'error',
        'CANVAS_MANIFEST_FIELDS_REQUIRED',
        `Canvas manifest ${manifestPath} must include name and at least one screen reference.`,
        {
          source: '@pp/canvas',
        }
      )
    );
  }

  const screens: CanvasScreenReference[] = [];
  const screenNames = new Set<string>();

  for (const [index, item] of rawScreens.entries()) {
    const screen = normalizeCanvasScreenReference(item, index, manifestPath);

    if (!screen.success || !screen.data) {
      return screen as unknown as OperationResult<CanvasManifest>;
    }

    if (screenNames.has(screen.data.name)) {
      return fail(
        createDiagnostic('error', 'CANVAS_SCREEN_DUPLICATE', `Canvas manifest ${manifestPath} defines duplicate screen ${screen.data.name}.`, {
          source: '@pp/canvas',
        })
      );
    }

    screenNames.add(screen.data.name);
    screens.push(screen.data);
  }

  return ok(
    {
      name,
      displayName: readString(manifest.displayName),
      version: readString(manifest.version),
      screens,
    },
    {
      supportTier: 'preview',
    }
  );
}

function normalizeCanvasScreenReference(
  value: unknown,
  index: number,
  manifestPath: string
): OperationResult<CanvasScreenReference> {
  if (typeof value === 'string' && value.trim().length > 0) {
    return ok(
      {
        name: basename(value, '.json'),
        file: value,
      },
      {
        supportTier: 'preview',
      }
    );
  }

  const screen = asRecord(value);

  if (!screen) {
    return fail(
      createDiagnostic('error', 'CANVAS_SCREEN_REFERENCE_INVALID', `Screen reference #${index + 1} in ${manifestPath} must be a string or object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const name = readString(screen.name);
  const file = readString(screen.file);

  if (!name || !file) {
    return fail(
      createDiagnostic('error', 'CANVAS_SCREEN_REFERENCE_FIELDS_REQUIRED', `Screen references in ${manifestPath} must include name and file.`, {
        source: '@pp/canvas',
      })
    );
  }

  return ok(
    {
      name,
      file,
    },
    {
      supportTier: 'preview',
    }
  );
}

function normalizeCanvasScreen(
  value: unknown,
  reference: CanvasScreenReference,
  screenPath: string
): OperationResult<CanvasScreenDefinition> {
  const screen = asRecord(value);

  if (!screen) {
    return fail(
      createDiagnostic('error', 'CANVAS_SCREEN_INVALID', `Canvas screen ${screenPath} must be a JSON object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const rawControls = Array.isArray(screen.controls) ? screen.controls : [];
  const controls: CanvasControlDefinition[] = [];

  for (const [index, item] of rawControls.entries()) {
    const control = normalizeCanvasControl(item, `${reference.name}[${index}]`, screenPath);

    if (!control.success || !control.data) {
      return control as unknown as OperationResult<CanvasScreenDefinition>;
    }

    controls.push(control.data);
  }

  return ok(
    {
      name: readString(screen.name) ?? reference.name,
      file: reference.file,
      controls,
    },
    {
      supportTier: 'preview',
    }
  );
}

function normalizeCanvasControl(
  value: unknown,
  location: string,
  screenPath: string
): OperationResult<CanvasControlDefinition> {
  const control = asRecord(value);

  if (!control) {
    return fail(
      createDiagnostic('error', 'CANVAS_CONTROL_INVALID', `Control ${location} in ${screenPath} must be a JSON object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const name = readString(control.name);
  const templateName = readString(control.templateName) ?? readString(control.template);
  const templateVersion = readString(control.templateVersion) ?? readString(control.version);

  if (!name || !templateName || !templateVersion) {
    return fail(
      createDiagnostic(
        'error',
        'CANVAS_CONTROL_FIELDS_REQUIRED',
        `Control ${location} in ${screenPath} must include name, templateName/template, and templateVersion/version.`,
        {
          source: '@pp/canvas',
        }
      )
    );
  }

  const propertiesRecord = asRecord(control.properties);
  const properties = propertiesRecord
    ? Object.fromEntries(Object.entries(propertiesRecord).map(([key, nested]) => [key, normalizeJsonValue(nested)]))
    : {};
  const rawChildren = Array.isArray(control.children) ? control.children : [];
  const children: CanvasControlDefinition[] = [];

  for (const [index, child] of rawChildren.entries()) {
    const normalizedChild = normalizeCanvasControl(child, `${location}/${name}[${index}]`, screenPath);

    if (!normalizedChild.success || !normalizedChild.data) {
      return normalizedChild as unknown as OperationResult<CanvasControlDefinition>;
    }

    children.push(normalizedChild.data);
  }

  return ok(
    {
      name,
      templateName,
      templateVersion,
      properties,
      children,
    },
    {
      supportTier: 'preview',
    }
  );
}

function summarizeCanvasControls(screens: CanvasScreenDefinition[]): CanvasControlSummary[] {
  const controls: CanvasControlSummary[] = [];

  for (const screen of screens) {
    appendControlSummaries(screen.name, screen.controls, `${screen.name}`, controls);
  }

  return controls.sort((left, right) => left.path.localeCompare(right.path));
}

function appendControlSummaries(
  screenName: string,
  controls: CanvasControlDefinition[],
  prefix: string,
  destination: CanvasControlSummary[]
): void {
  for (const control of controls) {
    const path = `${prefix}/${control.name}`;

    destination.push({
      path,
      screen: screenName,
      templateName: control.templateName,
      templateVersion: control.templateVersion,
      propertyCount: Object.keys(control.properties).length,
      childCount: control.children.length,
    });

    appendControlSummaries(screenName, control.children, path, destination);
  }
}

function flattenControlDefinitions(controls: CanvasControlDefinition[]): CanvasControlDefinition[] {
  const flattened: CanvasControlDefinition[] = [];

  for (const control of controls) {
    flattened.push(control, ...flattenControlDefinitions(control.children));
  }

  return flattened;
}

async function collectFormulaChecks(screens: CanvasScreenDefinition[]): Promise<CanvasFormulaCheck[]> {
  const checks: CanvasFormulaCheck[] = [];

  for (const screen of screens) {
    await appendFormulaChecks(screen.name, screen.controls, screen.name, checks);
  }

  return checks.sort((left, right) => left.controlPath.localeCompare(right.controlPath) || left.property.localeCompare(right.property));
}

async function appendFormulaChecks(
  screenName: string,
  controls: CanvasControlDefinition[],
  prefix: string,
  destination: CanvasFormulaCheck[]
): Promise<void> {
  for (const control of controls) {
    const path = `${prefix}/${control.name}`;

    for (const [property, value] of Object.entries(control.properties)) {
      if (property.endsWith('Formula') || (typeof value === 'string' && value.trim().startsWith('='))) {
        destination.push({
          controlPath: path,
          property,
          valid:
            typeof value === 'string' &&
            (!value.trim().startsWith('=') || (await validatePowerFxSyntax(value))),
        });
      }
    }

    await appendFormulaChecks(screenName, control.children, path, destination);
  }
}

function collectPropertyChecks(
  source: CanvasSourceModel,
  requirements: CanvasTemplateRequirementResolution
): CanvasPropertyCheck[] {
  const resolutions = new Map(
    requirements.resolutions.map((resolution) => [`${resolution.requested.name}@${resolution.requested.version ?? ''}`, resolution])
  );
  const checks: CanvasPropertyCheck[] = [];

  for (const screen of source.screens) {
    appendPropertyChecks(screen.controls, screen.name, resolutions, checks);
  }

  return checks.sort((left, right) => left.controlPath.localeCompare(right.controlPath) || left.property.localeCompare(right.property));
}

function appendPropertyChecks(
  controls: CanvasControlDefinition[],
  prefix: string,
  resolutions: Map<string, CanvasTemplateRequirementResolution['resolutions'][number]>,
  destination: CanvasPropertyCheck[]
): void {
  for (const control of controls) {
    const path = `${prefix}/${control.name}`;
    const resolution = resolutions.get(`${control.templateName}@${control.templateVersion}`);
    const template = resolution?.template;

    if (template) {
      const surface = buildCanvasTemplateSurface(template);
      const allowed = new Set(surface.allowedProperties.map((property) => normalizeName(property)));

      for (const property of Object.keys(control.properties).sort((left, right) => left.localeCompare(right))) {
        const propertyValue = control.properties[property];
        let valid = !surface.strictValidation || allowed.has(normalizeName(property));
        let reason: string | undefined;

        if (valid) {
          const expectedLiteralKind = inferExpectedLiteralKind(surface.defaultProperties[property]);
          const actualLiteralKind = inferActualLiteralKind(propertyValue);

          if (expectedLiteralKind && actualLiteralKind && expectedLiteralKind !== actualLiteralKind) {
            valid = false;
            reason = `Expected a ${expectedLiteralKind} literal-compatible expression but found a ${actualLiteralKind} literal.`;
          }
        }

        destination.push({
          controlPath: path,
          property,
          templateName: template.templateName,
          templateVersion: template.templateVersion,
          valid,
          source: surface.sources.join(', '),
          ...(reason ? { reason } : {}),
        });
      }
    }

    appendPropertyChecks(control.children, path, resolutions, destination);
  }
}

function inferExpectedLiteralKind(defaultValue: string | undefined): 'boolean' | 'number' | 'string' | undefined {
  if (!defaultValue) {
    return undefined;
  }

  const normalized = defaultValue.trim();

  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return 'number';
  }

  if (/^(true|false)$/i.test(normalized)) {
    return 'boolean';
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return 'string';
  }

  return undefined;
}

function inferActualLiteralKind(value: CanvasJsonValue | undefined): 'boolean' | 'number' | 'string' | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  const expression = normalized.startsWith('=') ? normalized.slice(1).trim() : normalized;

  if (/^-?\d+(?:\.\d+)?$/.test(expression)) {
    return 'number';
  }

  if (/^(true|false)$/i.test(expression)) {
    return 'boolean';
  }

  if (
    (expression.startsWith('"') && expression.endsWith('"')) ||
    (expression.startsWith("'") && expression.endsWith("'"))
  ) {
    return 'string';
  }

  return undefined;
}

async function validatePowerFxSyntax(expression: string): Promise<boolean> {
  const trimmed = expression.trim();

  if (!trimmed.startsWith('=')) {
    return true;
  }

  return (
    await parsePowerFxExpression(trimmed.slice(1), {
    allowsSideEffects: trimmed.includes(';'),
    })
  ).valid;
}

function collectUnresolvedTemplateIssues(
  source: CanvasSourceModel,
  requirements: CanvasTemplateRequirementResolution
): CanvasTemplateUsageIssue[] {
  const resolutions = new Map(
    requirements.resolutions.map((resolution) => [`${resolution.requested.name}@${resolution.requested.version ?? ''}`, resolution])
  );

  return source.controls
    .filter((control) => !resolutions.get(`${control.templateName}@${control.templateVersion}`)?.template)
    .map((control) => ({
      controlPath: control.path,
      templateName: control.templateName,
      templateVersion: control.templateVersion,
      status: 'unsupported',
      modes: [],
    }));
}

function collectUnsupportedTemplateIssues(
  source: CanvasSourceModel,
  requirements: CanvasTemplateRequirementResolution,
  mode: CanvasBuildMode
): CanvasTemplateUsageIssue[] {
  const resolutions = new Map(
    requirements.resolutions.map((resolution) => [`${resolution.requested.name}@${resolution.requested.version ?? ''}`, resolution])
  );

  return source.controls
    .map((control) => ({
      control,
      resolution: resolutions.get(`${control.templateName}@${control.templateVersion}`),
    }))
    .filter(
      (item) =>
        item.resolution?.template &&
        (item.resolution.support.status !== 'supported' || !item.resolution.support.modes.includes(mode))
    )
    .map((item) => ({
      controlPath: item.control.path,
      templateName: item.control.templateName,
      templateVersion: item.control.templateVersion,
      status: item.resolution?.support.status ?? 'unsupported',
      modes: item.resolution?.support.modes ?? [],
    }));
}

function mergeRegistrySources(
  left: CanvasRegistrySourceSummary[],
  right: CanvasRegistrySourceSummary[]
): CanvasRegistrySourceSummary[] {
  const merged = new Map<string, CanvasRegistrySourceSummary>();

  for (const source of [...left, ...right]) {
    merged.set(source.path, source);
  }

  return Array.from(merged.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function buildCanvasLintDiagnostics(prepared: PreparedCanvasValidation): CanvasLintDiagnostic[] {
  const diagnostics: CanvasLintDiagnostic[] = [];
  const controlByPath = new Map(prepared.semanticModel.controls.map((control) => [control.path, control]));

  for (const formula of prepared.semanticModel.formulas) {
    if (!formula.valid) {
      diagnostics.push({
        severity: 'error',
        code: 'CANVAS_POWERFX_UNSUPPORTED',
        category: 'formula',
        message: formula.unsupportedReason
          ? `Formula ${formula.property} on ${formula.controlPath} is outside the supported Power Fx semantic slice: ${formula.unsupportedReason}`
          : `Formula ${formula.property} on ${formula.controlPath} is outside the supported Power Fx semantic slice.`,
        source: '@pp/canvas',
        path: buildLintPath(formula.controlPath, formula.property, formula.sourceSpan),
        controlPath: formula.controlPath,
        property: formula.property,
        location: formula.sourceSpan,
        unsupported: true,
        related: [
          {
            kind: 'control',
            message: `Formula property ${formula.property} belongs to ${formula.controlPath}.`,
            path: formula.controlPath,
            location: formula.sourceSpan,
          },
        ],
      });
    }

    for (const binding of formula.bindings.filter((item) => !item.resolved)) {
      diagnostics.push({
        severity: binding.metadataBacked ? 'error' : 'warning',
        code: binding.metadataBacked ? 'CANVAS_METADATA_REFERENCE_UNRESOLVED' : 'CANVAS_FORMULA_REFERENCE_UNRESOLVED',
        category: binding.metadataBacked ? 'metadata' : 'binding',
        message: binding.metadataBacked
          ? `Metadata-backed reference ${binding.name} in ${formula.property} on ${formula.controlPath} could not be resolved.`
          : `Reference ${binding.name} in ${formula.property} on ${formula.controlPath} could not be resolved.`,
        source: '@pp/canvas',
        path: buildLintPath(formula.controlPath, formula.property, formula.sourceSpan),
        controlPath: formula.controlPath,
        property: formula.property,
        location: formula.sourceSpan,
        metadataBacked: binding.metadataBacked,
        related: [
          {
            kind: 'binding',
            message: `Unresolved ${binding.metadataBacked ? 'metadata-backed ' : ''}binding ${binding.name}.`,
            path: formula.controlPath,
            location: formula.sourceSpan,
            metadataBacked: binding.metadataBacked,
          },
        ],
      });
    }
  }

  for (const property of prepared.invalidPropertyChecks) {
    const control = controlByPath.get(property.controlPath);
    const location = control?.source?.propertySpans?.[property.property];
    const message = property.reason
      ? `Property ${property.property} is not valid for ${property.templateName}@${property.templateVersion} on ${property.controlPath}: ${property.reason}`
      : `Property ${property.property} is not valid for ${property.templateName}@${property.templateVersion} on ${property.controlPath}.`;
    diagnostics.push({
      severity: 'error',
      code: 'CANVAS_CONTROL_PROPERTY_INVALID',
      category: 'property',
      message,
      source: '@pp/canvas',
      path: buildLintPath(property.controlPath, property.property, location),
      controlPath: property.controlPath,
      property: property.property,
      location,
      related: [
        {
          kind: 'template',
          message: [property.source ? `Template metadata source: ${property.source}.` : `Template ${property.templateName}@${property.templateVersion}.`, property.reason]
            .filter(Boolean)
            .join(' '),
          path: property.controlPath,
        },
      ],
    });
  }

  for (const issue of prepared.unresolvedTemplates) {
    const control = controlByPath.get(issue.controlPath);
    const location = control?.source?.controlTypeSpan ?? control?.source?.nameSpan ?? control?.source?.span;
    diagnostics.push({
      severity: 'error',
      code: 'CANVAS_TEMPLATE_METADATA_MISSING',
      category: 'template',
      message: `Template metadata for ${issue.templateName}@${issue.templateVersion} was not resolved for ${issue.controlPath}.`,
      source: '@pp/canvas',
      path: buildLintPath(issue.controlPath, undefined, location),
      controlPath: issue.controlPath,
      location,
      related: [
        {
          kind: 'template',
          message: `Missing template requirement ${issue.templateName}@${issue.templateVersion}.`,
          path: issue.controlPath,
          location,
        },
      ],
    });
  }

  for (const issue of prepared.unsupportedTemplates) {
    const control = controlByPath.get(issue.controlPath);
    const location = control?.source?.controlTypeSpan ?? control?.source?.nameSpan ?? control?.source?.span;
    diagnostics.push({
      severity: issue.status === 'partial' ? 'warning' : 'error',
      code: 'CANVAS_TEMPLATE_UNSUPPORTED',
      category: 'policy',
      message: `Template ${issue.templateName}@${issue.templateVersion} for ${issue.controlPath} is ${issue.status} in ${prepared.report.mode} mode.`,
      source: '@pp/canvas',
      path: buildLintPath(issue.controlPath, undefined, location),
      controlPath: issue.controlPath,
      location,
      unsupported: issue.status !== 'supported',
      related: [
        {
          kind: 'support',
          message: issue.modes.length > 0 ? `Supported modes: ${issue.modes.join(', ')}.` : 'No supported modes were declared.',
          path: issue.controlPath,
          location,
        },
      ],
    });
  }

  return diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
}

function toOperationDiagnostic(diagnostic: CanvasLintDiagnostic): Diagnostic {
  return createDiagnostic(diagnostic.severity, diagnostic.code, diagnostic.message, {
    source: diagnostic.source,
    path: diagnostic.path,
    detail: diagnostic.related?.map((item) => item.message).join(' '),
  });
}

function buildLintPath(controlPath: string, property: string | undefined, location: CanvasSourceSpan | undefined): string {
  if (location) {
    return `${location.file}:${location.start.line}:${location.start.column}`;
  }

  return property ? `${controlPath}.${property}` : controlPath;
}

function normalizeCanvasTemplateRegistry(
  value: unknown,
  sourcePath: string,
  provenanceOverride?: Partial<CanvasTemplateProvenance>
): OperationResult<CanvasTemplateRegistryDocument> {
  const objectValue = asRecord(value);

  if (!objectValue) {
    return fail(
      createDiagnostic('error', 'CANVAS_TEMPLATE_REGISTRY_INVALID', `Canvas template registry ${sourcePath} must be a JSON object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const rawUsedTemplates = normalizeRawUsedTemplatesCatalog(objectValue, sourcePath);
  const templatesValue = rawUsedTemplates?.templates ?? objectValue.templates ?? objectValue.controlTemplates ?? objectValue.entries ?? value;
  const templates = normalizeTemplateList(templatesValue, sourcePath, provenanceOverride);

  if (!templates.success || !templates.data) {
    return templates as unknown as OperationResult<CanvasTemplateRegistryDocument>;
  }

  const supportMatrixValue = objectValue.supportMatrix ?? objectValue.support ?? rawUsedTemplates?.supportMatrix ?? [];
  const supportMatrix = normalizeSupportMatrix(supportMatrixValue);

  if (!supportMatrix.success || !supportMatrix.data) {
    return supportMatrix as unknown as OperationResult<CanvasTemplateRegistryDocument>;
  }

  return ok(
    {
      schemaVersion: 1,
      generatedAt:
        typeof objectValue.generatedAt === 'string'
          ? objectValue.generatedAt
          : provenanceOverride?.acquiredAt ?? new Date().toISOString(),
      templates: templates.data.sort(compareTemplates),
      supportMatrix: supportMatrix.data,
    },
    {
      supportTier: 'preview',
      warnings: [],
    }
  );
}

function normalizeRawUsedTemplatesCatalog(
  value: Record<string, unknown>,
  sourcePath: string
): { templates: unknown[]; supportMatrix: unknown[] } | undefined {
  const usedTemplates = Array.isArray(value.UsedTemplates) ? value.UsedTemplates : undefined;
  const pcfTemplates = Array.isArray(value.PcfTemplates) ? value.PcfTemplates : undefined;

  if (usedTemplates && usedTemplates.length > 0) {
    return {
      templates: usedTemplates.map((entry) => {
        const template = asRecord(entry) ?? {};
        const templateName = readString(template.Name) ?? readString(template.name);
        const templateVersion = readString(template.Version) ?? readString(template.version);
        const templateXml = readString(template.Template) ?? readString(template.template);

        return {
          templateName,
          templateVersion,
          aliases: {
            yamlNames: templateName ? [templateName] : [],
            constructors: inferRawTemplateConstructors(templateName),
          },
          files: {
            'References/Templates.json': {
              name: templateName,
              version: templateVersion,
              templateXml,
            },
          },
          provenance: {
            sourceArtifact: basename(sourcePath),
          },
        };
      }),
      supportMatrix: usedTemplates.map((entry) => {
        const template = asRecord(entry) ?? {};
        const templateName = readString(template.Name) ?? readString(template.name);
        const templateVersion = readString(template.Version) ?? readString(template.version);

        return {
          templateName,
          version: templateVersion,
          supported: true,
          modes: ['strict', 'registry'],
          notes: ['Imported from an exported References/Templates.json payload.'],
        };
      }),
    };
  }

  if (!pcfTemplates || pcfTemplates.length === 0) {
    return undefined;
  }

  return {
    templates: pcfTemplates.map((entry) => {
      const template = asRecord(entry) ?? {};
      const templateName = readString(template.Name) ?? readString(template.name);
      const templateVersion = readString(template.Version) ?? readString(template.version);

      return {
        templateName,
        templateVersion,
        aliases: {
          yamlNames: templateName ? [templateName] : [],
          constructors: inferRawTemplateConstructors(templateName),
        },
        files: {
          'References/Templates.json': {
            name: templateName,
            version: templateVersion,
            pcfConversions: template.PcfConversions,
          },
        },
        provenance: {
          sourceArtifact: basename(sourcePath),
        },
      };
    }),
    supportMatrix: pcfTemplates.map((entry) => {
      const template = asRecord(entry) ?? {};
      const templateName = readString(template.Name) ?? readString(template.name);
      const templateVersion = readString(template.Version) ?? readString(template.version);

      return {
        templateName,
        version: templateVersion,
        supported: true,
        modes: ['strict', 'registry'],
        notes: ['Imported from an exported References/Templates.json PCF payload.'],
      };
    }),
  };
}

function inferRawTemplateConstructors(templateName: string | undefined): string[] {
  if (!templateName) {
    return [];
  }

  if (templateName.includes('/')) {
    return [templateName];
  }

  const normalized = templateName
    .split(/[^A-Za-z0-9]+/g)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');

  return normalized.length > 0 ? [`Classic/${normalized}`] : [];
}

function normalizeTemplateList(
  value: unknown,
  sourcePath: string,
  provenanceOverride?: Partial<CanvasTemplateProvenance>
): OperationResult<CanvasTemplateRecord[]> {
  const items = Array.isArray(value)
    ? value
    : asRecord(value)
      ? Object.entries(asRecord(value) ?? {}).map(([key, nested]) => ({ templateName: key, ...(asRecord(nested) ?? {}) }))
      : [];

  if (items.length === 0) {
    return fail(
      createDiagnostic('error', 'CANVAS_TEMPLATE_REGISTRY_EMPTY', `Canvas template registry ${sourcePath} did not contain any templates.`, {
        source: '@pp/canvas',
      })
    );
  }

  const templates: CanvasTemplateRecord[] = [];

  for (const item of items) {
    const template = normalizeTemplateRecord(item, sourcePath, provenanceOverride);

    if (!template.success || !template.data) {
      return template as unknown as OperationResult<CanvasTemplateRecord[]>;
    }

    templates.push(template.data);
  }

  return ok(templates, {
    supportTier: 'preview',
  });
}

function normalizeTemplateRecord(
  value: unknown,
  sourcePath: string,
  provenanceOverride?: Partial<CanvasTemplateProvenance>
): OperationResult<CanvasTemplateRecord> {
  const template = asRecord(value);

  if (!template) {
    return fail(
      createDiagnostic('error', 'CANVAS_TEMPLATE_ENTRY_INVALID', `Canvas template entry in ${sourcePath} must be an object.`, {
        source: '@pp/canvas',
      })
    );
  }

  const templateName = readString(template.templateName) ?? readString(template.name);
  const templateVersion = readString(template.templateVersion) ?? readString(template.version);

  if (!templateName || !templateVersion) {
    return fail(
      createDiagnostic(
        'error',
        'CANVAS_TEMPLATE_FIELDS_REQUIRED',
        `Canvas template entries in ${sourcePath} must include templateName/name and templateVersion/version.`,
        {
          source: '@pp/canvas',
        }
      )
    );
  }

  const aliases = normalizeAliases(template.aliases);
  const files = normalizeFiles(template.files ?? template.artifacts ?? template.payload);
  const provenance = normalizeProvenance(template.provenance, sourcePath, provenanceOverride);
  const contentHash = sha256Hex(
    stringifyCanvasJson({
      templateName,
      templateVersion,
      aliases,
      files,
    })
  );

  return ok(
    {
      templateName,
      templateVersion,
      aliases,
      files,
      contentHash,
      provenance,
    },
    {
      supportTier: 'preview',
    }
  );
}

function normalizeSupportMatrix(value: unknown): OperationResult<CanvasSupportMatrixEntry[]> {
  if (!Array.isArray(value)) {
    return fail(
      createDiagnostic('error', 'CANVAS_SUPPORT_MATRIX_INVALID', 'Canvas supportMatrix must be an array.', {
        source: '@pp/canvas',
      })
    );
  }

  const rules: CanvasSupportMatrixEntry[] = [];

  for (const item of value) {
    const rule = asRecord(item);

    if (!rule) {
      return fail(
        createDiagnostic('error', 'CANVAS_SUPPORT_RULE_INVALID', 'Canvas support-matrix entries must be objects.', {
          source: '@pp/canvas',
        })
      );
    }

    const templateName = readString(rule.templateName) ?? readString(rule.name);
    const version = readString(rule.version) ?? '*';
    const status = normalizeSupportStatus(rule.status, rule.supported);

    if (!templateName) {
      return fail(
        createDiagnostic('error', 'CANVAS_SUPPORT_RULE_NAME_REQUIRED', 'Canvas support-matrix entries must include templateName/name.', {
          source: '@pp/canvas',
        })
      );
    }

    rules.push({
      templateName,
      version,
      status,
      modes: normalizeModes(rule.modes),
      notes: normalizeStringList(rule.notes),
    });
  }

  return ok(rules, {
    supportTier: 'preview',
  });
}

function resolveCanvasTemplateForMode(
  request: CanvasTemplateLookup,
  options: {
    mode: CanvasBuildMode;
    seeded?: CanvasRegistryBundle;
    registry?: CanvasRegistryBundle;
  }
): CanvasTemplateResolution {
  const bundles = resolveBundlesForMode(options.mode, options.seeded, options.registry);

  for (const bundle of bundles) {
    const resolution = resolveCanvasTemplate(bundle, request);

    if (resolution.template) {
      return resolution;
    }
  }

  return {
    requested: request,
    support: {
      status: 'unsupported',
      modes: [],
      notes: [`Template metadata for ${request.name}${request.version ? `@${request.version}` : ''} was not available for ${options.mode} mode.`],
    },
  };
}

function resolveBundlesForMode(
  mode: CanvasBuildMode,
  seeded: CanvasRegistryBundle | undefined,
  registry: CanvasRegistryBundle | undefined
): CanvasRegistryBundle[] {
  switch (mode) {
    case 'seeded':
      return seeded ? [seeded] : [];
    case 'registry':
      return registry ? [registry] : [];
    case 'strict':
      return [seeded, registry].filter(Boolean) as CanvasRegistryBundle[];
  }
}

function matchTemplateCandidate(template: CanvasTemplateRecord, requestedName: string): CanvasTemplateCandidate[] {
  const normalizedRequested = normalizeName(requestedName);
  const candidates: CanvasTemplateCandidate[] = [];

  if (normalizeName(template.templateName) === normalizedRequested) {
    candidates.push({ template, matchedBy: 'templateName' });
  }

  for (const displayName of template.aliases?.displayNames ?? []) {
    if (normalizeName(displayName) === normalizedRequested) {
      candidates.push({ template, matchedBy: 'displayName' });
    }
  }

  for (const constructor of template.aliases?.constructors ?? []) {
    if (normalizeName(constructor) === normalizedRequested) {
      candidates.push({ template, matchedBy: 'constructor' });
    }
  }

  for (const yamlName of template.aliases?.yamlNames ?? []) {
    if (normalizeName(yamlName) === normalizedRequested) {
      candidates.push({ template, matchedBy: 'yamlName' });
    }
  }

  return candidates;
}

function normalizeAliases(value: unknown): CanvasTemplateAliases | undefined {
  const aliases = asRecord(value);

  if (!aliases) {
    return undefined;
  }

  return {
    displayNames: normalizeStringList(aliases.displayNames ?? aliases.displayName),
    constructors: normalizeStringList(aliases.constructors ?? aliases.constructor),
    yamlNames: normalizeStringList(aliases.yamlNames ?? aliases.yamlName),
  };
}

function normalizeFiles(value: unknown): Record<string, CanvasJsonValue> | undefined {
  const files = asRecord(value);

  if (!files) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(files).map(([key, nested]) => [key, normalizeJsonValue(nested)]));
}

function normalizeProvenance(
  value: unknown,
  sourcePath: string,
  override?: Partial<CanvasTemplateProvenance>
): CanvasTemplateProvenance {
  const provenance = asRecord(value);

  return {
    kind: normalizeProvenanceKind(readString(provenance?.kind) ?? override?.kind),
    source: readString(provenance?.source) ?? override?.source ?? basename(sourcePath),
    acquiredAt: readString(provenance?.acquiredAt) ?? override?.acquiredAt,
    sourceArtifact: readString(provenance?.sourceArtifact) ?? override?.sourceArtifact,
    sourceAppId: readString(provenance?.sourceAppId) ?? override?.sourceAppId,
    platformVersion: readString(provenance?.platformVersion) ?? override?.platformVersion,
    appVersion: readString(provenance?.appVersion) ?? override?.appVersion,
    importedFrom: override?.importedFrom ?? sourcePath,
  };
}

function normalizeJsonValue(value: unknown): CanvasJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value as CanvasJsonValue;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeJsonValue(nested)])
    );
  }

  return String(value);
}

function normalizeSupportStatus(statusValue: unknown, supportedValue: unknown): CanvasSupportStatus {
  if (statusValue === 'supported' || statusValue === 'partial' || statusValue === 'unsupported') {
    return statusValue;
  }

  if (supportedValue === true) {
    return 'supported';
  }

  if (supportedValue === false) {
    return 'unsupported';
  }

  return 'supported';
}

function normalizeModes(value: unknown): CanvasBuildMode[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const modes = value.filter((item): item is CanvasBuildMode => item === 'strict' || item === 'seeded' || item === 'registry');

  return modes.length > 0 ? modes : undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return [value];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
}

function normalizeProvenanceKind(value: string | undefined): ProvenanceClass {
  switch (value) {
    case 'official-api':
    case 'official-artifact':
    case 'harvested':
    case 'inferred':
      return value;
    default:
      return 'official-artifact';
  }
}

function getSupportRuleScore(
  rule: CanvasSupportMatrixEntry,
  templateName: string,
  templateVersion: string
): number {
  if (normalizeName(rule.templateName) !== normalizeName(templateName)) {
    return -1;
  }

  if (!matchesVersionPattern(rule.version, templateVersion)) {
    return -1;
  }

  return versionSpecificity(rule.version);
}

function matchesVersionPattern(pattern: string, version: string): boolean {
  if (pattern === '*' || pattern.trim() === '') {
    return true;
  }

  if (!pattern.includes('*')) {
    return pattern === version;
  }

  const patternSegments = pattern.split('.');
  const versionSegments = version.split('.');

  return patternSegments.every((segment, index) => segment === '*' || segment === versionSegments[index]);
}

function versionSpecificity(pattern: string): number {
  if (pattern === '*') {
    return 0;
  }

  return pattern.split('.').filter((segment) => segment !== '*').length;
}

function compareTemplateCandidates(left: CanvasTemplateCandidate, right: CanvasTemplateCandidate): number {
  return compareTemplateVersions(right.template.templateVersion, left.template.templateVersion);
}

function compareTemplates(left: CanvasTemplateRecord, right: CanvasTemplateRecord): number {
  return left.templateName.localeCompare(right.templateName) || compareTemplateVersions(left.templateVersion, right.templateVersion);
}

function compareTemplateVersions(left: string, right: string): number {
  const leftSegments = left.split('.');
  const rightSegments = right.split('.');
  const length = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < length; index += 1) {
    const leftSegment = leftSegments[index] ?? '';
    const rightSegment = rightSegments[index] ?? '';
    const leftNumber = Number(leftSegment);
    const rightNumber = Number(rightSegment);

    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }

      continue;
    }

    const comparison = leftSegment.localeCompare(rightSegment);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function makeTemplateKey(templateName: string, templateVersion: string): string {
  return `${normalizeName(templateName)}@${templateVersion}`;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function stringifyCanvasJson(value: unknown): string {
  return stableStringify(value as Parameters<typeof stableStringify>[0]);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export {
  buildCanvasSemanticModel,
  collectCanvasFormulaChecks,
  findCanvasSemanticControl,
  type BuildCanvasSemanticModelOptions,
  type CanvasFormulaBinding,
  type CanvasFormulaSemantic,
  type CanvasSemanticControl,
  type CanvasSemanticModel,
  type CanvasSemanticSymbol,
  type CanvasSemanticSymbolKind,
  type PowerFxAstNode,
} from './semantic-model';
export * from './control-catalog';
export * from './archive';
export * from './harvest';
export * from './harvest-fixture';
export * from './harvest-studio-plan';
export {
  CanvasLspSession,
  isJsonRpcError,
  type CanvasLspSessionOptions,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspHover,
  type LspLocation,
  type LspPosition,
  type LspPublishDiagnosticsParams,
  type LspRange,
} from './lsp';
