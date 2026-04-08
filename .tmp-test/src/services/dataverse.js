import { createDiagnostic, fail, ok } from '../diagnostics.js';
import { executeApiRequest } from './api.js';
export async function listDataverseEntities(input, configOptions = {}, loginOptions = {}) {
    const top = clamp(input.top ?? 5000, 1, 5000);
    const result = await executeApiRequest({
        environmentAlias: input.environmentAlias,
        accountName: input.accountName,
        api: 'dv',
        path: '/EntityDefinitions',
        method: 'GET',
        responseType: 'json',
        readIntent: true,
        query: {
            '$select': [
                'LogicalName',
                'SchemaName',
                'EntitySetName',
                'DisplayName',
                'DisplayCollectionName',
                'PrimaryIdAttribute',
                'PrimaryNameAttribute',
                'OwnershipType',
                'IsActivity',
                'ObjectTypeCode',
            ].join(','),
        },
    }, configOptions, loginOptions);
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    const entities = readArray(result.data.response).map((value) => mapEntitySummary(readObject(value) ?? {}));
    entities.sort((a, b) => a.logicalName.localeCompare(b.logicalName));
    const search = normalizeSearch(input.search);
    const filtered = entities.filter((entity) => {
        if (!search)
            return true;
        return [entity.logicalName, entity.schemaName, entity.displayName, entity.entitySetName]
            .filter((value) => Boolean(value))
            .some((value) => value.toLowerCase().includes(search));
    });
    return ok(top < filtered.length ? filtered.slice(0, top) : filtered, result.diagnostics);
}
export async function getDataverseEntityDetail(input, configOptions = {}, loginOptions = {}) {
    const [result, lookupTargetsResult] = await Promise.all([
        executeApiRequest({
            environmentAlias: input.environmentAlias,
            accountName: input.accountName,
            api: 'dv',
            path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(input.logicalName)}')`,
            method: 'GET',
            responseType: 'json',
            readIntent: true,
            query: {
                '$select': [
                    'LogicalName',
                    'SchemaName',
                    'EntitySetName',
                    'DisplayName',
                    'DisplayCollectionName',
                    'Description',
                    'PrimaryIdAttribute',
                    'PrimaryNameAttribute',
                    'OwnershipType',
                    'MetadataId',
                    'ObjectTypeCode',
                    'IsActivity',
                ].join(','),
                '$expand': 'Attributes($select=LogicalName,AttributeOf,SchemaName,DisplayName,Description,AttributeType,AttributeTypeName,RequiredLevel,IsPrimaryId,IsPrimaryName,IsValidForRead,IsValidForCreate,IsValidForUpdate,IsValidForAdvancedFind)',
            },
        }, configOptions, loginOptions),
        getDataverseLookupTargets(input, configOptions, loginOptions),
    ]);
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    const raw = readObject(result.data.response);
    if (!raw) {
        return fail(createDiagnostic('error', 'DV_ENTITY_NOT_FOUND', `No Dataverse entity metadata was returned for ${input.logicalName}.`, { source: 'pp/services/dataverse' }));
    }
    const lookupTargets = lookupTargetsResult.success && lookupTargetsResult.data ? lookupTargetsResult.data : new Map();
    const detail = {
        ...mapEntitySummary(raw),
        description: labelText(raw.Description),
        metadataId: readString(raw.MetadataId),
        isAuditEnabled: readBooleanFlag(raw.IsAuditEnabled),
        isCustomEntity: readBoolean(raw.IsCustomEntity),
        isIntersect: readBoolean(raw.IsIntersect),
        changeTrackingEnabled: readBoolean(raw.ChangeTrackingEnabled),
        attributes: readArray(raw.Attributes)
            .map(mapAttributeSummary)
            .map((attribute) => mergeLookupTargets(attribute, lookupTargets))
            .sort((a, b) => a.logicalName.localeCompare(b.logicalName)),
    };
    return ok(detail, [
        ...result.diagnostics,
        ...normalizeLookupDiagnostics(lookupTargetsResult.diagnostics),
    ]);
}
export async function listDataverseRecords(input, configOptions = {}, loginOptions = {}) {
    const querySpec = {
        ...input,
        select: input.select ? [...input.select] : undefined,
        orderBy: input.orderBy ? [...input.orderBy] : undefined,
    };
    const diagnostics = [];
    let result = await runDataverseRecordQuery(querySpec, configOptions, loginOptions);
    let invalidProperty = readMissingPropertyName(result.diagnostics);
    while ((!result.success || !result.data) && invalidProperty) {
        const removed = removeInvalidProperty(querySpec, invalidProperty);
        if (!removed)
            break;
        diagnostics.push(createDiagnostic('warning', 'DV_QUERY_PROPERTY_SKIPPED', `Skipped unsupported Dataverse property ${invalidProperty}.`, {
            source: 'pp/services/dataverse',
        }));
        result = await runDataverseRecordQuery(querySpec, configOptions, loginOptions);
        invalidProperty = readMissingPropertyName(result.diagnostics);
    }
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    const payload = readObject(result.data.response) ?? {};
    const records = readArray(payload.value).filter(isRecord);
    const path = buildDataverseODataPath(querySpec);
    return ok({
        entitySetName: input.entitySetName,
        logicalName: input.entitySetName,
        path,
        records,
        count: typeof payload['@odata.count'] === 'number' ? payload['@odata.count'] : undefined,
        nextLink: readString(payload['@odata.nextLink']),
    }, [...diagnostics, ...result.diagnostics]);
}
async function runDataverseRecordQuery(input, configOptions, loginOptions = {}) {
    const path = buildDataverseODataPath(input);
    return executeApiRequest({
        environmentAlias: input.environmentAlias,
        accountName: input.accountName,
        api: 'dv',
        path,
        method: 'GET',
        responseType: 'json',
        readIntent: true,
    }, configOptions, loginOptions);
}
export function buildDataverseODataPath(spec) {
    if (spec.rawPath && spec.rawPath.trim()) {
        return normalizeDvPath(spec.rawPath.trim());
    }
    const path = normalizeDvPath(spec.entitySetName);
    const query = new URLSearchParams();
    if (spec.select?.length)
        query.set('$select', spec.select.join(','));
    if (spec.filter?.trim())
        query.set('$filter', spec.filter.trim());
    if (spec.orderBy?.length)
        query.set('$orderby', spec.orderBy.join(','));
    if (spec.expand?.length)
        query.set('$expand', spec.expand.join(','));
    if (typeof spec.top === 'number' && Number.isFinite(spec.top) && spec.top > 0)
        query.set('$top', String(Math.floor(spec.top)));
    if (spec.includeCount)
        query.set('$count', 'true');
    if (spec.search?.trim())
        query.set('$search', spec.search.trim());
    const suffix = query.toString();
    return suffix ? `${path}?${suffix}` : path;
}
export function buildFetchXml(spec) {
    if (spec.rawXml?.trim())
        return spec.rawXml.trim();
    const parts = [];
    const fetchAttrs = [
        'version="1.0"',
        'mapping="logical"',
        spec.distinct ? 'distinct="true"' : undefined,
        spec.top ? `top="${Math.floor(spec.top)}"` : undefined,
    ].filter(Boolean);
    parts.push(`<fetch ${fetchAttrs.join(' ')}>`);
    parts.push(`  <entity name="${escapeXml(spec.entity)}">`);
    for (const attribute of spec.attributes ?? []) {
        if (attribute.trim())
            parts.push(`    <attribute name="${escapeXml(attribute.trim())}" />`);
    }
    for (const order of spec.orders ?? []) {
        if (order.attribute.trim()) {
            parts.push(`    <order attribute="${escapeXml(order.attribute.trim())}"${order.descending ? ' descending="true"' : ''} />`);
        }
    }
    if ((spec.conditions?.length ?? 0) > 0) {
        parts.push(`    <filter type="${escapeXml(spec.filterType ?? 'and')}">`);
        for (const condition of spec.conditions ?? []) {
            if (!condition.attribute.trim() || !condition.operator.trim())
                continue;
            const value = condition.value?.trim();
            parts.push(value
                ? `      <condition attribute="${escapeXml(condition.attribute.trim())}" operator="${escapeXml(condition.operator.trim())}" value="${escapeXml(value)}" />`
                : `      <condition attribute="${escapeXml(condition.attribute.trim())}" operator="${escapeXml(condition.operator.trim())}" />`);
        }
        parts.push('    </filter>');
    }
    for (const link of spec.linkEntities ?? []) {
        if (!link.name.trim() || !link.from.trim() || !link.to.trim())
            continue;
        const linkAttrs = [
            `name="${escapeXml(link.name.trim())}"`,
            `from="${escapeXml(link.from.trim())}"`,
            `to="${escapeXml(link.to.trim())}"`,
            link.linkType ? `link-type="${escapeXml(link.linkType)}"` : undefined,
            link.alias?.trim() ? `alias="${escapeXml(link.alias.trim())}"` : undefined,
        ].filter(Boolean).join(' ');
        const hasContent = (link.attributes?.length ?? 0) > 0 || (link.conditions?.length ?? 0) > 0;
        if (!hasContent) {
            parts.push(`    <link-entity ${linkAttrs} />`);
        }
        else {
            parts.push(`    <link-entity ${linkAttrs}>`);
            for (const attr of link.attributes ?? []) {
                if (attr.trim())
                    parts.push(`      <attribute name="${escapeXml(attr.trim())}" />`);
            }
            if ((link.conditions?.length ?? 0) > 0) {
                parts.push('      <filter type="and">');
                for (const cond of link.conditions ?? []) {
                    if (!cond.attribute.trim() || !cond.operator.trim())
                        continue;
                    const val = cond.value?.trim();
                    parts.push(val
                        ? `        <condition attribute="${escapeXml(cond.attribute.trim())}" operator="${escapeXml(cond.operator.trim())}" value="${escapeXml(val)}" />`
                        : `        <condition attribute="${escapeXml(cond.attribute.trim())}" operator="${escapeXml(cond.operator.trim())}" />`);
                }
                parts.push('      </filter>');
            }
            parts.push('    </link-entity>');
        }
    }
    parts.push('  </entity>');
    parts.push('</fetch>');
    return parts.join('\n');
}
export async function executeFetchXml(spec, configOptions = {}, loginOptions = {}) {
    const fetchXml = buildFetchXml(spec);
    const entitySetName = spec.entitySetName?.trim();
    if (!entitySetName) {
        return fail(createDiagnostic('error', 'DV_FETCHXML_ENTITY_SET_REQUIRED', 'entitySetName is required to execute FetchXML.', { source: 'pp/services/dataverse' }));
    }
    const path = `${normalizeDvPath(entitySetName)}?fetchXml=${encodeURIComponent(fetchXml)}`;
    const result = await executeApiRequest({
        environmentAlias: spec.environmentAlias,
        accountName: spec.accountName,
        api: 'dv',
        path,
        method: 'GET',
        responseType: 'json',
        readIntent: true,
    }, configOptions, loginOptions);
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    const payload = readObject(result.data.response) ?? {};
    return ok({
        entitySetName,
        logicalName: spec.entity,
        path,
        fetchXml,
        records: readArray(payload.value).filter(isRecord),
        count: typeof payload['@odata.count'] === 'number' ? payload['@odata.count'] : undefined,
        nextLink: readString(payload['@odata.nextLink']),
    }, result.diagnostics);
}
function mapEntitySummary(value) {
    return {
        logicalName: readString(value.LogicalName) ?? 'unknown',
        schemaName: readString(value.SchemaName),
        entitySetName: readString(value.EntitySetName),
        displayName: labelText(value.DisplayName),
        displayCollectionName: labelText(value.DisplayCollectionName),
        primaryIdAttribute: readString(value.PrimaryIdAttribute),
        primaryNameAttribute: readString(value.PrimaryNameAttribute),
        ownershipType: readString(value.OwnershipType),
        isActivity: readBoolean(value.IsActivity),
        objectTypeCode: typeof value.ObjectTypeCode === 'number' ? value.ObjectTypeCode : undefined,
    };
}
async function getDataverseLookupTargets(input, configOptions, loginOptions = {}) {
    const result = await executeApiRequest({
        environmentAlias: input.environmentAlias,
        accountName: input.accountName,
        api: 'dv',
        path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(input.logicalName)}')/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata`,
        method: 'GET',
        responseType: 'json',
        readIntent: true,
        query: {
            '$select': 'LogicalName,Targets',
        },
    }, configOptions, loginOptions);
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    const lookupTargets = new Map();
    for (const value of readArray(result.data.response)) {
        const record = readObject(value);
        const logicalName = readString(record?.LogicalName);
        if (!logicalName)
            continue;
        const targets = readArray(record?.Targets).filter((item) => typeof item === 'string' && item.trim().length > 0);
        if (targets.length)
            lookupTargets.set(logicalName, targets);
    }
    return ok(lookupTargets, result.diagnostics);
}
function mapAttributeSummary(value) {
    const record = readObject(value) ?? {};
    const optionValues = readArray(record.OptionSet?.Options).map((option) => {
        const item = readObject(option);
        if (!item || typeof item.Value !== 'number')
            return undefined;
        return { value: item.Value, label: labelText(item.Label) };
    }).filter((item) => item !== undefined);
    return {
        logicalName: readString(record.LogicalName) ?? 'unknown',
        attributeOf: readString(record.AttributeOf),
        schemaName: readString(record.SchemaName),
        displayName: labelText(record.DisplayName),
        description: labelText(record.Description),
        attributeType: readString(record.AttributeType),
        attributeTypeName: readString(readObject(record.AttributeTypeName)?.Value) ?? readString(record.AttributeTypeName),
        requiredLevel: readString(readObject(record.RequiredLevel)?.Value) ?? readString(record.RequiredLevel),
        maxLength: typeof record.MaxLength === 'number' ? record.MaxLength : undefined,
        maxValue: typeof record.MaxValue === 'number' ? record.MaxValue : undefined,
        minValue: typeof record.MinValue === 'number' ? record.MinValue : undefined,
        targets: readArray(record.Targets).filter((item) => typeof item === 'string'),
        isPrimaryId: readBoolean(record.IsPrimaryId),
        isPrimaryName: readBoolean(record.IsPrimaryName),
        isValidForRead: readBooleanFlag(record.IsValidForRead),
        isValidForCreate: readBooleanFlag(record.IsValidForCreate),
        isValidForUpdate: readBooleanFlag(record.IsValidForUpdate),
        isValidForAdvancedFind: readBooleanFlag(record.IsValidForAdvancedFind),
        isValidForSort: readBooleanFlag(record.IsValidForSortEnabled),
        optionValues: optionValues.length ? optionValues : undefined,
    };
}
function mergeLookupTargets(attribute, lookupTargets) {
    if (attribute.targets?.length)
        return attribute;
    const targets = lookupTargets.get(attribute.logicalName);
    return targets?.length ? { ...attribute, targets } : attribute;
}
function normalizeLookupDiagnostics(diagnostics) {
    return diagnostics.map((diagnostic) => {
        if (diagnostic.level !== 'error')
            return diagnostic;
        return createDiagnostic('warning', diagnostic.code, `Lookup targets are unavailable: ${diagnostic.message}`, {
            source: diagnostic.source,
            hint: diagnostic.hint,
            detail: diagnostic.detail,
            path: diagnostic.path,
        });
    });
}
function readMissingPropertyName(diagnostics) {
    for (const diagnostic of diagnostics) {
        if (diagnostic.code !== 'HTTP_REQUEST_FAILED' || !diagnostic.detail)
            continue;
        try {
            const payload = JSON.parse(diagnostic.detail);
            const message = payload.error?.message;
            const match = message?.match(/Could not find a property named '([^']+)'/);
            if (match?.[1])
                return match[1];
        }
        catch {
            continue;
        }
    }
    return undefined;
}
function removeInvalidProperty(spec, propertyName) {
    let removed = false;
    if (spec.select?.length) {
        const next = spec.select.filter((item) => item !== propertyName);
        removed = removed || next.length !== spec.select.length;
        spec.select = next.length ? next : undefined;
    }
    if (spec.orderBy?.length) {
        const next = spec.orderBy.filter((item) => !readOrderByProperty(item, propertyName));
        removed = removed || next.length !== spec.orderBy.length;
        spec.orderBy = next.length ? next : undefined;
    }
    return removed;
}
function readOrderByProperty(value, propertyName) {
    const [candidate] = value.trim().split(/\s+/, 1);
    return candidate === propertyName;
}
function labelText(value) {
    const record = readObject(value);
    const userLocalized = readObject(record?.UserLocalizedLabel);
    return readString(userLocalized?.Label) ?? readString(record?.LocalizedLabels?.[0]?.Label);
}
function readBoolean(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function readBooleanFlag(value) {
    if (typeof value === 'boolean')
        return value;
    if (value && typeof value === 'object' && 'Value' in value) {
        return typeof value.Value === 'boolean' ? value.Value : undefined;
    }
    return undefined;
}
function readString(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function readArray(value) {
    if (Array.isArray(value))
        return value;
    const record = readObject(value);
    return Array.isArray(record?.value) ? record.value : [];
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function isRecord(value) {
    return Boolean(readObject(value));
}
function normalizeSearch(value) {
    const trimmed = value?.trim().toLowerCase();
    return trimmed || undefined;
}
function encodeODataLiteral(value) {
    return value.replaceAll("'", "''");
}
function normalizeDvPath(value) {
    if (/^https?:\/\//i.test(value)) {
        const url = new URL(value);
        return `${url.pathname}${url.search}`;
    }
    const trimmed = value.startsWith('/') ? value : `/${value}`;
    return trimmed.startsWith('/api/data/') ? trimmed : `/api/data/v9.2${trimmed}`;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function escapeXml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
