import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';

export const CANVAS_REMOTE_ZIP_COMMAND_TIMEOUT_MS = 30_000;

function normalizeCanvasArchiveEntryPath(entry: string): OperationResult<string> {
  const normalized = entry.replaceAll('\\', '/').replace(/^\/+/, '').trim();

  if (!normalized || normalized.endsWith('/')) {
    return ok('', {
      supportTier: 'preview',
    });
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0);

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return fail(
      createDiagnostic('error', 'CANVAS_ARCHIVE_ENTRY_PATH_INVALID', `Canvas archive entry ${entry} resolves outside the target directory.`, {
        source: '@pp/canvas',
        hint: 'Use an archive with portable relative entry names.',
      }),
      {
        supportTier: 'preview',
      }
    );
  }

  return ok(segments.join('/'), {
    supportTier: 'preview',
  });
}

async function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<OperationResult<Buffer>> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGKILL');
      resolvePromise(
        fail(
          createDiagnostic(
            'error',
            'CANVAS_REMOTE_ZIP_COMMAND_TIMEOUT',
            `${command} timed out after ${CANVAS_REMOTE_ZIP_COMMAND_TIMEOUT_MS}ms.`,
            {
              source: '@pp/canvas',
              hint: `Command: ${command} ${args.join(' ')}`.trim(),
            }
          ),
          {
            supportTier: 'preview',
          }
        )
      );
    }, CANVAS_REMOTE_ZIP_COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolvePromise(
        fail(
          createDiagnostic('error', 'CANVAS_REMOTE_ZIP_TOOL_UNAVAILABLE', `Failed to execute ${command}.`, {
            source: '@pp/canvas',
            hint: error instanceof Error ? error.message : 'Install unzip and retry.',
          }),
          {
            supportTier: 'preview',
          }
        )
      );
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        resolvePromise(
          fail(
            createDiagnostic('error', 'CANVAS_REMOTE_ZIP_COMMAND_FAILED', `${command} exited with code ${code ?? 'unknown'}.`, {
              source: '@pp/canvas',
              hint: stderr.length > 0 ? Buffer.concat(stderr).toString('utf8').trim() : undefined,
            }),
            {
              supportTier: 'preview',
            }
          )
        );
        return;
      }

      resolvePromise(
        ok(Buffer.concat(stdout), {
          supportTier: 'preview',
        })
      );
    });
  });
}

export async function listZipEntries(packagePath: string): Promise<OperationResult<string[]>> {
  const result = await runCommand('unzip', ['-Z1', packagePath]);

  if (!result.success || result.data === undefined) {
    return result as unknown as OperationResult<string[]>;
  }

  return ok(
    result.data
      .toString('utf8')
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    {
      supportTier: 'preview',
      diagnostics: result.diagnostics,
      warnings: result.warnings,
    }
  );
}

export async function extractZipEntry(packagePath: string, entry: string): Promise<OperationResult<Buffer>> {
  const result = await runCommand('unzip', ['-p', packagePath, entry]);

  if (!result.success || result.data === undefined) {
    return result as unknown as OperationResult<Buffer>;
  }

  return ok(result.data, {
    supportTier: 'preview',
    diagnostics: result.diagnostics,
    warnings: result.warnings,
  });
}

export async function extractZipArchive(packagePath: string, outPath: string): Promise<OperationResult<undefined>> {
  const result = await runCommand('unzip', ['-qq', packagePath, '-d', outPath]);

  if (!result.success) {
    return result as unknown as OperationResult<undefined>;
  }

  return ok(undefined, {
    supportTier: 'preview',
    diagnostics: result.diagnostics,
    warnings: result.warnings,
  });
}

export async function createZipArchive(sourceDir: string, outPath: string): Promise<OperationResult<undefined>> {
  const result = await runCommand('zip', ['-rqX', outPath, '.'], {
    cwd: sourceDir,
  });

  if (!result.success) {
    return result as unknown as OperationResult<undefined>;
  }

  return ok(undefined, {
    supportTier: 'preview',
    diagnostics: result.diagnostics,
    warnings: result.warnings,
  });
}

export async function extractCanvasMsappArchive(
  packagePath: string,
  outPath: string
): Promise<OperationResult<{ outPath: string; entries: string[] }>> {
  const listedEntries = await listZipEntries(packagePath);

  if (!listedEntries.success || !listedEntries.data) {
    return listedEntries as unknown as OperationResult<{ outPath: string; entries: string[] }>;
  }

  const rawExtractRoot = await mkdtemp(join(tmpdir(), 'pp-canvas-extract-'));

  try {
    const extractedArchive = await extractZipArchive(packagePath, rawExtractRoot);

    if (!extractedArchive.success) {
      return extractedArchive as unknown as OperationResult<{ outPath: string; entries: string[] }>;
    }

    await mkdir(outPath, { recursive: true });

    const normalizedEntries = new Map<string, string>();
    const extractedEntries: string[] = [];

    for (const entry of listedEntries.data) {
      const normalizedEntry = normalizeCanvasArchiveEntryPath(entry);

      if (!normalizedEntry.success || normalizedEntry.data === undefined) {
        return normalizedEntry as unknown as OperationResult<{ outPath: string; entries: string[] }>;
      }

      if (!normalizedEntry.data) {
        continue;
      }

      const existingEntry = normalizedEntries.get(normalizedEntry.data);

      if (existingEntry) {
        return fail(
          createDiagnostic(
            'error',
            'CANVAS_ARCHIVE_EXTRACT_PATH_COLLISION',
            `Canvas archive entries ${existingEntry} and ${entry} normalize to the same extracted path ${normalizedEntry.data}.`,
            {
              source: '@pp/canvas',
              path: packagePath,
            }
          ),
          {
            supportTier: 'preview',
          }
        );
      }

      normalizedEntries.set(normalizedEntry.data, entry);

      const sourcePath = join(rawExtractRoot, entry.replace(/^\/+/, ''));
      const targetPath = join(outPath, ...normalizedEntry.data.split('/'));
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, await readFile(sourcePath));
      extractedEntries.push(normalizedEntry.data);
    }

    return ok(
      {
        outPath,
        entries: [...extractedEntries].sort((left, right) => left.localeCompare(right)),
      },
      {
        supportTier: 'preview',
      }
    );
  } finally {
    await rm(rawExtractRoot, { recursive: true, force: true });
  }
}

export function mergeDiagnosticLists(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
}
