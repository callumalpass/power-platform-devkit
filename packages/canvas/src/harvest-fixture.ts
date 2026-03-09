import { resolve } from 'node:path';
import {
  assertCanvasControlCatalogLooksComplete,
  buildCanvasControlCatalogSelectionCheckpoint,
  type CanvasControlCatalogResumeSelection,
  type CanvasControlCatalogSelectionCheckpoint,
  type CanvasControlCatalogSelectionSummary,
  summarizeCanvasControlCatalogDocument,
  type CanvasControlCatalogCounts,
  type CanvasControlCatalogDocument,
  type CanvasControlCatalogEntry,
  type CanvasControlCatalogSource,
} from './control-catalog';
import type { CanvasJsonValue, CanvasTemplateMatchType, CanvasTemplateRecord, CanvasTemplateRegistryDocument } from './index';

export type {
  CanvasControlCatalogCounts,
  CanvasControlCatalogDocument,
  CanvasControlCatalogEntry,
  CanvasControlCatalogResumeSelection,
  CanvasControlCatalogSelectionCheckpoint,
  CanvasControlCatalogSelectionSummary,
  CanvasControlCatalogSource,
};

export interface CanvasHarvestFixturePrototype {
  family: 'classic' | 'modern';
  catalogName: string;
  constructor: string;
  variant?: string;
  properties?: Record<string, string>;
  liveValidation?: CanvasHarvestFixturePrototypeValidationRecord;
  notes?: string[];
}

export interface CanvasHarvestFixturePrototypeDocument {
  schemaVersion: 1;
  generatedAt?: string;
  prototypes: CanvasHarvestFixturePrototype[];
}

export type CanvasHarvestFixturePrototypeValidationStatus = 'validated' | 'pending' | 'failed' | 'unknown';
export type CanvasHarvestFixtureRecordedPrototypeValidationStatus = Exclude<
  CanvasHarvestFixturePrototypeValidationStatus,
  'unknown'
>;

export interface CanvasHarvestFixturePrototypeValidationRecord {
  status: CanvasHarvestFixtureRecordedPrototypeValidationStatus;
  recordedAt: string;
  method?: string;
  notes?: string[];
}

export type CanvasControlInsertReportOutcome = 'inserted' | 'covered' | 'not-found' | 'failed';

export interface CanvasControlInsertReportCandidate {
  title: string;
  category?: string;
  iconName?: string;
}

export type CanvasControlInsertWaitProfileTier = 'standard' | 'modern' | 'complex' | 'heavy';

export interface CanvasControlInsertWaitProfile {
  tier: CanvasControlInsertWaitProfileTier;
  searchSettleMs: number;
  searchStablePasses: number;
  postInsertSettleMs: number;
  readyPollMs: number;
  readyTimeoutMs: number;
  reasons: string[];
}

export interface CanvasControlInsertReportAttempt {
  query: string;
  candidates: CanvasControlInsertReportCandidate[];
}

export interface CanvasControlInsertReportEntry {
  family: 'classic' | 'modern';
  name: string;
  docPath: string;
  status: string[];
  outcome: CanvasControlInsertReportOutcome;
  strategy: string;
  attempts: CanvasControlInsertReportAttempt[];
  waitProfile?: CanvasControlInsertWaitProfile;
  chosenCandidate?: CanvasControlInsertReportCandidate;
  error?: string;
}

export interface CanvasControlInsertReportDocument {
  schemaVersion: 1;
  generatedAt: string;
  catalogPath: string;
  catalogGeneratedAt?: string;
  catalogCounts?: CanvasControlCatalogCounts;
  selection?: CanvasControlCatalogSelectionSummary;
  selectionCheckpoint?: CanvasControlCatalogSelectionCheckpoint;
  resumedFromReportPath?: string;
  fixtureContainerName: string;
  entries: CanvasControlInsertReportEntry[];
  totals: {
    attempted: number;
    inserted: number;
    covered: number;
    notFound: number;
    failed: number;
  };
}

export type CanvasHarvestFixtureControlStatus = 'resolved' | 'prototype-missing' | 'registry-missing';

export interface CanvasHarvestFixtureInsertObservation {
  generatedAt: string;
  outcome: CanvasControlInsertReportOutcome;
  strategy: string;
  attemptedQueries: string[];
  chosenCandidate?: CanvasControlInsertReportCandidate;
  error?: string;
}

export interface CanvasHarvestFixturePlanEntry {
  family: 'classic' | 'modern';
  catalogName: string;
  description: string;
  docPath: string;
  learnUrl: string;
  catalogStatus: string[];
  suggestedInsertQueries: string[];
  status: CanvasHarvestFixtureControlStatus;
  reason: string;
  fixtureConstructor?: string;
  templateName?: string;
  templateVersion?: string;
  prototypeSuggestions?: CanvasHarvestFixturePrototypeSuggestion[];
  notes: string[];
  latestInsertObservation?: CanvasHarvestFixtureInsertObservation;
}

export interface CanvasHarvestFixturePrototypeSuggestion {
  matchType: CanvasTemplateMatchType;
  templateName: string;
  templateVersion: string;
  constructor?: string;
}

export type CanvasHarvestFixturePrototypeValidationPlanAlignment = 'aligned' | 'stale' | 'prototype-only';

export interface CanvasHarvestFixtureCatalogSummary {
  path?: string;
  generatedAt?: string;
  counts: CanvasControlCatalogCounts;
}

export type CanvasHarvestFixtureInsertReportAlignment = 'same-snapshot' | 'same-controls' | 'partial' | 'mismatch';

export interface CanvasHarvestFixtureInsertReportSummary {
  path?: string;
  generatedAt: string;
  entryCount: number;
  totals: CanvasControlInsertReportDocument['totals'];
  catalog: CanvasHarvestFixtureCatalogSummary;
  matchedControlCount: number;
  unmatchedCatalogControlCount: number;
  unmatchedReportEntryCount: number;
  alignment: CanvasHarvestFixtureInsertReportAlignment;
  notes: string[];
}

export interface CanvasHarvestFixturePlan {
  schemaVersion: 1;
  generatedAt: string;
  catalogGeneratedAt?: string;
  registryGeneratedAt?: string;
  prototypeGeneratedAt?: string;
  catalogCounts: CanvasControlCatalogCounts;
  registryTemplateCount: number;
  prototypeCount: number;
  counts: {
    catalogControls: number;
    resolvedControls: number;
    prototypeMissingControls: number;
    registryMissingControls: number;
  };
  insertReportSummary?: CanvasHarvestFixtureInsertReportSummary;
  controls: CanvasHarvestFixturePlanEntry[];
}

export interface CanvasHarvestFixturePrototypeDraftSkippedControl {
  family: 'classic' | 'modern';
  catalogName: string;
  status: CanvasHarvestFixtureControlStatus;
  reason: string;
  suggestedInsertQueries: string[];
  prototypeSuggestions?: CanvasHarvestFixturePrototypeSuggestion[];
  latestInsertObservation?: CanvasHarvestFixtureInsertObservation;
  notes?: string[];
}

export type CanvasHarvestFixturePrototypeDraftSkippedPropertyReason = 'non-portable-formula';

export interface CanvasHarvestFixturePrototypeDraftSkippedProperty {
  propertyName: string;
  script: string;
  reason: CanvasHarvestFixturePrototypeDraftSkippedPropertyReason;
}

export interface CanvasHarvestFixturePrototypeDraftEntry {
  family: 'classic' | 'modern';
  catalogName: string;
  constructor: string;
  variant?: string;
  properties?: Record<string, string>;
  scaffoldProperties?: Record<string, string>;
  skippedPropertyScaffolds?: CanvasHarvestFixturePrototypeDraftSkippedProperty[];
  notes?: string[];
  suggestedInsertQueries: string[];
  suggestion: CanvasHarvestFixturePrototypeSuggestion & { constructor: string };
  latestInsertObservation?: CanvasHarvestFixtureInsertObservation;
}

export interface CanvasHarvestFixturePrototypeDraftDocument {
  schemaVersion: 1;
  generatedAt: string;
  sourcePlanGeneratedAt: string;
  sourcePrototypeGeneratedAt?: string;
  counts: {
    draftControls: number;
    skippedControls: number;
  };
  drafts: CanvasHarvestFixturePrototypeDraftEntry[];
  skipped: CanvasHarvestFixturePrototypeDraftSkippedControl[];
}

export interface MergeCanvasHarvestFixturePrototypeDraftDocumentResult {
  drafts: CanvasHarvestFixturePrototypeDraftDocument;
  preservedEntries: number;
  preservedVariantEntries: number;
  preservedPropertyKeys: number;
  preservedNotesEntries: number;
  preservedSkippedNotesEntries: number;
}

export interface CanvasHarvestFixturePrototypeValidationBacklogEntry {
  family: 'classic' | 'modern';
  catalogName: string;
  constructor: string;
  suggestedInsertQueries: string[];
  validationStatus: CanvasHarvestFixturePrototypeValidationStatus;
  liveValidation?: CanvasHarvestFixturePrototypeValidationRecord;
  planAlignment: CanvasHarvestFixturePrototypeValidationPlanAlignment;
  planStatus?: CanvasHarvestFixtureControlStatus;
  planReason?: string;
  templateName?: string;
  templateVersion?: string;
  latestInsertObservation?: CanvasHarvestFixtureInsertObservation;
  prototypeNotes: string[];
  notes: string[];
}

export interface CanvasHarvestFixturePrototypeValidationBacklogDocument {
  schemaVersion: 1;
  generatedAt: string;
  sourcePlanGeneratedAt: string;
  sourcePrototypeGeneratedAt?: string;
  sourceRegistryGeneratedAt?: string;
  counts: {
    prototypeControls: number;
    validatedControls: number;
    pendingValidationControls: number;
    failedValidationControls: number;
    unknownValidationControls: number;
    alignedPlanControls: number;
    stalePlanControls: number;
    prototypeOnlyControls: number;
    registryMissingControls: number;
  };
  controls: CanvasHarvestFixturePrototypeValidationBacklogEntry[];
}

export interface CanvasHarvestPrototypeValidationFixtureSelectionEntry {
  family: 'classic' | 'modern';
  catalogName: string;
  constructor: string;
  validationStatus: CanvasHarvestFixturePrototypeValidationStatus;
  planAlignment: CanvasHarvestFixturePrototypeValidationPlanAlignment;
  templateName: string;
  templateVersion: string;
  suggestedInsertQueries: string[];
  latestInsertObservation?: CanvasHarvestFixtureInsertObservation;
  liveValidation?: CanvasHarvestFixturePrototypeValidationRecord;
}

export interface CanvasHarvestPrototypeValidationFixtureSkippedEntry {
  family: 'classic' | 'modern';
  catalogName: string;
  constructor: string;
  validationStatus: CanvasHarvestFixturePrototypeValidationStatus;
  planAlignment: CanvasHarvestFixturePrototypeValidationPlanAlignment;
  reason: string;
}

export interface CanvasHarvestPrototypeValidationFixtureDocumentPaths {
  backlog?: string;
  registry?: string;
  prototypes?: string;
  yaml?: string;
}

export interface CanvasHarvestPrototypeValidationFixtureDocument {
  schemaVersion: 1;
  generatedAt: string;
  sourceBacklogGeneratedAt: string;
  sourcePrototypeGeneratedAt?: string;
  sourceRegistryGeneratedAt?: string;
  filters: {
    statuses: CanvasHarvestFixturePrototypeValidationStatus[];
    family?: 'classic' | 'modern';
    limit?: number;
  };
  counts: {
    selectedControls: number;
    skippedControls: number;
    renderedControls: number;
    pendingMarkers: number;
  };
  paths?: CanvasHarvestPrototypeValidationFixtureDocumentPaths;
  selectedControls: CanvasHarvestPrototypeValidationFixtureSelectionEntry[];
  skippedControls: CanvasHarvestPrototypeValidationFixtureSkippedEntry[];
}

export interface AssertCanvasHarvestFixtureCatalogWriteOptions {
  catalog: CanvasControlCatalogDocument;
  catalogPath: string;
  planPath: string;
  yamlPath: string;
  trackedPlanPath: string;
  trackedYamlPath: string;
  allowIncompleteCatalog?: boolean;
}

export interface BuildCanvasHarvestFixturePlanOptions {
  catalog: CanvasControlCatalogDocument;
  catalogPath?: string;
  registry: CanvasTemplateRegistryDocument;
  prototypes: CanvasHarvestFixturePrototypeDocument;
  insertReport?: CanvasControlInsertReportDocument;
  insertReportPath?: string;
  generatedAt?: string;
}

export interface BuildCanvasControlInsertWaitProfileOptions {
  baseSettleMs?: number;
}

export interface BuildCanvasHarvestFixturePrototypeDraftDocumentOptions {
  plan: CanvasHarvestFixturePlan;
  registry: CanvasTemplateRegistryDocument;
  prototypes: CanvasHarvestFixturePrototypeDocument;
  generatedAt?: string;
}

export interface BuildCanvasHarvestFixturePrototypeValidationBacklogDocumentOptions {
  plan: CanvasHarvestFixturePlan;
  registry: CanvasTemplateRegistryDocument;
  prototypes: CanvasHarvestFixturePrototypeDocument;
  generatedAt?: string;
}

export interface BuildCanvasHarvestFixturePrototypePromotionBatchDocumentOptions {
  drafts: CanvasHarvestFixturePrototypeDraftDocument;
  family?: 'classic' | 'modern';
  startAt?: string;
  limit?: number;
  promotions?: CanvasHarvestFixturePrototypePromotion[];
  generatedAt?: string;
  notes?: string[];
  paths?: CanvasHarvestFixturePrototypePromotionBatchDocumentPaths;
}

export interface BuildCanvasHarvestFixturePrototypeValidationBatchDocumentOptions {
  selection: CanvasHarvestPrototypeValidationFixtureDocument;
  family?: 'classic' | 'modern';
  startAt?: string;
  limit?: number;
  updates?: CanvasHarvestFixturePrototypeValidationBatchSelectionUpdate[];
  status?: CanvasHarvestFixtureRecordedPrototypeValidationStatus;
  method?: string;
  generatedAt?: string;
  notes?: string[];
  paths?: CanvasHarvestFixturePrototypeValidationBatchDocumentPaths;
}

export interface PromoteCanvasHarvestFixturePrototypeDraftOptions {
  drafts: CanvasHarvestFixturePrototypeDraftDocument;
  registry: CanvasTemplateRegistryDocument;
  prototypes: CanvasHarvestFixturePrototypeDocument;
  family: 'classic' | 'modern';
  catalogName: string;
  generatedAt?: string;
  notes?: string[];
}

export interface CanvasHarvestFixturePrototypePromotion {
  family: 'classic' | 'modern';
  catalogName: string;
  notes?: string[];
}

export interface CanvasHarvestFixturePrototypePromotionBatchEntryDraftContext {
  constructor: string;
  matchType: CanvasTemplateMatchType;
  templateName: string;
  templateVersion: string;
  propertyKeys: string[];
  suggestedInsertQueries: string[];
  skippedPropertyScaffolds?: CanvasHarvestFixturePrototypeDraftSkippedProperty[];
  latestInsertObservation?: CanvasHarvestFixtureInsertObservation;
}

export interface CanvasHarvestFixturePrototypePromotionBatchEntry extends CanvasHarvestFixturePrototypePromotion {
  draft?: CanvasHarvestFixturePrototypePromotionBatchEntryDraftContext;
}

export interface CanvasHarvestFixturePrototypePromotionBatchDocumentPaths {
  drafts?: string;
}

export interface CanvasHarvestFixturePrototypePromotionBatchDocument {
  schemaVersion: 1;
  generatedAt?: string;
  sourceDraftGeneratedAt?: string;
  paths?: CanvasHarvestFixturePrototypePromotionBatchDocumentPaths;
  selection?: CanvasHarvestFixturePrototypePromotionBatchSelectionSummary;
  entries: CanvasHarvestFixturePrototypePromotionBatchEntry[];
}

export interface MergeCanvasHarvestFixturePrototypePromotionBatchDocumentResult {
  batch: CanvasHarvestFixturePrototypePromotionBatchDocument;
  preservedEntries: number;
  preservedNotesEntries: number;
}

export type CanvasHarvestFixturePrototypePromotionBatchSelectionMode = 'all' | 'window' | 'explicit';

export interface CanvasHarvestFixturePrototypePromotionBatchSelectionSummary {
  mode: CanvasHarvestFixturePrototypePromotionBatchSelectionMode;
  family?: 'classic' | 'modern';
  startAt?: string;
  startIndex: number;
  limit?: number;
  matchingDrafts: number;
  selectedDrafts: number;
  skippedDrafts: number;
  firstSelectedControl?: string;
  lastSelectedControl?: string;
  requestedPromotions?: Array<Pick<CanvasHarvestFixturePrototypePromotion, 'family' | 'catalogName'>>;
}

export interface PromotedCanvasHarvestFixturePrototypeDraftResult {
  promoted: CanvasHarvestFixturePrototype;
  resolvedTemplate: Pick<CanvasTemplateRecord, 'templateName' | 'templateVersion'>;
  prototypes: CanvasHarvestFixturePrototypeDocument;
}

export interface PromoteCanvasHarvestFixturePrototypeDraftsOptions {
  drafts: CanvasHarvestFixturePrototypeDraftDocument;
  registry: CanvasTemplateRegistryDocument;
  prototypes: CanvasHarvestFixturePrototypeDocument;
  promotions: CanvasHarvestFixturePrototypePromotion[];
  generatedAt?: string;
  refresh?: Omit<RefreshCanvasHarvestPrototypeValidationArtifactsOptions, 'generatedAt' | 'prototypes'>;
}

export interface PromotedCanvasHarvestFixturePrototypeDraftUpdate {
  promotion: CanvasHarvestFixturePrototypePromotion;
  promoted: CanvasHarvestFixturePrototype;
  resolvedTemplate: Pick<CanvasTemplateRecord, 'templateName' | 'templateVersion'>;
}

export interface PromotedCanvasHarvestFixturePrototypeDraftsResult {
  updates: PromotedCanvasHarvestFixturePrototypeDraftUpdate[];
  prototypes: CanvasHarvestFixturePrototypeDocument;
  refresh?: RefreshedCanvasHarvestPrototypeValidationArtifacts;
}

export interface CanvasHarvestFixturePrototypeValidationUpdate {
  family: 'classic' | 'modern';
  catalogName: string;
  status: CanvasHarvestFixtureRecordedPrototypeValidationStatus;
  recordedAt?: string;
  method?: string;
  notes?: string[];
}

export interface CanvasHarvestFixturePrototypeValidationBatchEntrySelectionContext {
  status: CanvasHarvestFixturePrototypeValidationStatus;
  constructor: string;
  planAlignment: CanvasHarvestFixturePrototypeValidationPlanAlignment;
  templateName: string;
  templateVersion: string;
  suggestedInsertQueries: string[];
  latestInsertObservation?: CanvasHarvestFixtureInsertObservation;
  liveValidation?: CanvasHarvestFixturePrototypeValidationRecord;
}

export interface CanvasHarvestFixturePrototypeValidationBatchEntry extends CanvasHarvestFixturePrototypeValidationUpdate {
  selection?: CanvasHarvestFixturePrototypeValidationBatchEntrySelectionContext;
}

export interface CanvasHarvestFixturePrototypeValidationBatchDocument {
  schemaVersion: 1;
  generatedAt?: string;
  sourceSelectionGeneratedAt?: string;
  paths?: CanvasHarvestFixturePrototypeValidationBatchDocumentPaths;
  selection?: CanvasHarvestFixturePrototypeValidationBatchSelectionSummary;
  entries: CanvasHarvestFixturePrototypeValidationBatchEntry[];
}

export interface MergeCanvasHarvestFixturePrototypeValidationBatchDocumentResult {
  batch: CanvasHarvestFixturePrototypeValidationBatchDocument;
  preservedEntries: number;
  preservedStatuses: number;
  preservedRecordedAt: number;
  preservedMethods: number;
  preservedNotesEntries: number;
}

export type CanvasHarvestFixturePrototypeValidationBatchSelectionMode = 'all' | 'window' | 'explicit';

export interface CanvasHarvestFixturePrototypeValidationBatchSelectionUpdate {
  family: 'classic' | 'modern';
  catalogName: string;
  status?: CanvasHarvestFixtureRecordedPrototypeValidationStatus;
  method?: string;
  notes?: string[];
}

export interface CanvasHarvestFixturePrototypeValidationBatchSelectionSummary {
  mode: CanvasHarvestFixturePrototypeValidationBatchSelectionMode;
  family?: 'classic' | 'modern';
  startAt?: string;
  startIndex: number;
  limit?: number;
  matchingControls: number;
  selectedControls: number;
  skippedControls: number;
  firstSelectedControl?: string;
  lastSelectedControl?: string;
  requestedUpdates?: Array<Pick<CanvasHarvestFixturePrototypeValidationBatchSelectionUpdate, 'family' | 'catalogName'>>;
}

export interface CanvasHarvestFixturePrototypeValidationBatchDocumentPaths {
  selection?: string;
}

export interface RecordCanvasHarvestFixturePrototypeValidationOptions
  extends CanvasHarvestFixturePrototypeValidationUpdate {
  prototypes: CanvasHarvestFixturePrototypeDocument;
  generatedAt?: string;
  refresh?: Omit<RefreshCanvasHarvestPrototypeValidationArtifactsOptions, 'generatedAt' | 'prototypes'>;
}

export interface RecordCanvasHarvestFixturePrototypeValidationsOptions {
  prototypes: CanvasHarvestFixturePrototypeDocument;
  updates: CanvasHarvestFixturePrototypeValidationUpdate[];
  generatedAt?: string;
  refresh?: Omit<RefreshCanvasHarvestPrototypeValidationArtifactsOptions, 'generatedAt' | 'prototypes'>;
}

export interface RecordedCanvasHarvestFixturePrototypeValidationResult {
  prototype: CanvasHarvestFixturePrototype;
  prototypes: CanvasHarvestFixturePrototypeDocument;
  refresh?: RefreshedCanvasHarvestPrototypeValidationArtifacts;
}

export interface RecordedCanvasHarvestFixturePrototypeValidationUpdate {
  update: CanvasHarvestFixturePrototypeValidationUpdate & { recordedAt: string };
  prototype: CanvasHarvestFixturePrototype;
}

export interface RecordedCanvasHarvestFixturePrototypeValidationsResult {
  updates: RecordedCanvasHarvestFixturePrototypeValidationUpdate[];
  prototypes: CanvasHarvestFixturePrototypeDocument;
  refresh?: RefreshedCanvasHarvestPrototypeValidationArtifacts;
}

export interface RenderCanvasHarvestFixtureOptions {
  plan: CanvasHarvestFixturePlan;
  registry: CanvasTemplateRegistryDocument;
  prototypes: CanvasHarvestFixturePrototypeDocument;
  containerName?: string;
  containerConstructor?: string;
  containerVariant?: string;
  containerX?: number;
  containerY?: number;
  columns?: number;
  cellWidth?: number;
  cellHeight?: number;
  gutterX?: number;
  gutterY?: number;
  paddingX?: number;
  paddingY?: number;
  includePendingMarkers?: boolean;
  markerConstructor?: string;
}

export interface RenderCanvasHarvestPrototypeValidationFixtureOptions
  extends Omit<RenderCanvasHarvestFixtureOptions, 'plan'> {
  backlog: CanvasHarvestFixturePrototypeValidationBacklogDocument;
  statuses?: CanvasHarvestFixturePrototypeValidationStatus[];
  family?: 'classic' | 'modern';
  limit?: number;
  allowEmpty?: boolean;
}

export interface BuildCanvasHarvestPrototypeValidationFixtureDocumentOptions {
  backlog: CanvasHarvestFixturePrototypeValidationBacklogDocument;
  rendered: RenderedCanvasHarvestPrototypeValidationFixture;
  statuses?: CanvasHarvestFixturePrototypeValidationStatus[];
  family?: 'classic' | 'modern';
  limit?: number;
  generatedAt?: string;
  paths?: CanvasHarvestPrototypeValidationFixtureDocumentPaths;
}

export interface RenderedCanvasHarvestFixture {
  yaml: string;
  renderedControlCount: number;
  pendingMarkerCount: number;
  containerTemplateName: string;
  containerTemplateVersion: string;
  markerTemplateName?: string;
  markerTemplateVersion?: string;
}

export interface RenderedCanvasHarvestPrototypeValidationFixture extends RenderedCanvasHarvestFixture {
  selectedControls: CanvasHarvestPrototypeValidationFixtureSelectionEntry[];
  skippedControls: CanvasHarvestPrototypeValidationFixtureSkippedEntry[];
}

export interface RefreshCanvasHarvestPrototypeValidationArtifactsOptions
  extends Omit<RenderCanvasHarvestPrototypeValidationFixtureOptions, 'backlog' | 'registry' | 'prototypes'> {
  plan: CanvasHarvestFixturePlan;
  registry: CanvasTemplateRegistryDocument;
  prototypes: CanvasHarvestFixturePrototypeDocument;
  generatedAt?: string;
  paths?: CanvasHarvestPrototypeValidationFixtureDocumentPaths;
}

export interface RefreshedCanvasHarvestPrototypeValidationArtifacts {
  backlog: CanvasHarvestFixturePrototypeValidationBacklogDocument;
  rendered: RenderedCanvasHarvestPrototypeValidationFixture;
  selection: CanvasHarvestPrototypeValidationFixtureDocument;
}

export const DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH = 'fixtures/canvas-harvest/generated/fixture-plan.json';
export const DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH =
  'fixtures/canvas-harvest/generated/HarvestFixtureContainer.pa.yaml';
export const DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BACKLOG_PATH =
  'fixtures/canvas-harvest/generated/prototype-validation-backlog.json';
export const DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_YAML_PATH =
  'fixtures/canvas-harvest/generated/prototype-validation/HarvestFixtureContainer.pa.yaml';
export const DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_SELECTION_PATH =
  'fixtures/canvas-harvest/generated/prototype-validation/fixture-selection.json';
export const DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BATCH_PATH =
  'fixtures/canvas-harvest/generated/prototype-validation/batch.json';

const CONTROL_SEARCH_ALIASES: Record<string, string[]> = {
  'classic:gallery': ['Vertical gallery'],
  'classic:label': ['Text label'],
  'classic:shape': ['Rectangle'],
  'classic:streamvideo': ['Video'],
  'classic:webbarcodescanner': ['Barcode reader'],
  'modern:infobutton': ['Information button'],
  'modern:radiogroup': ['Radio'],
  'modern:tabsortablist': ['Tab list'],
};

const CONTROL_PROTOTYPE_MATCH_ALIASES: Record<string, string[]> = {
  'classic:container': ['GroupContainer'],
  'classic:gridcontainer': ['GroupContainer'],
  'classic:horizontalcontainer': ['GroupContainer'],
  'classic:verticalcontainer': ['GroupContainer'],
};

const COMPLEX_INSERT_WAIT_KEYWORDS = [
  'attachment',
  'barcode',
  'camera',
  'chart',
  'combo',
  'copilot',
  'date',
  'form',
  'gallery',
  'list',
  'map',
  'microphone',
  'pdf',
  'people',
  'pen',
  'picker',
  'scanner',
  'tab',
  'table',
  'timer',
  'video',
] as const;

const CONTEXTUAL_INSERT_WAIT_KEYWORDS = ['card', 'container', 'form', 'gallery', 'list', 'tab', 'table'] as const;

export function assertCanvasHarvestFixtureCatalogCanWriteOutputs(
  options: AssertCanvasHarvestFixtureCatalogWriteOptions
): void {
  if (options.allowIncompleteCatalog || !writesTrackedCanvasHarvestFixtureOutput(options)) {
    return;
  }

  try {
    assertCanvasControlCatalogLooksComplete(options.catalog, {
      context: `Canvas harvest fixture catalog (${options.catalogPath})`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message} Refusing to overwrite tracked harvest fixture outputs (${options.trackedPlanPath}, ${options.trackedYamlPath}). ` +
        'Write to alternate --plan-out/--yaml-out paths for subset or investigative runs, or pass --allow-incomplete-catalog if the shrink is intentional.'
    );
  }
}

export function buildCanvasHarvestFixturePlan(options: BuildCanvasHarvestFixturePlanOptions): CanvasHarvestFixturePlan {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const catalogCounts = options.catalog.counts ?? summarizeCanvasControlCatalogDocument(options.catalog);
  const prototypesByKey = new Map(
    options.prototypes.prototypes.map((prototype) => [makeCatalogKey(prototype.family, prototype.catalogName), prototype] as const)
  );
  const insertObservationsByKey = new Map(
    (options.insertReport?.entries ?? []).map((entry) => [
      makeCatalogKey(entry.family, entry.name),
      buildInsertObservation(options.insertReport!.generatedAt, entry),
    ])
  );
  const controls = options.catalog.controls.map((control) => {
    const prototype = prototypesByKey.get(makeCatalogKey(control.family, control.name));
    const latestInsertObservation = insertObservationsByKey.get(makeCatalogKey(control.family, control.name));
    const suggestedInsertQueries = buildCanvasControlSearchTerms(control);
    const prototypeSuggestions = buildPrototypeSuggestions(options.registry, control);
    const notes = [...buildCatalogNotes(control), ...buildInsertObservationNotes(latestInsertObservation)];

    if (!prototype) {
      return {
        family: control.family,
        catalogName: control.name,
        description: control.description,
        docPath: control.docPath,
        learnUrl: control.learnUrl,
        catalogStatus: control.status,
        suggestedInsertQueries,
        status: 'prototype-missing',
        reason: 'No paste-ready fixture prototype is pinned for this catalog control yet.',
        notes: [...notes, ...buildPrototypeSuggestionNotes(prototypeSuggestions)],
        ...(prototypeSuggestions.length > 0 ? { prototypeSuggestions } : {}),
        ...(latestInsertObservation ? { latestInsertObservation } : {}),
      } satisfies CanvasHarvestFixturePlanEntry;
    }

    const resolvedTemplate = resolveTemplateForConstructor(options.registry, prototype.constructor);
    if (!resolvedTemplate) {
      return {
        family: control.family,
        catalogName: control.name,
        description: control.description,
        docPath: control.docPath,
        learnUrl: control.learnUrl,
        catalogStatus: control.status,
        suggestedInsertQueries,
        status: 'registry-missing',
        reason: `Fixture prototype ${prototype.constructor} exists, but the pinned harvested registry does not expose a matching constructor alias yet.`,
        fixtureConstructor: prototype.constructor,
        notes: [...notes, ...(prototype.notes ?? [])],
        ...(latestInsertObservation ? { latestInsertObservation } : {}),
      } satisfies CanvasHarvestFixturePlanEntry;
    }

    return {
      family: control.family,
      catalogName: control.name,
      description: control.description,
      docPath: control.docPath,
      learnUrl: control.learnUrl,
      catalogStatus: control.status,
      suggestedInsertQueries,
      status: 'resolved',
      reason: `Fixture prototype ${prototype.constructor} resolves to ${resolvedTemplate.templateName}@${resolvedTemplate.templateVersion}.`,
      fixtureConstructor: prototype.constructor,
      templateName: resolvedTemplate.templateName,
      templateVersion: resolvedTemplate.templateVersion,
      notes: [...notes, ...(prototype.notes ?? [])],
      ...(latestInsertObservation ? { latestInsertObservation } : {}),
    } satisfies CanvasHarvestFixturePlanEntry;
  });

  return {
    schemaVersion: 1,
    generatedAt,
    catalogGeneratedAt: options.catalog.generatedAt,
    registryGeneratedAt: options.registry.generatedAt,
    prototypeGeneratedAt: options.prototypes.generatedAt,
    catalogCounts,
    registryTemplateCount: options.registry.templates.length,
    prototypeCount: options.prototypes.prototypes.length,
    counts: {
      catalogControls: controls.length,
      resolvedControls: controls.filter((control) => control.status === 'resolved').length,
      prototypeMissingControls: controls.filter((control) => control.status === 'prototype-missing').length,
      registryMissingControls: controls.filter((control) => control.status === 'registry-missing').length,
    },
    ...(options.insertReport
      ? {
          insertReportSummary: summarizeInsertReport({
            catalog: options.catalog,
            catalogPath: options.catalogPath,
            insertReport: options.insertReport,
            insertReportPath: options.insertReportPath,
          }),
        }
      : {}),
    controls,
  };
}

export function buildCanvasControlSearchTerms(entry: Pick<CanvasControlCatalogEntry, 'family' | 'name'>): string[] {
  const key = makeCatalogKey(entry.family, entry.name);
  const aliases = CONTROL_SEARCH_ALIASES[key] ?? [];
  const terms = [entry.name, ...aliases];

  if (entry.name.includes(' or ')) {
    terms.push(...entry.name.split(/\s+or\s+/i).map((value) => value.trim()));
  }

  return dedupeSearchTerms(terms.filter((value) => value.length > 0));
}

export function buildCanvasControlInsertWaitProfile(
  entry: Pick<CanvasControlCatalogEntry, 'family' | 'name' | 'status'>,
  options: BuildCanvasControlInsertWaitProfileOptions = {}
): CanvasControlInsertWaitProfile {
  const normalizedName = normalizeLabel(entry.name);
  const normalizedStatus = entry.status.map((value) => normalizeLabel(value));
  const baseSettleMs = Math.max(options.baseSettleMs ?? 4000, 1000);
  const isModernFamily = entry.family === 'modern';
  const hasPreviewStatus = normalizedStatus.some((value) => value.includes('preview'));
  const hasComplexName = COMPLEX_INSERT_WAIT_KEYWORDS.some((keyword) => normalizedName.includes(keyword));
  const hasContextualHost = CONTEXTUAL_INSERT_WAIT_KEYWORDS.some((keyword) => normalizedName.includes(keyword));
  const reasons: string[] = [];

  if (isModernFamily) {
    reasons.push('modern-family');
  }
  if (hasPreviewStatus) {
    reasons.push('preview-status');
  }
  if (hasComplexName) {
    reasons.push('complex-name');
  }
  if (hasContextualHost) {
    reasons.push('contextual-host');
  }

  const tier: CanvasControlInsertWaitProfileTier = hasContextualHost || hasPreviewStatus || (isModernFamily && hasComplexName)
    ? 'heavy'
    : isModernFamily
      ? 'modern'
      : hasComplexName
        ? 'complex'
        : 'standard';

  switch (tier) {
    case 'modern':
      return {
        tier,
        searchSettleMs: 1000,
        searchStablePasses: 2,
        postInsertSettleMs: Math.max(baseSettleMs + 1000, 5000),
        readyPollMs: 750,
        readyTimeoutMs: Math.max(baseSettleMs * 3, 12000),
        reasons,
      };
    case 'complex':
      return {
        tier,
        searchSettleMs: 1200,
        searchStablePasses: 3,
        postInsertSettleMs: Math.max(baseSettleMs + 2000, 6000),
        readyPollMs: 750,
        readyTimeoutMs: Math.max(baseSettleMs * 3, 12000),
        reasons,
      };
    case 'heavy':
      return {
        tier,
        searchSettleMs: 1600,
        searchStablePasses: 3,
        postInsertSettleMs: Math.max(baseSettleMs + 4000, 8000),
        readyPollMs: 1000,
        readyTimeoutMs: Math.max(baseSettleMs * 4, 16000),
        reasons,
      };
    case 'standard':
    default:
      return {
        tier: 'standard',
        searchSettleMs: 800,
        searchStablePasses: 2,
        postInsertSettleMs: Math.max(baseSettleMs, 4000),
        readyPollMs: 500,
        readyTimeoutMs: Math.max(baseSettleMs * 2, 8000),
        reasons,
      };
  }
}

export function resolveCanvasControlInsertReportResumeSelection(
  catalog: CanvasControlCatalogDocument,
  insertReport: CanvasControlInsertReportDocument
): CanvasControlCatalogResumeSelection {
  const checkpoint =
    insertReport.selectionCheckpoint ??
    (insertReport.selection ? buildCanvasControlCatalogSelectionCheckpoint(catalog, insertReport.selection) : undefined);

  if (!checkpoint) {
    throw new Error(
      'Insert report does not include selection metadata. Pass --catalog-start-at manually or regenerate the report with the current chunk-selection tooling.'
    );
  }

  if (!checkpoint.resumeSelection || !checkpoint.nextControl || checkpoint.remainingControls < 1) {
    throw new Error('Insert report does not have a remaining catalog chunk to resume.');
  }

  return checkpoint.resumeSelection;
}

export function buildCanvasHarvestFixturePrototypeDraftDocument(
  options: BuildCanvasHarvestFixturePrototypeDraftDocumentOptions
): CanvasHarvestFixturePrototypeDraftDocument {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const existingPrototypeKeys = new Set(
    options.prototypes.prototypes.map((prototype) => makeCatalogKey(prototype.family, prototype.catalogName))
  );
  const drafts: CanvasHarvestFixturePrototypeDraftEntry[] = [];
  const skipped: CanvasHarvestFixturePrototypeDraftSkippedControl[] = [];

  for (const control of options.plan.controls) {
    if (control.status !== 'prototype-missing') {
      continue;
    }

    const key = makeCatalogKey(control.family, control.catalogName);
    const controlLookup = {
      family: control.family,
      name: control.catalogName,
    } satisfies Pick<CanvasControlCatalogEntry, 'family' | 'name'>;
    const suggestedInsertQueries = control.suggestedInsertQueries ?? buildCanvasControlSearchTerms(controlLookup);
    const prototypeSuggestions =
      control.prototypeSuggestions && control.prototypeSuggestions.length > 0
        ? control.prototypeSuggestions
        : buildPrototypeSuggestions(options.registry, controlLookup);

    if (existingPrototypeKeys.has(key)) {
      skipped.push({
        family: control.family,
        catalogName: control.catalogName,
        status: control.status,
        reason: 'A pinned fixture prototype already exists for this control.',
        suggestedInsertQueries,
        ...(prototypeSuggestions.length > 0 ? { prototypeSuggestions } : {}),
        ...(control.latestInsertObservation
          ? {
              latestInsertObservation: control.latestInsertObservation,
            }
          : {}),
      });
      continue;
    }

    const selectedSuggestion = prototypeSuggestions.find((suggestion) => suggestion.constructor);
    if (!selectedSuggestion?.constructor) {
      skipped.push({
        family: control.family,
        catalogName: control.catalogName,
        status: control.status,
        reason: 'The pinned harvested registry does not expose a constructor-backed prototype suggestion for this control yet.',
        suggestedInsertQueries,
        ...(prototypeSuggestions.length > 0 ? { prototypeSuggestions } : {}),
        ...(control.latestInsertObservation
          ? {
              latestInsertObservation: control.latestInsertObservation,
            }
          : {}),
      });
      continue;
    }

    const draftPropertyScaffold = buildPrototypeDraftPropertyScaffold(options.registry, selectedSuggestion);
    drafts.push({
      family: control.family,
      catalogName: control.catalogName,
      constructor: selectedSuggestion.constructor,
      suggestedInsertQueries,
      suggestion: {
        ...selectedSuggestion,
        constructor: selectedSuggestion.constructor,
      },
      ...(control.latestInsertObservation
        ? {
            latestInsertObservation: control.latestInsertObservation,
          }
        : {}),
      ...(draftPropertyScaffold.properties ? { properties: draftPropertyScaffold.properties } : {}),
      ...(draftPropertyScaffold.properties ? { scaffoldProperties: draftPropertyScaffold.properties } : {}),
      ...(draftPropertyScaffold.skippedPropertyScaffolds
        ? {
            skippedPropertyScaffolds: draftPropertyScaffold.skippedPropertyScaffolds,
          }
        : {}),
      notes: buildPrototypeDraftNotes({
        control,
        suggestion: selectedSuggestion,
        planGeneratedAt: options.plan.generatedAt,
        suggestedInsertQueries,
        draftProperties: draftPropertyScaffold.properties,
        skippedPropertyScaffolds: draftPropertyScaffold.skippedPropertyScaffolds,
      }),
    });
  }

  return {
    schemaVersion: 1,
    generatedAt,
    sourcePlanGeneratedAt: options.plan.generatedAt,
    sourcePrototypeGeneratedAt: options.prototypes.generatedAt,
    counts: {
      draftControls: drafts.length,
      skippedControls: skipped.length,
    },
    drafts,
    skipped,
  };
}

export function mergeCanvasHarvestFixturePrototypeDraftDocument(
  drafts: CanvasHarvestFixturePrototypeDraftDocument,
  existing: CanvasHarvestFixturePrototypeDraftDocument
): MergeCanvasHarvestFixturePrototypeDraftDocumentResult {
  const existingByKey = new Map(
    existing.drafts.map((entry) => [makeCatalogKey(entry.family, entry.catalogName), entry] as const)
  );
  const existingSkippedByKey = new Map(
    existing.skipped.map((entry) => [makeCatalogKey(entry.family, entry.catalogName), entry] as const)
  );
  let preservedEntries = 0;
  let preservedVariantEntries = 0;
  let preservedPropertyKeys = 0;
  let preservedNotesEntries = 0;
  let preservedSkippedNotesEntries = 0;

  const mergedDrafts = drafts.drafts.map((entry) => {
    const existingEntry = existingByKey.get(makeCatalogKey(entry.family, entry.catalogName));
    if (!existingEntry) {
      return entry;
    }

    let changed = false;
    let variant = entry.variant;
    if (existingEntry.variant && existingEntry.variant !== entry.variant) {
      variant = existingEntry.variant;
      preservedVariantEntries += 1;
      changed = true;
    }

    let properties = entry.properties;
    if (existingEntry.properties) {
      const mergedProperties = {
        ...(entry.properties ?? {}),
      };
      const builtScaffoldProperties = entry.scaffoldProperties ?? entry.properties ?? {};
      const existingScaffoldProperties = resolveExistingPrototypeDraftScaffoldProperties(existingEntry);
      const skippedPropertyNames = new Set((entry.skippedPropertyScaffolds ?? []).map((property) => property.propertyName));
      let preservedPropertyCount = 0;

      for (const [propertyName, propertyValue] of Object.entries(existingEntry.properties)) {
        if (skippedPropertyNames.has(propertyName)) {
          continue;
        }

        const builtScaffoldValue = builtScaffoldProperties[propertyName];
        const existingScaffoldValue = existingScaffoldProperties[propertyName];
        const preserveProperty =
          builtScaffoldValue !== undefined ||
          existingScaffoldValue === undefined ||
          existingScaffoldValue !== propertyValue;

        if (!preserveProperty) {
          continue;
        }

        mergedProperties[propertyName] = propertyValue;
        if (entry.properties?.[propertyName] !== propertyValue) {
          preservedPropertyCount += 1;
        }
      }

      if (preservedPropertyCount > 0) {
        properties = mergedProperties;
        preservedPropertyKeys += preservedPropertyCount;
        changed = true;
      } else if (!properties && Object.keys(mergedProperties).length > 0) {
        properties = mergedProperties;
      } else if (Object.keys(mergedProperties).length !== Object.keys(entry.properties ?? {}).length) {
        properties = Object.keys(mergedProperties).length > 0 ? mergedProperties : undefined;
      }
    }

    const draftNotes = entry.notes ?? [];
    const existingNotes = existingEntry.notes ?? [];
    const preservedNotes = existingNotes.filter(
      (note) => !draftNotes.includes(note) && !isGeneratedPrototypeDraftNote(note)
    );
    const notes = dedupeStrings(draftNotes.concat(preservedNotes));
    if (preservedNotes.length > 0) {
      preservedNotesEntries += 1;
      changed = true;
    }

    if (changed) {
      preservedEntries += 1;
    }

    return {
      ...entry,
      ...(variant ? { variant } : {}),
      ...(properties ? { properties } : {}),
      ...(notes.length > 0 ? { notes } : {}),
    };
  });

  const mergedSkipped = drafts.skipped.map((entry) => {
    const existingEntry = existingSkippedByKey.get(makeCatalogKey(entry.family, entry.catalogName));
    if (!existingEntry) {
      return entry;
    }

    const skippedNotes = entry.notes ?? [];
    const existingNotes = existingEntry.notes ?? [];
    const preservedNotes = existingNotes.filter((note) => !skippedNotes.includes(note));
    const notes = dedupeStrings(skippedNotes.concat(existingNotes));

    if (preservedNotes.length > 0) {
      preservedEntries += 1;
      preservedSkippedNotesEntries += 1;
    }

    return {
      ...entry,
      ...(notes.length > 0 ? { notes } : {}),
    };
  });

  return {
    drafts: {
      ...drafts,
      drafts: mergedDrafts,
      skipped: mergedSkipped,
    },
    preservedEntries,
    preservedVariantEntries,
    preservedPropertyKeys,
    preservedNotesEntries,
    preservedSkippedNotesEntries,
  };
}

export function buildCanvasHarvestFixturePrototypePromotionBatchDocument(
  options: BuildCanvasHarvestFixturePrototypePromotionBatchDocumentOptions
): CanvasHarvestFixturePrototypePromotionBatchDocument {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const defaultNotes = dedupeStrings(options.notes ?? []);

  if (options.promotions && options.promotions.length > 0) {
    if (options.family || options.startAt || options.limit) {
      throw new Error(
        'Cannot combine explicit prototype draft promotions with family/start-at/limit selection.'
      );
    }

    const requestedByKey = new Map<string, CanvasHarvestFixturePrototypePromotion>();
    for (const promotion of options.promotions) {
      const key = makeCatalogKey(promotion.family, promotion.catalogName);
      if (requestedByKey.has(key)) {
        throw new Error(
          `Duplicate prototype draft promotion specified for ${familyLabel(promotion.family)}/${promotion.catalogName}.`
        );
      }

      requestedByKey.set(key, promotion);
    }

    const selectedDrafts = options.drafts.drafts.filter((draft) =>
      requestedByKey.has(makeCatalogKey(draft.family, draft.catalogName))
    );

    if (selectedDrafts.length !== requestedByKey.size) {
      const missingPromotion = options.promotions.find(
        (promotion) =>
          !selectedDrafts.some(
            (draft) => makeCatalogKey(draft.family, draft.catalogName) === makeCatalogKey(promotion.family, promotion.catalogName)
          )
      );

      if (missingPromotion) {
        throw buildMissingGeneratedPrototypeDraftError({
          drafts: options.drafts,
          family: missingPromotion.family,
          catalogName: missingPromotion.catalogName,
        });
      }
    }

    const firstSelectedDraft = selectedDrafts[0];
    return {
      schemaVersion: 1,
      generatedAt,
      sourceDraftGeneratedAt: options.drafts.generatedAt,
      ...(options.paths ? { paths: options.paths } : {}),
      selection: {
        mode: 'explicit',
        startIndex: firstSelectedDraft
          ? options.drafts.drafts.findIndex(
              (draft) =>
                makeCatalogKey(draft.family, draft.catalogName) ===
                makeCatalogKey(firstSelectedDraft.family, firstSelectedDraft.catalogName)
            )
          : 0,
        matchingDrafts: options.drafts.drafts.length,
        selectedDrafts: selectedDrafts.length,
        skippedDrafts: Math.max(0, options.drafts.drafts.length - selectedDrafts.length),
        ...(firstSelectedDraft
          ? {
              firstSelectedControl: formatPrototypeDraftLabel(firstSelectedDraft.family, firstSelectedDraft.catalogName),
            }
          : {}),
        ...(selectedDrafts.length > 0
          ? {
              lastSelectedControl: formatPrototypeDraftLabel(
                selectedDrafts[selectedDrafts.length - 1]!.family,
                selectedDrafts[selectedDrafts.length - 1]!.catalogName
              ),
            }
          : {}),
        requestedPromotions: options.promotions.map((promotion) => ({
          family: promotion.family,
          catalogName: promotion.catalogName,
        })),
      },
      entries: selectedDrafts.map((draft) => {
        const key = makeCatalogKey(draft.family, draft.catalogName);
        const requested = requestedByKey.get(key);
        const notes = dedupeStrings(defaultNotes.concat(requested?.notes ?? []));
        return {
          family: draft.family,
          catalogName: draft.catalogName,
          ...(notes.length > 0 ? { notes } : {}),
          draft: {
            constructor: draft.constructor,
            matchType: draft.suggestion.matchType,
            templateName: draft.suggestion.templateName,
            templateVersion: draft.suggestion.templateVersion,
            propertyKeys: Object.keys(draft.properties ?? {}).sort(),
            suggestedInsertQueries: draft.suggestedInsertQueries,
            ...(draft.skippedPropertyScaffolds
              ? {
                  skippedPropertyScaffolds: draft.skippedPropertyScaffolds,
                }
              : {}),
            ...(draft.latestInsertObservation
              ? {
                  latestInsertObservation: draft.latestInsertObservation,
                }
              : {}),
          },
        };
      }),
    };
  }

  const matchingDrafts = options.family
    ? options.drafts.drafts.filter((draft) => draft.family === options.family)
    : [...options.drafts.drafts];
  if (matchingDrafts.length === 0) {
    const familyNote = options.family ? ` for ${familyLabel(options.family)}` : '';
    throw new Error(`No generated prototype drafts are available${familyNote}.`);
  }

  const startIndex = resolvePrototypeDraftBatchStartIndex(matchingDrafts, options.startAt, options.family);
  const boundedLimit = options.limit && options.limit > 0 ? Math.floor(options.limit) : undefined;
  const selectedDrafts = matchingDrafts.slice(startIndex, boundedLimit ? startIndex + boundedLimit : undefined);
  if (selectedDrafts.length === 0) {
    throw new Error('Prototype draft batch selection did not include any drafts.');
  }

  return {
    schemaVersion: 1,
    generatedAt,
    sourceDraftGeneratedAt: options.drafts.generatedAt,
    ...(options.paths ? { paths: options.paths } : {}),
    selection: {
      mode: options.family || options.startAt || boundedLimit ? 'window' : 'all',
      ...(options.family ? { family: options.family } : {}),
      ...(options.startAt ? { startAt: options.startAt } : {}),
      startIndex,
      ...(boundedLimit ? { limit: boundedLimit } : {}),
      matchingDrafts: matchingDrafts.length,
      selectedDrafts: selectedDrafts.length,
      skippedDrafts: Math.max(0, matchingDrafts.length - selectedDrafts.length),
      firstSelectedControl: formatPrototypeDraftLabel(selectedDrafts[0]!.family, selectedDrafts[0]!.catalogName),
      lastSelectedControl: formatPrototypeDraftLabel(
        selectedDrafts[selectedDrafts.length - 1]!.family,
        selectedDrafts[selectedDrafts.length - 1]!.catalogName
      ),
    },
    entries: selectedDrafts.map((draft) => ({
      family: draft.family,
      catalogName: draft.catalogName,
      ...(defaultNotes.length > 0 ? { notes: defaultNotes } : {}),
      draft: {
        constructor: draft.constructor,
        matchType: draft.suggestion.matchType,
        templateName: draft.suggestion.templateName,
        templateVersion: draft.suggestion.templateVersion,
        propertyKeys: Object.keys(draft.properties ?? {}).sort(),
        suggestedInsertQueries: draft.suggestedInsertQueries,
        ...(draft.skippedPropertyScaffolds
          ? {
              skippedPropertyScaffolds: draft.skippedPropertyScaffolds,
            }
          : {}),
        ...(draft.latestInsertObservation
          ? {
              latestInsertObservation: draft.latestInsertObservation,
            }
          : {}),
      },
    })),
  };
}

export function mergeCanvasHarvestFixturePrototypePromotionBatchDocument(
  batch: CanvasHarvestFixturePrototypePromotionBatchDocument,
  existing: CanvasHarvestFixturePrototypePromotionBatchDocument
): MergeCanvasHarvestFixturePrototypePromotionBatchDocumentResult {
  const existingByKey = new Map(
    existing.entries.map((entry) => [makeCatalogKey(entry.family, entry.catalogName), entry] as const)
  );
  let preservedEntries = 0;
  let preservedNotesEntries = 0;

  const entries = batch.entries.map((entry) => {
    const existingEntry = existingByKey.get(makeCatalogKey(entry.family, entry.catalogName));
    if (!existingEntry) {
      return entry;
    }

    const existingNotes = existingEntry.notes ?? [];
    const batchNotes = entry.notes ?? [];
    const preservedNotes = existingNotes.filter((note) => !batchNotes.includes(note));
    const notes = dedupeStrings(batchNotes.concat(existingNotes));

    if (preservedNotes.length > 0) {
      preservedEntries += 1;
      preservedNotesEntries += 1;
    }

    return {
      ...entry,
      ...(notes.length > 0 ? { notes } : {}),
    };
  });

  return {
    batch: {
      ...batch,
      entries,
    },
    preservedEntries,
    preservedNotesEntries,
  };
}

export function resolveCanvasHarvestFixturePrototypeDraftPromotion(
  drafts: CanvasHarvestFixturePrototypeDraftDocument,
  selector: string,
  family?: 'classic' | 'modern'
): Pick<CanvasHarvestFixturePrototypePromotion, 'family' | 'catalogName'> {
  const parsed = parseFamilyQualifiedCatalogSelector(selector, 'Prototype draft');
  if (parsed.family && family && parsed.family !== family) {
    throw new Error(
      `Prototype draft selector ${JSON.stringify(selector)} conflicts with the ${familyLabel(family)} family filter.`
    );
  }

  const matchingDrafts = drafts.drafts.filter((draft) => {
    if ((parsed.family ?? family) && draft.family !== (parsed.family ?? family)) {
      return false;
    }

    return normalizeLabel(draft.catalogName) === normalizeLabel(parsed.catalogName);
  });

  if (matchingDrafts.length === 1) {
    return {
      family: matchingDrafts[0]!.family,
      catalogName: matchingDrafts[0]!.catalogName,
    };
  }

  if (matchingDrafts.length > 1) {
    throw new Error(
      `Prototype draft selector ${JSON.stringify(selector)} is ambiguous. Matching drafts: ${matchingDrafts
        .map((draft) => formatPrototypeDraftLabel(draft.family, draft.catalogName))
        .join(', ')}.`
    );
  }

  if (!parsed.family && !family) {
    throw new Error(`No generated prototype draft matches selector ${JSON.stringify(selector)}.`);
  }

  throw buildMissingGeneratedPrototypeDraftError({
    drafts,
    family: parsed.family ?? family!,
    catalogName: parsed.catalogName,
  });
}

export function resolveCanvasHarvestFixturePrototypeValidationSelectionUpdate(
  selection: CanvasHarvestPrototypeValidationFixtureDocument,
  selector: string,
  family?: 'classic' | 'modern'
): Pick<CanvasHarvestFixturePrototypeValidationBatchSelectionUpdate, 'family' | 'catalogName'> {
  const parsed = parseFamilyQualifiedCatalogSelector(selector, 'Prototype validation');
  if (parsed.family && family && parsed.family !== family) {
    throw new Error(
      `Prototype validation selector ${JSON.stringify(selector)} conflicts with the ${familyLabel(family)} family filter.`
    );
  }

  const matchingControls = selection.selectedControls.filter((control) => {
    if ((parsed.family ?? family) && control.family !== (parsed.family ?? family)) {
      return false;
    }

    return normalizeLabel(control.catalogName) === normalizeLabel(parsed.catalogName);
  });

  if (matchingControls.length === 1) {
    return {
      family: matchingControls[0]!.family,
      catalogName: matchingControls[0]!.catalogName,
    };
  }

  if (matchingControls.length > 1) {
    throw new Error(
      `Prototype validation selector ${JSON.stringify(selector)} is ambiguous. Matching controls: ${matchingControls
        .map((control) => formatPrototypeDraftLabel(control.family, control.catalogName))
        .join(', ')}.`
    );
  }

  if (!parsed.family && !family) {
    throw new Error(`No selected prototype validation control matches selector ${JSON.stringify(selector)}.`);
  }

  throw buildMissingPrototypeValidationSelectionControlError({
    selection,
    family: parsed.family ?? family!,
    catalogName: parsed.catalogName,
  });
}

export function buildCanvasHarvestFixturePrototypeValidationBacklogDocument(
  options: BuildCanvasHarvestFixturePrototypeValidationBacklogDocumentOptions
): CanvasHarvestFixturePrototypeValidationBacklogDocument {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const planByKey = new Map(
    options.plan.controls.map((control) => [makeCatalogKey(control.family, control.catalogName), control] as const)
  );
  const controls = [...options.prototypes.prototypes]
    .map((prototype) => {
      const key = makeCatalogKey(prototype.family, prototype.catalogName);
      const planControl = planByKey.get(key);
      const resolvedTemplate = resolveTemplateForConstructor(options.registry, prototype.constructor);
      const suggestedInsertQueries =
        planControl?.suggestedInsertQueries ??
        buildCanvasControlSearchTerms({
          family: prototype.family,
          name: prototype.catalogName,
        });
      const validationStatus = determinePrototypeValidationStatus(prototype);
      const liveValidation = prototype.liveValidation;
      const planAlignment = determinePrototypeValidationPlanAlignment({
        prototype,
        planControl,
        resolvedTemplate,
      });

      return {
        family: prototype.family,
        catalogName: prototype.catalogName,
        constructor: prototype.constructor,
        suggestedInsertQueries,
        validationStatus,
        ...(liveValidation ? { liveValidation } : {}),
        planAlignment,
        ...(planControl?.status ? { planStatus: planControl.status } : {}),
        ...(planControl?.reason ? { planReason: planControl.reason } : {}),
        ...(resolvedTemplate
          ? {
              templateName: resolvedTemplate.templateName,
              templateVersion: resolvedTemplate.templateVersion,
            }
          : {}),
        ...(planControl?.latestInsertObservation
          ? {
              latestInsertObservation: planControl.latestInsertObservation,
            }
          : {}),
        prototypeNotes: prototype.notes ?? [],
        notes: buildPrototypeValidationBacklogNotes({
          prototype,
          planControl,
          resolvedTemplate,
          validationStatus,
          planAlignment,
        }),
      } satisfies CanvasHarvestFixturePrototypeValidationBacklogEntry;
    })
    .sort(comparePrototypeValidationBacklogEntries);

  return {
    schemaVersion: 1,
    generatedAt,
    sourcePlanGeneratedAt: options.plan.generatedAt,
    sourcePrototypeGeneratedAt: options.prototypes.generatedAt,
    sourceRegistryGeneratedAt: options.registry.generatedAt,
    counts: {
      prototypeControls: controls.length,
      validatedControls: controls.filter((control) => control.validationStatus === 'validated').length,
      pendingValidationControls: controls.filter((control) => control.validationStatus === 'pending').length,
      failedValidationControls: controls.filter((control) => control.validationStatus === 'failed').length,
      unknownValidationControls: controls.filter((control) => control.validationStatus === 'unknown').length,
      alignedPlanControls: controls.filter((control) => control.planAlignment === 'aligned').length,
      stalePlanControls: controls.filter((control) => control.planAlignment === 'stale').length,
      prototypeOnlyControls: controls.filter((control) => control.planAlignment === 'prototype-only').length,
      registryMissingControls: controls.filter((control) => !control.templateVersion).length,
    },
    controls,
  };
}

export function renderCanvasHarvestPrototypeValidationFixture(
  options: RenderCanvasHarvestPrototypeValidationFixtureOptions
): RenderedCanvasHarvestPrototypeValidationFixture {
  const statuses = normalizePrototypeValidationStatuses(options.statuses);
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : undefined;
  const allowEmpty = options.allowEmpty ?? false;
  const prototypesByKey = new Map(
    options.prototypes.prototypes.map((prototype) => [makeCatalogKey(prototype.family, prototype.catalogName), prototype] as const)
  );
  const controls: CanvasHarvestFixturePlanEntry[] = [];
  const selectedControls: CanvasHarvestPrototypeValidationFixtureSelectionEntry[] = [];
  const skippedControls: CanvasHarvestPrototypeValidationFixtureSkippedEntry[] = [];

  for (const backlogControl of options.backlog.controls) {
    if (!statuses.includes(backlogControl.validationStatus)) {
      continue;
    }

    if (options.family && backlogControl.family !== options.family) {
      continue;
    }

    const key = makeCatalogKey(backlogControl.family, backlogControl.catalogName);
    const prototype = prototypesByKey.get(key);
    if (!prototype) {
      skippedControls.push({
        family: backlogControl.family,
        catalogName: backlogControl.catalogName,
        constructor: backlogControl.constructor,
        validationStatus: backlogControl.validationStatus,
        planAlignment: backlogControl.planAlignment,
        reason: 'The pinned prototype document no longer contains this backlog entry.',
      });
      continue;
    }

    const resolvedTemplate = resolveTemplateForConstructor(options.registry, prototype.constructor);
    if (!resolvedTemplate) {
      skippedControls.push({
        family: backlogControl.family,
        catalogName: backlogControl.catalogName,
        constructor: prototype.constructor,
        validationStatus: backlogControl.validationStatus,
        planAlignment: backlogControl.planAlignment,
        reason: `The pinned harvested registry does not currently resolve constructor ${prototype.constructor}.`,
      });
      continue;
    }

    selectedControls.push({
      family: backlogControl.family,
      catalogName: backlogControl.catalogName,
      constructor: prototype.constructor,
      validationStatus: backlogControl.validationStatus,
      planAlignment: backlogControl.planAlignment,
      templateName: resolvedTemplate.templateName,
      templateVersion: resolvedTemplate.templateVersion,
      suggestedInsertQueries: backlogControl.suggestedInsertQueries,
      ...(backlogControl.latestInsertObservation
        ? {
            latestInsertObservation: backlogControl.latestInsertObservation,
          }
        : {}),
      ...(backlogControl.liveValidation
        ? {
            liveValidation: backlogControl.liveValidation,
          }
        : {}),
    });
    controls.push({
      family: backlogControl.family,
      catalogName: backlogControl.catalogName,
      description: `Prototype validation candidate (${backlogControl.validationStatus}, ${backlogControl.planAlignment}).`,
      docPath: backlogControl.planStatus ? `prototype-validation/${backlogControl.planStatus}` : 'prototype-validation/backlog',
      learnUrl: 'https://learn.microsoft.com/',
      catalogStatus: [],
      suggestedInsertQueries: backlogControl.suggestedInsertQueries,
      status: 'resolved',
      reason: `Pinned prototype ${prototype.constructor} selected from the prototype validation backlog.`,
      fixtureConstructor: prototype.constructor,
      templateName: resolvedTemplate.templateName,
      templateVersion: resolvedTemplate.templateVersion,
      notes: dedupeStrings([...backlogControl.notes, ...(prototype.notes ?? [])]),
      ...(backlogControl.latestInsertObservation
        ? {
            latestInsertObservation: backlogControl.latestInsertObservation,
          }
        : {}),
    });

    if (limit && selectedControls.length >= limit) {
      break;
    }
  }

  if (selectedControls.length === 0 && !allowEmpty) {
    const familyNote = options.family ? ` family ${familyLabel(options.family)}` : '';
    const skippedNote =
      skippedControls.length > 0
        ? ` ${skippedControls.length} matching controls were skipped because they no longer resolve in the pinned registry.`
        : '';
    throw new Error(
      `No prototype validation controls matched the requested${familyNote} filters for statuses ${statuses.join(', ')}.${skippedNote}`
    );
  }

  const plan: CanvasHarvestFixturePlan = {
    schemaVersion: 1,
    generatedAt: options.backlog.generatedAt,
    catalogGeneratedAt: options.backlog.sourcePlanGeneratedAt,
    registryGeneratedAt: options.registry.generatedAt,
    prototypeGeneratedAt: options.prototypes.generatedAt,
    catalogCounts: summarizePrototypeValidationSelectionCounts(selectedControls),
    registryTemplateCount: options.registry.templates.length,
    prototypeCount: options.prototypes.prototypes.length,
    counts: {
      catalogControls: controls.length,
      resolvedControls: controls.length,
      prototypeMissingControls: 0,
      registryMissingControls: 0,
    },
    controls,
  };
  const rendered = renderCanvasHarvestFixture({
    plan,
    registry: options.registry,
    prototypes: options.prototypes,
    containerName: options.containerName,
    containerConstructor: options.containerConstructor,
    containerVariant: options.containerVariant,
    containerX: options.containerX,
    containerY: options.containerY,
    columns: options.columns,
    cellWidth: options.cellWidth,
    cellHeight: options.cellHeight,
    gutterX: options.gutterX,
    gutterY: options.gutterY,
    paddingX: options.paddingX,
    paddingY: options.paddingY,
    includePendingMarkers: false,
    markerConstructor: options.markerConstructor,
  });

  return {
    ...rendered,
    selectedControls,
    skippedControls,
  };
}

export function buildCanvasHarvestPrototypeValidationFixtureDocument(
  options: BuildCanvasHarvestPrototypeValidationFixtureDocumentOptions
): CanvasHarvestPrototypeValidationFixtureDocument {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const statuses = normalizePrototypeValidationStatuses(options.statuses);
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : undefined;

  return {
    schemaVersion: 1,
    generatedAt,
    sourceBacklogGeneratedAt: options.backlog.generatedAt,
    sourcePrototypeGeneratedAt: options.backlog.sourcePrototypeGeneratedAt,
    sourceRegistryGeneratedAt: options.backlog.sourceRegistryGeneratedAt,
    filters: {
      statuses,
      ...(options.family ? { family: options.family } : {}),
      ...(limit ? { limit } : {}),
    },
    counts: {
      selectedControls: options.rendered.selectedControls.length,
      skippedControls: options.rendered.skippedControls.length,
      renderedControls: options.rendered.renderedControlCount,
      pendingMarkers: options.rendered.pendingMarkerCount,
    },
    ...(options.paths ? { paths: options.paths } : {}),
    selectedControls: options.rendered.selectedControls,
    skippedControls: options.rendered.skippedControls,
  };
}

export function buildCanvasHarvestFixturePrototypeValidationBatchDocument(
  options: BuildCanvasHarvestFixturePrototypeValidationBatchDocumentOptions
): CanvasHarvestFixturePrototypeValidationBatchDocument {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const defaultNotes = dedupeStrings(options.notes ?? []);

  if (options.updates && options.updates.length > 0) {
    if (options.family || options.startAt || options.limit) {
      throw new Error(
        'Cannot combine explicit prototype validation batch updates with family/start-at/limit selection.'
      );
    }

    const requestedByKey = new Map<string, CanvasHarvestFixturePrototypeValidationBatchSelectionUpdate>();
    for (const update of options.updates) {
      const key = makeCatalogKey(update.family, update.catalogName);
      if (requestedByKey.has(key)) {
        throw new Error(
          `Duplicate prototype validation batch update specified for ${familyLabel(update.family)}/${update.catalogName}.`
        );
      }

      requestedByKey.set(key, update);
    }

    const selectedControls = options.selection.selectedControls.filter((control) =>
      requestedByKey.has(makeCatalogKey(control.family, control.catalogName))
    );

    if (selectedControls.length !== requestedByKey.size) {
      const missingUpdate = options.updates.find(
        (update) =>
          !selectedControls.some(
            (control) => makeCatalogKey(control.family, control.catalogName) === makeCatalogKey(update.family, update.catalogName)
          )
      );

      if (missingUpdate) {
        throw buildMissingPrototypeValidationSelectionControlError({
          selection: options.selection,
          family: missingUpdate.family,
          catalogName: missingUpdate.catalogName,
        });
      }
    }

    const firstSelectedControl = selectedControls[0];
    return {
      schemaVersion: 1,
      generatedAt,
      sourceSelectionGeneratedAt: options.selection.generatedAt,
      ...(options.paths ? { paths: options.paths } : {}),
      selection: {
        mode: 'explicit',
        startIndex: firstSelectedControl
          ? options.selection.selectedControls.findIndex(
              (control) =>
                makeCatalogKey(control.family, control.catalogName) ===
                makeCatalogKey(firstSelectedControl.family, firstSelectedControl.catalogName)
            )
          : 0,
        matchingControls: options.selection.selectedControls.length,
        selectedControls: selectedControls.length,
        skippedControls: Math.max(0, options.selection.selectedControls.length - selectedControls.length),
        ...(firstSelectedControl
          ? {
              firstSelectedControl: formatPrototypeDraftLabel(
                firstSelectedControl.family,
                firstSelectedControl.catalogName
              ),
            }
          : {}),
        ...(selectedControls.length > 0
          ? {
              lastSelectedControl: formatPrototypeDraftLabel(
                selectedControls[selectedControls.length - 1]!.family,
                selectedControls[selectedControls.length - 1]!.catalogName
              ),
            }
          : {}),
        requestedUpdates: options.updates.map((update) => ({
          family: update.family,
          catalogName: update.catalogName,
        })),
      },
      entries: selectedControls.map((control) => {
        const key = makeCatalogKey(control.family, control.catalogName);
        const requested = requestedByKey.get(key);
        const notes = dedupeStrings(defaultNotes.concat(requested?.notes ?? []));
        return {
          family: control.family,
          catalogName: control.catalogName,
          status: resolvePrototypeValidationBatchEntryStatus(control, requested?.status ?? options.status),
          ...(requested?.method ?? options.method ? { method: requested?.method ?? options.method } : {}),
          ...(notes.length > 0 ? { notes } : {}),
          selection: {
            status: control.validationStatus,
            constructor: control.constructor,
            planAlignment: control.planAlignment,
            templateName: control.templateName,
            templateVersion: control.templateVersion,
            suggestedInsertQueries: control.suggestedInsertQueries,
            ...(control.latestInsertObservation
              ? {
                  latestInsertObservation: control.latestInsertObservation,
                }
              : {}),
            ...(control.liveValidation
              ? {
                  liveValidation: control.liveValidation,
                }
              : {}),
          },
        };
      }),
    };
  }

  const matchingControls = options.family
    ? options.selection.selectedControls.filter((control) => control.family === options.family)
    : [...options.selection.selectedControls];
  if (matchingControls.length === 0) {
    const familyNote = options.family ? ` for ${familyLabel(options.family)}` : '';
    throw new Error(`No prototype validation selection controls are available${familyNote}.`);
  }

  const startIndex = resolvePrototypeValidationBatchStartIndex(matchingControls, options.startAt, options.family);
  const boundedLimit = options.limit && options.limit > 0 ? Math.floor(options.limit) : undefined;
  const selectedControls = matchingControls.slice(startIndex, boundedLimit ? startIndex + boundedLimit : undefined);
  if (selectedControls.length === 0) {
    throw new Error('Prototype validation batch selection did not include any controls.');
  }

  return {
    schemaVersion: 1,
    generatedAt,
    sourceSelectionGeneratedAt: options.selection.generatedAt,
    ...(options.paths ? { paths: options.paths } : {}),
      selection: {
        mode: options.family || options.startAt || boundedLimit ? 'window' : 'all',
      ...(options.family ? { family: options.family } : {}),
      ...(options.startAt ? { startAt: options.startAt } : {}),
      startIndex,
      ...(boundedLimit ? { limit: boundedLimit } : {}),
      matchingControls: matchingControls.length,
      selectedControls: selectedControls.length,
      skippedControls: Math.max(0, matchingControls.length - selectedControls.length),
      firstSelectedControl: formatPrototypeDraftLabel(selectedControls[0]!.family, selectedControls[0]!.catalogName),
      lastSelectedControl: formatPrototypeDraftLabel(
        selectedControls[selectedControls.length - 1]!.family,
        selectedControls[selectedControls.length - 1]!.catalogName
      ),
    },
      entries: selectedControls.map((control) => ({
        family: control.family,
        catalogName: control.catalogName,
        status: resolvePrototypeValidationBatchEntryStatus(control, options.status),
        ...(options.method ? { method: options.method } : {}),
        ...(defaultNotes.length > 0 ? { notes: defaultNotes } : {}),
        selection: {
          status: control.validationStatus,
          constructor: control.constructor,
          planAlignment: control.planAlignment,
          templateName: control.templateName,
          templateVersion: control.templateVersion,
          suggestedInsertQueries: control.suggestedInsertQueries,
          ...(control.latestInsertObservation
            ? {
                latestInsertObservation: control.latestInsertObservation,
              }
            : {}),
          ...(control.liveValidation
            ? {
                liveValidation: control.liveValidation,
              }
            : {}),
        },
      })),
    };
}

export function mergeCanvasHarvestFixturePrototypeValidationBatchDocument(
  batch: CanvasHarvestFixturePrototypeValidationBatchDocument,
  existing: CanvasHarvestFixturePrototypeValidationBatchDocument
): MergeCanvasHarvestFixturePrototypeValidationBatchDocumentResult {
  const existingByKey = new Map(
    existing.entries.map((entry) => [makeCatalogKey(entry.family, entry.catalogName), entry] as const)
  );
  let preservedEntries = 0;
  let preservedStatuses = 0;
  let preservedRecordedAt = 0;
  let preservedMethods = 0;
  let preservedNotesEntries = 0;

  const entries = batch.entries.map((entry) => {
    const existingEntry = existingByKey.get(makeCatalogKey(entry.family, entry.catalogName));
    if (!existingEntry) {
      return entry;
    }

    let changed = false;
    let status = entry.status;
    if (existingEntry.status !== entry.status) {
      status = existingEntry.status;
      preservedStatuses += 1;
      changed = true;
    }

    let recordedAt = entry.recordedAt;
    if (existingEntry.recordedAt && existingEntry.recordedAt !== entry.recordedAt) {
      recordedAt = existingEntry.recordedAt;
      preservedRecordedAt += 1;
      changed = true;
    }

    let method = entry.method;
    if (existingEntry.method && existingEntry.method !== entry.method) {
      method = existingEntry.method;
      preservedMethods += 1;
      changed = true;
    }

    const batchNotes = entry.notes ?? [];
    const existingNotes = existingEntry.notes ?? [];
    const preservedNotes = existingNotes.filter((note) => !batchNotes.includes(note));
    const notes = dedupeStrings(batchNotes.concat(existingNotes));
    if (preservedNotes.length > 0) {
      preservedNotesEntries += 1;
      changed = true;
    }

    if (changed) {
      preservedEntries += 1;
    }

    return {
      ...entry,
      status,
      ...(recordedAt ? { recordedAt } : {}),
      ...(method ? { method } : {}),
      ...(notes.length > 0 ? { notes } : {}),
    };
  });

  return {
    batch: {
      ...batch,
      entries,
    },
    preservedEntries,
    preservedStatuses,
    preservedRecordedAt,
    preservedMethods,
    preservedNotesEntries,
  };
}

export function refreshCanvasHarvestPrototypeValidationArtifacts(
  options: RefreshCanvasHarvestPrototypeValidationArtifactsOptions
): RefreshedCanvasHarvestPrototypeValidationArtifacts {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const backlog = buildCanvasHarvestFixturePrototypeValidationBacklogDocument({
    plan: options.plan,
    registry: options.registry,
    prototypes: options.prototypes,
    generatedAt,
  });
  const rendered = renderCanvasHarvestPrototypeValidationFixture({
    backlog,
    registry: options.registry,
    prototypes: options.prototypes,
    statuses: options.statuses,
    family: options.family,
    limit: options.limit,
    allowEmpty: options.allowEmpty,
    containerName: options.containerName,
    containerConstructor: options.containerConstructor,
    containerVariant: options.containerVariant,
    containerX: options.containerX,
    containerY: options.containerY,
    columns: options.columns,
    cellWidth: options.cellWidth,
    cellHeight: options.cellHeight,
    gutterX: options.gutterX,
    gutterY: options.gutterY,
    paddingX: options.paddingX,
    paddingY: options.paddingY,
    markerConstructor: options.markerConstructor,
  });
  const selection = buildCanvasHarvestPrototypeValidationFixtureDocument({
    backlog,
    rendered,
    statuses: options.statuses,
    family: options.family,
    limit: options.limit,
    generatedAt,
    paths: options.paths,
  });

  return {
    backlog,
    rendered,
    selection,
  };
}

export function promoteCanvasHarvestFixturePrototypeDraft(
  options: PromoteCanvasHarvestFixturePrototypeDraftOptions
): PromotedCanvasHarvestFixturePrototypeDraftResult {
  const promoted = promoteCanvasHarvestFixturePrototypeDrafts({
    drafts: options.drafts,
    registry: options.registry,
    prototypes: options.prototypes,
    promotions: [
      {
        family: options.family,
        catalogName: options.catalogName,
        ...(options.notes && options.notes.length > 0 ? { notes: options.notes } : {}),
      },
    ],
    generatedAt: options.generatedAt,
  });

  return {
    promoted: promoted.updates[0]!.promoted,
    resolvedTemplate: promoted.updates[0]!.resolvedTemplate,
    prototypes: promoted.prototypes,
  };
}

export function promoteCanvasHarvestFixturePrototypeDrafts(
  options: PromoteCanvasHarvestFixturePrototypeDraftsOptions
): PromotedCanvasHarvestFixturePrototypeDraftsResult {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (options.promotions.length === 0) {
    throw new Error('Expected at least one prototype draft promotion.');
  }

  const updatedPrototypes = [...options.prototypes.prototypes];
  const seenKeys = new Set<string>();
  const updates = options.promotions.map((promotion) => {
    const key = makeCatalogKey(promotion.family, promotion.catalogName);
    if (seenKeys.has(key)) {
      throw new Error(
        `Duplicate prototype draft promotion specified for ${familyLabel(promotion.family)}/${promotion.catalogName}.`
      );
    }
    seenKeys.add(key);

    const selectedDraft = options.drafts.drafts.find(
      (draft) => makeCatalogKey(draft.family, draft.catalogName) === key
    );
    if (!selectedDraft) {
      throw buildMissingGeneratedPrototypeDraftError({
        drafts: options.drafts,
        family: promotion.family,
        catalogName: promotion.catalogName,
      });
    }

    if (updatedPrototypes.some((prototype) => makeCatalogKey(prototype.family, prototype.catalogName) === key)) {
      throw new Error(
        `A pinned fixture prototype already exists for ${familyLabel(promotion.family)}/${promotion.catalogName}.`
      );
    }

    const resolvedTemplate = resolveTemplateForConstructor(options.registry, selectedDraft.constructor);
    if (!resolvedTemplate) {
      throw new Error(
        `The pinned harvested registry does not expose a constructor alias for ${selectedDraft.constructor}; ` +
          'regenerate prototype drafts against a current registry snapshot before promoting this draft.'
      );
    }

    const promoted: CanvasHarvestFixturePrototype = {
      family: selectedDraft.family,
      catalogName: selectedDraft.catalogName,
      constructor: selectedDraft.constructor,
      ...(selectedDraft.variant ? { variant: selectedDraft.variant } : {}),
      ...(selectedDraft.properties ? { properties: selectedDraft.properties } : {}),
      liveValidation: {
        status: 'pending',
        recordedAt: generatedAt,
      },
      notes: buildPromotedPrototypeNotes({
        draft: selectedDraft,
        draftDocument: options.drafts,
        resolvedTemplate,
        additionalNotes: promotion.notes,
      }),
    };
    updatedPrototypes.push(promoted);

    return {
      promotion,
      promoted,
      resolvedTemplate: {
        templateName: resolvedTemplate.templateName,
        templateVersion: resolvedTemplate.templateVersion,
      },
    } satisfies PromotedCanvasHarvestFixturePrototypeDraftUpdate;
  });

  const updatedPrototypeDocument: CanvasHarvestFixturePrototypeDocument = {
    schemaVersion: 1,
    generatedAt,
    prototypes: updatedPrototypes,
  };

  return {
    updates,
    prototypes: updatedPrototypeDocument,
    ...(options.refresh
      ? {
          refresh: refreshCanvasHarvestPrototypeValidationArtifacts({
            ...options.refresh,
            prototypes: updatedPrototypeDocument,
            generatedAt,
          }),
        }
      : {}),
  };
}

export function recordCanvasHarvestFixturePrototypeValidation(
  options: RecordCanvasHarvestFixturePrototypeValidationOptions
): RecordedCanvasHarvestFixturePrototypeValidationResult {
  const recorded = recordCanvasHarvestFixturePrototypeValidations({
    prototypes: options.prototypes,
    updates: [
      {
        family: options.family,
        catalogName: options.catalogName,
        status: options.status,
        recordedAt: options.recordedAt,
        method: options.method,
        notes: options.notes,
      },
    ],
    generatedAt: options.generatedAt,
    refresh: options.refresh,
  });

  return {
    prototype: recorded.updates[0]!.prototype,
    prototypes: recorded.prototypes,
    ...(recorded.refresh
      ? {
          refresh: recorded.refresh,
        }
      : {}),
  };
}

export function recordCanvasHarvestFixturePrototypeValidations(
  options: RecordCanvasHarvestFixturePrototypeValidationsOptions
): RecordedCanvasHarvestFixturePrototypeValidationsResult {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (options.updates.length === 0) {
    throw new Error('Expected at least one prototype validation update.');
  }

  const updatedPrototypes = [...options.prototypes.prototypes];
  const seenKeys = new Set<string>();
  const updates = options.updates.map((update) => {
    const key = makeCatalogKey(update.family, update.catalogName);
    if (seenKeys.has(key)) {
      throw new Error(
        `Duplicate prototype validation update specified for ${familyLabel(update.family)}/${update.catalogName}.`
      );
    }
    seenKeys.add(key);

    const prototypeIndex = updatedPrototypes.findIndex(
      (prototype) => makeCatalogKey(prototype.family, prototype.catalogName) === key
    );
    if (prototypeIndex < 0) {
      throw buildMissingPinnedPrototypeError({
        prototypes: options.prototypes,
        family: update.family,
        catalogName: update.catalogName,
      });
    }

    const recordedAt = update.recordedAt ?? generatedAt;
    const prototype = updatedPrototypes[prototypeIndex]!;
    const updatedPrototype: CanvasHarvestFixturePrototype = {
      ...prototype,
      liveValidation: {
        status: update.status,
        recordedAt,
        ...(update.method ? { method: update.method } : {}),
        ...(update.notes && update.notes.length > 0 ? { notes: dedupeStrings(update.notes) } : {}),
      },
    };
    updatedPrototypes[prototypeIndex] = updatedPrototype;

    return {
      update: {
        ...update,
        recordedAt,
      },
      prototype: updatedPrototype,
    } satisfies RecordedCanvasHarvestFixturePrototypeValidationUpdate;
  });

  const updatedPrototypeDocument: CanvasHarvestFixturePrototypeDocument = {
    schemaVersion: 1,
    generatedAt,
    prototypes: updatedPrototypes,
  };

  return {
    updates,
    prototypes: updatedPrototypeDocument,
    ...(options.refresh
      ? {
          refresh: refreshCanvasHarvestPrototypeValidationArtifacts({
            ...options.refresh,
            prototypes: updatedPrototypeDocument,
            generatedAt,
          }),
        }
      : {}),
  };
}

export function renderCanvasHarvestFixture(options: RenderCanvasHarvestFixtureOptions): RenderedCanvasHarvestFixture {
  const containerConstructor = options.containerConstructor ?? 'GroupContainer';
  const markerConstructor = options.markerConstructor ?? 'ModernText';
  const containerTemplate = resolveTemplateForConstructor(options.registry, containerConstructor);

  if (!containerTemplate) {
    throw new Error(`The pinned registry does not expose a constructor alias for ${containerConstructor}.`);
  }

  const includePendingMarkers = options.includePendingMarkers ?? true;
  const markerTemplate = includePendingMarkers ? resolveTemplateForConstructor(options.registry, markerConstructor) : undefined;

  if (includePendingMarkers && !markerTemplate) {
    throw new Error(`The pinned registry does not expose a constructor alias for ${markerConstructor}.`);
  }

  const prototypesByKey = new Map(
    options.prototypes.prototypes.map((prototype) => [makeCatalogKey(prototype.family, prototype.catalogName), prototype] as const)
  );
  const columns = Math.max(1, options.columns ?? 3);
  const cellWidth = Math.max(1, options.cellWidth ?? 280);
  const cellHeight = Math.max(1, options.cellHeight ?? 44);
  const gutterX = Math.max(0, options.gutterX ?? 20);
  const gutterY = Math.max(0, options.gutterY ?? 16);
  const paddingX = Math.max(0, options.paddingX ?? 24);
  const paddingY = Math.max(0, options.paddingY ?? 24);
  const containerX = options.containerX ?? 40;
  const containerY = options.containerY ?? 220;
  const renderedControls = options.plan.controls
    .map((control, index) => {
      const prototype = prototypesByKey.get(makeCatalogKey(control.family, control.catalogName));
      const layout = layoutForIndex(index, {
        columns,
        cellWidth,
        cellHeight,
        gutterX,
        gutterY,
        paddingX,
        paddingY,
      });

      if (control.status === 'resolved' && prototype && control.templateVersion) {
        return {
          name: toIdentifier(['Harvest', control.family, control.catalogName]),
          control: `${prototype.constructor}@${control.templateVersion}`,
          variant: prototype.variant,
          properties: mergeProperties(layout.properties, prototype.properties),
          pending: false,
        };
      }

      if (!includePendingMarkers || !markerTemplate) {
        return undefined;
      }

      return {
        name: toIdentifier(['Harvest', control.family, control.catalogName, 'Marker']),
        control: `${markerConstructor}@${markerTemplate.templateVersion}`,
        properties: {
          Height: `=${cellHeight}`,
          Width: `=${cellWidth}`,
          X: `=${layout.x}`,
          Y: `=${layout.y}`,
          Text: `=${stringLiteral(`${familyLabel(control.family)}: ${control.catalogName} [${statusLabel(control.status)}]`)}`,
        },
        pending: true,
      };
    })
    .filter((control): control is NonNullable<typeof control> => Boolean(control));
  const rows = renderedControls.length === 0 ? 1 : Math.ceil(renderedControls.length / columns);
  const containerWidth = paddingX * 2 + cellWidth * columns + gutterX * Math.max(0, columns - 1);
  const containerHeight = paddingY * 2 + cellHeight * rows + gutterY * Math.max(0, rows - 1);
  const lines = [
    `- ${options.containerName ?? 'HarvestFixtureContainer'}:`,
    `    Control: ${containerConstructor}@${containerTemplate.templateVersion}`,
  ];

  if (options.containerVariant ?? 'ManualLayout') {
    lines.push(`    Variant: ${options.containerVariant ?? 'ManualLayout'}`);
  }

  lines.push('    Properties:');
  lines.push('      DropShadow: =DropShadow.None');
  lines.push(`      Height: =${containerHeight}`);
  lines.push(`      Width: =${containerWidth}`);
  lines.push(`      X: =${containerX}`);
  lines.push(`      Y: =${containerY}`);
  lines.push('    Children:');

  for (const control of renderedControls) {
    lines.push(`      - ${control.name}:`);
    lines.push(`          Control: ${control.control}`);

    if (control.variant) {
      lines.push(`          Variant: ${control.variant}`);
    }

    lines.push('          Properties:');

    for (const [name, value] of Object.entries(control.properties)) {
      lines.push(`            ${name}: ${value}`);
    }
  }

  return {
    yaml: `${lines.join('\n')}\n`,
    renderedControlCount: renderedControls.length,
    pendingMarkerCount: renderedControls.filter((control) => control.pending).length,
    containerTemplateName: containerTemplate.templateName,
    containerTemplateVersion: containerTemplate.templateVersion,
    markerTemplateName: markerTemplate?.templateName,
    markerTemplateVersion: markerTemplate?.templateVersion,
  };
}

function buildCatalogNotes(control: CanvasControlCatalogEntry): string[] {
  return control.status.length > 0 ? [`Catalog status: ${control.status.join(', ')}.`] : [];
}

function buildPrototypeSuggestions(
  registry: CanvasTemplateRegistryDocument,
  control: Pick<CanvasControlCatalogEntry, 'family' | 'name'>
): CanvasHarvestFixturePrototypeSuggestion[] {
  interface ScoredPrototypeSuggestion extends CanvasHarvestFixturePrototypeSuggestion {
    score: number;
  }

  const controlMatch = buildControlMatchIndex(control);
  const suggestions: ScoredPrototypeSuggestion[] = [];

  for (const template of registry.templates) {
    const bestMatch = findBestTemplateMatch(template, controlMatch);
    if (!bestMatch || !isTemplateCompatibleWithControlFamily(template, control.family)) {
      continue;
    }

    suggestions.push({
      matchType: bestMatch.matchType,
      templateName: template.templateName,
      templateVersion: template.templateVersion,
      constructor: bestMatch.constructor,
      score: bestMatch.score,
    });
  }

  suggestions.sort((left, right) => {
    return (
      right.score - left.score ||
      compareVersions(right.templateVersion, left.templateVersion) ||
      (left.constructor ?? '').localeCompare(right.constructor ?? '') ||
      left.templateName.localeCompare(right.templateName)
    );
  });

  return suggestions.map(({ score: _score, ...suggestion }) => suggestion);
}

interface ComparableMatchParts {
  combined: string;
  familyStrippedCombined: string;
  rawTokens: string[];
  familyStrippedRawTokens: string[];
}

interface ControlMatchIndex {
  exactTokens: Set<string>;
  rawTokens: Set<string>;
}

function buildControlMatchIndex(control: Pick<CanvasControlCatalogEntry, 'family' | 'name'>): ControlMatchIndex {
  const key = makeCatalogKey(control.family, control.name);
  const terms = buildCanvasControlSearchTerms(control).concat(CONTROL_PROTOTYPE_MATCH_ALIASES[key] ?? []);
  const exactTokens = new Set<string>();
  const rawTokens = new Set<string>();

  for (const term of terms) {
    const parts = buildComparableMatchParts(term);
    for (const token of [parts.combined, parts.familyStrippedCombined]) {
      if (token.length > 0) {
        exactTokens.add(token);
      }
    }
    for (const token of parts.rawTokens.concat(parts.familyStrippedRawTokens)) {
      if (token.length > 0) {
        rawTokens.add(token);
      }
    }
  }

  return {
    exactTokens,
    rawTokens,
  };
}

function buildPrototypeSuggestionNotes(suggestions: CanvasHarvestFixturePrototypeSuggestion[]): string[] {
  if (suggestions.length === 0) {
    return [];
  }

  const preview = suggestions.slice(0, 3).map((suggestion) => formatPrototypeSuggestion(suggestion));
  const overflow = suggestions.length > preview.length ? ` (+${suggestions.length - preview.length} more)` : '';
  return [`Pinned registry suggests future fixture prototypes: ${preview.join('; ')}${overflow}.`];
}

function formatPrototypeSuggestion(suggestion: CanvasHarvestFixturePrototypeSuggestion): string {
  const target = suggestion.constructor ? `${suggestion.constructor} -> ` : '';
  return `${target}${suggestion.templateName}@${suggestion.templateVersion}`;
}

const DRAFT_PROPERTY_PRIORITY = [
  'Height',
  'Width',
  'Text',
  'Icon',
  'Image',
  'ImagePosition',
  'AutoHeight',
  'Wrap',
  'DisplayMode',
  'Align',
  'VerticalAlign',
  'Visible',
] as const;

type DraftPropertyName = (typeof DRAFT_PROPERTY_PRIORITY)[number];

interface PrototypeDraftPropertyScaffold {
  properties?: Record<string, string>;
  skippedPropertyScaffolds?: CanvasHarvestFixturePrototypeDraftSkippedProperty[];
}

interface PrototypeDraftPropertySelection {
  script?: string;
  skippedPropertyScaffold?: CanvasHarvestFixturePrototypeDraftSkippedProperty;
}

const DRAFT_ENUM_PROPERTY_ROOTS: Partial<Record<DraftPropertyName, string>> = {
  Icon: 'Icon',
  ImagePosition: 'ImagePosition',
  DisplayMode: 'DisplayMode',
  Align: 'Align',
  VerticalAlign: 'VerticalAlign',
};

const DRAFT_BOOLEAN_PROPERTIES = new Set<DraftPropertyName>(['AutoHeight', 'Wrap', 'Visible']);
const DRAFT_NUMERIC_PROPERTIES = new Set<DraftPropertyName>(['Height', 'Width']);
const DRAFT_STRING_PROPERTIES = new Set<DraftPropertyName>(['Text', 'Image']);
const PORTABLE_IDENTIFIER_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_']*(\.[A-Za-z_][A-Za-z0-9_']*)*$/;

function buildPrototypeDraftPropertyScaffold(
  registry: CanvasTemplateRegistryDocument,
  suggestion: CanvasHarvestFixturePrototypeSuggestion
): PrototypeDraftPropertyScaffold {
  const template = registry.templates.find(
    (candidate) =>
      candidate.templateName === suggestion.templateName && candidate.templateVersion === suggestion.templateVersion
  );
  const runtime = asJsonObject(template?.files?.['Harvest/Runtime.json']);
  const rules = asJsonObject(runtime?.rules);

  if (!rules) {
    return {};
  }

  const properties: Record<string, string> = {};
  const skippedPropertyScaffolds: CanvasHarvestFixturePrototypeDraftSkippedProperty[] = [];

  for (const propertyName of DRAFT_PROPERTY_PRIORITY) {
    const rule = asJsonObject(rules[propertyName]);
    const sampleScripts = asStringArray(rule?.sampleScripts);
    const selection = selectPrototypeDraftScript(propertyName, sampleScripts);
    if (!selection.script) {
      if (selection.skippedPropertyScaffold) {
        skippedPropertyScaffolds.push(selection.skippedPropertyScaffold);
      }
      continue;
    }

    properties[propertyName] = ensureFormulaPrefix(selection.script);
  }

  return {
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(skippedPropertyScaffolds.length > 0 ? { skippedPropertyScaffolds } : {}),
  };
}

function selectPrototypeDraftScript(
  propertyName: DraftPropertyName,
  sampleScripts: string[] | undefined
): PrototypeDraftPropertySelection {
  let skippedPropertyScaffold: CanvasHarvestFixturePrototypeDraftSkippedProperty | undefined;

  for (const script of sampleScripts ?? []) {
    const trimmed = script.trim();
    const bareScript = stripFormulaPrefix(trimmed);
    if (bareScript.length === 0) {
      continue;
    }

    if (isSafePrototypeDraftScript(propertyName, bareScript)) {
      return {
        script: bareScript,
      };
    }

    if (!skippedPropertyScaffold && looksLikeNonPortablePrototypeDraftScript(bareScript)) {
      skippedPropertyScaffold = {
        propertyName,
        script: ensureFormulaPrefix(trimmed),
        reason: 'non-portable-formula',
      };
    }
  }

  return skippedPropertyScaffold ? { skippedPropertyScaffold } : {};
}

function isSafePrototypeDraftScript(propertyName: DraftPropertyName, script: string): boolean {
  if (DRAFT_NUMERIC_PROPERTIES.has(propertyName)) {
    return /^-?\d+(\.\d+)?$/.test(script);
  }

  if (DRAFT_BOOLEAN_PROPERTIES.has(propertyName)) {
    return /^(true|false)$/i.test(script);
  }

  if (DRAFT_STRING_PROPERTIES.has(propertyName)) {
    return /^"(?:[^"]|"")*"$/.test(script);
  }

  const expectedEnumRoot = DRAFT_ENUM_PROPERTY_ROOTS[propertyName];
  if (expectedEnumRoot) {
    return new RegExp(`^${expectedEnumRoot}\\.[A-Za-z_][A-Za-z0-9_']*$`).test(script);
  }

  return false;
}

function looksLikeNonPortablePrototypeDraftScript(script: string): boolean {
  return PORTABLE_IDENTIFIER_PATH_PATTERN.test(script);
}

function stripFormulaPrefix(script: string): string {
  return script.startsWith('=') ? script.slice(1).trim() : script;
}

function ensureFormulaPrefix(script: string): string {
  return script.startsWith('=') ? script : `=${script}`;
}

function asJsonObject(value: CanvasJsonValue | undefined): Record<string, CanvasJsonValue> | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return undefined;
  }

  return value as Record<string, CanvasJsonValue>;
}

function asStringArray(value: CanvasJsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return undefined;
  }

  return value as string[];
}

function buildPrototypeDraftNotes(options: {
  control: Pick<CanvasHarvestFixturePlanEntry, 'family' | 'catalogName' | 'latestInsertObservation'>;
  suggestion: CanvasHarvestFixturePrototypeSuggestion;
  planGeneratedAt: string;
  suggestedInsertQueries: string[];
  draftProperties?: Record<string, string>;
  skippedPropertyScaffolds?: CanvasHarvestFixturePrototypeDraftSkippedProperty[];
}): string[] {
  const notes = [
    `Draft scaffold generated from fixture plan ${options.planGeneratedAt}.`,
    `Registry suggestion selected: ${formatPrototypeSuggestion(options.suggestion)} (${options.suggestion.matchType} match).`,
    options.suggestedInsertQueries.length > 0
      ? `Suggested Insert-pane queries: ${options.suggestedInsertQueries.join(', ')}.`
      : 'Suggested Insert-pane queries were unavailable in the source plan.',
    options.draftProperties && Object.keys(options.draftProperties).length > 0
      ? `Scaffold properties derived from harvested runtime metadata: ${Object.keys(options.draftProperties).join(', ')}.`
      : 'No simple scaffold properties were derived from the harvested runtime metadata.',
    ...(options.skippedPropertyScaffolds && options.skippedPropertyScaffolds.length > 0
      ? [
          `Skipped non-portable runtime sample formulas while scaffolding properties: ${options.skippedPropertyScaffolds
            .map((property) => `${property.propertyName} (${property.script})`)
            .join(', ')}.`,
        ]
      : []),
    'Review properties and live-validate this draft before copying it into fixtures/canvas-harvest/prototypes.json.',
  ];

  if (options.control.latestInsertObservation) {
    notes.push(...buildInsertObservationNotes(options.control.latestInsertObservation));
  }

  return notes;
}

function resolveExistingPrototypeDraftScaffoldProperties(
  entry: CanvasHarvestFixturePrototypeDraftEntry
): Record<string, string> {
  if (entry.scaffoldProperties) {
    return entry.scaffoldProperties;
  }

  const scaffoldPropertyNote = (entry.notes ?? []).find((note) =>
    note.startsWith('Scaffold properties derived from harvested runtime metadata: ')
  );
  if (!scaffoldPropertyNote) {
    return {};
  }

  const propertyList = scaffoldPropertyNote
    .replace('Scaffold properties derived from harvested runtime metadata: ', '')
    .replace(/\.$/, '');
  const propertyNames = propertyList
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const resolved: Record<string, string> = {};
  for (const propertyName of propertyNames) {
    const propertyValue = entry.properties?.[propertyName];
    if (propertyValue !== undefined) {
      resolved[propertyName] = propertyValue;
    }
  }

  return resolved;
}

function isGeneratedPrototypeDraftNote(note: string): boolean {
  return (
    note.startsWith('Draft scaffold generated from fixture plan ') ||
    note.startsWith('Registry suggestion selected: ') ||
    note === 'Suggested Insert-pane queries were unavailable in the source plan.' ||
    note.startsWith('Suggested Insert-pane queries: ') ||
    note === 'No simple scaffold properties were derived from the harvested runtime metadata.' ||
    note.startsWith('Scaffold properties derived from harvested runtime metadata: ') ||
    note.startsWith('Skipped non-portable runtime sample formulas while scaffolding properties: ') ||
    note === 'Review properties and live-validate this draft before copying it into fixtures/canvas-harvest/prototypes.json.' ||
    note.startsWith('Latest Studio insert attempt (')
  );
}

function buildPrototypeValidationBacklogNotes(options: {
  prototype: CanvasHarvestFixturePrototype;
  planControl: CanvasHarvestFixturePlanEntry | undefined;
  resolvedTemplate: CanvasTemplateRecord | undefined;
  validationStatus: CanvasHarvestFixturePrototypeValidationStatus;
  planAlignment: CanvasHarvestFixturePrototypeValidationPlanAlignment;
}): string[] {
  const notes: string[] = [];

  switch (options.planAlignment) {
    case 'prototype-only':
      notes.push('No matching control exists in the source fixture plan; this pinned prototype sits outside the preserved plan snapshot.');
      break;
    case 'stale':
      notes.push(buildStalePrototypePlanNote(options.planControl, options.prototype));
      break;
    default:
      if (options.planControl?.status === 'registry-missing') {
        notes.push('The source fixture plan already tracks this prototype, but the harvested registry still lacks a matching constructor alias.');
      } else {
        notes.push('The source fixture plan already resolves this pinned prototype.');
      }
      break;
  }

  if (options.resolvedTemplate) {
    notes.push(
      `Constructor ${options.prototype.constructor} resolves to ${options.resolvedTemplate.templateName}@${options.resolvedTemplate.templateVersion}.`
    );
  } else {
    notes.push(
      `The pinned harvested registry does not currently resolve constructor ${options.prototype.constructor}; keep registry refresh work separate from live validation.`
    );
  }

  switch (options.validationStatus) {
    case 'validated':
      notes.push(buildPrototypeValidationStatusNote(options.prototype.liveValidation, 'validated'));
      break;
    case 'pending':
      notes.push(buildPrototypeValidationStatusNote(options.prototype.liveValidation, 'pending'));
      break;
    case 'failed':
      notes.push(buildPrototypeValidationStatusNote(options.prototype.liveValidation, 'failed'));
      break;
    default:
      notes.push(buildPrototypeValidationStatusNote(options.prototype.liveValidation, 'unknown'));
      break;
  }

  if (options.planControl?.latestInsertObservation) {
    notes.push(...buildInsertObservationNotes(options.planControl.latestInsertObservation));
  }

  return dedupeStrings(notes);
}

function buildPromotedPrototypeNotes(options: {
  draft: CanvasHarvestFixturePrototype;
  draftDocument: CanvasHarvestFixturePrototypeDraftDocument;
  resolvedTemplate: CanvasTemplateRecord;
  additionalNotes?: string[];
}): string[] {
  const propertyNames = Object.keys(options.draft.properties ?? {});
  const notes = [
    `Promoted from generated draft artifact ${options.draftDocument.generatedAt} (fixture plan ${options.draftDocument.sourcePlanGeneratedAt}).`,
    `Constructor ${options.draft.constructor} resolves to ${options.resolvedTemplate.templateName}@${options.resolvedTemplate.templateVersion} in the pinned harvested registry.`,
    propertyNames.length > 0
      ? `Properties started from harvested runtime metadata: ${propertyNames.join(', ')}.`
      : 'No harvested runtime property scaffold was available in the promoted draft.',
    'Live paste validation inside HarvestFixtureContainer is still pending.',
    ...(options.additionalNotes ?? []),
  ];

  return dedupeStrings(notes);
}

function determinePrototypeValidationStatus(
  prototype: Pick<CanvasHarvestFixturePrototype, 'notes' | 'liveValidation'>
): CanvasHarvestFixturePrototypeValidationStatus {
  if (prototype.liveValidation) {
    return prototype.liveValidation.status;
  }

  const notes = prototype.notes ?? [];

  if (
    notes.some((note) =>
      /(?:live paste validation|live-validate|validation).*\bpending\b|\bpending\b.*(?:live paste validation|live-validate|validation)/i.test(
        note
      )
    )
  ) {
    return 'pending';
  }

  if (notes.some((note) => /\bvalidated\b|\blive-validated\b/i.test(note))) {
    return 'validated';
  }

  if (
    notes.some((note) =>
      /(?:live paste validation|live-validate|validation).*\b(failed|failure|error|timed out)\b|\b(failed|failure|error|timed out)\b.*(?:live paste validation|live-validate|validation)/i.test(
        note
      )
    )
  ) {
    return 'failed';
  }

  return 'unknown';
}

function determinePrototypeValidationPlanAlignment(options: {
  prototype: CanvasHarvestFixturePrototype;
  planControl: CanvasHarvestFixturePlanEntry | undefined;
  resolvedTemplate: CanvasTemplateRecord | undefined;
}): CanvasHarvestFixturePrototypeValidationPlanAlignment {
  if (!options.planControl) {
    return 'prototype-only';
  }

  if (options.planControl.status === 'prototype-missing') {
    return 'stale';
  }

  if (
    options.planControl.fixtureConstructor &&
    normalizeToken(options.planControl.fixtureConstructor) !== normalizeToken(options.prototype.constructor)
  ) {
    return 'stale';
  }

  if (options.planControl.status === 'registry-missing') {
    return options.resolvedTemplate ? 'stale' : 'aligned';
  }

  if (!options.resolvedTemplate) {
    return 'stale';
  }

  return options.planControl.templateName === options.resolvedTemplate.templateName &&
    options.planControl.templateVersion === options.resolvedTemplate.templateVersion
    ? 'aligned'
    : 'stale';
}

function buildStalePrototypePlanNote(
  planControl: CanvasHarvestFixturePlanEntry | undefined,
  prototype: Pick<CanvasHarvestFixturePrototype, 'constructor'>
): string {
  if (!planControl) {
    return 'The preserved fixture plan is stale relative to the pinned prototypes.';
  }

  switch (planControl.status) {
    case 'prototype-missing':
      return 'The source fixture plan still marks this control as prototype missing; regenerate the plan to reflect the pinned prototype.';
    case 'registry-missing':
      return `The source fixture plan still marks ${prototype.constructor} as registry missing; regenerate the plan against the current pinned registry.`;
    default:
      return planControl.fixtureConstructor
        ? `The source fixture plan resolves this control via ${planControl.fixtureConstructor}, which differs from the pinned prototype ${prototype.constructor}.`
        : `The source fixture plan does not record constructor ${prototype.constructor}; regenerate the plan to realign it with the pinned prototypes.`;
  }
}

function comparePrototypeValidationBacklogEntries(
  left: CanvasHarvestFixturePrototypeValidationBacklogEntry,
  right: CanvasHarvestFixturePrototypeValidationBacklogEntry
): number {
  const validationPriority: Record<CanvasHarvestFixturePrototypeValidationStatus, number> = {
    failed: 0,
    pending: 1,
    unknown: 2,
    validated: 3,
  };
  const alignmentPriority: Record<CanvasHarvestFixturePrototypeValidationPlanAlignment, number> = {
    stale: 0,
    'prototype-only': 1,
    aligned: 2,
  };

  return (
    validationPriority[left.validationStatus] - validationPriority[right.validationStatus] ||
    alignmentPriority[left.planAlignment] - alignmentPriority[right.planAlignment] ||
    left.family.localeCompare(right.family) ||
    left.catalogName.localeCompare(right.catalogName)
  );
}

function normalizePrototypeValidationStatuses(
  statuses: CanvasHarvestFixturePrototypeValidationStatus[] | undefined
): CanvasHarvestFixturePrototypeValidationStatus[] {
  const normalized = statuses && statuses.length > 0 ? statuses : ['failed', 'pending', 'unknown'];
  return [...new Set(normalized)] as CanvasHarvestFixturePrototypeValidationStatus[];
}

function summarizePrototypeValidationSelectionCounts(
  controls: CanvasHarvestPrototypeValidationFixtureSelectionEntry[]
): CanvasControlCatalogCounts {
  return {
    total: controls.length,
    classic: controls.filter((control) => control.family === 'classic').length,
    modern: controls.filter((control) => control.family === 'modern').length,
  };
}

function buildPrototypeValidationStatusNote(
  liveValidation: CanvasHarvestFixturePrototypeValidationRecord | undefined,
  status: CanvasHarvestFixturePrototypeValidationStatus
): string {
  if (!liveValidation) {
    switch (status) {
      case 'validated':
        return 'Prototype notes indicate this control has already been live validated.';
      case 'pending':
        return 'Prototype notes still mark live paste validation as pending.';
      case 'failed':
        return 'Prototype notes indicate the last live validation attempt failed.';
      default:
        return 'Prototype notes do not yet say whether live paste validation has happened.';
    }
  }

  const method = liveValidation.method ? ` via ${liveValidation.method}` : '';
  switch (status) {
    case 'validated':
      return `Recorded live validation marks this control validated${method} on ${liveValidation.recordedAt}.`;
    case 'pending':
      return `Recorded live validation keeps this control pending${method} as of ${liveValidation.recordedAt}.`;
    case 'failed':
      return `Recorded live validation marks this control failed${method} on ${liveValidation.recordedAt}.`;
    default:
      return 'Prototype notes do not yet say whether live paste validation has happened.';
  }
}

function summarizeInsertReport(options: {
  catalog: CanvasControlCatalogDocument;
  catalogPath?: string;
  insertReport: CanvasControlInsertReportDocument;
  insertReportPath?: string;
}): CanvasHarvestFixtureInsertReportSummary {
  const currentCatalogKeys = new Set(options.catalog.controls.map((control) => makeCatalogKey(control.family, control.name)));
  const reportCatalogKeys = new Set(options.insertReport.entries.map((entry) => makeCatalogKey(entry.family, entry.name)));
  let matchedControlCount = 0;

  for (const key of reportCatalogKeys) {
    if (currentCatalogKeys.has(key)) {
      matchedControlCount += 1;
    }
  }

  const unmatchedCatalogControlCount = Math.max(0, currentCatalogKeys.size - matchedControlCount);
  const unmatchedReportEntryCount = Math.max(0, reportCatalogKeys.size - matchedControlCount);
  const reportCatalogCounts = options.insertReport.catalogCounts ?? summarizeInsertReportEntries(options.insertReport.entries);
  const notes: string[] = [];

  if (options.insertReport.catalogGeneratedAt) {
    if (options.insertReport.catalogGeneratedAt === options.catalog.generatedAt) {
      notes.push('Insert report catalog snapshot matches the current catalog generatedAt.');
    } else {
      notes.push(
        `Insert report catalog snapshot ${options.insertReport.catalogGeneratedAt} differs from current catalog snapshot ${options.catalog.generatedAt}.`
      );
    }
  } else {
    notes.push('Insert report does not record catalog generatedAt, so exact snapshot matching is unavailable.');
  }

  if (
    options.catalogPath &&
    options.insertReport.catalogPath &&
    normalizePath(options.catalogPath) !== normalizePath(options.insertReport.catalogPath)
  ) {
    notes.push(`Insert report was captured from ${options.insertReport.catalogPath} while this plan used ${options.catalogPath}.`);
  }

  if (unmatchedCatalogControlCount > 0) {
    notes.push(`${unmatchedCatalogControlCount} current catalog controls have no insert observation in this report.`);
  }

  if (unmatchedReportEntryCount > 0) {
    notes.push(`${unmatchedReportEntryCount} insert report entries do not exist in the current catalog input.`);
  }

  const selectionNote = buildInsertReportSelectionNote(options.insertReport.selection);
  if (selectionNote) {
    notes.push(selectionNote);
  }

  return {
    path: options.insertReportPath,
    generatedAt: options.insertReport.generatedAt,
    entryCount: options.insertReport.entries.length,
    totals: options.insertReport.totals,
    catalog: {
      path: options.insertReport.catalogPath,
      generatedAt: options.insertReport.catalogGeneratedAt,
      counts: reportCatalogCounts,
    },
    matchedControlCount,
    unmatchedCatalogControlCount,
    unmatchedReportEntryCount,
    alignment: determineInsertReportAlignment({
      catalogGeneratedAt: options.catalog.generatedAt,
      insertReportCatalogGeneratedAt: options.insertReport.catalogGeneratedAt,
      matchedControlCount,
      unmatchedCatalogControlCount,
      unmatchedReportEntryCount,
      reportEntryCount: reportCatalogKeys.size,
    }),
    notes,
  };
}

function writesTrackedCanvasHarvestFixtureOutput(options: AssertCanvasHarvestFixtureCatalogWriteOptions): boolean {
  const trackedPaths = new Set([normalizePath(options.trackedPlanPath), normalizePath(options.trackedYamlPath)]);
  return [options.planPath, options.yamlPath].some((path) => trackedPaths.has(normalizePath(path)));
}

function normalizePath(path: string): string {
  return resolve(path);
}

function determineInsertReportAlignment(options: {
  catalogGeneratedAt?: string;
  insertReportCatalogGeneratedAt?: string;
  matchedControlCount: number;
  unmatchedCatalogControlCount: number;
  unmatchedReportEntryCount: number;
  reportEntryCount: number;
}): CanvasHarvestFixtureInsertReportAlignment {
  const exactSnapshot =
    Boolean(options.catalogGeneratedAt) &&
    Boolean(options.insertReportCatalogGeneratedAt) &&
    options.catalogGeneratedAt === options.insertReportCatalogGeneratedAt;

  if (options.unmatchedCatalogControlCount === 0 && options.unmatchedReportEntryCount === 0) {
    return exactSnapshot ? 'same-snapshot' : 'same-controls';
  }

  if (options.matchedControlCount > 0 || options.reportEntryCount === 0) {
    return 'partial';
  }

  return 'mismatch';
}

function buildInsertObservation(
  generatedAt: string,
  entry: CanvasControlInsertReportEntry
): CanvasHarvestFixtureInsertObservation {
  return {
    generatedAt,
    outcome: entry.outcome,
    strategy: entry.strategy,
    attemptedQueries: dedupeStrings(entry.attempts.map((attempt) => attempt.query).filter((query) => query.length > 0)),
    chosenCandidate: entry.chosenCandidate,
    error: entry.error,
  };
}

function buildInsertReportSelectionNote(selection: CanvasControlCatalogSelectionSummary | undefined): string | undefined {
  if (!selection) {
    return undefined;
  }

  const scoped =
    Boolean(selection.family) ||
    Boolean(selection.startAt) ||
    Boolean(selection.limit) ||
    selection.startIndex > 0 ||
    selection.remainingControls > 0 ||
    selection.matchingControls !== selection.selectedControls;

  if (!scoped) {
    return undefined;
  }

  const parts = [`Insert report selection covered ${selection.selectedControls} of ${selection.matchingControls} matching catalog controls`];
  if (selection.family) {
    parts.push(`for the ${selection.family} family`);
  }
  if (selection.startAt) {
    parts.push(`starting at ${JSON.stringify(selection.startAt)}`);
  }
  if (selection.limit) {
    parts.push(`with limit ${selection.limit}`);
  }
  if (selection.firstSelectedControl || selection.lastSelectedControl) {
    parts.push(
      `(range ${describeSelectionControl(selection.firstSelectedControl)} -> ${describeSelectionControl(selection.lastSelectedControl)})`
    );
  }
  if (selection.remainingControls > 0) {
    parts.push(`${selection.remainingControls} controls remain after this chunk`);
  }

  return `${parts.join(' ')}.`;
}

function buildInsertObservationNotes(observation: CanvasHarvestFixtureInsertObservation | undefined): string[] {
  if (!observation) {
    return [];
  }

  const queryNote =
    observation.attemptedQueries.length > 0 ? ` Queries: ${observation.attemptedQueries.join(', ')}.` : '';

  switch (observation.outcome) {
    case 'inserted':
      return [
        `Latest Studio insert attempt (${observation.generatedAt}) inserted this control via ${describeInsertCandidate(observation.chosenCandidate)} using ${observation.strategy}.${queryNote}`,
      ];
    case 'covered':
      return [`Latest Studio insert attempt (${observation.generatedAt}) marked this control as covered via ${observation.strategy}.${queryNote}`];
    case 'failed':
      return [
        `Latest Studio insert attempt (${observation.generatedAt}) selected ${describeInsertCandidate(observation.chosenCandidate)} but failed via ${observation.strategy}: ${observation.error ?? 'unknown error'}.${queryNote}`,
      ];
    default:
      return [
        `Latest Studio insert attempt (${observation.generatedAt}) found no insert/search candidates via ${observation.strategy}.${queryNote}`,
      ];
  }
}

function resolveTemplateForConstructor(
  registry: CanvasTemplateRegistryDocument,
  constructorName: string
): CanvasTemplateRecord | undefined {
  const normalizedConstructor = normalizeToken(constructorName);
  const matches = registry.templates.filter((template) => {
    const constructors = template.aliases?.constructors ?? [];
    return (
      constructors.some((candidate) => normalizeToken(candidate) === normalizedConstructor) ||
      normalizeToken(template.templateName) === normalizedConstructor
    );
  });

  return [...matches].sort(compareTemplateRecords).at(0);
}

function findBestTemplateMatch(
  template: CanvasTemplateRecord,
  controlMatch: ControlMatchIndex
): { matchType: CanvasTemplateMatchType; constructor?: string; score: number } | undefined {
  const displayNameMatch = findTemplateAliasMatch(controlMatch, template.aliases?.displayNames, 'displayName', 90);
  const yamlNameMatch = findTemplateAliasMatch(controlMatch, template.aliases?.yamlNames, 'yamlName', 90);
  const constructorMatch = findTemplateAliasMatch(controlMatch, template.aliases?.constructors, 'constructor', 100);
  const templateNameMatch = findTemplateAliasMatch(controlMatch, [template.templateName], 'templateName', 80);
  const matches = [constructorMatch, displayNameMatch, yamlNameMatch, templateNameMatch].filter(
    (
      match
    ): match is {
      matchType: CanvasTemplateMatchType;
      constructor?: string;
      score: number;
    } => Boolean(match)
  );

  return matches.sort((left, right) => right.score - left.score || (left.constructor ?? '').localeCompare(right.constructor ?? ''))[0];
}

function findTemplateAliasMatch(
  controlMatch: ControlMatchIndex,
  values: string[] | undefined,
  matchType: CanvasTemplateMatchType,
  baseScore: number
): { matchType: CanvasTemplateMatchType; constructor?: string; score: number } | undefined {
  for (const value of values ?? []) {
    const parts = buildComparableMatchParts(value);
    const exactMatch =
      (parts.familyStrippedCombined.length > 0 && controlMatch.exactTokens.has(parts.familyStrippedCombined)) ||
      (parts.combined.length > 0 && controlMatch.exactTokens.has(parts.combined));
    if (exactMatch) {
      return {
        matchType,
        constructor: matchType === 'constructor' ? value : undefined,
        score: baseScore + 10,
      };
    }

    const subsetTokens = parts.familyStrippedRawTokens.length > 0 ? parts.familyStrippedRawTokens : parts.rawTokens;
    if (subsetTokens.length > 0 && subsetTokens.every((token) => controlMatch.rawTokens.has(token))) {
      return {
        matchType,
        constructor: matchType === 'constructor' ? value : undefined,
        score: baseScore + Math.min(5, subsetTokens.length),
      };
    }
  }

  return undefined;
}

function compareTemplateRecords(left: CanvasTemplateRecord, right: CanvasTemplateRecord): number {
  return compareVersions(right.templateVersion, left.templateVersion) || left.templateName.localeCompare(right.templateName);
}

function compareVersions(left: string, right: string): number {
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

function makeCatalogKey(family: 'classic' | 'modern', catalogName: string): string {
  return `${family}:${normalizeToken(catalogName)}`;
}

function resolvePrototypeDraftBatchStartIndex(
  drafts: CanvasHarvestFixturePrototypeDraftEntry[],
  startAt: string | undefined,
  family: 'classic' | 'modern' | undefined
): number {
  if (!startAt) {
    return 0;
  }

  const parsed = parseFamilyQualifiedCatalogSelector(startAt, 'Prototype draft');
  if (parsed.family && family && parsed.family !== family) {
    throw new Error(
      `Prototype draft selector ${JSON.stringify(startAt)} conflicts with the ${familyLabel(family)} family filter.`
    );
  }

  if (parsed.family) {
    const index = drafts.findIndex(
      (draft) => draft.family === parsed.family && normalizeLabel(draft.catalogName) === normalizeLabel(parsed.catalogName)
    );
    if (index >= 0) {
      return index;
    }

    throw buildMissingGeneratedPrototypeDraftError({
      drafts: {
        ...emptyPrototypeDraftDocument(),
        drafts,
      },
      family: parsed.family,
      catalogName: parsed.catalogName,
    });
  }

  const matchingIndexes = drafts
    .map((draft, index) =>
      normalizeLabel(draft.catalogName) === normalizeLabel(parsed.catalogName) ? index : undefined
    )
    .filter((index): index is number => index !== undefined);

  if (matchingIndexes.length === 1) {
    return matchingIndexes[0]!;
  }

  if (matchingIndexes.length > 1) {
    const matchingDrafts = matchingIndexes.map((index) => {
      const draft = drafts[index]!;
      return formatPrototypeDraftLabel(draft.family, draft.catalogName);
    });
    throw new Error(
      `Prototype draft selector ${JSON.stringify(startAt)} is ambiguous. Matching drafts: ${matchingDrafts.join(', ')}.`
    );
  }

  throw new Error(`No generated prototype draft matches selector ${JSON.stringify(startAt)}.`);
}

function resolvePrototypeValidationBatchStartIndex(
  controls: CanvasHarvestPrototypeValidationFixtureSelectionEntry[],
  startAt: string | undefined,
  family: 'classic' | 'modern' | undefined
): number {
  if (!startAt) {
    return 0;
  }

  const parsed = parseFamilyQualifiedCatalogSelector(startAt, 'Prototype validation');
  if (parsed.family && family && parsed.family !== family) {
    throw new Error(
      `Prototype validation selector ${JSON.stringify(startAt)} conflicts with the ${familyLabel(family)} family filter.`
    );
  }

  if (parsed.family) {
    const index = controls.findIndex(
      (control) =>
        control.family === parsed.family && normalizeLabel(control.catalogName) === normalizeLabel(parsed.catalogName)
    );
    if (index >= 0) {
      return index;
    }

    throw buildMissingPrototypeValidationSelectionControlError({
      selection: emptyPrototypeValidationFixtureDocument(),
      family: parsed.family,
      catalogName: parsed.catalogName,
      availableControls: controls,
    });
  }

  const matchingIndexes = controls
    .map((control, index) =>
      normalizeLabel(control.catalogName) === normalizeLabel(parsed.catalogName) ? index : undefined
    )
    .filter((index): index is number => index !== undefined);

  if (matchingIndexes.length === 1) {
    return matchingIndexes[0]!;
  }

  if (matchingIndexes.length > 1) {
    const matchingControls = matchingIndexes.map((index) => {
      const control = controls[index]!;
      return formatPrototypeDraftLabel(control.family, control.catalogName);
    });
    throw new Error(
      `Prototype validation selector ${JSON.stringify(startAt)} is ambiguous. Matching controls: ${matchingControls.join(', ')}.`
    );
  }

  throw new Error(`No selected prototype validation control matches selector ${JSON.stringify(startAt)}.`);
}

function parseFamilyQualifiedCatalogSelector(
  value: string,
  contextLabel: string
): { family?: 'classic' | 'modern'; catalogName: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${contextLabel} selectors must not be empty.`);
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex < 0) {
    return {
      catalogName: trimmed,
    };
  }

  const family = trimmed.slice(0, slashIndex).trim().toLowerCase();
  const catalogName = trimmed.slice(slashIndex + 1).trim();
  if (family !== 'classic' && family !== 'modern') {
    throw new Error(
      `Invalid ${contextLabel.toLowerCase()} selector ${JSON.stringify(value)}. Expected family/name with classic or modern.`
    );
  }
  if (catalogName.length === 0) {
    throw new Error(
      `Invalid ${contextLabel.toLowerCase()} selector ${JSON.stringify(value)}. Expected a catalog name after the slash.`
    );
  }

  return {
    family,
    catalogName,
  };
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildComparableMatchParts(value: string): ComparableMatchParts {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const rawTokens = expanded
    .split(/[^A-Za-z0-9]+/)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0);
  const combined = normalizeToken(expanded);
  const familyStrippedCombined = combined.length > 0 ? stripKnownFamilyPrefix(combined) : '';
  const familyStrippedRawTokens = rawTokens.filter((token) => token !== 'classic' && token !== 'modern');

  return {
    combined,
    familyStrippedCombined,
    rawTokens,
    familyStrippedRawTokens,
  };
}

function buildComparableTokens(value: string): string[] {
  const parts = buildComparableMatchParts(value);
  const tokens = new Set<string>();

  if (parts.combined.length > 0) {
    tokens.add(parts.combined);
  }
  if (parts.familyStrippedCombined.length > 0) {
    tokens.add(parts.familyStrippedCombined);
  }
  for (const token of parts.rawTokens) {
    tokens.add(token);
  }

  return [...tokens];
}

function stripKnownFamilyPrefix(value: string): string {
  if (value.startsWith('classic') && value.length > 'classic'.length) {
    return value.slice('classic'.length);
  }

  if (value.startsWith('modern') && value.length > 'modern'.length) {
    return value.slice('modern'.length);
  }

  return value;
}

function isTemplateCompatibleWithControlFamily(
  template: CanvasTemplateRecord,
  family: CanvasControlCatalogEntry['family']
): boolean {
  const likelyModern = [template.templateName]
    .concat(template.aliases?.displayNames ?? [])
    .concat(template.aliases?.yamlNames ?? [])
    .concat(template.aliases?.constructors ?? [])
    .some((value) => buildComparableTokens(value).includes('modern'));

  return family === 'modern' ? likelyModern : !likelyModern;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

function dedupeSearchTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(value);
  }

  return deduped;
}

function summarizeInsertReportEntries(entries: CanvasControlInsertReportEntry[]): CanvasControlCatalogCounts {
  const uniqueKeys = new Set<string>();
  let classic = 0;
  let modern = 0;

  for (const entry of entries) {
    const key = makeCatalogKey(entry.family, entry.name);
    if (uniqueKeys.has(key)) {
      continue;
    }

    uniqueKeys.add(key);
    if (entry.family === 'classic') {
      classic += 1;
    } else {
      modern += 1;
    }
  }

  return {
    total: uniqueKeys.size,
    classic,
    modern,
  };
}

function familyLabel(value: 'classic' | 'modern'): string {
  return value === 'classic' ? 'Classic' : 'Modern';
}

function formatPrototypeDraftLabel(family: 'classic' | 'modern', catalogName: string): string {
  return `${familyLabel(family)}/${catalogName}`;
}

function emptyPrototypeDraftDocument(): CanvasHarvestFixturePrototypeDraftDocument {
  return {
    schemaVersion: 1,
    generatedAt: '',
    sourcePlanGeneratedAt: '',
    counts: {
      draftControls: 0,
      skippedControls: 0,
    },
    drafts: [],
    skipped: [],
  };
}

function emptyPrototypeValidationFixtureDocument(): CanvasHarvestPrototypeValidationFixtureDocument {
  return {
    schemaVersion: 1,
    generatedAt: '',
    sourceBacklogGeneratedAt: '',
    filters: {
      statuses: ['failed', 'pending', 'unknown'],
    },
    counts: {
      selectedControls: 0,
      skippedControls: 0,
      renderedControls: 0,
      pendingMarkers: 0,
    },
    selectedControls: [],
    skippedControls: [],
  };
}

function buildMissingGeneratedPrototypeDraftError(options: {
  drafts: CanvasHarvestFixturePrototypeDraftDocument;
  family: 'classic' | 'modern';
  catalogName: string;
}): Error {
  const availableDrafts = options.drafts.drafts.map((draft) => `${familyLabel(draft.family)}/${draft.catalogName}`);
  const availabilityNote =
    availableDrafts.length > 0 ? ` Available drafts: ${availableDrafts.join(', ')}.` : ' No generated drafts are available.';

  return new Error(
    `No generated prototype draft exists for ${familyLabel(options.family)}/${options.catalogName}.${availabilityNote}`
  );
}

function buildMissingPinnedPrototypeError(options: {
  prototypes: CanvasHarvestFixturePrototypeDocument;
  family: 'classic' | 'modern';
  catalogName: string;
}): Error {
  const availablePrototypes = options.prototypes.prototypes.map(
    (prototype) => `${familyLabel(prototype.family)}/${prototype.catalogName}`
  );
  const availabilityNote =
    availablePrototypes.length > 0
      ? ` Available pinned prototypes: ${availablePrototypes.join(', ')}.`
      : ' No pinned prototypes are available.';

  return new Error(
    `No pinned fixture prototype exists for ${familyLabel(options.family)}/${options.catalogName}.${availabilityNote}`
  );
}

function buildMissingPrototypeValidationSelectionControlError(options: {
  selection: CanvasHarvestPrototypeValidationFixtureDocument;
  family: 'classic' | 'modern';
  catalogName: string;
  availableControls?: CanvasHarvestPrototypeValidationFixtureSelectionEntry[];
}): Error {
  const availableControls = (options.availableControls ?? options.selection.selectedControls).map(
    (control) => `${familyLabel(control.family)}/${control.catalogName}`
  );
  const availabilityNote =
    availableControls.length > 0
      ? ` Available selected controls: ${availableControls.join(', ')}.`
      : ' No selected prototype validation controls are available.';

  return new Error(
    `No selected prototype validation control exists for ${familyLabel(options.family)}/${options.catalogName}.${availabilityNote}`
  );
}

function resolvePrototypeValidationBatchEntryStatus(
  control: CanvasHarvestPrototypeValidationFixtureSelectionEntry,
  overrideStatus: CanvasHarvestFixtureRecordedPrototypeValidationStatus | undefined
): CanvasHarvestFixtureRecordedPrototypeValidationStatus {
  if (overrideStatus) {
    return overrideStatus;
  }

  if (control.validationStatus === 'validated' || control.validationStatus === 'pending' || control.validationStatus === 'failed') {
    return control.validationStatus;
  }

  throw new Error(
    `Cannot build a prototype validation batch entry for ${familyLabel(control.family)}/${control.catalogName} from selection status unknown without an explicit recorded status override.`
  );
}

function statusLabel(value: CanvasHarvestFixtureControlStatus): string {
  switch (value) {
    case 'prototype-missing':
      return 'prototype missing';
    case 'registry-missing':
      return 'registry missing';
    default:
      return 'resolved';
  }
}

function stringLiteral(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function describeInsertCandidate(candidate: CanvasControlInsertReportCandidate | undefined): string {
  if (!candidate) {
    return 'an unnamed candidate';
  }

  return candidate.category ? `${candidate.title} (${candidate.category})` : candidate.title;
}

function describeSelectionControl(control: { family: 'classic' | 'modern'; name: string } | undefined): string {
  if (!control) {
    return 'n/a';
  }

  return `${control.family}/${control.name}`;
}

function mergeProperties(
  layout: {
    Height: string;
    Width: string;
    X: string;
    Y: string;
  },
  properties: Record<string, string> | undefined
): Record<string, string> {
  return {
    Height: properties?.Height ?? layout.Height,
    Width: properties?.Width ?? layout.Width,
    X: properties?.X ?? layout.X,
    Y: properties?.Y ?? layout.Y,
    ...properties,
  };
}

function layoutForIndex(
  index: number,
  options: {
    columns: number;
    cellWidth: number;
    cellHeight: number;
    gutterX: number;
    gutterY: number;
    paddingX: number;
    paddingY: number;
  }
): {
  properties: {
    Height: string;
    Width: string;
    X: string;
    Y: string;
  };
  x: number;
  y: number;
} {
  const column = index % options.columns;
  const row = Math.floor(index / options.columns);
  const x = options.paddingX + column * (options.cellWidth + options.gutterX);
  const y = options.paddingY + row * (options.cellHeight + options.gutterY);

  return {
    properties: {
      Height: `=${options.cellHeight}`,
      Width: `=${options.cellWidth}`,
      X: `=${x}`,
      Y: `=${y}`,
    },
    x,
    y,
  };
}

function toIdentifier(parts: string[]): string {
  const tokens = parts
    .flatMap((part) => part.split(/[^A-Za-z0-9]+/))
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`);
  const combined = tokens.join('');

  return /^[A-Za-z_]/.test(combined) ? combined : `X${combined}`;
}
