import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify } from '@pp/artifacts';
import type {
  CanvasJsonValue,
  CanvasSupportMatrixEntry,
  CanvasTemplateAliases,
  CanvasTemplateProvenance,
  CanvasTemplateRecord,
  CanvasTemplateRegistryDocument,
} from './canvas-types';

interface CanvasUsedTemplatesDocument {
  UsedTemplates?: CanvasUsedTemplateEntry[];
}

interface CanvasUsedTemplateEntry {
  Name?: string;
  Version?: string;
  Template?: string;
}

interface HarvestedControlRuleSummary {
  categories: string[];
  providerTypes: string[];
  sampleScripts: string[];
}

interface HarvestedRuntimeSummary {
  instanceCount: number;
  constructorAliases: string[];
  hasDynamicProperties: boolean;
  variantNames: string[];
  layoutNames: string[];
  styleNames: string[];
  controlPropertyState: string[];
  rules: Record<string, HarvestedControlRuleSummary>;
  sampleControls: Array<{
    name?: string;
    constructorAlias?: string;
    parent?: string;
    variantName?: string;
    layoutName?: string;
    styleName?: string;
    hasDynamicProperties: boolean;
    ruleCount: number;
  }>;
}

export interface HarvestedCanvasTemplateSummary {
  templateName: string;
  templateVersion: string;
  instanceCount: number;
  constructorAliases: string[];
  hasDynamicProperties: boolean;
}

export interface HarvestedCanvasAppSummary {
  generatedAt: string;
  msappRoot: string;
  platformVersion?: string;
  appVersion?: string;
  previewFlags: Record<string, boolean>;
  controlCountsFromProperties: Record<string, number>;
  sourceFiles: string[];
  templates: HarvestedCanvasTemplateSummary[];
}

export interface HarvestedCanvasAnalysis {
  registry: CanvasTemplateRegistryDocument;
  summary: HarvestedCanvasAppSummary;
}

export interface AnalyzeHarvestedCanvasAppOptions {
  generatedAt?: string;
  source?: string;
  sourceArtifact?: string;
  sourceAppId?: string;
  platformVersion?: string;
  appVersion?: string;
  supportStatus?: CanvasSupportMatrixEntry['status'];
  supportModes?: CanvasSupportMatrixEntry['modes'];
  sampleControlLimit?: number;
}

interface HarvestedControlInstance {
  name?: string;
  templateName: string;
  templateVersion: string;
  template?: Record<string, unknown>;
  constructorAlias?: string;
  hasDynamicProperties: boolean;
  variantName?: string;
  layoutName?: string;
  styleName?: string;
  parent?: string;
  controlPropertyState: string[];
  rules: Array<{
    property: string;
    category?: string;
    invariantScript?: string;
    providerType?: string;
  }>;
}

export async function analyzeHarvestedCanvasApp(
  msappRoot: string,
  options: AnalyzeHarvestedCanvasAppOptions = {}
): Promise<HarvestedCanvasAnalysis> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const templatesDocument = await readJsonFile<CanvasUsedTemplatesDocument>(join(msappRoot, 'References', 'Templates.json'));
  const propertiesDocument = await readOptionalJsonFile<Record<string, unknown>>(join(msappRoot, 'Properties.json'));
  const sourceFiles = await loadCanvasSourceFiles(join(msappRoot, 'Src'));
  const controlConstructors = collectControlConstructorAliases(sourceFiles);
  const controlInstances = await loadHarvestedControlInstances(join(msappRoot, 'Controls'), controlConstructors);
  const sourceArtifact = options.sourceArtifact ?? 'References/Templates.json';
  const sampleControlLimit = options.sampleControlLimit ?? 5;
  const supportStatus = options.supportStatus ?? 'partial';
  const supportModes = options.supportModes ?? ['registry'];
  const platformVersion =
    options.platformVersion ??
    readString((propertiesDocument?.AppPreviewFlagsMap as Record<string, unknown> | undefined)?.publisherVersion) ??
    readString(propertiesDocument?.OriginatingVersion) ??
    readString(propertiesDocument?.MinClientVersion);
  const appVersion = options.appVersion ?? readString(propertiesDocument?.AppVersion) ?? readString(propertiesDocument?.appVersion);
  const previewFlags = normalizeBooleanRecord(propertiesDocument?.AppPreviewFlagsMap);
  const propertyControlCounts = normalizeNumberRecord(propertiesDocument?.ControlCount);
  const templates = buildHarvestedTemplateEntries(templatesDocument, controlInstances)
    .map((template) => buildTemplateRecord(template, controlInstances, {
      generatedAt,
      source: options.source,
      sourceArtifact,
      sourceAppId: options.sourceAppId,
      platformVersion,
      appVersion,
      sampleControlLimit,
    }))
    .sort(compareTemplateRecords);
  const supportMatrix = templates.map((template) => ({
    templateName: template.templateName,
    version: template.templateVersion,
    status: supportStatus,
    modes: supportModes,
    notes: [
      `Harvested from ${options.source ?? basename(msappRoot)} on ${generatedAt}.`,
      'Template metadata is present, but full builder support still needs validation.',
    ],
  }));

  return {
    registry: {
      schemaVersion: 1,
      generatedAt,
      templates,
      supportMatrix,
    },
    summary: {
      generatedAt,
      msappRoot,
      platformVersion,
      appVersion,
      previewFlags,
      controlCountsFromProperties: propertyControlCounts,
      sourceFiles: Object.keys(sourceFiles).sort(),
      templates: templates.map((template) => {
        const runtimeFile = asRecord(template.files?.['Harvest/Runtime.json']);

        return {
          templateName: template.templateName,
          templateVersion: template.templateVersion,
          instanceCount: readNumber(runtimeFile?.instanceCount) ?? 0,
          constructorAliases: template.aliases?.constructors ?? [],
          hasDynamicProperties: Boolean(runtimeFile?.hasDynamicProperties),
        };
      }),
    },
  };
}

export function deriveCanvasStudioEditUrl(appOpenUri: string): string | undefined {
  try {
    const playUrl = new URL(appOpenUri);
    const match = playUrl.pathname.match(/\/play\/e\/([^/]+)\/a\/([^/?]+)/i);

    if (!match) {
      return undefined;
    }

    const [, environmentSegment, appId] = match;
    const studioUrl = new URL(`https://make.powerapps.com/e/${environmentSegment}/canvas/`);
    studioUrl.searchParams.set('action', 'edit');
    studioUrl.searchParams.set('app-id', `/providers/Microsoft.PowerApps/apps/${appId}`);

    const tenantId = playUrl.searchParams.get('tenantId');
    const hint = playUrl.searchParams.get('hint');

    if (tenantId) {
      studioUrl.searchParams.set('tenantId', tenantId);
    }

    if (hint) {
      studioUrl.searchParams.set('hint', hint);
    }

    return studioUrl.toString();
  } catch {
    return undefined;
  }
}

function buildTemplateRecord(
  template: CanvasUsedTemplateEntry,
  controlInstances: HarvestedControlInstance[],
  options: {
    generatedAt: string;
    sourceArtifact: string;
    source?: string;
    sourceAppId?: string;
    platformVersion?: string;
    appVersion?: string;
    sampleControlLimit: number;
  }
): CanvasTemplateRecord {
  const templateName = template.Name ?? '<unknown>';
  const templateVersion = template.Version ?? '<unknown>';
  const matchingInstances = controlInstances.filter(
    (instance) => normalizeName(instance.templateName) === normalizeName(templateName) && instance.templateVersion === templateVersion
  );
  const embeddedTemplate = matchingInstances.find((instance) => instance.template)?.template;
  const runtimeSummary = summarizeRuntime(matchingInstances, options.sampleControlLimit);
  const aliases = buildAliases(matchingInstances);
  const provenance: CanvasTemplateProvenance = {
    kind: 'harvested',
    source: options.source ?? basename(options.sourceArtifact),
    acquiredAt: options.generatedAt,
    sourceArtifact: options.sourceArtifact,
    sourceAppId: options.sourceAppId,
    platformVersion: options.platformVersion,
    appVersion: options.appVersion,
    importedFrom: options.sourceArtifact,
  };

  const files: Record<string, CanvasJsonValue> = {
    'References/Templates.json': {
      name: templateName,
      version: templateVersion,
      templateXml: template.Template ?? '',
    },
    'Harvest/Runtime.json': runtimeSummary as unknown as CanvasJsonValue,
    ...(embeddedTemplate
      ? {
          'Controls/EmbeddedTemplate.json': embeddedTemplate as unknown as CanvasJsonValue,
        }
      : {}),
  };

  return {
    templateName,
    templateVersion,
    aliases,
    files,
    contentHash: sha256Hex(
      stableStringify({
        templateName,
        templateVersion,
        aliases,
        files,
      } as unknown as Parameters<typeof stableStringify>[0])
    ),
    provenance,
  };
}

function buildHarvestedTemplateEntries(
  templatesDocument: CanvasUsedTemplatesDocument,
  controlInstances: HarvestedControlInstance[]
): CanvasUsedTemplateEntry[] {
  const entries = new Map<string, CanvasUsedTemplateEntry>();

  for (const template of templatesDocument.UsedTemplates ?? []) {
    const templateName = template.Name ?? '<unknown>';
    const templateVersion = template.Version ?? '<unknown>';
    entries.set(`${templateName}@${templateVersion}`, template);
  }

  for (const instance of controlInstances) {
    const key = `${instance.templateName}@${instance.templateVersion}`;
    if (!entries.has(key)) {
      entries.set(key, {
        Name: instance.templateName,
        Version: instance.templateVersion,
      });
    }
  }

  return Array.from(entries.values()).sort((left, right) => {
    const leftName = left.Name ?? '<unknown>';
    const rightName = right.Name ?? '<unknown>';
    const byName = leftName.localeCompare(rightName);
    return byName !== 0 ? byName : (left.Version ?? '<unknown>').localeCompare(right.Version ?? '<unknown>');
  });
}

function summarizeRuntime(instances: HarvestedControlInstance[], sampleLimit: number): HarvestedRuntimeSummary {
  const ruleMap = new Map<string, { categories: Set<string>; providerTypes: Set<string>; sampleScripts: string[] }>();

  for (const instance of instances) {
    for (const rule of instance.rules) {
      const current = ruleMap.get(rule.property) ?? {
        categories: new Set<string>(),
        providerTypes: new Set<string>(),
        sampleScripts: [],
      };

      if (rule.category) {
        current.categories.add(rule.category);
      }

      if (rule.providerType) {
        current.providerTypes.add(rule.providerType);
      }

      if (rule.invariantScript && !current.sampleScripts.includes(rule.invariantScript) && current.sampleScripts.length < 5) {
        current.sampleScripts.push(rule.invariantScript);
      }

      ruleMap.set(rule.property, current);
    }
  }

  return {
    instanceCount: instances.length,
    constructorAliases: uniqueSorted(instances.map((instance) => instance.constructorAlias).filter(Boolean) as string[]),
    hasDynamicProperties: instances.some((instance) => instance.hasDynamicProperties),
    variantNames: uniqueSorted(instances.map((instance) => instance.variantName).filter(Boolean) as string[]),
    layoutNames: uniqueSorted(instances.map((instance) => instance.layoutName).filter(Boolean) as string[]),
    styleNames: uniqueSorted(instances.map((instance) => instance.styleName).filter(Boolean) as string[]),
    controlPropertyState: uniqueSorted(instances.flatMap((instance) => instance.controlPropertyState)),
    rules: Object.fromEntries(
      Array.from(ruleMap.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([property, details]) => [
          property,
          {
            categories: Array.from(details.categories).sort(),
            providerTypes: Array.from(details.providerTypes).sort(),
            sampleScripts: details.sampleScripts,
          },
        ])
    ),
    sampleControls: instances.slice(0, sampleLimit).map((instance) => ({
      name: instance.name,
      constructorAlias: instance.constructorAlias,
      parent: instance.parent,
      variantName: instance.variantName,
      layoutName: instance.layoutName,
      styleName: instance.styleName,
      hasDynamicProperties: instance.hasDynamicProperties,
      ruleCount: instance.rules.length,
    })),
  };
}

function buildAliases(instances: HarvestedControlInstance[]): CanvasTemplateAliases | undefined {
  const constructors = uniqueSorted(instances.map((instance) => instance.constructorAlias).filter(Boolean) as string[]);

  if (constructors.length === 0) {
    return undefined;
  }

  return {
    constructors,
  };
}

async function loadCanvasSourceFiles(srcDir: string): Promise<Record<string, string>> {
  const files = await readdir(srcDir, { withFileTypes: true });
  const result: Record<string, string> = {};

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.pa.yaml')) {
      continue;
    }

    result[file.name] = await readFile(join(srcDir, file.name), 'utf8');
  }

  return result;
}

async function loadHarvestedControlInstances(
  controlsDir: string,
  controlConstructors: Map<string, string>
): Promise<HarvestedControlInstance[]> {
  const files = await readdir(controlsDir, { withFileTypes: true });
  const instances: HarvestedControlInstance[] = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) {
      continue;
    }

    const document = await readJsonFile<unknown>(join(controlsDir, file.name));
    visitControlNodes(document, instances, controlConstructors);
  }

  return instances;
}

function visitControlNodes(
  value: unknown,
  instances: HarvestedControlInstance[],
  controlConstructors: Map<string, string>
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitControlNodes(item, instances, controlConstructors);
    }

    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const template = asRecord(value.Template);

  if (readString(value.Type) === 'ControlInfo' && template) {
    const name = readString(value.Name);
    const templateName = readString(template.Name);
    const templateVersion = readString(template.Version);

    if (templateName && templateVersion) {
      instances.push({
        name,
        templateName,
        templateVersion,
        template,
        constructorAlias: name ? controlConstructors.get(name) : undefined,
        hasDynamicProperties: Boolean(value.HasDynamicProperties),
        variantName: readString(value.VariantName),
        layoutName: readString(value.LayoutName),
        styleName: readString(value.StyleName),
        parent: readString(value.Parent),
        controlPropertyState: normalizeStringList(value.ControlPropertyState),
        rules: normalizeRuleList(value.Rules),
      });
    }
  }

  for (const nested of Object.values(value)) {
    visitControlNodes(nested, instances, controlConstructors);
  }
}

function collectControlConstructorAliases(sourceFiles: Record<string, string>): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const content of Object.values(sourceFiles)) {
    const lines = content.split(/\r?\n/);
    let currentName: string | undefined;

    for (const line of lines) {
      const nameMatch = line.match(/^\s*-\s+([^:]+):\s*$/);

      if (nameMatch) {
        currentName = nameMatch[1]?.trim();
        continue;
      }

      const controlMatch = line.match(/^\s*Control:\s*([^@]+)@([0-9][^ \r\n]*)\s*$/);
      const constructor = controlMatch?.[1]?.trim();

      if (constructor && currentName) {
        aliases.set(currentName, constructor);
        currentName = undefined;
      }
    }
  }

  return aliases;
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(path);
  } catch {
    return undefined;
  }
}

function normalizeRuleList(value: unknown): HarvestedControlInstance['rules'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .filter(Boolean)
    .map((rule) => ({
      property: readString(rule?.Property) ?? '<unknown>',
      category: readString(rule?.Category),
      invariantScript: readString(rule?.InvariantScript),
      providerType: readString(rule?.RuleProviderType),
    }))
    .sort((left, right) => left.property.localeCompare(right.property));
}

function normalizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => typeof nested === 'boolean')
      .sort(([left], [right]) => left.localeCompare(right)) as Array<[string, boolean]>
  );
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => typeof nested === 'number')
      .sort(([left], [right]) => left.localeCompare(right)) as Array<[string, number]>
  );
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueSorted(value.map((item) => readString(item)).filter(Boolean) as string[]);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function normalizeName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function compareTemplateRecords(left: CanvasTemplateRecord, right: CanvasTemplateRecord): number {
  const name = left.templateName.localeCompare(right.templateName);
  return name !== 0 ? name : left.templateVersion.localeCompare(right.templateVersion);
}
