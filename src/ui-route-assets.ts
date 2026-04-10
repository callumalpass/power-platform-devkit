import { UI_CLIENT_BUNDLE } from './generated/ui-client.js';
import type { ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { getConfigDir, getConfigPath, getMsalCacheDir } from './config.js';
import { fail, ok, type OperationResult } from './diagnostics.js';
import { renderHtml } from './ui-app.js';
import { sendJavaScript } from './ui-http.js';
import type { UiRequestContext } from './ui-routes.js';
import { listAccountSummaries } from './services/accounts.js';
import { listConfiguredEnvironments } from './services/environments.js';

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
  'pp.bap_request',
  'pp.powerapps_request',
  'pp.whoami',
  'pp.ping',
  'pp.token',
];

export async function handleUiAssetRoute(url: URL, response: ServerResponse, context: UiRequestContext): Promise<boolean> {
  if (url.pathname === '/assets/ui/app.js') {
    sendJavaScript(response, UI_CLIENT_BUNDLE);
    return true;
  }
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderHtml());
    return true;
  }
  return false;
}

export async function loadUiState(context: UiRequestContext): Promise<OperationResult<Record<string, unknown>>> {
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

function buildMcpLaunchCommand(context: UiRequestContext): string {
  const parts = ['pp', 'mcp'];
  if (context.configOptions.configDir) parts.push('--config-dir', quoteShell(context.configOptions.configDir));
  if (context.allowInteractiveAuth) parts.push('--allow-interactive-auth');
  return parts.join(' ');
}

function quoteShell(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
