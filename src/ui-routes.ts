import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { createDiagnostic, fail } from './diagnostics.js';
import type { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { sendJson } from './ui-http.js';
import type { UiJobStore } from './ui-jobs.js';
import { handleAccountDelete, handleAccountLogin, handleAccountLoginJob, handleAccountTokenStatus, handleAccountUpdate, handleJobDelete, handleJobGet } from './ui-route-accounts.js';
import { handleUiAssetRoute, loadUiState } from './ui-route-assets.js';
import { handleDataverseQueryExecute, handleDataverseQueryPreview, handleEntityDetail, handleEntityList, handleFetchXmlExecute, handleFetchXmlIntellisense, handleFetchXmlPreview } from './ui-route-dataverse.js';
import { handleEnvironmentCreate, handleEnvironmentDelete, handleEnvironmentDiscover, handlePing, handleWhoAmICheck } from './ui-route-environments.js';
import { handleRequestExecute } from './ui-route-requests.js';

export interface UiRequestContext {
  configOptions: { configDir?: string };
  allowInteractiveAuth: boolean;
  host: string;
  port: number;
  jobs: UiJobStore;
  fetchXmlCatalog: FetchXmlMetadataCatalog;
  sendVendorModule: (response: ServerResponse, specifier: string) => Promise<void>;
}

export async function handleUiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: UiRequestContext,
): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${context.host}:${context.port}`);

  if (method === 'GET') {
    if (await handleUiAssetRoute(url, response, context)) return;
    if (url.pathname === '/api/state') return void sendJson(response, 200, await loadUiState(context));
    if (url.pathname === '/api/accounts/token-status') return void handleAccountTokenStatus(url, response, context);
    if (url.pathname === '/api/dv/entities') return void handleEntityList(url, response, context);
    if (/^\/api\/dv\/entities\/[^/]+$/.test(url.pathname)) return void handleEntityDetail(url, response, context);
    if (url.pathname.startsWith('/api/jobs/')) return void handleJobGet(url, response, context);
  }

  if (method === 'POST') {
    if (url.pathname === '/api/accounts/login') return void handleAccountLogin(request, response, context);
    if (url.pathname === '/api/jobs/account-login') return void handleAccountLoginJob(request, response, context);
    if (url.pathname === '/api/environments/discover') return void handleEnvironmentDiscover(request, response, context);
    if (url.pathname === '/api/environments') return void handleEnvironmentCreate(request, response, context);
    if (url.pathname === '/api/checks/whoami') return void handleWhoAmICheck(request, response, context);
    if (url.pathname === '/api/checks/ping') return void handlePing(request, response, context);
    if (url.pathname === '/api/dv/query/preview') return void handleDataverseQueryPreview(request, response);
    if (url.pathname === '/api/dv/query/execute') return void handleDataverseQueryExecute(request, response, context);
    if (url.pathname === '/api/dv/fetchxml/preview') return void handleFetchXmlPreview(request, response);
    if (url.pathname === '/api/dv/fetchxml/execute') return void handleFetchXmlExecute(request, response, context);
    if (url.pathname === '/api/dv/fetchxml/intellisense') return void handleFetchXmlIntellisense(request, response, context);
    if (url.pathname === '/api/request/execute') return void handleRequestExecute(request, response, context);
  }

  if (method === 'PUT' && url.pathname.startsWith('/api/accounts/')) {
    return void handleAccountUpdate(request, response, url, context);
  }

  if (method === 'DELETE') {
    if (url.pathname.startsWith('/api/jobs/')) return void handleJobDelete(url, response, context);
    if (url.pathname.startsWith('/api/accounts/')) return void handleAccountDelete(url, response, context);
    if (url.pathname.startsWith('/api/environments/')) return void handleEnvironmentDelete(url, response, context);
  }

  sendJson(response, 404, fail(createDiagnostic('error', 'NOT_FOUND', `No route for ${method} ${url.pathname}.`, { source: 'pp/ui' })));
}
