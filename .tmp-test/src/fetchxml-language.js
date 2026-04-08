import { createDiagnostic } from './diagnostics.js';
const ELEMENT_CHILDREN = {
    fetch: ['entity'],
    entity: ['attribute', 'order', 'filter', 'link-entity', 'all-attributes'],
    'link-entity': ['attribute', 'order', 'filter', 'link-entity', 'all-attributes'],
    filter: ['condition', 'filter'],
    condition: [],
    attribute: [],
    order: [],
    'all-attributes': [],
};
const ELEMENT_ATTRIBUTES = {
    fetch: ['version', 'mapping', 'distinct', 'top', 'count', 'page', 'returntotalrecordcount', 'no-lock'],
    entity: ['name', 'enableprefiltering', 'prefilterparametername'],
    attribute: ['name', 'alias', 'aggregate', 'groupby', 'usertimezone', 'addedby'],
    order: ['attribute', 'descending', 'alias'],
    filter: ['type', 'hint', 'isquickfindfields'],
    condition: ['attribute', 'operator', 'value', 'entityname', 'alias', 'uiname', 'uitype'],
    'link-entity': ['name', 'from', 'to', 'alias', 'link-type', 'intersect', 'visible'],
    'all-attributes': [],
};
const ROOT_TAGS = ['fetch'];
const FILTER_TYPES = ['and', 'or'];
const BOOLEAN_VALUES = ['true', 'false', '1', '0'];
const LINK_TYPES = ['inner', 'outer', 'any', 'not any', 'all', 'not all', 'exists', 'in', 'matchfirstrowusingcrossapply'];
const OPERATORS_BY_KIND = {
    default: ['eq', 'ne', 'null', 'not-null', 'in', 'not-in'],
    string: ['eq', 'ne', 'like', 'not-like', 'begins-with', 'not-begin-with', 'ends-with', 'not-end-with', 'in', 'not-in', 'null', 'not-null'],
    number: ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'not-between', 'in', 'not-in', 'null', 'not-null'],
    money: ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'not-between', 'in', 'not-in', 'null', 'not-null'],
    date: ['on', 'on-or-before', 'on-or-after', 'yesterday', 'today', 'tomorrow', 'last-week', 'this-week', 'next-week', 'last-month', 'this-month', 'next-month', 'last-year', 'this-year', 'next-year', 'last-x-days', 'next-x-days', 'last-x-months', 'next-x-months', 'last-x-years', 'next-x-years', 'null', 'not-null'],
    lookup: ['eq', 'ne', 'in', 'not-in', 'eq-userid', 'ne-userid', 'eq-businessid', 'ne-businessid', 'null', 'not-null'],
    choice: ['eq', 'ne', 'in', 'not-in', 'contain-values', 'not-contain-values', 'null', 'not-null'],
    boolean: ['eq', 'ne', 'null', 'not-null'],
    owner: ['eq', 'ne', 'eq-userid', 'ne-userid', 'eq-businessid', 'ne-businessid', 'null', 'not-null'],
    guid: ['eq', 'ne', 'in', 'not-in', 'null', 'not-null'],
};
const TAG_COMPLETION_APPLY_SUFFIX = new Map([
    ['fetch', '></fetch>'],
    ['entity', ' name=""></entity>'],
    ['filter', ' type=""></filter>'],
    ['condition', ' attribute="" operator="" />'],
    ['attribute', ' name="" />'],
    ['order', ' attribute="" />'],
    ['link-entity', ' name="" from="" to=""></link-entity>'],
    ['all-attributes', ' />'],
]);
export function analyzeFetchXml(source, cursor, metadata) {
    const parsed = parseDocument(source, cursor);
    const currentTag = readCurrentTagContext(source, cursor);
    const path = buildContextPath(parsed.stackAtCursor, currentTag?.elementName);
    const entityScope = resolveEntityScope(parsed.stackAtCursor, currentTag, metadata);
    const context = currentTag
        ? {
            kind: currentTag.kind,
            elementName: currentTag.elementName,
            attributeName: currentTag.attributeName,
            text: currentTag.text,
            from: currentTag.from,
            to: currentTag.to,
            path,
            entityScope,
        }
        : {
            kind: 'text',
            text: '',
            from: cursor,
            to: cursor,
            path,
            entityScope,
        };
    return {
        context,
        completions: buildCompletions(context, parsed, currentTag, metadata),
        diagnostics: [...parsed.diagnostics, ...buildSemanticDiagnostics(parsed, metadata)],
    };
}
function parseDocument(source, cursor) {
    const elements = [];
    const diagnostics = [];
    const stack = [];
    let stackAtCursor = [];
    const tagPattern = /<[^>]*>/g;
    let match;
    while ((match = tagPattern.exec(source)) !== null) {
        const token = match[0];
        const from = match.index;
        const to = from + token.length;
        if (to <= cursor)
            stackAtCursor = stack.map(cloneFrame);
        if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!'))
            continue;
        const parsedTag = parseTagToken(token, from);
        if (!parsedTag)
            continue;
        parsedTag.parentName = stack[stack.length - 1]?.name;
        elements.push(parsedTag);
        if (parsedTag.closing) {
            if (!stack.length) {
                diagnostics.push(rangeDiagnostic('error', 'FETCHXML_UNEXPECTED_CLOSING_TAG', `Unexpected closing tag </${parsedTag.name}>.`, from, to));
                continue;
            }
            const top = stack[stack.length - 1];
            if (top.name !== parsedTag.name) {
                diagnostics.push(rangeDiagnostic('error', 'FETCHXML_MISMATCHED_CLOSING_TAG', `Expected </${top.name}> but found </${parsedTag.name}>.`, from, to));
                const idx = findFrameIndex(stack, parsedTag.name);
                if (idx >= 0)
                    stack.splice(idx);
                continue;
            }
            stack.pop();
            continue;
        }
        const frame = {
            name: parsedTag.name,
            from,
            parentName: stack[stack.length - 1]?.name,
            attributes: parsedTag.attributes,
        };
        if (!parsedTag.selfClosing)
            stack.push(frame);
    }
    if (source.length <= cursor)
        stackAtCursor = stack.map(cloneFrame);
    for (const frame of stack) {
        diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNCLOSED_TAG', `Tag <${frame.name}> is not closed.`, frame.from, Math.min(frame.from + frame.name.length + 1, source.length)));
    }
    return { elements, stackAtCursor, diagnostics };
}
function parseTagToken(token, offset) {
    const body = token.slice(1, -1);
    const trimmed = body.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.startsWith('/')) {
        const name = readName(trimmed.slice(1));
        if (!name)
            return undefined;
        return { name, from: offset, to: offset + token.length, selfClosing: false, closing: true, attributes: [] };
    }
    const selfClosing = trimmed.endsWith('/');
    const normalized = selfClosing ? trimmed.slice(0, -1).trimEnd() : trimmed;
    const name = readName(normalized);
    if (!name)
        return undefined;
    const attributes = parseAttributes(normalized.slice(name.length), offset + 1 + name.length);
    return {
        name,
        from: offset,
        to: offset + token.length,
        selfClosing,
        closing: false,
        attributes,
    };
}
function parseAttributes(text, offset) {
    const attributes = [];
    const attrPattern = /([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = attrPattern.exec(text)) !== null) {
        const full = match[0];
        const name = match[1];
        const value = match[2] ?? '';
        const fullFrom = offset + match.index;
        const nameFrom = fullFrom;
        const nameTo = nameFrom + name.length;
        const quoteIndex = full.indexOf('"');
        const valueFrom = fullFrom + quoteIndex + 1;
        const valueTo = valueFrom + value.length;
        attributes.push({ name, value, valueFrom, valueTo, nameFrom, nameTo });
    }
    return attributes;
}
function readCurrentTagContext(source, cursor) {
    const beforeCursor = source.slice(0, cursor);
    const lt = beforeCursor.lastIndexOf('<');
    const gt = beforeCursor.lastIndexOf('>');
    if (lt <= gt)
        return undefined;
    const fragment = source.slice(lt, cursor);
    if (!fragment.startsWith('<'))
        return undefined;
    if (fragment.startsWith('</')) {
        const text = fragment.slice(2);
        return {
            kind: 'closing-tag',
            text,
            from: lt + 2,
            to: cursor,
            parsedAttributes: [],
        };
    }
    let index = 1;
    let tagName = '';
    while (index < fragment.length && isNameChar(fragment[index])) {
        tagName += fragment[index];
        index += 1;
    }
    if (!tagName) {
        return {
            kind: 'tag-name',
            text: fragment.slice(1),
            from: lt + 1,
            to: cursor,
            parsedAttributes: [],
        };
    }
    const rawAttributes = [];
    let currentName = '';
    let currentValue = '';
    let mode = 'between';
    let attrValueFrom = cursor;
    let attrNameFrom = cursor;
    while (index < fragment.length) {
        const char = fragment[index];
        if (mode === 'between') {
            if (/\s/.test(char)) {
                index += 1;
                continue;
            }
            attrNameFrom = lt + index;
            currentName = '';
            mode = 'name';
            continue;
        }
        if (mode === 'name') {
            if (isNameChar(char)) {
                currentName += char;
                index += 1;
                continue;
            }
            if (char === '=') {
                mode = 'before-value';
                index += 1;
                continue;
            }
            if (/\s/.test(char)) {
                mode = 'after-name';
                index += 1;
                continue;
            }
            return {
                kind: 'attribute-name',
                elementName: tagName,
                attributeName: currentName,
                text: currentName,
                from: attrNameFrom,
                to: lt + index,
                parsedAttributes: rawAttributes,
            };
        }
        if (mode === 'after-name') {
            if (/\s/.test(char)) {
                index += 1;
                continue;
            }
            if (char === '=') {
                mode = 'before-value';
                index += 1;
                continue;
            }
            return {
                kind: 'attribute-name',
                elementName: tagName,
                attributeName: currentName,
                text: currentName,
                from: attrNameFrom,
                to: lt + index,
                parsedAttributes: rawAttributes,
            };
        }
        if (mode === 'before-value') {
            if (/\s/.test(char)) {
                index += 1;
                continue;
            }
            if (char === '"') {
                mode = 'value';
                currentValue = '';
                attrValueFrom = lt + index + 1;
                index += 1;
                continue;
            }
            return {
                kind: 'attribute-value',
                elementName: tagName,
                attributeName: currentName,
                text: '',
                from: lt + index,
                to: lt + index,
                parsedAttributes: rawAttributes,
            };
        }
        if (mode === 'value') {
            if (char === '"') {
                rawAttributes.push({ name: currentName, value: currentValue });
                currentName = '';
                currentValue = '';
                mode = 'between';
                index += 1;
                continue;
            }
            currentValue += char;
            index += 1;
            continue;
        }
    }
    if (mode === 'name' || mode === 'after-name') {
        return {
            kind: 'attribute-name',
            elementName: tagName,
            attributeName: currentName,
            text: currentName,
            from: attrNameFrom,
            to: cursor,
            parsedAttributes: rawAttributes,
        };
    }
    if (mode === 'before-value' || mode === 'value') {
        return {
            kind: 'attribute-value',
            elementName: tagName,
            attributeName: currentName,
            text: currentValue,
            from: mode === 'value' ? attrValueFrom : cursor,
            to: cursor,
            parsedAttributes: rawAttributes,
        };
    }
    return {
        kind: 'attribute-name',
        elementName: tagName,
        text: '',
        from: cursor,
        to: cursor,
        parsedAttributes: rawAttributes,
    };
}
function buildCompletions(context, parsed, currentTag, metadata) {
    switch (context.kind) {
        case 'tag-name':
            return filterByPrefix(tagCompletions(allowedTagsForPath(context.path)), context.text);
        case 'closing-tag': {
            const closing = parsed.stackAtCursor[parsed.stackAtCursor.length - 1]?.name;
            return closing ? filterByPrefix([{ label: closing, type: 'tag', apply: `${closing}>` }], context.text) : [];
        }
        case 'attribute-name':
            return filterByPrefix(attributeNameCompletions(context.elementName, currentTag), context.text);
        case 'attribute-value':
            return filterByPrefix(attributeValueCompletions(context, parsed, currentTag, metadata), context.text);
        default:
            return [];
    }
}
function tagCompletions(tagNames) {
    return tagNames.map((tag) => ({
        label: tag,
        type: 'tag',
        detail: `<${tag}>`,
        apply: `${tag}${TAG_COMPLETION_APPLY_SUFFIX.get(tag) ?? '>'}`,
    }));
}
function attributeNameCompletions(elementName, currentTag) {
    if (!elementName)
        return [];
    const defined = new Set(currentTag?.parsedAttributes.map((attribute) => attribute.name));
    return (ELEMENT_ATTRIBUTES[elementName] ?? [])
        .filter((name) => !defined.has(name))
        .map((name) => ({
        label: name,
        type: 'attribute',
        apply: `${name}=""`,
    }));
}
function attributeValueCompletions(context, parsed, currentTag, metadata) {
    const attrName = context.attributeName;
    const elementName = context.elementName;
    if (!attrName || !elementName)
        return [];
    const workspace = indexMetadata(metadata);
    const scopeEntityName = context.entityScope;
    const scopeEntity = scopeEntityName ? workspace.entities.get(scopeEntityName) : undefined;
    const currentTagMap = new Map(currentTag?.parsedAttributes.map((attribute) => [attribute.name, attribute.value]) ?? []);
    if (attrName === 'name' && (elementName === 'entity' || elementName === 'link-entity')) {
        return workspace.entitiesArray.map((entity) => ({
            label: entity.logicalName,
            type: 'value',
            detail: entity.displayName,
            info: entity.entitySetName,
        }));
    }
    if ((attrName === 'name' && (elementName === 'attribute' || elementName === 'order')) ||
        (attrName === 'attribute' && elementName === 'condition')) {
        return (scopeEntity?.attributes ?? []).map((attribute) => ({
            label: attribute.logicalName,
            type: 'value',
            detail: attribute.attributeTypeName || attribute.attributeType,
            info: attribute.displayName,
        }));
    }
    if (attrName === 'from' && elementName === 'link-entity') {
        const linkedName = currentTagMap.get('name');
        const linkedEntity = linkedName ? workspace.entities.get(linkedName) : undefined;
        return (linkedEntity?.attributes ?? []).map((attribute) => ({
            label: attribute.logicalName,
            type: 'value',
            detail: attribute.attributeTypeName || attribute.attributeType,
            info: attribute.displayName,
        }));
    }
    if (attrName === 'to' && elementName === 'link-entity') {
        return (scopeEntity?.attributes ?? []).map((attribute) => ({
            label: attribute.logicalName,
            type: 'value',
            detail: attribute.attributeTypeName || attribute.attributeType,
            info: attribute.displayName,
        }));
    }
    if (attrName === 'operator' && elementName === 'condition') {
        const attributeName = currentTagMap.get('attribute');
        const attribute = scopeEntity?.attributes.find((item) => item.logicalName === attributeName);
        return operatorsForAttribute(attribute).map((label) => ({ label, type: 'value' }));
    }
    if (attrName === 'type' && elementName === 'filter')
        return FILTER_TYPES.map((label) => ({ label, type: 'keyword' }));
    if (attrName === 'descending')
        return BOOLEAN_VALUES.map((label) => ({ label, type: 'keyword' }));
    if (attrName === 'distinct' || attrName === 'no-lock' || attrName === 'visible' || attrName === 'intersect' || attrName === 'returntotalrecordcount') {
        return BOOLEAN_VALUES.map((label) => ({ label, type: 'keyword' }));
    }
    if (attrName === 'link-type')
        return LINK_TYPES.map((label) => ({ label, type: 'keyword' }));
    if (attrName === 'entityname') {
        const names = collectLinkAliases(parsed);
        return names.map((label) => ({ label, type: 'value' }));
    }
    return [];
}
function buildSemanticDiagnostics(parsed, metadata) {
    const diagnostics = [];
    const workspace = indexMetadata(metadata);
    const rootEntity = findRootEntity(parsed, workspace);
    for (const element of parsed.elements.filter((item) => !item.closing)) {
        const allowedChildren = element.parentName ? ELEMENT_CHILDREN[element.parentName] : ROOT_TAGS;
        if (!allowedChildren.includes(element.name) && !(element.parentName == null && element.name === 'fetch')) {
            diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNEXPECTED_ELEMENT', `<${element.name}> is not valid inside <${element.parentName ?? 'document'}>.`, element.from, element.to));
        }
        const allowedAttributes = new Set(ELEMENT_ATTRIBUTES[element.name] ?? []);
        for (const attribute of element.attributes) {
            if (!allowedAttributes.has(attribute.name)) {
                diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNKNOWN_ATTRIBUTE', `Attribute ${attribute.name} is not valid on <${element.name}>.`, attribute.nameFrom, attribute.nameTo));
            }
        }
    }
    for (const element of parsed.elements.filter((item) => !item.closing)) {
        const scopeEntity = resolveElementScopeEntity(element, parsed.elements, workspace, rootEntity);
        const attrMap = new Map(element.attributes.map((attribute) => [attribute.name, attribute]));
        if ((element.name === 'entity' || element.name === 'link-entity') && attrMap.has('name')) {
            const nameAttr = attrMap.get('name');
            if (!workspace.entities.has(nameAttr.value)) {
                diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNKNOWN_ENTITY', `Unknown Dataverse entity ${nameAttr.value}.`, nameAttr.valueFrom, nameAttr.valueTo));
            }
        }
        const attributeNameAttr = attrMap.get('name');
        if (element.name === 'attribute' && attributeNameAttr && scopeEntity && !hasAttribute(scopeEntity, attributeNameAttr.value)) {
            diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNKNOWN_ATTRIBUTE_REF', `Unknown attribute ${attributeNameAttr.value} for ${scopeEntity.logicalName}.`, attributeNameAttr.valueFrom, attributeNameAttr.valueTo));
        }
        const orderAttr = attrMap.get('attribute');
        if (element.name === 'order' && orderAttr && scopeEntity && !hasAttribute(scopeEntity, orderAttr.value)) {
            diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNKNOWN_ORDER_ATTRIBUTE', `Unknown order attribute ${orderAttr.value} for ${scopeEntity.logicalName}.`, orderAttr.valueFrom, orderAttr.valueTo));
        }
        if (element.name === 'condition') {
            const conditionAttr = attrMap.get('attribute');
            const operatorAttr = attrMap.get('operator');
            const attribute = conditionAttr && scopeEntity ? scopeEntity.attributes.find((item) => item.logicalName === conditionAttr.value) : undefined;
            if (conditionAttr && scopeEntity && !attribute) {
                diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNKNOWN_CONDITION_ATTRIBUTE', `Unknown condition attribute ${conditionAttr.value} for ${scopeEntity.logicalName}.`, conditionAttr.valueFrom, conditionAttr.valueTo));
            }
            if (operatorAttr && attribute) {
                const supported = new Set(operatorsForAttribute(attribute));
                if (!supported.has(operatorAttr.value)) {
                    diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_OPERATOR_TYPE_MISMATCH', `Operator ${operatorAttr.value} does not match ${attribute.logicalName} (${attribute.attributeTypeName || attribute.attributeType || 'attribute'}).`, operatorAttr.valueFrom, operatorAttr.valueTo));
                }
            }
        }
        if (element.name === 'link-entity') {
            const linkedNameAttr = attrMap.get('name');
            const fromAttr = attrMap.get('from');
            const toAttr = attrMap.get('to');
            const linkedEntity = linkedNameAttr ? workspace.entities.get(linkedNameAttr.value) : undefined;
            if (fromAttr && linkedEntity && !hasAttribute(linkedEntity, fromAttr.value)) {
                diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNKNOWN_LINK_FROM', `Unknown link source attribute ${fromAttr.value} for ${linkedEntity.logicalName}.`, fromAttr.valueFrom, fromAttr.valueTo));
            }
            if (toAttr && scopeEntity && !hasAttribute(scopeEntity, toAttr.value)) {
                diagnostics.push(rangeDiagnostic('warning', 'FETCHXML_UNKNOWN_LINK_TO', `Unknown link target attribute ${toAttr.value} for ${scopeEntity.logicalName}.`, toAttr.valueFrom, toAttr.valueTo));
            }
        }
    }
    return diagnostics;
}
function buildContextPath(stack, currentElementName) {
    const path = stack.map((frame) => frame.name);
    if (currentElementName)
        path.push(currentElementName);
    return path;
}
function allowedTagsForPath(path) {
    if (!path.length)
        return ROOT_TAGS;
    const parent = path[path.length - 1];
    return ELEMENT_CHILDREN[parent] ?? [];
}
function resolveEntityScope(stack, currentTag, metadata) {
    const workspace = indexMetadata(metadata);
    const scopedNames = [];
    for (const frame of stack) {
        if (frame.name === 'entity' || frame.name === 'link-entity') {
            const nameValue = frame.attributes.find((attribute) => attribute.name === 'name')?.value;
            if (nameValue)
                scopedNames.push(nameValue);
        }
    }
    if ((currentTag?.elementName === 'entity' || currentTag?.elementName === 'link-entity') && currentTag.attributeName !== 'name') {
        const nameValue = currentTag.parsedAttributes.find((attribute) => attribute.name === 'name')?.value;
        if (nameValue)
            scopedNames.push(nameValue);
    }
    return scopedNames[scopedNames.length - 1] ?? workspace.rootEntityName;
}
function resolveElementScopeEntity(element, elements, workspace, rootEntity) {
    if (element.name === 'entity') {
        const nameValue = element.attributes.find((attribute) => attribute.name === 'name')?.value;
        return (nameValue && workspace.entities.get(nameValue)) || rootEntity;
    }
    let scopeName = rootEntity?.logicalName;
    const openers = elements.filter((candidate) => !candidate.closing && candidate.from <= element.from);
    for (const candidate of openers) {
        if (candidate.name === 'entity' || candidate.name === 'link-entity') {
            const nameValue = candidate.attributes.find((attribute) => attribute.name === 'name')?.value;
            if (nameValue)
                scopeName = nameValue;
        }
    }
    return scopeName ? workspace.entities.get(scopeName) : undefined;
}
function collectLinkAliases(parsed) {
    const aliases = new Set();
    for (const element of parsed.elements) {
        if (element.name !== 'link-entity' || element.closing)
            continue;
        const alias = element.attributes.find((attribute) => attribute.name === 'alias')?.value;
        if (alias)
            aliases.add(alias);
    }
    return [...aliases];
}
function findRootEntity(parsed, workspace) {
    const explicit = parsed.elements.find((element) => !element.closing && element.name === 'entity')?.attributes.find((attribute) => attribute.name === 'name')?.value;
    const logicalName = explicit || workspace.rootEntityName;
    return logicalName ? workspace.entities.get(logicalName) : undefined;
}
function indexMetadata(metadata) {
    const entitiesArray = metadata?.entities ?? [];
    return {
        entities: new Map(entitiesArray.map((entity) => [entity.logicalName, entity])),
        entitiesArray,
        rootEntityName: metadata?.rootEntityName,
    };
}
function hasAttribute(entity, logicalName) {
    return entity.attributes.some((attribute) => attribute.logicalName === logicalName);
}
function operatorsForAttribute(attribute) {
    if (!attribute)
        return OPERATORS_BY_KIND.default;
    const type = String(attribute.attributeTypeName || attribute.attributeType || '').toLowerCase();
    if (type.includes('date'))
        return OPERATORS_BY_KIND.date;
    if (type.includes('lookup'))
        return OPERATORS_BY_KIND.lookup;
    if (type.includes('owner'))
        return OPERATORS_BY_KIND.owner;
    if (type.includes('money'))
        return OPERATORS_BY_KIND.money;
    if (type.includes('picklist') || type.includes('state') || type.includes('status'))
        return OPERATORS_BY_KIND.choice;
    if (type.includes('boolean'))
        return OPERATORS_BY_KIND.boolean;
    if (type.includes('guid') || type.includes('uniqueidentifier'))
        return OPERATORS_BY_KIND.guid;
    if (type.includes('int') || type.includes('decimal') || type.includes('double') || type.includes('bigint'))
        return OPERATORS_BY_KIND.number;
    if (type.includes('string') || type.includes('memo'))
        return OPERATORS_BY_KIND.string;
    return OPERATORS_BY_KIND.default;
}
function filterByPrefix(items, prefix) {
    const normalizedPrefix = prefix.trim().toLowerCase();
    if (!normalizedPrefix)
        return items.slice(0, 100);
    return items
        .filter((item) => item.label.toLowerCase().includes(normalizedPrefix))
        .sort((a, b) => scoreItem(a, normalizedPrefix) - scoreItem(b, normalizedPrefix))
        .slice(0, 100);
}
function scoreItem(item, prefix) {
    const label = item.label.toLowerCase();
    if (label.startsWith(prefix))
        return 0 - (item.boost ?? 0);
    return label.indexOf(prefix) + 10 - (item.boost ?? 0);
}
function rangeDiagnostic(level, code, message, from, to) {
    return { ...createDiagnostic(level, code, message, { source: 'pp/fetchxml-language' }), from, to };
}
function cloneFrame(frame) {
    return {
        name: frame.name,
        from: frame.from,
        parentName: frame.parentName,
        attributes: frame.attributes.map((attribute) => ({ ...attribute })),
    };
}
function findFrameIndex(stack, name) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].name === name)
            return index;
    }
    return -1;
}
function readName(text) {
    let name = '';
    for (const char of text) {
        if (!isNameChar(char))
            break;
        name += char;
    }
    return name;
}
function isNameChar(char) {
    return Boolean(char && /[A-Za-z0-9_:-]/.test(char));
}
