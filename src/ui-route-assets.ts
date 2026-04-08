import type { ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { getConfigDir, getConfigPath, getMsalCacheDir } from './config.js';
import { fail, ok, type OperationResult } from './diagnostics.js';
import { renderHtml } from './ui-app.js';
import { renderAppModule } from './ui-client/app.js';
import { renderAppsModule } from './ui-client/apps.js';
import { renderAutomateModule } from './ui-client/automate.js';
import { renderConsoleModule } from './ui-client/console.js';
import { renderDataverseSharedModule } from './ui-client/dataverse-shared.js';
import { renderDomUtilsModule } from './ui-client/dom-utils.js';
import { renderExplorerModule } from './ui-client/explorer.js';
import { renderFetchXmlModule } from './ui-client/fetchxml.js';
import { renderPlatformModule } from './ui-client/platform.js';
import { renderQueryLabModule } from './ui-client/query-lab.js';
import { renderRenderUtilsModule } from './ui-client/render-utils.js';
import { renderRuntimeModule } from './ui-client/runtime.js';
import { renderSetupModule } from './ui-client/setup.js';
import { renderSharedModule } from './ui-client/shared.js';
import { renderStateModule } from './ui-client/state.js';
import { sendJavaScript } from './ui-http.js';
import type { UiRequestContext } from './ui-routes.js';
import { listAccountSummaries } from './services/accounts.js';
import { listConfiguredEnvironments } from './services/environments.js';

const UI_ASSET_MODULES: Record<string, () => string> = {
  '/assets/ui/shared.js': renderSharedModule,
  '/assets/ui/runtime.js': renderRuntimeModule,
  '/assets/ui/state.js': renderStateModule,
  '/assets/ui/dom-utils.js': renderDomUtilsModule,
  '/assets/ui/render-utils.js': renderRenderUtilsModule,
  '/assets/ui/dataverse-shared.js': renderDataverseSharedModule,
  '/assets/ui/setup.js': renderSetupModule,
  '/assets/ui/explorer.js': renderExplorerModule,
  '/assets/ui/query-lab.js': renderQueryLabModule,
  '/assets/ui/fetchxml.js': renderFetchXmlModule,
  '/assets/ui/console.js': renderConsoleModule,
  '/assets/ui/automate.js': renderAutomateModule,
  '/assets/ui/apps.js': renderAppsModule,
  '/assets/ui/platform.js': renderPlatformModule,
  '/assets/ui/app.js': renderAppModule,
};

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
  const assetModule = UI_ASSET_MODULES[url.pathname];
  if (assetModule) {
    sendJavaScript(response, assetModule());
    return true;
  }
  if (url.pathname.startsWith('/assets/vendor/')) {
    await context.sendVendorModule(response, decodeURIComponent(url.pathname.slice('/assets/vendor/'.length)));
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
