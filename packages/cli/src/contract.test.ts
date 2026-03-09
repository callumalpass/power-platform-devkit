import { describe, expect, it } from 'vitest';
import { createDiagnostic, fail } from '@pp/diagnostics';
import { expectGoldenJson, expectGoldenText } from '../../../test/golden';
import { createMutationPreview, readMutationFlags, readOutputFormat, renderFailure, renderOutput, renderWarnings } from './contract';

describe('cli contract', () => {
  it('captures fixture-backed structured output rendering', async () => {
    expect(readOutputFormat(['--format', 'yaml'], 'json').data).toBe('yaml');

    await expectGoldenText(renderOutput([{ name: 'dev' }, { name: 'prod' }], 'ndjson'), 'fixtures/cli/golden/contract/output.ndjson');
    await expectGoldenText(
      renderOutput(
        [
          { alias: 'dev', url: 'https://example.test', healthy: true },
          { alias: 'prod', url: 'https://prod.example.test', healthy: false },
        ],
        'table'
      ),
      'fixtures/cli/golden/contract/output.table.txt'
    );
  });

  it('captures failure and warning rendering across protocol formats', async () => {
    const failure = fail(
      createDiagnostic('error', 'TEST_FAILURE', 'Something went wrong', {
        source: '@pp/test',
        path: 'fixtures/cli/input.json',
        hint: 'Check the committed fixture payload.',
      }),
      {
        supportTier: 'experimental',
        warnings: [
          createDiagnostic('warning', 'TEST_WARNING', 'This is only a preview warning', {
            source: '@pp/test',
            hint: 'Warnings should stay visible in the rendered contract.',
          }),
        ],
        suggestedNextActions: ['Retry with --format json', 'Refresh the committed fixture if the contract changed intentionally'],
        provenance: [
          {
            kind: 'inferred',
            source: 'contract-test-fixture',
            detail: 'fixture-backed golden coverage',
          },
        ],
        knownLimitations: ['Fixture-backed protocol checks do not replace live environment validation.'],
      }
    );

    await expectGoldenText(renderFailure(failure, 'json'), 'fixtures/cli/golden/contract/failure.json');
    await expectGoldenText(renderFailure(failure, 'yaml'), 'fixtures/cli/golden/contract/failure.yaml');
    await expectGoldenText(renderFailure(failure, 'ndjson'), 'fixtures/cli/golden/contract/failure.ndjson');
    await expectGoldenText(renderFailure(failure, 'table'), 'fixtures/cli/golden/contract/failure.table.txt');
    await expectGoldenText(renderFailure(failure, 'raw'), 'fixtures/cli/golden/contract/failure.raw.txt');
    await expectGoldenText(renderWarnings(failure.warnings), 'fixtures/cli/golden/contract/warnings.txt');
  });

  it('parses consistent mutation flags and snapshots mutation previews', async () => {
    const flags = readMutationFlags(['--dry-run', '--yes']);

    expect(flags.success).toBe(true);
    expect(flags.data).toEqual({
      mode: 'dry-run',
      dryRun: true,
      plan: false,
      yes: true,
    });

    const preview = createMutationPreview(
      'dv.create',
      flags.data ?? { mode: 'apply', dryRun: false, plan: false, yes: false },
      { table: 'accounts', environment: 'test' },
      {
        schemaName: 'pp_accounts',
        displayName: 'PP Accounts',
      }
    );

    expect(preview).toMatchObject({
      action: 'dv.create',
      mode: 'dry-run',
      willMutate: false,
    });
    await expectGoldenJson(preview, 'fixtures/cli/golden/contract/mutation-preview.json');
  });
});
