import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { createDiagnostic, fail } from './diagnostics.js';
import { readJsonBody, sendJson } from './ui-http.js';
import { optionalString, readEnvironmentInput, readPingApi } from './ui-request-parsing.js';
import type { UiRequestContext } from './ui-routes.js';
import { runConnectivityPing, runWhoAmICheck } from './services/api.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, removeConfiguredEnvironment } from './services/environments.js';

export async function handleEnvironmentDiscover(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const account = optionalString(body.data.account);
  if (!account) return void sendJson(response, 400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account is required.', { source: 'pp/ui' })));
  const result = await discoverAccessibleEnvironments(account, context.configOptions, { allowInteractive: context.allowInteractiveAuth });
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handleEnvironmentCreate(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const input = readEnvironmentInput(body.data);
  if (!input.success || !input.data) return void sendJson(response, 400, input);
  const result = await addConfiguredEnvironment(input.data, context.configOptions, { allowInteractive: context.allowInteractiveAuth });
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handleEnvironmentDelete(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const alias = decodeURIComponent(url.pathname.slice('/api/environments/'.length));
  const result = await removeConfiguredEnvironment(alias, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handleWhoAmICheck(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const environment = optionalString(body.data.environment);
  if (!environment) return void sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
  const result = await runWhoAmICheck({ environmentAlias: environment, accountName: optionalString(body.data.account), allowInteractive: false }, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handlePing(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const environment = optionalString(body.data.environment);
  if (!environment) return void sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
  const result = await runConnectivityPing({
    environmentAlias: environment,
    accountName: optionalString(body.data.account),
    api: readPingApi(body.data.api),
    allowInteractive: false,
  }, context.configOptions);
  sendJson(response, result.success || body.data.softFail === true ? 200 : 400, result);
}
