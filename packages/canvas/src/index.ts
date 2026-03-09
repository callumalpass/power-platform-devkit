import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify, writeJsonFile } from '@pp/artifacts';
import { createDiagnostic, fail, ok, withWarning, type Diagnostic, type OperationResult, type ProvenanceClass } from '@pp/diagnostics';

export type CanvasBuildMode = 'strict' | 'seeded' | 'registry';
export type CanvasSupportStatus = 'supported' | 'partial' | 'unsupported';
export type CanvasTemplateMatchType = 'templateName' | 'displayName' | 'constructor' | 'yamlName';
export type CanvasJsonValue = null | boolean | number | string | CanvasJsonValue[] | { [key: string]: CanvasJsonValue };

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

export interface CanvasRegistryImportRequest {
  sourcePath: string;
  outPath?: string;
  provenance?: Partial<CanvasTemplateProvenance>;
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

interface CanvasTemplateCandidate {
  template: CanvasTemplateRecord;
  matchedBy: CanvasTemplateMatchType;
}

interface LoadedRegistryDocument {
  path: string;
  hash: string;
  document: CanvasTemplateRegistryDocument;
}

const DEFAULT_SUPPORTED_MODES: CanvasBuildMode[] = ['strict', 'seeded', 'registry'];

export class CanvasService {
  async inspect(
    path: string,
    options: CanvasRegistryLoadOptions & {
      mode?: CanvasBuildMode;
    } = {}
  ): Promise<OperationResult<CanvasBuildSummary>> {
    const registries = await loadCanvasTemplateRegistryBundle(options);

    if (!registries.success || !registries.data) {
      return registries as unknown as OperationResult<CanvasBuildSummary>;
    }

    return ok(
      {
        path,
        mode: options.mode ?? 'strict',
        supported: registries.data.templates.length > 0,
        registries: registries.data.sources,
      },
      {
        supportTier: 'preview',
        diagnostics: registries.diagnostics,
        warnings: registries.warnings,
      }
    );
  }

  async loadRegistries(options: CanvasRegistryLoadOptions = {}): Promise<OperationResult<CanvasRegistryBundle>> {
    return loadCanvasTemplateRegistryBundle(options);
  }

  async importRegistry(request: CanvasRegistryImportRequest): Promise<OperationResult<CanvasTemplateRegistryDocument>> {
    return importCanvasTemplateRegistry(request);
  }
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
  const document = await readJsonFile<unknown>(request.sourcePath);
  const normalized = normalizeCanvasTemplateRegistry(document, request.sourcePath, request.provenance);

  if (!normalized.success || !normalized.data) {
    return normalized;
  }

  if (request.outPath) {
    await writeJsonFile(request.outPath, normalized.data as unknown as Parameters<typeof writeJsonFile>[1]);
  }

  return normalized;
}

export function resolveCanvasTemplateRegistryPaths(
  options: CanvasRegistryLoadOptions = {}
): OperationResult<string[]> {
  const root = resolve(options.root ?? process.cwd());
  const paths: string[] = [];

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

      paths.push(resolve(options.cacheDir, `${entry.slice('cache:'.length)}.json`));
      continue;
    }

    paths.push(resolve(root, entry));
  }

  return ok(paths, {
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

  const document = await readJsonFile<unknown>(path);
  const normalized = normalizeCanvasTemplateRegistry(document, path);

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
    return value;
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
