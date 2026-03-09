import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient } from '@pp/dataverse';
import { FlowService, loadFlowArtifact, normalizeFlowArtifact, patchFlowArtifact, unpackFlowArtifact, validateFlowArtifact } from './index';
import { expectGoldenJson, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-flow-golden-'));
  tempDirs.push(path);
  return path;
}

function normalizeFlowSnapshot<T>(value: T, tempDir: string): T {
  return mapSnapshotStrings(value, (entry) =>
    entry
      .replaceAll(repoRoot, '<REPO_ROOT>')
      .replaceAll(tempDir, '<TMP_DIR>')
      .replaceAll('\\', '/')
  );
}

interface FlowRuntimeFixture {
  query?: Record<string, unknown[]>;
  queryAll?: Record<string, unknown[]>;
}

function createFixtureDataverseClient(fixture: FlowRuntimeFixture): DataverseClient {
  return {
    query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
      ok(((fixture.query?.[options.table] ?? []) as T[]), {
        supportTier: 'preview',
      }),
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
      ok(((fixture.queryAll?.[options.table] ?? []) as T[]), {
        supportTier: 'preview',
      }),
  } as unknown as DataverseClient;
}

describe('flow fixture-backed goldens', () => {
  it('captures unpacked and validated flow artifacts as stable goldens', async () => {
    const tempDir = await createTempDir();
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const outPath = join(tempDir, 'unpacked');

    const unpacked = await unpackFlowArtifact(rawPath, outPath);
    const validation = await validateFlowArtifact(outPath);

    expect(unpacked.success).toBe(true);
    expect(validation.success).toBe(true);

    await expectGoldenJson(await readJsonFile(join(outPath, 'flow.json')), 'fixtures/flow/golden/unpacked.flow.json', {
      normalize: (value) => normalizeFlowSnapshot(value, tempDir),
    });
    await expectGoldenJson(unpacked.data, 'fixtures/flow/golden/unpack-result.json', {
      normalize: (value) => normalizeFlowSnapshot(value, tempDir),
    });
    await expectGoldenJson(validation.data, 'fixtures/flow/golden/validation-report.json', {
      normalize: (value) => normalizeFlowSnapshot(value, tempDir),
    });
  });

  it('round-trips patched flow artifacts without semantic drift', async () => {
    const tempDir = await createTempDir();
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const unpackedPath = join(tempDir, 'unpacked');
    const patchedPath = join(tempDir, 'patched');
    const patchDocument = await readJsonFile(resolveRepoPath('fixtures', 'flow', 'patches', 'invoice-flow.patch.json'));

    await unpackFlowArtifact(rawPath, unpackedPath);
    const patched = await patchFlowArtifact(unpackedPath, patchDocument, patchedPath);
    const normalized = await normalizeFlowArtifact(patchedPath, join(tempDir, 'normalized'));
    const reloaded = await loadFlowArtifact(patchedPath);
    const patchedDocument = JSON.parse(await readFile(join(patchedPath, 'flow.json'), 'utf8')) as unknown;

    expect(patched.success).toBe(true);
    expect(normalized.success).toBe(true);
    expect(reloaded.success).toBe(true);

    expect(reloaded.data).toEqual(patchedDocument);

    await expectGoldenJson(patched.data, 'fixtures/flow/golden/patched-result.json', {
      normalize: (value) => normalizeFlowSnapshot(value, tempDir),
    });
    await expectGoldenJson(patchedDocument, 'fixtures/flow/golden/patched.flow.json', {
      normalize: (value) => normalizeFlowSnapshot(value, tempDir),
    });
    await expectGoldenJson(normalized.data, 'fixtures/flow/golden/normalized-after-patch.json', {
      normalize: (value) => normalizeFlowSnapshot(value, tempDir),
    });
  });

  it('captures remote runtime diagnostics and doctor outputs from committed fixtures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));

    const runtimeFixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'flow', 'runtime', 'invoice-sync-runtime.json')
    )) as FlowRuntimeFixture;
    const service = new FlowService(createFixtureDataverseClient(runtimeFixture));

    const inspect = await service.inspect('Invoice Sync', {
      solutionUniqueName: 'Core',
    });
    const runs = await service.runs('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
    });
    const errors = await service.errors('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
      groupBy: 'connectionReference',
    });
    const connrefs = await service.connrefs('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
    });
    const doctor = await service.doctor('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
    });

    expect(inspect.success).toBe(true);
    expect(runs.success).toBe(true);
    expect(errors.success).toBe(true);
    expect(connrefs.success).toBe(true);
    expect(doctor.success).toBe(true);

    await expectGoldenJson(inspect.data, 'fixtures/flow/golden/runtime/inspect-report.json');
    await expectGoldenJson(runs.data, 'fixtures/flow/golden/runtime/runs.json');
    await expectGoldenJson(errors.data, 'fixtures/flow/golden/runtime/error-groups.json');
    await expectGoldenJson(connrefs.data, 'fixtures/flow/golden/runtime/connection-health.json');
    await expectGoldenJson(doctor.data, 'fixtures/flow/golden/runtime/doctor-report.json');
  });
});
