import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '../packages/artifacts/src/index';
import {
  buildCanvasHarvestFixturePlan,
  renderCanvasHarvestFixture,
  type CanvasControlCatalogDocument,
  type CanvasControlInsertReportDocument,
  type CanvasHarvestFixturePrototypeDocument,
} from '../packages/canvas/src/harvest-fixture';
import type { CanvasTemplateRegistryDocument } from '../packages/canvas/src/index';

async function main(): Promise<void> {
  const catalogPath = resolve(readArg('--catalog') ?? 'registries/canvas-control-catalog.json');
  const registryPath = resolve(readArg('--registry') ?? 'registries/canvas-controls.json');
  const prototypePath = resolve(readArg('--prototypes') ?? 'fixtures/canvas-harvest/prototypes.json');
  const insertReportPath = readArg('--insert-report');
  const planPath = resolve(readArg('--plan-out') ?? 'fixtures/canvas-harvest/generated/fixture-plan.json');
  const yamlPath = resolve(readArg('--yaml-out') ?? 'fixtures/canvas-harvest/generated/HarvestFixtureContainer.pa.yaml');
  const generatedAt = new Date().toISOString();
  const [catalog, registry, prototypes, insertReport] = await Promise.all([
    readJsonFile<CanvasControlCatalogDocument>(catalogPath),
    readJsonFile<CanvasTemplateRegistryDocument>(registryPath),
    readJsonFile<CanvasHarvestFixturePrototypeDocument>(prototypePath),
    insertReportPath ? readJsonFile<CanvasControlInsertReportDocument>(resolve(insertReportPath)) : Promise.resolve(undefined),
  ]);
  const plan = buildCanvasHarvestFixturePlan({
    catalog,
    registry,
    prototypes,
    insertReport,
    generatedAt,
  });
  const rendered = renderCanvasHarvestFixture({
    plan,
    registry,
    prototypes,
    columns: 3,
    cellWidth: 280,
    cellHeight: 44,
    gutterX: 20,
    gutterY: 16,
    paddingX: 24,
    paddingY: 24,
    includePendingMarkers: true,
  });

  await mkdir(dirname(planPath), { recursive: true });
  await mkdir(dirname(yamlPath), { recursive: true });
  await writeJsonFile(planPath, plan as unknown as Parameters<typeof writeJsonFile>[1]);
  await writeFile(yamlPath, rendered.yaml, 'utf8');

  process.stdout.write(`Wrote fixture plan: ${planPath}\n`);
  process.stdout.write(`Wrote fixture YAML: ${yamlPath}\n`);
  if (insertReportPath) {
    process.stdout.write(`Applied insert report: ${resolve(insertReportPath)}\n`);
  }
  process.stdout.write(
    `Catalog controls: ${plan.counts.catalogControls}; resolved: ${plan.counts.resolvedControls}; prototype missing: ${plan.counts.prototypeMissingControls}; registry missing: ${plan.counts.registryMissingControls}\n`
  );
  process.stdout.write(
    `Rendered controls: ${rendered.renderedControlCount}; pending markers: ${rendered.pendingMarkerCount}; wrapper: ${rendered.containerTemplateName}@${rendered.containerTemplateVersion}\n`
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
