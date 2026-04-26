import { api } from './utils.js';
import type { ApiEnvelope, DataverseEntityDetail, DataverseRecordPage, DiagnosticItem } from './ui-types.js';

export type FetchXmlCompletionItem = {
  label: string;
  type?: string;
  detail?: string;
  info?: string;
  apply?: string;
};

export type FetchXmlAnalysis = {
  diagnostics: DiagnosticItem[];
  completions: FetchXmlCompletionItem[];
  context?: { from?: number; to?: number };
};

export type FetchXmlCondition = { attribute: string; operator: string; value?: string };
export type FetchXmlLinkEntity = {
  name: string;
  from: string;
  to: string;
  linkType: 'inner' | 'outer';
  alias?: string;
  attributes?: string[];
  conditions?: FetchXmlCondition[];
};

export type FetchXmlPayload = {
  environmentAlias: string;
  entity: string;
  entitySetName?: string;
  attributes?: string[];
  distinct?: boolean;
  top?: number;
  filterType?: 'and' | 'or';
  conditions?: FetchXmlCondition[];
  orders?: Array<{ attribute: string; descending: boolean }>;
  linkEntities?: FetchXmlLinkEntity[];
  rawXml?: string;
};

export async function getEntityDetail(environment: string, logicalName: string): Promise<DataverseEntityDetail> {
  const payload = await api<ApiEnvelope<DataverseEntityDetail>>(`/api/dv/entities/${encodeURIComponent(logicalName)}?environment=${encodeURIComponent(environment)}`);
  return payload.data;
}

export async function analyzeFetchXml(input: { environmentAlias: string; source: string; rootEntityName?: string; cursor?: number }): Promise<FetchXmlAnalysis> {
  const payload = await api<ApiEnvelope<Partial<FetchXmlAnalysis>>>('/api/dv/fetchxml/intellisense', {
    method: 'POST',
    body: JSON.stringify({
      environmentAlias: input.environmentAlias,
      source: input.source,
      cursor: input.cursor ?? input.source.length,
      rootEntityName: input.rootEntityName
    })
  });
  return {
    diagnostics: payload.data?.diagnostics || [],
    completions: payload.data?.completions || [],
    context: payload.data?.context
  };
}

export async function previewFetchXml(payload: FetchXmlPayload): Promise<string> {
  const result = await api<ApiEnvelope<{ fetchXml?: string }>>('/api/dv/fetchxml/preview', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return result.data?.fetchXml || '';
}

export async function executeFetchXml(payload: FetchXmlPayload): Promise<DataverseRecordPage> {
  const result = await api<ApiEnvelope<DataverseRecordPage>>('/api/dv/fetchxml/execute', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return result.data;
}
