import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { getCanvasSessionsPath, type ConfigStoreOptions } from '../config.js';
import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';
import { executeApiRequest, getEnvironmentToken } from './api.js';

export interface StartCanvasAuthoringSessionInput {
  environmentAlias: string;
  accountName?: string;
  appId: string;
  cadence?: string;
  clusterCategory?: string;
  raw?: boolean;
  allowInteractive?: boolean;
  onDeviceCode?: (info: { verificationUri: string; userCode: string; message: string }) => void | Promise<void>;
}

export interface CanvasAuthoringClusterInfo {
  geoName?: string;
  clusterNumber?: string | number;
  environment?: string;
  clusterCategory?: string;
  [key: string]: unknown;
}

export interface StartCanvasAuthoringSessionResult {
  appId: string;
  environmentId: string;
  tenantId?: string;
  account: string;
  sessionId: string;
  startRequestId: string;
  cluster: CanvasAuthoringClusterInfo;
  authoringBaseUrl: string;
  webAuthoringVersion?: string;
  sessionState?: string;
  startPath: string;
  startStatus: number;
  session: unknown;
}

export interface InvokeCanvasAuthoringInput {
  environmentAlias: string;
  accountName?: string;
  appId: string;
  className: string;
  oid: string;
  methodName: string;
  payload?: unknown;
  sessionId?: string;
  sessionState?: string;
  authoringBaseUrl?: string;
  webAuthoringVersion?: string;
  sequence?: number;
  confirmation?: number;
  cadence?: string;
  clusterCategory?: string;
  allowInteractive?: boolean;
}

export interface InvokeCanvasAuthoringResult {
  appId: string;
  environmentId: string;
  tenantId?: string;
  account: string;
  sessionId: string;
  requestId: string;
  url: string;
  invoke: {
    className: string;
    oid: string;
    methodName: string;
    payloadKey: string;
  };
  status: number;
  response: unknown;
  headers: Record<string, string>;
}

export interface RpcCanvasAuthoringResult extends InvokeCanvasAuthoringResult {
  signalR: {
    negotiateUrl: string;
    websocketUrl: string;
    timeoutMs: number;
  };
  rpcResponse: unknown;
  decodedResult?: unknown;
}

export interface RequestCanvasAuthoringSessionInput {
  environmentAlias: string;
  accountName?: string;
  appId: string;
  path: string;
  method?: string;
  body?: unknown;
  rawBody?: string;
  responseType?: 'json' | 'text' | 'void';
  sessionId?: string;
  sessionState?: string;
  authoringBaseUrl?: string;
  webAuthoringVersion?: string;
  cadence?: string;
  clusterCategory?: string;
  allowInteractive?: boolean;
  readIntent?: boolean;
  keepSignalRAlive?: boolean;
  signalRTimeoutMs?: number;
}

export interface RequestCanvasAuthoringSessionResult {
  appId: string;
  environmentId: string;
  tenantId?: string;
  account: string;
  sessionId: string;
  requestId: string;
  url: string;
  method: string;
  status: number;
  response: unknown;
  headers: Record<string, string>;
}

interface ResolvedCanvasAuthoringSession {
  appId: string;
  sessionId: string;
  sessionState: string;
  authoringBaseUrl: string;
  webAuthoringVersion: string;
  environmentId: string;
  tenantId?: string;
  account: string;
}

export async function startCanvasAuthoringSession(input: StartCanvasAuthoringSessionInput, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<StartCanvasAuthoringSessionResult>> {
  const loginOptions = { allowInteractive: input.allowInteractive, onDeviceCode: input.onDeviceCode, terminalPrompts: !input.onDeviceCode };
  const clusterResult = await executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'canvas-authoring',
      path: '/gateway/cluster',
      method: 'GET',
      responseType: 'json',
      readIntent: true
    },
    configOptions,
    loginOptions
  );
  if (!clusterResult.success || !clusterResult.data) return fail(...clusterResult.diagnostics);

  const cluster = asClusterInfo(clusterResult.data.response);
  const authoringBaseUrl = buildCanvasAuthoringBaseUrl(cluster, input.clusterCategory);
  if (!authoringBaseUrl.success || !authoringBaseUrl.data) return fail(...authoringBaseUrl.diagnostics);
  let resolvedAuthoringBaseUrl = authoringBaseUrl.data;

  const appId = normalizeCanvasAppId(input.appId);
  const environmentId = clusterResult.data.request.environment!.makerEnvironmentId;
  const tenantId = clusterResult.data.request.environment!.tenantId;
  let startPath = buildCanvasAuthoringSessionStartUrl(resolvedAuthoringBaseUrl, environmentId, input.cadence);
  const sessionId = randomUUID();
  const startRequestId = randomUUID();
  let startResult = await executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'canvas-authoring',
      path: startPath,
      method: 'POST',
      headers: {
        'x-ms-client-session-id': sessionId,
        'x-ms-client-request-id': startRequestId,
        'x-ms-environment-name': environmentId,
        'x-ms-environment-update-cadence': input.cadence ?? 'Frequent',
        'x-ms-app-name': `/providers/Microsoft.PowerApps/apps/${appId}`
      },
      responseType: 'json',
      readIntent: true
    },
    configOptions,
    loginOptions
  );
  if (!startResult.success) {
    const redirectedStartPath = readCanvasAuthoringRedirectionUrl(startResult.diagnostics);
    if (redirectedStartPath) {
      startPath = redirectedStartPath;
      resolvedAuthoringBaseUrl = new URL(redirectedStartPath).origin;
      startResult = await executeApiRequest(
        {
          environmentAlias: input.environmentAlias,
          accountName: input.accountName,
          api: 'canvas-authoring',
          path: startPath,
          method: 'POST',
          headers: {
            'x-ms-client-session-id': sessionId,
            'x-ms-client-request-id': startRequestId,
            'x-ms-environment-name': environmentId,
            'x-ms-environment-update-cadence': input.cadence ?? 'Frequent',
            'x-ms-app-name': `/providers/Microsoft.PowerApps/apps/${appId}`
          },
          responseType: 'json',
          readIntent: true
        },
        configOptions,
        loginOptions
      );
    }
  }
  if (!startResult.success || !startResult.data) return fail(...startResult.diagnostics);

  const sessionState = readStringProperty(startResult.data.response, 'sessionState');
  const webAuthoringVersion =
    readStringProperty(readObjectProperty(startResult.data.response, 'clientConfig'), 'webAuthoringVersion') ?? readStringProperty(startResult.data.response, 'authoringHostVersion');

  return ok(
    {
      appId,
      environmentId,
      tenantId,
      account: startResult.data.request.accountName,
      sessionId,
      startRequestId,
      cluster,
      authoringBaseUrl: resolvedAuthoringBaseUrl,
      webAuthoringVersion,
      sessionState,
      startPath: new URL(startPath).pathname,
      startStatus: startResult.data.status,
      session: input.raw ? startResult.data.response : redactCanvasAuthoringSession(startResult.data.response)
    },
    [...clusterResult.diagnostics, ...startResult.diagnostics]
  );
}

export async function invokeCanvasAuthoring(input: InvokeCanvasAuthoringInput, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<InvokeCanvasAuthoringResult>> {
  const session = await resolveCanvasAuthoringSession(input, configOptions);
  if (!session.success || !session.data) return fail(...session.diagnostics);
  const requestId = randomUUID();
  const sequence = input.sequence ?? 1;
  const confirmation = input.confirmation ?? 0;
  const envelope = buildInvokeEnvelope(input, session.data, requestId, sequence, confirmation);

  const url = buildInvokeUrl(session.data);
  const result = await executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'canvas-authoring',
      path: url,
      method: 'POST',
      headers: {
        'x-ms-client-session-id': session.data.sessionId,
        'x-ms-session-state': session.data.sessionState,
        'x-ms-client-request-id': requestId,
        'x-ms-reliablewiremeta': envelope.reliableWireMetaHeader,
        'x-ms-correlation-request-id': session.data.sessionId,
        'x-ms-domain-name': session.data.authoringBaseUrl,
        'x-ms-environment-name': session.data.environmentId,
        'x-ms-client-tenant-id': session.data.tenantId ?? '',
        'x-ms-app-name': `/providers/Microsoft.PowerApps/apps/${session.data.appId}`
      },
      body: envelope.body,
      responseType: 'json'
    },
    configOptions,
    { allowInteractive: input.allowInteractive }
  );
  if (!result.success || !result.data) return fail(...result.diagnostics);

  return ok(
    {
      appId: session.data.appId,
      environmentId: session.data.environmentId,
      tenantId: session.data.tenantId,
      account: session.data.account,
      sessionId: session.data.sessionId,
      requestId,
      url,
      invoke: {
        className: envelope.className,
        oid: input.oid,
        methodName: envelope.methodName,
        payloadKey: envelope.payloadKey
      },
      status: result.data.status,
      response: result.data.response,
      headers: result.data.headers
    },
    [...session.diagnostics, ...result.diagnostics]
  );
}

export async function rpcCanvasAuthoring(input: InvokeCanvasAuthoringInput & { timeoutMs?: number }, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<RpcCanvasAuthoringResult>> {
  const session = await resolveCanvasAuthoringSession(input, configOptions);
  if (!session.success || !session.data) return fail(...session.diagnostics);

  const token = await getEnvironmentToken(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'canvas-authoring',
      allowInteractive: input.allowInteractive
    },
    configOptions
  );
  if (!token.success || !token.data) return fail(...token.diagnostics);

  const requestId = randomUUID();
  const sequence = input.sequence ?? 1;
  const confirmation = input.confirmation ?? 0;
  const envelope = buildInvokeEnvelope(input, session.data, requestId, sequence, confirmation);
  const timeoutMs = input.timeoutMs ?? 30_000;

  const signalR = await invokeViaSignalR(session.data, token.data, envelope.body, requestId, timeoutMs);
  if (!signalR.success || !signalR.data) return fail(...signalR.diagnostics);

  const rpcResponse = signalR.data.rpcResponse;
  return ok(
    {
      appId: session.data.appId,
      environmentId: session.data.environmentId,
      tenantId: session.data.tenantId,
      account: session.data.account,
      sessionId: session.data.sessionId,
      requestId,
      url: buildInvokeUrl(session.data),
      invoke: {
        className: envelope.className,
        oid: input.oid,
        methodName: envelope.methodName,
        payloadKey: envelope.payloadKey
      },
      status: readNumberProperty(rpcResponse, 'status') ?? 0,
      response: undefined,
      headers: {},
      signalR: {
        negotiateUrl: signalR.data.negotiateUrl,
        websocketUrl: redactAccessToken(signalR.data.websocketUrl),
        timeoutMs
      },
      rpcResponse,
      decodedResult: decodeRpcResult(rpcResponse)
    },
    [...session.diagnostics, ...token.diagnostics, ...signalR.diagnostics]
  );
}

export async function requestCanvasAuthoringSession(input: RequestCanvasAuthoringSessionInput, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<RequestCanvasAuthoringSessionResult>> {
  const session = await resolveCanvasAuthoringSession(input, configOptions);
  if (!session.success || !session.data) return fail(...session.diagnostics);

  let heldSignalR: HeldSignalRConnection | undefined;
  const extraDiagnostics = [...session.diagnostics];
  if (input.keepSignalRAlive) {
    const token = await getEnvironmentToken(
      {
        environmentAlias: input.environmentAlias,
        accountName: input.accountName ?? session.data.account,
        api: 'canvas-authoring',
        allowInteractive: input.allowInteractive
      },
      configOptions
    );
    if (!token.success || !token.data) return fail(...session.diagnostics, ...token.diagnostics);
    extraDiagnostics.push(...token.diagnostics);
    const connection = await openSignalRConnection(session.data, token.data, input.signalRTimeoutMs ?? 30_000);
    if (!connection.success || !connection.data) return fail(...extraDiagnostics, ...connection.diagnostics);
    heldSignalR = connection.data;
    extraDiagnostics.push(...connection.diagnostics);
    const keepAlive = await sendSignalRKeepAlive(session.data, heldSignalR.socket, input.signalRTimeoutMs ?? 30_000);
    if (!keepAlive.success) return fail(...extraDiagnostics, ...keepAlive.diagnostics);
    extraDiagnostics.push(...keepAlive.diagnostics);
  }

  const requestId = randomUUID();
  const method = (input.method ?? 'GET').toUpperCase();
  const url = buildVersionedAuthoringUrl(session.data, input.path);
  try {
    const result = await executeApiRequest(
      {
        environmentAlias: input.environmentAlias,
        accountName: input.accountName ?? session.data.account,
        api: 'canvas-authoring',
        path: url,
        method,
        headers: {
          'x-ms-client-session-id': session.data.sessionId,
          'x-ms-session-state': session.data.sessionState,
          'x-ms-client-request-id': requestId,
          'x-ms-correlation-request-id': session.data.sessionId,
          'x-ms-domain-name': session.data.authoringBaseUrl,
          'x-ms-environment-name': session.data.environmentId,
          'x-ms-client-tenant-id': session.data.tenantId ?? '',
          'x-ms-app-name': `/providers/Microsoft.PowerApps/apps/${session.data.appId}`
        },
        body: input.body,
        rawBody: input.rawBody,
        responseType: input.responseType ?? 'json',
        readIntent: input.readIntent ?? method === 'GET'
      },
      configOptions,
      { allowInteractive: input.allowInteractive }
    );
    if (!result.success || !result.data) return fail(...extraDiagnostics, ...result.diagnostics);

    return ok(
      {
        appId: session.data.appId,
        environmentId: session.data.environmentId,
        tenantId: session.data.tenantId,
        account: session.data.account,
        sessionId: session.data.sessionId,
        requestId,
        url,
        method,
        status: result.data.status,
        response: result.data.response,
        headers: result.data.headers
      },
      [...extraDiagnostics, ...result.diagnostics]
    );
  } finally {
    heldSignalR?.close();
  }
}

export function normalizeCanvasAppId(value: string): string {
  const decoded = decodeURIComponent(value);
  const match = /\/apps\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(decoded) ?? /^([0-9a-f-]{36})$/i.exec(decoded);
  return match?.[1] ?? decoded;
}

export function buildCanvasAuthoringBaseUrl(cluster: CanvasAuthoringClusterInfo, clusterCategoryOverride?: string): OperationResult<string> {
  const geoName = typeof cluster.geoName === 'string' ? cluster.geoName.toLowerCase() : undefined;
  const clusterNumber = cluster.clusterNumber === undefined ? undefined : String(cluster.clusterNumber);
  if (!geoName || !clusterNumber) {
    return fail(
      createDiagnostic('error', 'CANVAS_AUTHORING_CLUSTER_INCOMPLETE', 'Canvas authoring cluster discovery did not return geoName and clusterNumber.', {
        source: 'pp/canvas-authoring',
        detail: JSON.stringify(cluster)
      })
    );
  }
  const clusterCategory = normalizeClusterCategory(clusterCategoryOverride ?? cluster.clusterCategory ?? cluster.environment);
  const authoringGeoName = authoringGeoNameFromClusterName(cluster.clusterName, clusterNumber) ?? geoName;
  return ok(`https://authoring.${authoringGeoName}-il${clusterNumber}.gateway.${clusterCategory}.island.powerapps.com`);
}

export function buildCanvasAuthoringSessionStartUrl(baseUrl: string, environmentId: string, cadence = 'Frequent'): string {
  const url = new URL('/api/authoringsession/start', baseUrl);
  url.searchParams.set('environment-name', environmentId);
  url.searchParams.set('environment-update-cadence', cadence);
  return url.toString();
}

function asClusterInfo(value: unknown): CanvasAuthoringClusterInfo {
  return value && typeof value === 'object' ? (value as CanvasAuthoringClusterInfo) : {};
}

function readObjectProperty(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined;
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === 'string' && entry ? entry : undefined;
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === 'number' ? entry : undefined;
}

async function resolveCanvasAuthoringSession(
  input: {
    environmentAlias: string;
    accountName?: string;
    appId: string;
    sessionId?: string;
    sessionState?: string;
    authoringBaseUrl?: string;
    webAuthoringVersion?: string;
    cadence?: string;
    clusterCategory?: string;
    allowInteractive?: boolean;
  },
  configOptions: ConfigStoreOptions
): Promise<OperationResult<ResolvedCanvasAuthoringSession>> {
  const appId = normalizeCanvasAppId(input.appId);
  let sessionId = input.sessionId;
  let sessionState = input.sessionState;
  let authoringBaseUrl = input.authoringBaseUrl;
  let webAuthoringVersion = input.webAuthoringVersion;
  let environmentId: string | undefined;
  let tenantId: string | undefined;
  let account: string | undefined;

  if (!sessionId && !sessionState && !authoringBaseUrl && !webAuthoringVersion) {
    const existing = (await loadCanvasSessionsRaw(configOptions)).find(
      (session) => session.appId === appId && session.environmentAlias === input.environmentAlias && (!input.accountName || session.account === input.accountName)
    );
    if (existing) {
      sessionId = existing.sessionId;
      sessionState = existing.sessionState;
      authoringBaseUrl = existing.authoringBaseUrl;
      webAuthoringVersion = existing.webAuthoringVersion;
      environmentId = existing.environmentId;
      account = existing.account;
    }
  }

  if (!sessionId || !sessionState || !authoringBaseUrl || !webAuthoringVersion) {
    const sessionResult = await startCanvasAuthoringSession(
      {
        environmentAlias: input.environmentAlias,
        accountName: input.accountName,
        appId,
        cadence: input.cadence,
        clusterCategory: input.clusterCategory,
        raw: true,
        allowInteractive: input.allowInteractive
      },
      configOptions
    );
    if (!sessionResult.success || !sessionResult.data) return fail(...sessionResult.diagnostics);
    sessionId = sessionResult.data.sessionId;
    authoringBaseUrl = sessionResult.data.authoringBaseUrl;
    environmentId = sessionResult.data.environmentId;
    tenantId = sessionResult.data.tenantId;
    account = sessionResult.data.account;
    sessionState = sessionResult.data.sessionState ?? readStringProperty(sessionResult.data.session, 'sessionState');
    webAuthoringVersion =
      sessionResult.data.webAuthoringVersion ??
      readStringProperty(readObjectProperty(sessionResult.data.session, 'clientConfig'), 'webAuthoringVersion') ??
      readStringProperty(sessionResult.data.session, 'authoringHostVersion');
    if (!sessionState || !webAuthoringVersion) {
      return fail(
        createDiagnostic('error', 'CANVAS_AUTHORING_SESSION_INCOMPLETE', 'Canvas authoring session did not return sessionState and webAuthoringVersion.', {
          source: 'pp/canvas-authoring'
        })
      );
    }
  }

  const environmentResult = await executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'canvas-authoring',
      path: '/gateway/cluster',
      method: 'GET',
      responseType: 'json',
      readIntent: true
    },
    configOptions,
    { allowInteractive: input.allowInteractive }
  );
  if (!environmentResult.success || !environmentResult.data) return fail(...environmentResult.diagnostics);
  environmentId ??= environmentResult.data.request.environment!.makerEnvironmentId;
  tenantId ??= environmentResult.data.request.environment!.tenantId;
  account ??= environmentResult.data.request.accountName;

  return ok(
    {
      appId,
      sessionId,
      sessionState,
      authoringBaseUrl,
      webAuthoringVersion,
      environmentId,
      tenantId,
      account
    },
    environmentResult.diagnostics
  );
}

function buildInvokeEnvelope(input: InvokeCanvasAuthoringInput, session: ResolvedCanvasAuthoringSession, requestId: string, sequence: number, confirmation: number) {
  const reliableWireMetaPayload = JSON.stringify({ sequence, confirmation });
  const className = input.className.toLowerCase();
  const methodName = input.methodName.toLowerCase();
  const payloadKey = `dcall:${className}/${input.oid}/${methodName}`;
  return {
    className,
    methodName,
    payloadKey,
    reliableWireMetaHeader: `${sequence},${confirmation}`,
    body: {
      options: {
        classname: className,
        oid: input.oid,
        methodname: methodName,
        reliablewiremeta: reliableWireMetaPayload,
        'x-ms-client-request-id': requestId,
        'x-ms-client-session-id': session.sessionId,
        'x-ms-correlation-request-id': session.sessionId,
        'x-ms-domain-name': session.authoringBaseUrl,
        'x-ms-session-state': session.sessionState,
        'x-ms-environment-name': session.environmentId,
        'x-ms-client-tenant-id': session.tenantId,
        'x-ms-app-name': `/providers/Microsoft.PowerApps/apps/${session.appId}`
      },
      executionParameters: {
        customLoggingDimensions: {
          correlationResponseId: randomUUID(),
          classNames: className,
          methodNames: methodName
        }
      },
      payload: JSON.stringify({
        [payloadKey]: input.payload ?? {}
      })
    }
  };
}

function buildInvokeUrl(session: ResolvedCanvasAuthoringSession): string {
  return new URL(`/${session.webAuthoringVersion.replace(/^\/+/, '')}/api/v2/invoke`, session.authoringBaseUrl).toString();
}

function buildVersionedAuthoringUrl(session: ResolvedCanvasAuthoringSession, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith(`/${session.webAuthoringVersion}/`) || normalizedPath === `/${session.webAuthoringVersion}`) {
    return new URL(normalizedPath, session.authoringBaseUrl).toString();
  }
  return new URL(`/${session.webAuthoringVersion.replace(/^\/+/, '')}${normalizedPath}`, session.authoringBaseUrl).toString();
}

async function invokeViaSignalR(
  session: ResolvedCanvasAuthoringSession,
  accessToken: string,
  body: unknown,
  requestId: string,
  timeoutMs: number
): Promise<OperationResult<{ negotiateUrl: string; websocketUrl: string; rpcResponse: unknown }>> {
  const connection = await openSignalRConnection(session, accessToken, timeoutMs);
  if (!connection.success || !connection.data) return fail(...connection.diagnostics);
  const rpcResponse = await sendSignalRInvoke(connection.data.socket, requestId, body, timeoutMs);
  connection.data.close();
  if (!rpcResponse.success || !rpcResponse.data) return fail(...rpcResponse.diagnostics);
  return ok(
    {
      negotiateUrl: connection.data.negotiateUrl,
      websocketUrl: connection.data.websocketUrl,
      rpcResponse: rpcResponse.data
    },
    connection.diagnostics
  );
}

interface HeldSignalRConnection {
  socket: WebSocket;
  negotiateUrl: string;
  websocketUrl: string;
  close: () => void;
}

async function openSignalRConnection(session: ResolvedCanvasAuthoringSession, accessToken: string, timeoutMs: number): Promise<OperationResult<HeldSignalRConnection>> {
  const hubPath = `/${session.webAuthoringVersion.replace(/^\/+/, '')}/api/signalr/diagnosticshub`;
  const negotiateUrl = new URL(`${hubPath}/negotiate`, session.authoringBaseUrl);
  negotiateUrl.searchParams.set('negotiateVersion', '1');
  const negotiateResponse = await fetch(negotiateUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-ms-client-session-id': session.sessionId,
      'x-ms-session-state': session.sessionState
    },
    body: '{}'
  });
  if (!negotiateResponse.ok) {
    return fail(
      createDiagnostic('error', 'CANVAS_AUTHORING_SIGNALR_NEGOTIATE_FAILED', `SignalR negotiate returned ${negotiateResponse.status}.`, {
        source: 'pp/canvas-authoring',
        detail: await negotiateResponse.text()
      })
    );
  }
  const negotiate = (await negotiateResponse.json()) as { url?: string; accessToken?: string; connectionToken?: string; connectionId?: string };
  const websocketUrl = buildSignalRWebsocketUrl(session, negotiate, accessToken);
  const connection = await connectSignalRWebsocket(websocketUrl, timeoutMs);
  if (!connection.success || !connection.data) return fail(...connection.diagnostics);
  const socket = connection.data;
  return ok({
    socket,
    negotiateUrl: negotiateUrl.toString(),
    websocketUrl,
    close: () => {
      try {
        socket.close();
      } catch {
        // Ignore close failures while releasing a best-effort SignalR connection.
      }
    }
  });
}

function buildSignalRWebsocketUrl(
  session: ResolvedCanvasAuthoringSession,
  negotiate: { url?: string; accessToken?: string; connectionToken?: string; connectionId?: string },
  accessToken: string
): string {
  const url = negotiate.url ? new URL(negotiate.url) : new URL(`/${session.webAuthoringVersion.replace(/^\/+/, '')}/api/signalr/diagnosticshub`, session.authoringBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('x-ms-client-session-id', session.sessionId);
  url.searchParams.set('x-ms-session-state', session.sessionState);
  const connectionToken = negotiate.connectionToken ?? negotiate.connectionId;
  if (connectionToken && !url.searchParams.has('id')) url.searchParams.set('id', connectionToken);
  url.searchParams.set('access_token', negotiate.accessToken ?? accessToken);
  return url.toString();
}

function connectSignalRWebsocket(websocketUrl: string, timeoutMs: number): Promise<OperationResult<WebSocket>> {
  return new Promise((resolve) => {
    const socket = new WebSocket(websocketUrl);
    const timeout = setTimeout(() => {
      cleanup();
      resolve(
        fail(
          createDiagnostic('error', 'CANVAS_AUTHORING_SIGNALR_TIMEOUT', `Timed out waiting ${timeoutMs}ms for SignalR connection.`, {
            source: 'pp/canvas-authoring'
          })
        )
      );
    }, timeoutMs);
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('error', handleError);
    };

    const handleOpen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.send(`${JSON.stringify({ protocol: 'json', version: 1 })}\u001e`);
      resolve(ok(socket));
    };

    const handleError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(
        fail(
          createDiagnostic('error', 'CANVAS_AUTHORING_SIGNALR_ERROR', 'SignalR WebSocket failed.', {
            source: 'pp/canvas-authoring'
          })
        )
      );
    };

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('error', handleError);
  });
}

function sendSignalRInvoke(socket: WebSocket, requestId: string, body: unknown, timeoutMs: number): Promise<OperationResult<unknown>> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(
        fail(
          createDiagnostic('error', 'CANVAS_AUTHORING_SIGNALR_TIMEOUT', `Timed out waiting ${timeoutMs}ms for SignalR RPC response ${requestId}.`, {
            source: 'pp/canvas-authoring'
          })
        )
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('error', handleError);
    };

    const handleError = () => {
      cleanup();
      resolve(
        fail(
          createDiagnostic('error', 'CANVAS_AUTHORING_SIGNALR_ERROR', 'SignalR WebSocket failed.', {
            source: 'pp/canvas-authoring'
          })
        )
      );
    };

    const handleMessage = (event: MessageEvent) => {
      const text = typeof event.data === 'string' ? event.data : Buffer.from(event.data as ArrayBuffer).toString('utf8');
      for (const frame of text.split('\u001e')) {
        if (!frame) continue;
        const matched = tryReadSignalRInvokeResponse(frame, requestId);
        if (matched.matched) {
          cleanup();
          resolve(ok(matched.response));
          return;
        }
      }
    };

    socket.addEventListener('message', handleMessage);
    socket.addEventListener('error', handleError);
    const invokeArgument = JSON.stringify([requestId, 'Invoke', JSON.stringify(body), '', 'Invoke']);
    socket.send(`${JSON.stringify({ type: 1, target: 'Invoke', arguments: [invokeArgument] })}\u001e`);
  });
}

async function sendSignalRKeepAlive(session: ResolvedCanvasAuthoringSession, socket: WebSocket, timeoutMs: number): Promise<OperationResult<unknown>> {
  const requestId = randomUUID();
  const envelope = buildInvokeEnvelope(
    {
      environmentAlias: '',
      appId: session.appId,
      className: 'documentservicev2',
      oid: '1',
      methodName: 'keepalive',
      payload: {}
    },
    session,
    requestId,
    1,
    0
  );
  return sendSignalRInvoke(socket, requestId, envelope.body, timeoutMs);
}

function tryReadSignalRInvokeResponse(frame: string, requestId: string): { matched: true; response: unknown } | { matched: false } {
  let message: unknown;
  try {
    message = JSON.parse(frame);
  } catch {
    return { matched: false };
  }
  if (!message || typeof message !== 'object') return { matched: false };
  const target = (message as Record<string, unknown>).target;
  const args = (message as Record<string, unknown>).arguments;
  if (target !== 'Invoke' || !Array.isArray(args) || typeof args[0] !== 'string') return { matched: false };
  let inner: unknown;
  try {
    inner = JSON.parse(args[0]);
  } catch {
    return { matched: false };
  }
  if (!Array.isArray(inner) || inner[0] !== requestId || typeof inner[2] !== 'string') return { matched: false };
  try {
    return { matched: true, response: JSON.parse(inner[2]) };
  } catch {
    return { matched: true, response: inner[2] };
  }
}

function decodeRpcResult(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const result = (value as Record<string, unknown>).result;
  if (typeof result !== 'string') return undefined;
  const encoding = (value as Record<string, unknown>).encoding;
  let text: string;
  try {
    text = encoding === 'GZip' ? gunzipSync(Buffer.from(result, 'base64')).toString('utf8') : result;
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function redactAccessToken(value: string): string {
  const url = new URL(value);
  if (url.searchParams.has('access_token')) url.searchParams.set('access_token', '<redacted>');
  return url.toString();
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

export interface PersistedCanvasSession {
  sessionId: string;
  appId: string;
  environmentAlias: string;
  environmentId: string;
  tenantId?: string;
  account: string;
  authoringBaseUrl: string;
  webAuthoringVersion: string;
  sessionState: string;
  cluster: CanvasAuthoringClusterInfo;
  createdAt: string;
}

export async function saveCanvasSession(result: StartCanvasAuthoringSessionResult, environmentAlias: string, configOptions: ConfigStoreOptions = {}): Promise<void> {
  const sessionState = result.sessionState ?? readStringProperty(result.session, 'sessionState');
  const webAuthoringVersion =
    result.webAuthoringVersion ?? readStringProperty(readObjectProperty(result.session, 'clientConfig'), 'webAuthoringVersion') ?? readStringProperty(result.session, 'authoringHostVersion');
  if (!sessionState || !webAuthoringVersion) return;

  const entry: PersistedCanvasSession = {
    sessionId: result.sessionId,
    appId: result.appId,
    environmentAlias,
    environmentId: result.environmentId,
    tenantId: result.tenantId,
    account: result.account,
    authoringBaseUrl: result.authoringBaseUrl,
    webAuthoringVersion,
    sessionState,
    cluster: result.cluster,
    createdAt: new Date().toISOString()
  };

  const existing = await loadCanvasSessionsRaw(configOptions);
  // Replace any existing session for the same app+environment, then prepend
  const filtered = existing.filter((s) => !(s.appId === entry.appId && s.environmentAlias === entry.environmentAlias));
  const sessions = [entry, ...filtered];
  await writeCanvasSessions(sessions, configOptions);
}

export async function loadCanvasSessions(configOptions: ConfigStoreOptions = {}): Promise<PersistedCanvasSession[]> {
  return loadCanvasSessionsRaw(configOptions);
}

export async function probeCanvasSession(session: PersistedCanvasSession, configOptions: ConfigStoreOptions = {}): Promise<boolean> {
  try {
    const url = `${session.authoringBaseUrl}/${session.webAuthoringVersion}/api/yaml/controls`;
    const result = await executeApiRequest(
      {
        environmentAlias: session.environmentAlias,
        accountName: session.account,
        api: 'canvas-authoring',
        path: url,
        method: 'GET',
        headers: {
          'x-ms-client-session-id': session.sessionId,
          'x-ms-session-state': session.sessionState,
          'x-ms-client-request-id': randomUUID()
        },
        responseType: 'json',
        readIntent: true
      },
      configOptions,
      { allowInteractive: false }
    );
    return result.success && result.data?.status === 200;
  } catch {
    return false;
  }
}

export async function probeAndCleanCanvasSessions(configOptions: ConfigStoreOptions = {}): Promise<(PersistedCanvasSession & { alive: boolean })[]> {
  const sessions = await loadCanvasSessionsRaw(configOptions);
  if (!sessions.length) return [];
  const results = await Promise.all(
    sessions.map(async (session) => ({
      ...session,
      alive: await probeCanvasSession(session, configOptions)
    }))
  );
  const alive = results.filter((s) => s.alive);
  if (alive.length !== sessions.length) {
    await writeCanvasSessions(alive, configOptions);
  }
  return results;
}

export async function disposeCanvasSession(session: PersistedCanvasSession, configOptions: ConfigStoreOptions = {}): Promise<void> {
  try {
    const url = `${session.authoringBaseUrl}/${session.webAuthoringVersion}/api/authoringsession/dispose`;
    await executeApiRequest(
      {
        environmentAlias: session.environmentAlias,
        accountName: session.account,
        api: 'canvas-authoring',
        path: url,
        method: 'POST',
        headers: {
          'x-ms-client-session-id': session.sessionId,
          'x-ms-session-state': session.sessionState,
          'x-ms-client-request-id': randomUUID()
        },
        responseType: 'json'
      },
      configOptions,
      { allowInteractive: false }
    );
  } catch {
    // Best effort — the session may already be expired.
  }
  await removeCanvasSession(session.sessionId, configOptions);
}

export async function removeCanvasSession(sessionId: string, configOptions: ConfigStoreOptions = {}): Promise<void> {
  const sessions = await loadCanvasSessionsRaw(configOptions);
  await writeCanvasSessions(
    sessions.filter((s) => s.sessionId !== sessionId),
    configOptions
  );
}

async function loadCanvasSessionsRaw(configOptions: ConfigStoreOptions): Promise<PersistedCanvasSession[]> {
  try {
    const raw = await readFile(getCanvasSessionsPath(configOptions), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCanvasSessions(sessions: PersistedCanvasSession[], configOptions: ConfigStoreOptions): Promise<void> {
  const path = getCanvasSessionsPath(configOptions);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(sessions, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function normalizeClusterCategory(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'prod';
  return text === 'production' ? 'prod' : text;
}

function authoringGeoNameFromClusterName(value: unknown, clusterNumber: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = new RegExp(`il${clusterNumber}([a-z]+)$`, 'i').exec(value);
  return match?.[1]?.toLowerCase();
}

function readCanvasAuthoringRedirectionUrl(diagnostics: { detail?: string }[]): string | undefined {
  for (const diagnostic of diagnostics) {
    if (!diagnostic.detail) continue;
    try {
      const parsed = JSON.parse(diagnostic.detail) as { redirectionUrl?: unknown };
      if (typeof parsed.redirectionUrl === 'string' && /^https:\/\/authoring\./i.test(parsed.redirectionUrl)) {
        return parsed.redirectionUrl;
      }
    } catch {
      // Ignore non-JSON error detail.
    }
  }
  return undefined;
}

function redactCanvasAuthoringSession(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactCanvasAuthoringSession(item));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
    if (key === 'accessToken' || key === 'sessionState') {
      return [key, summarizeSecret(entryValue)] as const;
    }
    return [key, redactCanvasAuthoringSession(entryValue)] as const;
  });
  return Object.fromEntries(entries);
}

function summarizeSecret(value: unknown): unknown {
  if (typeof value !== 'string') return value === undefined || value === null ? value : { redacted: true };
  return { redacted: true, length: value.length };
}
