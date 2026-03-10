import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AuthService, resolveBrowserProfileDirectory } from '../packages/auth/src/index';
import { resolveDataverseClient } from '../packages/dataverse/src/index';
import { runDelegatedCanvasCreate } from '../packages/cli/src/canvas-create-delegate';

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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });

  const resolution = await resolveDataverseClient(options.envAlias, readConfigOptions(options));
  assertResult(resolution.success && resolution.data, `Failed to resolve environment alias ${options.envAlias}.`);

  const authService = new AuthService(readConfigOptions(options));
  const browserProfileResult = await authService.getBrowserProfile(options.browserProfileName);
  assertResult(browserProfileResult.success && browserProfileResult.data, `Browser profile ${options.browserProfileName} was not found.`);

  const solution = await resolution.data.client.query<{ solutionid: string }>({
    table: 'solutions',
    select: ['solutionid'],
    filter: `uniquename eq '${escapeODataLiteral(options.solutionUniqueName)}'`,
    top: 1,
  });
  assertResult(solution.success && solution.data?.[0]?.solutionid, `Solution ${options.solutionUniqueName} was not found.`);

  const browserProfileDir = resolveBrowserProfileDirectory(browserProfileResult.data, readConfigOptions(options));
  await mkdir(browserProfileDir, { recursive: true });

  const delegated = await runDelegatedCanvasCreate({
    envAlias: options.envAlias,
    solutionUniqueName: options.solutionUniqueName,
    solutionId: solution.data[0].solutionid,
    appName: options.appName,
    browserProfileName: options.browserProfileName,
    browserProfile: browserProfileResult.data,
    browserProfileDir,
    client: resolution.data.client,
    targetUrl: options.targetUrl,
    makerEnvironmentId: options.makerEnvironmentId ?? resolution.data.environment.makerEnvironmentId,
    outDir: options.outDir,
    headless: options.headless,
    slowMoMs: options.slowMoMs,
    timeoutMs: options.timeoutMs,
    pollTimeoutMs: options.pollTimeoutMs,
    settleMs: options.settleMs,
  });

  if (!delegated.success || !delegated.data) {
    throw new Error(delegated.diagnostics[0]?.message ?? 'Delegated canvas create failed.');
  }

  process.stdout.write(`${JSON.stringify(delegated.data, null, 2)}\n`);
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
