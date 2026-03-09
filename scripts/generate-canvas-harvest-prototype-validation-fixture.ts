import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '../packages/artifacts/src/index';
import {
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BACKLOG_PATH,
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_SELECTION_PATH,
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_YAML_PATH,
  buildCanvasHarvestPrototypeValidationFixtureDocument,
  renderCanvasHarvestPrototypeValidationFixture,
  type CanvasHarvestFixturePrototypeDocument,
  type CanvasHarvestFixturePrototypeValidationBacklogDocument,
  type CanvasHarvestFixturePrototypeValidationStatus,
} from '../packages/canvas/src/harvest-fixture';
import type { CanvasTemplateRegistryDocument } from '../packages/canvas/src/index';

async function main(): Promise<void> {
  const backlogPath = resolve(readArg('--backlog') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BACKLOG_PATH);
  const registryPath = resolve(readArg('--registry') ?? 'registries/canvas-controls.json');
  const prototypePath = resolve(readArg('--prototypes') ?? 'fixtures/canvas-harvest/prototypes.json');
  const outPath = resolve(readArg('--out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_YAML_PATH);
  const selectionOutPath = resolve(
    readArg('--selection-out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_SELECTION_PATH
  );
  const family = readFamilyArg('--family');
  const statuses = parseStatuses(readArg('--status'));
  const limit = readPositiveIntegerArg('--limit');
  const generatedAt = new Date().toISOString();
  const [backlog, registry, prototypes] = await Promise.all([
    readJsonFile<CanvasHarvestFixturePrototypeValidationBacklogDocument>(backlogPath),
    readJsonFile<CanvasTemplateRegistryDocument>(registryPath),
    readJsonFile<CanvasHarvestFixturePrototypeDocument>(prototypePath),
  ]);

  const rendered = renderCanvasHarvestPrototypeValidationFixture({
    backlog,
    registry,
    prototypes,
    family,
    statuses,
    limit,
    columns: 2,
    cellWidth: 280,
    cellHeight: 44,
    gutterX: 20,
    gutterY: 16,
    paddingX: 24,
    paddingY: 24,
  });
  const selection = buildCanvasHarvestPrototypeValidationFixtureDocument({
    backlog,
    rendered,
    statuses,
    family,
    limit,
    generatedAt,
    paths: {
      backlog: backlogPath,
      registry: registryPath,
      prototypes: prototypePath,
      yaml: outPath,
    },
  });

  await mkdir(dirname(outPath), { recursive: true });
  await Promise.all([
    writeFile(outPath, rendered.yaml, 'utf8'),
    writeJsonFile(selectionOutPath, selection as unknown as Parameters<typeof writeJsonFile>[1]),
  ]);

  process.stdout.write(`Wrote prototype validation fixture YAML: ${outPath}\n`);
  process.stdout.write(`Wrote prototype validation fixture selection: ${selectionOutPath}\n`);
  process.stdout.write(`Source backlog: ${backlogPath}\n`);
  process.stdout.write(
    `Selected controls: ${rendered.selectedControls.length}; skipped unresolved: ${rendered.skippedControls.length}; rendered controls: ${rendered.renderedControlCount}\n`
  );
  process.stdout.write(
    `Filters: statuses ${formatStatuses(statuses)}; family ${family ?? 'all'}; limit ${limit ?? 'none'}\n`
  );
  process.stdout.write(
    `Selected order: ${rendered.selectedControls
      .map((control) => `${labelControl(control.family, control.catalogName)} [${control.validationStatus}, ${control.planAlignment}]`)
      .join('; ')}\n`
  );
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readFamilyArg(flag: string): 'classic' | 'modern' | undefined {
  const value = readArg(flag);
  if (!value) {
    return undefined;
  }

  if (value === 'classic' || value === 'modern') {
    return value;
  }

  throw new Error(`Unsupported ${flag} value ${JSON.stringify(value)}. Expected classic or modern.`);
}

function readPositiveIntegerArg(flag: string): number | undefined {
  const value = readArg(flag);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Unsupported ${flag} value ${JSON.stringify(value)}. Expected a positive integer.`);
  }

  return parsed;
}

function parseStatuses(raw: string | undefined): CanvasHarvestFixturePrototypeValidationStatus[] | undefined {
  if (!raw) {
    return undefined;
  }

  const statuses = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (statuses.length === 0) {
    throw new Error('Expected at least one comma-separated status after --status.');
  }

  const invalid = statuses.filter((value) => !isPrototypeValidationStatus(value));
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported --status value(s): ${invalid.join(', ')}. Expected any of failed, pending, unknown, validated.`
    );
  }

  return statuses as CanvasHarvestFixturePrototypeValidationStatus[];
}

function isPrototypeValidationStatus(value: string): value is CanvasHarvestFixturePrototypeValidationStatus {
  return value === 'failed' || value === 'pending' || value === 'unknown' || value === 'validated';
}

function formatStatuses(statuses: CanvasHarvestFixturePrototypeValidationStatus[] | undefined): string {
  return (statuses ?? ['failed', 'pending', 'unknown']).join(', ');
}

function labelControl(family: 'classic' | 'modern', catalogName: string): string {
  return `${family === 'classic' ? 'Classic' : 'Modern'}/${catalogName}`;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
