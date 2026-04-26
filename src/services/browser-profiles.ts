import { createHash } from 'node:crypto';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getAccount, getBrowserProfilesRoot, loadConfig, writeConfig, type BrowserProfile, type ConfigStoreOptions } from '../config.js';
import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';

const SOURCE = 'pp/services/browser-profiles';
const DEFAULT_BROWSER_URL = 'https://make.powerapps.com';

type BrowserContextLike = {
  newPage: () => Promise<{ goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>; url: () => string }>;
  pages: () => Array<{ goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>; url: () => string }>;
  close: () => Promise<void>;
  on?: (event: 'close', handler: () => void) => void;
};

type OpenContextEntry = {
  context: BrowserContextLike;
  profile: BrowserProfile;
};

export type BrowserProfileStatus = {
  account: string;
  configured: boolean;
  exists: boolean;
  open: boolean;
  profile?: BrowserProfile;
};

export type BrowserProfileOpenResult = BrowserProfileStatus & {
  url: string;
  alreadyOpen: boolean;
};

export type BrowserProfileVerificationResult = BrowserProfileOpenResult & {
  authenticated: boolean;
  finalUrl: string;
};

const openContexts = new Map<string, OpenContextEntry>();

export async function getBrowserProfileStatus(accountName: string, options: ConfigStoreOptions = {}): Promise<OperationResult<BrowserProfileStatus>> {
  const account = await getAccount(accountName, options);
  if (!account.success) return fail(...account.diagnostics);
  if (!account.data) return accountNotFound(accountName);

  const loaded = await loadConfig(options);
  if (!loaded.success || !loaded.data) return fail(...loaded.diagnostics);
  const profile = loaded.data.browserProfiles[accountName];
  return ok({
    account: accountName,
    configured: Boolean(profile),
    exists: profile ? await exists(profile.userDataDir) : false,
    open: openContexts.has(accountName),
    profile
  });
}

export async function openBrowserProfile(accountName: string, input: { url?: string } = {}, options: ConfigStoreOptions = {}): Promise<OperationResult<BrowserProfileOpenResult>> {
  const profile = await getOrCreateBrowserProfile(accountName, options);
  if (!profile.success || !profile.data) return fail(...profile.diagnostics);

  const url = input.url || DEFAULT_BROWSER_URL;
  const launched = launchSystemBrowser(profile.data.userDataDir, url);
  if (!launched.success) return fail(...launched.diagnostics);

  const updated = await updateBrowserProfile(
    accountName,
    {
      lastOpenedAt: new Date().toISOString()
    },
    options
  );
  if (!updated.success || !updated.data) return fail(...updated.diagnostics);

  return ok({
    account: accountName,
    configured: true,
    exists: true,
    open: openContexts.has(accountName),
    profile: updated.data,
    url,
    alreadyOpen: false
  });
}

async function openPlaywrightBrowserProfile(
  accountName: string,
  input: { url?: string; headless?: boolean } = {},
  options: ConfigStoreOptions = {}
): Promise<OperationResult<BrowserProfileOpenResult>> {
  const profile = await getOrCreateBrowserProfile(accountName, options);
  if (!profile.success || !profile.data) return fail(...profile.diagnostics);

  const url = input.url || DEFAULT_BROWSER_URL;
  const headless = input.headless !== false;
  const loadedPlaywright = await loadPlaywright();
  if (!loadedPlaywright.success || !loadedPlaywright.data) return fail(...loadedPlaywright.diagnostics);

  const existing = openContexts.get(accountName);
  let context = existing?.context;
  if (!context) {
    try {
      context = await loadedPlaywright.data.chromium.launchPersistentContext(profile.data.userDataDir, {
        headless
      });
    } catch (error) {
      return fail(
        createDiagnostic('error', 'BROWSER_PROFILE_OPEN_FAILED', `Failed to open browser profile for account ${accountName}.`, {
          source: SOURCE,
          detail: error instanceof Error ? error.message : String(error),
          hint: 'Close any browser already using this profile. If Chromium is missing, run: pnpm exec playwright install chromium.'
        })
      );
    }
  }
  openContexts.set(accountName, { context, profile: profile.data });
  if (!existing) {
    context.on?.('close', () => {
      if (openContexts.get(accountName)?.context === context) openContexts.delete(accountName);
    });
  }

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);

  const updated = await updateBrowserProfile(
    accountName,
    {
      lastOpenedAt: new Date().toISOString()
    },
    options
  );
  if (!updated.success || !updated.data) return fail(...updated.diagnostics);

  return ok({
    account: accountName,
    configured: true,
    exists: true,
    open: true,
    profile: updated.data,
    url,
    alreadyOpen: Boolean(existing)
  });
}

export async function verifyBrowserProfile(
  accountName: string,
  input: { url?: string; headless?: boolean } = {},
  options: ConfigStoreOptions = {}
): Promise<OperationResult<BrowserProfileVerificationResult>> {
  const opened = await openPlaywrightBrowserProfile(accountName, { url: input.url || DEFAULT_BROWSER_URL, headless: input.headless }, options);
  if (!opened.success || !opened.data) return fail(...opened.diagnostics);

  const context = openContexts.get(accountName)?.context;
  const page = context?.pages()[0];
  const finalUrl = page?.url() ?? opened.data.url;
  const authenticated = !/login\.microsoftonline\.com|login\.live\.com|\/common\/oauth2|signin/i.test(finalUrl);
  const updated = await updateBrowserProfile(
    accountName,
    {
      lastVerifiedAt: new Date().toISOString(),
      lastVerificationUrl: finalUrl
    },
    options
  );
  if (!updated.success || !updated.data) return fail(...updated.diagnostics);

  return ok({
    ...opened.data,
    profile: updated.data,
    authenticated,
    finalUrl
  });
}

export async function resetBrowserProfile(accountName: string, options: ConfigStoreOptions = {}): Promise<OperationResult<BrowserProfileStatus>> {
  const account = await getAccount(accountName, options);
  if (!account.success) return fail(...account.diagnostics);
  if (!account.data) return accountNotFound(accountName);

  const open = openContexts.get(accountName);
  if (open) {
    openContexts.delete(accountName);
    await open.context.close().catch(() => undefined);
  }

  const loaded = await loadConfig(options);
  if (!loaded.success || !loaded.data) return fail(...loaded.diagnostics);
  const profile = loaded.data.browserProfiles[accountName];
  if (profile) {
    await rm(profile.userDataDir, { recursive: true, force: true }).catch(() => undefined);
    delete loaded.data.browserProfiles[accountName];
    const written = await writeConfig(loaded.data, options);
    if (!written.success) return fail(...written.diagnostics);
  }

  return ok({
    account: accountName,
    configured: false,
    exists: false,
    open: false
  });
}

async function getOrCreateBrowserProfile(accountName: string, options: ConfigStoreOptions): Promise<OperationResult<BrowserProfile>> {
  const account = await getAccount(accountName, options);
  if (!account.success) return fail(...account.diagnostics);
  if (!account.data) return accountNotFound(accountName);

  const loaded = await loadConfig(options);
  if (!loaded.success || !loaded.data) return fail(...loaded.diagnostics);

  const existing = loaded.data.browserProfiles[accountName];
  if (existing) {
    await mkdir(existing.userDataDir, { recursive: true });
    return ok(existing);
  }

  const profile: BrowserProfile = {
    account: accountName,
    kind: 'playwright-chromium',
    userDataDir: join(getBrowserProfilesRoot(options), profileDirectoryName(accountName)),
    createdAt: new Date().toISOString()
  };
  await mkdir(profile.userDataDir, { recursive: true });
  loaded.data.browserProfiles[accountName] = profile;
  const written = await writeConfig(loaded.data, options);
  return written.success ? ok(profile, written.diagnostics) : fail(...written.diagnostics);
}

async function updateBrowserProfile(accountName: string, patch: Partial<BrowserProfile>, options: ConfigStoreOptions): Promise<OperationResult<BrowserProfile>> {
  const loaded = await loadConfig(options);
  if (!loaded.success || !loaded.data) return fail(...loaded.diagnostics);
  const profile = loaded.data.browserProfiles[accountName];
  if (!profile) {
    return fail(createDiagnostic('error', 'BROWSER_PROFILE_NOT_FOUND', `Browser profile for account ${accountName} was not found.`, { source: SOURCE }));
  }
  const updated = { ...profile, ...patch };
  loaded.data.browserProfiles[accountName] = updated;
  const written = await writeConfig(loaded.data, options);
  return written.success ? ok(updated, written.diagnostics) : fail(...written.diagnostics);
}

async function loadPlaywright(): Promise<OperationResult<{ chromium: { launchPersistentContext: (userDataDir: string, options: Record<string, unknown>) => Promise<BrowserContextLike> } }>> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  const errors: string[] = [];
  for (const specifier of ['playwright', '@playwright/test']) {
    try {
      const module = (await dynamicImport(specifier)) as { chromium?: unknown };
      if (!module.chromium || typeof module.chromium !== 'object') {
        errors.push(`${specifier}: Chromium launcher was not exported.`);
        continue;
      }
      return ok(module as { chromium: { launchPersistentContext: (userDataDir: string, options: Record<string, unknown>) => Promise<BrowserContextLike> } });
    } catch (error) {
      errors.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return fail(
    createDiagnostic('error', 'PLAYWRIGHT_UNAVAILABLE', 'Playwright is not available to launch browser profiles.', {
      source: SOURCE,
      detail: errors.join('\n'),
      hint: 'Install Playwright and its Chromium browser, for example: pnpm add -D @playwright/test && pnpm exec playwright install chromium.'
    })
  );
}

function accountNotFound(accountName: string): OperationResult<never> {
  return fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${accountName} was not found.`, { source: SOURCE }));
}

function profileDirectoryName(accountName: string): string {
  const readable =
    accountName
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'account';
  const hash = createHash('sha256').update(accountName).digest('hex').slice(0, 10);
  return `${readable}-${hash}`;
}

function launchSystemBrowser(userDataDir: string, url: string): OperationResult<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(
      createDiagnostic('error', 'BROWSER_URL_INVALID', 'Browser profile URL is not a valid URL.', {
        source: SOURCE,
        detail: `Rejected url: ${url}`
      })
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail(
      createDiagnostic('error', 'BROWSER_URL_INVALID', 'Browser profile URL must use http or https.', {
        source: SOURCE,
        detail: `Rejected scheme: ${parsed.protocol}`
      })
    );
  }
  const safeUrl = parsed.toString();
  const candidates = browserCommandCandidates();
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (!commandAvailable(candidate.command)) {
      errors.push(`${candidate.command}: executable was not found.`);
      continue;
    }
    try {
      const child = spawn(candidate.command, [...candidate.args, ...browserProfileArgs(userDataDir), '--', safeUrl], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return ok(undefined);
    } catch (error) {
      errors.push(`${candidate.command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return fail(
    createDiagnostic('error', 'BROWSER_LAUNCH_FAILED', 'Could not launch an installed browser for this profile.', {
      source: SOURCE,
      detail: errors.join('\n'),
      hint: 'Install Chrome, Edge, Chromium, or set PP_BROWSER to a browser executable.'
    })
  );
}

function browserCommandCandidates(): Array<{ command: string; args: string[] }> {
  const envBrowser = process.env.PP_BROWSER;
  const candidates: Array<{ command: string; args: string[] }> = [];
  if (envBrowser) candidates.push({ command: envBrowser, args: [] });
  if (process.platform === 'darwin') {
    candidates.push(
      { command: 'open', args: ['-na', 'Google Chrome', '--args'] },
      { command: 'open', args: ['-na', 'Microsoft Edge', '--args'] },
      { command: 'open', args: ['-na', 'Chromium', '--args'] }
    );
    return candidates;
  }
  if (process.platform === 'win32') {
    candidates.push({ command: 'msedge.exe', args: [] }, { command: 'chrome.exe', args: [] }, { command: 'chromium.exe', args: [] });
    return candidates;
  }
  candidates.push(
    { command: 'google-chrome', args: [] },
    { command: 'google-chrome-stable', args: [] },
    { command: 'microsoft-edge', args: [] },
    { command: 'microsoft-edge-stable', args: [] },
    { command: 'chromium', args: [] },
    { command: 'chromium-browser', args: [] }
  );
  return candidates;
}

function browserProfileArgs(userDataDir: string): string[] {
  return [`--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check'];
}

function commandAvailable(command: string): boolean {
  if (command.includes('/') || command.includes('\\')) {
    return spawnSync(command, ['--version'], { stdio: 'ignore' }).error === undefined;
  }
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], { stdio: 'ignore' });
  return result.status === 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
