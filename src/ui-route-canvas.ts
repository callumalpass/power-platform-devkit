import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
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

export async function handleCanvasYamlFetch(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const sessionId = optionalString(body.data.sessionId);
  const outDir = optionalString(body.data.outDir);
  if (!sessionId) return void sendJson(response, 400, fail(createDiagnostic('error', 'SESSION_ID_REQUIRED', 'sessionId is required.', { source: 'pp/ui' })));
  if (!outDir) return void sendJson(response, 400, fail(createDiagnostic('error', 'OUT_DIR_REQUIRED', 'outDir is required.', { source: 'pp/ui' })));
  const session = context.canvasSessions.getSession(sessionId);
  if (!session || session.status !== 'active' || !session.result) {
    return void sendJson(response, 400, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_ACTIVE', 'Session is not active.', { source: 'pp/ui' })));
  }

  const sessionResult = session.result;
  const sessionState = extractSessionState(sessionResult.session);
  const version = (sessionResult.session as any)?.clientConfig?.webAuthoringVersion;
  const pathPrefix = version ? `/${version}` : '';
  const fullUrl = `${sessionResult.authoringBaseUrl}${pathPrefix}/api/yaml/fetch`;

  const fetchResult = await executeApiRequest({
    environmentAlias: session.environmentAlias,
    accountName: session.accountName,
    api: 'canvas-authoring',
    path: fullUrl,
    method: 'GET',
    headers: {
      'x-ms-client-session-id': sessionResult.sessionId,
      'x-ms-client-request-id': randomUUID(),
      ...(sessionState ? { 'x-ms-session-state': sessionState } : {}),
    },
    responseType: 'json',
    readIntent: true,
  }, context.configOptions, { allowInteractive: context.allowInteractiveAuth });

  if (!fetchResult.success) return void sendJson(response, 400, fetchResult);

  const files = readFilesArray(fetchResult.data?.response);
  if (!files) return void sendJson(response, 400, fail(createDiagnostic('error', 'CANVAS_YAML_FETCH_SHAPE', 'YAML fetch response did not contain a files array.', { source: 'pp/ui' })));

  const written: string[] = [];
  try {
    for (const file of files) {
      const path = String(file.path ?? '');
      const content = typeof file.content === 'string' ? file.content : undefined;
      if (!path || content === undefined) continue;
      const target = await resolveYamlOutputTarget(outDir, path);
      if (!target) continue;
      await mkdir(dirname(target), { recursive: true });
      if (!await isSafeExistingFileTarget(target)) continue;
      if (!await isSafeRealParent(outDir, dirname(target))) continue;
      await writeFile(target, content, 'utf8');
      written.push(path);
    }
  } catch (error) {
    return void sendJson(response, 500, fail(createDiagnostic('error', 'CANVAS_YAML_WRITE_FAILED', `Failed to write YAML files: ${error instanceof Error ? error.message : String(error)}`, { source: 'pp/ui' })));
  }

  sendJson(response, 200, ok({ files: written, outDir }));
}

export async function handleCanvasYamlValidate(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const sessionId = optionalString(body.data.sessionId);
  const dir = optionalString(body.data.dir);
  if (!sessionId) return void sendJson(response, 400, fail(createDiagnostic('error', 'SESSION_ID_REQUIRED', 'sessionId is required.', { source: 'pp/ui' })));
  if (!dir) return void sendJson(response, 400, fail(createDiagnostic('error', 'DIR_REQUIRED', 'dir is required.', { source: 'pp/ui' })));
  const session = context.canvasSessions.getSession(sessionId);
  if (!session || session.status !== 'active' || !session.result) {
    return void sendJson(response, 400, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_ACTIVE', 'Session is not active.', { source: 'pp/ui' })));
  }

  // Read .pa.yaml files from directory
  const yamlFiles: Array<{ path: string; content: string }> = [];
  try {
    await visitYamlDir(dir, dir, yamlFiles);
  } catch (error) {
    return void sendJson(response, 400, fail(createDiagnostic('error', 'CANVAS_YAML_DIR_READ_FAILED', `Failed to read YAML directory: ${error instanceof Error ? error.message : String(error)}`, { source: 'pp/ui' })));
  }

  if (yamlFiles.length === 0) {
    return void sendJson(response, 400, fail(createDiagnostic('error', 'CANVAS_YAML_DIR_EMPTY', `No .pa.yaml files found in ${dir}.`, { source: 'pp/ui' })));
  }

  const sessionResult = session.result;
  const sessionState = extractSessionState(sessionResult.session);
  const version = (sessionResult.session as any)?.clientConfig?.webAuthoringVersion;
  const pathPrefix = version ? `/${version}` : '';
  const fullUrl = `${sessionResult.authoringBaseUrl}${pathPrefix}/api/yaml/validate-directory`;

  const validateResult = await executeApiRequest({
    environmentAlias: session.environmentAlias,
    accountName: session.accountName,
    api: 'canvas-authoring',
    path: fullUrl,
    method: 'POST',
    headers: {
      'x-ms-client-session-id': sessionResult.sessionId,
      'x-ms-client-request-id': randomUUID(),
      ...(sessionState ? { 'x-ms-session-state': sessionState } : {}),
    },
    body: { files: yamlFiles },
    responseType: 'json',
    readIntent: false,
  }, context.configOptions, { allowInteractive: context.allowInteractiveAuth });

  sendJson(response, validateResult.success ? 200 : 400, validateResult);
}

async function visitYamlDir(root: string, dir: string, out: Array<{ path: string; content: string }>): Promise<void> {
  for (const entry of await readdir(dir)) {
    const fullPath = join(dir, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      await visitYamlDir(root, fullPath, out);
    } else if (/\.pa\.ya?ml$/i.test(entry)) {
      out.push({ path: relative(root, fullPath).replace(/\\/g, '/'), content: await readFile(fullPath, 'utf8') });
    }
  }
}

async function resolveYamlOutputTarget(rootDir: string, filePath: string): Promise<string | undefined> {
  if (
    filePath.includes('\\') ||
    isAbsolute(filePath) ||
    win32.isAbsolute(filePath) ||
    filePath.split('/').includes('..')
  ) {
    return undefined;
  }
  const root = resolve(rootDir);
  const target = resolve(root, filePath);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return target;
}

async function isSafeExistingFileTarget(target: string): Promise<boolean> {
  try {
    const info = await lstat(target);
    return !info.isSymbolicLink();
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
  }
}

async function isSafeRealParent(rootDir: string, parentDir: string): Promise<boolean> {
  const [root, parent] = await Promise.all([realpath(rootDir), realpath(parentDir)]);
  const rel = relative(root, parent);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function readFilesArray(value: unknown): Array<Record<string, unknown>> | undefined {
  const response = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  const files = Array.isArray(response?.files) ? response.files : undefined;
  return files?.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === 'object'));
}

function extractSessionState(session: unknown): string | undefined {
  if (!session || typeof session !== 'object') return undefined;
  const value = (session as Record<string, unknown>).sessionState;
  return typeof value === 'string' ? value : undefined;
}
