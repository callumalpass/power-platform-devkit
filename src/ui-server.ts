import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { createDiagnostic, fail } from './diagnostics.js';
import { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { getConfigDir, getUiStatePath } from './config.js';
import { sendJson } from './ui-http.js';
import { AuthSessionStore } from './ui-auth-sessions.js';
import { CanvasSessionStore } from './ui-canvas-sessions.js';
import { UiJobStore } from './ui-jobs.js';
import { handleUiRequest } from './ui-routes.js';

const DEFAULT_UI_PORT = 4733;
const UI_STATUS_PATH = '/api/ui/status';

export interface PpUiOptions {
  configDir?: string;
  port?: number;
  openBrowser?: boolean;
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

  if (options.reuseExisting !== false && !options.lan && !options.pair) {
    const existing = await findExistingUiInstance(statePath, configDir);
    if (existing && (!explicitPort || existing.port === preferredPort)) {
      process.stdout.write(`pp UI already running at ${existing.url}\n`);
      if (options.openBrowser !== false) openBrowser(existing.url);
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
  void canvasSessions.loadPersistedSessions(configOptions);
  const fetchXmlCatalog = new FetchXmlMetadataCatalog();
  const instanceId = randomUUID();
  const pairing = options.pair ? createPairingState() : undefined;
  const initialPort = explicitPort ? preferredPort : DEFAULT_UI_PORT;
  const server = await listenWithFallback(
    () => createUiServer({
      configOptions,
      allowInteractiveAuth,
      host,
      port: initialPort,
      jobs,
      authSessions,
      canvasSessions,
      fetchXmlCatalog,
      instanceId,
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
    preferredPort,
    explicitPort,
  );

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : preferredPort;
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${resolvedPort}`;
  const context = (server as Server & { __ppContext?: Parameters<typeof createUiServer>[0] }).__ppContext;
  if (context) {
    context.port = resolvedPort;
    context.serverUrl = url;
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
  };

  await persistUiState(statePath, state);
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
  if (options.openBrowser !== false) openBrowser(url);

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
  fetchXmlCatalog: FetchXmlMetadataCatalog;
  sendVendorModule: (response: ServerResponse, specifier: string) => Promise<void>;
  instanceId: string;
  serverUrl: string;
  pairing?: PairingState;
}

async function handleRequest(request: Parameters<typeof handleUiRequest>[0], response: ServerResponse, context: RequestContext): Promise<void> {
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

async function listenWithFallback(create: () => Server, host: string, preferredPort: number, strictPort: boolean): Promise<Server> {
  const attempts = strictPort ? [preferredPort] : [preferredPort, 0];
  let lastError: unknown;
  for (const port of attempts) {
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

function isAddressInUseError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EADDRINUSE');
}

async function persistUiState(statePath: string, state: UiInstanceState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
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

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // Best effort only.
  }
}
