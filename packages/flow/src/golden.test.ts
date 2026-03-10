import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient } from '@pp/dataverse';
import {
  FlowService,
  type FlowPatchDocument,
  loadFlowArtifact,
  normalizeFlowArtifact,
  parseFlowIntermediateRepresentation,
  patchFlowArtifact,
  unpackFlowArtifact,
  validateFlowArtifact,
} from './index';
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

function normalizeFlowSnapshot<T>(value: T, ...tempPaths: string[]): T {
  return mapSnapshotStrings(value, (entry) => {
    let normalized = entry.replaceAll(repoRoot, '<REPO_ROOT>').replaceAll('\\', '/');

    for (const tempPath of tempPaths) {
      normalized = normalized.replaceAll(tempPath.replaceAll('\\', '/'), '<TMP_DIR>');
    }

    return normalized;
  });
}

function snapshotFlowResult<T>(result: {
  success: boolean;
  data?: T;
  diagnostics: unknown[];
  warnings: unknown[];
  supportTier: string;
}): {
  success: boolean;
  data?: T;
  diagnostics: unknown[];
  warnings: unknown[];
  supportTier: string;
} {
  return {
    success: result.success,
    data: result.data,
    diagnostics: result.diagnostics,
    warnings: result.warnings,
    supportTier: result.supportTier,
  };
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
  it('captures local flow artifact inspect summaries as stable goldens', async () => {
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const service = new FlowService();
    const inspect = await service.inspectArtifact(rawPath);

    expect(inspect.success).toBe(true);
    expect(inspect.data).toBeDefined();

    await expectGoldenJson(inspect.data, 'fixtures/flow/golden/inspect-summary.json', {
      normalize: (value) => normalizeFlowSnapshot(value),
    });
  });

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
    const patchDocument = (await readJsonFile(
      resolveRepoPath('fixtures', 'flow', 'patches', 'invoice-flow.patch.json')
    )) as FlowPatchDocument;

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

    const list = await service.list({
      solutionUniqueName: 'Core',
    });
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
    const errorsByCode = await service.errors('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
      groupBy: 'errorCode',
    });
    const errorsByMessage = await service.errors('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
      groupBy: 'errorMessage',
    });
    const connrefs = await service.connrefs('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
    });
    const doctor = await service.doctor('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
    });

    expect(list.success).toBe(true);
    expect(inspect.success).toBe(true);
    expect(runs.success).toBe(true);
    expect(errors.success).toBe(true);
    expect(errorsByCode.success).toBe(true);
    expect(errorsByMessage.success).toBe(true);
    expect(connrefs.success).toBe(true);
    expect(doctor.success).toBe(true);

    await expectGoldenJson(list.data, 'fixtures/flow/golden/runtime/list-report.json');
    await expectGoldenJson(inspect.data, 'fixtures/flow/golden/runtime/inspect-report.json');
    await expectGoldenJson(runs.data, 'fixtures/flow/golden/runtime/runs.json');
    await expectGoldenJson(errors.data, 'fixtures/flow/golden/runtime/error-groups.json');
    await expectGoldenJson(errorsByCode.data, 'fixtures/flow/golden/runtime/error-groups-by-code.json');
    await expectGoldenJson(errorsByMessage.data, 'fixtures/flow/golden/runtime/error-groups-by-message.json');
    await expectGoldenJson(connrefs.data, 'fixtures/flow/golden/runtime/connection-health.json');
    await expectGoldenJson(doctor.data, 'fixtures/flow/golden/runtime/doctor-report.json');
  });

  it('captures invalid flow validation diagnostics from committed fixtures', async () => {
    const artifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'diagnostic-flow');
    const validation = await validateFlowArtifact(artifactPath);

    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(false);

    await expectGoldenJson(snapshotFlowResult(validation), 'fixtures/flow/golden/semantic/validation-report.json', {
      normalize: (value) => normalizeFlowSnapshot(value),
    });
  });

  it('captures parsed flow intermediate representations as stable goldens', async () => {
    const artifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'semantic-diagnostic-flow');
    const parsed = await parseFlowIntermediateRepresentation(artifactPath);

    expect(parsed.success).toBe(true);

    await expectGoldenJson(parsed.data, 'fixtures/flow/golden/semantic/intermediate-representation.json', {
      normalize: (value) => normalizeFlowSnapshot(value),
    });
  });

  it('captures semantic flow validation diagnostics from committed fixtures', async () => {
    const artifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'semantic-diagnostic-flow');
    const validation = await validateFlowArtifact(artifactPath);

    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(false);

    await expectGoldenJson(snapshotFlowResult(validation), 'fixtures/flow/golden/semantic/lint-report.json', {
      normalize: (value) => normalizeFlowSnapshot(value),
    });
  });
});
