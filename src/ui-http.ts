import type { IncomingMessage, ServerResponse } from 'node:http';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';

export async function readJsonBody(request: IncomingMessage): Promise<OperationResult<Record<string, unknown>>> {
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

export function sendJson(response: ServerResponse, status: number, body: OperationResult<unknown>): void {
  let json: string;
  try {
    json = JSON.stringify(body, null, 2);
  } catch (error) {
    try {
      json = JSON.stringify(body);
    } catch {
      json = JSON.stringify({
        success: false,
        diagnostics: [{ level: 'error', code: 'SERIALIZE_ERROR', message: 'Failed to serialize response.', source: 'pp/ui' }],
      });
    }
  }
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(json, 'utf8').toString(),
  });
  response.end(json);
}

export function sendJavaScript(response: ServerResponse, source: string): void {
  response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
  response.end(source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
