import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import AdmZip from 'adm-zip';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';

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

export async function listZipEntries(packagePath: string): Promise<OperationResult<string[]>> {
  try {
    const zip = new AdmZip(packagePath);
    return ok(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .filter((entry) => entry.length > 0),
      {
        supportTier: 'preview',
      }
    );
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CANVAS_REMOTE_ZIP_COMMAND_FAILED', 'Failed to read canvas archive.', {
        source: '@pp/canvas',
        hint: error instanceof Error ? error.message : String(error),
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

export async function extractZipEntry(packagePath: string, entry: string): Promise<OperationResult<Buffer>> {
  try {
    const zip = new AdmZip(packagePath);
    const archiveEntry = zip.getEntry(entry) ?? zip.getEntry(entry.replaceAll('\\', '/'));

    if (!archiveEntry) {
      return fail(
        createDiagnostic('error', 'CANVAS_REMOTE_ZIP_COMMAND_FAILED', `Canvas archive entry ${entry} was not found.`, {
          source: '@pp/canvas',
        }),
        {
          supportTier: 'preview',
        }
      );
    }

    return ok(archiveEntry.getData(), {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CANVAS_REMOTE_ZIP_COMMAND_FAILED', 'Failed to read canvas archive entry.', {
        source: '@pp/canvas',
        hint: error instanceof Error ? error.message : String(error),
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

export async function extractZipArchive(packagePath: string, outPath: string): Promise<OperationResult<undefined>> {
  try {
    const zip = new AdmZip(packagePath);
    await mkdir(outPath, { recursive: true });
    zip.extractAllTo(outPath, true, true);
    return ok(undefined, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CANVAS_REMOTE_ZIP_COMMAND_FAILED', 'Failed to extract canvas archive.', {
        source: '@pp/canvas',
        hint: error instanceof Error ? error.message : String(error),
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

export async function createZipArchive(sourceDir: string, outPath: string): Promise<OperationResult<undefined>> {
  try {
    const zip = new AdmZip();
    await mkdir(dirname(outPath), { recursive: true });
    await addDirectoryToZip(zip, sourceDir, sourceDir);
    zip.writeZip(outPath);
    return ok(undefined, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CANVAS_REMOTE_ZIP_COMMAND_FAILED', 'Failed to create canvas archive.', {
        source: '@pp/canvas',
        hint: error instanceof Error ? error.message : String(error),
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

export async function extractCanvasMsappArchive(
  packagePath: string,
  outPath: string
): Promise<OperationResult<{ outPath: string; entries: string[] }>> {
  try {
    const zip = new AdmZip(packagePath);
    await mkdir(outPath, { recursive: true });

    const normalizedEntries = new Map<string, string>();
    const extractedEntries: string[] = [];

    for (const entry of zip.getEntries()) {
      const normalizedEntry = normalizeCanvasArchiveEntryPath(entry.entryName);

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
            `Canvas archive entries ${existingEntry} and ${entry.entryName} normalize to the same extracted path ${normalizedEntry.data}.`,
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

      normalizedEntries.set(normalizedEntry.data, entry.entryName);

      const targetPath = join(outPath, ...normalizedEntry.data.split('/'));
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, entry.getData());
      extractedEntries.push(normalizedEntry.data);
    }

    return ok(
      {
        outPath,
        entries: extractedEntries.sort((left, right) => left.localeCompare(right)),
      },
      {
        supportTier: 'preview',
      }
    );
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CANVAS_REMOTE_ZIP_COMMAND_FAILED', 'Failed to extract canvas archive.', {
        source: '@pp/canvas',
        hint: error instanceof Error ? error.message : String(error),
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

export function mergeDiagnosticLists(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
}

async function addDirectoryToZip(zip: AdmZip, rootDir: string, currentDir: string): Promise<void> {
  const entries = (await readdir(currentDir)).sort((left, right) => left.localeCompare(right));

  for (const entry of entries) {
    const sourcePath = join(currentDir, entry);
    const sourceStat = await stat(sourcePath);

    if (sourceStat.isDirectory()) {
      await addDirectoryToZip(zip, rootDir, sourcePath);
      continue;
    }

    if (!sourceStat.isFile()) {
      continue;
    }

    const archivePath = relative(rootDir, sourcePath).replaceAll('\\', '/');
    zip.addFile(archivePath, await readFile(sourcePath));
  }
}
