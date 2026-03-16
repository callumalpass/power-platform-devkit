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
    expect(bash).toContain("'diagnostics')");
    expect(bash).toContain("'doctor' 'bundle'");
    expect(zsh).toContain('#compdef pp');
    expect(zsh).toContain('compadd -- "${candidates[@]}"');
    expect(fish).toContain('complete -c pp -f -a "(__pp_complete)"');
    expect(fish).toContain("case 'diagnostics'");
    expect(pwsh).toContain('Register-ArgumentCompleter -Native -CommandName pp');
    expect(pwsh).toContain("'diagnostics'");
    expect(pwsh).toContain("'pwsh'");
  });

  it('collects a warning-only doctor report for a directory without config', async () => {
    const root = await createTempDir();
    const report = await collectOperabilityDoctorReport(root, { configDir: join(root, '.config') });

    expect(report.success).toBe(true);
    expect(report.data).toMatchObject({
      status: 'warning',
      summary: {
        version: CLI_VERSION,
        inspectedPath: root,
        discoveredConfig: false,
      },
    });
    expect(report.diagnostics).toHaveLength(0);
    expect(report.warnings.map((item) => item.code)).toContain('PP_CONFIG_NOT_FOUND');
  });

  it('collects a discovered-config bundle with defaults', async () => {
    const root = await createTempDir();
    await writeFile(
      join(root, 'pp.config.yaml'),
      ['defaults:', '  environment: dev', '  solution: Core', 'artifacts:', '  solutions: .pp/solutions', ''].join('\n'),
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
      defaults: {
        inspectedPath: root,
        discovered: true,
        configPath: join(root, 'pp.config.yaml'),
        environment: 'dev',
        solution: 'Core',
        artifactsDir: '.pp/solutions',
      },
    });
  });
});
