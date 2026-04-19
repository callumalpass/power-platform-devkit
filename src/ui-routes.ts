import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import process from 'node:process';
import { getConfigDir } from './config.js';
import { createDiagnostic, fail } from './diagnostics.js';
import type { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { sendJson } from './ui-http.js';
import type { AuthSessionStore } from './ui-auth-sessions.js';
import type { CanvasSessionStore } from './ui-canvas-sessions.js';
import type { UiJobStore } from './ui-jobs.js';
import { handleAccountBrowserProfileGet, handleAccountBrowserProfileOpen, handleAccountBrowserProfileReset, handleAccountBrowserProfileVerify, handleAccountCreate, handleAccountDelete, handleAccountLogin, handleAccountLoginJob, handleAccountTokenStatus, handleAccountUpdate, handleAuthSessionCancel, handleAuthSessionCreate, handleAuthSessionEvents, handleAuthSessionGet, handleJobDelete, handleJobGet } from './ui-route-accounts.js';
import { handleUiAssetRoute, loadUiState } from './ui-route-assets.js';
import { handleDataverseQueryExecute, handleDataverseQueryPreview, handleDataverseRecordCreate, handleEntityDetail, handleEntityList, handleFetchXmlExecute, handleFetchXmlIntellisense, handleFetchXmlPreview } from './ui-route-dataverse.js';
import { handleEnvironmentCreate, handleEnvironmentDelete, handleEnvironmentDiscover, handleEnvironmentUpdate, handlePing, handleWhoAmICheck } from './ui-route-environments.js';
import { handleCanvasRequest, handleCanvasSessionCreate, handleCanvasSessionDelete, handleCanvasSessionEvents, handleCanvasSessionGet, handleCanvasSessionList, handleCanvasSessionProbe, handleCanvasYamlFetch, handleCanvasYamlValidate } from './ui-route-canvas.js';
import { handleFlowLanguageAnalyze } from './ui-route-flow-language.js';
import { handleCliRequestExecute, handleRequestExecute } from './ui-route-requests.js';
import { handleTemporaryTokenCreate, handleTemporaryTokenDelete, handleTemporaryTokenList } from './ui-route-temp-tokens.js';
import type { TemporaryTokenStore } from './temporary-tokens.js';

export interface UiRequestContext {
  configOptions: { configDir?: string };
  allowInteractiveAuth: boolean;
  host: string;
  port: number;
  jobs: UiJobStore;
  authSessions: AuthSessionStore;
  canvasSessions: CanvasSessionStore;
  temporaryTokens: TemporaryTokenStore;
  fetchXmlCatalog: FetchXmlMetadataCatalog;
  sendVendorModule: (response: ServerResponse, specifier: string) => Promise<void>;
  instanceId: string;
  cliSecret: string;
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
    if (/^\/api\/accounts\/[^/]+\/browser-profile$/.test(url.pathname)) return handleAccountBrowserProfileGet(url, response, context);
    if (/^\/api\/auth\/sessions\/[^/]+\/events$/.test(url.pathname)) return handleAuthSessionEvents(url, response, context);
    if (/^\/api\/auth\/sessions\/[^/]+$/.test(url.pathname)) return handleAuthSessionGet(url, response, context);
    if (url.pathname === '/api/temp-tokens') return handleTemporaryTokenList(response, context);
    if (url.pathname === '/api/canvas/sessions') return handleCanvasSessionList(url, response, context);
    if (/^\/api\/canvas\/sessions\/[^/]+\/events$/.test(url.pathname)) return handleCanvasSessionEvents(url, response, context);
    if (/^\/api\/canvas\/sessions\/[^/]+$/.test(url.pathname)) return handleCanvasSessionGet(url, response, context);
    if (url.pathname === '/api/dv/entities') return handleEntityList(url, response, context);
    if (/^\/api\/dv\/entities\/[^/]+$/.test(url.pathname)) return handleEntityDetail(url, response, context);
    if (url.pathname.startsWith('/api/jobs/')) return handleJobGet(url, response, context);
  }

  if (method === 'POST') {
    if (url.pathname === '/api/ui/shutdown') {
      sendJson(response, 200, { success: true, diagnostics: [], data: { message: 'Shutting down.' } });
      setTimeout(() => process.exit(0), 100);
      return;
    }
    if (url.pathname === '/api/accounts') return handleAccountCreate(request, response, context);
    if (url.pathname === '/api/accounts/login') return handleAccountLogin(request, response, context);
    if (/^\/api\/accounts\/[^/]+\/browser-profile\/open$/.test(url.pathname)) return handleAccountBrowserProfileOpen(request, response, url, context);
    if (/^\/api\/accounts\/[^/]+\/browser-profile\/verify$/.test(url.pathname)) return handleAccountBrowserProfileVerify(request, response, url, context);
    if (url.pathname === '/api/auth/sessions') return handleAuthSessionCreate(request, response, context);
    if (/^\/api\/auth\/sessions\/[^/]+\/cancel$/.test(url.pathname)) return handleAuthSessionCancel(url, response, context);
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
    if (url.pathname === '/api/canvas/sessions') return handleCanvasSessionCreate(request, response, context);
    if (/^\/api\/canvas\/sessions\/[^/]+\/probe$/.test(url.pathname)) return handleCanvasSessionProbe(url, response, context);
    if (url.pathname === '/api/canvas/request') return handleCanvasRequest(request, response, context);
    if (url.pathname === '/api/canvas/yaml/fetch') return handleCanvasYamlFetch(request, response, context);
    if (url.pathname === '/api/canvas/yaml/validate') return handleCanvasYamlValidate(request, response, context);
    if (url.pathname === '/api/flow/language/analyze') return handleFlowLanguageAnalyze(request, response);
    if (url.pathname === '/api/request/execute') return handleRequestExecute(request, response, context);
    if (url.pathname === '/api/temp-tokens') return handleTemporaryTokenCreate(request, response, context);
    if (url.pathname === '/api/cli/request') return handleCliRequestExecute(request, response, context);
  }

  if (method === 'PUT' && /^\/api\/accounts\/[^/]+$/.test(url.pathname)) {
    return handleAccountUpdate(request, response, url, context);
  }

  if (method === 'PUT' && /^\/api\/environments\/[^/]+$/.test(url.pathname)) {
    return handleEnvironmentUpdate(request, response, url, context);
  }

  if (method === 'DELETE') {
    if (url.pathname.startsWith('/api/jobs/')) return handleJobDelete(url, response, context);
    if (url.pathname.startsWith('/api/temp-tokens/')) return handleTemporaryTokenDelete(url, response, context);
    if (/^\/api\/accounts\/[^/]+\/browser-profile$/.test(url.pathname)) return handleAccountBrowserProfileReset(url, response, context);
    if (/^\/api\/accounts\/[^/]+$/.test(url.pathname)) return handleAccountDelete(url, response, context);
    if (url.pathname.startsWith('/api/environments/')) return handleEnvironmentDelete(url, response, context);
    if (url.pathname.startsWith('/api/canvas/sessions/')) return handleCanvasSessionDelete(url, response, context);
  }

  sendJson(response, 404, fail(createDiagnostic('error', 'NOT_FOUND', `No route for ${method} ${url.pathname}.`, { source: 'pp/ui' })));
}
