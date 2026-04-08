import { analyzeFetchXml, } from './fetchxml-language.js';
import { getDataverseEntityDetail, listDataverseEntities, } from './services/dataverse.js';
export class FetchXmlMetadataCatalog {
    entityListCache = new Map();
    entityDetailCache = new Map();
    async analyze(request, configOptions = {}, loginOptions = {}) {
        const metadata = await this.buildMetadata(request, configOptions, loginOptions);
        return analyzeFetchXml(request.source, request.cursor, metadata);
    }
    async buildMetadata(request, configOptions, loginOptions) {
        const environmentAlias = request.environmentAlias?.trim();
        if (!environmentAlias)
            return undefined;
        const entities = await this.getEntityIndex(environmentAlias, configOptions, loginOptions);
        const referencedNames = extractReferencedEntityNames(request.source, request.rootEntityName);
        await Promise.all(referencedNames.map((name) => this.ensureEntityDetail(environmentAlias, name, configOptions, loginOptions)));
        return {
            entities: entities.map((entity) => this.entityDetailCache.get(detailCacheKey(environmentAlias, entity.logicalName)) ?? entity),
            rootEntityName: request.rootEntityName,
        };
    }
    async getEntityIndex(environmentAlias, configOptions, loginOptions) {
        const cached = this.entityListCache.get(environmentAlias);
        if (cached)
            return cached;
        const result = await listDataverseEntities({ environmentAlias, top: 5000 }, configOptions, loginOptions);
        if (!result.success || !result.data)
            return [];
        const entities = result.data.map((entity) => ({
            logicalName: entity.logicalName,
            displayName: entity.displayName,
            entitySetName: entity.entitySetName,
            primaryIdAttribute: entity.primaryIdAttribute,
            primaryNameAttribute: entity.primaryNameAttribute,
            attributes: [],
        }));
        this.entityListCache.set(environmentAlias, entities);
        return entities;
    }
    async ensureEntityDetail(environmentAlias, logicalName, configOptions, loginOptions) {
        const key = detailCacheKey(environmentAlias, logicalName);
        if (this.entityDetailCache.has(key))
            return;
        const result = await getDataverseEntityDetail({ environmentAlias, logicalName }, configOptions, loginOptions);
        if (!result.success || !result.data)
            return;
        this.entityDetailCache.set(key, mapEntityDetail(result.data));
    }
}
function mapEntityDetail(entity) {
    return {
        logicalName: entity.logicalName,
        displayName: entity.displayName,
        entitySetName: entity.entitySetName,
        primaryIdAttribute: entity.primaryIdAttribute,
        primaryNameAttribute: entity.primaryNameAttribute,
        attributes: entity.attributes.map(mapAttribute),
    };
}
function mapAttribute(attribute) {
    return {
        logicalName: attribute.logicalName,
        displayName: attribute.displayName,
        attributeType: attribute.attributeType,
        attributeTypeName: attribute.attributeTypeName,
        isValidForRead: attribute.isValidForRead,
        isValidForSort: attribute.isValidForSort,
        targets: attribute.targets,
    };
}
function extractReferencedEntityNames(source, fallback) {
    const names = new Set();
    if (fallback?.trim())
        names.add(fallback.trim());
    const pattern = /<(entity|link-entity)\b[^>]*\bname="([^"]+)"/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        const value = match[2]?.trim();
        if (value)
            names.add(value);
    }
    return [...names];
}
function detailCacheKey(environmentAlias, logicalName) {
    return `${environmentAlias}:${logicalName.toLowerCase()}`;
}
