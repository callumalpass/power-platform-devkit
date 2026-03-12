import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadGlobalConfigOrDefault } from '../packages/config/src/index.ts';

interface SmokeCommandResult<T> {
  label: string;
  data: T;
}

interface SmokeSuccessEnvelope {
  data?: unknown;
  results?: unknown;
  runs?: unknown;
  success?: boolean;
}

interface SmokeExpectations {
  solutionUniqueName?: string;
  canvas?: {
    identifier: string;
    solutionUniqueName?: string;
  };
  rows?: Array<{
    table: string;
    filter?: string;
    solutionUniqueName?: string;
    label?: string;
  }>;
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
  const expectations = parseSmokeExpectations(process.env.PP_SMOKE_EXPECTATIONS_JSON);

  const profile = runCli<Record<string, unknown>>('auth profile inspect', ['auth', 'profile', 'inspect', target.authProfile], configDir);
  assertValue(typeof profile.data.name === 'string', 'Auth profile inspect did not return a profile name.');

  const whoAmI = runCli<Record<string, unknown>>(
    'dv whoami',
    ['dv', 'whoami', '--env', target.alias, '--no-interactive-auth'],
    configDir
  );
  assertValue(typeof whoAmI.data.OrganizationId === 'string', 'WhoAmI did not return OrganizationId.');
  assertValue(typeof whoAmI.data.UserId === 'string', 'WhoAmI did not return UserId.');

  const solutions = asRecordArray(
    runCli<unknown>(
    'solution list',
    ['solution', 'list', '--env', target.alias, '--no-interactive-auth'],
    configDir
  ).data
  );
  assertValue(solutions.length > 0, 'Solution list did not return any rows.');

  const tables = asRecordArray(
    runCli<unknown>(
    'dv metadata tables',
    ['dv', 'metadata', 'tables', '--env', target.alias, '--top', '1', '--no-interactive-auth'],
    configDir
  ).data
  );
  assertValue(tables.length > 0, 'Metadata table smoke query returned no records.');

  const columns = asRecordArray(
    runCli<unknown>(
    'dv metadata columns',
    ['dv', 'metadata', 'columns', 'account', '--env', target.alias, '--top', '1', '--no-interactive-auth'],
    configDir
  ).data
  );
  assertValue(columns.length > 0, 'Metadata column smoke query returned no records.');

  const assertedSolution = expectations?.solutionUniqueName
    ? assertSmokeSolution(expectations.solutionUniqueName, solutions)
    : undefined;
  const assertedCanvas = expectations?.canvas
    ? assertSmokeCanvas(target.alias, expectations.canvas, configDir)
    : undefined;
  const assertedRows = expectations?.rows?.map((row) => assertSmokeRow(target.alias, row, configDir)) ?? [];

  process.stdout.write(`WhoAmI OK: organization=${whoAmI.data.OrganizationId} user=${whoAmI.data.UserId}\n`);
  process.stdout.write(`Solutions OK: count=${solutions.length}\n`);
  process.stdout.write(`Metadata tables OK: first=${String(tables[0]?.LogicalName ?? tables[0]?.logicalName ?? '<unknown>')}\n`);
  process.stdout.write(`Metadata columns OK: first=${String(columns[0]?.logicalName ?? columns[0]?.LogicalName ?? '<unknown>')}\n`);
  if (assertedSolution) {
    process.stdout.write(`Scenario solution OK: ${assertedSolution.uniquename ?? expectations?.solutionUniqueName}\n`);
  }
  if (assertedCanvas) {
    process.stdout.write(`Scenario canvas OK: id=${String(assertedCanvas.id ?? '<unknown>')} name=${String(assertedCanvas.displayName ?? assertedCanvas.name ?? '<unknown>')}\n`);
  }
  for (const row of assertedRows) {
    process.stdout.write(`Scenario row OK: ${row.label} count=${row.count}\n`);
  }
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

function parseSmokeExpectations(raw: string | undefined): SmokeExpectations | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as SmokeExpectations;
  } catch (error) {
    throw new Error(`PP_SMOKE_EXPECTATIONS_JSON is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown>>;
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const envelope = value as SmokeSuccessEnvelope;

  if (Array.isArray(envelope.data)) {
    return envelope.data as Array<Record<string, unknown>>;
  }

  if (Array.isArray(envelope.results)) {
    return envelope.results as Array<Record<string, unknown>>;
  }

  if (Array.isArray(envelope.runs)) {
    return envelope.runs as Array<Record<string, unknown>>;
  }

  return [];
}

function assertSmokeSolution(solutionUniqueName: string, solutions: Array<Record<string, unknown>>): Record<string, unknown> {
  const match = solutions.find((solution) => solution.uniquename === solutionUniqueName);
  assertValue(match, `Smoke solution assertion failed: ${solutionUniqueName} was not present in solution list output.`);
  logPhase(`ok scenario solution ${solutionUniqueName}`);
  return match;
}

function assertSmokeCanvas(
  envAlias: string,
  canvas: NonNullable<SmokeExpectations['canvas']>,
  configDir: string | undefined
): Record<string, unknown> {
  const args = ['canvas', 'list', '--env', envAlias, '--no-interactive-auth'];
  if (canvas.solutionUniqueName) {
    args.push('--solution', canvas.solutionUniqueName);
  }

  const apps = asRecordArray(runCli<unknown>(`scenario canvas ${canvas.identifier}`, args, configDir).data);
  const normalized = canvas.identifier.toLowerCase();
  const match = apps.find((app) => {
    const id = typeof app.id === 'string' ? app.id.toLowerCase() : undefined;
    const name = typeof app.name === 'string' ? app.name.toLowerCase() : undefined;
    const displayName = typeof app.displayName === 'string' ? app.displayName.toLowerCase() : undefined;
    return id === normalized || name === normalized || displayName === normalized;
  });
  assertValue(match, `Smoke canvas assertion failed: ${canvas.identifier} was not present in canvas list output.`);
  assertValue(typeof match.id === 'string', `Smoke canvas assertion failed: ${canvas.identifier} did not return a remote canvas app id.`);
  return match;
}

function assertSmokeRow(
  envAlias: string,
  row: NonNullable<SmokeExpectations['rows']>[number],
  configDir: string | undefined
): { label: string; count: number } {
  const args = ['dv', 'query', row.table, '--env', envAlias, '--no-interactive-auth', '--top', '1'];
  if (row.filter) {
    args.push('--filter', row.filter);
  }
  if (row.solutionUniqueName) {
    args.push('--solution', row.solutionUniqueName);
  }

  const records = asRecordArray(runCli<unknown>(`scenario row ${row.label ?? row.table}`, args, configDir).data);
  assertValue(records.length > 0, `Smoke row assertion failed: ${row.label ?? row.table} returned no rows.`);
  return {
    label: row.label ?? row.table,
    count: records.length,
  };
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
