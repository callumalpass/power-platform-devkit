import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify, writeJsonFile } from '@pp/artifacts';
import { CanvasAppService, type CanvasAppSummary as DataverseCanvasAppSummary, type DataverseClient } from '@pp/dataverse';
import { createDiagnostic, fail, ok, withWarning, type Diagnostic, type OperationResult, type ProvenanceClass } from '@pp/diagnostics';
import { SolutionService } from '@pp/solution';
import { buildCanvasMsappFromUnpackedSource } from './msapp-build';
import { type CanvasDataSourceSummary, loadCanvasPaYamlSource, resolveCanvasPaYamlRoot, type CanvasSourceReadOptions } from './pa-yaml';
import { parsePowerFxExpression } from './power-fx';
import { buildCanvasSemanticModel, collectCanvasFormulaChecks } from './semantic-model';
import { buildCanvasTemplateSurface } from './template-surface';

export type CanvasBuildMode = 'strict' | 'seeded' | 'registry';
export type CanvasSupportStatus = 'supported' | 'partial' | 'unsupported';
export type CanvasTemplateMatchType = 'templateName' | 'displayName' | 'constructor' | 'yamlName';
export type CanvasJsonValue = null | boolean | number | string | CanvasJsonValue[] | { [key: string]: CanvasJsonValue };

export interface CanvasSourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface CanvasSourceSpan {
  file: string;
  start: CanvasSourcePosition;
  end: CanvasSourcePosition;
}

export interface CanvasNodeSourceInfo {
  id: string;
  file: string;
  span?: CanvasSourceSpan;
  nameSpan?: CanvasSourceSpan;
  propertyNameSpans?: Record<string, CanvasSourceSpan>;
  propertySpans?: Record<string, CanvasSourceSpan>;
  propertiesSpan?: CanvasSourceSpan;
  controlTypeSpan?: CanvasSourceSpan;
  childrenSpan?: CanvasSourceSpan;
}

export interface CanvasColumnMetadata {
  name: string;
  logicalName?: string;
  displayName?: string;
  type?: string;
}

export interface CanvasRelationshipMetadata {
  name: string;
  target?: string;
  columnName?: string;
}

export interface CanvasOptionValueMetadata {
  name: string;
  value?: string | number;
}

export interface CanvasOptionSetMetadata {
  name: string;
  values: CanvasOptionValueMetadata[];
}

export interface CanvasEntityMetadata {
  name: string;
  logicalName?: string;
  displayName?: string;
  columns: CanvasColumnMetadata[];
  relationships: CanvasRelationshipMetadata[];
  optionSets: CanvasOptionSetMetadata[];
}

export interface CanvasMetadataCatalog {
  entities: CanvasEntityMetadata[];
  optionSets: CanvasOptionSetMetadata[];
}

export interface CanvasTemplateAliases {
  displayNames?: string[];
  constructors?: string[];
  yamlNames?: string[];
}

export interface CanvasTemplateProvenance {
  kind: ProvenanceClass;
  source: string;
  acquiredAt?: string;
  sourceArtifact?: string;
  sourceAppId?: string;
  platformVersion?: string;
  appVersion?: string;
  importedFrom?: string;
}

export interface CanvasTemplateRecord {
  templateName: string;
  templateVersion: string;
  aliases?: CanvasTemplateAliases;
  files?: Record<string, CanvasJsonValue>;
  contentHash: string;
  provenance: CanvasTemplateProvenance;
}

export interface CanvasSupportMatrixEntry {
  templateName: string;
  version: string;
  status: CanvasSupportStatus;
  modes?: CanvasBuildMode[];
  notes?: string[];
}

export interface CanvasTemplateRegistryDocument {
  schemaVersion: 1;
  generatedAt?: string;
  templates: CanvasTemplateRecord[];
  supportMatrix: CanvasSupportMatrixEntry[];
}

export interface CanvasRegistrySourceSummary {
  path: string;
  hash: string;
  generatedAt?: string;
  templateCount: number;
  supportRuleCount: number;
}

export interface CanvasRegistryBundle {
  sources: CanvasRegistrySourceSummary[];
  templates: CanvasTemplateRecord[];
  supportMatrix: CanvasSupportMatrixEntry[];
  hash: string;
}

export interface CanvasRegistryLoadOptions {
  root?: string;
  registries?: string[];
  cacheDir?: string;
}

export interface CanvasSourceLoadOptions extends CanvasRegistryLoadOptions, CanvasSourceReadOptions {}

export interface CanvasRegistryImportRequest {
  sourcePath: string;
  outPath?: string;
  provenance?: Partial<CanvasTemplateProvenance>;
}

export interface CanvasWorkspaceCatalogEntry {
  name: string;
  registries: string[];
  notes?: string[];
}

export interface CanvasWorkspaceAppEntry {
  name: string;
  path: string;
  registries?: string[];
  catalogs?: string[];
  notes?: string[];
}

export interface CanvasWorkspaceDocument {
  schemaVersion: 1;
  name: string;
  registries?: string[];
  catalogs?: CanvasWorkspaceCatalogEntry[];
  apps: CanvasWorkspaceAppEntry[];
}

export interface CanvasWorkspaceResolvedApp {
  name: string;
  path: string;
  registries: string[];
  catalogs: string[];
  notes: string[];
}

export interface CanvasWorkspaceInspectReport {
  path: string;
  workspace: CanvasWorkspaceDocument;
  apps: CanvasWorkspaceResolvedApp[];
  registries: string[];
  catalogs: CanvasWorkspaceCatalogEntry[];
}

export interface CanvasTemplateLookup {
  name: string;
  version?: string;
}

export interface CanvasSupportResolution {
  status: CanvasSupportStatus;
  modes: CanvasBuildMode[];
  matchedRule?: CanvasSupportMatrixEntry;
  notes: string[];
}

export interface CanvasTemplateResolution {
  requested: CanvasTemplateLookup;
  template?: CanvasTemplateRecord;
  matchedBy?: CanvasTemplateMatchType;
  support: CanvasSupportResolution;
}

export interface CanvasTemplateRegistryInspectReport {
  path: string;
  hash: string;
  generatedAt?: string;
  templateCount: number;
  supportRuleCount: number;
  templates: Array<{
    templateName: string;
    templateVersion: string;
    provenanceKind: ProvenanceClass;
    source: string;
    importedFrom?: string;
    appVersion?: string;
    platformVersion?: string;
    aliases: {
      displayNames: number;
      constructors: number;
      yamlNames: number;
    };
  }>;
}

export interface CanvasTemplateRegistryDiffResult {
  left: CanvasTemplateRegistryInspectReport;
  right: CanvasTemplateRegistryInspectReport;
  templates: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  supportRules: {
    added: string[];
    removed: string[];
  };
}

export interface CanvasTemplateRegistryAuditReport {
  path: string;
  templateCount: number;
  supportRuleCount: number;
  missingImportedFromCount: number;
  missingSourceArtifactCount: number;
  missingPlatformVersionCount: number;
  missingAppVersionCount: number;
  provenanceKinds: Record<string, number>;
  sources: string[];
  importedFrom: string[];
  sourceArtifacts: string[];
  platformVersions: string[];
  appVersions: string[];
}

export interface CanvasTemplateRegistryPinResult {
  outPath: string;
  hash: string;
  generatedAt?: string;
  templateCount: number;
  supportRuleCount: number;
}

export interface CanvasTemplateRegistryRefreshResult {
  registry: CanvasTemplateRegistryInspectReport;
  diff?: CanvasTemplateRegistryDiffResult;
}

export interface CanvasTemplateRequirementResolution {
  mode: CanvasBuildMode;
  resolutions: CanvasTemplateResolution[];
  missing: CanvasTemplateLookup[];
  supported: boolean;
}

export interface CanvasBuildSummary {
  path: string;
  mode: CanvasBuildMode;
  supported: boolean;
  registries: CanvasRegistrySourceSummary[];
}

export interface CanvasManifest {
  name: string;
  displayName?: string;
  version?: string;
  screens: CanvasScreenReference[];
}

export interface CanvasScreenReference {
  name: string;
  file: string;
}

export interface CanvasControlDefinition {
  name: string;
  templateName: string;
  templateVersion: string;
  properties: Record<string, CanvasJsonValue>;
  children: CanvasControlDefinition[];
  variantName?: string;
  layoutName?: string;
  source?: CanvasNodeSourceInfo;
}

export interface CanvasScreenDefinition {
  name: string;
  file: string;
  properties?: Record<string, CanvasJsonValue>;
  controls: CanvasControlDefinition[];
  source?: CanvasNodeSourceInfo;
}

export interface CanvasControlSummary {
  path: string;
  screen: string;
  templateName: string;
  templateVersion: string;
  propertyCount: number;
  childCount: number;
}

export interface CanvasFormulaCheck {
  controlPath: string;
  property: string;
  valid: boolean;
}

export interface CanvasTemplateUsageIssue {
  controlPath: string;
  templateName: string;
  templateVersion: string;
  status: CanvasSupportStatus;
  modes: CanvasBuildMode[];
}

export interface CanvasSourceModel {
  kind?: 'json-manifest' | 'pa-yaml-unpacked';
  root: string;
  manifestPath: string;
  manifest: CanvasManifest;
  appProperties?: Record<string, CanvasJsonValue>;
  screens: CanvasScreenDefinition[];
  controls: CanvasControlSummary[];
  templateRequirements: CanvasTemplateLookup[];
  sourceHash: string;
  seedRegistryPath?: string;
  embeddedRegistryPaths?: string[];
  dataSources?: CanvasDataSourceSummary[];
  metadataCatalog?: CanvasMetadataCatalog;
  editorStatePath?: string;
  appSource?: CanvasNodeSourceInfo;
  appPropertySpans?: Record<string, CanvasSourceSpan>;
  unpackedArtifacts?: {
    headerPath?: string;
    propertiesPath?: string;
    appCheckerPath?: string;
    appControlPath?: string;
    controlsDir?: string;
    referencesDir?: string;
    resourcesDir?: string;
  };
}

export interface CanvasPropertyCheck {
  controlPath: string;
  property: string;
  templateName: string;
  templateVersion: string;
  valid: boolean;
  source?: string;
}

export interface CanvasValidationReport {
  valid: boolean;
  mode: CanvasBuildMode;
  source: {
    root: string;
    manifestPath: string;
    name: string;
    displayName?: string;
    version?: string;
    screenCount: number;
    controlCount: number;
    sourceHash: string;
    seedRegistryPath?: string;
  };
  dataSources?: CanvasDataSourceSummary[];
  templateRequirements: CanvasTemplateRequirementResolution;
  unresolvedTemplates: CanvasTemplateUsageIssue[];
  unsupportedTemplates: CanvasTemplateUsageIssue[];
  formulas: CanvasFormulaCheck[];
  propertyChecks?: CanvasPropertyCheck[];
  registries: CanvasRegistrySourceSummary[];
}

export type CanvasLintCategory = 'formula' | 'binding' | 'property' | 'template' | 'metadata' | 'policy';

export interface CanvasLintRelatedContext {
  kind: 'control' | 'template' | 'binding' | 'support' | 'metadata';
  message: string;
  path?: string;
  location?: CanvasSourceSpan;
  metadataBacked?: boolean;
}

export interface CanvasLintDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  category: CanvasLintCategory;
  message: string;
  source: '@pp/canvas';
  path: string;
  controlPath?: string;
  property?: string;
  location?: CanvasSourceSpan;
  metadataBacked?: boolean;
  unsupported?: boolean;
  related?: CanvasLintRelatedContext[];
}

export interface CanvasLintReport {
  valid: boolean;
  mode: CanvasBuildMode;
  source: CanvasValidationReport['source'];
  dataSources?: CanvasDataSourceSummary[];
  registries: CanvasRegistrySourceSummary[];
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
  diagnostics: CanvasLintDiagnostic[];
}

export interface CanvasInspectReport extends CanvasValidationReport {
  screens: Array<{
    name: string;
    file: string;
    controlCount: number;
  }>;
  controls: CanvasControlSummary[];
}

export interface CanvasBuildResult {
  outPath: string;
  mode: CanvasBuildMode;
  sourceHash: string;
  templateHash: string;
  packageHash: string;
  supported: boolean;
}

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

export interface CanvasRemoteDownloadResult {
  app: CanvasAppSummary;
  solutionUniqueName: string;
  outPath: string;
  exportedEntry: string;
  availableEntries: string[];
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
  semanticModel: ReturnType<typeof buildCanvasSemanticModel>;
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
    } = {}
  ): Promise<OperationResult<CanvasValidationReport>> {
    return validateCanvasApp(path, options);
  }

  async lint(
    path: string,
    options: CanvasSourceLoadOptions & {
      mode?: CanvasBuildMode;
    } = {}
  ): Promise<OperationResult<CanvasLintReport>> {
    return lintCanvasApp(path, options);
  }

  async build(
    path: string,
    options: CanvasSourceLoadOptions & {
      mode?: CanvasBuildMode;
      outPath?: string;
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

  async downloadRemote(
    identifier: string,
    options: {
      solutionUniqueName: string;
      outPath?: string;
    }
  ): Promise<OperationResult<CanvasRemoteDownloadResult>> {
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
      return app as unknown as OperationResult<CanvasRemoteDownloadResult>;
    }

    if (!app.data) {
        return fail(
          [
            ...app.diagnostics,
            createDiagnostic('error', 'CANVAS_REMOTE_NOT_FOUND', `Canvas app ${identifier} was not found in solution ${options.solutionUniqueName}.`, {
              source: '@pp/canvas',
            }),
          ],
          {
            supportTier: 'preview',
            warnings: app.warnings,
          }
        );
    }

    const exportRoot = await mkdtemp(join(tmpdir(), 'pp-canvas-remote-download-'));

    try {
      const packagePath = join(exportRoot, `${options.solutionUniqueName}.zip`);
      const exported = await new SolutionService(this.dataverseClient).exportSolution(options.solutionUniqueName, {
        outPath: packagePath,
      });

      if (!exported.success || !exported.data) {
        return exported as unknown as OperationResult<CanvasRemoteDownloadResult>;
      }

      const listedEntries = await listZipEntries(packagePath);

      if (!listedEntries.success || !listedEntries.data) {
        return listedEntries as unknown as OperationResult<CanvasRemoteDownloadResult>;
      }

      const availableEntries = listedEntries.data.filter((entry) => /^CanvasApps\/.+\.msapp$/i.test(entry));

      if (availableEntries.length === 0) {
        return fail(
          [
            ...app.diagnostics,
            ...exported.diagnostics,
            createDiagnostic(
              'error',
              'CANVAS_REMOTE_EXPORT_MISSING_MSAPP',
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
            warnings: [...app.warnings, ...exported.warnings],
          }
        );
      }

      const matchedEntry = resolveCanvasMsappEntry(app.data, availableEntries);

      if (!matchedEntry) {
        return fail(
          [
            ...app.diagnostics,
            ...exported.diagnostics,
            createDiagnostic(
              'error',
              'CANVAS_REMOTE_EXPORT_ENTRY_AMBIGUOUS',
              `Could not map canvas app ${identifier} to a single CanvasApps/*.msapp entry in solution ${options.solutionUniqueName}.`,
              {
                source: '@pp/canvas',
                hint: `Available entries: ${availableEntries.join(', ')}`,
              }
            ),
          ],
          {
            supportTier: 'preview',
            warnings: [...app.warnings, ...exported.warnings],
          }
        );
      }

      const content = await extractZipEntry(packagePath, matchedEntry);

      if (!content.success || content.data === undefined) {
        return content as unknown as OperationResult<CanvasRemoteDownloadResult>;
      }

      const outPath = resolve(options.outPath ?? `${defaultCanvasDownloadBaseName(app.data)}.msapp`);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, content.data);

      return ok(
        {
          app: app.data,
          solutionUniqueName: options.solutionUniqueName,
          outPath,
          exportedEntry: matchedEntry,
          availableEntries,
        },
        {
          supportTier: 'preview',
          diagnostics: [...app.diagnostics, ...exported.diagnostics],
          warnings: [...app.warnings, ...exported.warnings],
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
}

function defaultCanvasDownloadBaseName(app: CanvasAppSummary): string {
  return sanitizeCanvasArtifactName(app.displayName ?? app.name ?? app.id);
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

async function listZipEntries(packagePath: string): Promise<OperationResult<string[]>> {
  const result = await runCommand('unzip', ['-Z1', packagePath]);

  if (!result.success || result.data === undefined) {
    return result as unknown as OperationResult<string[]>;
  }

  return ok(
    result.data
      .toString('utf8')
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    {
      supportTier: 'preview',
      diagnostics: result.diagnostics,
      warnings: result.warnings,
    }
  );
}

async function extractZipEntry(packagePath: string, entry: string): Promise<OperationResult<Buffer>> {
  const result = await runCommand('unzip', ['-p', packagePath, entry]);

  if (!result.success || result.data === undefined) {
    return result as unknown as OperationResult<Buffer>;
  }

  return ok(result.data, {
    supportTier: 'preview',
    diagnostics: result.diagnostics,
    warnings: result.warnings,
  });
}

async function runCommand(command: string, args: string[]): Promise<OperationResult<Buffer>> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) =>
      resolvePromise(
        fail(
          createDiagnostic('error', 'CANVAS_REMOTE_ZIP_TOOL_UNAVAILABLE', `Failed to execute ${command}.`, {
            source: '@pp/canvas',
            hint: error instanceof Error ? error.message : 'Install unzip and retry.',
          }),
          {
            supportTier: 'preview',
          }
        )
      )
    );
    child.on('close', (code) => {
      if (code !== 0) {
        resolvePromise(
          fail(
            createDiagnostic('error', 'CANVAS_REMOTE_ZIP_COMMAND_FAILED', `${command} exited with code ${code ?? 'unknown'}.`, {
              source: '@pp/canvas',
              hint: stderr.length > 0 ? Buffer.concat(stderr).toString('utf8').trim() : undefined,
            }),
            {
              supportTier: 'preview',
            }
          )
        );
        return;
      }

      resolvePromise(
        ok(Buffer.concat(stdout), {
          supportTier: 'preview',
        })
      );
    });
  });
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

  return ok(
    {
      path: loaded.data.path,
      workspace: loaded.data.document,
      apps: loaded.data.document.apps.map((app) => resolveWorkspaceAppEntry(loaded.data.document, app, loaded.data.root)),
      registries: loaded.data.document.registries ?? [],
      catalogs: loaded.data.document.catalogs ?? [],
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

  const matched =
    loaded.data.document.apps.find((app) => app.name.toLowerCase() === target.toLowerCase()) ??
    loaded.data.document.apps.find((app) => resolve(loaded.data.root, app.path) === resolve(target));

  if (!matched) {
    return fail(
      [
        ...loaded.diagnostics,
        createDiagnostic('error', 'CANVAS_WORKSPACE_APP_NOT_FOUND', `Canvas workspace ${loaded.data.document.name} does not define app ${target}.`, {
          source: '@pp/canvas',
        }),
      ],
      {
        supportTier: 'preview',
        warnings: loaded.warnings,
      }
    );
  }

  const resolved = resolveWorkspaceAppEntry(loaded.data.document, matched, loaded.data.root);
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

  if (source.data.kind !== 'json-manifest') {
    return fail(
      createDiagnostic('error', 'CANVAS_PATCH_KIND_UNSUPPORTED', `Canvas patch currently supports json-manifest sources only; received ${source.data.kind ?? 'unknown'}.`, {
        source: '@pp/canvas',
      })
    );
  }

  const validation = normalizeCanvasPatchDocument(patch);

  if (!validation.success || !validation.data) {
    return validation as unknown as OperationResult<CanvasPatchPlanResult>;
  }

  const operations = validation.data.operations.map((operation, index) => planCanvasPatchOperation(source.data, operation, index));

  return ok(
    {
      path: resolve(path),
      sourceKind: source.data.kind,
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
    }
  );
}

export async function validateCanvasApp(
  path: string,
  options: CanvasSourceLoadOptions & {
    mode?: CanvasBuildMode;
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
  });
}

export async function lintCanvasApp(
  path: string,
  options: CanvasSourceLoadOptions & {
    mode?: CanvasBuildMode;
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
  } = {}
): Promise<OperationResult<CanvasBuildResult>> {
  const prepared = await prepareCanvasValidation(path, options);

  if (!prepared.success || !prepared.data) {
    return prepared as unknown as OperationResult<CanvasBuildResult>;
  }

  if (!prepared.data.report.valid) {
    return fail(
      prepared.data.diagnostics.length > 0
        ? prepared.data.diagnostics
        : createDiagnostic('error', 'CANVAS_BUILD_INVALID', `Canvas app ${prepared.data.source.manifest.name} is not valid for build.`, {
            source: '@pp/canvas',
          }),
      {
        supportTier: 'preview',
        warnings: prepared.data.warnings,
      }
    );
  }

  const resolvedTemplates = prepared.data.report.templateRequirements.resolutions
    .filter((resolution): resolution is CanvasTemplateResolution & { template: CanvasTemplateRecord } => Boolean(resolution.template))
    .map((resolution) => ({
      requested: resolution.requested,
      templateName: resolution.template.templateName,
      templateVersion: resolution.template.templateVersion,
      contentHash: resolution.template.contentHash,
      matchedBy: resolution.matchedBy,
    }));
  const outPath =
    options.outPath ?? resolve(prepared.data.source.root, 'dist', `${prepared.data.source.manifest.name}.msapp`);

  if (prepared.data.source.kind === 'pa-yaml-unpacked') {
    const nativeBuild = await buildCanvasMsappFromUnpackedSource(
      prepared.data.source,
      prepared.data.report.templateRequirements,
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

  await writeJsonFile(outPath, packagePayload as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      outPath,
      mode: prepared.data.report.mode,
      sourceHash: prepared.data.source.sourceHash,
      templateHash: sha256Hex(stringifyCanvasJson(resolvedTemplates)),
      packageHash,
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
    if (stableStringify(before[key]) !== stableStringify(after[key])) {
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

  const leftRules = new Set(left.document.supportMatrix.map((rule) => stableStringify(rule)));
  const rightRules = new Set(right.document.supportMatrix.map((rule) => stableStringify(rule)));

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
  }
): Promise<OperationResult<PreparedCanvasValidation>> {
  const source = await loadCanvasSource(path, options);

  if (!source.success || !source.data) {
    return source as unknown as OperationResult<PreparedCanvasValidation>;
  }

  const mode = options.mode ?? 'strict';
  const registryOptions = mergeCanvasRegistryLoadOptions(options, source.data);
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

  const templateRequirements = resolveCanvasTemplateRequirements(source.data.templateRequirements, {
    mode,
    seeded: seeded.data,
    registry: registry.data,
  });
  const semanticModel = buildCanvasSemanticModel(source.data, {
    templateResolutions: templateRequirements.resolutions,
  });
  const formulas = collectCanvasFormulaChecks(semanticModel);
  const propertyChecks = collectPropertyChecks(source.data, templateRequirements);
  const invalidPropertyChecks = propertyChecks.filter((property) => !property.valid);
  const unresolvedTemplates = collectUnresolvedTemplateIssues(source.data, templateRequirements);
  const unsupportedTemplates = collectUnsupportedTemplateIssues(source.data, templateRequirements, mode);
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
    ...invalidPropertyChecks
      .map((property) =>
        createDiagnostic(
          'error',
          'CANVAS_CONTROL_PROPERTY_INVALID',
          `Property ${property.property} is not valid for ${property.templateName}@${property.templateVersion} on ${property.controlPath}.`,
          {
            source: '@pp/canvas',
            detail: property.source ? `Validated from ${property.source}.` : undefined,
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
          hint: 'Provide seeded metadata or load a matching template registry.',
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
          detail: issue.modes.length > 0 ? `Supported modes: ${issue.modes.join(', ')}` : undefined,
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
        templateRequirements,
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
    }
  );
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

function collectFormulaChecks(screens: CanvasScreenDefinition[]): CanvasFormulaCheck[] {
  const checks: CanvasFormulaCheck[] = [];

  for (const screen of screens) {
    appendFormulaChecks(screen.name, screen.controls, screen.name, checks);
  }

  return checks.sort((left, right) => left.controlPath.localeCompare(right.controlPath) || left.property.localeCompare(right.property));
}

function appendFormulaChecks(
  screenName: string,
  controls: CanvasControlDefinition[],
  prefix: string,
  destination: CanvasFormulaCheck[]
): void {
  for (const control of controls) {
    const path = `${prefix}/${control.name}`;

    for (const [property, value] of Object.entries(control.properties)) {
      if (property.endsWith('Formula') || (typeof value === 'string' && value.trim().startsWith('='))) {
        destination.push({
          controlPath: path,
          property,
          valid:
            typeof value === 'string' &&
            (!value.trim().startsWith('=') || validatePowerFxSyntax(value)),
        });
      }
    }

    appendFormulaChecks(screenName, control.children, path, destination);
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
        destination.push({
          controlPath: path,
          property,
          templateName: template.templateName,
          templateVersion: template.templateVersion,
          valid: !surface.strictValidation || allowed.has(normalizeName(property)),
          source: surface.sources.join(', '),
        });
      }
    }

    appendPropertyChecks(control.children, path, resolutions, destination);
  }
}

function validatePowerFxSyntax(expression: string): boolean {
  const trimmed = expression.trim();

  if (!trimmed.startsWith('=')) {
    return true;
  }

  return parsePowerFxExpression(trimmed.slice(1), {
    allowsSideEffects: trimmed.includes(';'),
  }).valid;
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
        severity: 'error',
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
    diagnostics.push({
      severity: 'error',
      code: 'CANVAS_CONTROL_PROPERTY_INVALID',
      category: 'property',
      message: `Property ${property.property} is not valid for ${property.templateName}@${property.templateVersion} on ${property.controlPath}.`,
      source: '@pp/canvas',
      path: buildLintPath(property.controlPath, property.property, location),
      controlPath: property.controlPath,
      property: property.property,
      location,
      related: [
        {
          kind: 'template',
          message: property.source ? `Template metadata source: ${property.source}.` : `Template ${property.templateName}@${property.templateVersion}.`,
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

  const templatesValue = objectValue.templates ?? objectValue.controlTemplates ?? objectValue.entries ?? value;
  const templates = normalizeTemplateList(templatesValue, sourcePath, provenanceOverride);

  if (!templates.success || !templates.data) {
    return templates as unknown as OperationResult<CanvasTemplateRegistryDocument>;
  }

  const supportMatrixValue = objectValue.supportMatrix ?? objectValue.support ?? [];
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
