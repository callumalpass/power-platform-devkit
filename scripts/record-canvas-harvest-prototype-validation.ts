import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '../packages/artifacts/src/index';
import {
  DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH,
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BACKLOG_PATH,
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_SELECTION_PATH,
  DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_YAML_PATH,
  recordCanvasHarvestFixturePrototypeValidation,
  type CanvasHarvestFixturePrototypeDocument,
  type CanvasHarvestFixtureRecordedPrototypeValidationStatus,
  type CanvasHarvestFixturePlan,
  type CanvasHarvestFixturePrototypeValidationStatus,
} from '../packages/canvas/src/harvest-fixture';
import type { CanvasTemplateRegistryDocument } from '../packages/canvas/src/index';

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
  const refreshValidationFixture = process.argv.includes('--refresh-validation-fixture');
  const planPath = resolve(readArg('--plan') ?? DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH);
  const registryPath = resolve(readArg('--registry') ?? 'registries/canvas-controls.json');
  const backlogOutPath = resolve(readArg('--backlog-out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_BACKLOG_PATH);
  const yamlOutPath = resolve(readArg('--yaml-out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_YAML_PATH);
  const selectionOutPath = resolve(
    readArg('--selection-out') ?? DEFAULT_CANVAS_HARVEST_PROTOTYPE_VALIDATION_FIXTURE_SELECTION_PATH
  );
  const nextFamily = readFamilyArg('--next-family');
  const nextStatuses = parseStatuses(readArg('--next-status'));
  const nextLimit = readPositiveIntegerArg('--next-limit');
  const [prototypes, plan, registry] = await Promise.all([
    readJsonFile<CanvasHarvestFixturePrototypeDocument>(prototypePath),
    refreshValidationFixture ? readJsonFile<CanvasHarvestFixturePlan>(planPath) : Promise.resolve(undefined),
    refreshValidationFixture ? readJsonFile<CanvasTemplateRegistryDocument>(registryPath) : Promise.resolve(undefined),
  ]);
  const recorded = recordCanvasHarvestFixturePrototypeValidation({
    prototypes,
    family,
    catalogName,
    status,
    recordedAt,
    method,
    notes,
    generatedAt,
    ...(refreshValidationFixture && plan && registry
      ? {
          refresh: {
            plan,
            registry,
            family: nextFamily,
            statuses: nextStatuses,
            limit: nextLimit,
            allowEmpty: true,
            columns: 2,
            cellWidth: 280,
            cellHeight: 44,
            gutterX: 20,
            gutterY: 16,
            paddingX: 24,
            paddingY: 24,
            paths: {
              backlog: backlogOutPath,
              registry: registryPath,
              prototypes: outPath,
              yaml: yamlOutPath,
            },
          },
        }
      : {}),
  });

  if (!dryRun) {
    await Promise.all([
      mkdir(dirname(outPath), { recursive: true }),
      recorded.refresh ? mkdir(dirname(backlogOutPath), { recursive: true }) : Promise.resolve(),
      recorded.refresh ? mkdir(dirname(yamlOutPath), { recursive: true }) : Promise.resolve(),
      recorded.refresh ? mkdir(dirname(selectionOutPath), { recursive: true }) : Promise.resolve(),
    ]);
    await Promise.all([
      writeJsonFile(outPath, recorded.prototypes as unknown as Parameters<typeof writeJsonFile>[1]),
      recorded.refresh
        ? writeJsonFile(backlogOutPath, recorded.refresh.backlog as unknown as Parameters<typeof writeJsonFile>[1])
        : Promise.resolve(),
      recorded.refresh ? writeFile(yamlOutPath, recorded.refresh.rendered.yaml, 'utf8') : Promise.resolve(),
      recorded.refresh
        ? writeJsonFile(selectionOutPath, recorded.refresh.selection as unknown as Parameters<typeof writeJsonFile>[1])
        : Promise.resolve(),
    ]);
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

  if (recorded.refresh) {
    process.stdout.write(
      `${dryRun ? 'Prototype validation backlog output (not written)' : 'Prototype validation backlog output'}: ${backlogOutPath}\n`
    );
    process.stdout.write(
      `${dryRun ? 'Prototype validation fixture YAML output (not written)' : 'Prototype validation fixture YAML output'}: ${yamlOutPath}\n`
    );
    process.stdout.write(
      `${dryRun ? 'Prototype validation fixture selection output (not written)' : 'Prototype validation fixture selection output'}: ${selectionOutPath}\n`
    );
    process.stdout.write(
      `Updated backlog counts: pending ${recorded.refresh.backlog.counts.pendingValidationControls}; failed ${recorded.refresh.backlog.counts.failedValidationControls}; validated ${recorded.refresh.backlog.counts.validatedControls}; unknown ${recorded.refresh.backlog.counts.unknownValidationControls}\n`
    );
    process.stdout.write(
      `Next validation fixture: selected ${recorded.refresh.selection.counts.selectedControls}; skipped ${recorded.refresh.selection.counts.skippedControls}; rendered ${recorded.refresh.selection.counts.renderedControls}\n`
    );
    process.stdout.write(
      `Next validation filters: statuses ${formatStatuses(nextStatuses)}; family ${nextFamily ?? 'all'}; limit ${nextLimit ?? 'none'}\n`
    );
    process.stdout.write(
      `Next validation order: ${formatSelectedControls(recorded.refresh.selection.selectedControls)}\n`
    );
  }
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

function parseStatuses(raw: string | undefined): CanvasHarvestFixturePrototypeValidationStatus[] | undefined {
  if (!raw) {
    return undefined;
  }

  const statuses = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (statuses.length === 0) {
    throw new Error('Expected at least one comma-separated status after --next-status.');
  }

  const invalid = statuses.filter((value) => !isPrototypeValidationStatus(value));
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported --next-status value(s): ${invalid.join(', ')}. Expected any of failed, pending, unknown, validated.`
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

function formatSelectedControls(
  selectedControls: Array<{
    family: 'classic' | 'modern';
    catalogName: string;
    validationStatus: CanvasHarvestFixturePrototypeValidationStatus;
    planAlignment: 'aligned' | 'stale' | 'prototype-only';
  }>
): string {
  if (selectedControls.length === 0) {
    return 'none';
  }

  return selectedControls
    .map((control) => `${control.family}/${control.catalogName} [${control.validationStatus}, ${control.planAlignment}]`)
    .join('; ');
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
