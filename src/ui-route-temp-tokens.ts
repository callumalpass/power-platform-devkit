import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { createDiagnostic, fail, ok } from './diagnostics.js';
import { readJsonBody, sendJson } from './ui-http.js';
import type { UiRequestContext } from './ui-routes.js';
import type { ApiKind } from './request.js';

export function handleTemporaryTokenList(response: ServerResponse, context: UiRequestContext): void {
  sendJson(response, 200, ok(context.temporaryTokens.list()));
}

export async function handleTemporaryTokenCreate(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const token = optionalString(body.data.token);
  if (!token) {
    return void sendJson(response, 400, fail(createDiagnostic('error', 'TEMP_TOKEN_REQUIRED', 'token is required.', { source: 'pp/ui' })));
  }
  const match = readTemporaryTokenMatch(body.data);
  if (!match.success) return void sendJson(response, 400, match);
  const result = context.temporaryTokens.add({
    name: optionalString(body.data.name),
    token,
    match: match.data,
  });
  sendJson(response, result.success ? 201 : 400, result);
}

export function handleTemporaryTokenDelete(url: URL, response: ServerResponse, context: UiRequestContext): void {
  const id = decodeURIComponent(url.pathname.slice('/api/temp-tokens/'.length));
  const removed = context.temporaryTokens.remove(id);
  sendJson(response, removed ? 200 : 404, removed ? ok({ removed: true }) : fail(createDiagnostic('error', 'TEMP_TOKEN_NOT_FOUND', `Temporary token ${id} was not found.`, { source: 'pp/ui' })));
}

function readTemporaryTokenMatch(value: Record<string, unknown>) {
  const matchKind = optionalString(value.matchKind);
  if (!matchKind) return ok(undefined);
  if (matchKind === 'origin') {
    const origin = optionalString(value.origin);
    if (!origin) return fail(createDiagnostic('error', 'TEMP_TOKEN_ORIGIN_REQUIRED', 'origin is required for origin token matching.', { source: 'pp/ui' }));
    try {
      const url = new URL(origin);
      return ok({ kind: 'origin' as const, origin: url.origin });
    } catch {
      return fail(createDiagnostic('error', 'TEMP_TOKEN_ORIGIN_INVALID', 'origin must be an absolute URL origin.', { source: 'pp/ui' }));
    }
  }
  if (matchKind === 'api') {
    const api = readApi(value.api);
    if (!api || api === 'custom') return fail(createDiagnostic('error', 'TEMP_TOKEN_API_INVALID', 'api must be dv, flow, graph, bap, powerapps, or canvas-authoring.', { source: 'pp/ui' }));
    return ok({ kind: 'api' as const, api });
  }
  if (matchKind === 'audience') {
    const audience = optionalString(value.audience);
    if (!audience) return fail(createDiagnostic('error', 'TEMP_TOKEN_AUDIENCE_REQUIRED', 'audience is required for audience token matching.', { source: 'pp/ui' }));
    return ok({ kind: 'audience' as const, audience });
  }
  return fail(createDiagnostic('error', 'TEMP_TOKEN_MATCH_INVALID', 'matchKind must be origin, api, or audience.', { source: 'pp/ui' }));
}

function readApi(value: unknown): ApiKind | undefined {
  return value === 'dv' || value === 'flow' || value === 'graph' || value === 'bap' || value === 'powerapps' || value === 'canvas-authoring' || value === 'custom'
    ? value
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
