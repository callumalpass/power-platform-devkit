import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '../packages/artifacts/src/index';
import {
  recordCanvasHarvestFixturePrototypeValidation,
  type CanvasHarvestFixturePrototypeDocument,
  type CanvasHarvestFixtureRecordedPrototypeValidationStatus,
} from '../packages/canvas/src/harvest-fixture';

const DEFAULT_CANVAS_HARVEST_PROTOTYPE_PATH = 'fixtures/canvas-harvest/prototypes.json';

async function main(): Promise<void> {
  const family = readRequiredFamilyArg('--family');
  const catalogName = readRequiredArg('--name');
  const status = readRequiredStatusArg('--status');
  const prototypePath = resolve(readArg('--prototypes') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_PATH);
  const outPath = resolve(readArg('--out') ?? prototypePath);
  const generatedAt = new Date().toISOString();
  const recordedAt = readArg('--recorded-at') ?? generatedAt;
  const method = readArg('--method');
  const notes = readArgs('--note');
  const dryRun = process.argv.includes('--dry-run');
  const prototypes = await readJsonFile<CanvasHarvestFixturePrototypeDocument>(prototypePath);
  const recorded = recordCanvasHarvestFixturePrototypeValidation({
    prototypes,
    family,
    catalogName,
    status,
    recordedAt,
    method,
    notes,
    generatedAt,
  });

  if (!dryRun) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeJsonFile(outPath, recorded.prototypes as unknown as Parameters<typeof writeJsonFile>[1]);
  }

  process.stdout.write(
    `${dryRun ? 'Dry run:' : 'Wrote'} prototype validation ${family}/${catalogName} -> ${recorded.prototype.constructor} (${status})\n`
  );
  process.stdout.write(`Prototype input: ${prototypePath}\n`);
  process.stdout.write(`${dryRun ? 'Prototype output (not written)' : 'Prototype output'}: ${outPath}\n`);
  process.stdout.write(`Recorded at: ${recordedAt}\n`);
  if (method) {
    process.stdout.write(`Method: ${method}\n`);
  }
  process.stdout.write(`Pinned prototype count: ${recorded.prototypes.prototypes.length}\n`);
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

function readRequiredArg(flag: string): string {
  const value = readArg(flag);
  if (value && value.length > 0) {
    return value;
  }

  throw new Error(`Missing required ${flag} argument.`);
}

function readRequiredFamilyArg(flag: string): 'classic' | 'modern' {
  const value = readRequiredArg(flag);
  if (value === 'classic' || value === 'modern') {
    return value;
  }

  throw new Error(`Invalid ${flag} value: ${value}. Expected classic or modern.`);
}

function readRequiredStatusArg(flag: string): CanvasHarvestFixtureRecordedPrototypeValidationStatus {
  const value = readRequiredArg(flag);
  if (value === 'validated' || value === 'pending' || value === 'failed') {
    return value;
  }

  throw new Error(`Invalid ${flag} value: ${value}. Expected validated, pending, or failed.`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
