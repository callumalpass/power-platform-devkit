import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '@pp/artifacts';
import {
  buildCanvasHarvestFixturePrototypeValidationBacklogDocument,
  DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH,
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BACKLOG_PATH,
  type CanvasHarvestFixturePlan,
  type CanvasHarvestFixturePrototypeDocument,
  type CanvasTemplateRegistryDocument,
} from '@pp/canvas';

async function main(): Promise<void> {
  const planPath = resolve(readArg('--plan') ?? DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH);
  const registryPath = resolve(readArg('--registry') ?? 'registries/canvas-controls.json');
  const prototypePath = resolve(readArg('--prototypes') ?? 'fixtures/canvas-harvest/prototypes.json');
  const outPath = resolve(readArg('--out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BACKLOG_PATH);
  const generatedAt = new Date().toISOString();
  const [plan, registry, prototypes] = await Promise.all([
    readJsonFile<CanvasHarvestFixturePlan>(planPath),
    readJsonFile<CanvasTemplateRegistryDocument>(registryPath),
    readJsonFile<CanvasHarvestFixturePrototypeDocument>(prototypePath),
  ]);

  const backlog = buildCanvasHarvestFixturePrototypeValidationBacklogDocument({
    plan,
    registry,
    prototypes,
    generatedAt,
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeJsonFile(outPath, backlog as unknown as Parameters<typeof writeJsonFile>[1]);

  process.stdout.write(`Wrote prototype validation backlog: ${outPath}\n`);
  process.stdout.write(`Source plan: ${planPath}\n`);
  process.stdout.write(
    `Prototype controls: ${backlog.counts.prototypeControls}; pending validation: ${backlog.counts.pendingValidationControls}; failed: ${backlog.counts.failedValidationControls}; validated: ${backlog.counts.validatedControls}; unknown: ${backlog.counts.unknownValidationControls}\n`
  );
  process.stdout.write(
    `Plan alignment: aligned ${backlog.counts.alignedPlanControls}; stale ${backlog.counts.stalePlanControls}; prototype-only ${backlog.counts.prototypeOnlyControls}; registry missing ${backlog.counts.registryMissingControls}\n`
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
