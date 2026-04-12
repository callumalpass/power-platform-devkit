import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import process from 'node:process';
import { getConfigDir } from './config.js';
import { createDiagnostic, fail } from './diagnostics.js';
import type { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { sendJson } from './ui-http.js';
import type { UiJobStore } from './ui-jobs.js';
import { handleAccountCreate, handleAccountDelete, handleAccountLogin, handleAccountLoginJob, handleAccountTokenStatus, handleAccountUpdate, handleJobDelete, handleJobGet } from './ui-route-accounts.js';
import { handleUiAssetRoute, loadUiState } from './ui-route-assets.js';
import { handleDataverseQueryExecute, handleDataverseQueryPreview, handleDataverseRecordCreate, handleEntityDetail, handleEntityList, handleFetchXmlExecute, handleFetchXmlIntellisense, handleFetchXmlPreview } from './ui-route-dataverse.js';
import { handleEnvironmentCreate, handleEnvironmentDelete, handleEnvironmentDiscover, handlePing, handleWhoAmICheck } from './ui-route-environments.js';
import { handleFlowLanguageAnalyze } from './ui-route-flow-language.js';
import { handleRequestExecute } from './ui-route-requests.js';

export interface UiRequestContext {
  configOptions: { configDir?: string };
  allowInteractiveAuth: boolean;
  host: string;
  port: number;
  jobs: UiJobStore;
  fetchXmlCatalog: FetchXmlMetadataCatalog;
  sendVendorModule: (response: ServerResponse, specifier: string) => Promise<void>;
  instanceId: string;
  serverUrl: string;
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
    if (url.pathname === '/api/ui/status') {
      return void sendJson(response, 200, {
        success: true,
        diagnostics: [],
        data: {
          kind: 'pp-ui',
          instanceId: context.instanceId,
          url: context.serverUrl,
          configDir: getConfigDir(context.configOptions),
          pid: process.pid,
        },
      });
    }
    if (url.pathname === '/api/state') return void sendJson(response, 200, await loadUiState(context));
    if (url.pathname === '/api/accounts/token-status') return handleAccountTokenStatus(url, response, context);
    if (url.pathname === '/api/dv/entities') return handleEntityList(url, response, context);
    if (/^\/api\/dv\/entities\/[^/]+$/.test(url.pathname)) return handleEntityDetail(url, response, context);
    if (url.pathname.startsWith('/api/jobs/')) return handleJobGet(url, response, context);
  }

  if (method === 'POST') {
    if (url.pathname === '/api/accounts') return handleAccountCreate(request, response, context);
    if (url.pathname === '/api/accounts/login') return handleAccountLogin(request, response, context);
    if (url.pathname === '/api/jobs/account-login') return handleAccountLoginJob(request, response, context);
    if (url.pathname === '/api/environments/discover') return handleEnvironmentDiscover(request, response, context);
    if (url.pathname === '/api/environments') return handleEnvironmentCreate(request, response, context);
    if (url.pathname === '/api/checks/whoami') return handleWhoAmICheck(request, response, context);
    if (url.pathname === '/api/checks/ping') return handlePing(request, response, context);
    if (url.pathname === '/api/dv/query/preview') return handleDataverseQueryPreview(request, response);
    if (url.pathname === '/api/dv/query/execute') return handleDataverseQueryExecute(request, response, context);
    if (url.pathname === '/api/dv/records/create') return handleDataverseRecordCreate(request, response, context);
    if (url.pathname === '/api/dv/fetchxml/preview') return handleFetchXmlPreview(request, response);
    if (url.pathname === '/api/dv/fetchxml/execute') return handleFetchXmlExecute(request, response, context);
    if (url.pathname === '/api/dv/fetchxml/intellisense') return handleFetchXmlIntellisense(request, response, context);
    if (url.pathname === '/api/flow/language/analyze') return handleFlowLanguageAnalyze(request, response);
    if (url.pathname === '/api/request/execute') return handleRequestExecute(request, response, context);
  }

  if (method === 'PUT' && url.pathname.startsWith('/api/accounts/')) {
    return handleAccountUpdate(request, response, url, context);
  }

  if (method === 'DELETE') {
    if (url.pathname.startsWith('/api/jobs/')) return handleJobDelete(url, response, context);
    if (url.pathname.startsWith('/api/accounts/')) return handleAccountDelete(url, response, context);
    if (url.pathname.startsWith('/api/environments/')) return handleEnvironmentDelete(url, response, context);
  }

  sendJson(response, 404, fail(createDiagnostic('error', 'NOT_FOUND', `No route for ${method} ${url.pathname}.`, { source: 'pp/ui' })));
}
