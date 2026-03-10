import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProjectConfig } from './index';

describe('loadProjectConfig', () => {
  it('surfaces descendant project configs when root discovery falls back to defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-config-descendant-'));
    const fixtureProjectRoot = join(root, 'fixtures', 'analysis', 'project');
    await mkdir(fixtureProjectRoot, { recursive: true });
    await writeFile(
      join(fixtureProjectRoot, 'pp.config.yaml'),
      [
        'defaults:',
        '  environment: prod',
        '  solution: core',
        'topology:',
        '  defaultStage: prod',
        '  stages:',
        '    prod:',
        '      environment: prod',
        '      solution: core',
        'solutions:',
        '  core:',
        '    uniqueName: CoreManaged',
      ].join('\n'),
      'utf8'
    );

    const result = await loadProjectConfig(root);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PROJECT_CONFIG_NOT_FOUND',
          hint: expect.stringContaining('fixtures/analysis/project/pp.config.yaml'),
          detail: expect.stringContaining('fixtures/analysis/project/pp.config.yaml'),
          path: join(fixtureProjectRoot, 'pp.config.yaml'),
        }),
      ])
    );
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining(['Inspect descendant project config at fixtures/analysis/project/pp.config.yaml.'])
    );
  });
});
