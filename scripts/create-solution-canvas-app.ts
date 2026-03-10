import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { AuthService, resolveBrowserProfileDirectory, type BrowserProfile } from '../packages/auth/src/index';
import { CanvasService, type CanvasAppSummary } from '../packages/canvas/src/index';
import { resolveDataverseClient, type DataverseClient } from '../packages/dataverse/src/index';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

interface CliOptions {
  envAlias: string;
  solutionUniqueName: string;
  appName: string;
  browserProfileName: string;
  targetUrl?: string;
  makerEnvironmentId?: string;
  outDir: string;
  configDir?: string;
  headless: boolean;
  slowMoMs: number;
  timeoutMs: number;
  pollTimeoutMs: number;
  settleMs: number;
}

interface SessionArtifacts {
  screenshotPath: string;
  sessionPath: string;
}

const SAVE_TIMEOUT_MS = 8_000;
const PUBLISH_TIMEOUT_MS = 12_000;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });

  const resolution = await resolveDataverseClient(options.envAlias, readConfigOptions(options));
  assertResult(resolution.success && resolution.data, `Failed to resolve environment alias ${options.envAlias}.`);

  const authService = new AuthService(readConfigOptions(options));
  const browserProfileResult = await authService.getBrowserProfile(options.browserProfileName);
  assertResult(browserProfileResult.success && browserProfileResult.data, `Browser profile ${options.browserProfileName} was not found.`);

  const browserProfile = browserProfileResult.data;
  const browserProfileDir = resolveBrowserProfileDirectory(browserProfile, readConfigOptions(options));
  await mkdir(browserProfileDir, { recursive: true });

  const client = resolution.data.client;
  const canvasService = new CanvasService(client);
  const solutionId = await resolveSolutionId(client, options.solutionUniqueName);
  const makerEnvironmentId = options.makerEnvironmentId ?? resolution.data.environment.makerEnvironmentId;
  const targetUrl = resolveInitialTargetUrl({
    explicitTargetUrl: options.targetUrl,
    makerEnvironmentId,
    solutionId,
    appName: options.appName,
  });

  const beforeApps = await listMatchingApps(canvasService, options.solutionUniqueName, options.appName);
  const beforeIds = new Set(beforeApps.map((app) => app.id));

  const context = await launchBrowserContext(browserProfileDir, browserProfile, options);
  const page = context.pages()[0] ?? (await context.newPage());
  const sessionArtifacts = buildSessionArtifacts(options.outDir, options.appName);

  let finalPayload: Record<string, unknown> = {
    appName: options.appName,
    envAlias: options.envAlias,
    solutionUniqueName: options.solutionUniqueName,
    targetUrl,
    browserProfile: options.browserProfileName,
    baselineMatches: beforeApps,
  };

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
    await waitForStudioRuntime(page, options.timeoutMs);
    await dismissStudioOverlays(page, options.timeoutMs);

    await saveStudioApp(page, options.settleMs);
    await publishStudioApp(page, options.settleMs);

    const createdApp = await pollForPersistedCanvasApp(canvasService, options.solutionUniqueName, options.appName, beforeIds, options);

    finalPayload = {
      ...finalPayload,
      pageUrl: page.url(),
      title: await page.title(),
      frames: page.frames().map((frame) => ({ name: frame.name(), url: frame.url() })),
      createdApp,
      screenshotPath: sessionArtifacts.screenshotPath,
      sessionPath: sessionArtifacts.sessionPath,
    };

    await captureSessionArtifacts(page, sessionArtifacts, finalPayload);
    process.stdout.write(`${JSON.stringify(finalPayload, null, 2)}\n`);
  } catch (error) {
    finalPayload = {
      ...finalPayload,
      pageUrl: page.url(),
      title: await page.title().catch(() => undefined),
      frames: page.frames().map((frame) => ({ name: frame.name(), url: frame.url() })),
      error: error instanceof Error ? error.message : String(error),
      screenshotPath: sessionArtifacts.screenshotPath,
      sessionPath: sessionArtifacts.sessionPath,
    };

    await captureSessionArtifacts(page, sessionArtifacts, finalPayload).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const envAlias = readRequiredFlag(args, '--env');
  const solutionUniqueName = readRequiredFlag(args, '--solution');
  const appName = readRequiredFlag(args, '--name');
  const browserProfileName = readRequiredFlag(args, '--browser-profile');
  const outDir = resolve(readFlag(args, '--out-dir') ?? join('.tmp', 'canvas-create', slugify(appName)));

  return {
    envAlias,
    solutionUniqueName,
    appName,
    browserProfileName,
    targetUrl: readFlag(args, '--target-url'),
    makerEnvironmentId: readFlag(args, '--maker-env-id'),
    outDir,
    configDir: readFlag(args, '--config-dir'),
    headless: !args.includes('--debug'),
    slowMoMs: readNumberFlag(args, '--slow-mo-ms', 0),
    timeoutMs: readNumberFlag(args, '--timeout-ms', 180_000),
    pollTimeoutMs: readNumberFlag(args, '--poll-timeout-ms', 180_000),
    settleMs: readNumberFlag(args, '--settle-ms', 12_000),
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

function readRequiredFlag(args: string[], flag: string): string {
  const value = readFlag(args, flag);
  assertResult(Boolean(value), `${flag} is required.`);
  return value!;
}

function readNumberFlag(args: string[], flag: string, fallback: number): number {
  const value = readFlag(args, flag);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  assertResult(Number.isFinite(parsed), `${flag} must be a number.`);
  return parsed;
}

function readConfigOptions(options: CliOptions): { configDir?: string } {
  return options.configDir ? { configDir: options.configDir } : {};
}

async function resolveSolutionId(
  client: DataverseClient,
  solutionUniqueName: string
): Promise<string> {
  const result = await client.query<{ solutionid: string }>({
    table: 'solutions',
    select: ['solutionid'],
    filter: `uniquename eq '${escapeODataLiteral(solutionUniqueName)}'`,
    top: 1,
  });

  assertResult(result.success && result.data?.[0]?.solutionid, `Solution ${solutionUniqueName} was not found.`);
  return result.data[0].solutionid;
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

async function launchBrowserContext(
  userDataDir: string,
  browserProfile: BrowserProfile,
  options: CliOptions
): Promise<BrowserContext> {
  const launchOptions = {
    headless: options.headless,
    viewport: { width: 1600, height: 1200 },
    args: ['--no-first-run', ...(browserProfile.args ?? [])],
    slowMo: options.slowMoMs > 0 ? options.slowMoMs : undefined,
    channel: resolveBrowserChannel(browserProfile),
    executablePath: browserProfile.kind === 'custom' ? browserProfile.command : undefined,
  };

  return chromium.launchPersistentContext(userDataDir, launchOptions);
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

async function waitForStudioRuntime(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as typeof window & { AppMagic?: unknown }).AppMagic),
    undefined,
    { timeout: timeoutMs }
  );

  await page.waitForFunction(
    async () => {
      const appMagic = (window as typeof window & { AppMagic?: any }).AppMagic;
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
    },
    undefined,
    { timeout: timeoutMs }
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

async function saveStudioApp(page: Page, settleMs: number): Promise<void> {
  await page.evaluate(
    async ({ timeoutMs }) => {
      const shell = await (window as typeof window & { AppMagic?: any }).AppMagic?.context?._shellViewModelPromise;
      if (!shell?._fileSaveManager?.saveAsync) {
        throw new Error('Studio save runtime is unavailable.');
      }

      await shell._fileSaveManager.saveAsync(undefined, true);
      await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 5_000)));
    },
    { timeoutMs: SAVE_TIMEOUT_MS }
  );
  await page.waitForTimeout(settleMs);
}

async function publishStudioApp(page: Page, settleMs: number): Promise<void> {
  await page
    .evaluate(
      async ({ timeoutMs }) => {
        const appMagic = (window as typeof window & { AppMagic?: any }).AppMagic;
        if (!appMagic?.context?.publishAppAsync) {
          throw new Error('Studio publish runtime is unavailable.');
        }

        await appMagic.context.publishAppAsync(false);
        await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 8_000)));
      },
      { timeoutMs: PUBLISH_TIMEOUT_MS }
    )
    .catch(() => undefined);
  await page.waitForTimeout(settleMs);
}

async function pollForPersistedCanvasApp(
  canvasService: CanvasService,
  solutionUniqueName: string,
  appName: string,
  beforeIds: Set<string>,
  options: CliOptions
): Promise<CanvasAppSummary> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.pollTimeoutMs) {
    const matches = await listMatchingApps(canvasService, solutionUniqueName, appName);
    const created = matches.find((app) => !beforeIds.has(app.id)) ?? (beforeIds.size === 0 && matches.length === 1 ? matches[0] : undefined);

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
): Promise<CanvasAppSummary[]> {
  const listed = await canvasService.listRemote({ solutionUniqueName });
  assertResult(listed.success && listed.data, `Failed to list canvas apps for solution ${solutionUniqueName}.`);

  const normalized = appName.trim().toLowerCase();
  return (listed.data ?? []).filter(
    (app) => app.displayName?.trim().toLowerCase() === normalized || app.name?.trim().toLowerCase() === normalized
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

function escapeODataLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function assertResult(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
