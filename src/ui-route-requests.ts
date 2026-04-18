import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readJsonBody, sendJson } from './ui-http.js';
import { readApiRequestInput } from './ui-request-parsing.js';
import type { UiRequestContext } from './ui-routes.js';
import { executeApiRequest } from './services/api.js';
import { getEnvironment } from './config.js';
import { createDiagnostic, fail, type OperationResult } from './diagnostics.js';

export interface ResponsePreview {
  text: string;
  truncated: boolean;
  originalBytes: number;
  shownBytes: number;
  omittedBytes: number;
}

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
  sendJson(response, result.success || softFail ? 200 : 400, applyResponsePreviewLimit(result, readNumber(body.data.maxResponseBytes)));
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
  let temporaryToken: Awaited<ReturnType<typeof context.temporaryTokens.resolve>> | undefined;
  if (input.data.environment) {
    const environment = await getEnvironment(input.data.environment, context.configOptions);
    if (!environment.success) return void sendJson(response, 400, environment);
    if (!environment.data) {
      return void sendJson(response, 404, fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${input.data.environment} was not found.`, { source: 'pp/ui' })));
    }
    temporaryToken = await context.temporaryTokens.resolve({
      idOrName: temporaryTokenName,
      environment: environment.data,
      api,
      path: input.data.path,
    });
    if (!temporaryToken.success) return void sendJson(response, 400, temporaryToken);
  } else if (temporaryTokenName) {
    return void sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'Temporary token routing currently requires environment context.', { source: 'pp/ui' })));
  }

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
    tokenProviderOverride: temporaryToken?.data?.provider,
  }, context.configOptions, { allowInteractive: input.data.allowInteractive });

  if (result.success && result.data && temporaryToken?.data) {
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

export function applyResponsePreviewLimit<T extends { response?: unknown }>(
  result: OperationResult<T>,
  maxResponseBytes: number | undefined,
): OperationResult<T | (Omit<T, 'response'> & { responsePreview: ResponsePreview })> {
  if (!result.success || !result.data || maxResponseBytes === undefined || maxResponseBytes <= 0) return result;
  const preview = createResponsePreview(result.data.response, maxResponseBytes);
  if (!preview.truncated) return result;
  const { response: _response, ...rest } = result.data;
  return {
    ...result,
    data: {
      ...rest,
      responsePreview: preview,
    },
    diagnostics: [
      ...result.diagnostics,
      createDiagnostic('info', 'UI_RESPONSE_PREVIEW_TRUNCATED', `Response preview was truncated to ${preview.shownBytes} bytes.`, {
        source: 'pp/ui',
        detail: `${preview.originalBytes} bytes returned; ${preview.omittedBytes} bytes omitted from the browser payload.`,
      }),
    ],
  };
}

function createResponsePreview(value: unknown, maxBytes: number): ResponsePreview {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return { text: '', truncated: false, originalBytes: 0, shownBytes: 0, omittedBytes: 0 };
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return {
      text,
      truncated: false,
      originalBytes: buffer.byteLength,
      shownBytes: buffer.byteLength,
      omittedBytes: 0,
    };
  }
  const shown = buffer.subarray(0, maxBytes);
  return {
    text: shown.toString('utf8'),
    truncated: true,
    originalBytes: buffer.byteLength,
    shownBytes: shown.byteLength,
    omittedBytes: buffer.byteLength - shown.byteLength,
  };
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
