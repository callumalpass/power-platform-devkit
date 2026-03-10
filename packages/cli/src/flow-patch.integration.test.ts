import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRepoPath } from '../../../test/golden';
import { main } from './index';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-cli-flow-patch-'));
  tempDirs.push(path);
  return path;
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stderr.write);
  const originalArgv = process.argv;

  process.argv = ['node', 'pp', ...args];

  try {
    const code = await main(args);
    return {
      code,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  } finally {
    process.argv = originalArgv;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

describe('flow patch cli coverage', () => {
  it('supports bounded action renames through flow patch', async () => {
    const tempDir = await createTempDir();
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const unpackedPath = join(tempDir, 'unpacked');
    const patchedPath = join(tempDir, 'patched');
    const patchPath = join(tempDir, 'rename-action.patch.json');

    await writeFile(
      patchPath,
      JSON.stringify(
        {
          actions: {
            ComposePayload: 'ComposeMessage',
          },
          values: {
            'actions.ComposePayload.inputs.priority': 'High',
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const flowUnpack = await runCli(['flow', 'unpack', rawPath, '--out', unpackedPath, '--format', 'json']);
    const flowPatch = await runCli(['flow', 'patch', unpackedPath, '--file', patchPath, '--out', patchedPath, '--format', 'json']);

    expect(flowUnpack.code).toBe(0);
    expect(flowUnpack.stderr).toBe('');
    expect(flowPatch.code).toBe(0);
    expect(flowPatch.stderr).toBe('');

    const patchResult = JSON.parse(flowPatch.stdout) as {
      appliedOperations: string[];
      changed: boolean;
    };
    expect(patchResult.changed).toBe(true);
    expect(patchResult.appliedOperations).toEqual([
      'value:actions.ComposePayload.inputs.priority',
      'action:ComposePayload->ComposeMessage',
    ]);

    const patchedDocument = JSON.parse(await readFile(join(patchedPath, 'flow.json'), 'utf8')) as {
      definition: {
        actions: Record<string, any>;
      };
    };

    expect(patchedDocument.definition.actions.ComposePayload).toBeUndefined();
    expect(patchedDocument.definition.actions.ComposeMessage.inputs).toMatchObject({
      message: "@{parameters('ApiBaseUrl')}",
      target: "@{environmentVariables('pp_ApiUrl')}",
      priority: 'High',
    });
  });
});
