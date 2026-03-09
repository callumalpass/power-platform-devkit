import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '../packages/artifacts/src/index';
import {
  buildCanvasHarvestFixturePrototypeDraftDocument,
  DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH,
  type CanvasHarvestFixturePlan,
  type CanvasHarvestFixturePrototypeDocument,
} from '../packages/canvas/src/harvest-fixture';
import type { CanvasTemplateRegistryDocument } from '../packages/canvas/src/index';

const DEFAULT_CANVAS_HARVEST_PROTOTYPE_DRAFT_PATH = 'fixtures/canvas-harvest/generated/prototype-drafts.json';

async function main(): Promise<void> {
  const planPath = resolve(readArg('--plan') ?? DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH);
  const registryPath = resolve(readArg('--registry') ?? 'registries/canvas-controls.json');
  const prototypePath = resolve(readArg('--prototypes') ?? 'fixtures/canvas-harvest/prototypes.json');
  const outPath = resolve(readArg('--out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_DRAFT_PATH);
  const generatedAt = new Date().toISOString();
  const [plan, registry, prototypes] = await Promise.all([
    readJsonFile<CanvasHarvestFixturePlan>(planPath),
    readJsonFile<CanvasTemplateRegistryDocument>(registryPath),
    readJsonFile<CanvasHarvestFixturePrototypeDocument>(prototypePath),
  ]);

  const drafts = buildCanvasHarvestFixturePrototypeDraftDocument({
    plan,
    registry,
    prototypes,
    generatedAt,
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeJsonFile(outPath, drafts as unknown as Parameters<typeof writeJsonFile>[1]);

  process.stdout.write(`Wrote prototype drafts: ${outPath}\n`);
  process.stdout.write(`Source plan: ${planPath}\n`);
  process.stdout.write(
    `Draft controls: ${drafts.counts.draftControls}; skipped controls: ${drafts.counts.skippedControls}\n`
  );
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
