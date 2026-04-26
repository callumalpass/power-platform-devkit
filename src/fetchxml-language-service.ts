import type { PublicClientLoginOptions } from './auth.js';
import { type ConfigStoreOptions } from './config.js';
import { analyzeFetchXml, type FetchXmlLanguageEntity, type FetchXmlLanguageMetadata, type FetchXmlLanguageResult } from './fetchxml-language.js';
import { getDataverseEntityDetail, listDataverseEntities, type DataverseAttributeSummary, type DataverseEntityDetail } from './services/dataverse.js';

export interface FetchXmlLanguageRequest {
  environmentAlias?: string;
  source: string;
  cursor: number;
  rootEntityName?: string;
}

export class FetchXmlMetadataCatalog {
  private readonly entityListCache = new Map<string, FetchXmlLanguageEntity[]>();
  private readonly entityDetailCache = new Map<string, FetchXmlLanguageEntity>();

  async analyze(request: FetchXmlLanguageRequest, configOptions: ConfigStoreOptions = {}, loginOptions: PublicClientLoginOptions = {}): Promise<FetchXmlLanguageResult> {
    const metadata = await this.buildMetadata(request, configOptions, loginOptions);
    return analyzeFetchXml(request.source, request.cursor, metadata);
  }

  private async buildMetadata(request: FetchXmlLanguageRequest, configOptions: ConfigStoreOptions, loginOptions: PublicClientLoginOptions): Promise<FetchXmlLanguageMetadata | undefined> {
    const environmentAlias = request.environmentAlias?.trim();
    if (!environmentAlias) return undefined;
    const entities = await this.getEntityIndex(environmentAlias, configOptions, loginOptions);
    const referencedNames = extractReferencedEntityNames(request.source, request.rootEntityName);
    await Promise.all(referencedNames.map((name) => this.ensureEntityDetail(environmentAlias, name, configOptions, loginOptions)));
    return {
      entities: entities.map((entity) => this.entityDetailCache.get(detailCacheKey(environmentAlias, entity.logicalName)) ?? entity),
      rootEntityName: request.rootEntityName
    };
  }

  private async getEntityIndex(environmentAlias: string, configOptions: ConfigStoreOptions, loginOptions: PublicClientLoginOptions): Promise<FetchXmlLanguageEntity[]> {
    const cached = this.entityListCache.get(environmentAlias);
    if (cached) return cached;
    const result = await listDataverseEntities({ environmentAlias, top: 5000 }, configOptions, loginOptions);
    if (!result.success || !result.data) return [];
    const entities = result.data.map((entity) => ({
      logicalName: entity.logicalName,
      displayName: entity.displayName,
      entitySetName: entity.entitySetName,
      primaryIdAttribute: entity.primaryIdAttribute,
      primaryNameAttribute: entity.primaryNameAttribute,
      attributes: []
    }));
    this.entityListCache.set(environmentAlias, entities);
    return entities;
  }

  private async ensureEntityDetail(environmentAlias: string, logicalName: string, configOptions: ConfigStoreOptions, loginOptions: PublicClientLoginOptions): Promise<void> {
    const key = detailCacheKey(environmentAlias, logicalName);
    if (this.entityDetailCache.has(key)) return;
    const result = await getDataverseEntityDetail({ environmentAlias, logicalName }, configOptions, loginOptions);
    if (!result.success || !result.data) return;
    this.entityDetailCache.set(key, mapEntityDetail(result.data));
  }
}

function mapEntityDetail(entity: DataverseEntityDetail): FetchXmlLanguageEntity {
  return {
    logicalName: entity.logicalName,
    displayName: entity.displayName,
    entitySetName: entity.entitySetName,
    primaryIdAttribute: entity.primaryIdAttribute,
    primaryNameAttribute: entity.primaryNameAttribute,
    attributes: entity.attributes.map(mapAttribute)
  };
}

function mapAttribute(attribute: DataverseAttributeSummary) {
  return {
    logicalName: attribute.logicalName,
    displayName: attribute.displayName,
    attributeType: attribute.attributeType,
    attributeTypeName: attribute.attributeTypeName,
    isValidForRead: attribute.isValidForRead,
    isValidForSort: attribute.isValidForSort,
    targets: attribute.targets
  };
}

function extractReferencedEntityNames(source: string, fallback?: string): string[] {
  const names = new Set<string>();
  if (fallback?.trim()) names.add(fallback.trim());
  const pattern = /<(entity|link-entity)\b[^>]*\bname="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const value = match[2]?.trim();
    if (value) names.add(value);
  }
  return [...names];
}

function detailCacheKey(environmentAlias: string, logicalName: string): string {
  return `${environmentAlias}:${logicalName.toLowerCase()}`;
}
