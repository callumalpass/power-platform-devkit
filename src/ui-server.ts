import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createDiagnostic, fail } from './diagnostics.js';
import { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { getConfigDir, getUiStatePath } from './config.js';
import { sendJson } from './ui-http.js';
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
  const host = '127.0.0.1';
  const preferredPort = options.port ?? DEFAULT_UI_PORT;
  const explicitPort = options.port !== undefined;
  const allowInteractiveAuth = options.allowInteractiveAuth ?? true;
  const statePath = getUiStatePath(configOptions);

  if (options.reuseExisting !== false) {
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
  const fetchXmlCatalog = new FetchXmlMetadataCatalog();
  const instanceId = randomUUID();
  const initialPort = explicitPort ? preferredPort : DEFAULT_UI_PORT;
  const server = await listenWithFallback(
    () => createUiServer({
      configOptions,
      allowInteractiveAuth,
      host,
      port: initialPort,
      jobs,
      fetchXmlCatalog,
      instanceId,
      serverUrl: '',
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
  const url = `http://${host}:${resolvedPort}`;
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

function createUiServer(context: Parameters<typeof handleUiRequest>[2]): Server {
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
  (server as Server & { __ppContext?: Parameters<typeof handleUiRequest>[2] }).__ppContext = context;
  return server;
}

interface RequestContext {
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

async function handleRequest(request: Parameters<typeof handleUiRequest>[0], response: ServerResponse, context: RequestContext): Promise<void> {
  await handleUiRequest(request, response, context);
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
