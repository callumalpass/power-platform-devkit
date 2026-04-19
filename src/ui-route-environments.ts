import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { createDiagnostic, fail, ok } from './diagnostics.js';
import { readJsonBody, sendJson } from './ui-http.js';
import { optionalString, readPingApi } from './ui-request-parsing.js';
import { readEnvironmentInput } from './ui-request-parsing.js';
import type { UiRequestContext } from './ui-routes.js';
import { runConnectivityPing, runWhoAmICheck } from './services/api.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, removeConfiguredEnvironment } from './services/environments.js';
import { getEnvironment, saveEnvironment, type Environment } from './config.js';
import { normalizeOrigin } from './request-executor.js';

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

export async function handleEnvironmentUpdate(request: IncomingMessage, response: ServerResponse, url: URL, context: UiRequestContext): Promise<void> {
  const alias = decodeURIComponent(url.pathname.slice('/api/environments/'.length));
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const data = body.data as Record<string, unknown>;
  const existing = await getEnvironment(alias, context.configOptions);
  if (!existing.success) return void sendJson(response, 400, existing);
  if (!existing.data) {
    return void sendJson(response, 404, fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${alias} was not found.`, { source: 'pp/ui' })));
  }
  const nextAccount = optionalString(data.account) ?? existing.data.account;
  const nextUrl = optionalString(data.url) ?? existing.data.url;
  const nextDisplayName = data.displayName === undefined ? existing.data.displayName : optionalString(data.displayName);
  const nextAccessRaw = optionalString(data.accessMode);
  let nextAccess: Environment['access'] | undefined;
  if (data.accessMode === undefined) {
    nextAccess = existing.data.access;
  } else if (nextAccessRaw === 'read-only' || nextAccessRaw === 'read-write') {
    nextAccess = { mode: nextAccessRaw };
  } else if (!nextAccessRaw) {
    nextAccess = undefined;
  } else {
    return void sendJson(response, 400, fail(createDiagnostic('error', 'ENV_ACCESS_MODE_INVALID', 'accessMode must be read-only or read-write.', { source: 'pp/ui' })));
  }
  const merged: Environment = {
    ...existing.data,
    account: nextAccount,
    url: normalizeOrigin(nextUrl),
    ...(nextDisplayName === undefined ? {} : { displayName: nextDisplayName }),
    ...(nextAccess === undefined ? (existing.data.access ? { access: undefined as any } : {}) : { access: nextAccess }),
  };
  if (nextAccess === undefined) delete (merged as any).access;
  const saved = await saveEnvironment(merged, context.configOptions);
  sendJson(response, saved.success ? 200 : 400, saved.success ? ok(saved.data, saved.diagnostics) : saved);
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
