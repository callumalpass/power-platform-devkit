import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '@pp/artifacts';
import {
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BATCH_PATH,
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_SELECTION_PATH,
  buildCanvasHarvestFixturePrototypeValidationBatchDocument,
  mergeCanvasHarvestFixturePrototypeValidationBatchDocument,
  resolveCanvasHarvestFixturePrototypeValidationSelectionUpdate,
  type CanvasHarvestFixturePrototypeValidationBatchDocument,
  type CanvasHarvestFixtureRecordedPrototypeValidationStatus,
  type CanvasHarvestPrototypeValidationFixtureDocument,
} from '@pp/canvas';

async function main(): Promise<void> {
  const selectionPath = resolve(
    readArg('--selection') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_SELECTION_PATH
  );
  const outPath = resolve(readArg('--out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BATCH_PATH);
  const generatedAt = new Date().toISOString();
  const family = readFamilyArg('--family');
  const startAt = readArg('--start-at');
  const limit = readPositiveIntegerArg('--limit');
  const status = readStatusArg('--status');
  const method = readArg('--method');
  const defaultNotes = readArgs('--note');
  const names = readArgs('--name');
  const mergeExistingPath = readArg('--merge-existing');

  if (names.length > 0 && (startAt || limit)) {
    throw new Error('Cannot combine explicit --name selectors with --start-at or --limit.');
  }

  const [selection, existingBatch] = await Promise.all([
    readJsonFile<CanvasHarvestPrototypeValidationFixtureDocument>(selectionPath),
    mergeExistingPath
      ? readJsonFile<CanvasHarvestFixturePrototypeValidationBatchDocument>(resolve(mergeExistingPath))
      : Promise.resolve(undefined),
  ]);
  const updates =
    names.length > 0
      ? names.map((selector) => resolveCanvasHarvestFixturePrototypeValidationSelectionUpdate(selection, selector, family))
      : undefined;
  const builtBatch = buildCanvasHarvestFixturePrototypeValidationBatchDocument({
    selection,
    ...(names.length > 0 ? { updates } : {}),
    ...(names.length === 0 && family ? { family } : {}),
    ...(names.length === 0 && startAt ? { startAt } : {}),
    ...(names.length === 0 && limit ? { limit } : {}),
    ...(status ? { status } : {}),
    ...(method ? { method } : {}),
    ...(defaultNotes.length > 0 ? { notes: defaultNotes } : {}),
    paths: {
      selection: selectionPath,
    },
    generatedAt,
  });
  const merged = existingBatch
    ? mergeCanvasHarvestFixturePrototypeValidationBatchDocument(builtBatch, existingBatch)
    : undefined;
  const batch = merged?.batch ?? builtBatch;

  await mkdir(dirname(outPath), { recursive: true });
  await writeJsonFile(outPath, batch as unknown as Parameters<typeof writeJsonFile>[1]);

  process.stdout.write(`Wrote prototype validation batch: ${outPath}\n`);
  process.stdout.write(`Source selection: ${selectionPath}\n`);
  if (mergeExistingPath) {
    process.stdout.write(`Merged existing batch: ${resolve(mergeExistingPath)}\n`);
    process.stdout.write(
      `Preserved edits: entries ${merged?.preservedEntries ?? 0}; statuses ${merged?.preservedStatuses ?? 0}; recordedAt ${merged?.preservedRecordedAt ?? 0}; methods ${merged?.preservedMethods ?? 0}; notes ${merged?.preservedNotesEntries ?? 0}\n`
    );
  }
  if (batch.selection) {
    process.stdout.write(
      `Selection: mode ${batch.selection.mode}; matching ${batch.selection.matchingControls}; selected ${batch.selection.selectedControls}; skipped ${batch.selection.skippedControls}\n`
    );
    if (batch.selection.firstSelectedControl || batch.selection.lastSelectedControl) {
      process.stdout.write(
        `Selected range: ${batch.selection.firstSelectedControl ?? 'n/a'} -> ${batch.selection.lastSelectedControl ?? 'n/a'}\n`
      );
    }
  }
  process.stdout.write(
    `Entry defaults: status ${status ?? 'selection-derived'}; method ${method ?? 'none'}; note count ${defaultNotes.length}\n`
  );
  process.stdout.write(`Selected order: ${formatSelectedControls(batch)}\n`);
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readArgs(flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== flag) {
      continue;
    }

    const value = process.argv[index + 1];
    if (typeof value === 'string' && value.length > 0) {
      values.push(value);
    }
  }

  return values;
}

function readFamilyArg(flag: string): 'classic' | 'modern' | undefined {
  const value = readArg(flag);
  if (!value) {
    return undefined;
  }

  if (value === 'classic' || value === 'modern') {
    return value;
  }

  throw new Error(`Invalid ${flag} value: ${value}. Expected classic or modern.`);
}

function readPositiveIntegerArg(flag: string): number | undefined {
  const value = readArg(flag);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid ${flag} value: ${value}. Expected a positive integer.`);
  }

  return parsed;
}

function readStatusArg(flag: string): CanvasHarvestFixtureRecordedPrototypeValidationStatus | undefined {
  const value = readArg(flag);
  if (!value) {
    return undefined;
  }

  if (value === 'validated' || value === 'pending' || value === 'failed') {
    return value;
  }

  throw new Error(`Invalid ${flag} value: ${value}. Expected validated, pending, or failed.`);
}

function formatSelectedControls(batch: CanvasHarvestFixturePrototypeValidationBatchDocument): string {
  if (batch.entries.length === 0) {
    return 'none';
  }

  return batch.entries
    .map((entry) => `${entry.family}/${entry.catalogName} -> ${entry.status}`)
    .join(', ');
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
