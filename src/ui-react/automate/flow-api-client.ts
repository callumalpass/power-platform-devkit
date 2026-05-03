import { api } from '../utils.js';
import type { ApiEnvelope, ApiExecuteResponse } from '../ui-types.js';

export const DATAVERSE_FLOW_FALLBACK_PATH =
  '/workflows?$filter=category eq 5&$select=name,workflowid,workflowidunique,createdon,modifiedon,statecode,statuscode,_ownerid_value,description,clientdata&$orderby=modifiedon desc&$top=200';
export const CONNECTIONS_FOR_ENVIRONMENT_PATH = '/connections?$filter=environment%20eq%20%27{environment}%27';

export async function executeFlowUiRequest<T>(
  environment: string,
  apiKind: string,
  path: string,
  allowInteractive = true,
  method = 'GET',
  body?: unknown,
  query?: Record<string, string>,
  responseType?: 'json' | 'text' | 'void'
) {
  const result = await api<ApiEnvelope<ApiExecuteResponse<T>>>('/api/request/execute', {
    method: 'POST',
    body: JSON.stringify({
      environment,
      api: apiKind,
      method,
      path,
      ...(query ? { query } : {}),
      allowInteractive,
      softFail: !allowInteractive,
      ...(responseType ? { responseType } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  });
  return result.data;
}
