import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readJsonBody, sendJson } from './ui-http.js';
import { readApiRequestInput } from './ui-request-parsing.js';
import type { UiRequestContext } from './ui-routes.js';
import { executeApiRequest } from './services/api.js';
import { getEnvironment } from './config.js';
import { createDiagnostic, fail } from './diagnostics.js';

export async function handleRequestExecute(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const input = readApiRequestInput(body.data, context.allowInteractiveAuth);
  if (!input.success || !input.data) return void sendJson(response, 400, input);
  const softFail = body.data.softFail === true;
  const result = await executeApiRequest({
    environmentAlias: input.data.environment,
    accountName: input.data.account,
    api: input.data.api,
    method: input.data.method,
    path: input.data.path,
    query: input.data.query,
    headers: input.data.headers,
    body: input.data.body,
    responseType: 'json',
    readIntent: input.data.readIntent,
  }, context.configOptions, { allowInteractive: input.data.allowInteractive });
  sendJson(response, result.success || softFail ? 200 : 400, result);
}

export async function handleCliRequestExecute(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  if (!hasValidCliSecret(request, context.cliSecret)) {
    return void sendJson(response, 401, fail(createDiagnostic('error', 'UI_CLI_UNAUTHORIZED', 'CLI request is not authorized for this pp UI session.', { source: 'pp/ui' })));
  }
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const input = readApiRequestInput(body.data, context.allowInteractiveAuth);
  if (!input.success || !input.data) return void sendJson(response, 400, input);

  const api = input.data.api;
  const temporaryTokenName = optionalString(body.data.temporaryToken);
  const environment = await getEnvironment(input.data.environment, context.configOptions);
  if (!environment.success) return void sendJson(response, 400, environment);
  if (!environment.data) {
    return void sendJson(response, 404, fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${input.data.environment} was not found.`, { source: 'pp/ui' })));
  }

  const temporaryToken = await context.temporaryTokens.resolve({
    idOrName: temporaryTokenName,
    environment: environment.data,
    api,
    path: input.data.path,
  });
  if (!temporaryToken.success) return void sendJson(response, 400, temporaryToken);

  const result = await executeApiRequest({
    environmentAlias: input.data.environment,
    accountName: input.data.account,
    api,
    method: input.data.method,
    path: input.data.path,
    query: input.data.query,
    headers: input.data.headers,
    body: input.data.body,
    rawBody: optionalString(body.data.rawBody),
    responseType: readResponseType(body.data.responseType),
    timeoutMs: readNumber(body.data.timeoutMs),
    jq: optionalString(body.data.jq),
    readIntent: body.data.readIntent === undefined ? input.data.readIntent : Boolean(body.data.readIntent),
    tokenProviderOverride: temporaryToken.data?.provider,
  }, context.configOptions, { allowInteractive: input.data.allowInteractive });

  if (result.success && result.data && temporaryToken.data) {
    return void sendJson(response, 200, {
      ...result,
      data: {
        ...result.data,
        temporaryToken: temporaryToken.data.summary,
      },
    });
  }
  sendJson(response, result.success ? 200 : 400, result);
}

function hasValidCliSecret(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization;
  const prefix = 'Bearer ';
  const actual = typeof header === 'string' && header.startsWith(prefix) ? header.slice(prefix.length) : '';
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readResponseType(value: unknown): 'json' | 'text' | 'void' {
  return value === 'text' || value === 'void' ? value : 'json';
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
