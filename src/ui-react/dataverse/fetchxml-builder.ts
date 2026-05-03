import type { FetchXmlCondition, FetchXmlLinkEntity, FetchXmlPayload } from '../dataverse-data.js';
import type { DataverseEntityDetail, DiagnosticItem } from '../ui-types.js';

export type ConditionRow = { id: number; attribute: string; operator: string; value: string };

export type LinkRow = {
  id: number;
  name: string;
  from: string;
  to: string;
  linkType: 'inner' | 'outer';
  alias: string;
  attributes: string[];
  conditions: ConditionRow[];
};

export const FETCH_XML_OPERATORS = [
  'eq',
  'ne',
  'gt',
  'ge',
  'lt',
  'le',
  'like',
  'not-like',
  'begins-with',
  'not-begin-with',
  'ends-with',
  'not-end-with',
  'in',
  'not-in',
  'between',
  'not-between',
  'null',
  'not-null',
  'above',
  'under',
  'eq-or-above',
  'eq-or-under',
  'contain-values',
  'not-contain-values',
  'eq-userid',
  'ne-userid',
  'eq-businessid',
  'ne-businessid',
  'yesterday',
  'today',
  'tomorrow',
  'last-x-hours',
  'next-x-hours',
  'last-x-days',
  'next-x-days',
  'last-x-weeks',
  'next-x-weeks',
  'last-x-months',
  'next-x-months',
  'last-x-years',
  'next-x-years',
  'this-month',
  'this-year',
  'this-week',
  'last-month',
  'last-year',
  'last-week',
  'next-month',
  'next-year',
  'next-week'
] as const;

export function createConditionRow(): ConditionRow {
  return { id: nextFetchXmlRowId(), attribute: '', operator: '', value: '' };
}

export function createLinkRow(): LinkRow {
  return {
    id: nextFetchXmlRowId(),
    name: '',
    from: '',
    to: '',
    linkType: 'inner',
    alias: '',
    attributes: [],
    conditions: [createConditionRow()]
  };
}

export function addConditionRow(rows: ConditionRow[]): ConditionRow[] {
  return [...rows, createConditionRow()];
}

export function replaceConditionRow(rows: ConditionRow[], id: number, patch: Partial<ConditionRow>): ConditionRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export function removeConditionRow(rows: ConditionRow[], id: number): ConditionRow[] {
  return rows.filter((row) => row.id !== id);
}

export function formatDiagnosticsCount(items: DiagnosticItem[]): string {
  const errors = items.filter((item) => item.level === 'error').length;
  const warnings = items.filter((item) => item.level === 'warning').length;
  if (errors) return `${errors} issue${errors === 1 ? '' : 's'}`;
  if (warnings) return `${warnings} advisory warning${warnings === 1 ? '' : 's'}`;
  return 'IntelliSense ready';
}

export function buildRawFetchXml(entityName: string, attributes: string[]): string {
  const attrs = attributes.map((attribute) => `    <attribute name="${attribute}" />`).join('\n');
  return `<fetch top="50">\n  <entity name="${entityName}">\n${attrs || '    <all-attributes />'}\n  </entity>\n</fetch>`;
}

export function buildFetchXmlPayload(input: {
  environment: string;
  entityName: string;
  entityDetail: Pick<DataverseEntityDetail, 'logicalName' | 'entitySetName'> | null | undefined;
  selectedAttrs: string[];
  distinct: boolean;
  filterType: 'and' | 'or';
  conditions: ConditionRow[];
  orderAttribute: string;
  orderDescending: boolean;
  links: LinkRow[];
  top?: number;
}): FetchXmlPayload {
  const activeEntityName = input.entityName || input.entityDetail?.logicalName || '';
  const payload: FetchXmlPayload = {
    environmentAlias: input.environment,
    entity: activeEntityName,
    attributes: input.selectedAttrs,
    distinct: input.distinct,
    top: input.top ?? 50,
    filterType: input.filterType,
    conditions: buildFetchXmlConditions(input.conditions),
    orders: input.orderAttribute ? [{ attribute: input.orderAttribute, descending: input.orderDescending }] : [],
    linkEntities: buildFetchXmlLinkEntities(input.links)
  };
  if (input.entityDetail?.entitySetName) payload.entitySetName = input.entityDetail.entitySetName;
  return payload;
}

function buildFetchXmlConditions(rows: ConditionRow[]): FetchXmlCondition[] {
  return rows
    .filter((row) => row.attribute && row.operator)
    .map((row) => {
      const condition: FetchXmlCondition = { attribute: row.attribute, operator: row.operator };
      if (row.value) condition.value = row.value;
      return condition;
    });
}

function buildFetchXmlLinkEntities(rows: LinkRow[]): FetchXmlLinkEntity[] {
  return rows
    .filter((link) => link.name && link.from && link.to)
    .map((link) => {
      const linkEntity: FetchXmlLinkEntity = {
        name: link.name,
        from: link.from,
        to: link.to,
        linkType: link.linkType,
        conditions: buildFetchXmlConditions(link.conditions)
      };
      if (link.alias) linkEntity.alias = link.alias;
      if (link.attributes.length) linkEntity.attributes = link.attributes;
      return linkEntity;
    });
}

function nextFetchXmlRowId(): number {
  return Date.now() + Math.floor(Math.random() * 1000);
}
