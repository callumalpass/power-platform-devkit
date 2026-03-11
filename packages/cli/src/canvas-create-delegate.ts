import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { chromium, type BrowserContext, type Frame, type Page } from 'playwright-core';
import type { BrowserProfile } from '@pp/auth';
import { type CanvasAppSummary, CanvasService } from '@pp/canvas';
import type { DataverseClient } from '@pp/dataverse';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';

export interface DelegatedCanvasCreateOptions {
  envAlias: string;
  solutionUniqueName: string;
  solutionId: string;
  appName: string;
  browserProfileName: string;
  browserProfile: BrowserProfile;
  browserProfileDir: string;
  client: DataverseClient;
  targetUrl?: string;
  makerEnvironmentId?: string;
  outDir: string;
  headless: boolean;
  slowMoMs: number;
  timeoutMs: number;
  pollTimeoutMs: number;
  settleMs: number;
}

export interface DelegatedCanvasCreateSuccess {
  appName: string;
  envAlias: string;
  solutionUniqueName: string;
  targetUrl: string;
  browserProfile: string;
  baselineMatches: CanvasAppSummary[];
  studioRuntimeTarget: string;
  pageUrl?: string;
  title?: string;
  frames?: Array<{ name: string; url: string }>;
  createdApp: CanvasAppSummary;
  screenshotPath: string;
  sessionPath: string;
}

export interface DelegatedBrowserLaunchDetails {
  profileName: string;
  requestedUserDataDir: string;
  effectiveUserDataDir: string;
  fallbackClone?: {
    sourceUserDataDir: string;
    clonedUserDataDir: string;
    omittedEntries: string[];
    trigger: string;
  };
}

interface SessionArtifacts {
  screenshotPath: string;
  sessionPath: string;
}

const SAVE_TIMEOUT_MS = 8_000;
const PUBLISH_TIMEOUT_MS = 12_000;
const PROFILE_LOCK_OMIT_ENTRIES = ['SingletonCookie', 'SingletonLock', 'SingletonSocket'];

export async function runDelegatedCanvasCreate(
  options: DelegatedCanvasCreateOptions
): Promise<OperationResult<DelegatedCanvasCreateSuccess>> {
  await mkdir(options.outDir, { recursive: true });

  const canvasService = new CanvasService(options.client);
  const targetUrl = resolveInitialTargetUrl({
    explicitTargetUrl: options.targetUrl,
    makerEnvironmentId: options.makerEnvironmentId,
    solutionId: options.solutionId,
    appName: options.appName,
  });

  const beforeApps = await listMatchingApps(canvasService, options.solutionUniqueName, options.appName);

  if (!beforeApps.success || !beforeApps.data) {
    return beforeApps as unknown as OperationResult<DelegatedCanvasCreateSuccess>;
  }

  const beforeIds = new Set(beforeApps.data.map((app) => app.id));
  const sessionArtifacts = buildSessionArtifacts(options.outDir, options.appName);
  const launched = await launchDelegatedBrowserContext(options.browserProfileDir, options.browserProfile, options);

  let finalPayload: Record<string, unknown> = {
    appName: options.appName,
    envAlias: options.envAlias,
    solutionUniqueName: options.solutionUniqueName,
    targetUrl,
    browserProfile: options.browserProfileName,
    baselineMatches: beforeApps.data,
    browserLaunch: launched,
  };

  const context = launched.context;
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    await page.waitForTimeout(15_000);

    if (!isBlankAppTargetUrl(targetUrl)) {
      await openCanvasAppCreateDialog(page, options.timeoutMs);
      await page.getByLabel('App name').fill(options.appName, { timeout: options.timeoutMs });
      await page.getByRole('button', { name: /^Create$/i }).click({ timeout: options.timeoutMs });
    }

    await page.waitForURL(/\/canvas\/\?action=(new-blank|edit)/i, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
    });
    const runtimeTarget = await waitForStudioRuntime(page, options.timeoutMs);
    await dismissStudioOverlays(page, options.timeoutMs);

    await saveStudioApp(runtimeTarget, options.settleMs);
    await publishStudioApp(runtimeTarget, options.settleMs);

    const createdApp = await pollForPersistedCanvasApp(canvasService, options.solutionUniqueName, options.appName, beforeIds, options);

    const successPayload: DelegatedCanvasCreateSuccess = {
      appName: options.appName,
      envAlias: options.envAlias,
      solutionUniqueName: options.solutionUniqueName,
      targetUrl,
      browserProfile: options.browserProfileName,
      baselineMatches: beforeApps.data,
      studioRuntimeTarget: describeStudioRuntimeTarget(runtimeTarget),
      pageUrl: page.url(),
      title: await page.title(),
      frames: page.frames().map((frame) => ({ name: frame.name(), url: frame.url() })),
      createdApp,
      screenshotPath: sessionArtifacts.screenshotPath,
      sessionPath: sessionArtifacts.sessionPath,
    };

    finalPayload = { ...successPayload };

    await captureSessionArtifacts(page, sessionArtifacts, finalPayload);

    return ok(successPayload, {
      supportTier: 'preview',
      details: {
        artifacts: sessionArtifacts,
      },
    });
  } catch (error) {
    finalPayload = {
      ...finalPayload,
      pageUrl: page.url(),
      title: await page.title().catch(() => undefined),
      frames: page.frames().map((frame) => ({ name: frame.name(), url: frame.url() })),
      studioRuntimeProbe: await captureStudioRuntimeProbe(page).catch(() => undefined),
      error: error instanceof Error ? error.message : String(error),
      screenshotPath: sessionArtifacts.screenshotPath,
      sessionPath: sessionArtifacts.sessionPath,
    };

    await captureSessionArtifacts(page, sessionArtifacts, finalPayload).catch(() => undefined);

    return fail(
      createDiagnostic(
        'error',
        'CANVAS_REMOTE_CREATE_DELEGATED_FAILED',
        error instanceof Error ? error.message : 'Delegated Maker canvas create failed.',
        {
          source: '@pp/cli',
          hint:
            'Review the captured session artifact, retry with --debug for a visible browser session, or increase the delegated timeout knobs if Studio was still loading.',
        }
      ),
      {
        details: finalPayload,
        supportTier: 'preview',
      }
    );
  } finally {
    await context.close();
  }
}

export function buildSolutionAppsUrl(input: { makerEnvironmentId?: string; solutionId: string }): string {
  assertResult(Boolean(input.makerEnvironmentId), '--maker-env-id or an environment alias with makerEnvironmentId is required.');
  return `https://make.powerapps.com/environments/${input.makerEnvironmentId}/solutions/${input.solutionId}/apps`;
}

export function buildBlankAppUrl(input: {
  makerEnvironmentId?: string;
  solutionId: string;
  appName: string;
}): string {
  assertResult(Boolean(input.makerEnvironmentId), '--maker-env-id or an environment alias with makerEnvironmentId is required.');
  const params = new URLSearchParams({
    action: 'new-blank',
    'form-factor': 'tablet',
    name: input.appName,
    'solution-id': input.solutionId,
  });
  return `https://make.powerapps.com/e/${encodeURIComponent(input.makerEnvironmentId!)}/canvas/?${params.toString()}`;
}

export function resolveInitialTargetUrl(input: {
  explicitTargetUrl?: string;
  makerEnvironmentId?: string;
  solutionId: string;
  appName: string;
}): string {
  if (input.explicitTargetUrl) {
    return input.explicitTargetUrl;
  }

  if (input.makerEnvironmentId) {
    return buildBlankAppUrl(input);
  }

  return buildSolutionAppsUrl(input);
}

export function isBlankAppTargetUrl(targetUrl: string): boolean {
  try {
    const url = new URL(targetUrl);
    return url.pathname.endsWith('/canvas/') && url.searchParams.get('action') === 'new-blank';
  } catch {
    return false;
  }
}

export async function launchDelegatedBrowserContext(
  userDataDir: string,
  browserProfile: BrowserProfile,
  options: DelegatedCanvasCreateOptions
): Promise<DelegatedBrowserLaunchDetails & { context: BrowserContext }> {
  const launchOptions = {
    headless: options.headless,
    viewport: { width: 1600, height: 1200 },
    args: ['--no-first-run', ...(browserProfile.args ?? [])],
    slowMo: options.slowMoMs > 0 ? options.slowMoMs : undefined,
    channel: resolveBrowserChannel(browserProfile),
    executablePath: browserProfile.kind === 'custom' ? browserProfile.command : undefined,
  };

  try {
    return {
      context: await chromium.launchPersistentContext(userDataDir, launchOptions),
      profileName: options.browserProfileName,
      requestedUserDataDir: userDataDir,
      effectiveUserDataDir: userDataDir,
    };
  } catch (error) {
    if (!isBrowserProfileAlreadyInUseError(error)) {
      throw error;
    }

    const fallbackDir = buildLockedProfileCloneDir(options.outDir, options.browserProfileName);
    await copyBrowserProfileDirectory(userDataDir, fallbackDir);

    return {
      context: await chromium.launchPersistentContext(fallbackDir, launchOptions),
      profileName: options.browserProfileName,
      requestedUserDataDir: userDataDir,
      effectiveUserDataDir: fallbackDir,
      fallbackClone: {
        sourceUserDataDir: userDataDir,
        clonedUserDataDir: fallbackDir,
        omittedEntries: PROFILE_LOCK_OMIT_ENTRIES,
        trigger: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function isBrowserProfileAlreadyInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /user data directory is already in use/i.test(message) ||
    /processsingleton/i.test(message) ||
    /singleton(lock|cookie|socket)/i.test(message) ||
    /profile appears to be in use/i.test(message)
  );
}

function buildLockedProfileCloneDir(outDir: string, profileName: string): string {
  return join(outDir, '.browser-profile-clones', `${slugify(profileName)}-locked-retry`);
}

async function copyBrowserProfileDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (PROFILE_LOCK_OMIT_ENTRIES.includes(entry.name)) {
      continue;
    }

    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyBrowserProfileDirectory(sourcePath, targetPath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      continue;
    }

    const sourceStat = await stat(sourcePath);
    if (sourceStat.isDirectory()) {
      await copyBrowserProfileDirectory(sourcePath, targetPath);
    } else if (sourceStat.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}

function resolveBrowserChannel(browserProfile: BrowserProfile): 'chrome' | 'msedge' | undefined {
  switch (browserProfile.kind) {
    case 'chrome':
      return 'chrome';
    case 'edge':
      return 'msedge';
    default:
      return undefined;
  }
}

async function openCanvasAppCreateDialog(page: Page, timeoutMs: number): Promise<void> {
  await page.getByText(/^New$/i).locator('..').first().click({ timeout: timeoutMs });
  await page.waitForTimeout(2_000);

  const appItem = page.getByRole('menuitem', { name: /^App$/i }).first();
  await appItem.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1_000);
  await page.getByRole('menuitem', { name: /Canvas app/i }).first().click({ timeout: timeoutMs });
  await page.waitForTimeout(3_000);
}

async function waitForStudioRuntime(page: Page, timeoutMs: number): Promise<Page | Frame> {
  const startedAt = Date.now();
  let lastObservedTarget: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const candidateTargets = getStudioRuntimeCandidates(page);

    for (const candidate of candidateTargets) {
      const ready = await isStudioRuntimeReady(candidate);
      if (ready) {
        return candidate;
      }
      lastObservedTarget = describeStudioRuntimeTarget(candidate);
    }

    await page.waitForTimeout(2_000);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for Studio runtime readiness${lastObservedTarget ? ` on ${lastObservedTarget}` : ''}.`
  );
}

async function dismissStudioOverlays(page: Page, timeoutMs: number): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /^Skip$/i }).first(),
    page.getByRole('button', { name: /^Override$/i }).first(),
    page.getByRole('button', { name: /^Got it$/i }).first(),
  ];

  const frame = page.frames().find((candidate) => candidate.name() === 'EmbeddedStudio');
  if (frame) {
    candidates.push(
      frame.getByRole('button', { name: /^Skip$/i }).first(),
      frame.getByRole('button', { name: /^Override$/i }).first(),
      frame.getByRole('button', { name: /^Got it$/i }).first()
    );
  }

  for (const candidate of candidates) {
    if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
      await candidate.click({ timeout: timeoutMs }).catch(() => undefined);
      await page.waitForTimeout(1_500);
    }
  }
}

async function saveStudioApp(target: Page | Frame, settleMs: number): Promise<void> {
  await target.evaluate(
    async ({ timeoutMs }) => {
      const shell = await (globalThis as typeof globalThis & { AppMagic?: any }).AppMagic?.context?._shellViewModelPromise;
      if (!shell?._fileSaveManager?.saveAsync) {
        throw new Error('Studio save runtime is unavailable.');
      }

      await shell._fileSaveManager.saveAsync(undefined, true);
      await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 5_000)));
    },
    { timeoutMs: SAVE_TIMEOUT_MS }
  );
  await getOwningPage(target).waitForTimeout(settleMs);
}

async function publishStudioApp(target: Page | Frame, settleMs: number): Promise<void> {
  await target
    .evaluate(
      async ({ timeoutMs }) => {
        const appMagic = (globalThis as typeof globalThis & { AppMagic?: any }).AppMagic;
        if (!appMagic?.context?.publishAppAsync) {
          throw new Error('Studio publish runtime is unavailable.');
        }

        await appMagic.context.publishAppAsync(false);
        await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 8_000)));
      },
      { timeoutMs: PUBLISH_TIMEOUT_MS }
    )
    .catch(() => undefined);
  await getOwningPage(target).waitForTimeout(settleMs);
}

export function getStudioRuntimeCandidates(page: Pick<Page, 'frames'>): Array<Page | Frame> {
  const frames = page.frames();
  const preferredFrame = selectEmbeddedStudioFrame(frames);
  return preferredFrame ? [preferredFrame, page as Page] : [page as Page, ...frames];
}

export function selectEmbeddedStudioFrame<T extends Pick<Frame, 'name' | 'url'>>(frames: T[]): T | undefined {
  return (
    frames.find((frame) => frame.name() === 'EmbeddedStudio') ??
    frames.find((frame) => /\/embed\/?/i.test(frame.url()))
  );
}

function describeStudioRuntimeTarget(target: Page | Frame): string {
  if ('name' in target) {
    const name = target.name();
    return name ? `frame:${name}` : `frame:${target.url()}`;
  }

  return 'page:top';
}

async function isStudioRuntimeReady(target: Page | Frame): Promise<boolean> {
  return target
    .evaluate(async () => {
      const appMagic = (globalThis as typeof globalThis & { AppMagic?: any }).AppMagic;
      const shell = await appMagic?.context?._shellViewModelPromise;
      const documentViewModel = shell?.documentViewModel;
      if (!documentViewModel) {
        return false;
      }

      await Promise.race([
        documentViewModel._loadedPromise ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);

      return Boolean(shell?._fileSaveManager?.saveAsync);
    })
    .catch(() => false);
}

async function captureStudioRuntimeProbe(page: Page): Promise<Array<{ target: string; url: string; appMagicPresent: boolean }>> {
  const candidates = [page, ...page.frames()];
  const probes = await Promise.all(
    candidates.map(async (candidate) => ({
      target: describeStudioRuntimeTarget(candidate),
      url: candidate.url(),
      appMagicPresent: await candidate
        .evaluate(() => Boolean((globalThis as typeof globalThis & { AppMagic?: unknown }).AppMagic))
        .catch(() => false),
    }))
  );

  return probes;
}

function getOwningPage(target: Page | Frame): Page {
  return 'page' in target ? target.page() : target;
}

async function pollForPersistedCanvasApp(
  canvasService: CanvasService,
  solutionUniqueName: string,
  appName: string,
  beforeIds: Set<string>,
  options: DelegatedCanvasCreateOptions
): Promise<CanvasAppSummary> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.pollTimeoutMs) {
    const matches = await listMatchingApps(canvasService, solutionUniqueName, appName);
    if (!matches.success || !matches.data) {
      throw new Error(`Failed to list canvas apps for solution ${solutionUniqueName}.`);
    }

    const created =
      matches.data.find((app) => !beforeIds.has(app.id)) ?? (beforeIds.size === 0 && matches.data.length === 1 ? matches.data[0] : undefined);

    if (created) {
      return created;
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(
    `Timed out after ${options.pollTimeoutMs}ms waiting for a persisted solution-scoped canvas app record named ${appName}.`
  );
}

async function listMatchingApps(
  canvasService: CanvasService,
  solutionUniqueName: string,
  appName: string
): Promise<OperationResult<CanvasAppSummary[]>> {
  const listed = await canvasService.listRemote({ solutionUniqueName });

  if (!listed.success || !listed.data) {
    return fail(createDiagnostic('error', 'CANVAS_REMOTE_LIST_FAILED', `Failed to list canvas apps for solution ${solutionUniqueName}.`, {
      source: '@pp/cli',
    }));
  }

  const normalized = appName.trim().toLowerCase();
  return ok(
    listed.data.filter(
      (app) => app.displayName?.trim().toLowerCase() === normalized || app.name?.trim().toLowerCase() === normalized
    ),
    {
      supportTier: 'preview',
    }
  );
}

function buildSessionArtifacts(outDir: string, appName: string): SessionArtifacts {
  const slug = slugify(appName);
  return {
    screenshotPath: join(outDir, `${slug}.png`),
    sessionPath: join(outDir, `${slug}.session.json`),
  };
}

async function captureSessionArtifacts(page: Page, artifacts: SessionArtifacts, payload: Record<string, unknown>): Promise<void> {
  await page.screenshot({ path: artifacts.screenshotPath, fullPage: true });
  await writeFile(artifacts.sessionPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function slugify(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function assertResult(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
