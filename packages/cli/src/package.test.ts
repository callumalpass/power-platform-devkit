import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('@pp/cli package metadata', () => {
  it('declares every directly imported workspace package dependency', async () => {
    const source = await readFile(resolve(packageRoot, 'src/index.ts'), 'utf8');
    const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    const importedWorkspacePackages = [...source.matchAll(/from '(@pp\/[a-z-]+)'/g)]
      .map((match) => match[1])
      .filter((value, index, values): value is string => value !== undefined && values.indexOf(value) === index)
      .sort();

    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(
      expect.arrayContaining(importedWorkspacePackages)
    );
  });
});
