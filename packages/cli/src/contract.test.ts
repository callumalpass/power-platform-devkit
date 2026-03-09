import { describe, expect, it } from 'vitest';
import { createDiagnostic, fail } from '@pp/diagnostics';
import { createMutationPreview, readMutationFlags, readOutputFormat, renderFailure, renderOutput } from './contract';

describe('cli contract', () => {
  it('supports yaml, ndjson, and table output', () => {
    expect(readOutputFormat(['--format', 'yaml'], 'json').data).toBe('yaml');
    expect(renderOutput([{ name: 'dev' }, { name: 'prod' }], 'ndjson')).toBe('{"name":"dev"}\n{"name":"prod"}\n');

    expect(renderOutput([{ alias: 'dev', url: 'https://example.test' }], 'table')).toContain('alias');
    expect(renderOutput([{ alias: 'dev', url: 'https://example.test' }], 'table')).toContain('https://example.test');
  });

  it('renders structured failures for machine-friendly formats', () => {
    const failure = fail(
      createDiagnostic('error', 'TEST_FAILURE', 'Something went wrong', {
        source: '@pp/test',
      })
    );

    expect(renderFailure(failure, 'json')).toContain('"success": false');
    expect(renderFailure(failure, 'yaml')).toContain('success: false');
    expect(renderFailure(failure, 'ndjson')).toContain('"diagnostics"');
  });

  it('parses consistent mutation flags', () => {
    const flags = readMutationFlags(['--dry-run', '--yes']);

    expect(flags.success).toBe(true);
    expect(flags.data).toEqual({
      mode: 'dry-run',
      dryRun: true,
      plan: false,
      yes: true,
    });

    expect(
      createMutationPreview('dv.create', flags.data ?? { mode: 'apply', dryRun: false, plan: false, yes: false }, { table: 'accounts' })
    ).toMatchObject({
      action: 'dv.create',
      mode: 'dry-run',
      willMutate: false,
    });
  });
});
