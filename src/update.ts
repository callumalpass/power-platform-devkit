import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getDefaultConfigDir } from './config.js';
import { VERSION } from './version.js';

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/callumalpass/power-platform-devkit/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const UPDATE_HELP = [
  'pp update',
  '',
  'Check GitHub releases for a newer pp version.',
  '',
  'Usage:',
  '  pp update [--check]',
  '',
  'Options:',
  '  --check    Check only and print update instructions when available',
  '',
  'pp does not install updates automatically. Follow the printed npm or release download instructions.',
].join('\n');

export interface UpdateCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
  releaseUrl: string;
  checkedAt: string;
}

export function getInstallKind(): 'sea' | 'npm' {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require('node:sea') as { isSea(): boolean };
    if (sea.isSea()) return 'sea';
  } catch {
    // not an SEA binary
  }
  return 'npm';
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function cachePath(configDir?: string): string {
  return join(configDir ?? getDefaultConfigDir(), 'update-check.json');
}

export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(GITHUB_RELEASES_URL, {
      signal: controller.signal,
      headers: { 'user-agent': `pp/${VERSION}` },
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: string; html_url?: string };
    const latest = (data.tag_name ?? '').replace(/^v/, '');
    if (!latest) return null;
    return {
      current: VERSION,
      latest,
      updateAvailable: compareVersions(latest, VERSION) > 0,
      releaseUrl: data.html_url ?? '',
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getCachedUpdateCheck(configDir?: string): Promise<UpdateCheckResult | null> {
  try {
    const raw = await readFile(cachePath(configDir), 'utf8');
    const cached = JSON.parse(raw) as UpdateCheckResult;
    if (!cached.checkedAt) return null;
    const age = Date.now() - new Date(cached.checkedAt).getTime();
    if (age > CHECK_INTERVAL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

async function writeCacheFile(result: UpdateCheckResult, configDir?: string): Promise<void> {
  const path = cachePath(configDir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(result, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

export function runBackgroundUpdateCheck(configDir?: string): void {
  checkForUpdate()
    .then((result) => {
      if (result) return writeCacheFile(result, configDir);
    })
    .catch(() => {});
}

export function formatUpdateNotice(result: UpdateCheckResult): string {
  const kind = getInstallKind();
  const base = `Update available: ${result.current} → ${result.latest}.`;
  if (kind === 'npm') return `${base} Run "npm install -g pp@latest" to update.`;
  return `${base} Download from ${result.releaseUrl}`;
}

const PASSIVE_EXCLUDED_COMMANDS = new Set(['mcp', 'token', 'completion', 'update', 'version', '--version']);

export function shouldShowUpdateNotice(command: string | undefined): boolean {
  if (!process.stderr.isTTY) return false;
  if (!command) return false;
  return !PASSIVE_EXCLUDED_COMMANDS.has(command);
}

export function shouldRunBackgroundUpdateCheck(command: string | undefined, cached: UpdateCheckResult | null): boolean {
  return shouldShowUpdateNotice(command) && cached == null;
}

export async function runUpdateCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${UPDATE_HELP}\n`);
    return 0;
  }
  const checkOnly = args.includes('--check');
  process.stderr.write('Checking for updates...\n');
  const result = await checkForUpdate();
  if (!result) {
    process.stderr.write('Could not reach GitHub to check for updates.\n');
    return 1;
  }
  await writeCacheFile(result);
  if (!result.updateAvailable) {
    process.stdout.write(`pp ${result.current} is the latest version.\n`);
    return 0;
  }
  if (checkOnly) {
    process.stdout.write(`${formatUpdateNotice(result)}\n`);
    return 0;
  }
  const kind = getInstallKind();
  if (kind === 'npm') {
    process.stdout.write(`${formatUpdateNotice(result)}\n`);
    return 0;
  }
  process.stdout.write(`${formatUpdateNotice(result)}\n`);
  return 0;
}
