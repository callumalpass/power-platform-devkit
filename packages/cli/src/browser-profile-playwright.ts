import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import type { BrowserProfile } from '@pp/auth';

export interface PersistentBrowserContextLaunchOptions {
  browserProfileName: string;
  outDir: string;
  headless: boolean;
  slowMoMs: number;
}

export interface PersistentBrowserContextLaunchDetails {
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

const PROFILE_LOCK_OMIT_ENTRIES = ['SingletonCookie', 'SingletonLock', 'SingletonSocket'];

export async function launchPersistentBrowserProfileContext(
  userDataDir: string,
  browserProfile: BrowserProfile,
  options: PersistentBrowserContextLaunchOptions
): Promise<PersistentBrowserContextLaunchDetails & { context: BrowserContext }> {
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

function slugify(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
