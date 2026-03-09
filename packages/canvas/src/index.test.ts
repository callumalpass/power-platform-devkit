import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  importCanvasTemplateRegistry,
  loadCanvasTemplateRegistryBundle,
  resolveCanvasSupport,
  resolveCanvasTemplate,
  resolveCanvasTemplateRegistryPaths,
  resolveCanvasTemplateRequirements,
  type CanvasRegistryBundle,
} from './index';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-canvas-'));
  tempDirs.push(path);
  return path;
}

describe('canvas template registries', () => {
  it('loads registries, merges templates, and resolves support by alias', async () => {
    const dir = await createTempDir();
    const firstRegistryPath = join(dir, 'seed.json');
    const secondRegistryPath = join(dir, 'catalog.json');

    await writeFile(
      firstRegistryPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          templates: [
            {
              templateName: 'Button',
              templateVersion: '1.0.0',
              aliases: {
                displayNames: ['Primary Button'],
                constructors: ['Button'],
                yamlNames: ['button'],
              },
              files: {
                'Controls/Button.json': {
                  kind: 'button',
                },
              },
              provenance: {
                kind: 'official-artifact',
                source: 'seed-app',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Button',
              version: '1.*',
              status: 'supported',
              modes: ['strict', 'seeded', 'registry'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      secondRegistryPath,
      JSON.stringify(
        {
          templates: {
            Label: {
              version: '2.0.0',
              aliases: {
                yamlName: 'label',
              },
              files: {
                'Controls/Label.json': {
                  kind: 'label',
                },
              },
              provenance: {
                source: 'curated-catalog',
              },
            },
          },
          support: [
            {
              name: 'Label',
              version: '2.*',
              status: 'partial',
              modes: ['registry'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const bundle = await loadCanvasTemplateRegistryBundle({
      root: dir,
      registries: ['./seed.json', './catalog.json'],
    });

    expect(bundle.success).toBe(true);
    expect(bundle.data?.sources).toHaveLength(2);
    expect(bundle.data?.templates).toHaveLength(2);

    const match = resolveCanvasTemplate(bundle.data!, {
      name: 'Primary Button',
    });

    expect(match.template).toMatchObject({
      templateName: 'Button',
      templateVersion: '1.0.0',
    });
    expect(match.matchedBy).toBe('displayName');
    expect(match.support.status).toBe('supported');

    const labelSupport = resolveCanvasSupport(bundle.data!.supportMatrix, 'Label', '2.0.0');
    expect(labelSupport.status).toBe('partial');
    expect(labelSupport.modes).toEqual(['registry']);
  });

  it('imports non-canonical template catalogs and writes a normalized registry file', async () => {
    const dir = await createTempDir();
    const sourcePath = join(dir, 'import.json');
    const outPath = join(dir, 'normalized.json');

    await writeFile(
      sourcePath,
      JSON.stringify(
        {
          templates: {
            Slider: {
              version: '3.1.0',
              aliases: {
                yamlName: 'slider',
              },
              files: {
                'Controls/Slider.json': {
                  kind: 'slider',
                  minimum: 0,
                },
              },
            },
          },
          supportMatrix: [
            {
              templateName: 'Slider',
              version: '3.*',
              supported: true,
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const imported = await importCanvasTemplateRegistry({
      sourcePath,
      outPath,
      provenance: {
        source: 'demo-fixture',
        acquiredAt: '2026-03-09T00:00:00.000Z',
      },
    });

    expect(imported.success).toBe(true);
    expect(imported.data?.templates[0]).toMatchObject({
      templateName: 'Slider',
      templateVersion: '3.1.0',
      provenance: {
        source: 'demo-fixture',
        importedFrom: sourcePath,
      },
    });
    expect(imported.data?.templates[0]?.contentHash).toMatch(/[a-f0-9]{64}/);

    const written = JSON.parse(await readFile(outPath, 'utf8')) as {
      templates: Array<{ contentHash: string }>;
    };
    expect(written.templates[0]?.contentHash).toMatch(/[a-f0-9]{64}/);
  });

  it('enforces deterministic build-mode resolution across seeded and registry bundles', () => {
    const seededBundle: CanvasRegistryBundle = {
      sources: [],
      templates: [
        {
          templateName: 'Button',
          templateVersion: '1.0.0',
          contentHash: 'seed',
          provenance: {
            kind: 'official-artifact',
            source: 'seed-app',
          },
        },
      ],
      supportMatrix: [
        {
          templateName: 'Button',
          version: '1.*',
          status: 'supported',
          modes: ['strict', 'seeded'],
        },
      ],
      hash: 'seed-bundle',
    };
    const registryBundle: CanvasRegistryBundle = {
      sources: [],
      templates: [
        {
          templateName: 'Label',
          templateVersion: '2.0.0',
          contentHash: 'registry',
          provenance: {
            kind: 'official-artifact',
            source: 'catalog',
          },
        },
      ],
      supportMatrix: [
        {
          templateName: 'Label',
          version: '2.*',
          status: 'supported',
          modes: ['strict', 'registry'],
        },
      ],
      hash: 'registry-bundle',
    };

    const seededResolution = resolveCanvasTemplateRequirements(
      [
        {
          name: 'Button',
          version: '1.0.0',
        },
      ],
      {
        mode: 'seeded',
        seeded: seededBundle,
        registry: registryBundle,
      }
    );
    const strictResolution = resolveCanvasTemplateRequirements(
      [
        {
          name: 'Label',
          version: '2.0.0',
        },
      ],
      {
        mode: 'strict',
        seeded: seededBundle,
        registry: registryBundle,
      }
    );

    expect(seededResolution.supported).toBe(true);
    expect(seededResolution.missing).toHaveLength(0);
    expect(strictResolution.supported).toBe(true);
    expect(strictResolution.resolutions[0]?.template?.templateName).toBe('Label');
  });

  it('resolves project-relative and cache-backed registry paths deterministically', () => {
    const resolved = resolveCanvasTemplateRegistryPaths({
      root: '/repo',
      cacheDir: '/cache/canvas',
      registries: ['./registries/base.json', 'cache:seeded-controls'],
    });

    expect(resolved.success).toBe(true);
    expect(resolved.data).toEqual([
      '/repo/registries/base.json',
      '/cache/canvas/seeded-controls.json',
    ]);
  });
});
