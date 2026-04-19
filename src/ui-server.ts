import { createServer, type Server, type ServerResponse } from 'node:http';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { createDiagnostic, fail } from './diagnostics.js';
import { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { getConfigDir, getUiPreferredPortPath, getUiStatePath } from './config.js';
import { sendJson } from './ui-http.js';
import { AuthSessionStore } from './ui-auth-sessions.js';
import { CanvasSessionStore } from './ui-canvas-sessions.js';
import { UiJobStore } from './ui-jobs.js';
import { handleUiRequest } from './ui-routes.js';
import { TemporaryTokenStore } from './temporary-tokens.js';
import type { RequestInput } from './request.js';
import type { OperationResult } from './diagnostics.js';

const DEFAULT_UI_PORT = 4733;
const UI_STATUS_PATH = '/api/ui/status';
const UI_SHUTDOWN_PATH = '/api/ui/shutdown';

export interface PpUiOptions {
  configDir?: string;
  port?: number;
  openBrowser?: boolean;
  openAppWindow?: boolean;
  allowInteractiveAuth?: boolean;
  reuseExisting?: boolean;
  lan?: boolean;
  pair?: boolean;
}

export interface PpUiHandle {
  url: string;
  reused: boolean;
  instanceId: string;
  close: () => Promise<void>;
}

interface UiInstanceState {
  version: 1;
  instanceId: string;
  pid: number;
  url: string;
  host: string;
  port: number;
  configDir: string;
  startedAt: string;
  cliSecret: string;
}

interface ExistingUiInstance {
  instanceId: string;
  url: string;
  port: number;
}

export async function startPpUi(options: PpUiOptions = {}): Promise<PpUiHandle> {
  const configOptions = options.configDir ? { configDir: options.configDir } : {};
  const configDir = getConfigDir(configOptions);
  if (options.lan && !options.pair) {
    throw new Error('LAN UI access requires --pair.');
  }
  const host = options.lan ? '0.0.0.0' : '127.0.0.1';
  const preferredPort = options.port ?? DEFAULT_UI_PORT;
  const explicitPort = options.port !== undefined;
  const allowInteractiveAuth = options.allowInteractiveAuth ?? true;
  const statePath = getUiStatePath(configOptions);
  const preferredPortPath = getUiPreferredPortPath(configOptions);
  const rememberedPort = explicitPort ? undefined : await readRememberedPort(preferredPortPath);

  if (options.reuseExisting !== false && !options.lan && !options.pair) {
    const existing = await findExistingUiInstance(statePath, configDir);
    if (existing && (!explicitPort || existing.port === preferredPort)) {
      process.stdout.write(`pp UI already running at ${existing.url}\n`);
      if (options.openBrowser !== false) await openBrowser(existing.url, options.openAppWindow);
      return {
        url: existing.url,
        reused: true,
        instanceId: existing.instanceId,
        close: async () => {},
      };
    }
  }

  const jobs = new UiJobStore();
  const authSessions = new AuthSessionStore();
  const canvasSessions = new CanvasSessionStore();
  const temporaryTokens = new TemporaryTokenStore();
  void canvasSessions.loadPersistedSessions(configOptions);
  const fetchXmlCatalog = new FetchXmlMetadataCatalog();
  const instanceId = randomUUID();
  const cliSecret = randomBytes(32).toString('base64url');
  const pairing = options.pair ? createPairingState() : undefined;
  const initialPort = explicitPort ? preferredPort : (rememberedPort ?? DEFAULT_UI_PORT);
  const portCandidates = buildPortCandidates({ explicit: explicitPort, preferred: preferredPort, remembered: rememberedPort });
  const server = await listenWithFallback(
    () => createUiServer({
      configOptions,
      allowInteractiveAuth,
      host,
      port: initialPort,
      jobs,
      authSessions,
      canvasSessions,
      temporaryTokens,
      fetchXmlCatalog,
      instanceId,
      cliSecret,
      serverUrl: '',
      pairing,
      sendVendorModule: async (response, specifier) => {
        sendJson(
          response,
          404,
          fail(createDiagnostic('error', 'UI_VENDOR_MODULE_NOT_FOUND', `Could not resolve browser module ${specifier}.`, { source: 'pp/ui' })),
        );
      },
    }),
    host,
    portCandidates,
  );

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : preferredPort;
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${resolvedPort}`;
  const context = (server as Server & { __ppContext?: Parameters<typeof createUiServer>[0] }).__ppContext;
  if (context) {
    context.port = resolvedPort;
    context.serverUrl = url;
    context.cliSecret = cliSecret;
  }

  const state: UiInstanceState = {
    version: 1,
    instanceId,
    pid: process.pid,
    url,
    host,
    port: resolvedPort,
    configDir,
    startedAt: new Date().toISOString(),
    cliSecret,
  };

  await persistUiState(statePath, state);
  if (!options.lan && !options.pair) {
    await persistRememberedPort(preferredPortPath, resolvedPort);
  }
  process.stdout.write(`pp UI listening at ${url}\n`);
  if (host === '0.0.0.0') {
    for (const lanUrl of getLanUrls(resolvedPort)) {
      process.stdout.write(`LAN URL: ${lanUrl}\n`);
    }
  }
  if (pairing) {
    const pairUrls = host === '0.0.0.0' ? getLanUrls(resolvedPort) : [url];
    process.stdout.write(`Pairing code: ${pairing.code}\n`);
    process.stdout.write(`Pairing expires at ${new Date(pairing.expiresAt).toLocaleString()}\n`);
    for (const pairUrl of pairUrls) {
      process.stdout.write(`Pair URL: ${pairUrl}/pair?code=${pairing.code}\n`);
    }
  }
  if (resolvedPort !== preferredPort) {
    process.stdout.write(`Preferred port ${preferredPort} was unavailable; using ${resolvedPort} instead.\n`);
  }
  if (options.openBrowser !== false) await openBrowser(url, options.openAppWindow);

  return {
    url,
    reused: false,
    instanceId,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await cleanupUiState(statePath, instanceId);
    },
  };
}

export async function stopPpUi(options: { configDir?: string } = {}): Promise<{ stopped: boolean; url?: string }> {
  const configOptions = options.configDir ? { configDir: options.configDir } : {};
  const configDir = getConfigDir(configOptions);
  const statePath = getUiStatePath(configOptions);
  const state = await readUiState(statePath);
  if (!state || state.configDir !== configDir) return { stopped: false };

  try {
    const response = await fetch(new URL(UI_SHUTDOWN_PATH, state.url), {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) return { stopped: true, url: state.url };
  } catch {
    // Server may have already exited before responding.
    return { stopped: true, url: state.url };
  }
  return { stopped: false, url: state.url };
}

function createUiServer(context: RequestContext): Server {
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, context);
    } catch (error) {
      sendJson(
        response,
        500,
        fail(
          createDiagnostic('error', 'UI_UNHANDLED_ERROR', error instanceof Error ? error.message : String(error), {
            source: 'pp/ui',
          }),
        ),
      );
    }
  });
  (server as Server & { __ppContext?: RequestContext }).__ppContext = context;
  return server;
}

interface RequestContext {
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
  pairing?: PairingState;
}

export interface UiCliRequestOptions extends Omit<RequestInput, 'configOptions' | 'loginOptions'> {
  configDir?: string;
  temporaryToken?: string;
  allowInteractive?: boolean;
}

export async function executeRequestViaRunningUi(
  options: UiCliRequestOptions,
): Promise<OperationResult<{ request: unknown; response: unknown; status: number; headers: Record<string, string>; temporaryToken?: unknown }>> {
  const configOptions = options.configDir ? { configDir: options.configDir } : {};
  const state = await readUiState(getUiStatePath(configOptions));
  if (!state?.url || !state.cliSecret) {
    return fail(createDiagnostic('error', 'UI_NOT_RUNNING', 'No running pp UI instance with CLI routing support was found.', {
      source: 'pp/ui-cli',
      hint: 'Start pp ui, paste a temporary token, then retry with --via-ui.',
    }));
  }
  try {
    const signal = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs + 2000) : undefined;
    const response = await fetch(new URL('/api/cli/request', state.url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${state.cliSecret}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        environment: options.environmentAlias,
        account: options.accountName,
        api: options.api,
        method: options.method,
        path: options.path,
        query: options.query,
        headers: options.headers,
        body: options.body,
        rawBody: options.rawBody,
        responseType: options.responseType,
        timeoutMs: options.timeoutMs,
        jq: options.jq,
        readIntent: options.readIntent,
        allowInteractive: options.allowInteractive,
        temporaryToken: options.temporaryToken,
      }),
      ...(signal ? { signal } : {}),
    });
    const payload = await response.json() as OperationResult<{ request: unknown; response: unknown; status: number; headers: Record<string, string>; temporaryToken?: unknown }>;
    return payload;
  } catch (error) {
    return fail(createDiagnostic('error', 'UI_CLI_REQUEST_FAILED', `Failed to route request through pp UI: ${error instanceof Error ? error.message : String(error)}`, {
      source: 'pp/ui-cli',
    }));
  }
}

async function handleRequest(request: Parameters<typeof handleUiRequest>[0], response: ServerResponse, context: RequestContext): Promise<void> {
  const url = new URL(request.url ?? '/', context.serverUrl || `http://${context.host}:${context.port}`);
  if (request.method === 'POST' && url.pathname === '/api/cli/request') {
    await handleUiRequest(request, response, context);
    return;
  }
  if (await handlePairingRequest(request, response, context)) return;
  await handleUiRequest(request, response, context);
}

interface PairingState {
  code: string;
  expiresAt: number;
  sessions: Set<string>;
}

function createPairingState(): PairingState {
  return {
    code: String(randomInt(100000, 999999)),
    expiresAt: Date.now() + 5 * 60 * 1000,
    sessions: new Set<string>(),
  };
}

async function handlePairingRequest(request: Parameters<typeof handleUiRequest>[0], response: ServerResponse, context: RequestContext): Promise<boolean> {
  const pairing = context.pairing;
  if (!pairing) return false;

  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${context.host}:${context.port}`);

  if (url.pathname === UI_STATUS_PATH && isLoopbackAddress(request.socket.remoteAddress)) {
    return false;
  }

  if (url.pathname === '/pair' && method === 'GET') {
    const code = url.searchParams.get('code')?.trim();
    if (!code) {
      sendPairPage(response, pairing, undefined);
      return true;
    }
    if (Date.now() > pairing.expiresAt) {
      sendPairPage(response, pairing, 'This pairing code has expired. Restart pp ui to generate a new one.');
      return true;
    }
    if (!constantTimeEqual(code, pairing.code)) {
      sendPairPage(response, pairing, 'That pairing code is not valid.');
      return true;
    }
    const session = randomBytes(32).toString('base64url');
    pairing.sessions.add(session);
    response.writeHead(302, {
      location: '/',
      'set-cookie': `pp_ui_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
      'cache-control': 'no-store',
    });
    response.end();
    return true;
  }

  if (hasValidSession(request, pairing)) return false;

  sendPairRequired(response);
  return true;
}

function hasValidSession(request: Parameters<typeof handleUiRequest>[0], pairing: PairingState): boolean {
  const cookie = request.headers.cookie;
  if (!cookie) return false;
  for (const part of cookie.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== 'pp_ui_session') continue;
    const value = rawValue.join('=');
    for (const session of pairing.sessions) {
      if (constantTimeEqual(value, session)) return true;
    }
  }
  return false;
}

function sendPairRequired(response: ServerResponse): void {
  response.writeHead(401, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(renderPairHtml('Pair this browser', 'Enter the pairing code shown on the machine running pp ui.'));
}

function sendPairPage(response: ServerResponse, pairing: PairingState, error: string | undefined): void {
  const message = error ?? `Enter the pairing code shown on the host. This code expires at ${new Date(pairing.expiresAt).toLocaleString()}.`;
  response.writeHead(error ? 401 : 200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(renderPairHtml(error ? 'Pairing failed' : 'Pair this browser', message));
}

function renderPairHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiByb2xlPSJpbWciIGFyaWEtbGFiZWxsZWRieT0idGl0bGUgZGVzYyI+CiAgPHRpdGxlIGlkPSJ0aXRsZSI+cHAgaWNvbjwvdGl0bGU+CiAgPGRlc2MgaWQ9ImRlc2MiPlBvd2VyIFBsYXRmb3JtIENMSSBtb25vZ3JhbS48L2Rlc2M+CgogIDwhLS0gdGVhbCBsYXllciByZXZlYWxlZCB0aHJvdWdoIGN1dG91dHMgLS0+CiAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIHJ4PSI1MiIgZmlsbD0iIzNlZDRhYSIvPgoKICA8IS0tIG1hc2s6IHdoaXRlID0gZGFyayB2aXNpYmxlLCBibGFjayA9IHRlYWwgc2hvd3MgdGhyb3VnaCAtLT4KICA8bWFzayBpZD0icHAiPgogICAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIGZpbGw9IndoaXRlIi8+CgogICAgPCEtLSBmaXJzdCBwOiBzdGVtICsgYm93bCArIGNvdW50ZXIgLS0+CiAgICA8cmVjdCB4PSI2NCIgeT0iNTIiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxNTYiIHJ4PSI5IiBmaWxsPSJibGFjayIvPgogICAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iODgiIHI9IjM2IiBmaWxsPSJibGFjayIvPgogICAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iODgiIHI9IjE4IiBmaWxsPSJ3aGl0ZSIvPgoKICAgIDwhLS0gc2Vjb25kIHA6IHNhbWUgc2hhcGUsIG9mZnNldCA2NHB4IHJpZ2h0IC0tPgogICAgPHJlY3QgeD0iMTI4IiB5PSI1MiIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE1NiIgcng9IjkiIGZpbGw9ImJsYWNrIi8+CiAgICA8Y2lyY2xlIGN4PSIxNjQiIGN5PSI4OCIgcj0iMzYiIGZpbGw9ImJsYWNrIi8+CiAgICA8Y2lyY2xlIGN4PSIxNjQiIGN5PSI4OCIgcj0iMTgiIGZpbGw9IndoaXRlIi8+CiAgPC9tYXNrPgoKICA8IS0tIGRhcmsgbGF5ZXIgd2l0aCBwcCBwdW5jaGVkIHRocm91Z2ggLS0+CiAgPHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIHJ4PSI1MiIgZmlsbD0iIzE4MjgzMCIgbWFzaz0idXJsKCNwcCkiLz4KPC9zdmc+Cg==">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #f6f7f9; color: #16181d; }
    main { width: min(420px, calc(100vw - 32px)); }
    h1 { margin: 0 0 12px; font-size: 1.5rem; }
    p { margin: 0 0 18px; color: #4d5663; line-height: 1.5; }
    form { display: flex; gap: 8px; }
    input { flex: 1; min-width: 0; padding: 10px 12px; border: 1px solid #b8c0cc; border-radius: 8px; font: inherit; }
    button { padding: 10px 14px; border: 1px solid #1c5fb8; border-radius: 8px; background: #1c5fb8; color: white; font: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <form method="get" action="/pair">
      <input name="code" inputmode="numeric" autocomplete="one-time-code" autofocus placeholder="Pairing code">
      <button type="submit">Pair</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function randomInt(min: number, max: number): number {
  const range = max - min + 1;
  return min + (randomBytes(4).readUInt32BE(0) % range);
}

async function listenWithFallback(create: () => Server, host: string, candidates: number[]): Promise<Server> {
  let lastError: unknown = new Error('No ports attempted.');
  for (const port of candidates) {
    const server = create();
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: unknown) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return server;
    } catch (error) {
      lastError = error;
      server.removeAllListeners();
      if (!isAddressInUseError(error) || port === 0) break;
    }
  }
  throw lastError;
}

function buildPortCandidates(input: { explicit: boolean; preferred: number; remembered: number | undefined }): number[] {
  if (input.explicit) return [input.preferred];
  const list: number[] = [];
  if (input.remembered !== undefined) list.push(input.remembered);
  list.push(input.preferred);
  for (let offset = 1; offset <= 9; offset++) list.push(input.preferred + offset);
  list.push(0);
  const seen = new Set<number>();
  return list.filter((port) => {
    if (seen.has(port)) return false;
    seen.add(port);
    return true;
  });
}

async function readRememberedPort(filePath: string): Promise<number | undefined> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { port?: unknown };
    const port = typeof parsed.port === 'number' && Number.isInteger(parsed.port) ? parsed.port : Number.NaN;
    if (Number.isFinite(port) && port > 0 && port < 65536) return port;
  } catch {
    // Missing or unreadable file is fine — fall back to the default range.
  }
  return undefined;
}

async function persistRememberedPort(filePath: string, port: number): Promise<void> {
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ version: 1, port }, null, 2) + '\n', { encoding: 'utf8' });
  } catch {
    // Non-fatal — next run falls back to the default candidate list.
  }
}

function isAddressInUseError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EADDRINUSE');
}

async function persistUiState(statePath: string, state: UiInstanceState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await chmod(statePath, 0o600);
}

async function cleanupUiState(statePath: string, instanceId: string): Promise<void> {
  try {
    const current = await readUiState(statePath);
    if (current?.instanceId === instanceId) {
      await rm(statePath, { force: true });
    }
  } catch {
    // Best effort cleanup only.
  }
}

async function findExistingUiInstance(statePath: string, configDir: string): Promise<ExistingUiInstance | undefined> {
  const state = await readUiState(statePath);
  if (!state || state.configDir !== configDir) return undefined;

  try {
    const response = await fetch(new URL(UI_STATUS_PATH, state.url), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(700),
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { success?: boolean; data?: { instanceId?: string; configDir?: string; url?: string } };
    if (!payload.success || payload.data?.configDir !== configDir || !payload.data?.url) return undefined;
    return {
      instanceId: payload.data.instanceId ?? state.instanceId,
      url: payload.data.url,
      port: state.port,
    };
  } catch {
    return undefined;
  }
}

async function readUiState(statePath: string): Promise<UiInstanceState | undefined> {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UiInstanceState>;
    if (
      parsed.version !== 1 ||
      typeof parsed.instanceId !== 'string' ||
      typeof parsed.url !== 'string' ||
      typeof parsed.configDir !== 'string'
    ) {
      return undefined;
    }
    return parsed as UiInstanceState;
  } catch {
    return undefined;
  }
}

function getLanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      urls.push(`http://${address.address}:${port}`);
    }
  }
  return urls.length > 0 ? urls : [`http://<host-ip>:${port}`];
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function openBrowser(url: string, appWindow = false): Promise<void> {
  try {
    await waitForServer(url);
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    if (process.platform === 'win32') {
      if (appWindow && await spawnDetached('msedge', [`--app=${url}`])) return;
      await spawnDetached('cmd', ['/c', 'start', '', url]);
      return;
    }
    await spawnDetached('xdg-open', [url]);
  } catch {
    // Best effort only.
  }
}

async function spawnDetached(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

async function waitForServer(url: string, retries = 10, delayMs = 100): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
