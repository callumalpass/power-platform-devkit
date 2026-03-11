import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJsonFile, writeJsonFile } from '@pp/artifacts';
import {
  assertCanvasHarvestFixtureCatalogCanWriteOutputs,
  buildCanvasHarvestFixturePlan,
  DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH,
  DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH,
  renderCanvasHarvestFixture,
  type CanvasControlCatalogDocument,
  type CanvasControlInsertReportDocument,
  type CanvasHarvestFixturePrototypeDocument,
  type CanvasTemplateRegistryDocument,
} from '@pp/canvas';

async function main(): Promise<void> {
  const catalogPath = resolve(readArg('--catalog') ?? 'registries/canvas-control-catalog.json');
  const registryPath = resolve(readArg('--registry') ?? 'registries/canvas-controls.json');
  const prototypePath = resolve(readArg('--prototypes') ?? 'fixtures/canvas-harvest/prototypes.json');
  const insertReportPath = readArg('--insert-report');
  const planPath = resolve(readArg('--plan-out') ?? DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH);
  const yamlPath = resolve(readArg('--yaml-out') ?? DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH);
  const allowIncompleteCatalog = readFlag('--allow-incomplete-catalog');
  const generatedAt = new Date().toISOString();
  const [catalog, registry, prototypes, insertReport] = await Promise.all([
    readJsonFile<CanvasControlCatalogDocument>(catalogPath),
    readJsonFile<CanvasTemplateRegistryDocument>(registryPath),
    readJsonFile<CanvasHarvestFixturePrototypeDocument>(prototypePath),
    insertReportPath ? readJsonFile<CanvasControlInsertReportDocument>(resolve(insertReportPath)) : Promise.resolve(undefined),
  ]);

  assertCanvasHarvestFixtureCatalogCanWriteOutputs({
    catalog,
    catalogPath,
    planPath,
    yamlPath,
    trackedPlanPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_PLAN_PATH),
    trackedYamlPath: resolve(DEFAULT_CANVAS_HARVEST_FIXTURE_YAML_PATH),
    allowIncompleteCatalog,
  });

  const plan = buildCanvasHarvestFixturePlan({
    catalog,
    catalogPath,
    registry,
    prototypes,
    insertReport,
    insertReportPath: insertReportPath ? resolve(insertReportPath) : undefined,
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
  if (plan.insertReportSummary) {
    process.stdout.write(
      `Insert report alignment: ${plan.insertReportSummary.alignment}; matched: ${plan.insertReportSummary.matchedControlCount}; unmatched catalog: ${plan.insertReportSummary.unmatchedCatalogControlCount}; unmatched report: ${plan.insertReportSummary.unmatchedReportEntryCount}\n`
    );
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

function readFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
