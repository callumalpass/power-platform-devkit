import * as jq from 'jq-wasm';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';

export interface JqTransformOptions {
  expr: string;
  raw?: boolean;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export type JqTransformInput = string | JqTransformOptions;

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

export async function applyJqTransform(input: unknown, transform: JqTransformInput): Promise<OperationResult<unknown>> {
  const options = normalizeJqTransform(transform);
  if (!options.success || !options.data) return options;

  try {
    const jsonInput = JSON.stringify(input) ?? 'null';
    const result = await withTimeout(jq.raw(jsonInput, options.data.expr, options.data.raw ? ['-r'] : ['-c']), options.data.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (result.exitCode !== 0 || result.stderr.trim()) {
      return fail(
        createDiagnostic('error', 'JQ_TRANSFORM_FAILED', 'jq transform failed.', {
          source: 'pp/jq',
          detail: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
        })
      );
    }

    const maxOutputBytes = options.data.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const outputBytes = Buffer.byteLength(result.stdout, 'utf8');
    if (outputBytes > maxOutputBytes) {
      return fail(
        createDiagnostic('error', 'JQ_OUTPUT_TOO_LARGE', `jq output was ${outputBytes} bytes, exceeding the ${maxOutputBytes} byte limit.`, {
          source: 'pp/jq',
          hint: 'Narrow the API query, add a jq limit/slice, or raise maxOutputBytes.'
        })
      );
    }

    if (options.data.raw) return ok(result.stdout);
    return parseJsonLines(result.stdout);
  } catch (error) {
    return fail(createDiagnostic('error', 'JQ_TRANSFORM_ERROR', error instanceof Error ? error.message : String(error), { source: 'pp/jq' }));
  }
}

function normalizeJqTransform(transform: JqTransformInput): OperationResult<JqTransformOptions> {
  const options = typeof transform === 'string' ? { expr: transform } : transform;
  if (!options.expr.trim()) {
    return fail(createDiagnostic('error', 'JQ_EXPRESSION_REQUIRED', 'jq expression must not be empty.', { source: 'pp/jq' }));
  }
  if (options.maxOutputBytes !== undefined && (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0)) {
    return fail(createDiagnostic('error', 'JQ_MAX_OUTPUT_INVALID', 'jq maxOutputBytes must be a positive integer.', { source: 'pp/jq' }));
  }
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)) {
    return fail(createDiagnostic('error', 'JQ_TIMEOUT_INVALID', 'jq timeoutMs must be a positive integer.', { source: 'pp/jq' }));
  }
  return ok(options);
}

function parseJsonLines(output: string): OperationResult<unknown> {
  if (!output) return ok(null);
  const lines = output.split('\n').filter(Boolean);
  try {
    if (lines.length === 1) return ok(JSON.parse(lines[0]));
    return ok(lines.map((line) => JSON.parse(line)));
  } catch (error) {
    return fail(
      createDiagnostic('error', 'JQ_OUTPUT_PARSE_FAILED', 'jq output was not valid JSON. Use raw mode for text output.', {
        source: 'pp/jq',
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`jq transform timed out after ${timeoutMs} ms.`)), timeoutMs);
    timeout.unref?.();
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
