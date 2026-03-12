import type { ProvenanceClass } from '@pp/diagnostics';
import type { CanvasDataSourceSummary, CanvasSourceReadOptions } from './pa-yaml';

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

export interface CanvasTemplateReportRecord {
  templateName: string;
  templateVersion: string;
  contentHash: string;
  aliases?: CanvasTemplateAliases;
  files: string[];
  provenance: CanvasTemplateProvenance;
}

export interface CanvasTemplateReportResolution {
  requested: CanvasTemplateLookup;
  template?: CanvasTemplateReportRecord;
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

export interface CanvasTemplateRequirementReport {
  mode: CanvasBuildMode;
  resolutions: CanvasTemplateReportResolution[];
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
  templateRequirements: CanvasTemplateRequirementReport;
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

export interface CanvasRemoteProofExpectation {
  controlPath: string;
  property: string;
  expectedValue: string;
}

export interface CanvasRemoteProofCheck {
  controlPath: string;
  property: string;
  found: boolean;
  matched: boolean;
  expectedValue: string;
  actualValue?: CanvasJsonValue;
  actualValueText?: string;
  sourceActualValueText?: string;
  harvestedActualValueText?: string;
  evidence?: 'source' | 'harvested';
  conflict?: boolean;
}

export interface CanvasRemoteProofReport {
  valid: boolean;
  appId: string;
  sourceHash: string;
  screenCount: number;
  controlCount: number;
  dataSources: string[];
  expectations: CanvasRemoteProofCheck[];
}

export interface CanvasBuildResult {
  outPath: string;
  mode: CanvasBuildMode;
  sourceHash: string;
  templateHash: string;
  packageHash: string;
  outFileSha256: string;
  supported: boolean;
}
