import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import type { LoginAccountInput } from './auth.js';
import { getConfigDir, getConfigPath, getMsalCacheDir, type EnvironmentAccessMode } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import type { ApiKind } from './request.js';
import { listAccountSummaries, loginAccount, removeAccountByName } from './services/accounts.js';
import { runConnectivityPing, runWhoAmICheck } from './services/checks.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, listConfiguredEnvironments, removeConfiguredEnvironment } from './services/environments.js';

export interface PpUiOptions {
  configDir?: string;
  port?: number;
  openBrowser?: boolean;
  allowInteractiveAuth?: boolean;
}

const MCP_TOOLS = [
  'pp.account.list',
  'pp.account.inspect',
  'pp.account.save',
  'pp.account.remove',
  'pp.account.login',
  'pp.environment.list',
  'pp.environment.inspect',
  'pp.environment.add',
  'pp.environment.discover',
  'pp.environment.remove',
  'pp.request',
  'pp.dv_request',
  'pp.flow_request',
  'pp.graph_request',
  'pp.whoami',
  'pp.ping',
  'pp.token',
];

export async function startPpUi(options: PpUiOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const configOptions = options.configDir ? { configDir: options.configDir } : {};
  const host = '127.0.0.1';
  const port = options.port ?? 4733;
  const allowInteractiveAuth = options.allowInteractiveAuth ?? true;

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, {
        configOptions,
        allowInteractiveAuth,
        host,
        port,
      });
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

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${resolvedPort}`;
  process.stdout.write(`pp UI listening at ${url}\n`);
  if (options.openBrowser !== false) openBrowser(url);

  return {
    url,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

interface RequestContext {
  configOptions: { configDir?: string };
  allowInteractiveAuth: boolean;
  host: string;
  port: number;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${context.host}:${context.port}`);

  if (method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderHtml());
    return;
  }

  if (method === 'GET' && url.pathname === '/api/state') {
    sendJson(response, 200, await loadState(context));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/accounts/login') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const input = readLoginInput(body.data);
    if (!input.success || !input.data) {
      sendJson(response, 400, input);
      return;
    }
    const result = await loginAccount(input.data, {
      preferredFlow: body.data.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
      forcePrompt: Boolean(body.data.forcePrompt),
      allowInteractive: context.allowInteractiveAuth,
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'DELETE' && url.pathname.startsWith('/api/accounts/')) {
    const name = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
    const result = await removeAccountByName(name, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/environments/discover') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const account = optionalString(body.data.account);
    if (!account) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account is required.', { source: 'pp/ui' })));
      return;
    }
    const result = await discoverAccessibleEnvironments(
      account,
      context.configOptions,
      { allowInteractive: context.allowInteractiveAuth },
    );
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/environments') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const input = readEnvironmentInput(body.data);
    if (!input.success || !input.data) {
      sendJson(response, 400, input);
      return;
    }
    const result = await addConfiguredEnvironment(input.data, context.configOptions, {
      allowInteractive: context.allowInteractiveAuth,
    });
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'DELETE' && url.pathname.startsWith('/api/environments/')) {
    const alias = decodeURIComponent(url.pathname.slice('/api/environments/'.length));
    const result = await removeConfiguredEnvironment(alias, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/checks/whoami') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const environment = optionalString(body.data.environment);
    if (!environment) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
      return;
    }
    const result = await runWhoAmICheck({
      environmentAlias: environment,
      accountName: optionalString(body.data.account),
      allowInteractive: context.allowInteractiveAuth,
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/checks/ping') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const environment = optionalString(body.data.environment);
    const api = readPingApi(body.data.api);
    if (!environment) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
      return;
    }
    const result = await runConnectivityPing({
      environmentAlias: environment,
      accountName: optionalString(body.data.account),
      api,
      allowInteractive: context.allowInteractiveAuth,
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  sendJson(response, 404, fail(createDiagnostic('error', 'NOT_FOUND', `No route for ${method} ${url.pathname}.`, { source: 'pp/ui' })));
}

async function loadState(context: RequestContext): Promise<OperationResult<Record<string, unknown>>> {
  const accounts = await listAccountSummaries(context.configOptions);
  if (!accounts.success) return fail(...accounts.diagnostics);
  const environments = await listConfiguredEnvironments(context.configOptions);
  if (!environments.success) return fail(...environments.diagnostics);
  return ok({
    configDir: getConfigDir(context.configOptions),
    configPath: getConfigPath(context.configOptions),
    msalCacheDir: getMsalCacheDir(context.configOptions),
    allowInteractiveAuth: context.allowInteractiveAuth,
    accounts: accounts.data ?? [],
    environments: environments.data ?? [],
    mcp: {
      transport: 'stdio',
      tools: MCP_TOOLS,
      launchCommand: buildMcpLaunchCommand(context),
      note: 'pp MCP uses stdio transport. Launch it from the consuming MCP client rather than from this UI.',
    },
  });
}

function buildMcpLaunchCommand(context: RequestContext): string {
  const parts = ['pp', 'mcp'];
  if (context.configOptions.configDir) parts.push('--config-dir', quoteShell(context.configOptions.configDir));
  if (context.allowInteractiveAuth) parts.push('--allow-interactive-auth');
  return parts.join(' ');
}

function quoteShell(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function readLoginInput(value: unknown): OperationResult<LoginAccountInput> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_LOGIN_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const name = optionalString(value.name);
  const kind = readAccountKind(value.kind);
  if (!name) return fail(createDiagnostic('error', 'ACCOUNT_NAME_REQUIRED', 'name is required.', { source: 'pp/ui' }));
  if (!kind) return fail(createDiagnostic('error', 'ACCOUNT_KIND_REQUIRED', 'kind must be one of user, device-code, client-secret, environment-token, static-token.', { source: 'pp/ui' }));
  return ok({
    name,
    kind,
    description: optionalString(value.description),
    tenantId: optionalString(value.tenantId),
    clientId: optionalString(value.clientId),
    loginHint: optionalString(value.loginHint),
    prompt: readPrompt(optionalString(value.prompt)),
    fallbackToDeviceCode: Boolean(value.fallbackToDeviceCode),
    clientSecretEnv: optionalString(value.clientSecretEnv),
    environmentVariable: optionalString(value.environmentVariable),
    token: optionalString(value.token),
  });
}

function readEnvironmentInput(
  value: unknown,
): OperationResult<{ alias: string; url: string; account: string; displayName?: string; accessMode?: EnvironmentAccessMode }> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_ENVIRONMENT_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const alias = optionalString(value.alias);
  const url = optionalString(value.url);
  const account = optionalString(value.account);
  const accessMode = readAccessMode(value.accessMode);
  if (!alias) return fail(createDiagnostic('error', 'ENV_ALIAS_REQUIRED', 'alias is required.', { source: 'pp/ui' }));
  if (!url) return fail(createDiagnostic('error', 'ENV_URL_REQUIRED', 'url is required.', { source: 'pp/ui' }));
  if (!account) return fail(createDiagnostic('error', 'ENV_ACCOUNT_REQUIRED', 'account is required.', { source: 'pp/ui' }));
  if (value.accessMode !== undefined && !accessMode) {
    return fail(createDiagnostic('error', 'ENV_ACCESS_MODE_INVALID', 'accessMode must be read-only or read-write.', { source: 'pp/ui' }));
  }
  return ok({
    alias,
    url,
    account,
    displayName: optionalString(value.displayName),
    accessMode,
  });
}

async function readJsonBody(request: IncomingMessage): Promise<OperationResult<Record<string, unknown>>> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return ok({});
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return fail(createDiagnostic('error', 'INVALID_JSON_BODY', 'Request body must be a JSON object.', { source: 'pp/ui' }));
    }
    return ok(parsed);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'INVALID_JSON_BODY', 'Failed to parse request JSON.', {
        source: 'pp/ui',
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function sendJson(response: ServerResponse, status: number, body: OperationResult<unknown>): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
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

function readAccountKind(value: unknown): LoginAccountInput['kind'] | undefined {
  return value === 'user' || value === 'device-code' || value === 'client-secret' || value === 'environment-token' || value === 'static-token'
    ? value
    : undefined;
}

function readPrompt(value: string | undefined): LoginAccountInput['prompt'] | undefined {
  return value === 'select_account' || value === 'login' || value === 'consent' || value === 'none' ? value : undefined;
}

function readAccessMode(value: unknown): EnvironmentAccessMode | undefined {
  return value === 'read-only' || value === 'read-write' ? value : undefined;
}

function readPingApi(value: unknown): Exclude<ApiKind, 'custom'> {
  return value === 'flow' || value === 'graph' ? value : 'dv';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pp</title>
  <style>
    :root {
      --bg: #f9fafb;
      --surface: #ffffff;
      --ink: #111111;
      --muted: #6b7280;
      --border: #e5e7eb;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --accent-soft: #eff6ff;
      --danger: #dc2626;
      --danger-hover: #b91c1c;
      --ok: #16a34a;
      --ok-soft: #f0fdf4;
      --warn-soft: #fef2f2;
      --radius: 12px;
      --radius-sm: 8px;
      --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111113;
        --surface: #1a1a1e;
        --ink: #e4e4e7;
        --muted: #71717a;
        --border: #27272a;
        --accent: #3b82f6;
        --accent-hover: #60a5fa;
        --accent-soft: rgba(59, 130, 246, 0.12);
        --danger: #ef4444;
        --danger-hover: #f87171;
        --ok: #22c55e;
        --ok-soft: rgba(34, 197, 94, 0.1);
        --warn-soft: rgba(239, 68, 68, 0.1);
      }
    }
    * { box-sizing: border-box; margin: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--ink);
      background: var(--bg);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      padding-bottom: 48px;
    }

    /* Toast */
    .toast-container {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 100;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .toast {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px 16px;
      font-size: 0.8125rem;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      animation: toast-in 200ms ease;
      pointer-events: auto;
    }
    .toast.ok { border-left: 3px solid var(--ok); }
    .toast.error { border-left: 3px solid var(--danger); }
    .toast.fade-out { animation: toast-out 200ms ease forwards; }
    @keyframes toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
    @keyframes toast-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(20px); } }

    /* Header */
    .header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header-inner {
      max-width: 1120px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 56px;
    }
    .logo {
      font-size: 1.125rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header-meta {
      display: flex;
      gap: 16px;
      align-items: center;
      font-size: 0.8125rem;
      color: var(--muted);
    }
    .header-meta code {
      font-family: var(--mono);
      font-size: 0.75rem;
      background: var(--bg);
      padding: 2px 8px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }

    /* Tabs */
    .tabs {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
    }
    .tabs-inner {
      max-width: 1120px;
      margin: 0 auto;
      display: flex;
      gap: 0;
    }
    .tab {
      padding: 12px 20px;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--muted);
      cursor: pointer;
      border: none;
      background: none;
      border-bottom: 2px solid transparent;
      transition: color 150ms, border-color 150ms;
      white-space: nowrap;
    }
    .tab:hover { color: var(--ink); }
    .tab.active {
      color: var(--ink);
      border-bottom-color: var(--accent);
    }

    /* Content */
    .content {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px;
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Cards */
    .section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 20px;
    }
    .section h2 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .section .desc {
      font-size: 0.8125rem;
      color: var(--muted);
      margin-bottom: 20px;
      line-height: 1.5;
    }
    .card-list {
      display: grid;
      gap: 12px;
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 16px;
      transition: border-color 150ms;
    }
    .card:hover { border-color: var(--muted); }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .card-title {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .card-title h3 {
      font-size: 0.9375rem;
      font-weight: 600;
    }
    .card-subtitle {
      width: 100%;
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--muted);
      margin-top: 2px;
      word-break: break-all;
    }
    .health-row {
      display: flex;
      gap: 10px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }
    .health-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 0.75rem;
      color: var(--muted);
    }
    .health-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .health-dot.pending {
      background: var(--border);
      animation: pulse 1.2s ease-in-out infinite;
    }
    .health-dot.ok { background: var(--ok); }
    .health-dot.error { background: var(--danger); }
    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    .badge {
      font-size: 0.6875rem;
      font-weight: 500;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .props {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 8px;
      font-size: 0.8125rem;
    }
    .prop-label {
      color: var(--muted);
      margin-bottom: 2px;
    }
    .prop-value {
      font-family: var(--mono);
      font-size: 0.75rem;
      word-break: break-all;
    }
    .empty {
      text-align: center;
      padding: 40px 16px;
      color: var(--muted);
      font-size: 0.875rem;
    }
    .empty-action {
      margin-top: 12px;
    }

    /* Buttons */
    button, select, input, textarea { font: inherit; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: 0.8125rem;
      font-weight: 500;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 120ms, opacity 120ms;
      position: relative;
      min-width: 0;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-secondary {
      background: var(--surface);
      color: var(--ink);
      border-color: var(--border);
    }
    .btn-secondary:hover:not(:disabled) { background: var(--bg); }
    .btn-danger {
      background: none;
      color: var(--danger);
      border-color: transparent;
      padding: 6px 12px;
      font-size: 0.75rem;
    }
    .btn-danger:hover:not(:disabled) { background: var(--warn-soft); }
    .btn-ghost {
      background: none;
      color: var(--accent);
      padding: 6px 12px;
      font-size: 0.8125rem;
    }
    .btn-ghost:hover:not(:disabled) { background: var(--accent-soft); }
    .btn-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .hidden { display: none !important; }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid transparent;
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 600ms linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Forms */
    form { display: grid; gap: 16px; }
    .form-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .field { display: grid; gap: 6px; }
    .field-label {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--ink);
    }
    .field-hint {
      font-size: 0.75rem;
      color: var(--muted);
      line-height: 1.5;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      font-size: 0.875rem;
      background: var(--surface);
      color: var(--ink);
      transition: border-color 150ms;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    textarea { min-height: 80px; resize: vertical; }
    .check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8125rem;
      color: var(--muted);
    }
    .check-row input[type="checkbox"] {
      width: 16px;
      height: 16px;
      min-width: 16px;
      padding: 0;
      margin: 0;
      border-radius: 4px;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .check-row label {
      cursor: pointer;
    }
    .conditional { display: none; }
    .conditional.visible { display: grid; }
    .advanced {
      border: 1px dashed var(--border);
      border-radius: var(--radius-sm);
      padding: 12px;
      background: var(--bg);
    }
    .advanced summary {
      cursor: pointer;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--ink);
    }
    .advanced[open] summary {
      margin-bottom: 12px;
    }
    .check-row.conditional.visible { display: flex; }

    /* Result */
    .result-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #1e1e2e;
      border-top: 1px solid #313244;
      transform: translateY(calc(100% - 40px));
      transition: transform 250ms ease;
      z-index: 20;
      max-height: 50vh;
    }
    .result-panel.open { transform: translateY(0); }
    .result-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 24px;
      cursor: pointer;
      color: #a6adc8;
      font-size: 0.8125rem;
      font-weight: 500;
      user-select: none;
    }
    .result-toggle .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #6c7086;
      flex-shrink: 0;
    }
    .result-toggle .dot.ok { background: var(--ok); }
    .result-toggle .dot.error { background: var(--danger); }
    .result-body {
      padding: 0 24px 16px;
      overflow: auto;
      max-height: calc(50vh - 40px);
    }
    .result-body pre {
      font-family: var(--mono);
      font-size: 0.8125rem;
      line-height: 1.6;
      color: #cdd6f4;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* MCP */
    .mcp-cmd-wrap {
      display: flex;
      align-items: stretch;
      gap: 0;
      margin-bottom: 16px;
    }
    .mcp-cmd {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm) 0 0 var(--radius-sm);
      padding: 12px 16px;
      font-family: var(--mono);
      font-size: 0.8125rem;
      user-select: all;
      overflow-x: auto;
    }
    .mcp-copy {
      background: var(--bg);
      border: 1px solid var(--border);
      border-left: none;
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      padding: 0 14px;
      cursor: pointer;
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 500;
      transition: background 120ms, color 120ms;
      white-space: nowrap;
    }
    .mcp-copy:hover { background: var(--border); color: var(--ink); }
    .tool-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 6px;
    }
    .tool-grid code {
      font-family: var(--mono);
      font-size: 0.75rem;
      background: var(--bg);
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      display: block;
    }

    @media (max-width: 768px) {
      .header-meta { display: none; }
      .content { padding: 16px; }
      .form-row { grid-template-columns: 1fr; }
      .props { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="toast-container" id="toasts"></div>
  <header class="header">
    <div class="header-inner">
      <span class="logo">pp</span>
      <div class="header-meta" id="meta"></div>
    </div>
  </header>
  <nav class="tabs">
    <div class="tabs-inner">
      <button class="tab active" data-tab="accounts">Accounts</button>
      <button class="tab" data-tab="environments">Environments</button>
      <button class="tab" data-tab="checks">Checks</button>
      <button class="tab" data-tab="mcp">MCP</button>
    </div>
  </nav>
  <div class="content">

    <!-- Accounts Tab -->
    <div class="tab-panel active" id="panel-accounts">
      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div>
            <h2>Accounts</h2>
            <p class="desc" style="margin-bottom:0">Configured authentication accounts.</p>
          </div>
          <button class="btn btn-secondary" id="refresh" type="button">Refresh</button>
        </div>
        <div class="card-list" id="accounts"></div>
      </div>
      <div class="section" id="account-form-section">
        <h2>Add Account</h2>
        <p class="desc">Create or update an account. Interactive login may open a browser window.</p>
        <form id="account-form">
          <div class="form-row">
            <div class="field">
              <span class="field-label">Name</span>
              <input name="name" required placeholder="e.g. my-work-account">
            </div>
            <div class="field">
              <span class="field-label">Kind</span>
              <select name="kind" id="account-kind">
                <option value="user">user</option>
                <option value="device-code">device-code</option>
                <option value="client-secret">client-secret</option>
                <option value="environment-token">environment-token</option>
                <option value="static-token">static-token</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <span class="field-label">Description</span>
              <input name="description" placeholder="Optional">
            </div>
            <div class="field cond-user cond-device-code">
              <span class="field-label">Preferred Flow</span>
              <select name="preferredFlow">
                <option value="interactive">interactive</option>
                <option value="device-code">device-code</option>
              </select>
            </div>
          </div>
          <div class="form-row conditional cond-user cond-device-code cond-client-secret">
            <div class="field">
              <span class="field-label">Tenant ID</span>
              <input name="tenantId" placeholder="Optional for user, required for client-secret">
            </div>
            <div class="field">
              <span class="field-label">Client ID</span>
              <input name="clientId" placeholder="Optional override">
            </div>
          </div>
          <div class="form-row conditional cond-user cond-device-code">
            <div class="field">
              <span class="field-label">Login Hint</span>
              <input name="loginHint" placeholder="user@example.com">
            </div>
            <div class="field">
              <span class="field-label">Prompt</span>
              <select name="prompt">
                <option value="">default</option>
                <option value="select_account">select_account</option>
                <option value="login">login</option>
                <option value="consent">consent</option>
                <option value="none">none</option>
              </select>
            </div>
          </div>
          <div class="form-row conditional cond-client-secret">
            <div class="field">
              <span class="field-label">Client Secret Env Var</span>
              <input name="clientSecretEnv" placeholder="MY_CLIENT_SECRET">
            </div>
            <div class="field"></div>
          </div>
          <div class="form-row conditional cond-environment-token">
            <div class="field">
              <span class="field-label">Token Environment Variable</span>
              <input name="environmentVariable" placeholder="MY_TOKEN_VAR">
            </div>
            <div class="field"></div>
          </div>
          <div class="conditional cond-static-token">
            <div class="field">
              <span class="field-label">Static Token</span>
              <textarea name="token" placeholder="Paste token here"></textarea>
            </div>
          </div>
          <div class="check-row conditional cond-user cond-device-code">
            <input type="checkbox" name="forcePrompt" id="forcePrompt">
            <label for="forcePrompt">Force prompt on next login</label>
          </div>
          <div class="check-row conditional cond-user">
            <input type="checkbox" name="fallbackToDeviceCode" id="fallbackToDeviceCode">
            <label for="fallbackToDeviceCode">Allow fallback to device code</label>
          </div>
          <div class="btn-group">
            <button type="submit" class="btn btn-primary" id="account-submit">Save & Login</button>
            <button type="button" class="btn btn-secondary hidden" id="account-cancel">Cancel Pending Login</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Environments Tab -->
    <div class="tab-panel" id="panel-environments">
      <div class="section">
        <h2>Environments</h2>
        <p class="desc">Named environments mapped to accounts with auto-discovered metadata.</p>
        <div class="card-list" id="environments"></div>
      </div>
      <div class="section">
        <h2>Discover Environments</h2>
        <p class="desc">List environments accessible to an account, then add one to your config.</p>
        <form id="discover-form">
          <div class="form-row">
            <div class="field">
              <span class="field-label">Account</span>
              <select name="account" id="discover-account"></select>
            </div>
            <div class="field" style="align-self:end">
              <button type="submit" class="btn btn-secondary" id="discover-submit">Discover</button>
            </div>
          </div>
        </form>
        <div class="card-list" id="discovered-environments" style="margin-top:12px"></div>
      </div>
      <div class="section" id="env-form-section">
        <h2>Add Environment</h2>
        <p class="desc">Add an environment and discover its tenant and maker metadata.</p>
        <form id="environment-form">
          <div class="form-row">
            <div class="field">
              <span class="field-label">Alias</span>
              <input name="alias" required placeholder="e.g. dev, prod">
            </div>
            <div class="field">
              <span class="field-label">Account</span>
              <select name="account" id="environment-account"></select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <span class="field-label">URL</span>
              <input name="url" required placeholder="https://org.crm.dynamics.com">
            </div>
            <div class="field">
              <span class="field-label">Display Name</span>
              <input name="displayName" placeholder="Optional">
            </div>
          </div>
          <div class="field">
            <span class="field-label">Access Mode</span>
            <select name="accessMode">
              <option value="">read-write (default)</option>
              <option value="read-write">read-write</option>
              <option value="read-only">read-only</option>
            </select>
          </div>
          <div class="btn-group">
            <button type="submit" class="btn btn-primary" id="env-submit">Discover & Save</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Checks Tab -->
    <div class="tab-panel" id="panel-checks">
      <div class="section">
        <h2>Connectivity Checks</h2>
        <p class="desc">Run WhoAmI or ping calls to verify your configuration works end-to-end.</p>
        <form id="checks-form">
          <div class="field">
            <span class="field-label">Environment</span>
            <select name="environment" id="check-environment"></select>
          </div>
          <details class="advanced">
            <summary>Use Different Account (Advanced)</summary>
            <div class="field">
              <span class="field-label">Account</span>
              <select name="account" id="check-account"><option value="">Use environment default account</option></select>
              <span class="field-hint">Only use this to compare access or troubleshoot with an account other than the environment's configured default.</span>
            </div>
          </details>
          <div class="btn-group">
            <button type="button" class="btn btn-primary" data-check="whoami">WhoAmI</button>
            <button type="button" class="btn btn-secondary" data-check="dv">Ping Dataverse</button>
            <button type="button" class="btn btn-secondary" data-check="flow">Ping Flow</button>
            <button type="button" class="btn btn-secondary" data-check="graph">Ping Graph</button>
          </div>
        </form>
      </div>
    </div>

    <!-- MCP Tab -->
    <div class="tab-panel" id="panel-mcp">
      <div class="section">
        <h2>MCP Server</h2>
        <p class="desc">The MCP server uses stdio transport. Launch it from your MCP client.</p>
        <div id="mcp"></div>
      </div>
    </div>
  </div>

  <div class="result-panel" id="result-panel">
    <div class="result-toggle" id="result-toggle">
      <span style="display:flex;align-items:center;gap:8px"><span class="dot" id="result-dot"></span> <span id="result-label">Result</span></span>
      <span id="result-chevron">&#9650;</span>
    </div>
    <div class="result-body">
      <pre id="result">Waiting for first action\u2026</pre>
    </div>
  </div>

  <script>
    const state = { data: null };
    const resultEl = document.getElementById('result');
    const resultPanel = document.getElementById('result-panel');
    const resultDot = document.getElementById('result-dot');
    const resultLabel = document.getElementById('result-label');
    const accountsEl = document.getElementById('accounts');
    const environmentsEl = document.getElementById('environments');
    const discoveredEnvironmentsEl = document.getElementById('discovered-environments');
    const metaEl = document.getElementById('meta');
    const mcpEl = document.getElementById('mcp');
    const refreshButton = document.getElementById('refresh');
    const toastsEl = document.getElementById('toasts');
    const accountCancelButton = document.getElementById('account-cancel');
    let pendingLoginController = null;

    /* Environment health state: { [alias]: { dv: bool|undefined, flow: bool|undefined, graph: bool|undefined } } */
    const health = {};

    function checkHealth(environments) {
      const apis = ['dv', 'flow', 'graph'];
      for (const env of environments) {
        if (!health[env.alias]) health[env.alias] = {};
        for (const api of apis) {
          health[env.alias][api] = undefined;
          updateHealthDot(env.alias, api, 'pending');
          fetch('/api/checks/ping', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ environment: env.alias, api }),
          })
            .then((r) => r.json())
            .then((data) => {
              const ok = data.success !== false;
              health[env.alias][api] = ok;
              updateHealthDot(env.alias, api, ok ? 'ok' : 'error');
            })
            .catch(() => {
              health[env.alias][api] = false;
              updateHealthDot(env.alias, api, 'error');
            });
        }
      }
    }

    function updateHealthDot(alias, api, cls) {
      const row = document.getElementById('health-' + alias);
      if (!row) return;
      const items = row.querySelectorAll('.health-item');
      const apis = ['dv', 'flow', 'graph'];
      const idx = apis.indexOf(api);
      if (idx >= 0 && items[idx]) {
        const dot = items[idx].querySelector('.health-dot');
        if (dot) dot.className = 'health-dot ' + cls;
      }
    }

    /* Toast notifications */
    function toast(message, ok = true) {
      const el = document.createElement('div');
      el.className = 'toast ' + (ok ? 'ok' : 'error');
      el.textContent = message;
      toastsEl.appendChild(el);
      setTimeout(() => {
        el.classList.add('fade-out');
        el.addEventListener('animationend', () => el.remove());
      }, ok ? 3000 : 5000);
    }

    /* Button loading state */
    function setBtnLoading(btn, loading, label) {
      if (loading) {
        btn._origLabel = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>' + esc(label || btn._origLabel);
      } else {
        btn.disabled = false;
        btn.textContent = btn._origLabel || label || '';
      }
    }

    /* Tabs */
    function switchTab(tabName) {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tabName));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tabName));
    }
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    /* Result panel toggle */
    document.getElementById('result-toggle').addEventListener('click', () => {
      resultPanel.classList.toggle('open');
    });

    /* Conditional form fields */
    function updateAccountFields() {
      const kind = document.getElementById('account-kind').value;
      const form = document.getElementById('account-form');
      form.querySelectorAll('.conditional').forEach((el) => {
        el.classList.toggle('visible', el.classList.contains('cond-' + kind));
      });
    }
    document.getElementById('account-kind').addEventListener('change', updateAccountFields);
    updateAccountFields();

    function showResult(value, ok = true) {
      resultEl.textContent = JSON.stringify(value, null, 2);
      resultDot.className = 'dot ' + (ok ? 'ok' : 'error');
      resultLabel.textContent = ok ? 'Result' : 'Error';
    }

    async function request(path, options = {}) {
      try {
        const response = await fetch(path, {
          headers: { 'content-type': 'application/json' },
          ...options,
        });
        const data = await response.json();
        const ok = response.ok && data.success !== false;
        showResult(data, ok);
        if (!ok) throw new Error(summarizeError(data));
        return data;
      } catch (error) {
        if (error && error.name === 'AbortError') {
          const aborted = { success: false, diagnostics: [{ level: 'warning', code: 'REQUEST_ABORTED', message: 'Request cancelled in the UI.', source: 'pp/ui' }] };
          showResult(aborted, false);
          throw new Error('Request cancelled.');
        }
        throw error;
      }
    }

    function summarizeError(data) {
      if (data && data.diagnostics && data.diagnostics.length) {
        return data.diagnostics[0].message || 'Request failed';
      }
      return 'Request failed';
    }

    function optionMarkup(values, emptyLabel = '') {
      const empty = emptyLabel ? '<option value="">' + emptyLabel + '</option>' : '';
      return empty + values.map((value) => '<option value="' + esc(value) + '">' + esc(value) + '</option>').join('');
    }

    function esc(value) {
      return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
    }

    function renderState() {
      if (!state.data) return;
      const d = state.data.data;

      metaEl.innerHTML =
        '<span>Config <code>' + esc(d.configDir) + '</code></span>' +
        '<span>Auth ' + (d.allowInteractiveAuth ? 'interactive' : 'non-interactive') + '</span>';

      const accounts = d.accounts || [];
      accountsEl.innerHTML = accounts.length
        ? accounts.map((a) => {
            const rows = Object.entries(a)
              .filter(([k,v]) => v !== undefined && v !== null && v !== '' && k !== 'name' && k !== 'kind')
              .map(([k,v]) => '<div><div class="prop-label">' + esc(k) + '</div><div class="prop-value">' + esc(typeof v === 'string' ? v : JSON.stringify(v)) + '</div></div>')
              .join('');
            return '<article class="card"><div class="card-head"><div class="card-title"><h3>' + esc(a.name) + '</h3><span class="badge">' + esc(a.kind) + '</span></div><button class="btn btn-danger" data-remove-account="' + esc(a.name) + '">Remove</button></div>' + (rows ? '<div class="props">' + rows + '</div>' : '') + '</article>';
          }).join('')
        : '<div class="empty">No accounts configured yet.<div class="empty-action"><button class="btn btn-ghost" data-action="focus-add-account">Add your first account</button></div></div>';

      const environments = d.environments || [];
      environmentsEl.innerHTML = environments.length
        ? environments.map((e) => {
            const url = e.url || '';
            const rows = Object.entries(e)
              .filter(([k,v]) => v !== undefined && v !== null && v !== '' && k !== 'alias' && k !== 'account' && k !== 'url')
              .map(([k,v]) => '<div><div class="prop-label">' + esc(k) + '</div><div class="prop-value">' + esc(typeof v === 'string' ? v : JSON.stringify(v)) + '</div></div>')
              .join('');
            const alias = esc(e.alias);
            const healthRow =
              '<div class="health-row" id="health-' + alias + '">' +
              ['dv', 'flow', 'graph'].map((api) => {
                const h = health[e.alias] && health[e.alias][api];
                const cls = h === undefined ? 'pending' : h ? 'ok' : 'error';
                return '<span class="health-item"><span class="health-dot ' + cls + '"></span>' + api + '</span>';
              }).join('') +
              '</div>';
            return '<article class="card"><div class="card-head"><div class="card-title"><h3>' + alias + '</h3><span class="badge">' + esc(e.account) + '</span>' + (url ? '<div class="card-subtitle">' + esc(url) + '</div>' : '') + '</div><button class="btn btn-danger" data-remove-environment="' + esc(e.alias) + '">Remove</button></div>' + (rows ? '<div class="props">' + rows + '</div>' : '') + healthRow + '</article>';
          }).join('')
        : '<div class="empty">No environments configured yet.<div class="empty-action"><button class="btn btn-ghost" data-action="focus-add-env">Add your first environment</button></div></div>';

      const accountNames = accounts.map((a) => a.name);
      const envAliases = environments.map((e) => e.alias);
      document.getElementById('environment-account').innerHTML = optionMarkup(accountNames);
      document.getElementById('discover-account').innerHTML = optionMarkup(accountNames, 'Select account');
      document.getElementById('check-account').innerHTML = optionMarkup(accountNames, 'Environment default');
      document.getElementById('check-environment').innerHTML = optionMarkup(envAliases, 'Select environment');

      mcpEl.innerHTML =
        '<div class="field-label" style="margin-bottom:8px">Launch Command</div>' +
        '<div class="mcp-cmd-wrap"><div class="mcp-cmd" id="mcp-cmd">' + esc(d.mcp.launchCommand) + '</div><button class="mcp-copy" data-action="copy-mcp">Copy</button></div>' +
        '<div class="field-label" style="margin-bottom:8px">Available Tools (' + d.mcp.tools.length + ')</div>' +
        '<div class="tool-grid">' + d.mcp.tools.map((t) => '<code>' + esc(t) + '</code>').join('') + '</div>';
    }

    function formDataObject(form) {
      const data = {};
      const fd = new FormData(form);
      for (const [key, value] of fd.entries()) {
        if (typeof value === 'string' && value.trim() !== '') data[key] = value;
      }
      for (const el of form.querySelectorAll('input[type="checkbox"]')) {
        data[el.name] = el.checked;
      }
      return data;
    }

    async function refreshState(silent, runHealthChecks) {
      refreshButton.disabled = true;
      try {
        const prev = resultEl.textContent;
        const response = await fetch('/api/state', { headers: { 'content-type': 'application/json' } });
        state.data = await response.json();
        if (!silent) showResult(state.data, true);
        else { resultEl.textContent = prev; }
        renderState();
        if (runHealthChecks && state.data && state.data.data) {
          checkHealth(state.data.data.environments || []);
        }
      } catch (error) {
        if (!silent) {
          const message = error instanceof Error ? error.message : String(error);
          showResult({ success: false, diagnostics: [{ level: 'error', code: 'STATE_REFRESH_FAILED', message, source: 'pp/ui' }] }, false);
        }
      } finally {
        refreshButton.disabled = false;
      }
    }

    /* Auto-refresh polling during login */
    let loginPollTimer = null;
    function startLoginPoll() {
      stopLoginPoll();
      loginPollTimer = setInterval(() => void refreshState(true), 3000);
    }
    function stopLoginPoll() {
      if (loginPollTimer) { clearInterval(loginPollTimer); loginPollTimer = null; }
    }

    function setInteractiveLoginPending(pending) {
      accountCancelButton.classList.toggle('hidden', !pending);
    }

    accountCancelButton.addEventListener('click', () => {
      if (!pendingLoginController) return;
      pendingLoginController.abort();
      pendingLoginController = null;
      stopLoginPoll();
      setInteractiveLoginPending(false);
      toast('Pending login cancelled in the UI.', false);
    });

    document.getElementById('account-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const btn = document.getElementById('account-submit');
      const kind = document.getElementById('account-kind').value;
      const isInteractive = kind === 'user' || kind === 'device-code';
      setBtnLoading(btn, true, isInteractive ? 'Waiting for login\u2026' : 'Saving\u2026');
      if (isInteractive) {
        pendingLoginController = new AbortController();
        setInteractiveLoginPending(true);
        startLoginPoll();
      }
      try {
        await request('/api/accounts/login', {
          method: 'POST',
          body: JSON.stringify(formDataObject(form)),
          ...(pendingLoginController ? { signal: pendingLoginController.signal } : {}),
        });
        toast('Account saved successfully');
        form.reset();
        document.getElementById('account-kind').value = 'user';
        updateAccountFields();
        await refreshState(true);
      } catch (err) {
        toast(err.message, false);
      } finally {
        pendingLoginController = null;
        stopLoginPoll();
        setInteractiveLoginPending(false);
        setBtnLoading(btn, false, 'Save & Login');
      }
    });

    document.getElementById('environment-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const btn = document.getElementById('env-submit');
      setBtnLoading(btn, true, 'Discovering\u2026');
      try {
        await request('/api/environments', { method: 'POST', body: JSON.stringify(formDataObject(form)) });
        toast('Environment added successfully');
        form.reset();
        discoveredEnvironmentsEl.innerHTML = '';
        await refreshState(true, true);
      } catch (err) {
        toast(err.message, false);
      } finally {
        setBtnLoading(btn, false, 'Discover & Save');
      }
    });

    document.getElementById('discover-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const btn = document.getElementById('discover-submit');
      setBtnLoading(btn, true, 'Discovering\u2026');
      try {
        const result = await request('/api/environments/discover', { method: 'POST', body: JSON.stringify(formDataObject(form)) });
        const discovered = result.data || [];
        toast(discovered.length + ' environment' + (discovered.length === 1 ? '' : 's') + ' found');
        discoveredEnvironmentsEl.innerHTML = discovered.length
          ? discovered.map((env) => {
              const title = env.displayName || env.makerEnvironmentId || 'Unknown';
              const url = env.environmentApiUrl || env.environmentUrl || '';
              const rows = Object.entries(env)
                .filter(([k,v]) => v !== undefined && v !== null && v !== '' && k !== 'displayName' && k !== 'environmentApiUrl' && k !== 'environmentUrl')
                .map(([k,v]) => '<div><div class="prop-label">' + esc(k) + '</div><div class="prop-value">' + esc(typeof v === 'string' ? v : JSON.stringify(v)) + '</div></div>')
                .join('');
              return '<article class="card"><div class="card-head"><div class="card-title"><h3>' + esc(title) + '</h3>' + (url ? '<div class="card-subtitle">' + esc(url) + '</div>' : '') + '</div><button class="btn btn-ghost" data-use-discovered="' + esc(encodeURIComponent(JSON.stringify(env))) + '">Use</button></div>' + (rows ? '<div class="props">' + rows + '</div>' : '') + '</article>';
            }).join('')
          : '<div class="empty">No environments were returned for that account.</div>';
      } catch (err) {
        toast(err.message, false);
      } finally {
        setBtnLoading(btn, false, 'Discover');
      }
    });

    refreshButton.addEventListener('click', () => void refreshState(false, true));

    document.body.addEventListener('click', async (event) => {
      /* Empty state actions */
      const action = event.target.closest('[data-action]');
      if (action) {
        const act = action.dataset.action;
        if (act === 'focus-add-account') {
          document.getElementById('account-form-section').scrollIntoView({ behavior: 'smooth' });
          document.querySelector('#account-form input[name="name"]').focus();
          return;
        }
        if (act === 'focus-add-env') {
          switchTab('environments');
          document.getElementById('env-form-section').scrollIntoView({ behavior: 'smooth' });
          document.querySelector('#environment-form input[name="alias"]').focus();
          return;
        }
        if (act === 'copy-mcp') {
          const text = document.getElementById('mcp-cmd').textContent;
          navigator.clipboard.writeText(text).then(() => {
            toast('Copied to clipboard');
            action.textContent = 'Copied!';
            setTimeout(() => { action.textContent = 'Copy'; }, 1500);
          }, () => toast('Failed to copy', false));
          return;
        }
      }

      /* Remove account */
      const account = event.target.closest('[data-remove-account]');
      if (account) {
        if (!confirm('Remove account "' + account.dataset.removeAccount + '"?')) return;
        const btn = account;
        setBtnLoading(btn, true, 'Removing\u2026');
        try {
          await request('/api/accounts/' + encodeURIComponent(account.dataset.removeAccount), { method: 'DELETE' });
          toast('Account removed');
          await refreshState(true);
        } catch (err) { toast(err.message, false); } finally { setBtnLoading(btn, false, 'Remove'); }
        return;
      }

      /* Remove environment */
      const env = event.target.closest('[data-remove-environment]');
      if (env) {
        if (!confirm('Remove environment "' + env.dataset.removeEnvironment + '"?')) return;
        const btn = env;
        setBtnLoading(btn, true, 'Removing\u2026');
        try {
          await request('/api/environments/' + encodeURIComponent(env.dataset.removeEnvironment), { method: 'DELETE' });
          toast('Environment removed');
          await refreshState(true);
        } catch (err) { toast(err.message, false); } finally { setBtnLoading(btn, false, 'Remove'); }
        return;
      }

      /* Use discovered environment */
      const discovered = event.target.closest('[data-use-discovered]');
      if (discovered) {
        const payload = JSON.parse(decodeURIComponent(discovered.dataset.useDiscovered));
        const form = document.getElementById('environment-form');
        const alias = payload.displayName
          ? payload.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          : payload.makerEnvironmentId;
        form.elements.alias.value = alias || '';
        form.elements.account.value = payload.accountName || '';
        form.elements.url.value = payload.environmentApiUrl || payload.environmentUrl || '';
        form.elements.displayName.value = payload.displayName || '';
        document.getElementById('env-form-section').scrollIntoView({ behavior: 'smooth' });
        form.elements.alias.focus();
        return;
      }

      /* Check buttons */
      const checkBtn = event.target.closest('[data-check]');
      if (checkBtn) {
        const form = document.getElementById('checks-form');
        const payload = formDataObject(form);
        const kind = checkBtn.dataset.check;
        const label = checkBtn.textContent;
        setBtnLoading(checkBtn, true, 'Running\u2026');
        try {
          if (kind === 'whoami') {
            await request('/api/checks/whoami', { method: 'POST', body: JSON.stringify(payload) });
          } else {
            await request('/api/checks/ping', { method: 'POST', body: JSON.stringify({ ...payload, api: kind }) });
          }
          toast(label + ' succeeded');
          resultPanel.classList.add('open');
        } catch (err) {
          toast(err.message, false);
          resultPanel.classList.add('open');
        } finally { setBtnLoading(checkBtn, false, label); }
      }
    });

    void refreshState(true, true);
  </script>
</body>
</html>`;
}
