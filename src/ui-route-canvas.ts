import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { createDiagnostic, fail, ok } from './diagnostics.js';
import { readJsonBody, sendJson } from './ui-http.js';
import { optionalString } from './ui-request-parsing.js';
import type { UiRequestContext } from './ui-routes.js';
import { executeApiRequest } from './services/api.js';

export async function handleCanvasSessionCreate(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const environmentAlias = optionalString(body.data.environment ?? body.data.environmentAlias);
  const appId = optionalString(body.data.appId);
  if (!environmentAlias) return void sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
  if (!appId) return void sendJson(response, 400, fail(createDiagnostic('error', 'APP_ID_REQUIRED', 'appId is required.', { source: 'pp/ui' })));
  const session = await context.canvasSessions.createSession({
    environmentAlias,
    appId,
    accountName: optionalString(body.data.account),
    cadence: optionalString(body.data.cadence),
    clusterCategory: optionalString(body.data.clusterCategory),
    allowInteractive: context.allowInteractiveAuth,
    configOptions: context.configOptions,
  });
  sendJson(response, 202, ok(session));
}

export function handleCanvasSessionGet(url: URL, response: ServerResponse, context: UiRequestContext): void {
  const id = decodeURIComponent(url.pathname.slice('/api/canvas/sessions/'.length));
  const session = context.canvasSessions.getSession(id);
  if (!session) return void sendJson(response, 404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${id} was not found.`, { source: 'pp/ui' })));
  sendJson(response, 200, ok(session));
}

export function handleCanvasSessionList(_url: URL, response: ServerResponse, context: UiRequestContext): void {
  sendJson(response, 200, ok(context.canvasSessions.listSessions()));
}

export async function handleCanvasSessionDelete(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const id = decodeURIComponent(url.pathname.slice('/api/canvas/sessions/'.length));
  const session = await context.canvasSessions.endSession(id, context.configOptions);
  if (!session) return void sendJson(response, 404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${id} was not found.`, { source: 'pp/ui' })));
  sendJson(response, 200, ok(session));
}

export async function handleCanvasSessionProbe(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const id = decodeURIComponent(url.pathname.slice('/api/canvas/sessions/'.length).replace(/\/probe$/, ''));
  const session = await context.canvasSessions.probeSession(id, context.configOptions);
  if (!session) return void sendJson(response, 404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${id} was not found.`, { source: 'pp/ui' })));
  sendJson(response, 200, ok(session));
}

export function handleCanvasSessionEvents(url: URL, response: ServerResponse, context: UiRequestContext): void {
  const id = decodeURIComponent(url.pathname.slice('/api/canvas/sessions/'.length).replace(/\/events$/, ''));
  if (!context.canvasSessions.getSession(id)) {
    return void sendJson(response, 404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${id} was not found.`, { source: 'pp/ui' })));
  }
  context.canvasSessions.streamSession(id, response);
}

export async function handleCanvasRequest(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const sessionId = optionalString(body.data.sessionId);
  if (!sessionId) return void sendJson(response, 400, fail(createDiagnostic('error', 'SESSION_ID_REQUIRED', 'sessionId is required.', { source: 'pp/ui' })));
  const session = context.canvasSessions.getSession(sessionId);
  if (!session) return void sendJson(response, 404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${sessionId} was not found.`, { source: 'pp/ui' })));
  if (session.status !== 'active' || !session.result) {
    return void sendJson(response, 400, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_ACTIVE', `Canvas session ${sessionId} is not active.`, { source: 'pp/ui' })));
  }

  const endpointPath = optionalString(body.data.path);
  if (!endpointPath) return void sendJson(response, 400, fail(createDiagnostic('error', 'PATH_REQUIRED', 'path is required.', { source: 'pp/ui' })));

  const method = optionalString(body.data.method) ?? 'GET';
  const sessionResult = session.result;

  // Build the full URL against the authoring base using the session's version prefix if present
  const sessionState = extractSessionState(sessionResult.session);
  const fullUrl = `${sessionResult.authoringBaseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;

  const result = await executeApiRequest({
    environmentAlias: session.environmentAlias,
    accountName: session.accountName,
    api: 'canvas-authoring',
    path: fullUrl,
    method: method.toUpperCase(),
    headers: {
      'x-ms-client-session-id': sessionResult.sessionId,
      'x-ms-client-request-id': randomUUID(),
      ...(sessionState ? { 'x-ms-session-state': sessionState } : {}),
      ...(typeof body.data.headers === 'object' && body.data.headers ? body.data.headers as Record<string, string> : {}),
    },
    body: body.data.body,
    responseType: 'json',
    readIntent: method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD',
  }, context.configOptions, { allowInteractive: context.allowInteractiveAuth });

  sendJson(response, result.success ? 200 : 400, result);
}

function extractSessionState(session: unknown): string | undefined {
  if (!session || typeof session !== 'object') return undefined;
  const value = (session as Record<string, unknown>).sessionState;
  return typeof value === 'string' ? value : undefined;
}
