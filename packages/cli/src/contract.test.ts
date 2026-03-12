import { describe, expect, it } from 'vitest';
import { createDiagnostic, fail } from '@pp/diagnostics';
import { expectGoldenJson, expectGoldenText } from '../../../test/golden';
import {
  createMutationPreview,
  readMutationFlags,
  readOutputFormat,
  resolveOutputFormat,
  renderFailure,
  renderOutput,
  renderResultDiagnostics,
  renderWarnings,
} from './contract';

describe('cli contract', () => {
  it('captures fixture-backed structured output rendering', async () => {
    expect(readOutputFormat(['--format', 'yaml'], 'json').data).toBe('yaml');
    expect(resolveOutputFormat(['--format', 'yaml'], 'json')).toBe('yaml');
    expect(resolveOutputFormat(['--format', 'csv'], 'json')).toBe('json');

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
    expect(renderOutput([{ alias: 'dev', url: 'https://example.test' }], 'markdown')).toBe(
      ['| alias | url |', '| --- | --- |', '| dev | https://example.test |', ''].join('\n')
    );
    expect(renderOutput([{ alias: 'dev', url: 'https://example.test' }], 'raw')).toBe(
      ['alias  url', '-----  --------------------', 'dev    https://example.test', ''].join('\n')
    );
  });

  it('unwraps collection success envelopes for ndjson and table rendering', () => {
    const payload = {
      success: true,
      solutions: [
        { uniquename: 'Core', version: '1.0.0.0' },
        { uniquename: 'Harness', version: '1.0.0.1' },
      ],
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
      suggestedNextActions: [],
      provenance: [],
      knownLimitations: [],
    };

    expect(renderOutput(payload, 'ndjson')).toBe(
      ['{"uniquename":"Core","version":"1.0.0.0"}', '{"uniquename":"Harness","version":"1.0.0.1"}', ''].join('\n')
    );
    expect(renderOutput(payload, 'table')).toBe(
      ['uniquename  version', '----------  -------', 'Core        1.0.0.0', 'Harness     1.0.0.1', ''].join('\n')
    );
  });

  it('flattens nested singleton objects in table output', () => {
    expect(
      renderOutput(
        {
          name: 'fixture',
          auth: {
            profile: 'test-user',
            target: 'https://fixture.crm.dynamics.com',
          },
          tooling: {
            pacInstalled: false,
          },
          relationships: {
            currentProject: undefined,
          },
        },
        'table'
      )
    ).toBe(
      [
        'field                 value',
        '--------------------  --------------------------------',
        'name                  fixture',
        'auth.profile          test-user',
        'auth.target           https://fixture.crm.dynamics.com',
        'tooling.pacInstalled  false',
        '',
      ].join('\n')
    );
  });

  it('omits undefined nested fields from table output instead of rendering blank orphan rows', () => {
    expect(
      renderOutput(
        {
          relationships: {
            currentProject: undefined,
            authBinding: {
              alias: 'test',
            },
          },
        },
        'table'
      )
    ).toBe(
      [
        'field                            value',
        '-------------------------------  -----',
        'relationships.authBinding.alias  test',
        '',
      ].join('\n')
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

  it('captures success-side diagnostic rendering across protocol formats', async () => {
    const success = {
      success: true,
      data: { command: 'project.inspect' },
      diagnostics: [
        createDiagnostic('error', 'TEST_SUCCESS_DIAGNOSTIC', 'Success payload still carries diagnostics', {
          source: '@pp/test',
          path: 'fixtures/analysis/project/pp.config.yaml',
          hint: 'Diagnostics should stay on stderr without changing stdout.',
        }),
      ],
      warnings: [
        createDiagnostic('warning', 'TEST_SUCCESS_WARNING', 'Success payload still carries warnings', {
          source: '@pp/test',
          hint: 'Warnings should render beside diagnostics.',
        }),
      ],
      supportTier: 'preview' as const,
      suggestedNextActions: ['Review the diagnostics channel', 'Keep stdout machine-parseable'],
      provenance: [
        {
          kind: 'inferred' as const,
          source: 'success-diagnostics-fixture',
          detail: 'direct contract coverage for success-side stderr rendering',
        },
      ],
      knownLimitations: ['This fixture only exercises the renderer contract.'],
    };

    expect(renderResultDiagnostics({ ...success, diagnostics: [], warnings: [] }, 'json')).toBe('');
    await expectGoldenText(renderResultDiagnostics(success, 'json'), 'fixtures/cli/golden/contract/success-diagnostics.json');
    await expectGoldenText(renderResultDiagnostics(success, 'table'), 'fixtures/cli/golden/contract/success-diagnostics.table.txt');
    await expectGoldenText(renderResultDiagnostics(success, 'raw'), 'fixtures/cli/golden/contract/success-diagnostics.raw.txt');
  });

  it('parses consistent mutation flags and snapshots mutation previews', async () => {
    const dryRunFlags = readMutationFlags(['--dry-run', '--yes']);
    const planFlags = readMutationFlags(['--plan']);

    expect(dryRunFlags.success).toBe(true);
    expect(dryRunFlags.data).toEqual({
      mode: 'dry-run',
      dryRun: true,
      plan: false,
      yes: true,
    });
    expect(planFlags.success).toBe(true);
    expect(planFlags.data).toEqual({
      mode: 'plan',
      dryRun: false,
      plan: true,
      yes: false,
    });

    const dryRunPreview = createMutationPreview(
      'dv.create',
      dryRunFlags.data ?? { mode: 'apply', dryRun: false, plan: false, yes: false },
      { table: 'accounts', environment: 'test' },
      {
        schemaName: 'pp_accounts',
        displayName: 'PP Accounts',
      }
    );
    const planPreview = createMutationPreview(
      'dv.create',
      planFlags.data ?? { mode: 'apply', dryRun: false, plan: false, yes: false },
      { table: 'accounts', environment: 'test' },
      {
        schemaName: 'pp_accounts',
        displayName: 'PP Accounts',
      }
    );

    expect(dryRunPreview).toMatchObject({
      action: 'dv.create',
      mode: 'dry-run',
      willMutate: false,
      supportTier: 'preview',
      suggestedNextActions: [],
      provenance: [],
      knownLimitations: [],
    });
    expect(planPreview).toMatchObject({
      action: 'dv.create',
      mode: 'plan',
      willMutate: false,
      supportTier: 'preview',
      suggestedNextActions: [],
      provenance: [],
      knownLimitations: [],
    });
    await expectGoldenJson(dryRunPreview, 'fixtures/cli/golden/contract/mutation-preview.json');
    await expectGoldenJson(planPreview, 'fixtures/cli/golden/contract/mutation-plan-preview.json');
  });
});
