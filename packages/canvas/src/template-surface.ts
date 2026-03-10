import type { CanvasJsonValue, CanvasTemplateRecord } from './index';

export interface CanvasTemplateSurface {
  templateName: string;
  templateVersion: string;
  templateId?: string;
  runtimeName?: string;
  styleName?: string;
  firstParty: boolean;
  isPremiumPcfControl: boolean;
  isComponentDefinition: boolean;
  strictValidation: boolean;
  allowedProperties: string[];
  defaultProperties: Record<string, string>;
  propertyCategories: Record<string, string>;
  sources: string[];
}

export function buildCanvasTemplateSurface(template: CanvasTemplateRecord): CanvasTemplateSurface {
  const allowedProperties = new Set<string>();
  const defaultProperties = new Map<string, string>();
  const propertyCategories = new Map<string, string>();
  const sources = new Set<string>();
  const templateJson = asRecord(template.files?.['References/Templates.json']);
  const embeddedTemplate = asRecord(template.files?.['Controls/EmbeddedTemplate.json']);
  const runtimeSummary = asRecord(template.files?.['Harvest/Runtime.json']);
  const templateXml = readString(templateJson?.templateXml) ?? '';
  const xmlMetadata = extractTemplateXmlMetadata(templateXml);
  const dynamicMetadata = extractDynamicTemplateMetadata(embeddedTemplate);
  const runtimeMetadata = extractRuntimeMetadata(runtimeSummary);

  for (const [property, metadata] of xmlMetadata.properties.entries()) {
    allowedProperties.add(property);
    if (metadata.defaultValue !== undefined && !defaultProperties.has(property)) {
      defaultProperties.set(property, metadata.defaultValue);
    }
    if (metadata.category && !propertyCategories.has(property)) {
      propertyCategories.set(property, metadata.category);
    }
  }

  for (const [property, metadata] of dynamicMetadata.properties.entries()) {
    allowedProperties.add(property);
    if (metadata.defaultValue !== undefined && !defaultProperties.has(property)) {
      defaultProperties.set(property, metadata.defaultValue);
    }
    if (metadata.category && !propertyCategories.has(property)) {
      propertyCategories.set(property, metadata.category);
    }
  }

  for (const property of runtimeMetadata.allowedProperties) {
    allowedProperties.add(property);
  }

  for (const [property, metadata] of runtimeMetadata.properties.entries()) {
    if (metadata.defaultValue !== undefined && !defaultProperties.has(property)) {
      defaultProperties.set(property, metadata.defaultValue);
    }
    if (metadata.category && !propertyCategories.has(property)) {
      propertyCategories.set(property, metadata.category);
    }
  }

  if (xmlMetadata.properties.size > 0) {
    sources.add('templateXml');
  }

  if (dynamicMetadata.properties.size > 0) {
    sources.add('dynamicControlDefinition');
  }

  if (runtimeMetadata.allowedProperties.size > 0) {
    sources.add('runtimeSummary');
  }

  const runtimeName = xmlMetadata.runtimeName ?? readString(embeddedTemplate?.Name) ?? template.templateName;
  const styleName =
    runtimeMetadata.styleName ??
    xmlMetadata.styleName ??
    (runtimeName ? defaultStyleName(runtimeName) : undefined);

  return {
    templateName: template.templateName,
    templateVersion: template.templateVersion,
    templateId: xmlMetadata.templateId ?? readString(embeddedTemplate?.Id),
    runtimeName,
    styleName,
    firstParty: readBoolean(embeddedTemplate?.FirstParty) ?? true,
    isPremiumPcfControl: readBoolean(embeddedTemplate?.IsPremiumPcfControl) ?? false,
    isComponentDefinition: readBoolean(embeddedTemplate?.IsComponentDefinition) ?? false,
    strictValidation: xmlMetadata.properties.size > 0 || dynamicMetadata.properties.size > 0,
    allowedProperties: Array.from(allowedProperties).sort((left, right) => left.localeCompare(right)),
    defaultProperties: Object.fromEntries(
      Array.from(defaultProperties.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    propertyCategories: Object.fromEntries(
      Array.from(propertyCategories.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    sources: Array.from(sources).sort((left, right) => left.localeCompare(right)),
  };
}

interface PropertyMetadata {
  defaultValue?: string;
  category?: string;
}

function extractTemplateXmlMetadata(templateXml: string): {
  templateId?: string;
  runtimeName?: string;
  styleName?: string;
  properties: Map<string, PropertyMetadata>;
} {
  const properties = new Map<string, PropertyMetadata>();

  if (templateXml.trim().length === 0) {
    return {
      properties,
    };
  }

  const widgetTag = templateXml.match(/<widget\b([^>]*)>/i);
  const templateId = widgetTag ? readXmlAttribute(widgetTag[1] ?? '', 'id') : undefined;
  const runtimeName = widgetTag ? readXmlAttribute(widgetTag[1] ?? '', 'name') : undefined;
  const styleName = runtimeName ? defaultStyleName(runtimeName) : undefined;
  const blockPattern = /<(?:appMagic:)?property\b([^>]*)>([\s\S]*?)<\/(?:appMagic:)?property>|<(?:appMagic:)?property\b([^>]*)\/>/gi;

  for (const match of templateXml.matchAll(blockPattern)) {
    const attrs = match[1] ?? match[3] ?? '';
    const body = match[2] ?? '';
    const name = readXmlAttribute(attrs, 'name');

    if (!name) {
      continue;
    }

    const defaultValue = normalizeDefaultFormula(readXmlAttribute(attrs, 'defaultValue'));
    const categoryMatch = body.match(/<appMagic:category>([^<]+)<\/appMagic:category>/i);

    properties.set(name, {
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(categoryMatch?.[1] ? { category: normalizeCategory(categoryMatch[1]) } : {}),
    });
  }

  const includePattern = /<appMagic:includeProperty\b([^>]*)\/?>/gi;

  for (const match of templateXml.matchAll(includePattern)) {
    const attrs = match[1] ?? '';
    const name = readXmlAttribute(attrs, 'name');

    if (!name) {
      continue;
    }

    const existing = properties.get(name) ?? {};
    const defaultValue = normalizeDefaultFormula(readXmlAttribute(attrs, 'defaultValue'));

    properties.set(name, {
      ...existing,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    });
  }

  return {
    templateId,
    runtimeName,
    styleName,
    properties,
  };
}

function extractDynamicTemplateMetadata(embeddedTemplate: Record<string, unknown> | undefined): {
  properties: Map<string, PropertyMetadata>;
} {
  const properties = new Map<string, PropertyMetadata>();
  const dynamicControlDefinitionJson = readString(embeddedTemplate?.DynamicControlDefinitionJson);

  if (!dynamicControlDefinitionJson) {
    return {
      properties,
    };
  }

  let definition: Record<string, unknown> | undefined;

  try {
    definition = asRecord(JSON.parse(dynamicControlDefinitionJson));
  } catch {
    return {
      properties,
    };
  }

  for (const key of ['Properties', 'IncludedProperties', 'Events', 'CommonEvents', 'AuthConfigProperties']) {
    const entries = parseDynamicTemplateArray(definition?.[key]);

    for (const entry of entries) {
      const name = readString(entry.Name);

      if (!name) {
        continue;
      }

      const defaultValue =
        normalizeDefaultFormula(readString(entry.PfxDefaultValue)) ??
        normalizeDefaultFormula(readString(entry.DefaultValue)) ??
        normalizeDefaultFormula(readString(entry.WebDefaultValue)) ??
        normalizeDefaultFormula(readString(entry.PhoneDefaultValue)) ??
        normalizeDefaultFormula(readString(entry.NullDefaultValue));
      const category = normalizeDynamicCategory(name, key);
      const existing = properties.get(name) ?? {};

      properties.set(name, {
        ...existing,
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        ...(category ? { category } : {}),
      });
    }
  }

  return {
    properties,
  };
}

function extractRuntimeMetadata(runtimeSummary: Record<string, unknown> | undefined): {
  styleName?: string;
  allowedProperties: Set<string>;
  properties: Map<string, PropertyMetadata>;
} {
  const allowedProperties = new Set<string>();
  const properties = new Map<string, PropertyMetadata>();
  const controlPropertyState = Array.isArray(runtimeSummary?.controlPropertyState) ? runtimeSummary.controlPropertyState : [];
  const rules = asRecord(runtimeSummary?.rules);
  const styleNames = normalizeStringList(runtimeSummary?.styleNames);

  for (const value of controlPropertyState) {
    const property = readString(value);

    if (property) {
      allowedProperties.add(property);
    }
  }

  if (rules) {
    for (const [property, value] of Object.entries(rules)) {
      allowedProperties.add(property);
      const rule = asRecord(value);
      const category = normalizeCategory(normalizeStringList(rule?.categories)?.[0]);
      const defaultValue = normalizeDefaultFormula(normalizeStringList(rule?.sampleScripts)?.[0]);

      properties.set(property, {
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        ...(category ? { category } : {}),
      });
    }
  }

  return {
    styleName: styleNames[0],
    allowedProperties,
    properties,
  };
}

function parseDynamicTemplateArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))) : [];
  } catch {
    return [];
  }
}

function normalizeDynamicCategory(name: string, sourceKey: string): string | undefined {
  if (sourceKey === 'Events' || sourceKey === 'CommonEvents' || name.startsWith('On')) {
    return 'Behavior';
  }

  return undefined;
}

function defaultStyleName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9]+/g, ' ').trim();

  if (normalized.length === 0) {
    return 'defaultStyle';
  }

  const pascal = normalized
    .split(/\s+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');

  return `default${pascal}Style`;
}

function readXmlAttribute(attrs: string, attributeName: string): string | undefined {
  const match = attrs.match(new RegExp(`\\b${attributeName}="([^"]*)"`, 'i'));
  return match?.[1] ? decodeXmlEntities(match[1]) : undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function normalizeDefaultFormula(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return value;
}

function normalizeCategory(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
