import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProjectConfig, loadProjectDefaults } from './index';

describe('loadProjectConfig', () => {
  it('loads a minimal pp.config.yaml with defaults and artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-config-'));
    await writeFile(
      join(root, 'pp.config.yaml'),
      ['defaults:', '  environment: dev', '  solution: Core', 'artifacts:', '  solutions: .pp/solutions'].join('\n'),
      'utf8'
    );

    const result = await loadProjectConfig(root);

    expect(result.success).toBe(true);
    expect(result.data?.config).toEqual({
      defaults: { environment: 'dev', solution: 'Core' },
      artifacts: { solutions: '.pp/solutions' },
    });
  });

  it('returns undefined when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-config-empty-'));
    const result = await loadProjectConfig(root);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it('walks up the directory tree to find the nearest config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-config-walk-'));
    const nested = join(root, 'apps', 'canvas');
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, 'pp.config.yaml'), 'defaults:\n  environment: prod\n', 'utf8');

    const result = await loadProjectConfig(nested);

    expect(result.success).toBe(true);
    expect(result.data?.path).toBe(join(root, 'pp.config.yaml'));
    expect(result.data?.config.defaults?.environment).toBe('prod');
  });
});

describe('loadProjectDefaults', () => {
  it('extracts environment, solution, and artifacts dir from config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-defaults-'));
    await writeFile(
      join(root, 'pp.config.yaml'),
      ['defaults:', '  environment: dev', '  solution: Core', 'artifacts:', '  solutions: .pp/solutions'].join('\n'),
      'utf8'
    );

    const result = await loadProjectDefaults(root);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      environment: 'dev',
      solution: 'Core',
      artifactsDir: '.pp/solutions',
      configPath: join(root, 'pp.config.yaml'),
    });
  });

  it('returns empty defaults when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-defaults-empty-'));
    const result = await loadProjectDefaults(root);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      environment: undefined,
      solution: undefined,
      artifactsDir: undefined,
      configPath: undefined,
    });
  });
});
