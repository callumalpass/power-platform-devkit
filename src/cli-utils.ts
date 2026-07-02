import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import YAML from 'yaml';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import type { ConfigStoreOptions } from './config.js';
import type { JqTransformInput, JqTransformScope } from './jq-transform.js';

export type OutputFormat = 'json' | 'yaml' | 'text';

const BOOLEAN_FLAGS = new Set([
  '--apply',
  '--allow-interactive-auth',
  '--device-code',
  '--force-prompt',
  '--lan',
  '--log',
  '--log-results',
  '--jq-raw',
  '--no-interactive-auth',
  '--no-log',
  '--no-log-results',
  '--pair',
  '--read',
  '--raw',
  '--with-signalr'
]);

export function readFlag(args: string[], name: string): string | undefined {
  const aliases = name === '--environment' ? ['--env', '--environment'] : [name];
  for (const alias of aliases) {
    const index = args.indexOf(alias);
    if (index >= 0) return args[index + 1];
  }
  return undefined;
}

export function hasFlag(args: string[], name: string): boolean {
  const aliases = name === '--environment' ? ['--env', '--environment'] : [name];
  return aliases.some((alias) => args.includes(alias));
}

export function readRepeatedFlags(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1]) {
      values.push(args[i + 1]!);
      i += 1;
    }
  }
  return values;
}

export function positionalArgs(args: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (!value) continue;
    if (value.startsWith('--')) {
      if (!BOOLEAN_FLAGS.has(value)) i += 1;
      continue;
    }
    values.push(value);
  }
  return values;
}

export function readConfigOptions(args: string[]): ConfigStoreOptions {
  const configDir = readFlag(args, '--config-dir');
  const credentialStore = readFlag(args, '--credential-store');
  return {
    ...(configDir ? { configDir: isAbsolute(configDir) ? configDir : resolvePath(process.cwd(), configDir) } : {}),
    ...(credentialStore === 'auto' || credentialStore === 'os' || credentialStore === 'file' ? { credentialStore } : {})
  };
}

export function readOutputFormat(args: string[], fallback: OutputFormat = 'json'): OutputFormat {
  const format = readFlag(args, '--format');
  return format === 'yaml' || format === 'text' || format === 'json' ? format : fallback;
}

export function printOutput(value: unknown, format: OutputFormat): void {
  if (format === 'yaml') {
    process.stdout.write(YAML.stringify(value));
    return;
  }
  if (format === 'text' && typeof value === 'string') {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printResult(value: unknown, args: string[]): void {
  printOutput(value, readOutputFormat(args));
}

export function printFailure(result: OperationResult<unknown>, args: string[] = []): number {
  printOutput({ success: false, diagnostics: result.diagnostics }, readOutputFormat(args));
  return 1;
}

export async function readBody(args: string[]): Promise<OperationResult<{ body?: unknown; rawBody?: string }>> {
  const rawBody = readFlag(args, '--raw-body');
  const rawBodyFile = readFlag(args, '--raw-body-file');
  if (rawBody !== undefined && rawBodyFile !== undefined) {
    return fail(createDiagnostic('error', 'BODY_FLAGS_CONFLICT', 'Use either --raw-body or --raw-body-file, not both.', { source: 'pp/cli' }));
  }
  if (rawBody !== undefined) return ok({ rawBody });
  if (rawBodyFile !== undefined) return ok({ rawBody: await readFile(rawBodyFile, 'utf8') });

  const body = readFlag(args, '--body');
  const bodyFile = readFlag(args, '--body-file');
  if (body !== undefined && bodyFile !== undefined) {
    return fail(createDiagnostic('error', 'BODY_FLAGS_CONFLICT', 'Use either --body or --body-file, not both.', { source: 'pp/cli' }));
  }
  try {
    if (body !== undefined) return ok({ body: JSON.parse(body) });
    if (bodyFile !== undefined) return ok({ body: JSON.parse(await readFile(bodyFile, 'utf8')) });
    return ok({});
  } catch (error) {
    return fail(
      createDiagnostic('error', 'BODY_PARSE_FAILED', 'Failed to parse request body as JSON.', {
        source: 'pp/cli',
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

export function readHeaderFlags(args: string[]): Record<string, string> | undefined {
  const entries = readRepeatedFlags(args, '--header')
    .map((value) => {
      const index = value.indexOf(':');
      if (index < 0) return undefined;
      const key = value.slice(0, index).trim();
      const headerValue = value.slice(index + 1).trim();
      return key && headerValue ? ([key, headerValue] as const) : undefined;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function readQueryFlags(args: string[]): Record<string, string> | undefined {
  const entries = readRepeatedFlags(args, '--query')
    .map((value) => {
      const index = value.indexOf('=');
      if (index < 0) return undefined;
      const key = value.slice(0, index).trim();
      const queryValue = value.slice(index + 1).trim();
      return key ? ([key, queryValue] as const) : undefined;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function readRequestQuery(args: string[]): OperationResult<Record<string, string> | undefined> {
  const queryJson = readFlag(args, '--query-json');
  let parsedQuery: Record<string, string> | undefined;
  if (queryJson !== undefined) {
    try {
      const value = JSON.parse(queryJson) as unknown;
      if (!isPlainRecord(value)) {
        return fail(createDiagnostic('error', 'QUERY_JSON_INVALID', '--query-json must be a JSON object.', { source: 'pp/cli' }));
      }
      parsedQuery = {};
      for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
          return fail(createDiagnostic('error', 'QUERY_JSON_VALUE_INVALID', '--query-json values must be strings, numbers, or booleans.', { source: 'pp/cli', detail: key }));
        }
        parsedQuery[key] = String(item);
      }
    } catch (error) {
      return fail(
        createDiagnostic('error', 'QUERY_JSON_PARSE_FAILED', 'Failed to parse --query-json as JSON.', {
          source: 'pp/cli',
          detail: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  const query = { ...(parsedQuery ?? {}), ...(readQueryFlags(args) ?? {}) };
  return ok(Object.keys(query).length ? query : undefined);
}

export function readJqTransform(args: string[]): OperationResult<JqTransformInput | undefined> {
  const expr = readFlag(args, '--jq');
  const raw = hasFlag(args, '--jq-raw');
  const scope = readJqScopeFlag(args);
  if (!scope.success) return fail(...scope.diagnostics);

  const maxOutputBytes = readPositiveIntegerFlag(args, '--jq-max-output-bytes', 'JQ_MAX_OUTPUT_INVALID', 'jq maxOutputBytes must be a positive integer.');
  if (!maxOutputBytes.success) return fail(...maxOutputBytes.diagnostics);

  const timeoutMs = readPositiveIntegerFlag(args, '--jq-timeout-ms', 'JQ_TIMEOUT_INVALID', 'jq timeoutMs must be a positive integer.');
  if (!timeoutMs.success) return fail(...timeoutMs.diagnostics);

  if (expr === undefined) {
    if (raw || scope.data || maxOutputBytes.data !== undefined || timeoutMs.data !== undefined) {
      return fail(createDiagnostic('error', 'JQ_EXPRESSION_REQUIRED', 'Pass --jq EXPR when using jq options.', { source: 'pp/cli' }));
    }
    return ok(undefined);
  }

  if (!raw && scope.data === undefined && maxOutputBytes.data === undefined && timeoutMs.data === undefined) return ok(expr);
  return ok({
    expr,
    ...(raw ? { raw } : {}),
    ...(scope.data ? { scope: scope.data } : {}),
    ...(maxOutputBytes.data !== undefined ? { maxOutputBytes: maxOutputBytes.data } : {}),
    ...(timeoutMs.data !== undefined ? { timeoutMs: timeoutMs.data } : {})
  });
}

export function argumentFailure(code: string, message: string): OperationResult<never> {
  return fail(createDiagnostic('error', code, message, { source: 'pp/cli' }));
}

function readJqScopeFlag(args: string[]): OperationResult<JqTransformScope | undefined> {
  const scope = readFlag(args, '--jq-scope');
  if (scope === undefined) return ok(undefined);
  if (scope === 'response' || scope === 'envelope') return ok(scope);
  return fail(createDiagnostic('error', 'JQ_SCOPE_INVALID', 'jq scope must be response or envelope.', { source: 'pp/cli' }));
}

function readPositiveIntegerFlag(args: string[], name: string, code: string, message: string): OperationResult<number | undefined> {
  const value = readFlag(args, name);
  if (value === undefined) return ok(undefined);
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    return fail(createDiagnostic('error', code, message, { source: 'pp/cli' }));
  }
  return ok(numberValue);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
