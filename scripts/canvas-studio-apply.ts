import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright-core';
import {
  buildCanvasControlCatalogSelectionCheckpoint,
  selectCanvasControlCatalogEntries,
  summarizeCanvasControlCatalogDocument,
  type CanvasControlCatalogDocument,
  type CanvasControlCatalogEntry,
} from '../packages/canvas/src/control-catalog';
import type {
  CanvasControlInsertReportAttempt as InsertAttempt,
  CanvasControlInsertReportDocument as InsertReport,
  CanvasControlInsertReportEntry as InsertReportEntry,
} from '../packages/canvas/src/harvest-fixture';
import { resolveCanvasControlInsertReportResumeSelection } from '../packages/canvas/src/harvest-fixture';
import {
  resolveCanvasControlCatalogStudioInsertPlan,
  type CanvasStudioInsertPlan,
} from '../packages/canvas/src/harvest-studio-plan';

interface Options {
  studioUrl: string;
  browserProfileDir: string;
  yamlDir: string;
  timeoutMs: number;
  publish: boolean;
  catalogJson?: string;
  fixtureContainerName: string;
  insertReportPath?: string;
  includeRetired: boolean;
  catalogResumeReport?: string;
  catalogFamily?: 'classic' | 'modern';
  catalogStartAt?: string;
  catalogLimit?: number;
  settleMs: number;
  debug: boolean;
  slowMoMs: number;
}

interface StudioYamlDescriptor {
  kind: 'screen' | 'control';
  name: string;
}

interface StudioRuntimeStatus {
  ready: boolean;
  reason: string;
  initialized: boolean;
  hasShell: boolean;
  hasDocument: boolean;
  hasPaste: boolean;
  hasControlGallery: boolean;
  hasSaveManager: boolean;
  hasPublish: boolean;
  hasScreen1: boolean;
}

interface RuntimeInsertOutcome {
  insertedName?: string;
  resolvedScreenName?: string;
  template: string;
  variant?: string;
  composite?: boolean;
}

const INSERT_CATALOG_CONTROL_SCRIPT = String.raw`async ({ entry, plan, targetScreenName, timeoutMs }) => {
  const appMagic = window.AppMagic;
  const shell = await appMagic?.context?._shellViewModelPromise;
  const docVm = shell?.documentViewModel;
  if (!docVm) {
    throw new Error('Studio document view model is unavailable.');
  }

  await Promise.race([
    docVm._loadedPromise ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 15000))),
  ]);

  const resolveScreen = (name) => {
    for (const candidateName of [name, 'Screen1']) {
      try {
        const candidate = docVm.getScreenOrComponentByName?.(candidateName);
        if (candidate) {
          return {
            screen: candidate,
            name: candidateName,
          };
        }
      } catch {
        // Keep trying.
      }
    }

    return undefined;
  };

  const readSize = (value) => {
    if (!value) {
      return 0;
    }
    if (typeof value.size === 'number') {
      return value.size;
    }
    if (typeof value.length === 'number') {
      return value.length;
    }
    if (Array.isArray(value)) {
      return value.length;
    }
    if (typeof value === 'object') {
      return Object.keys(value).length;
    }
    return 0;
  };

  const readName = (value) => {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    if (typeof value._name === 'string') {
      return value._name;
    }
    if (typeof value.name === 'string') {
      return value.name;
    }
    if (typeof value.controlName === 'string') {
      return value.controlName;
    }
    return undefined;
  };

  const resolvedScreen = resolveScreen(targetScreenName);
  if (!resolvedScreen) {
    throw new Error('Could not resolve target screen ' + targetScreenName + ' or Screen1.');
  }

  const controlGallery = docVm._controlGallery;
  if (!controlGallery?.addControlAsync) {
    throw new Error('Studio control gallery runtime is unavailable.');
  }

  const insertResult = plan.composite
    ? await controlGallery.addControlAsync(plan.template, plan.variant ?? '', {
        screenLayout: {
          screenViewModel: resolvedScreen.screen,
        },
      })
    : await controlGallery.addControlAsync(plan.template, plan.variant ?? '', undefined, resolvedScreen.screen);

  const idleDeadline = Date.now() + timeoutMs;
  let lastBusyState = '';
  while (Date.now() < idleDeadline) {
    const controlsInCreation = readSize(controlGallery._controlsInCreation);
    const visualWaiting = readSize(controlGallery._visualWaitingPromises);
    if (Boolean(docVm._isInitialized) && controlsInCreation < 1 && visualWaiting < 1) {
      return {
        insertedName: readName(insertResult),
        resolvedScreenName: resolvedScreen.name,
        template: plan.template,
        ...(plan.variant ? { variant: plan.variant } : {}),
        ...(plan.composite ? { composite: true } : {}),
      };
    }
    lastBusyState = 'controlsInCreation=' + controlsInCreation + ', visualWaiting=' + visualWaiting;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(
    'Studio did not settle after inserting ' +
      entry.family +
      '/' +
      entry.name +
      ': ' +
      (lastBusyState || 'unknown busy state') +
      '.'
  );
}`;

const SAVE_RUNTIME_SCRIPT = String.raw`async ({ timeoutMs }) => {
  const shell = await window.AppMagic?.context?._shellViewModelPromise;
  if (!shell?._fileSaveManager?.saveAsync) {
    throw new Error('Studio save runtime is unavailable.');
  }

  await shell._fileSaveManager.saveAsync(undefined, true);
  await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 4000)));
}`;

const PUBLISH_RUNTIME_SCRIPT = String.raw`async ({ timeoutMs }) => {
  if (!window.AppMagic?.context?.publishAppAsync) {
    throw new Error('Studio publish runtime is unavailable.');
  }

  await window.AppMagic.context.publishAppAsync(false);
  await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 5000)));
}`;

const INSPECT_STUDIO_RUNTIME_SCRIPT = String.raw`async () => {
  const appMagic = window.AppMagic;
  const shellPromise = appMagic?.context?._shellViewModelPromise;
  if (!shellPromise) {
    return {
      ready: false,
      reason: 'shell-promise-missing',
      initialized: false,
      hasShell: false,
      hasDocument: false,
      hasPaste: false,
      hasControlGallery: false,
      hasSaveManager: false,
      hasPublish: Boolean(appMagic?.context?.publishAppAsync),
      hasScreen1: false,
    };
  }

  const shell = await shellPromise;
  if (!shell) {
    return {
      ready: false,
      reason: 'shell-missing',
      initialized: false,
      hasShell: false,
      hasDocument: false,
      hasPaste: false,
      hasControlGallery: false,
      hasSaveManager: false,
      hasPublish: Boolean(appMagic?.context?.publishAppAsync),
      hasScreen1: false,
    };
  }

  const docVm = shell.documentViewModel;
  if (!docVm) {
    return {
      ready: false,
      reason: 'document-missing',
      initialized: false,
      hasShell: true,
      hasDocument: false,
      hasPaste: false,
      hasControlGallery: false,
      hasSaveManager: Boolean(shell._fileSaveManager?.saveAsync),
      hasPublish: Boolean(appMagic?.context?.publishAppAsync),
      hasScreen1: false,
    };
  }

  await Promise.race([
    docVm._loadedPromise ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);

  let hasScreen1 = false;
  try {
    hasScreen1 = Boolean(docVm.getScreenOrComponentByName?.('Screen1'));
  } catch {
    hasScreen1 = false;
  }

  const status = {
    ready: false,
    reason: 'not-ready',
    initialized: Boolean(docVm._isInitialized),
    hasShell: true,
    hasDocument: true,
    hasPaste: typeof docVm.doPasteYamlAsync === 'function',
    hasControlGallery: typeof docVm._controlGallery?.addControlAsync === 'function',
    hasSaveManager: typeof shell._fileSaveManager?.saveAsync === 'function',
    hasPublish: typeof appMagic?.context?.publishAppAsync === 'function',
    hasScreen1,
  };

  status.ready =
    status.initialized &&
    status.hasPaste &&
    status.hasControlGallery &&
    status.hasSaveManager &&
    status.hasPublish &&
    status.hasScreen1;
  status.reason = status.ready
    ? 'ready'
    : !status.initialized
      ? 'document-not-initialized'
      : !status.hasScreen1
        ? 'screen1-missing'
        : !status.hasControlGallery
          ? 'control-gallery-missing'
          : !status.hasPaste
            ? 'paste-runtime-missing'
            : !status.hasSaveManager
              ? 'save-runtime-missing'
              : !status.hasPublish
                ? 'publish-runtime-missing'
                : 'not-ready';

  return status;
}`;

const PASTE_YAML_RUNTIME_SCRIPT = String.raw`async ({ yaml, timeoutMs }) => {
  const shell = await window.AppMagic?.context?._shellViewModelPromise;
  const docVm = shell?.documentViewModel;
  if (!docVm?.doPasteYamlAsync) {
    throw new Error('Studio YAML paste runtime is unavailable.');
  }

  await Promise.race([
    docVm._loadedPromise ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 15000))),
  ]);

  const pasted = await docVm.doPasteYamlAsync(undefined, yaml);
  return pasted === false ? { pasted: false } : { pasted: true };
}`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const yamlDir = resolve(options.yamlDir);
  const entries = await readdir(yamlDir, { withFileTypes: true });
  const yamlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.pa.yaml') && entry.name !== 'App.pa.yaml' && entry.name !== '_EditorState.pa.yaml')
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (yamlFiles.length === 0 && !options.catalogJson) {
    throw new Error(`No .pa.yaml files were found in ${yamlDir}.`);
  }

  const context = await chromium.launchPersistentContext(options.browserProfileDir, {
    channel: 'chrome',
    headless: false,
    slowMo: options.debug ? options.slowMoMs : undefined,
    viewport: null,
    args: [
      '--no-first-run',
      '--new-window',
      ...(options.debug ? ['--auto-open-devtools-for-tabs'] : []),
    ],
  });

  let insertReport: InsertReport | undefined;

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await Promise.all(
      context
        .pages()
        .filter((candidate) => candidate !== page)
        .map((candidate) => candidate.close().catch(() => undefined))
    );
    await page.goto(options.studioUrl, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
    });

    if (yamlFiles.length === 0) {
      process.stdout.write('No fixture YAML files supplied; using the existing screen as the insertion anchor.\n');
    }

    for (const file of yamlFiles) {
      const studioFrame = await waitForStudio(page, options.timeoutMs);
      await dismissStudioOverlays(studioFrame);
      const content = normalizeStudioYaml(await readFile(resolve(yamlDir, file), 'utf8'));
      const descriptor = describeStudioYaml(content, file);

      process.stdout.write(`Applying ${descriptor.kind} ${descriptor.name} from ${file}...\n`);
      if (descriptor.kind === 'control') {
        await applyControlYaml(studioFrame, descriptor.name, content, options.timeoutMs, options.settleMs);
      } else {
        await applyScreenYaml(studioFrame, descriptor.name, content, options.timeoutMs);
      }
      await page.waitForTimeout(options.settleMs);
    }

    const studioFrame = await waitForStudio(page, options.timeoutMs);
    await dismissStudioOverlays(studioFrame);

    if (options.catalogJson) {
      insertReport = await insertCatalogControls(studioFrame, options);
    }

    await saveAndPublish(studioFrame, options.publish, options.timeoutMs, options.settleMs);
  } finally {
    await context.close();
  }

  if (insertReport && options.insertReportPath) {
    await writeFile(resolve(options.insertReportPath), `${JSON.stringify(insertReport, null, 2)}\n`, 'utf8');
    process.stdout.write(`Wrote insert report to ${resolve(options.insertReportPath)}\n`);
  }
}

async function evaluateStudioRuntime<Result, Input = undefined>(
  studioFrame: Frame,
  script: string,
  input: Input
): Promise<Result> {
  return studioFrame.evaluate(
    async ({ script, input }) => {
      const factory = (0, eval)(script) as (value: Input) => Promise<Result> | Result;
      return await factory(input as Input);
    },
    {
      script,
      input,
    }
  );
}

async function applyControlYaml(
  studioFrame: Frame,
  controlName: string,
  content: string,
  timeoutMs: number,
  settleMs: number
): Promise<void> {
  const existing = await studioFrame.locator(`[title="${controlName}"]`).first().isVisible({ timeout: 500 }).catch(() => false);
  if (existing) {
    await studioFrame.locator(`[title="${controlName}"]`).first().click({ timeout: 5000, force: true });
    await studioFrame.page().waitForTimeout(300);
    await studioFrame.page().keyboard.press('Delete');
    await studioFrame.page().waitForTimeout(settleMs);
  }

  await selectTargetScreen(studioFrame, 'Screen1', timeoutMs);
  await pasteYamlViaRuntime(studioFrame, content, timeoutMs, `control ${controlName}`);
  await waitForTitledElement(studioFrame, controlName, timeoutMs);
}

async function applyScreenYaml(studioFrame: Frame, screenName: string, content: string, timeoutMs: number): Promise<void> {
  if (await studioFrame.locator(`[title="${screenName}"]`).first().isVisible({ timeout: 500 }).catch(() => false)) {
    process.stdout.write(`Skipping ${screenName}; it already exists.\n`);
    return;
  }

  await pasteYamlViaRuntime(studioFrame, content, timeoutMs, `screen ${screenName}`);
  await waitForTitledElement(studioFrame, screenName, timeoutMs);
}

async function insertCatalogControls(studioFrame: Frame, options: Options): Promise<InsertReport> {
  const catalogPath = resolve(options.catalogJson!);
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as CanvasControlCatalogDocument;
  const catalogCounts = catalog.counts ?? summarizeCanvasControlCatalogDocument(catalog);
  const resumeReportPath = options.catalogResumeReport ? resolve(options.catalogResumeReport) : undefined;
  const resumeSelection = resumeReportPath
    ? resolveCanvasControlInsertReportResumeSelection(
        catalog,
        JSON.parse(await readFile(resumeReportPath, 'utf8')) as InsertReport
      )
    : undefined;
  const selected = selectCanvasControlCatalogEntries(catalog, {
    includeRetired: resumeSelection?.includeRetired ?? options.includeRetired,
    family: resumeSelection?.family ?? options.catalogFamily,
    startAt: resumeSelection?.startAt ?? options.catalogStartAt,
    limit: resumeSelection?.limit ?? options.catalogLimit,
  });
  const selectionCheckpoint = buildCanvasControlCatalogSelectionCheckpoint(catalog, selected.selection);
  const reportEntries: InsertReportEntry[] = [];

  process.stdout.write(
    `Catalog selection: ${selected.selection.selectedControls} of ${selected.selection.matchingControls} matching controls` +
      `${selected.selection.family ? ` in ${selected.selection.family}` : ''}` +
      `${selected.selection.startAt ? ` starting at ${JSON.stringify(selected.selection.startAt)}` : ''}` +
      `${selected.selection.limit ? ` with limit ${selected.selection.limit}` : ''}` +
      `${selected.selection.remainingControls > 0 ? `; ${selected.selection.remainingControls} remain after this chunk` : ''}` +
      '.\n'
  );

  for (const entry of selected.controls) {
    const plan = resolveCanvasControlCatalogStudioInsertPlan(entry);
    if (!plan) {
      reportEntries.push({
        family: entry.family,
        name: entry.name,
        docPath: entry.docPath,
        status: entry.status,
        outcome: 'not-found',
        strategy: 'runtime-plan-missing',
        attempts: [],
        error: `No runtime insert plan is pinned for ${entry.family}/${entry.name}.`,
      });
      process.stdout.write(`No runtime insert plan for ${entry.family} ${entry.name}.\n`);
      continue;
    }

    if (plan.kind === 'cover') {
      reportEntries.push({
        family: entry.family,
        name: entry.name,
        docPath: entry.docPath,
        status: entry.status,
        outcome: 'covered',
        strategy: plan.reason,
        attempts: [],
      });
      process.stdout.write(`Covering ${entry.family} ${entry.name} via ${plan.reason}.\n`);
      continue;
    }

    const attempts: InsertAttempt[] = [
      {
        query: formatPlanQuery(plan),
        candidates: [
          {
            title: plan.template,
            ...(plan.variant ? { category: plan.variant } : {}),
            ...(plan.composite ? { iconName: 'composite' } : {}),
          },
        ],
      },
    ];

    try {
      const outcome = await insertCatalogControlViaRuntime(
        studioFrame,
        entry,
        plan,
        resolveTargetScreenName(options.fixtureContainerName),
        options.timeoutMs
      );
      await studioFrame.page().waitForTimeout(options.settleMs);
      reportEntries.push({
        family: entry.family,
        name: entry.name,
        docPath: entry.docPath,
        status: entry.status,
        outcome: 'inserted',
        strategy: plan.composite ? 'runtime-addControlAsync-composite' : 'runtime-addControlAsync',
        attempts,
        chosenCandidate: {
          title: outcome.template,
          ...(outcome.variant ? { category: outcome.variant } : {}),
          ...(outcome.composite ? { iconName: 'composite' } : {}),
        },
      });
      process.stdout.write(
        `Inserted ${entry.family} ${entry.name} via ${outcome.template}` +
          `${outcome.variant ? ` (${outcome.variant})` : ''}` +
          `${outcome.resolvedScreenName ? ` on ${outcome.resolvedScreenName}` : ''}` +
          '.\n'
      );
    } catch (error) {
      reportEntries.push({
        family: entry.family,
        name: entry.name,
        docPath: entry.docPath,
        status: entry.status,
        outcome: 'failed',
        strategy: plan.composite ? 'runtime-addControlAsync-composite' : 'runtime-addControlAsync',
        attempts,
        chosenCandidate: {
          title: plan.template,
          ...(plan.variant ? { category: plan.variant } : {}),
          ...(plan.composite ? { iconName: 'composite' } : {}),
        },
        error: error instanceof Error ? error.message : String(error),
      });
      process.stdout.write(`Failed to insert ${entry.family} ${entry.name}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    catalogPath,
    catalogGeneratedAt: catalog.generatedAt,
    catalogCounts,
    selection: selected.selection,
    selectionCheckpoint,
    ...(resumeReportPath ? { resumedFromReportPath: resumeReportPath } : {}),
    fixtureContainerName: options.fixtureContainerName,
    entries: reportEntries,
    totals: {
      attempted: reportEntries.length,
      inserted: reportEntries.filter((entry) => entry.outcome === 'inserted').length,
      covered: reportEntries.filter((entry) => entry.outcome === 'covered').length,
      notFound: reportEntries.filter((entry) => entry.outcome === 'not-found').length,
      failed: reportEntries.filter((entry) => entry.outcome === 'failed').length,
    },
  };
}

async function insertCatalogControlViaRuntime(
  studioFrame: Frame,
  entry: CanvasControlCatalogEntry,
  plan: Extract<CanvasStudioInsertPlan, { kind: 'add' }>,
  targetScreenName: string,
  timeoutMs: number
): Promise<RuntimeInsertOutcome> {
  await dismissStudioOverlays(studioFrame);
  await selectTargetScreen(studioFrame, targetScreenName, timeoutMs).catch(() => undefined);

  return evaluateStudioRuntime<RuntimeInsertOutcome, {
    entry: Pick<CanvasControlCatalogEntry, 'family' | 'name'>;
    plan: Extract<CanvasStudioInsertPlan, { kind: 'add' }>;
    targetScreenName: string;
    timeoutMs: number;
  }>(
    studioFrame,
    INSERT_CATALOG_CONTROL_SCRIPT,
    {
      entry: {
        family: entry.family,
        name: entry.name,
      },
      plan,
      targetScreenName,
      timeoutMs,
    }
  );
}

async function saveAndPublish(studioFrame: Frame, publish: boolean, timeoutMs: number, settleMs: number): Promise<void> {
  await dismissStudioOverlays(studioFrame);
  process.stdout.write('Saving app...\n');
  await evaluateStudioRuntime<void, { timeoutMs: number }>(studioFrame, SAVE_RUNTIME_SCRIPT, { timeoutMs });
  await studioFrame.page().waitForTimeout(settleMs);

  if (!publish) {
    return;
  }

  await dismissStudioOverlays(studioFrame);
  process.stdout.write('Publishing app...\n');
  await evaluateStudioRuntime<void, { timeoutMs: number }>(studioFrame, PUBLISH_RUNTIME_SCRIPT, { timeoutMs });
  await studioFrame.page().waitForTimeout(Math.max(settleMs, 5000));
}

async function waitForStudio(page: Page, timeoutMs: number): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: StudioRuntimeStatus | undefined;

  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.name() === 'EmbeddedStudio');
    if (frame) {
      await dismissStudioOverlays(frame);
      lastStatus = await inspectStudioRuntime(frame);
      if (lastStatus.ready) {
        return frame;
      }
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(
    `Timed out waiting for Power Apps Studio to become ready. ` +
      `Last status: ${lastStatus ? JSON.stringify(lastStatus) : 'no EmbeddedStudio frame found'}.`
  );
}

async function inspectStudioRuntime(studioFrame: Frame): Promise<StudioRuntimeStatus> {
  const domReadOnly =
    (await studioFrame
      .getByText(/read-only because you already have editing control elsewhere/i)
      .first()
      .isVisible({ timeout: 200 })
      .catch(() => false)) ||
    (await studioFrame.getByRole('button', { name: /^Override$/i }).first().isVisible({ timeout: 200 }).catch(() => false));

  if (domReadOnly) {
    return {
      ready: false,
      reason: 'read-only-lock',
      initialized: false,
      hasShell: false,
      hasDocument: false,
      hasPaste: false,
      hasControlGallery: false,
      hasSaveManager: false,
      hasPublish: false,
      hasScreen1: false,
    };
  }

  return evaluateStudioRuntime<StudioRuntimeStatus, undefined>(studioFrame, INSPECT_STUDIO_RUNTIME_SCRIPT, undefined);
}

async function dismissStudioOverlays(studioFrame: Frame): Promise<boolean> {
  let clickedAny = false;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const clicked = await clickAny(
      studioFrame,
      [/^Skip$/i, /^Got it$/i, /^Dismiss$/i, /^Done$/i, /^Override$/i, /^Continue$/i, /^Accept$/i],
      750
    );

    if (!clicked) {
      return clickedAny;
    }

    clickedAny = true;
    await studioFrame.page().waitForTimeout(1500);
  }

  return clickedAny;
}

async function clickAny(studioFrame: Frame, labels: RegExp[], timeoutMs: number): Promise<boolean> {
  for (const label of labels) {
    const locator = studioFrame.getByRole('button', { name: label }).first();
    if (await locator.isVisible({ timeout: 100 }).catch(() => false)) {
      await locator.click({ timeout: timeoutMs, force: true }).catch(() => undefined);
      return true;
    }
  }

  return false;
}

async function pasteYamlViaRuntime(studioFrame: Frame, yaml: string, timeoutMs: number, description: string): Promise<void> {
  const result = await evaluateStudioRuntime<{ pasted: boolean }, { yaml: string; timeoutMs: number }>(
    studioFrame,
    PASTE_YAML_RUNTIME_SCRIPT,
    {
      yaml,
      timeoutMs,
    }
  );

  if (!result.pasted) {
    throw new Error(`Studio runtime declined to paste ${description}.`);
  }
}

async function selectTargetScreen(studioFrame: Frame, targetScreenName: string, timeoutMs: number): Promise<void> {
  const candidates = [targetScreenName, 'Screen1'];
  for (const candidateName of candidates) {
    const locator = studioFrame.locator(`[title="${candidateName}"]`).first();
    if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
      await locator.click({ timeout: Math.min(timeoutMs, 5000), force: true });
      await studioFrame.page().waitForTimeout(500);
      return;
    }
  }

  throw new Error(`Could not find target screen ${targetScreenName} or Screen1 in Studio.`);
}

async function waitForTitledElement(studioFrame: Frame, title: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const locator = studioFrame.locator(`[title="${title}"]`).first();

  while (Date.now() < deadline) {
    if (await locator.isVisible({ timeout: 200 }).catch(() => false)) {
      return;
    }
    await studioFrame.page().waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for ${title} to appear in Studio.`);
}

function normalizeStudioYaml(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const stripped = [...lines];

  while (stripped.length > 0) {
    const line = stripped[0];
    if (line === undefined) {
      break;
    }

    if (line.trim() === '' || line.startsWith('#')) {
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
    return {
      kind: 'screen',
      name: match?.[1] ?? fallbackFileName.replace(/\.pa\.yaml$/i, ''),
    };
  }

  const match = content.match(/^\s*-\s*([A-Za-z_][\w]*)\s*:\s*$/m);
  if (!match?.[1]) {
    throw new Error(`Could not determine the top-level node in ${fallbackFileName}.`);
  }

  return {
    kind: 'control',
    name: match[1],
  };
}

function resolveTargetScreenName(fixtureContainerName: string): string {
  return /^screen/i.test(fixtureContainerName) ? fixtureContainerName : 'Screen1';
}

function formatPlanQuery(plan: Extract<CanvasStudioInsertPlan, { kind: 'add' }>): string {
  return `${plan.template}${plan.variant ? `:${plan.variant}` : ''}${plan.composite ? ':composite' : ''}`;
}

function parseArgs(argv: string[]): Options {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);
  const readPositiveInteger = (flag: string): number | undefined => {
    const value = read(flag);
    if (!value) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`Invalid ${flag} value: ${value}. Expected a positive integer.`);
    }

    return parsed;
  };
  const studioUrl = read('--studio-url');
  const browserProfileDir = read('--browser-profile-dir');
  const yamlDir = read('--yaml-dir');
  const catalogJson = read('--catalog-json');
  const catalogResumeReport = read('--catalog-resume-report');
  const catalogFamily = readCatalogFamilyArg(read('--catalog-family'));
  const catalogStartAt = read('--catalog-start-at');
  const catalogLimit = readPositiveInteger('--catalog-limit');

  if (!studioUrl || !browserProfileDir || !yamlDir) {
    throw new Error('--studio-url, --browser-profile-dir, and --yaml-dir are required.');
  }

  if (!catalogJson && (catalogResumeReport || catalogFamily || catalogStartAt || catalogLimit)) {
    throw new Error('--catalog-resume-report, --catalog-family, --catalog-start-at, and --catalog-limit require --catalog-json.');
  }

  if (catalogResumeReport && (has('--include-retired') || catalogFamily || catalogStartAt || catalogLimit)) {
    throw new Error(
      '--catalog-resume-report cannot be combined with --include-retired, --catalog-family, --catalog-start-at, or --catalog-limit.'
    );
  }

  return {
    studioUrl,
    browserProfileDir,
    yamlDir,
    timeoutMs: Number(read('--timeout-ms') ?? '120000'),
    publish: !has('--skip-publish'),
    catalogJson,
    catalogResumeReport,
    fixtureContainerName: read('--fixture-container-name') ?? 'HarvestFixtureContainer',
    insertReportPath: read('--insert-report'),
    includeRetired: has('--include-retired'),
    catalogFamily,
    catalogStartAt,
    catalogLimit,
    settleMs: Number(read('--settle-ms') ?? '4000'),
    debug: has('--debug'),
    slowMoMs: Number(read('--slow-mo-ms') ?? '250'),
  };
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

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
