import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Frame, type Locator, type Page } from 'playwright-core';
import {
  summarizeCanvasControlCatalogDocument,
  type CanvasControlCatalogDocument,
  type CanvasControlCatalogEntry,
} from '../packages/canvas/src/control-catalog';
import type {
  CanvasControlInsertReportAttempt as InsertAttempt,
  CanvasControlInsertReportDocument as InsertReport,
  CanvasControlInsertReportEntry as InsertReportEntry,
} from '../packages/canvas/src/harvest-fixture';

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
  settleMs: number;
  debug: boolean;
  slowMoMs: number;
}

interface StudioYamlDescriptor {
  kind: 'screen' | 'control';
  name: string;
}

interface InsertPaneCandidate {
  index: number;
  title: string;
  text: string;
  category?: string;
  iconName?: string;
  isCategory: boolean;
}

const DIRECT_INSERT_SKIP_REASONS: Record<string, string> = {
  'classic:card': 'covered-by-form-children',
  'classic:column': 'covered-by-data-table-columns',
  'classic:display and edit form': 'redundant-doc-alias',
  'classic:screen': 'covered-by-base-screen-template',
};

const SEARCH_ALIASES: Record<string, string[]> = {
  'classic:gallery': ['Vertical gallery'],
  'classic:label': ['Text label'],
  'classic:shape': ['Rectangle'],
  'classic:stream video': ['Video'],
  'classic:web barcode scanner': ['Barcode reader'],
  'modern:info button': ['Information button'],
  'modern:radio group': ['Radio'],
  'modern:tabs or tab list': ['Tab list'],
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const yamlDir = resolve(options.yamlDir);
  const entries = await readdir(yamlDir, { withFileTypes: true });
  const yamlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.pa.yaml') && entry.name !== 'App.pa.yaml' && entry.name !== '_EditorState.pa.yaml')
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (yamlFiles.length === 0) {
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
    await page.goto(options.studioUrl, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
    });

    await grantClipboardPermissions(page);

    for (const file of yamlFiles) {
      const studioFrame = await waitForStudio(page, options.timeoutMs);
      await dismissStudioOverlays(studioFrame);
      await page.waitForTimeout(options.settleMs);

      const content = normalizeStudioYaml(await readFile(resolve(yamlDir, file), 'utf8'));
      const descriptor = describeStudioYaml(content, file);

      process.stdout.write(`Applying ${descriptor.kind} ${descriptor.name} from ${file}...\n`);
      if (descriptor.kind === 'control') {
        await applyControlYaml(page, studioFrame, descriptor.name, content, options.timeoutMs);
      } else {
        await applyScreenYaml(page, studioFrame, descriptor.name, content, options.timeoutMs);
      }

      await page.waitForTimeout(options.settleMs);
    }

    await page.waitForTimeout(options.settleMs);
    const studioFrame = await waitForStudio(page, options.timeoutMs);
    await dismissStudioOverlays(studioFrame);

    if (options.catalogJson) {
      insertReport = await insertCatalogControls(page, studioFrame, options);
    }

    await saveAndPublish(page, studioFrame, options.publish, options.settleMs);
  } finally {
    await context.close();
  }

  if (insertReport && options.insertReportPath) {
    await writeFile(resolve(options.insertReportPath), `${JSON.stringify(insertReport, null, 2)}\n`, 'utf8');
    process.stdout.write(`Wrote insert report to ${resolve(options.insertReportPath)}\n`);
  }
}

async function applyControlYaml(page: Page, studioFrame: Frame, controlName: string, content: string, timeoutMs: number): Promise<void> {
  const existing = studioFrame.locator(`[title="${controlName}"]`).first();
  if (await existing.isVisible({ timeout: 1000 }).catch(() => false)) {
    await existing.click({ timeout: 5000, force: true });
    await page.waitForTimeout(500);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(2000);
  }

  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, content);

  const screenNode = studioFrame.locator('[title="Screen1"]').first();
  await screenNode.click({ timeout: 5000, force: true });
  await page.waitForTimeout(500);
  await pasteShortcut(page);
  await page.waitForTimeout(5000);

  await studioFrame.locator(`[title="${controlName}"]`).first().waitFor({
    state: 'visible',
    timeout: timeoutMs,
  });
}

async function applyScreenYaml(page: Page, studioFrame: Frame, screenName: string, content: string, timeoutMs: number): Promise<void> {
  if (await studioFrame.locator(`[title="${screenName}"]`).first().isVisible({ timeout: 1000 }).catch(() => false)) {
    process.stdout.write(`Skipping ${screenName}; it already exists.\n`);
    return;
  }

  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, content);

  const screenNode = studioFrame.locator('[title="Screen1"]').first();
  await screenNode.click({ timeout: 5000, force: true });
  await page.waitForTimeout(500);
  await pasteShortcut(page);
  await page.waitForTimeout(5000);

  await studioFrame.locator(`[title="${screenName}"]`).first().waitFor({
    state: 'visible',
    timeout: timeoutMs,
  });
}

async function insertCatalogControls(page: Page, studioFrame: Frame, options: Options): Promise<InsertReport> {
  const catalogPath = resolve(options.catalogJson!);
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as CanvasControlCatalogDocument;
  const catalogCounts = catalog.counts ?? summarizeCanvasControlCatalogDocument(catalog);
  const entries = catalog.controls.filter((entry) => options.includeRetired || !entry.status.includes('retired'));
  const reportEntries: InsertReportEntry[] = [];

  for (const entry of entries) {
    const key = makeCatalogKey(entry.family, entry.name);
    const directInsertStrategy = DIRECT_INSERT_SKIP_REASONS[key];

    if (directInsertStrategy) {
      reportEntries.push({
        family: entry.family,
        name: entry.name,
        docPath: entry.docPath,
        status: entry.status,
        outcome: 'covered',
        strategy: directInsertStrategy,
        attempts: [],
      });
      process.stdout.write(`Covering ${entry.family} ${entry.name} via ${directInsertStrategy}.\n`);
      continue;
    }

    const attempts: InsertAttempt[] = [];
    const searchTerms = buildSearchTerms(entry);
    let chosenCandidate: InsertPaneCandidate | undefined;

    for (const searchTerm of searchTerms) {
      await focusFixtureContainer(page, studioFrame, options.fixtureContainerName, options.timeoutMs);
      await ensureInsertPaneOpen(studioFrame, options.timeoutMs);
      const candidates = await searchInsertCandidates(page, studioFrame, searchTerm);
      attempts.push({
        query: searchTerm,
        candidates: candidates
          .filter((candidate) => !candidate.isCategory)
          .map((candidate) => ({
            title: candidate.title,
            category: candidate.category,
            iconName: candidate.iconName,
          })),
      });

      if (attempts[attempts.length - 1]?.candidates.length === 0) {
        const insertButton = studioFrame.locator('button[aria-label="Insert"]').first();
        const insertDisabled = await insertButton.isDisabled().catch(() => true);
        const pane = getInsertPaneRoot(studioFrame);
        const paneVisible = await pane.isVisible({ timeout: 500 }).catch(() => false);
        const paneSearchVisible = await pane.locator('input[placeholder="Search"]').first().isVisible({ timeout: 500 }).catch(() => false);
        const globalTreeCount = await studioFrame.locator('[role="treeitem"]').count().catch(() => 0);
        const paneTreeCount = await pane.locator('[role="treeitem"]').count().catch(() => 0);
        const paneText = ((await pane.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
        process.stdout.write(
          `Search candidates for ${entry.family} ${entry.name} / ${searchTerm}: ${JSON.stringify(
            candidates.map((candidate) => ({
              title: candidate.title,
              category: candidate.category,
              iconName: candidate.iconName,
              isCategory: candidate.isCategory,
            }))
          )} | insertDisabled=${insertDisabled} paneVisible=${paneVisible} paneSearchVisible=${paneSearchVisible} globalTreeCount=${globalTreeCount} paneTreeCount=${paneTreeCount} paneText=${JSON.stringify(
            paneText
          )}\n`
        );
      }

      chosenCandidate = chooseInsertCandidate(entry, searchTerm, candidates);
      if (chosenCandidate) {
        break;
      }
    }

    if (!chosenCandidate) {
      reportEntries.push({
        family: entry.family,
        name: entry.name,
        docPath: entry.docPath,
        status: entry.status,
        outcome: 'not-found',
        strategy: 'search-miss',
        attempts,
      });
      process.stdout.write(`Did not find ${entry.family} ${entry.name} in Insert/search.\n`);
      continue;
    }

    try {
      await studioFrame.locator('[role="treeitem"]').nth(chosenCandidate.index).click({ timeout: 5000, force: true });
      await page.waitForTimeout(options.settleMs);
      await dismissStudioOverlays(studioFrame);

      reportEntries.push({
        family: entry.family,
        name: entry.name,
        docPath: entry.docPath,
        status: entry.status,
        outcome: 'inserted',
        strategy: 'insert-pane-search',
        attempts,
        chosenCandidate: {
          title: chosenCandidate.title,
          category: chosenCandidate.category,
          iconName: chosenCandidate.iconName,
        },
      });
      process.stdout.write(
        `Inserted ${entry.family} ${entry.name} via ${chosenCandidate.title}${chosenCandidate.category ? ` (${chosenCandidate.category})` : ''}.\n`
      );
    } catch (error) {
      reportEntries.push({
        family: entry.family,
        name: entry.name,
        docPath: entry.docPath,
        status: entry.status,
        outcome: 'failed',
        strategy: 'insert-pane-search',
        attempts,
        chosenCandidate: {
          title: chosenCandidate.title,
          category: chosenCandidate.category,
          iconName: chosenCandidate.iconName,
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

function buildSearchTerms(entry: CanvasControlCatalogEntry): string[] {
  const key = makeCatalogKey(entry.family, entry.name);
  const aliases = SEARCH_ALIASES[key] ?? [];
  const terms = [entry.name, ...aliases];

  if (entry.name.includes(' or ')) {
    terms.push(...entry.name.split(/\s+or\s+/i).map((value) => value.trim()));
  }

  return dedupeStrings(terms.filter((value) => value.length > 0));
}

function chooseInsertCandidate(
  entry: CanvasControlCatalogEntry,
  searchTerm: string,
  candidates: InsertPaneCandidate[]
): InsertPaneCandidate | undefined {
  const expectedTitles = new Set(buildSearchTerms(entry).map(normalizeLabel));
  const insertable = candidates.filter((candidate) => !candidate.isCategory);

  if (insertable.length === 0) {
    return undefined;
  }

  const ranked = insertable
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(entry, searchTerm, expectedTitles, candidate),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.candidate;
}

function scoreCandidate(
  entry: CanvasControlCatalogEntry,
  searchTerm: string,
  expectedTitles: Set<string>,
  candidate: InsertPaneCandidate
): number {
  const title = normalizeLabel(candidate.title || candidate.text);
  const search = normalizeLabel(searchTerm);
  let score = 0;

  if (expectedTitles.has(title)) {
    score += 100;
  }

  if (title.includes(search) || search.includes(title)) {
    score += 20;
  }

  if (entry.family === 'modern') {
    if (candidate.iconName?.includes('#fluent-')) {
      score += 40;
    }
    if (candidate.category === 'Classic') {
      score -= 50;
    }
  }

  if (entry.family === 'classic') {
    if (candidate.category === 'Classic') {
      score += 40;
    }
    if (candidate.iconName?.startsWith('#icon-') || candidate.iconName?.startsWith('#Basel_')) {
      score += 30;
    }
    if (candidate.iconName?.includes('#fluent-')) {
      score -= 40;
    }
  }

  if (!candidate.iconName) {
    score -= 10;
  }

  return score;
}

async function focusFixtureContainer(page: Page, studioFrame: Frame, containerName: string, timeoutMs: number): Promise<void> {
  const target =
    (await findAttachedTitledLocator(studioFrame, containerName, Math.min(timeoutMs, 5000)).catch(() => undefined)) ??
    (await refocusScreenAndFindTarget(studioFrame, containerName, timeoutMs));
  await target.click({ timeout: 5000, force: true });
  await page.waitForTimeout(800);
}

async function ensureInsertPaneOpen(studioFrame: Frame, timeoutMs: number): Promise<void> {
  const pane = getInsertPaneRoot(studioFrame);
  const search = pane.locator('input[placeholder="Search"]').first();

  if (await isInsertPaneReady(pane, search)) {
    return;
  }

  const insertButton = studioFrame.locator('button[aria-label="Insert"]').first();
  await insertButton.click({ timeout: 5000, force: true });
  await pane.waitFor({ state: 'visible', timeout: timeoutMs });
  await search.waitFor({ state: 'visible', timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isInsertPaneReady(pane, search)) {
      return;
    }
    await studioFrame.page().waitForTimeout(500);
  }

  throw new Error('Timed out waiting for the Insert pane to open.');
}

async function searchInsertCandidates(page: Page, studioFrame: Frame, query: string): Promise<InsertPaneCandidate[]> {
  const search = getInsertPaneRoot(studioFrame).locator('input[placeholder="Search"]').first();
  await search.click({ timeout: 5000, force: true });
  await search.fill('');
  await page.waitForTimeout(200);
  await search.fill(query);

  let lastSignature = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout(800);
    const candidates = await collectInsertPaneCandidates(studioFrame);
    const signature = JSON.stringify(candidates.map((candidate) => [candidate.title, candidate.category, candidate.iconName, candidate.isCategory]));
    if (signature === lastSignature) {
      return candidates.length > 0 ? candidates : collectGlobalTreeCandidates(studioFrame);
    }
    lastSignature = signature;
  }

  const candidates = await collectInsertPaneCandidates(studioFrame);
  return candidates.length > 0 ? candidates : collectGlobalTreeCandidates(studioFrame);
}

async function collectInsertPaneCandidates(studioFrame: Frame): Promise<InsertPaneCandidate[]> {
  return evaluateTreeItemCandidates(getInsertPaneRoot(studioFrame).locator('[role="treeitem"]'));
}

async function collectGlobalTreeCandidates(studioFrame: Frame): Promise<InsertPaneCandidate[]> {
  return evaluateTreeItemCandidates(studioFrame.locator('[role="treeitem"]'));
}

async function evaluateTreeItemCandidates(locator: Locator): Promise<InsertPaneCandidate[]> {
  return locator.evaluateAll((nodes) => {
    let currentCategory = '';

    return nodes
      .map((node, index) => {
        const categoryNode = node.querySelector('[class*="itemCategoryLabel"]');
        const title = node.getAttribute('title') || node.getAttribute('aria-label') || '';
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        const iconName = node.querySelector('[data-icon-name]')?.getAttribute('data-icon-name') || undefined;
        const isCategory = Boolean(categoryNode) || iconName === 'ChevronRight';
        const category = isCategory ? undefined : currentCategory;

        if (isCategory && title) {
          currentCategory = title;
        }

        return {
          index,
          title,
          text,
          category,
          iconName,
          isCategory,
        };
      })
      .filter((item) => item.title || item.text);
  });
}

function getInsertPaneRoot(studioFrame: Frame): Locator {
  return studioFrame.locator('[aria-label="Navigational side bar"]').first();
}

async function isInsertPaneReady(pane: Locator, search: Locator): Promise<boolean> {
  const paneVisible = await pane.isVisible({ timeout: 500 }).catch(() => false);
  const searchVisible = await search.isVisible({ timeout: 500 }).catch(() => false);

  if (!paneVisible || !searchVisible) {
    return false;
  }

  const paneText = ((await pane.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  return paneText.includes('Insert') || paneText.includes('Recommended') || paneText.includes('Found ');
}

async function findAttachedTitledLocator(studioFrame: Frame, title: string, timeoutMs: number): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  const locator = studioFrame.locator(`[title="${title}"]`);

  while (Date.now() < deadline) {
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      return locator.first();
    }

    await studioFrame.page().waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for an attached element titled ${title}.`);
}

async function refocusScreenAndFindTarget(studioFrame: Frame, containerName: string, timeoutMs: number): Promise<Locator> {
  const screen = await findAttachedTitledLocator(studioFrame, 'Screen1', timeoutMs);
  await screen.click({ timeout: 5000, force: true });
  await studioFrame.page().waitForTimeout(1000);

  return (
    (await findAttachedTitledLocator(studioFrame, containerName, Math.min(timeoutMs, 5000)).catch(() => undefined)) ??
    screen
  );
}

async function saveAndPublish(page: Page, studioFrame: Frame, publish: boolean, settleMs: number): Promise<void> {
  await clickAny([
    studioFrame.locator('#commandBar_save'),
    studioFrame.getByRole('button', { name: /Save/i }),
    studioFrame.getByRole('menuitem', { name: /Save/i }),
  ]);
  await page.waitForTimeout(Math.max(settleMs, 8000));

  if (!publish) {
    return;
  }

  await clickAny([
    studioFrame.locator('#commandBar_publish'),
    studioFrame.getByRole('button', { name: /Publish/i }),
    studioFrame.getByRole('menuitem', { name: /Publish/i }),
    studioFrame.getByText(/Publish this version/i).first(),
  ]);
  await page.waitForTimeout(3000);
  await clickAny([
    studioFrame.locator('#commandBar_publish'),
    studioFrame.getByRole('button', { name: /Publish/i }),
    studioFrame.getByRole('button', { name: /Confirm/i }),
  ]);
  await page.waitForTimeout(Math.max(settleMs * 2, 10000));
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

async function waitForStudio(page: Page, timeoutMs: number): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.name() === 'EmbeddedStudio');
    if (frame) {
      const ready = await frame.locator('[title="Screen1"]').first().isVisible({ timeout: 1000 }).catch(() => false);
      if (ready) {
        return frame;
      }
    }

    await page.waitForTimeout(1000);
  }

  throw new Error('Timed out waiting for EmbeddedStudio frame.');
}

async function dismissStudioOverlays(studioFrame: Frame): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const clicked =
      (await studioFrame.getByRole('button', { name: /^Skip$/i }).first().click({ timeout: 1000 }).then(() => true).catch(() => false)) ||
      (await studioFrame.getByRole('button', { name: /^Override$/i }).first().click({ timeout: 1000 }).then(() => true).catch(() => false)) ||
      (await studioFrame.getByRole('button', { name: /^Got it$/i }).first().click({ timeout: 1000 }).then(() => true).catch(() => false));

    if (!clicked) {
      return;
    }

    await studioFrame.page().waitForTimeout(1500);
  }
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

async function grantClipboardPermissions(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin,
  });
}

async function pasteShortcut(page: Page): Promise<void> {
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+V`);
}

function parseArgs(argv: string[]): Options {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);
  const studioUrl = read('--studio-url');
  const browserProfileDir = read('--browser-profile-dir');
  const yamlDir = read('--yaml-dir');

  if (!studioUrl || !browserProfileDir || !yamlDir) {
    throw new Error('--studio-url, --browser-profile-dir, and --yaml-dir are required.');
  }

  return {
    studioUrl,
    browserProfileDir,
    yamlDir,
    timeoutMs: Number(read('--timeout-ms') ?? '120000'),
    publish: !has('--skip-publish'),
    catalogJson: read('--catalog-json'),
    fixtureContainerName: read('--fixture-container-name') ?? 'HarvestFixtureContainer',
    insertReportPath: read('--insert-report'),
    includeRetired: has('--include-retired'),
    settleMs: Number(read('--settle-ms') ?? '4000'),
    debug: has('--debug'),
    slowMoMs: Number(read('--slow-mo-ms') ?? '250'),
  };
}

function makeCatalogKey(family: CanvasControlCatalogEntry['family'], name: string): string {
  return `${family}:${normalizeLabel(name)}`;
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
