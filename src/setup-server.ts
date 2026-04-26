import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { createDesktopApiContext, handleDesktopApiRequest, type DesktopApiRequest } from './desktop-api.js';
import { createDiagnostic, fail } from './diagnostics.js';
import { SETUP_RENDERER_JS } from './setup-renderer.js';
import { renderHtml } from './ui-app.js';

const HOST = '127.0.0.1';
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_API_BODY_BYTES = 10 * 1024 * 1024;

export interface SetupServerOptions {
  configDir?: string;
  port?: number;
  openBrowser?: boolean;
  idleTimeoutMs?: number;
  assetsDir?: string;
  token?: string;
  stderr?: NodeJS.WritableStream;
}

export interface RunningSetupServer {
  host: string;
  port: number;
  token: string;
  url: string;
  server: Server;
  close: () => Promise<void>;
  closed: Promise<void>;
}

export async function startSetupServer(options: SetupServerOptions = {}): Promise<RunningSetupServer> {
  const token = options.token ?? randomBytes(32).toString('base64url');
  const assetsDir = SETUP_RENDERER_JS ? undefined : resolveSetupAssetsDir(options.assetsDir);
  const stderr = options.stderr ?? process.stderr;
  let closing = false;
  let idleTimer: NodeJS.Timeout | undefined;

  const context = createDesktopApiContext({
    configDir: options.configDir,
    allowInteractiveAuth: true,
    appKind: 'pp-setup',
    quit: () => {
      void close();
    }
  });

  const server = createServer((request, response) => {
    resetIdleTimer();
    void routeRequest(request, response).catch((error) => {
      sendJson(response, 500, fail(createDiagnostic('error', 'SETUP_SERVER_UNHANDLED', error instanceof Error ? error.message : String(error), { source: 'pp/setup' })));
    });
  });

  const closed = new Promise<void>((resolve) => {
    server.once('close', () => {
      closing = true;
      clearTimeout(idleTimer);
      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await close();
    throw new Error('Could not read PP Setup Manager listening address.');
  }

  const port = (address as AddressInfo).port;
  const url = `http://${HOST}:${port}/?token=${encodeURIComponent(token)}`;
  resetIdleTimer();

  if (options.openBrowser !== false) {
    try {
      openBrowser(url);
    } catch (error) {
      stderr.write(`Could not open a browser automatically: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  return { host: HOST, port, token, url, server, close, closed };

  async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${HOST}:${port}`);

    if (request.method === 'GET' && url.pathname === '/') {
      if (url.searchParams.get('token') !== token) {
        sendText(response, 403, 'PP Setup Manager link is missing or has an invalid token.');
        return;
      }
      sendHtml(
        response,
        renderHtml({
          appMode: 'setup',
          setupToken: token,
          title: 'PP Setup Manager',
          scriptSrc: '/assets/ui/app.js'
        })
      );
      return;
    }

    if (request.method === 'GET' && url.pathname === '/assets/ui/app.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      response.end(SETUP_RENDERER_JS ?? (await readFile(join(assetsDir!, 'renderer.js'), 'utf8')));
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      if (!isAuthorizedApiRequest(request, token, port)) {
        sendJson(response, 403, fail(createDiagnostic('error', 'SETUP_TOKEN_REQUIRED', 'PP Setup Manager API requests require this session token.', { source: 'pp/setup' })));
        return;
      }
      const body = await readJsonBody(request);
      const apiRequest: DesktopApiRequest = {
        path: `${url.pathname}${url.search}`,
        method: request.method ?? 'GET',
        body
      };
      const apiResponse = await handleDesktopApiRequest(context, apiRequest);
      sendJson(response, apiResponse.status, apiResponse.body);
      return;
    }

    sendText(response, 404, 'Not found.');
  }

  function resetIdleTimer(): void {
    clearTimeout(idleTimer);
    const timeout = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (timeout <= 0) return;
    idleTimer = setTimeout(() => {
      stderr.write('PP Setup Manager idle timeout reached. Shutting down.\n');
      void close();
    }, timeout);
    idleTimer.unref?.();
  }

  function close(): Promise<void> {
    if (closing) return closed;
    closing = true;
    clearTimeout(idleTimer);
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function isAuthorizedApiRequest(request: IncomingMessage, token: string, port: number): boolean {
  const supplied = request.headers['x-pp-setup-token'];
  const suppliedToken = Array.isArray(supplied) ? supplied[0] : supplied;
  if (suppliedToken !== token) return false;

  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === `http://${HOST}:${port}`;
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_API_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`Invalid JSON request body: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(html);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(text);
}

function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    shell: false
  });
  child.unref();
}

function resolveSetupAssetsDir(explicitDir?: string): string {
  const candidates = [
    explicitDir,
    process.env.PP_SETUP_ASSETS_DIR,
    join(dirname(process.execPath), 'setup'),
    join(dirname(process.execPath), 'setup-assets'),
    join(moduleDir(), 'setup'),
    join(moduleDir(), 'desktop'),
    join(moduleDir(), '..', 'dist', 'desktop'),
    join(process.cwd(), 'dist', 'desktop')
  ].filter((value): value is string => Boolean(value));

  const found = candidates.find((candidate) => existsSync(join(candidate, 'renderer.js')));
  if (found) return found;
  throw new Error(`Could not find PP Setup Manager assets. Checked: ${candidates.join(', ')}`);
}

function moduleDir(): string {
  if (typeof __dirname !== 'undefined') return __dirname;
  if (process.argv[1]) return dirname(process.argv[1]);
  return process.cwd();
}
