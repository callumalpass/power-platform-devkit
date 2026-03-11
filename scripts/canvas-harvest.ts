import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium, type BrowserContext, type Frame, type Locator, type Page } from 'playwright-core';
import { writeJsonFile } from '@pp/artifacts';
import { AuthService, resolveBrowserProfileDirectory, type AuthProfile, type BrowserProfile, type UserAuthProfile } from '@pp/auth';
import {
  analyzeHarvestedCanvasApp,
  deriveCanvasStudioEditUrl,
  fetchCanvasControlCatalogDocument,
  type CanvasControlCatalogDocument,
  type CanvasControlInsertReportDocument,
  type CanvasSupportMatrixEntry,
  type CanvasTemplateRecord,
  type CanvasTemplateRegistryDocument,
} from '@pp/canvas';
import { type EnvironmentAlias } from '@pp/config';
import { resolveDataverseClient, type DataverseClient } from '@pp/dataverse';

interface CliOptions {
  fixtureManifestPath?: string;
  envAlias: string;
  envAliasExplicit: boolean;
  solutionUniqueName: string;
  solutionUniqueNameExplicit: boolean;
  appId?: string;
  appName?: string;
  appDisplayName?: string;
  studioUrl?: string;
  screenDir?: string;
  outDir: string;
  outDirExplicit: boolean;
  registryOut: string;
  registryOutExplicit: boolean;
  catalogOut: string;
  configDir?: string;
  catalogJson?: string;
  catalogJsonExplicit: boolean;
  catalogResumeReport?: string;
  catalogResumeLoop?: string;
  catalogFamily?: 'classic' | 'modern';
  catalogStartAt?: string;
  catalogLimit?: number;
  catalogLoop: boolean;
  catalogMaxChunks?: number;
  resetSolutionZip?: string;
  browserProfileName?: string;
  browserKind: BrowserProfile['kind'];
  browserCommand?: string;
  browserArgs: string[];
  debugBrowser: boolean;
  forceBrowserAuth: boolean;
  headless: boolean;
  slowMoMs: number;
  skipUi: boolean;
  skipBrowserAuth: boolean;
  skipPublish: boolean;
  interactive: boolean;
  settleMs: number;
  timeoutMs: number;
  allControls: boolean;
  includeRetired: boolean;
  fixtureContainerName: string;
}

interface CanvasHarvestFixtureManifest {
  schemaVersion: 1;
  name?: string;
  environmentAlias?: string;
  solutionUniqueName?: string;
  appDisplayName?: string;
  browserProfileName?: string;
  fixtureContainerName?: string;
  defaultScreenDir?: string;
  defaultScreenFiles?: string[];
  prototypeValidationScreenDir?: string;
  prototypeValidationScreenFiles?: string[];
  registryOut?: string;
  catalogOut?: string;
  notes?: string[];
}

const DEFAULT_FIXTURE_MANIFEST_PATH = resolve(process.cwd(), 'fixtures', 'canvas-harvest', 'fixture-solution.json');

interface CanvasAppRecord {
  canvasappid?: string;
  displayname?: string;
  name?: string;
  appopenuri?: string;
  appversion?: string;
  createdbyclientversion?: string;
  lastpublishtime?: string;
  status?: string;
  tags?: string;
}

interface PlaywrightSessionResult {
  browserProfile: BrowserProfile;
  studioUrl: string;
  catalogPath?: string;
  catalogResumeReportPath?: string;
  insertReportPath?: string;
}

interface EnsuredBrowserProfile {
  browserProfile: BrowserProfile;
  created: boolean;
}

interface StudioYamlDescriptor {
  kind: 'screen' | 'control';
  name: string;
}

interface HarvestRunResult {
  outDir: string;
  registryPath: string;
  summaryPath: string;
  appInfoPath: string;
  registryOutPath: string;
  catalogOutPath: string;
  studioUrl: string;
  catalogPath?: string;
  catalogResumeReportPath?: string;
  insertReportPath?: string;
}

interface HarvestLoopChunkRecord {
  index: number;
  label: string;
  status: 'completed' | 'failed';
  outDir: string;
  startedAt: string;
  completedAt?: string;
  catalogPath?: string;
  insertReportPath?: string;
  summaryPath?: string;
  registryPath?: string;
  appInfoPath?: string;
  resumedFromReportPath?: string;
  selection?: CanvasControlInsertReportDocument['selection'];
  selectionCheckpoint?: CanvasControlInsertReportDocument['selectionCheckpoint'];
  totals?: CanvasControlInsertReportDocument['totals'];
  error?: string;
}

interface HarvestLoopDocument {
  schemaVersion: 1;
  generatedAt: string;
  envAlias: string;
  solutionUniqueName: string;
  rootOutDir: string;
  registryOutPath: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  completionReason?: 'exhausted' | 'max-chunks' | 'failed';
  maxChunks?: number;
  catalogPath?: string;
  finalChunkOutDir?: string;
  latestInsertReportPath?: string;
  nextResumeReportPath?: string;
  remainingControls?: number;
  error?: string;
  chunks: HarvestLoopChunkRecord[];
}

export interface HarvestLoopRunState {
  options: CliOptions;
  loopManifestPath: string;
  rootOutDir: string;
  rootRegistryOutPath: string;
  catalogPath?: string;
  resumeReportPath?: string;
  nextChunkIndex: number;
  loopDocument: HarvestLoopDocument;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.catalogLoop) {
    await runHarvestLoop(options);
    return;
  }

  await runHarvestOnce(options);
}

async function runHarvestOnce(options: CliOptions): Promise<HarvestRunResult> {
  const configOptions = options.configDir ? { configDir: options.configDir } : {};
  const authService = new AuthService(configOptions);
  const resolved = await resolveDataverseClient(options.envAlias, configOptions);

  assertResult(resolved.success && resolved.data, 'Failed to resolve the target Dataverse environment.');

  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });

  const environment = resolved.data.environment;
  const authProfile = resolved.data.authProfile;
  let appRecord: CanvasAppRecord | undefined;
  let studioUrl = options.studioUrl;
  let studioYamlDir = options.screenDir ? resolve(options.screenDir) : undefined;
  let catalogPath = options.catalogJson ? resolve(options.catalogJson) : undefined;
  let fetchedCatalogForRun = false;
  let fixtureContainerName = options.fixtureContainerName;

  if (options.resetSolutionZip) {
    await importSolution(resolved.data.client, resolve(options.resetSolutionZip));
  }

  if (!studioUrl || options.appId || options.appName || options.appDisplayName) {
    appRecord = await resolveCanvasAppRecord(resolved.data.client, options);
  }

  if (!studioUrl) {
    studioUrl = deriveCanvasStudioEditUrl(appRecord?.appopenuri ?? '');
  }

  assertResult(studioUrl, 'Could not determine a Studio edit URL. Pass --studio-url explicitly.');

  let session: PlaywrightSessionResult | undefined;

  if (!options.skipUi) {
    if (options.allControls) {
      catalogPath = await ensureCatalogPath(options, outDir, catalogPath);
      fetchedCatalogForRun = !options.catalogJson;
      if (!studioYamlDir) {
        studioYamlDir = await createEmptyFixtureDirectory(outDir);
        fixtureContainerName = 'Screen1';
      }
    }

    assertResult(studioYamlDir, '--screen-dir is required unless --skip-ui is set.');
    session = await runStudioSession({
      options,
      environment,
      authService,
      authProfile,
      studioUrl,
      outDir,
      screenDir: studioYamlDir,
      catalogPath,
      fixtureContainerName,
    });
    await writeJsonFile(join(outDir, 'studio-session.json'), {
      browserProfile: session.browserProfile,
      studioUrl: session.studioUrl,
      catalogPath: session.catalogPath,
      catalogResumeReportPath: session.catalogResumeReportPath,
      insertReportPath: session.insertReportPath,
    } as unknown as Parameters<typeof writeJsonFile>[1]);
  }

  if (!appRecord) {
    appRecord = await resolveCanvasAppRecord(resolved.data.client, options);
  }

  const exportResult = await exportSolution(resolved.data.client, options.solutionUniqueName);
  const zipPath = join(outDir, `${options.solutionUniqueName}.zip`);
  await writeFile(zipPath, Buffer.from(exportResult.ExportSolutionFile, 'base64'));

  const unpackedSolutionDir = join(outDir, 'solution-unpacked');
  unzipArchive(zipPath, unpackedSolutionDir);

  const msappPath = await resolveCanvasMsappPath(unpackedSolutionDir, appRecord);
  const msappDir = join(outDir, 'msapp-unpacked');
  unzipArchive(msappPath, msappDir);

  const analyzed = await analyzeHarvestedCanvasApp(msappDir, {
    generatedAt: new Date().toISOString(),
    source: `${options.envAlias}/${options.solutionUniqueName}`,
    sourceArtifact: basename(msappPath),
    sourceAppId: appRecord?.canvasappid,
    platformVersion: appRecord?.createdbyclientversion,
    appVersion: appRecord?.appversion,
  });

  const registryPath = join(outDir, 'canvas-registry.json');
  const summaryPath = join(outDir, 'canvas-harvest-summary.json');
  const appInfoPath = join(outDir, 'canvas-app.json');
  const registryOutPath = resolve(options.registryOut);
  const catalogOutPath = resolve(options.catalogOut);

  await writeJsonFile(registryPath, analyzed.registry as unknown as Parameters<typeof writeJsonFile>[1]);
  await mkdir(dirname(registryOutPath), { recursive: true }).catch(() => undefined);
  await writeJsonFile(registryOutPath, analyzed.registry as unknown as Parameters<typeof writeJsonFile>[1]);
  if (catalogPath && fetchedCatalogForRun) {
    await mkdir(dirname(catalogOutPath), { recursive: true }).catch(() => undefined);
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as CanvasControlCatalogDocument;
    await writeJsonFile(catalogOutPath, catalog as unknown as Parameters<typeof writeJsonFile>[1]);
  }
  await writeJsonFile(
    summaryPath,
    {
      environment,
      solutionUniqueName: options.solutionUniqueName,
      studioUrl,
      fixtureScreenDir: studioYamlDir,
      catalogPath,
      catalogResumeReportPath: session?.catalogResumeReportPath,
      insertReportPath: session?.insertReportPath,
      app: appRecord,
      ...analyzed.summary,
    } as unknown as Parameters<typeof writeJsonFile>[1]
  );
  await writeJsonFile(appInfoPath, (appRecord ?? {}) as unknown as Parameters<typeof writeJsonFile>[1]);

  process.stdout.write(`Harvest complete.\n`);
  process.stdout.write(`Registry: ${registryPath}\n`);
  process.stdout.write(`Project registry: ${registryOutPath}\n`);
  if (catalogPath && fetchedCatalogForRun) {
    process.stdout.write(`Control catalog: ${catalogOutPath}\n`);
  }
  if (session?.insertReportPath) {
    process.stdout.write(`Insert report: ${session.insertReportPath}\n`);
  }
  process.stdout.write(`Summary: ${summaryPath}\n`);
  process.stdout.write(`Unpacked app: ${msappDir}\n`);

  return {
    outDir,
    registryPath,
    summaryPath,
    appInfoPath,
    registryOutPath,
    catalogOutPath,
    studioUrl,
    catalogPath,
    catalogResumeReportPath: session?.catalogResumeReportPath,
    insertReportPath: session?.insertReportPath,
  };
}

async function runHarvestLoop(options: CliOptions): Promise<void> {
  const loopState = await resolveHarvestLoopRunState(options);
  const loopOptions = loopState.options;
  const rootOutDir = loopState.rootOutDir;
  const loopManifestPath = loopState.loopManifestPath;
  const rootRegistryOutPath = loopState.rootRegistryOutPath;
  const loopDocument = loopState.loopDocument;

  await mkdir(join(rootOutDir, 'chunks'), { recursive: true });
  if (options.catalogResumeLoop) {
    process.stdout.write(
      `Resuming catalog harvest loop from ${loopManifestPath} at chunk ${loopState.nextChunkIndex}` +
        `${loopState.resumeReportPath ? ` using ${loopState.resumeReportPath}` : ''}` +
        '.\n'
    );
  }
  await writeHarvestLoopDocument(loopManifestPath, loopDocument);

  let catalogPath = loopState.catalogPath;
  let resumeReportPath = loopState.resumeReportPath;
  let lastResult: HarvestRunResult | undefined;
  let completionReason: HarvestLoopDocument['completionReason'];
  let chunksStartedThisRun = 0;

  for (let chunkIndex = loopState.nextChunkIndex; ; chunkIndex += 1) {
    if (loopOptions.catalogMaxChunks && chunksStartedThisRun >= loopOptions.catalogMaxChunks) {
      completionReason = 'max-chunks';
      loopDocument.status = 'partial';
      loopDocument.completionReason = completionReason;
      loopDocument.latestInsertReportPath = resumeReportPath;
      loopDocument.nextResumeReportPath = resumeReportPath;
      loopDocument.remainingControls =
        loopDocument.chunks.at(-1)?.selectionCheckpoint?.remainingControls ?? loopDocument.remainingControls ?? 0;
      break;
    }

    const chunkLabel = formatHarvestChunkLabel(chunkIndex);
    const chunkOutDir = join(rootOutDir, 'chunks', chunkLabel);
    const startedAt = new Date().toISOString();
    const chunkRecord: HarvestLoopChunkRecord = {
      index: chunkIndex,
      label: chunkLabel,
      status: 'failed',
      outDir: chunkOutDir,
      startedAt,
      ...(resumeReportPath ? { resumedFromReportPath: resumeReportPath } : {}),
    };
    loopDocument.chunks.push(chunkRecord);
    await writeHarvestLoopDocument(loopManifestPath, loopDocument);
    chunksStartedThisRun += 1;

    const chunkOptions = buildHarvestLoopChunkOptions(loopOptions, {
      chunkOutDir,
      chunkIndex,
      catalogPath,
      resumeReportPath,
    });

    process.stdout.write(
      `Starting catalog harvest chunk ${chunkIndex}` +
        `${resumeReportPath ? ` from ${resumeReportPath}` : ''}` +
        `${chunkOptions.catalogFamily ? ` in ${chunkOptions.catalogFamily}` : ''}` +
        `${chunkOptions.catalogStartAt ? ` at ${JSON.stringify(chunkOptions.catalogStartAt)}` : ''}` +
        `${chunkOptions.catalogLimit ? ` with limit ${chunkOptions.catalogLimit}` : ''}` +
        '.\n'
    );

    try {
      lastResult = await runHarvestOnce(chunkOptions);
      catalogPath ??= lastResult.catalogPath;

      assertResult(lastResult.insertReportPath, '--catalog-loop requires each chunk to emit an insert report.');
      const insertReport = await readInsertReportDocument(lastResult.insertReportPath);

      chunkRecord.status = 'completed';
      chunkRecord.completedAt = new Date().toISOString();
      chunkRecord.catalogPath = lastResult.catalogPath;
      chunkRecord.insertReportPath = lastResult.insertReportPath;
      chunkRecord.summaryPath = lastResult.summaryPath;
      chunkRecord.registryPath = lastResult.registryPath;
      chunkRecord.appInfoPath = lastResult.appInfoPath;
      chunkRecord.selection = insertReport.selection;
      chunkRecord.selectionCheckpoint = insertReport.selectionCheckpoint;
      chunkRecord.totals = insertReport.totals;

      loopDocument.catalogPath ??= lastResult.catalogPath;
      loopDocument.finalChunkOutDir = lastResult.outDir;
      loopDocument.latestInsertReportPath = lastResult.insertReportPath;
      loopDocument.remainingControls = insertReport.selectionCheckpoint?.remainingControls ?? 0;

      await copyLatestLoopArtifacts(rootOutDir, lastResult);

      if (!insertReport.selectionCheckpoint || insertReport.selectionCheckpoint.exhausted) {
        completionReason = 'exhausted';
        loopDocument.status = 'completed';
        loopDocument.completionReason = completionReason;
        loopDocument.nextResumeReportPath = undefined;
        break;
      }

      resumeReportPath = lastResult.insertReportPath;
      loopDocument.nextResumeReportPath = resumeReportPath;
      await writeHarvestLoopDocument(loopManifestPath, loopDocument);
    } catch (error) {
      chunkRecord.status = 'failed';
      chunkRecord.completedAt = new Date().toISOString();
      chunkRecord.error = error instanceof Error ? error.message : String(error);
      loopDocument.status = 'failed';
      loopDocument.completionReason = 'failed';
      loopDocument.latestInsertReportPath = lastResult?.insertReportPath ?? resumeReportPath;
      loopDocument.nextResumeReportPath = lastResult?.insertReportPath ?? resumeReportPath;
      loopDocument.error = chunkRecord.error;
      await writeHarvestLoopDocument(loopManifestPath, loopDocument);
      throw error;
    }
  }

  if (lastResult) {
    await copyLatestLoopArtifacts(rootOutDir, lastResult, completionReason === 'exhausted');
  }

  if (lastResult && completionReason === 'exhausted') {
    const aggregatedRegistry = await buildAggregatedHarvestLoopRegistry(loopDocument);
    assertResult(aggregatedRegistry, 'Expected at least one completed chunk before promoting the final loop registry.');
    await writeJsonFile(join(rootOutDir, 'canvas-registry.json'), aggregatedRegistry as unknown as Parameters<typeof writeJsonFile>[1]);
    await mkdir(dirname(rootRegistryOutPath), { recursive: true }).catch(() => undefined);
    await writeJsonFile(rootRegistryOutPath, aggregatedRegistry as unknown as Parameters<typeof writeJsonFile>[1]);
    process.stdout.write(`Promoted aggregated loop registry to ${rootRegistryOutPath}\n`);
  } else if (lastResult) {
    process.stdout.write(
      `Leaving ${rootRegistryOutPath} untouched because the catalog loop stopped before exhausting the selected controls.\n`
    );
  }

  await writeHarvestLoopDocument(loopManifestPath, loopDocument);
  process.stdout.write(
    `Catalog harvest loop ${loopDocument.status} after ${loopDocument.chunks.length} chunk` +
      `${loopDocument.chunks.length === 1 ? '' : 's'}.\n`
  );
  process.stdout.write(`Loop manifest: ${loopManifestPath}\n`);
  if (loopDocument.nextResumeReportPath) {
    process.stdout.write(`Next resume report: ${loopDocument.nextResumeReportPath}\n`);
  }
}

function buildHarvestLoopChunkOptions(
  options: CliOptions,
  input: {
    chunkOutDir: string;
    chunkIndex: number;
    catalogPath?: string;
    resumeReportPath?: string;
  }
): CliOptions {
  return {
    ...options,
    outDir: input.chunkOutDir,
    registryOut: join(input.chunkOutDir, 'project-canvas-controls.json'),
    catalogJson: input.catalogPath ?? options.catalogJson,
    catalogResumeReport: input.resumeReportPath,
    catalogFamily: input.resumeReportPath ? undefined : options.catalogFamily,
    catalogStartAt: input.resumeReportPath ? undefined : options.catalogStartAt,
    catalogLimit: input.resumeReportPath ? undefined : options.catalogLimit,
    catalogLoop: false,
    catalogMaxChunks: undefined,
    resetSolutionZip: options.resetSolutionZip,
  };
}

async function writeHarvestLoopDocument(path: string, document: HarvestLoopDocument): Promise<void> {
  await writeJsonFile(path, document as unknown as Parameters<typeof writeJsonFile>[1]);
}

async function readHarvestLoopDocument(path: string): Promise<HarvestLoopDocument> {
  return JSON.parse(await readFile(path, 'utf8')) as HarvestLoopDocument;
}

async function readInsertReportDocument(path: string): Promise<CanvasControlInsertReportDocument> {
  return JSON.parse(await readFile(path, 'utf8')) as CanvasControlInsertReportDocument;
}

async function buildAggregatedHarvestLoopRegistry(loopDocument: HarvestLoopDocument): Promise<CanvasTemplateRegistryDocument | undefined> {
  const completedChunks = loopDocument.chunks.filter(
    (chunk): chunk is HarvestLoopChunkRecord & { registryPath: string } => chunk.status === 'completed' && Boolean(chunk.registryPath)
  );

  if (completedChunks.length === 0) {
    return undefined;
  }

  const templates = new Map<string, CanvasTemplateRecord>();
  const supportMatrix = new Map<string, CanvasSupportMatrixEntry>();

  for (const chunk of completedChunks) {
    const document = JSON.parse(await readFile(resolve(chunk.registryPath), 'utf8')) as CanvasTemplateRegistryDocument;

    for (const template of document.templates) {
      const key = `${template.templateName}@${template.templateVersion}`;
      const existing = templates.get(key);
      if (!existing || isRicherTemplateRecord(template, existing)) {
        templates.set(key, template);
      }
    }

    for (const entry of document.supportMatrix) {
      const key = `${entry.templateName}@${entry.version}`;
      const existing = supportMatrix.get(key);
      supportMatrix.set(key, mergeSupportMatrixEntry(existing, entry));
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    templates: [...templates.values()].sort(compareTemplateRegistryRecords),
    supportMatrix: [...supportMatrix.values()].sort(compareSupportMatrixEntries),
  };
}

function isRicherTemplateRecord(candidate: CanvasTemplateRecord, existing: CanvasTemplateRecord): boolean {
  const candidateScore = JSON.stringify(candidate.files ?? {}).length + JSON.stringify(candidate.aliases ?? {}).length;
  const existingScore = JSON.stringify(existing.files ?? {}).length + JSON.stringify(existing.aliases ?? {}).length;

  if (candidateScore !== existingScore) {
    return candidateScore > existingScore;
  }

  return JSON.stringify(candidate.provenance ?? {}).length > JSON.stringify(existing.provenance ?? {}).length;
}

function mergeSupportMatrixEntry(
  existing: CanvasSupportMatrixEntry | undefined,
  incoming: CanvasSupportMatrixEntry
): CanvasSupportMatrixEntry {
  if (!existing) {
    return incoming;
  }

  const modes = [...new Set([...(existing.modes ?? []), ...(incoming.modes ?? [])])];
  const notes = [...new Set([...(existing.notes ?? []), ...(incoming.notes ?? [])])];

  return {
    templateName: existing.templateName,
    version: existing.version,
    status: pickStrongerSupportStatus(existing.status, incoming.status),
    ...(modes.length > 0 ? { modes } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function pickStrongerSupportStatus(
  left: CanvasSupportMatrixEntry['status'],
  right: CanvasSupportMatrixEntry['status']
): CanvasSupportMatrixEntry['status'] {
  const rank: Record<CanvasSupportMatrixEntry['status'], number> = {
    unsupported: 0,
    partial: 1,
    supported: 2,
  };

  return rank[right] > rank[left] ? right : left;
}

function compareTemplateRegistryRecords(left: CanvasTemplateRecord, right: CanvasTemplateRecord): number {
  const byName = left.templateName.localeCompare(right.templateName);
  return byName !== 0 ? byName : left.templateVersion.localeCompare(right.templateVersion);
}

function compareSupportMatrixEntries(left: CanvasSupportMatrixEntry, right: CanvasSupportMatrixEntry): number {
  const byName = left.templateName.localeCompare(right.templateName);
  return byName !== 0 ? byName : left.version.localeCompare(right.version);
}

function buildInitialHarvestLoopDocument(options: CliOptions, rootOutDir: string, rootRegistryOutPath: string): HarvestLoopDocument {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    envAlias: options.envAlias,
    solutionUniqueName: options.solutionUniqueName,
    rootOutDir,
    registryOutPath: rootRegistryOutPath,
    status: 'running',
    ...(options.catalogJson ? { catalogPath: resolve(options.catalogJson) } : {}),
    ...(options.catalogMaxChunks ? { maxChunks: options.catalogMaxChunks } : {}),
    chunks: [],
  };
}

function resetHarvestLoopDocumentForResume(document: HarvestLoopDocument, options: CliOptions): HarvestLoopDocument {
  return {
    ...document,
    generatedAt: new Date().toISOString(),
    status: 'running',
    completionReason: undefined,
    error: undefined,
    maxChunks: options.catalogMaxChunks,
  };
}

function assertResumeOptionMatches(flag: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`${flag} ${actual} does not match the existing loop manifest value ${expected}.`);
  }
}

export async function resolveHarvestLoopRunState(options: CliOptions): Promise<HarvestLoopRunState> {
  if (!options.catalogResumeLoop) {
    const rootOutDir = resolve(options.outDir);
    const rootRegistryOutPath = resolve(options.registryOut);

    return {
      options,
      loopManifestPath: join(rootOutDir, 'canvas-harvest-loop.json'),
      rootOutDir,
      rootRegistryOutPath,
      catalogPath: options.catalogJson ? resolve(options.catalogJson) : undefined,
      resumeReportPath: options.catalogResumeReport ? resolve(options.catalogResumeReport) : undefined,
      nextChunkIndex: 1,
      loopDocument: buildInitialHarvestLoopDocument(options, rootOutDir, rootRegistryOutPath),
    };
  }

  const requestedManifestPath = resolve(options.catalogResumeLoop);
  const existingDocument = await readHarvestLoopDocument(requestedManifestPath);
  const rootOutDir = resolve(existingDocument.rootOutDir);
  const loopManifestPath = join(rootOutDir, 'canvas-harvest-loop.json');

  if (requestedManifestPath !== loopManifestPath) {
    throw new Error(
      `Catalog loop manifest ${requestedManifestPath} does not match its recorded root output directory. Resume from ${loopManifestPath} instead.`
    );
  }

  if (existingDocument.status === 'completed' || existingDocument.completionReason === 'exhausted') {
    throw new Error('Catalog loop manifest is already exhausted; there is no remaining chunk to resume.');
  }

  if (!existingDocument.nextResumeReportPath) {
    throw new Error('Catalog loop manifest does not record a next resume report path.');
  }

  const rootRegistryOutPath = resolve(existingDocument.registryOutPath);
  const catalogPath = existingDocument.catalogPath
    ? resolve(existingDocument.catalogPath)
    : options.catalogJson
      ? resolve(options.catalogJson)
      : undefined;

  if (options.outDirExplicit) {
    assertResumeOptionMatches('--out-dir', resolve(options.outDir), rootOutDir);
  }

  if (options.registryOutExplicit) {
    assertResumeOptionMatches('--registry-out', resolve(options.registryOut), rootRegistryOutPath);
  }

  if (options.catalogJsonExplicit) {
    if (existingDocument.catalogPath) {
      assertResumeOptionMatches('--catalog-json', resolve(options.catalogJson!), resolve(existingDocument.catalogPath));
    }
  }

  if (!catalogPath) {
    throw new Error('Catalog loop manifest does not record a catalog path. Pass --catalog-json explicitly or start a fresh loop.');
  }

  if (options.envAliasExplicit) {
    assertResumeOptionMatches('--env', options.envAlias, existingDocument.envAlias);
  }

  if (options.solutionUniqueNameExplicit) {
    assertResumeOptionMatches('--solution', options.solutionUniqueName, existingDocument.solutionUniqueName);
  }

  const normalizedOptions: CliOptions = {
    ...options,
    envAlias: existingDocument.envAlias,
    solutionUniqueName: existingDocument.solutionUniqueName,
    outDir: rootOutDir,
    registryOut: rootRegistryOutPath,
    catalogJson: catalogPath,
  };

  return {
    options: normalizedOptions,
    loopManifestPath,
    rootOutDir,
    rootRegistryOutPath,
    catalogPath,
    resumeReportPath: resolve(existingDocument.nextResumeReportPath),
    nextChunkIndex: existingDocument.chunks.length + 1,
    loopDocument: resetHarvestLoopDocumentForResume(existingDocument, normalizedOptions),
  };
}

async function copyLatestLoopArtifacts(rootOutDir: string, result: HarvestRunResult, completed = false): Promise<void> {
  await copyFile(result.registryPath, join(rootOutDir, completed ? 'canvas-registry.json' : 'latest-canvas-registry.json'));
  await copyFile(
    result.summaryPath,
    join(rootOutDir, completed ? 'canvas-harvest-summary.json' : 'latest-canvas-harvest-summary.json')
  );
  await copyFile(result.appInfoPath, join(rootOutDir, completed ? 'canvas-app.json' : 'latest-canvas-app.json'));

  if (completed) {
    await copyFile(result.registryPath, join(rootOutDir, 'latest-canvas-registry.json'));
    await copyFile(result.summaryPath, join(rootOutDir, 'latest-canvas-harvest-summary.json'));
    await copyFile(result.appInfoPath, join(rootOutDir, 'latest-canvas-app.json'));
  }
}

function formatHarvestChunkLabel(index: number): string {
  return `chunk-${String(index).padStart(3, '0')}`;
}

async function runStudioSession(inputOptions: {
  options: CliOptions;
  environment: EnvironmentAlias;
  authService: AuthService;
  authProfile: AuthProfile;
  studioUrl: string;
  outDir: string;
  screenDir: string;
  catalogPath?: string;
  fixtureContainerName: string;
}): Promise<PlaywrightSessionResult> {
  const ensured = await ensureBrowserProfile(inputOptions);
  await ensureBrowserAuthenticated({
    authService: inputOptions.authService,
    authProfile: inputOptions.authProfile,
    environment: inputOptions.environment,
    browserProfile: ensured.browserProfile,
    forcePrompt: ensured.created || inputOptions.options.forceBrowserAuth,
    options: inputOptions.options,
  });
  const browserProfileDir = resolveBrowserProfileDirectory(ensured.browserProfile, {
    configDir: inputOptions.options.configDir,
  });

  await mkdir(browserProfileDir, { recursive: true });
  const insertReportPath = inputOptions.catalogPath ? join(inputOptions.outDir, 'canvas-control-insert-report.json') : undefined;
  runStudioApplyHelper({
    browserProfileDir,
    studioUrl: inputOptions.studioUrl,
    yamlDir: inputOptions.screenDir,
    browserKind: ensured.browserProfile.kind,
    browserCommand: ensured.browserProfile.command,
    browserArgs: ensured.browserProfile.args ?? [],
    timeoutMs: inputOptions.options.timeoutMs,
    publish: !inputOptions.options.skipPublish,
    catalogPath: inputOptions.catalogPath,
    fixtureContainerName: inputOptions.fixtureContainerName,
    insertReportPath,
    catalogResumeReportPath: inputOptions.options.catalogResumeReport
      ? resolve(inputOptions.options.catalogResumeReport)
      : undefined,
    catalogFamily: inputOptions.options.catalogFamily,
    catalogStartAt: inputOptions.options.catalogStartAt,
    catalogLimit: inputOptions.options.catalogLimit,
    includeRetired: inputOptions.options.includeRetired,
    settleMs: inputOptions.options.settleMs,
    debug: inputOptions.options.debugBrowser,
    headless: inputOptions.options.headless,
    slowMoMs: inputOptions.options.slowMoMs,
  });

  return {
    browserProfile: ensured.browserProfile,
    studioUrl: inputOptions.studioUrl,
    catalogPath: inputOptions.catalogPath,
    catalogResumeReportPath: inputOptions.options.catalogResumeReport
      ? resolve(inputOptions.options.catalogResumeReport)
      : undefined,
    insertReportPath,
  };
}

function runStudioApplyHelper(input: {
  browserProfileDir: string;
  studioUrl: string;
  yamlDir: string;
  browserKind: BrowserProfile['kind'];
  browserCommand?: string;
  browserArgs: string[];
  timeoutMs: number;
  publish: boolean;
  catalogPath?: string;
  fixtureContainerName: string;
  insertReportPath?: string;
  catalogResumeReportPath?: string;
  catalogFamily?: 'classic' | 'modern';
  catalogStartAt?: string;
  catalogLimit?: number;
  includeRetired: boolean;
  settleMs: number;
  debug: boolean;
  headless: boolean;
  slowMoMs: number;
}): void {
  const pnpmArgs = [
    'exec',
    'tsx',
    resolve('scripts/canvas-studio-apply.ts'),
    '--studio-url',
    input.studioUrl,
    '--browser-profile-dir',
    input.browserProfileDir,
    '--browser-kind',
    input.browserKind,
    '--yaml-dir',
    input.yamlDir,
    '--timeout-ms',
    String(input.timeoutMs),
    '--fixture-container-name',
    input.fixtureContainerName,
    '--settle-ms',
    String(input.settleMs),
    '--slow-mo-ms',
    String(input.slowMoMs),
  ];

  if (!input.publish) {
    pnpmArgs.push('--skip-publish');
  }

  if (input.browserCommand) {
    pnpmArgs.push('--browser-command', input.browserCommand);
  }

  for (const browserArg of input.browserArgs) {
    pnpmArgs.push('--browser-arg', browserArg);
  }

  if (input.catalogPath) {
    pnpmArgs.push('--catalog-json', input.catalogPath);
  }

  if (input.insertReportPath) {
    pnpmArgs.push('--insert-report', input.insertReportPath);
  }

  if (input.catalogResumeReportPath) {
    pnpmArgs.push('--catalog-resume-report', input.catalogResumeReportPath);
  }

  if (input.catalogFamily) {
    pnpmArgs.push('--catalog-family', input.catalogFamily);
  }

  if (input.catalogStartAt) {
    pnpmArgs.push('--catalog-start-at', input.catalogStartAt);
  }

  if (input.catalogLimit) {
    pnpmArgs.push('--catalog-limit', String(input.catalogLimit));
  }

  if (input.includeRetired) {
    pnpmArgs.push('--include-retired');
  }

  if (input.debug) {
    pnpmArgs.push('--debug');
  }

  if (input.headless) {
    pnpmArgs.push('--headless');
  }

  const requiresVirtualDisplay =
    process.platform === 'linux' &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY &&
    !process.env.HEADLESS &&
    !input.headless;
  const command = requiresVirtualDisplay ? 'xvfb-run' : 'pnpm';
  const args = requiresVirtualDisplay ? ['-a', 'pnpm', ...pnpmArgs] : pnpmArgs;

  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error(`Studio helper failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

async function ensureCatalogPath(options: CliOptions, outDir: string, existingPath?: string): Promise<string> {
  if (existingPath) {
    return existingPath;
  }

  const catalog = await fetchCanvasControlCatalogDocument();
  const outPath = join(outDir, 'canvas-control-catalog.json');
  const registryPath = resolve(options.catalogOut);

  await writeJsonFile(outPath, catalog as unknown as Parameters<typeof writeJsonFile>[1]);
  await mkdir(dirname(registryPath), { recursive: true }).catch(() => undefined);
  await writeJsonFile(registryPath, catalog as unknown as Parameters<typeof writeJsonFile>[1]);

  return outPath;
}

async function createFixtureYamlDirectory(outDir: string, fixtureContainerName: string): Promise<string> {
  const root = await mkdtemp(join(outDir, 'canvas-fixture-'));
  const yamlPath = join(root, `${fixtureContainerName}.pa.yaml`);

  await writeFile(
    yamlPath,
    [
      `- ${fixtureContainerName}:`,
      '    Control: GroupContainer@1.4.0',
      '    Variant: ManualLayout',
      '    Properties:',
      '      DropShadow: =DropShadow.None',
      '      Height: =320',
      '      Width: =600',
      '      X: =40',
      '      Y: =220',
      '    Children:',
      '      - HarvestFixtureText:',
      '          Control: ModernText@1.0.0',
      '          Properties:',
      '            Height: =40',
      '            Width: =220',
      '            X: =24',
      '            Y: =24',
      '      - HarvestFixtureMarker:',
      '          Control: ModernText@1.0.0',
      '          Properties:',
      '            Height: =40',
      '            Width: =240',
      '            X: =24',
      '            Y: =88',
    ].join('\n'),
    'utf8'
  );

  return root;
}

async function createEmptyFixtureDirectory(outDir: string): Promise<string> {
  return mkdtemp(join(outDir, 'canvas-fixture-'));
}

async function ensureBrowserProfile(inputOptions: {
  options: CliOptions;
  authService: AuthService;
  authProfile: AuthProfile;
}): Promise<EnsuredBrowserProfile> {
  if (inputOptions.authProfile.type !== 'user') {
    throw new Error(
      `Canvas Studio automation requires a user auth profile. ${inputOptions.authProfile.name} is ${inputOptions.authProfile.type}.`
    );
  }

  const userProfile = inputOptions.authProfile as Extract<UserAuthProfile, { type: 'user' }>;
  const profileName =
    inputOptions.options.browserProfileName ?? userProfile.browserProfile ?? `${inputOptions.options.envAlias}-canvas-harvest`;
  const existing = await inputOptions.authService.getBrowserProfile(profileName);

  let browserProfile = existing.success ? existing.data : undefined;
  let created = false;

  if (!browserProfile) {
    browserProfile = {
      name: profileName,
      kind: inputOptions.options.browserKind,
      command: inputOptions.options.browserCommand,
      args: inputOptions.options.browserArgs.length > 0 ? inputOptions.options.browserArgs : undefined,
    };

    const saved = await inputOptions.authService.saveBrowserProfile(browserProfile);
    assertResult(saved.success && saved.data, `Failed to save browser profile ${profileName}.`);
    browserProfile = saved.data;
    created = true;
  }

  if (userProfile.browserProfile !== profileName) {
    const savedProfile = await inputOptions.authService.saveProfile({
      ...userProfile,
      browserProfile: profileName,
    });
    assertResult(savedProfile.success, `Failed to attach browser profile ${profileName} to auth profile ${userProfile.name}.`);
  }

  return {
    browserProfile,
    created,
  };
}

async function ensureBrowserAuthenticated(inputOptions: {
  authService: AuthService;
  authProfile: AuthProfile;
  environment: EnvironmentAlias;
  browserProfile: BrowserProfile;
  forcePrompt: boolean;
  options: CliOptions;
}): Promise<void> {
  if (inputOptions.options.skipBrowserAuth) {
    return;
  }

  if (inputOptions.authProfile.type !== 'user') {
    throw new Error(
      `Browser-authenticated Studio automation requires a user auth profile. ${inputOptions.authProfile.name} is ${inputOptions.authProfile.type}.`
    );
  }

  const userProfile = {
    ...inputOptions.authProfile,
    browserProfile: inputOptions.browserProfile.name,
  } satisfies Extract<UserAuthProfile, { type: 'user' }>;
  const login = await inputOptions.authService.loginProfile(userProfile, inputOptions.environment.url, {
    preferredFlow: 'interactive',
    forcePrompt: inputOptions.forcePrompt,
  });

  assertResult(login.success, `Failed to authenticate browser profile ${inputOptions.browserProfile.name} for Studio.`);

  if (inputOptions.options.interactive) {
    await prompt(
      'Browser authentication completed. If an auth browser window is still open, close it now so Playwright can reuse the same profile directory, then press Enter to continue.'
    );
  }
}

function buildLaunchOptions(browserProfile: BrowserProfile, options: CliOptions): Parameters<typeof chromium.launchPersistentContext>[1] {
  const args = [
    '--no-first-run',
    '--new-window',
    ...(options.debugBrowser ? ['--auto-open-devtools-for-tabs'] : []),
    ...(browserProfile.args ?? []),
  ];
  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless: !options.debugBrowser && options.headless,
    slowMo: options.debugBrowser ? options.slowMoMs : undefined,
    viewport: null,
    args,
  };

  if (browserProfile.command) {
    launchOptions.executablePath = browserProfile.command;
    return launchOptions;
  }

  switch (browserProfile.kind) {
    case 'edge':
      launchOptions.channel = 'msedge';
      break;
    case 'chrome':
      launchOptions.channel = 'chrome';
      break;
    case 'chromium':
      launchOptions.executablePath = 'chromium';
      break;
    case 'custom':
      throw new Error(`Browser profile ${browserProfile.name} requires a command because kind=custom.`);
  }

  return launchOptions;
}

async function getOrCreatePage(context: BrowserContext): Promise<Page> {
  return pageFromContext(context) ?? context.newPage();
}

async function waitForStudioSurface(
  page: Page,
  authProfile: AuthProfile,
  browserProfileName: string,
  studioUrl: string,
  options: CliOptions
): Promise<Frame> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    const studioFrame = page.frames().find((candidate) => candidate.name() === 'EmbeddedStudio');

    if (studioFrame) {
      if (!(await isStudioHostLoading(page)) && (await isStudioSurfaceVisible(studioFrame)) && isStudioUrl(page.url())) {
        return studioFrame;
      }
    }

    const handled = await maybeHandleMicrosoftLogin(page, authProfile, browserProfileName, studioUrl, options);

    if (!handled) {
      await page.waitForTimeout(1000);
      continue;
    }

    await page.waitForLoadState('domcontentloaded', {
      timeout: Math.min(options.timeoutMs, 15000),
    }).catch(() => undefined);
    await page.waitForTimeout(1500);
  }

  throw new Error(`Timed out waiting for Power Apps Studio to load. Last URL: ${page.url()}`);
}

async function pasteScreenYamlFiles(page: Page, studioFrame: Frame, options: CliOptions): Promise<void> {
  const screenDir = resolve(options.screenDir!);
  const entries = await readdir(screenDir, { withFileTypes: true });
  const screenFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.pa.yaml') && entry.name !== 'App.pa.yaml' && entry.name !== '_EditorState.pa.yaml')
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  assertResult(screenFiles.length > 0, `No screen .pa.yaml files were found in ${screenDir}.`);

  if (options.interactive) {
    await prompt(
      `Ready to paste ${screenFiles.length} screen file(s).\nKeep focus in the Studio surface. The script will write each file to the clipboard and send paste. Press Enter to start.`
    );
  }

  for (const file of screenFiles) {
    const path = join(screenDir, file);
    const rawContent = await readTextFile(path);
    const content = normalizeScreenYamlForStudio(rawContent);
    const descriptor = describeStudioYaml(content, file);

    if (descriptor.kind === 'screen' && (await isScreenPresent(studioFrame, descriptor.name))) {
      process.stdout.write(`Skipping ${file}; screen ${descriptor.name} already exists.\n`);
      continue;
    }

    process.stdout.write(`Pasting ${file} as ${descriptor.kind} ${descriptor.name}...\n`);
    const liveStudioFrame = requireEmbeddedStudioFrame(page);

    if (await dismissStudioOverlays(liveStudioFrame)) {
      await page.waitForTimeout(options.settleMs);
    }
    if (descriptor.kind === 'control') {
      await pasteControlYamlUsingProbeFlow(page, descriptor.name, content, options);
    } else {
      await pasteNamedYamlWithRetries(page, descriptor.name, content, options, {
        kind: 'screen',
      });
    }
    await page.waitForTimeout(options.settleMs);
  }
}

async function saveAndPublish(page: Page, studioFrame: Frame, options: CliOptions): Promise<void> {
  process.stdout.write(`Saving app...\n`);
  let liveStudioFrame = requireEmbeddedStudioFrame(page);

  if (await dismissStudioOverlays(liveStudioFrame)) {
    await page.waitForTimeout(options.settleMs);
  }
  await saveShortcut(page);
  await page.waitForTimeout(options.settleMs);

  if (options.skipPublish) {
    return;
  }

  process.stdout.write(`Publishing app...\n`);
  liveStudioFrame = requireEmbeddedStudioFrame(page);

  if (await dismissStudioOverlays(liveStudioFrame)) {
    await page.waitForTimeout(options.settleMs);
  }

  const published =
    (await clickAny([
      liveStudioFrame.locator('#commandBar_publish'),
      liveStudioFrame.getByRole('button', { name: /Publish/i }),
      liveStudioFrame.getByRole('button', { name: /Publish this version/i }),
      liveStudioFrame.getByRole('menuitem', { name: /^Publish$/i }),
      liveStudioFrame.getByText(/^Publish$/i).first(),
      liveStudioFrame.getByText(/Publish this version/i).first(),
    ])) ||
    (await openFileMenuAndPublish(liveStudioFrame));

  if (!published) {
    if (!options.interactive) {
      throw new Error('Could not find a publish button in Studio.');
    }

    await prompt('Studio publish controls were not located automatically. Publish the app manually, then press Enter to continue.');
    return;
  }

  await page.waitForTimeout(options.settleMs);
  liveStudioFrame = requireEmbeddedStudioFrame(page);
  await clickAny([
    liveStudioFrame.locator('#commandBar_publish'),
    liveStudioFrame.getByRole('button', { name: /Publish/i }),
    liveStudioFrame.getByRole('button', { name: /Publish this version/i }),
    liveStudioFrame.getByRole('button', { name: /^Publish$/i }),
    liveStudioFrame.getByRole('button', { name: /^Confirm$/i }),
  ]);
  await page.waitForTimeout(options.settleMs * 2);
}

async function openFileMenuAndPublish(studioFrame: Frame): Promise<boolean> {
  const opened = await clickAny([
    studioFrame.getByRole('button', { name: /^File$/i }),
    studioFrame.getByRole('tab', { name: /^File$/i }),
    studioFrame.getByText(/^File$/i).first(),
  ]);

  if (!opened) {
    return false;
  }

  await studioFrame.page().waitForTimeout(1000);
  return clickAny([
    studioFrame.locator('#commandBar_publish'),
    studioFrame.getByRole('button', { name: /Publish/i }),
    studioFrame.getByRole('button', { name: /Publish this version/i }),
    studioFrame.getByRole('menuitem', { name: /^Publish$/i }),
    studioFrame.getByText(/^Publish$/i).first(),
    studioFrame.getByText(/Publish this version/i).first(),
  ]);
}

async function clickAny(locators: Locator[]): Promise<boolean> {
  for (const locator of locators) {
    const candidate = locator.first();

    try {
      if (await candidate.isVisible({ timeout: 1000 })) {
        await candidate.click({ timeout: 5000 });
        return true;
      }
    } catch {
      // Try the next locator.
    }
  }

  return false;
}

async function maybeHandleMicrosoftLogin(
  page: Page,
  authProfile: AuthProfile,
  browserProfileName: string,
  studioUrl: string,
  options: CliOptions
): Promise<boolean> {
  if (!(await isMicrosoftSignInPage(page)) && !isMicrosoftLoginUrl(page.url())) {
    return false;
  }

  const loginHint =
    authProfile.type === 'user' || authProfile.type === 'device-code'
      ? authProfile.loginHint ?? authProfile.accountUsername
      : undefined;
  const emailInput = page.locator('input[type="email"], input[name="loginfmt"]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  if (loginHint && (await emailInput.isVisible({ timeout: 1000 }).catch(() => false))) {
    await emailInput.fill(loginHint);
    await clickAny([
      page.getByRole('button', { name: /^Next$/i }),
      page.locator('#idSIButton9'),
      page.locator('input[type="submit"]'),
    ]);
    return true;
  }

  if (loginHint) {
    const accountTile = page.getByText(loginHint, { exact: false }).first();

    if (await accountTile.isVisible({ timeout: 1000 }).catch(() => false)) {
      await accountTile.click({ timeout: 5000 });
      return true;
    }
  }

  if (
    (await passwordInput.isVisible({ timeout: 1000 }).catch(() => false)) ||
    (await page.getByText(/approve sign in request|enter code|stay signed in|verify your identity/i).first().isVisible({ timeout: 1000 }).catch(() => false))
  ) {
    if (!options.interactive) {
      throw new Error(
        `Power Apps Studio is still behind an interactive Microsoft sign-in step. Bootstrap the browser profile once with \`pp auth browser-profile bootstrap ${browserProfileName} --url '${studioUrl}'\`, or rerun with --debug-browser and without --non-interactive to complete the browser session once.`
      );
    }

    await prompt(
      'Microsoft sign-in still requires password, MFA, or a confirmation prompt. Complete it in the browser, wait for Studio to load, then press Enter to continue.'
    );
    return true;
  }

  const useAnotherAccount = page.getByText(/use another account/i).first();

  if (await useAnotherAccount.isVisible({ timeout: 1000 }).catch(() => false)) {
    await useAnotherAccount.click({ timeout: 5000 });
    return true;
  }

  return false;
}
async function isStudioSurfaceVisible(studioFrame: Frame): Promise<boolean> {
  const candidates: Locator[] = [
    studioFrame.locator('[title="Screen1"]').first(),
    studioFrame.locator('[title^="Screen"]').first(),
    studioFrame.locator('[role="checkbox"][title^="Screen"]').first(),
    studioFrame.locator('[role="treeitem"][title]').first(),
  ];

  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function dismissStudioOverlays(studioFrame: Frame): Promise<boolean> {
  let dismissedAny = false;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const dismissed = await clickAny([
      studioFrame.getByRole('button', { name: /^Skip$/i }),
      studioFrame.getByRole('button', { name: /^Override$/i }),
      studioFrame.getByRole('button', { name: /^Got it$/i }),
      studioFrame.getByRole('button', { name: /^Close$/i }),
      studioFrame.getByRole('button', { name: /^Dismiss$/i }),
      studioFrame.getByRole('button', { name: /^Done$/i }),
      studioFrame.getByText(/^Skip$/i).first(),
      studioFrame.locator('[aria-label="Close"]').first(),
      studioFrame.locator('[data-icon-name="Cancel"]').first(),
    ]);

    if (!dismissed) {
      break;
    }

    dismissedAny = true;
    await studioFrame.page().waitForTimeout(1000);
  }

  return dismissedAny;
}

async function isStudioHostLoading(page: Page): Promise<boolean> {
  const loadingLocators: Locator[] = [
    page.getByText(/^Loading/i).first(),
    page.getByText(/Loading \.\.\./i).first(),
  ];

  for (const locator of loadingLocators) {
    if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function isMicrosoftSignInPage(page: Page): Promise<boolean> {
  const signInLocators: Locator[] = [
    page.getByRole('heading', { name: /^Sign in$/i }),
    page.locator('input[type="email"], input[name="loginfmt"]'),
    page.locator('input[type="password"]'),
    page.getByText(/sign-in options/i),
    page.getByText(/stay signed in/i),
    page.getByText(/verify your identity/i),
  ];

  for (const locator of signInLocators) {
    if (await locator.first().isVisible({ timeout: 500 }).catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function focusPasteAnchorScreen(studioFrame: Frame): Promise<void> {
  const candidates: Locator[] = [
    studioFrame.locator('[title="Screen1"]').first(),
    studioFrame.locator('[title^="Screen"]').first(),
    studioFrame.locator('[role="checkbox"][title^="Screen"]').first(),
    studioFrame.locator('[role="treeitem"][aria-level="1"][title]').first(),
    studioFrame.locator('[role="treeitem"][title]').first(),
  ];

  for (const locator of candidates) {
    try {
      const candidate = locator.first();
      if (await candidate.isVisible({ timeout: 500 })) {
        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.click({ force: true, timeout: 5000 });
        return;
      }
    } catch {
      // Try the next locator.
    }
  }

  throw new Error('Could not find a screen node to target for screen YAML paste.');
}

async function pasteNamedYamlWithRetries(
  page: Page,
  itemName: string,
  content: string,
  options: CliOptions,
  descriptor: Pick<StudioYamlDescriptor, 'kind'>
): Promise<void> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const liveStudioFrame = requireEmbeddedStudioFrame(page);

    await page.evaluate(async (text) => {
      const clipboard = (navigator as Navigator & {
        clipboard?: {
          writeText?: (value: string) => Promise<void>;
        };
      }).clipboard;
      if (!clipboard?.writeText) {
        throw new Error('Clipboard API is unavailable in the current browser context.');
      }
      await clipboard.writeText(text);
    }, content);
    await focusPasteAnchorScreen(liveStudioFrame);
    await page.waitForTimeout(500);
    await pasteShortcut(page);
    await page.waitForTimeout(Math.min(options.settleMs, 5000));

    if (
      descriptor.kind === 'screen'
        ? await isScreenPresent(liveStudioFrame, itemName)
        : await isControlPresent(liveStudioFrame, itemName)
    ) {
      return;
    }

    process.stdout.write(`Paste attempt ${attempt} for ${descriptor.kind} ${itemName} did not register.\n`);
    await dismissStudioOverlays(liveStudioFrame);
    await page.waitForTimeout(1500);
  }

  if (descriptor.kind === 'screen') {
    await waitForScreenToAppear(requireEmbeddedStudioFrame(page), itemName, options.timeoutMs);
    return;
  }

  await waitForControlToAppear(requireEmbeddedStudioFrame(page), itemName, options.timeoutMs);
}

async function pasteControlYamlUsingProbeFlow(
  page: Page,
  controlName: string,
  content: string,
  options: CliOptions
): Promise<void> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const studioFrame = requireEmbeddedStudioFrame(page);

    await dismissStudioOverlays(studioFrame);
    await page.waitForTimeout(3000);

    const existing = studioFrame.locator(`[title="${controlName}"]`).first();
    if (await existing.isVisible({ timeout: 1000 }).catch(() => false)) {
      await existing.click({ timeout: 5000, force: true });
      await page.waitForTimeout(500);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(2000);
    }

    await page.evaluate(async (text) => {
      const clipboard = (navigator as Navigator & {
        clipboard?: {
          writeText?: (value: string) => Promise<void>;
        };
      }).clipboard;
      if (!clipboard?.writeText) {
        throw new Error('Clipboard API is unavailable in the current browser context.');
      }
      await clipboard.writeText(text);
    }, content);

    const screenNode = studioFrame.locator('[title="Screen1"]').first();
    await screenNode.click({ timeout: 5000, force: true });
    await page.waitForTimeout(500);
    await pasteShortcut(page);
    await page.waitForTimeout(5000);

    if (await isControlPresent(studioFrame, controlName)) {
      return;
    }

    process.stdout.write(`Paste attempt ${attempt} for control ${controlName} did not register.\n`);
  }

  await waitForControlToAppear(requireEmbeddedStudioFrame(page), controlName, options.timeoutMs);
}

function normalizeScreenYamlForStudio(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const stripped = [...lines];

  while (stripped.length > 0) {
    const line = stripped[0];
    if (!line || line.trim() === '') {
      stripped.shift();
      continue;
    }

    if (line.startsWith('#')) {
      stripped.shift();
      continue;
    }

    break;
  }

  return `${stripped.join('\n').trimEnd()}\n`;
}

function describeStudioYaml(content: string, fallbackFileName: string): StudioYamlDescriptor {
  const trimmed = content.trimStart();

  if (trimmed.startsWith('Screens:')) {
    const match = content.match(/^\s{2}([A-Za-z_][\w]*)\s*:\s*$/m);
    if (match?.[1]) {
      return {
        kind: 'screen',
        name: match[1],
      };
    }

    return {
      kind: 'screen',
      name: fallbackFileName.replace(/\.pa\.yaml$/i, ''),
    };
  }

  const match = content.match(/^\s*-\s*([A-Za-z_][\w]*)\s*:\s*$/m);
  if (match?.[1]) {
    return {
      kind: 'control',
      name: match[1],
    };
  }

  throw new Error(`Could not determine whether ${fallbackFileName} is a screen or control YAML document.`);
}

async function isScreenPresent(studioFrame: Frame, screenName: string): Promise<boolean> {
  return studioFrame.locator(`[title="${screenName}"]`).first().isVisible({ timeout: 500 }).catch(() => false);
}

async function isControlPresent(studioFrame: Frame, controlName: string): Promise<boolean> {
  return studioFrame.locator(`[title="${controlName}"]`).first().isVisible({ timeout: 500 }).catch(() => false);
}

async function waitForScreenToAppear(studioFrame: Frame, screenName: string, timeoutMs: number): Promise<void> {
  await studioFrame.locator(`[title="${screenName}"]`).first().waitFor({
    state: 'visible',
    timeout: timeoutMs,
  });
}

async function waitForControlToAppear(studioFrame: Frame, controlName: string, timeoutMs: number): Promise<void> {
  await studioFrame.locator(`[title="${controlName}"]`).first().waitFor({
    state: 'visible',
    timeout: timeoutMs,
  });
}

function requireEmbeddedStudioFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => candidate.name() === 'EmbeddedStudio');

  if (!frame) {
    throw new Error('Could not resolve the EmbeddedStudio frame.');
  }

  return frame;
}

async function grantClipboardPermissions(page: Page): Promise<void> {
  const currentUrl = page.url();

  if (!currentUrl.startsWith('http')) {
    return;
  }

  const origin = new URL(currentUrl).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin,
  });
}

async function saveShortcut(page: Page): Promise<void> {
  await page.keyboard.press(shortcutKey('S'));
}

async function pasteShortcut(page: Page): Promise<void> {
  await page.keyboard.press(shortcutKey('V'));
}

function shortcutKey(key: string): string {
  return `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`;
}

function isMicrosoftLoginUrl(value: string): boolean {
  try {
    const host = new URL(value).host.toLowerCase();
    return (
      host === 'login.microsoftonline.com' ||
      host.endsWith('.login.microsoftonline.com') ||
      host === 'login.live.com' ||
      host === 'login.microsoft.com'
    );
  } catch {
    return false;
  }
}

function isStudioUrl(value: string): boolean {
  try {
    const host = new URL(value).host.toLowerCase();
    return host.includes('powerapps.com') && !isMicrosoftLoginUrl(value);
  } catch {
    return false;
  }
}

async function resolveCanvasAppRecord(client: DataverseClient, options: CliOptions): Promise<CanvasAppRecord> {
  const query = await client.queryAll<CanvasAppRecord>({
    table: 'canvasapps',
    select: [
      'canvasappid',
      'displayname',
      'name',
      'appopenuri',
      'appversion',
      'createdbyclientversion',
      'lastpublishtime',
      'status',
      'tags',
    ],
  });

  assertResult(query.success && query.data, 'Failed to query canvas apps from Dataverse.');

  const records = query.data;
  const filtered = records.filter((record) => {
    if (options.appId && record.canvasappid !== options.appId) {
      return false;
    }

    if (options.appName && record.name !== options.appName) {
      return false;
    }

    if (options.appDisplayName && record.displayname !== options.appDisplayName) {
      return false;
    }

    return true;
  });

  assertResult(filtered.length > 0, 'No canvas app matched the provided app selector.');
  assertResult(filtered.length === 1, 'Multiple canvas apps matched. Refine the selector with --app-id or --app-name.');

  const matchedRecord = filtered[0];
  assertResult(matchedRecord, 'No canvas app matched the provided app selector.');
  return matchedRecord;
}

async function exportSolution(
  client: DataverseClient,
  solutionUniqueName: string
): Promise<{
  ExportSolutionFile: string;
}> {
  const exported = await client.requestJson<{
    ExportSolutionFile?: string;
  }>({
    path: 'ExportSolution',
    method: 'POST',
    body: {
      SolutionName: solutionUniqueName,
      Managed: false,
    },
    responseType: 'json',
  });

  assertResult(exported.success && exported.data?.ExportSolutionFile, `Failed to export solution ${solutionUniqueName}.`);

  return {
    ExportSolutionFile: exported.data.ExportSolutionFile,
  };
}

async function importSolution(client: DataverseClient, zipPath: string): Promise<void> {
  const customizationFile = await readFile(zipPath, 'base64');
  const imported = await client.requestJson({
    path: 'ImportSolution',
    method: 'POST',
    body: {
      CustomizationFile: customizationFile,
      ImportJobId: randomUUID(),
      OverwriteUnmanagedCustomizations: true,
      PublishWorkflows: true,
    },
    responseType: 'json',
  });

  assertResult(imported.success, `Failed to import solution from ${zipPath}.`);
}

function unzipArchive(sourcePath: string, outDir: string): void {
  const result = spawnSync('unzip', ['-o', sourcePath, '-d', outDir], {
    encoding: 'utf8',
  });

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`unzip failed for ${sourcePath}\n${(result.stderr || result.stdout).trim() || '<no output>'}`);
  }
}

async function resolveCanvasMsappPath(solutionDir: string, appRecord?: CanvasAppRecord): Promise<string> {
  const canvasAppsDir = join(solutionDir, 'CanvasApps');
  const entries = await readdir(canvasAppsDir, { withFileTypes: true });
  const msappFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.msapp'))
    .map((entry) => entry.name);

  assertResult(msappFiles.length > 0, `No canvas app artifact was found under ${canvasAppsDir}.`);

  if (msappFiles.length === 1) {
    const msappFile = msappFiles[0];
    assertResult(msappFile, `No canvas app artifact was found under ${canvasAppsDir}.`);
    return join(canvasAppsDir, msappFile);
  }

  if (appRecord?.name) {
    const matched = msappFiles.find((file) => file.startsWith(`${appRecord.name}_`));

    if (matched) {
      return join(canvasAppsDir, matched);
    }
  }

  throw new Error(`Multiple .msapp files were found under ${canvasAppsDir}. Refine app selection.`);
}

export function parseArgs(argv: string[]): CliOptions {
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const readMany = (name: string): string[] => {
    const values: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
      const value = argv[index + 1];
      if (argv[index] === name && value) {
        values.push(value);
      }
    }

    return values;
  };
  const has = (name: string): boolean => argv.includes(name);
  const fixtureManifest = resolveFixtureManifest(argv);
  const interactive = !has('--non-interactive') && Boolean(process.stdin.isTTY);
  const envAliasExplicit = has('--env');
  const solutionUniqueNameExplicit = has('--solution');
  const outDirExplicit = has('--out-dir');
  const registryOutExplicit = has('--registry-out');
  const catalogJsonExplicit = has('--catalog-json');
  const catalogFamily = readCatalogFamilyArg(read('--catalog-family'));
  const catalogResumeReport = read('--catalog-resume-report');
  const catalogResumeLoop = read('--catalog-resume-loop');
  const catalogStartAt = read('--catalog-start-at');
  const catalogLimit = readPositiveIntegerArg(argv, '--catalog-limit');
  const catalogLoop = has('--catalog-loop');
  const catalogMaxChunks = readPositiveIntegerArg(argv, '--catalog-max-chunks');
  const allControls = has('--all-controls');

  if (!allControls && (catalogResumeReport || catalogResumeLoop || catalogFamily || catalogStartAt || catalogLimit)) {
    throw new Error(
      '--catalog-resume-report, --catalog-resume-loop, --catalog-family, --catalog-start-at, and --catalog-limit require --all-controls.'
    );
  }

  if (!allControls && (catalogLoop || catalogMaxChunks)) {
    throw new Error('--catalog-loop and --catalog-max-chunks require --all-controls.');
  }

  if (catalogResumeReport && (catalogResumeLoop || has('--include-retired') || catalogFamily || catalogStartAt || catalogLimit)) {
    throw new Error(
      '--catalog-resume-report cannot be combined with --catalog-resume-loop, --include-retired, --catalog-family, --catalog-start-at, or --catalog-limit.'
    );
  }

  if (catalogResumeLoop && !catalogLoop) {
    throw new Error('--catalog-resume-loop requires --catalog-loop.');
  }

  if (catalogResumeLoop && (has('--include-retired') || catalogFamily || catalogStartAt || catalogLimit)) {
    throw new Error(
      '--catalog-resume-loop cannot be combined with --include-retired, --catalog-family, --catalog-start-at, or --catalog-limit.'
    );
  }

  if (!catalogLoop && catalogMaxChunks) {
    throw new Error('--catalog-max-chunks requires --catalog-loop.');
  }

  if (catalogLoop && has('--skip-ui')) {
    throw new Error('--catalog-loop cannot be combined with --skip-ui.');
  }

  return {
    fixtureManifestPath: fixtureManifest.path,
    envAlias: read('--env') ?? fixtureManifest.document?.environmentAlias ?? 'test',
    envAliasExplicit,
    solutionUniqueName: read('--solution') ?? fixtureManifest.document?.solutionUniqueName ?? 'TEST',
    solutionUniqueNameExplicit,
    appId: read('--app-id'),
    appName: read('--app-name'),
    appDisplayName:
      read('--display-name') ??
      (read('--app-id') || read('--app-name') ? undefined : fixtureManifest.document?.appDisplayName ?? 'TEST'),
    studioUrl: read('--studio-url'),
    screenDir: read('--screen-dir') ?? fixtureManifest.document?.defaultScreenDir,
    outDir: read('--out-dir') ?? join(tmpdir(), `pp-canvas-harvest-${Date.now()}`),
    outDirExplicit,
    registryOut:
      read('--registry-out') ??
      resolve(process.cwd(), fixtureManifest.document?.registryOut ?? join('registries', 'canvas-controls.json')),
    registryOutExplicit,
    catalogOut:
      read('--catalog-out') ??
      resolve(process.cwd(), fixtureManifest.document?.catalogOut ?? join('registries', 'canvas-control-catalog.json')),
    configDir: read('--config-dir'),
    catalogJson: read('--catalog-json'),
    catalogJsonExplicit,
    catalogResumeReport,
    catalogResumeLoop,
    catalogFamily,
    catalogStartAt,
    catalogLimit,
    catalogLoop,
    catalogMaxChunks,
    resetSolutionZip: read('--reset-solution-zip'),
    browserProfileName: read('--browser-profile') ?? fixtureManifest.document?.browserProfileName,
    browserKind: normalizeBrowserKind(read('--browser-kind')),
    browserCommand: read('--browser-command'),
    browserArgs: readMany('--browser-arg'),
    debugBrowser: has('--debug-browser'),
    forceBrowserAuth: has('--force-browser-auth'),
    headless: has('--headless'),
    slowMoMs: normalizeNumber(read('--slow-mo-ms'), 250),
    skipUi: has('--skip-ui'),
    skipBrowserAuth: has('--skip-browser-auth'),
    skipPublish: has('--skip-publish'),
    interactive,
    settleMs: normalizeNumber(read('--settle-ms'), 4000),
    timeoutMs: normalizeNumber(read('--timeout-ms'), 120000),
    allControls,
    includeRetired: has('--include-retired'),
    fixtureContainerName: read('--fixture-container-name') ?? fixtureManifest.document?.fixtureContainerName ?? 'HarvestFixtureContainer',
  };
}

function resolveFixtureManifest(argv: string[]): { path?: string; document?: CanvasHarvestFixtureManifest } {
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const explicitPath = read('--fixture-manifest');
  const path = explicitPath ? resolve(explicitPath) : DEFAULT_FIXTURE_MANIFEST_PATH;

  if (!existsSync(path)) {
    if (explicitPath) {
      throw new Error(`Fixture manifest not found: ${path}`);
    }

    return {};
  }

  return {
    path,
    document: JSON.parse(readFileSync(path, 'utf8')) as CanvasHarvestFixtureManifest,
  };
}

function normalizeBrowserKind(value: string | undefined): BrowserProfile['kind'] {
  switch (value) {
    case 'chrome':
    case 'chromium':
    case 'custom':
    case 'edge':
      return value;
    default:
      return 'edge';
  }
}

function readCatalogFamilyArg(value: string | undefined): 'classic' | 'modern' | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'classic' || value === 'modern') {
    return value;
  }

  throw new Error(`Invalid --catalog-family value: ${value}. Expected classic or modern.`);
}

function readPositiveIntegerArg(argv: string[], flag: string): number | undefined {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid ${flag} value: ${value}. Expected a positive integer.`);
  }

  return parsed;
}

function normalizeNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function prompt(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

async function captureScreenshot(page: Page, path: string): Promise<void> {
  try {
    await page.screenshot({
      path,
      fullPage: true,
    });
  } catch {
    // Best effort only.
  }
}

function pageFromContext(context: BrowserContext): Page | undefined {
  return context.pages()[0];
}

function assertResult(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry!).href;
}

if (isMainModule()) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
