import { stableStringify } from '@pp/artifacts';
import { type OutputMode } from '@pp/config';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult, type ResultOptions } from '@pp/diagnostics';
import YAML from 'yaml';

export type CliOutputFormat = OutputMode;

export interface MutationFlags {
  mode: 'apply' | 'dry-run' | 'plan';
  dryRun: boolean;
  plan: boolean;
  yes: boolean;
}

const SUPPORTED_OUTPUT_FORMATS = ['table', 'json', 'yaml', 'ndjson', 'markdown', 'raw'] as const satisfies ReadonlyArray<CliOutputFormat>;

export function readOutputFormat(args: string[], fallback: CliOutputFormat): OperationResult<CliOutputFormat> {
  const index = args.indexOf('--format');

  if (index === -1) {
    return ok(fallback, {
      supportTier: 'preview',
    });
  }

  const candidate = args[index + 1];

  if (candidate && isOutputFormat(candidate)) {
    return ok(candidate, {
      supportTier: 'preview',
    });
  }

  return fail(
    createDiagnostic(
      'error',
      'CLI_OUTPUT_FORMAT_INVALID',
      `Unsupported --format. Use one of: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}.`,
      {
        source: '@pp/cli',
      }
    )
  );
}

export function resolveOutputFormat(args: string[], fallback: CliOutputFormat): CliOutputFormat {
  const result = readOutputFormat(args, fallback);
  return result.success && result.data ? result.data : fallback;
}

export function renderOutput(value: unknown, format: CliOutputFormat): string {
  switch (format) {
    case 'raw':
      return typeof value === 'string' ? ensureTrailingNewline(value) : renderTable(value);
    case 'markdown':
      return typeof value === 'string' ? ensureTrailingNewline(value) : renderMarkdown(value);
    case 'yaml':
      return ensureTrailingNewline(YAML.stringify(value));
    case 'ndjson':
      return renderNdjson(value);
    case 'table':
      return renderTable(value);
    case 'json':
    default:
      return ensureTrailingNewline(stableStringify(asJsonValue(value) as never));
  }
}

export function renderFailure(result: OperationResult<unknown>, format: CliOutputFormat): string {
  return renderDiagnostics(result, format, false);
}

export function renderResultDiagnostics(result: OperationResult<unknown>, format: CliOutputFormat): string {
  if (result.diagnostics.length === 0 && result.warnings.length === 0) {
    return '';
  }

  return renderDiagnostics(result, format, result.success);
}

export function renderWarnings(warnings: Diagnostic[]): string {
  return ensureTrailingNewline(
    warnings
      .map((warning) => {
        const parts = [`${warning.level.toUpperCase()} ${warning.code}: ${warning.message}`];

        if (warning.hint) {
          parts.push(`hint=${warning.hint}`);
        }

        if (warning.detail) {
          parts.push(`detail=${warning.detail}`);
        }

        return parts.join(' ');
      })
      .join('\n')
  );
}

export function readMutationFlags(args: string[]): OperationResult<MutationFlags> {
  const dryRun = args.includes('--dry-run');
  const plan = args.includes('--plan');
  const yes = args.includes('--yes');

  if (dryRun && plan) {
    return fail(
      createDiagnostic('error', 'CLI_MUTATION_MODE_CONFLICT', 'Use either --dry-run or --plan, not both.', {
        source: '@pp/cli',
      })
    );
  }

  return ok(
    {
      mode: plan ? 'plan' : dryRun ? 'dry-run' : 'apply',
      dryRun,
      plan,
      yes,
    },
    {
      supportTier: 'preview',
    }
  );
}

export function createMutationPreview(
  action: string,
  flags: MutationFlags,
  target: Record<string, unknown>,
  input?: unknown,
  metadata: ResultOptions = {},
  details: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    action,
    mode: flags.mode,
    confirmed: flags.yes,
    willMutate: false,
    target,
    input,
    supportTier: metadata.supportTier ?? 'preview',
    suggestedNextActions: metadata.suggestedNextActions ?? [],
    provenance: metadata.provenance ?? [],
    knownLimitations: metadata.knownLimitations ?? [],
    ...details,
  };
}

export function createSuccessPayload(
  value: unknown,
  result: Pick<
    OperationResult<unknown>,
    'diagnostics' | 'warnings' | 'supportTier' | 'suggestedNextActions' | 'provenance' | 'knownLimitations'
  >,
  options: { dataKey?: string } = {}
): Record<string, unknown> {
  const metadata = {
    success: true,
    diagnostics: result.diagnostics,
    warnings: result.warnings,
    supportTier: result.supportTier,
    suggestedNextActions: result.suggestedNextActions ?? [],
    provenance: result.provenance ?? [],
    knownLimitations: result.knownLimitations ?? [],
  };

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      ...(value as Record<string, unknown>),
      ...metadata,
    };
  }

  return {
    ...(options.dataKey ? { [options.dataKey]: value } : { data: value }),
    ...metadata,
  };
}

function renderDiagnostics(result: OperationResult<unknown>, format: CliOutputFormat, success: boolean): string {
  if (format === 'json' || format === 'yaml' || format === 'ndjson') {
    return renderOutput(
      {
        success,
        diagnostics: result.diagnostics,
        warnings: result.warnings,
        details: result.details,
        supportTier: result.supportTier,
        suggestedNextActions: result.suggestedNextActions ?? [],
        provenance: result.provenance,
        knownLimitations: result.knownLimitations,
      },
      format
    );
  }

  const diagnostics = [...result.diagnostics, ...result.warnings];

  if (format === 'table') {
    const renderedTable = renderTable(
      diagnosticRows(diagnostics).map((row) => ({
        ...row,
        path: row.path ?? '',
        source: row.source ?? '',
        hint: row.hint ?? '',
        detail: row.detail ?? '',
      }))
    );

    return appendSuggestedNextActions(renderedTable, result.suggestedNextActions);
  }

  const renderedDiagnostics = ensureTrailingNewline(
    diagnostics
      .map((diagnostic) => {
        const details = [
          diagnostic.hint ? `hint=${diagnostic.hint}` : undefined,
          diagnostic.detail ? `detail=${diagnostic.detail}` : undefined,
          diagnostic.path ? `path=${diagnostic.path}` : undefined,
        ]
          .filter(Boolean)
          .join(' ');
        return `${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}${details ? ` (${details})` : ''}`;
      })
      .join('\n')
  );

  return appendSuggestedNextActions(renderedDiagnostics, result.suggestedNextActions);
}

function isOutputFormat(value: string): value is CliOutputFormat {
  return SUPPORTED_OUTPUT_FORMATS.includes(value as CliOutputFormat);
}

function renderNdjson(value: unknown): string {
  const normalized = unwrapCollectionEnvelope(value);
  const records = Array.isArray(normalized) ? normalized : [normalized];
  return ensureTrailingNewline(records.map((record) => stableStringify(asJsonValue(record) as never, 0)).join('\n'));
}

function renderTable(value: unknown): string {
  const rows = normalizeTableRows(unwrapCollectionEnvelope(value));

  if (rows.headers.length === 0) {
    return 'No rows.\n';
  }

  const widths = rows.headers.map((header, index) =>
    Math.max(header.length, ...rows.records.map((record) => (record[index] ?? '').length))
  );

  const renderRow = (record: string[]) =>
    record
      .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
      .join('  ')
      .trimEnd();

  const divider = widths.map((width) => '-'.repeat(width)).join('  ');

  return ensureTrailingNewline([renderRow(rows.headers), divider, ...rows.records.map(renderRow)].join('\n'));
}

function renderMarkdown(value: unknown): string {
  const rows = normalizeTableRows(unwrapCollectionEnvelope(value));

  if (rows.headers.length === 0) {
    return 'No rows.\n';
  }

  const escapeCell = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const headerRow = `| ${rows.headers.map(escapeCell).join(' | ')} |`;
  const dividerRow = `| ${rows.headers.map(() => '---').join(' | ')} |`;
  const recordRows = rows.records.map((record) => `| ${record.map(escapeCell).join(' | ')} |`);

  return ensureTrailingNewline([headerRow, dividerRow, ...recordRows].join('\n'));
}

function normalizeTableRows(value: unknown): { headers: string[]; records: string[][] } {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        headers: ['value'],
        records: [],
      };
    }

    if (value.every((item) => isPlainObject(item))) {
      const headers = collectHeaders(value as Array<Record<string, unknown>>);
      return {
        headers,
        records: (value as Array<Record<string, unknown>>).map((record) => headers.map((header) => stringifyCell(record[header]))),
      };
    }

    return {
      headers: ['value'],
      records: value.map((item) => [stringifyCell(item)]),
    };
  }

  if (isPlainObject(value)) {
    return {
      headers: ['field', 'value'],
      records: flattenTableObject(value),
    };
  }

  return {
    headers: ['value'],
    records: [[stringifyCell(value)]],
  };
}

function unwrapCollectionEnvelope(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return value;
  }

  const metadataKeys = new Set([
    'success',
    'diagnostics',
    'warnings',
    'supportTier',
    'suggestedNextActions',
    'provenance',
    'knownLimitations',
  ]);

  const dataEntries = Object.entries(value).filter(([key]) => !metadataKeys.has(key));
  if (dataEntries.length !== 1) {
    return value;
  }

  const [, collection] = dataEntries[0] ?? [];
  return Array.isArray(collection) ? collection : value;
}

function collectHeaders(records: Array<Record<string, unknown>>): string[] {
  const headers: string[] = [];

  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!headers.includes(key)) {
        headers.push(key);
      }
    }
  }

  return headers;
}

function flattenTableObject(value: Record<string, unknown>, prefix?: string): string[][] {
  const records: string[][] = [];

  for (const [field, cellValue] of Object.entries(value)) {
    if (cellValue === undefined) {
      continue;
    }

    const key = prefix ? `${prefix}.${field}` : field;

    if (isPlainObject(cellValue)) {
      const nested = flattenTableObject(cellValue, key);

      if (nested.length > 0) {
        records.push(...nested);
      }

      continue;
    }

    records.push([key, stringifyCell(cellValue)]);
  }

  return records;
}

function stringifyCell(value: unknown): string {
  if (value === undefined) {
    return '';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return stableStringify(asJsonValue(value) as never, 0);
}

function diagnosticRows(diagnostics: Diagnostic[]): Array<Record<string, string | undefined>> {
  return diagnostics.map((diagnostic) => ({
    level: diagnostic.level,
    code: diagnostic.code,
    message: diagnostic.message,
    source: diagnostic.source,
    path: diagnostic.path,
    hint: diagnostic.hint,
    detail: diagnostic.detail,
  }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function appendSuggestedNextActions(value: string, suggestedNextActions: string[] | undefined): string {
  if (!suggestedNextActions || suggestedNextActions.length === 0) {
    return value;
  }

  const renderedActions = [
    'Next actions:',
    ...suggestedNextActions.map((action) => `- ${action}`),
  ].join('\n');

  return `${value.replace(/\n$/, '')}\n\n${renderedActions}\n`;
}

function asJsonValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    Array.isArray(value) ||
    isPlainObject(value)
  ) {
    return value;
  }

  return String(value);
}
