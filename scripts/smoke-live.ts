import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadGlobalConfigOrDefault } from '../packages/config/src/index.ts';

interface SmokeCommandResult<T> {
  label: string;
  data: T;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const configDir = process.env.PP_CONFIG_DIR;
  const config = await loadGlobalConfigOrDefault(configDir ? { configDir } : {});

  if (!config.success || !config.data) {
    throw new Error(config.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; ') || 'Failed to load pp config.');
  }

  const target = selectSmokeTarget(config.data.config.environments, process.env.PP_SMOKE_ENV, process.env.PP_SMOKE_PROFILE);

  if (!target) {
    throw new Error('No smoke-test target could be resolved. Set PP_SMOKE_ENV or configure a test-like environment alias.');
  }

  logPhase(`target env=${target.alias} profile=${target.authProfile}`);

  const profile = runCli<Record<string, unknown>>('auth profile inspect', ['auth', 'profile', 'inspect', target.authProfile], configDir);
  assertValue(typeof profile.data.name === 'string', 'Auth profile inspect did not return a profile name.');

  const whoAmI = runCli<Record<string, unknown>>(
    'dv whoami',
    ['dv', 'whoami', '--env', target.alias, '--no-interactive-auth'],
    configDir
  );
  assertValue(typeof whoAmI.data.OrganizationId === 'string', 'WhoAmI did not return OrganizationId.');
  assertValue(typeof whoAmI.data.UserId === 'string', 'WhoAmI did not return UserId.');

  const solutions = runCli<Array<Record<string, unknown>>>(
    'solution list',
    ['solution', 'list', '--env', target.alias, '--no-interactive-auth'],
    configDir
  );
  assertValue(Array.isArray(solutions.data), 'Solution list did not return an array.');

  const tables = runCli<Array<Record<string, unknown>>>(
    'dv metadata tables',
    ['dv', 'metadata', 'tables', '--env', target.alias, '--top', '1', '--no-interactive-auth'],
    configDir
  );
  assertValue(Array.isArray(tables.data) && tables.data.length > 0, 'Metadata table smoke query returned no records.');

  const columns = runCli<Array<Record<string, unknown>>>(
    'dv metadata columns',
    ['dv', 'metadata', 'columns', 'account', '--env', target.alias, '--top', '1', '--no-interactive-auth'],
    configDir
  );
  assertValue(Array.isArray(columns.data) && columns.data.length > 0, 'Metadata column smoke query returned no records.');

  process.stdout.write(`WhoAmI OK: organization=${whoAmI.data.OrganizationId} user=${whoAmI.data.UserId}\n`);
  process.stdout.write(`Solutions OK: count=${solutions.data.length}\n`);
  process.stdout.write(`Metadata tables OK: first=${String(tables.data[0]?.LogicalName ?? '<unknown>')}\n`);
  process.stdout.write(`Metadata columns OK: first=${String(columns.data[0]?.logicalName ?? columns.data[0]?.LogicalName ?? '<unknown>')}\n`);
  logPhase('completed');
}

function selectSmokeTarget(
  environments: Record<string, { alias: string; authProfile: string }>,
  requestedAlias: string | undefined,
  requestedProfile: string | undefined
): { alias: string; authProfile: string } | undefined {
  if (requestedAlias) {
    const exact = environments[requestedAlias];
    if (!exact) {
      throw new Error(`Configured smoke environment ${requestedAlias} was not found.`);
    }
    if (requestedProfile && exact.authProfile !== requestedProfile) {
      throw new Error(`Smoke environment ${requestedAlias} is bound to ${exact.authProfile}, not ${requestedProfile}.`);
    }
    return {
      alias: requestedAlias,
      authProfile: exact.authProfile,
    };
  }

  const entries = Object.entries(environments);

  if (requestedProfile) {
    const match = entries.find(([, environment]) => environment.authProfile === requestedProfile);
    if (!match) {
      throw new Error(`No configured environment alias is bound to smoke profile ${requestedProfile}.`);
    }

    return {
      alias: match[0],
      authProfile: match[1].authProfile,
    };
  }

  const preferred = entries.find(([alias, environment]) => {
    const haystack = `${alias} ${environment.authProfile}`.toLowerCase();
    return haystack.includes('test') || haystack.includes('smoke');
  });

  if (preferred) {
    return {
      alias: preferred[0],
      authProfile: preferred[1].authProfile,
    };
  }

  if (entries.length === 1) {
    return {
      alias: entries[0][0],
      authProfile: entries[0][1].authProfile,
    };
  }

  return undefined;
}

function runCli<T>(label: string, args: string[], configDir: string | undefined): SmokeCommandResult<T> {
  const fullArgs = ['scripts/run-pp-dev.mjs', ...args, '--format', 'json'];

  if (configDir) {
    fullArgs.push('--config-dir', configDir);
  }

  logPhase(`start ${label}`);
  const result = spawnSync('node', fullArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status ?? 1}\n${formatCommandOutput(result.stdout, result.stderr)}`
    );
  }

  try {
    logPhase(`ok ${label}`);
    return {
      label,
      data: JSON.parse(result.stdout) as T,
    };
  } catch (error) {
    throw new Error(
      `${label} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}\n${result.stdout.trim()}`
    );
  }
}

function logPhase(message: string): void {
  process.stdout.write(`[smoke] ${message}\n`);
}

function formatCommandOutput(stdout: string, stderr: string): string {
  const rendered = [
    stdout.trim() ? `stdout:\n${stdout.trim()}` : undefined,
    stderr.trim() ? `stderr:\n${stderr.trim()}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return rendered.join('\n\n') || '<no output>';
}

function assertValue(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
