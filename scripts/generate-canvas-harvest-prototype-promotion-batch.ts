import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '../packages/artifacts/src/index';
import {
  buildCanvasHarvestFixturePrototypePromotionBatchDocument,
  mergeCanvasHarvestFixturePrototypePromotionBatchDocument,
  resolveCanvasHarvestFixturePrototypeDraftPromotion,
  type CanvasHarvestFixturePrototypePromotionBatchDocument,
  type CanvasHarvestFixturePrototypeDraftDocument,
} from '../packages/canvas/src/harvest-fixture';

const DEFAULT_CANVAS_HARVEST_PROTOTYPE_DRAFT_PATH = 'fixtures/canvas-harvest/generated/prototype-drafts.json';
const DEFAULT_CANVAS_HARVEST_PROTOTYPE_PROMOTION_BATCH_PATH =
  'fixtures/canvas-harvest/generated/prototype-promotion-batch.json';

async function main(): Promise<void> {
  const draftPath = resolve(readArg('--drafts') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_DRAFT_PATH);
  const outPath = resolve(readArg('--out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_PROMOTION_BATCH_PATH);
  const generatedAt = new Date().toISOString();
  const family = readFamilyArg('--family');
  const startAt = readArg('--start-at');
  const limit = readPositiveIntegerArg('--limit');
  const defaultNotes = readArgs('--note');
  const names = readArgs('--name');
  const mergeExistingPath = readArg('--merge-existing');

  if (names.length > 0 && (startAt || limit)) {
    throw new Error('Cannot combine explicit --name selectors with --start-at or --limit.');
  }

  const [drafts, existingBatch] = await Promise.all([
    readJsonFile<CanvasHarvestFixturePrototypeDraftDocument>(draftPath),
    mergeExistingPath
      ? readJsonFile<CanvasHarvestFixturePrototypePromotionBatchDocument>(resolve(mergeExistingPath))
      : Promise.resolve(undefined),
  ]);
  const promotions =
    names.length > 0
      ? names.map((selector) => resolveCanvasHarvestFixturePrototypeDraftPromotion(drafts, selector, family))
      : undefined;
  const builtBatch = buildCanvasHarvestFixturePrototypePromotionBatchDocument({
    drafts,
    ...(names.length > 0 ? { promotions } : {}),
    ...(names.length === 0 && family ? { family } : {}),
    ...(names.length === 0 && startAt ? { startAt } : {}),
    ...(names.length === 0 && limit ? { limit } : {}),
    ...(defaultNotes.length > 0 ? { notes: defaultNotes } : {}),
    paths: {
      drafts: draftPath,
    },
    generatedAt,
  });
  const merged = existingBatch
    ? mergeCanvasHarvestFixturePrototypePromotionBatchDocument(builtBatch, existingBatch)
    : undefined;
  const batch = merged?.batch ?? builtBatch;

  await mkdir(dirname(outPath), { recursive: true });
  await writeJsonFile(outPath, batch as unknown as Parameters<typeof writeJsonFile>[1]);

  process.stdout.write(`Wrote prototype promotion batch: ${outPath}\n`);
  process.stdout.write(`Source drafts: ${draftPath}\n`);
  if (mergeExistingPath) {
    process.stdout.write(`Merged existing batch: ${resolve(mergeExistingPath)}\n`);
    process.stdout.write(
      `Preserved edits: entries ${merged?.preservedEntries ?? 0}; notes ${merged?.preservedNotesEntries ?? 0}\n`
    );
  }
  if (batch.selection) {
    process.stdout.write(
      `Selection: mode ${batch.selection.mode}; matching ${batch.selection.matchingDrafts}; selected ${batch.selection.selectedDrafts}; skipped ${batch.selection.skippedDrafts}\n`
    );
    if (batch.selection.firstSelectedControl || batch.selection.lastSelectedControl) {
      process.stdout.write(
        `Selected range: ${batch.selection.firstSelectedControl ?? 'n/a'} -> ${batch.selection.lastSelectedControl ?? 'n/a'}\n`
      );
    }
  }
  process.stdout.write(`Selected order: ${formatSelectedControls(batch.entries)}\n`);
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

function formatSelectedControls(
  entries: Array<{
    family: 'classic' | 'modern';
    catalogName: string;
  }>
): string {
  if (entries.length === 0) {
    return 'none';
  }

  return entries.map((entry) => `${entry.family}/${entry.catalogName}`).join(', ');
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
