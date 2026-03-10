import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProjectConfig } from './index';

describe('loadProjectConfig', () => {
  it('auto-selects the only descendant project config when root discovery has a single local anchor', async () => {
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
    expect(result.data?.path).toBe(join(fixtureProjectRoot, 'pp.config.yaml'));
    expect(result.warnings).toEqual([]);
    expect(result.suggestedNextActions).toBeUndefined();
  });
});
