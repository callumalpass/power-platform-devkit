import { access, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath, extname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeJsonFile } from '@pp/artifacts';
import {
  createMutationPreview,
  renderFailure,
  renderOutput,
  renderResultDiagnostics,
  readMutationFlags,
  resolveOutputFormat,
  type CliOutputFormat,
} from './contract';
import { getGlobalConfigDir, type ConfigStoreOptions } from '@pp/config';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import YAML from 'yaml';

export type OutputFormat = CliOutputFormat;

export function printByFormat(value: unknown, format: OutputFormat): void {
  process.stdout.write(renderOutput(value, format));
}

export function isMachineReadableOutputFormat(format: OutputFormat): boolean {
  return format === 'json' || format === 'yaml' || format === 'ndjson';
}

export function printFailure(result: OperationResult<unknown>): number {
  const format = resolveProcessOutputFormat();

  if (isMachineReadableOutputFormat(format)) {
    process.stdout.write(renderFailure(result, format));
    return 1;
  }

  process.stderr.write(renderFailure(result, format));
  return 1;
}

export function printFailureWithMachinePayload(result: OperationResult<unknown>, format: OutputFormat): number {
  if (isMachineReadableOutputFormat(format)) {
    process.stdout.write(renderFailure(result, format));
    return 1;
  }

  return printFailure(result);
}

export function printWarnings(result: OperationResult<unknown>): void {
  if ((result.warnings?.length ?? 0) === 0) {
    return;
  }

  const warningOnly: OperationResult<unknown> = {
    ...result,
    diagnostics: [],
  };
  const rendered = renderResultDiagnostics(warningOnly, resolveProcessOutputFormat());

  if (rendered.length > 0) {
    process.stderr.write(rendered);
  }
}

export function printResultDiagnostics(result: OperationResult<unknown>, format: OutputFormat): void {
  const diagnostics = renderResultDiagnostics(result, format);

  if (diagnostics.length > 0) {
    process.stderr.write(diagnostics);
  }
}

export function maybeHandleMutationPreview(
  args: string[],
  fallbackFormat: OutputFormat,
  action: string,
  target: Record<string, unknown>,
  input?: unknown
): number | undefined {
  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return printFailure(mutation);
  }

  if (mutation.data.mode === 'apply') {
    return undefined;
  }

  printByFormat(createMutationPreview(action, mutation.data, target, input), outputFormat(args, fallbackFormat));
  return 0;
}

export function outputFormat(args: string[], fallback: OutputFormat): OutputFormat {
  return resolveOutputFormat(args, fallback);
}

export function readConfigOptions(args: string[]): ConfigStoreOptions {
  const configDir = readFlag(args, '--config-dir');
  return configDir ? { configDir: resolveCliConfigDir(configDir) } : {};
}

export function readPublicClientLoginOptions(args: string[]): { allowInteractive?: boolean } | undefined {
  if (hasFlag(args, '--no-interactive-auth')) {
    return {
      allowInteractive: false,
    };
  }

  return undefined;
}

export function resolveCliConfigDir(configDir: string): string {
  if (isAbsolute(configDir)) {
    return configDir;
  }

  return resolvePath(resolveDefaultInvocationPath(), configDir);
}

export function resolveInvocationPath(path?: string): string {
  if (!path) {
    return resolveDefaultInvocationPath();
  }

  if (isAbsolute(path)) {
    return path;
  }

  return resolvePath(resolveDefaultInvocationPath(), path);
}

export function resolveOptionalInvocationPath(path?: string): string | undefined {
  return path ? resolveInvocationPath(path) : undefined;
}

export function resolveDefaultInvocationPath(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

export function readProjectDiscoveryOptions(args: string[]): OperationResult<{ stage?: string; parameterOverrides?: Record<string, string> }> {
  const parameterOverrides = readParameterOverrides(args);

  if (!parameterOverrides.success || !parameterOverrides.data) {
    return parameterOverrides;
  }

  return ok(
    {
      stage: readFlag(args, '--stage'),
      parameterOverrides: Object.keys(parameterOverrides.data).length > 0 ? parameterOverrides.data : undefined,
    },
    {
      supportTier: 'preview',
    }
  );
}

export function readFlag(args: string[], name: string): string | undefined {
  for (const candidate of flagAliases(name)) {
    const index = args.indexOf(candidate);

    if (index !== -1) {
      return args[index + 1];
    }
  }

  return undefined;
}

export function hasFlag(args: string[], name: string): boolean {
  return flagAliases(name).some((candidate) => args.includes(candidate));
}

export async function promptForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

export async function promptForInput(message: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

export function readRepeatedFlags(args: string[], name: string): string[] {
  const values: string[] = [];
  const aliases = new Set(flagAliases(name));

  for (let index = 0; index < args.length; index += 1) {
    if (aliases.has(args[index] ?? '') && args[index + 1]) {
      values.push(args[index + 1] as string);
      index += 1;
    }
  }

  return values;
}

export function readAnalysisPortfolioProjectPaths(args: string[]): string[] {
  const configured = [...readRepeatedFlags(args, '--project'), ...positionalArgs(args)];
  return configured.length > 0 ? configured : [resolveDefaultInvocationPath()];
}

export function readParameterOverrides(args: string[]): OperationResult<Record<string, string>> {
  const overrides: Record<string, string> = {};

  for (const value of readRepeatedFlags(args, '--param')) {
    const separatorIndex = value.indexOf('=');

    if (separatorIndex <= 0) {
      return argumentFailure('PROJECT_PARAM_OVERRIDE_INVALID', 'Use `--param NAME=VALUE` for project parameter overrides.');
    }

    overrides[value.slice(0, separatorIndex)] = value.slice(separatorIndex + 1);
  }

  return ok(overrides, {
    supportTier: 'preview',
  });
}

export function readListFlag(args: string[], name: string): string[] | undefined {
  const value = readFlag(args, name);
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
}

export function readNumberFlag(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  return value ? Number(value) : undefined;
}

export function readValueFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];

  if (!value || value.startsWith('-')) {
    return undefined;
  }

  return value;
}

export async function readJsonBodyArgument(args: string[]): Promise<OperationResult<unknown | undefined>> {
  try {
    const inlineBody = readFlag(args, '--body');

    if (inlineBody) {
      return ok(JSON.parse(inlineBody), { supportTier: 'preview' });
    }

    const bodyFile = readFlag(args, '--body-file');

    if (!bodyFile) {
      return ok(undefined, { supportTier: 'preview' });
    }

    return ok(JSON.parse(await readFile(bodyFile, 'utf8')), { supportTier: 'preview' });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_BODY_INVALID', 'Failed to parse JSON request body.', {
        source: '@pp/cli',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export async function readJsonFileForCli(path: string, code: string, message: string): Promise<OperationResult<unknown>> {
  try {
    return ok(JSON.parse(await readFile(path, 'utf8')), {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', code, message, {
        source: '@pp/cli',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeStructuredArtifact(path: string, value: unknown): Promise<void> {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) {
    await writeFile(path, YAML.stringify(value), 'utf8');
    return;
  }

  await writeJsonFile(path, value as never);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function dedupeStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function readStructuredSpecArgument(
  args: string[],
  flagName: string,
  missingCode: string,
  missingMessage: string
): Promise<OperationResult<unknown>> {
  const file = readFlag(args, flagName);

  if (!file) {
    return argumentFailure(missingCode, missingMessage);
  }

  return readStructuredSpecFile(file);
}

export async function readStructuredSpecFile(file: string): Promise<OperationResult<unknown>> {
  try {
    const contents = await readFile(file, 'utf8');
    const parsed = parseStructuredText(contents, file);

    if (!parsed.success || parsed.data === undefined) {
      return parsed;
    }

    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return fail(
        createDiagnostic('error', 'CLI_SPEC_INVALID', 'Structured spec files must parse to an object.', {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    return parsed;
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_READ_FAILED', 'Failed to read structured spec file.', {
        source: '@pp/cli',
        path: file,
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export function parseStructuredText(contents: string, sourcePath: string): OperationResult<unknown> {
  try {
    const trimmed = contents.trim();
    const lowerPath = sourcePath.toLowerCase();
    const data =
      lowerPath.endsWith('.json')
        ? JSON.parse(trimmed)
        : lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')
          ? YAML.parse(contents)
          : tryParseJsonOrYaml(contents);

    return ok(data, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_PARSE_FAILED', 'Failed to parse structured spec file as JSON or YAML.', {
        source: '@pp/cli',
        path: sourcePath,
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export function tryParseJsonOrYaml(contents: string): unknown {
  const trimmed = contents.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    return YAML.parse(contents);
  }
}

export function readStringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value.filter((entry): entry is string => typeof entry === 'string');
  return entries.length > 0 ? entries : undefined;
}

export function readHeaderFlags(args: string[]): Record<string, string> | undefined {
  const entries = readRepeatedFlags(args, '--header')
    .map((value) => {
      const separatorIndex = value.indexOf(':');

      if (separatorIndex === -1) {
        return undefined;
      }

      const key = value.slice(0, separatorIndex).trim();
      const headerValue = value.slice(separatorIndex + 1).trim();

      if (!key || !headerValue) {
        return undefined;
      }

      return [key, headerValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function positionalArgs(args: string[]): string[] {
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (!current) {
      continue;
    }

    if (current.startsWith('--')) {
      if (!BOOLEAN_FLAGS.has(current)) {
        index += 1;
      }
      continue;
    }

    positional.push(current);
  }

  return positional;
}

export function argumentFailure(code: string, message: string): OperationResult<never> {
  return fail(
    createDiagnostic('error', code, message, {
      source: '@pp/cli',
    })
  );
}

export function readSolutionOutputTarget(value: string | undefined): { outPath?: string; outDir?: string } {
  if (!value) {
    return {};
  }

  return extname(value).toLowerCase() === '.zip' ? { outPath: value } : { outDir: value };
}

const BOOLEAN_FLAGS = new Set([
  '--all',
  '--allow-delete',
  '--count',
  '--continue-on-error',
  '--dry-run',
  '--device-code',
  '--device-code-fallback',
  '--force-prompt',
  '--holding-solution',
  '--managed',
  '--no-device-code-fallback',
  '--no-interactive',
  '--no-publish',
  '--no-publish-workflows',
  '--overwrite-unmanaged-customizations',
  '--page-info',
  '--plan',
  '--return-representation',
  '--skip-product-update-dependencies',
  '--yes',
]);

function flagAliases(name: string): string[] {
  switch (name) {
    case '--env':
    case '--environment':
      return ['--env', '--environment'];
    default:
      return [name];
  }
}

function resolveProcessOutputFormat(): OutputFormat {
  return outputFormat(process.argv.slice(2), 'json');
}
