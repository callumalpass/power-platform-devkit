import { resolve } from 'node:path';
import {
  assertCanvasControlCatalogLooksComplete,
  summarizeCanvasControlCatalogDocument,
  type CanvasControlCatalogCounts,
  type CanvasControlCatalogDocument,
  type CanvasControlCatalogEntry,
  type CanvasControlCatalogSource,
} from './control-catalog';
import type { CanvasTemplateMatchType, CanvasTemplateRecord, CanvasTemplateRegistryDocument } from './index';

export type { CanvasControlCatalogCounts, CanvasControlCatalogDocument, CanvasControlCatalogEntry, CanvasControlCatalogSource };

export interface CanvasHarvestFixturePrototype {
  family: 'classic' | 'modern';
  catalogName: string;
  constructor: string;
  variant?: string;
  properties?: Record<string, string>;
  notes?: string[];
}

export interface CanvasHarvestFixturePrototypeDocument {
  schemaVersion: 1;
  generatedAt?: string;
  prototypes: CanvasHarvestFixturePrototype[];
}

export type CanvasControlInsertReportOutcome = 'inserted' | 'covered' | 'not-found' | 'failed';

export interface CanvasControlInsertReportCandidate {
  title: string;
  category?: string;
  iconName?: string;
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
  chosenCandidate?: CanvasControlInsertReportCandidate;
  error?: string;
}

export interface CanvasControlInsertReportDocument {
  schemaVersion: 1;
  generatedAt: string;
  catalogPath: string;
  catalogGeneratedAt?: string;
  catalogCounts?: CanvasControlCatalogCounts;
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

export interface RenderedCanvasHarvestFixture {
  yaml: string;
  renderedControlCount: number;
  pendingMarkerCount: number;
  containerTemplateName: string;
  containerTemplateVersion: string;
  markerTemplateName?: string;
  markerTemplateVersion?: string;
}

export const DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH = 'fixtures/canvas-harvest/generated/fixture-plan.json';
export const DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH =
  'fixtures/canvas-harvest/generated/HarvestFixtureContainer.pa.yaml';

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

  const controlTokens = new Set(buildControlMatchTokens(control));
  const suggestions: ScoredPrototypeSuggestion[] = [];

  for (const template of registry.templates) {
    const bestMatch = findBestTemplateMatch(template, controlTokens);
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

function buildControlMatchTokens(control: Pick<CanvasControlCatalogEntry, 'family' | 'name'>): string[] {
  return [...new Set(buildCanvasControlSearchTerms(control).flatMap((term) => buildComparableTokens(term)))];
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
  controlTokens: Set<string>
): { matchType: CanvasTemplateMatchType; constructor?: string; score: number } | undefined {
  const displayNameMatch = findTemplateAliasMatch(controlTokens, template.aliases?.displayNames, 'displayName', 90);
  const yamlNameMatch = findTemplateAliasMatch(controlTokens, template.aliases?.yamlNames, 'yamlName', 90);
  const constructorMatch = findTemplateAliasMatch(controlTokens, template.aliases?.constructors, 'constructor', 100);
  const templateNameMatch = findTemplateAliasMatch(controlTokens, [template.templateName], 'templateName', 80);
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
  controlTokens: Set<string>,
  values: string[] | undefined,
  matchType: CanvasTemplateMatchType,
  baseScore: number
): { matchType: CanvasTemplateMatchType; constructor?: string; score: number } | undefined {
  for (const value of values ?? []) {
    const tokens = buildComparableTokens(value);
    if (tokens.some((token) => controlTokens.has(token))) {
      return {
        matchType,
        constructor: matchType === 'constructor' ? value : undefined,
        score: baseScore,
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

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildComparableTokens(value: string): string[] {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const rawTokens = expanded
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const tokens = new Set<string>();
  const combined = normalizeToken(expanded);

  if (combined.length > 0) {
    tokens.add(combined);
    const familyStripped = stripKnownFamilyPrefix(combined);
    if (familyStripped.length > 0) {
      tokens.add(familyStripped);
    }
  }

  for (const token of rawTokens) {
    const normalized = normalizeToken(token);
    if (normalized.length === 0) {
      continue;
    }

    tokens.add(normalized);
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
