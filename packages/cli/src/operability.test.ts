import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLI_PACKAGE_NAME,
  CLI_VERSION,
  collectOperabilityBundle,
  collectOperabilityDoctorReport,
  renderCompletionScript,
} from './operability';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-operability-'));
  tempDirs.push(path);
  return path;
}

describe('operability helpers', () => {
  it('renders shell completion scripts for supported shells', () => {
    const bash = renderCompletionScript('bash');
    const zsh = renderCompletionScript('zsh');
    const fish = renderCompletionScript('fish');
    const pwsh = renderCompletionScript('pwsh');

    expect(bash).toContain('complete -F _pp_complete pp');
    expect(bash).toContain('diagnostics) COMPREPLY=( $(compgen -W "doctor bundle"');
    expect(zsh).toContain('#compdef pp');
    expect(zsh).toContain("compadd -- 'doctor' 'bundle'");
    expect(fish).toContain('complete -c pp -n "__fish_use_subcommand" -a "diagnostics"');
    expect(fish).toContain('complete -c pp -n "__fish_seen_subcommand_from completion" -a "bash zsh fish pwsh"');
    expect(pwsh).toContain('Register-ArgumentCompleter -Native -CommandName pp');
    expect(pwsh).toContain("'diagnostics'");
    expect(pwsh).toContain("'pwsh'");
  });

  it('collects a warning-only doctor report for a non-project directory', async () => {
    const root = await createTempDir();
    const report = await collectOperabilityDoctorReport(root, { configDir: join(root, '.config') });

    expect(report.success).toBe(true);
    expect(report.data).toMatchObject({
      status: 'warning',
      summary: {
        version: CLI_VERSION,
        inspectedPath: root,
        discoveredProject: false,
      },
    });
    expect(report.diagnostics).toHaveLength(0);
    expect(report.warnings.map((item) => item.code)).toContain('PP_PROJECT_NOT_FOUND');
    expect(report.suggestedNextActions).toContain('pp project init --plan --format markdown');
  });

  it('collects a discovered-project bundle with unresolved parameter visibility', async () => {
    const root = await createTempDir();
    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'name: operability-fixture',
        'defaults:',
        '  environment: dev',
        'providerBindings:',
        '  primaryDataverse:',
        '    kind: dataverse',
        '    target: dev',
        'parameters:',
        '  tenantDomain:',
        '    type: string',
        '    fromEnv: PP_TENANT_DOMAIN',
        '    required: true',
        '',
      ].join('\n'),
      'utf8'
    );

    const bundle = await collectOperabilityBundle(root, { configDir: join(root, '.config') });

    expect(bundle.success).toBe(true);
    expect(bundle.data).toMatchObject({
      cli: {
        name: 'pp',
        packageName: CLI_PACKAGE_NAME,
        version: CLI_VERSION,
      },
      project: {
        inspectedPath: root,
        discovered: true,
        root,
        configPath: join(root, 'pp.config.yaml'),
        unresolvedRequiredParameters: ['tenantDomain'],
        providerBindingCount: 1,
      },
    });
    expect(bundle.diagnostics.map((item) => item.code)).toContain('PROJECT_PARAMETER_MISSING');
    expect(bundle.suggestedNextActions).toContain('pp project doctor --format json');
  });
});
