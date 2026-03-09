import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '../packages/artifacts/src/index';
import {
  promoteCanvasHarvestFixturePrototypeDraft,
  type CanvasHarvestFixturePrototypeDocument,
  type CanvasHarvestFixturePrototypeDraftDocument,
} from '../packages/canvas/src/harvest-fixture';
import type { CanvasTemplateRegistryDocument } from '../packages/canvas/src/index';

const DEFAULT_CANVAS_HARVEST_PROTOTYPE_DRAFT_PATH = 'fixtures/canvas-harvest/generated/prototype-drafts.json';
const DEFAULT_CANVAS_HARVEST_PROTOTYPE_PATH = 'fixtures/canvas-harvest/prototypes.json';
const DEFAULT_CANVAS_REGISTRY_PATH = 'registries/canvas-controls.json';

async function main(): Promise<void> {
  const family = readRequiredFamilyArg('--family');
  const catalogName = readRequiredArg('--name');
  const draftPath = resolve(readArg('--drafts') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_DRAFT_PATH);
  const prototypePath = resolve(readArg('--prototypes') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_PATH);
  const registryPath = resolve(readArg('--registry') ?? DEFAULT_CANVAS_REGISTRY_PATH);
  const outPath = resolve(readArg('--out') ?? prototypePath);
  const generatedAt = new Date().toISOString();
  const additionalNotes = readArgs('--note');
  const dryRun = process.argv.includes('--dry-run');
  const [drafts, registry, prototypes] = await Promise.all([
    readJsonFile<CanvasHarvestFixturePrototypeDraftDocument>(draftPath),
    readJsonFile<CanvasTemplateRegistryDocument>(registryPath),
    readJsonFile<CanvasHarvestFixturePrototypeDocument>(prototypePath),
  ]);

  const promoted = promoteCanvasHarvestFixturePrototypeDraft({
    drafts,
    registry,
    prototypes,
    family,
    catalogName,
    generatedAt,
    notes: additionalNotes,
  });

  if (!dryRun) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeJsonFile(outPath, promoted.prototypes as unknown as Parameters<typeof writeJsonFile>[1]);
  }

  process.stdout.write(
    `${dryRun ? 'Dry run:' : 'Wrote'} promoted prototype ${family}/${catalogName} -> ${promoted.promoted.constructor} (${promoted.resolvedTemplate.templateName}@${promoted.resolvedTemplate.templateVersion})\n`
  );
  process.stdout.write(`Source drafts: ${draftPath}\n`);
  process.stdout.write(`Prototype input: ${prototypePath}\n`);
  process.stdout.write(`${dryRun ? 'Prototype output (not written)' : 'Prototype output'}: ${outPath}\n`);
  process.stdout.write(`Pinned prototype count: ${promoted.prototypes.prototypes.length}\n`);
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

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
