import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs, resolveHarvestLoopRunState } from '../../../scripts/canvas-harvest';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    })
  );
});

async function createLoopManifestFixture(): Promise<{
  rootDir: string;
  manifestPath: string;
  catalogPath: string;
  registryOutPath: string;
  nextResumeReportPath: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'pp-canvas-harvest-loop-test-'));
  tempRoots.push(rootDir);

  const chunkOneDir = join(rootDir, 'chunks', 'chunk-001');
  const chunkTwoDir = join(rootDir, 'chunks', 'chunk-002');
  const registryOutPath = join(rootDir, 'registries', 'canvas-controls.json');
  const catalogPath = join(rootDir, 'canvas-control-catalog.json');
  const nextResumeReportPath = join(chunkTwoDir, 'canvas-control-insert-report.json');
  const manifestPath = join(rootDir, 'canvas-harvest-loop.json');

  await mkdir(chunkOneDir, { recursive: true });
  await mkdir(chunkTwoDir, { recursive: true });
  await mkdir(join(rootDir, 'registries'), { recursive: true });
  await writeFile(catalogPath, '{}\n', 'utf8');
  await writeFile(nextResumeReportPath, '{}\n', 'utf8');
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: '2026-03-10T03:00:00.000Z',
        envAlias: 'dev',
        solutionUniqueName: 'TESTDEV',
        rootOutDir: rootDir,
        registryOutPath,
        status: 'partial',
        completionReason: 'max-chunks',
        catalogPath,
        latestInsertReportPath: nextResumeReportPath,
        nextResumeReportPath,
        remainingControls: 12,
        error: 'previous bounded stop',
        chunks: [
          {
            index: 1,
            label: 'chunk-001',
            status: 'completed',
            outDir: chunkOneDir,
            startedAt: '2026-03-10T03:00:00.000Z',
            completedAt: '2026-03-10T03:05:00.000Z',
          },
          {
            index: 2,
            label: 'chunk-002',
            status: 'completed',
            outDir: chunkTwoDir,
            startedAt: '2026-03-10T03:05:00.000Z',
            completedAt: '2026-03-10T03:10:00.000Z',
          },
        ],
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    rootDir,
    manifestPath,
    catalogPath,
    registryOutPath,
    nextResumeReportPath,
  };
}

describe('canvas harvest loop resume', () => {
  it('requires --catalog-loop when resuming from an existing loop manifest', () => {
    expect(() => parseArgs(['--all-controls', '--catalog-resume-loop', '/tmp/canvas-harvest-loop.json'])).toThrowError(
      '--catalog-resume-loop requires --catalog-loop.'
    );
  });

  it('resumes from an existing loop manifest in place', async () => {
    const fixture = await createLoopManifestFixture();
    const options = parseArgs([
      '--all-controls',
      '--catalog-loop',
      '--catalog-resume-loop',
      fixture.manifestPath,
      '--catalog-max-chunks',
      '3',
    ]);

    const state = await resolveHarvestLoopRunState(options);

    expect(state.loopManifestPath).toBe(fixture.manifestPath);
    expect(state.rootOutDir).toBe(fixture.rootDir);
    expect(state.rootRegistryOutPath).toBe(fixture.registryOutPath);
    expect(state.catalogPath).toBe(fixture.catalogPath);
    expect(state.resumeReportPath).toBe(fixture.nextResumeReportPath);
    expect(state.nextChunkIndex).toBe(3);
    expect(state.options.envAlias).toBe('dev');
    expect(state.options.solutionUniqueName).toBe('TESTDEV');
    expect(state.options.outDir).toBe(fixture.rootDir);
    expect(state.options.registryOut).toBe(fixture.registryOutPath);
    expect(state.options.catalogJson).toBe(fixture.catalogPath);
    expect(state.loopDocument.status).toBe('running');
    expect(state.loopDocument.completionReason).toBeUndefined();
    expect(state.loopDocument.error).toBeUndefined();
    expect(state.loopDocument.maxChunks).toBe(3);
    expect(state.loopDocument.chunks).toHaveLength(2);
  });

  it('rejects conflicting explicit loop settings when resuming from a manifest', async () => {
    const fixture = await createLoopManifestFixture();
    const options = parseArgs([
      '--all-controls',
      '--catalog-loop',
      '--catalog-resume-loop',
      fixture.manifestPath,
      '--out-dir',
      resolve(fixture.rootDir, '..', 'other-root'),
    ]);

    await expect(resolveHarvestLoopRunState(options)).rejects.toThrowError('--out-dir');
  });
});
