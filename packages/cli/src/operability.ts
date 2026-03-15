import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getGlobalConfigDir, getGlobalConfigFilePath, getMsalCacheDir, type ConfigStoreOptions } from '@pp/config';
import { createDiagnostic, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { discoverProject } from '@pp/project';
import packageJson from '../package.json';
import { buildCompletionNodes, type CliCompletionNode, type CliOptionSpec } from './cli-command-spec';

export const CLI_PACKAGE_NAME = packageJson.name;
export const CLI_VERSION = packageJson.version;
const COMPLETION_NODES = buildCompletionNodes();

export interface OperabilityBundle {
  generatedAt: string;
  cli: {
    name: string;
    packageName: string;
    version: string;
    packageRoot: string;
    entryPath: string;
  };
  runtime: {
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    execPath: string;
    shell?: string;
    term?: string;
    ci: boolean;
    initCwd?: string;
    npmUserAgent?: string;
  };
  config: {
    dir: string;
    file: string;
    msalCacheDir: string;
    dirExists: boolean;
    fileExists: boolean;
    msalCacheDirExists: boolean;
  };
  project: {
    inspectedPath: string;
    exists: boolean;
    discovered: boolean;
    root?: string;
    configPath?: string;
    providerBindingCount?: number;
    assetRoots?: string[];
    unresolvedRequiredParameters?: string[];
    diagnostics: Diagnostic[];
    warnings: Diagnostic[];
  };
}

export interface OperabilityDoctorReport {
  status: 'ok' | 'warning' | 'error';
  summary: {
    version: string;
    inspectedPath: string;
    projectRoot?: string;
    configDir: string;
    configFile: string;
    discoveredProject: boolean;
  };
  findings: Array<{
    level: Diagnostic['level'];
    code: string;
    message: string;
    hint?: string;
    path?: string;
  }>;
  suggestedNextActions: string[];
}

function resolveCurrentModulePath(): string | undefined {
  return typeof __filename === 'string' ? __filename : undefined;
}

function resolveCliArgvEntryPath(): string | undefined {
  const entryPath = process.argv[1];

  if (!entryPath) {
    return undefined;
  }

  try {
    const resolved = resolve(entryPath);
    const normalized = resolved.replaceAll('\\', '/');
    return normalized.includes('/packages/cli/src/') || normalized.includes('/packages/cli/dist/') ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function resolveCliPackageRoot(): string {
  const argvEntryPath = resolveCliArgvEntryPath();

  if (argvEntryPath) {
    return dirname(dirname(argvEntryPath));
  }

  const modulePath = resolveCurrentModulePath();

  if (modulePath) {
    return dirname(resolve(modulePath, '..', '..', 'package.json'));
  }

  return resolve(process.cwd(), 'packages', 'cli');
}

export function renderCompletionScript(shell: 'bash' | 'zsh' | 'fish' | 'pwsh'): string {
  switch (shell) {
    case 'bash':
      return renderBashCompletion();
    case 'zsh':
      return renderZshCompletion();
    case 'fish':
      return renderFishCompletion();
    case 'pwsh':
      return renderPwshCompletion();
  }
}

export async function collectOperabilityBundle(
  startPath: string | undefined,
  configOptions: ConfigStoreOptions = {}
): Promise<OperationResult<OperabilityBundle>> {
  const inspectedPath = resolve(startPath ?? process.cwd());
  const pathExists = await pathExistsOnDisk(inspectedPath);

  const configDir = getGlobalConfigDir(configOptions);
  const configFile = getGlobalConfigFilePath(configOptions);
  const msalCacheDir = getMsalCacheDir(configOptions);
  const [configDirExists, configFileExists, msalCacheDirExists] = await Promise.all([
    pathExistsOnDisk(configDir),
    pathExistsOnDisk(configFile),
    pathExistsOnDisk(msalCacheDir),
  ]);

  const diagnostics: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  if (!pathExists) {
    diagnostics.push(
      createDiagnostic('error', 'DIAGNOSTICS_PATH_NOT_FOUND', `Diagnostics target ${inspectedPath} does not exist.`, {
        source: '@pp/cli',
        path: inspectedPath,
        hint: 'Point diagnostics at an existing repo or working directory.',
      })
    );
  }

  if (!configDirExists) {
    warnings.push(
      createDiagnostic('warning', 'PP_CONFIG_DIR_MISSING', `Global pp config directory ${configDir} does not exist yet.`, {
        source: '@pp/cli',
        path: configDir,
        hint: 'Run an auth or env command once, or set --config-dir to an existing isolated config root.',
      })
    );
  }

  if (!configFileExists) {
    warnings.push(
      createDiagnostic('warning', 'PP_CONFIG_FILE_MISSING', `Global pp config file ${configFile} does not exist yet.`, {
        source: '@pp/cli',
        path: configFile,
        hint: 'Create auth profiles or environment aliases before expecting global config state.',
      })
    );
  }

  let project: OperabilityBundle['project'] = {
    inspectedPath,
    exists: pathExists,
    discovered: false,
    diagnostics: [],
    warnings: [],
  };

  if (pathExists) {
    const projectResult = await discoverProject(inspectedPath);

    if (projectResult.success && projectResult.data) {
      const projectDiagnostics = projectResult.data.diagnostics ?? [];
      const projectErrors = projectDiagnostics.filter((item) => item.level === 'error');
      const projectWarnings = projectDiagnostics.filter((item) => item.level === 'warning');
      const unresolvedRequiredParameters = Object.values(projectResult.data.parameters)
        .filter((parameter) => parameter.definition.required && !parameter.hasValue)
        .map((parameter) => parameter.name);
      const projectDiscovered = Boolean(projectResult.data.configPath);

      project = {
        inspectedPath,
        exists: true,
        discovered: projectDiscovered,
        root: projectResult.data.root,
        configPath: projectResult.data.configPath,
        providerBindingCount: Object.keys(projectResult.data.providerBindings).length,
        assetRoots: Object.values(projectResult.data.assets)
          .map((asset) => asset.path)
          .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index),
        unresolvedRequiredParameters,
        diagnostics: projectErrors,
        warnings: projectWarnings,
      };

      diagnostics.push(...projectErrors);
      warnings.push(...projectWarnings);

      if (!projectDiscovered) {
        warnings.push(
          createDiagnostic('warning', 'PP_PROJECT_NOT_FOUND', `No pp project config was discovered from ${inspectedPath}.`, {
            source: '@pp/cli',
            path: inspectedPath,
            hint: 'Run `pp project init` to scaffold a local project, or point diagnostics at an existing pp project root.',
          })
        );
      }
    } else {
      project = {
        inspectedPath,
        exists: true,
        discovered: false,
        diagnostics: [],
        warnings: projectResult.diagnostics ?? [],
      };

      warnings.push(
        createDiagnostic('warning', 'PP_PROJECT_NOT_FOUND', `No pp project config was discovered from ${inspectedPath}.`, {
          source: '@pp/cli',
          path: inspectedPath,
          hint: 'Run `pp project init` to scaffold a local project, or point diagnostics at an existing pp project root.',
        })
      );
      warnings.push(...(projectResult.diagnostics ?? []).map(asWarning));
      warnings.push(...(projectResult.warnings ?? []).map(asWarning));
    }
  }

  return ok(
    {
      generatedAt: new Date().toISOString(),
      cli: {
        name: 'pp',
        packageName: CLI_PACKAGE_NAME,
        version: CLI_VERSION,
        packageRoot: resolveCliPackageRoot(),
        entryPath: resolveCliArgvEntryPath() ?? resolveCurrentModulePath() ?? process.execPath,
      },
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        execPath: process.execPath,
        shell: process.env.SHELL,
        term: process.env.TERM,
        ci: process.env.CI === 'true' || process.env.CI === '1',
        initCwd: process.env.INIT_CWD,
        npmUserAgent: process.env.npm_config_user_agent,
      },
      config: {
        dir: configDir,
        file: configFile,
        msalCacheDir,
        dirExists: configDirExists,
        fileExists: configFileExists,
        msalCacheDirExists,
      },
      project,
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings,
      suggestedNextActions: suggestNextActions({
        pathExists,
        projectDiscovered: project.discovered,
        configFileExists,
      }),
    }
  );
}

export async function collectOperabilityDoctorReport(
  startPath: string | undefined,
  configOptions: ConfigStoreOptions = {}
): Promise<OperationResult<OperabilityDoctorReport>> {
  const bundle = await collectOperabilityBundle(startPath, configOptions);

  if (!bundle.data) {
    return bundle as unknown as OperationResult<OperabilityDoctorReport>;
  }

  const findings = [...bundle.diagnostics, ...bundle.warnings].map((item) => ({
    level: item.level,
    code: item.code,
    message: item.message,
    hint: item.hint,
    path: item.path,
  }));
  const status = bundle.diagnostics.length > 0 ? 'error' : bundle.warnings.length > 0 ? 'warning' : 'ok';

  return ok(
    {
      status,
      summary: {
        version: bundle.data.cli.version,
        inspectedPath: bundle.data.project.inspectedPath,
        projectRoot: bundle.data.project.root,
        configDir: bundle.data.config.dir,
        configFile: bundle.data.config.file,
        discoveredProject: bundle.data.project.discovered,
      },
      findings,
      suggestedNextActions: bundle.suggestedNextActions ?? [],
    },
    {
      supportTier: bundle.supportTier,
      diagnostics: bundle.diagnostics,
      warnings: bundle.warnings,
      suggestedNextActions: bundle.suggestedNextActions,
    }
  );
}

function renderBashCompletion(): string {
  return [
    '# bash completion for pp',
    renderBashPathFunctions(COMPLETION_NODES),
    '_pp_complete() {',
    '  local cur token path expect_value candidate',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  path=""',
    '  expect_value=""',
    '  for ((i=1; i<COMP_CWORD; i++)); do',
    '    token="${COMP_WORDS[i]}"',
    '    if [[ -n "$expect_value" ]]; then',
    '      expect_value=""',
    '      continue',
    '    fi',
    '    if [[ "$token" == -* ]]; then',
    '      if _pp_option_takes_value "$path" "$token"; then',
    '        expect_value="$token"',
    '      fi',
    '      continue',
    '    fi',
    '    if _pp_is_child "$path" "$token"; then',
    '      path="$(_pp_path_join "$path" "$token")"',
    '    fi',
    '  done',
    '  local -a candidates',
    '  candidates=()',
    '  if [[ -n "$expect_value" ]]; then',
    '    while IFS= read -r candidate; do',
    '      [[ -n "$candidate" ]] && candidates+=("$candidate")',
    '    done < <(_pp_option_values "$path" "$expect_value")',
    '  else',
    '    while IFS= read -r candidate; do',
    '      [[ -n "$candidate" ]] && candidates+=("$candidate")',
    '    done < <(_pp_children "$path")',
    '    while IFS= read -r candidate; do',
    '      [[ -n "$candidate" ]] && candidates+=("$candidate")',
    '    done < <(_pp_options "$path")',
    '  fi',
    '  COMPREPLY=( $(compgen -W "${candidates[*]}" -- "$cur") )',
    '  return 0',
    '}',
    'complete -F _pp_complete pp',
    '',
  ].join('\n');
}

function renderZshCompletion(): string {
  return [
    '#compdef pp',
    renderZshPathFunctions(COMPLETION_NODES),
    '_pp() {',
    '  local token path expect_value candidate',
    '  local -a candidates',
    '  path=""',
    '  expect_value=""',
    '  for ((i=2; i<CURRENT; i++)); do',
    '    token="${words[i]}"',
    '    if [[ -n "$expect_value" ]]; then',
    '      expect_value=""',
    '      continue',
    '    fi',
    '    if [[ "$token" == -* ]]; then',
    '      if _pp_option_takes_value "$path" "$token"; then',
    '        expect_value="$token"',
    '      fi',
    '      continue',
    '    fi',
    '    if _pp_is_child "$path" "$token"; then',
    '      path="$(_pp_path_join "$path" "$token")"',
    '    fi',
    '  done',
    '  candidates=()',
    '  if [[ -n "$expect_value" ]]; then',
    '    while IFS= read -r candidate; do',
    '      [[ -n "$candidate" ]] && candidates+=("$candidate")',
    '    done < <(_pp_option_values "$path" "$expect_value")',
    '  else',
    '    while IFS= read -r candidate; do',
    '      [[ -n "$candidate" ]] && candidates+=("$candidate")',
    '    done < <(_pp_children "$path")',
    '    while IFS= read -r candidate; do',
    '      [[ -n "$candidate" ]] && candidates+=("$candidate")',
    '    done < <(_pp_options "$path")',
    '  fi',
    '  compadd -- "${candidates[@]}"',
    '}',
    'compdef _pp pp',
    '',
  ].join('\n');
}

function renderFishCompletion(): string {
  return ['# fish completion for pp', renderFishPathFunctions(COMPLETION_NODES), 'complete -c pp -f -a "(__pp_complete)"', ''].join('\n');
}

function renderPwshCompletion(): string {
  return [
    '# PowerShell completion for pp',
    renderPwshPathFunctions(COMPLETION_NODES),
    'Register-ArgumentCompleter -Native -CommandName pp -ScriptBlock {',
    '  param($wordToComplete, $commandAst, $cursorPosition)',
    '  $tokens = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.Extent.Text })',
    '  $path = ""',
    '  $expectValue = $null',
    '  foreach ($token in $tokens) {',
    '    if ($expectValue) {',
    '      $expectValue = $null',
    '      continue',
    '    }',
    '    if ($token.StartsWith("-")) {',
    '      if (Test-PpOptionTakesValue $path $token) {',
    '        $expectValue = $token',
    '      }',
    '      continue',
    '    }',
    '    if (Test-PpIsChild $path $token) {',
    '      $path = Join-PpPath $path $token',
    '    }',
    '  }',
    '  if ($expectValue) {',
    '    $candidates = @(Get-PpOptionValues $path $expectValue)',
    '  } else {',
    '    $candidates = @((Get-PpChildren $path) + (Get-PpOptions $path))',
    '  }',
    '  foreach ($candidate in $candidates) {',
    '    if ($candidate -like "$wordToComplete*") {',
    "      [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)",
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}

function renderBashPathFunctions(nodes: readonly CliCompletionNode[]): string {
  return [
    '_pp_path_join() {',
    '  if [[ -n "$1" ]]; then',
    '    printf \'%s %s\\n\' "$1" "$2"',
    '  else',
    '    printf \'%s\\n\' "$2"',
    '  fi',
    '}',
    '_pp_children() {',
    '  case "$1" in',
    ...renderShellPathCases(nodes, (node) => renderPrintfLines(node.subcommands), '    '),
    '  esac',
    '}',
    '_pp_options() {',
    '  case "$1" in',
    ...renderShellPathCases(nodes, (node) => renderPrintfLines(node.options.map((optionSpec) => optionSpec.name)), '    '),
    '  esac',
    '}',
    '_pp_option_values() {',
    '  case "$1|$2" in',
    ...renderShellOptionValueCases(nodes, '    '),
    '  esac',
    '}',
    '_pp_option_takes_value() {',
    '  case "$1|$2" in',
    ...renderShellOptionTakesValueCases(nodes, '    '),
    '    *)',
    '      return 1',
    '      ;;',
    '  esac',
    '}',
    '_pp_is_child() {',
    '  local candidate',
    '  while IFS= read -r candidate; do',
    '    [[ "$candidate" == "$2" ]] && return 0',
    '  done < <(_pp_children "$1")',
    '  return 1',
    '}',
  ].join('\n');
}

function renderZshPathFunctions(nodes: readonly CliCompletionNode[]): string {
  return [
    '_pp_path_join() {',
    '  if [[ -n "$1" ]]; then',
    '    print -r -- "$1 $2"',
    '  else',
    '    print -r -- "$2"',
    '  fi',
    '}',
    '_pp_children() {',
    '  case "$1" in',
    ...renderShellPathCases(nodes, (node) => renderPrintLines(node.subcommands), '    '),
    '  esac',
    '}',
    '_pp_options() {',
    '  case "$1" in',
    ...renderShellPathCases(nodes, (node) => renderPrintLines(node.options.map((optionSpec) => optionSpec.name)), '    '),
    '  esac',
    '}',
    '_pp_option_values() {',
    '  case "$1|$2" in',
    ...renderZshOptionValueCases(nodes, '    '),
    '  esac',
    '}',
    '_pp_option_takes_value() {',
    '  case "$1|$2" in',
    ...renderShellOptionTakesValueCases(nodes, '    '),
    '    *)',
    '      return 1',
    '      ;;',
    '  esac',
    '}',
    '_pp_is_child() {',
    '  local candidate',
    '  while IFS= read -r candidate; do',
    '    [[ "$candidate" == "$2" ]] && return 0',
    '  done < <(_pp_children "$1")',
    '  return 1',
    '}',
  ].join('\n');
}

function renderFishPathFunctions(nodes: readonly CliCompletionNode[]): string {
  return [
    'function __pp_path_join',
    '  if test -n "$argv[1]"',
    '    echo "$argv[1] $argv[2]"',
    '  else',
    '    echo "$argv[2]"',
    '  end',
    'end',
    'function __pp_children',
    '  switch "$argv[1]"',
    ...renderFishPathCases(nodes, (node) => renderFishEchoLines(node.subcommands)),
    '  end',
    'end',
    'function __pp_options',
    '  switch "$argv[1]"',
    ...renderFishPathCases(nodes, (node) => renderFishEchoLines(node.options.map((optionSpec) => optionSpec.name))),
    '  end',
    'end',
    'function __pp_option_values',
    '  switch "$argv[1]|$argv[2]"',
    ...renderFishOptionValueCases(nodes),
    '  end',
    'end',
    'function __pp_option_takes_value',
    '  switch "$argv[1]|$argv[2]"',
    ...renderFishOptionTakesValueCases(nodes),
    '    case "*"',
    '      return 1',
    '  end',
    'end',
    'function __pp_complete',
    '  set -l tokens (commandline -opc)',
    '  set -e tokens[1]',
    '  set -l path ""',
    '  set -l expect ""',
    '  for token in $tokens',
    '    if test -n "$expect"',
    '      set expect ""',
    '      continue',
    '    end',
    '    if string match -qr "^-" -- $token',
    '      if __pp_option_takes_value "$path" "$token"',
    '        set expect $token',
    '      end',
    '      continue',
    '    end',
    '    if contains -- $token (__pp_children "$path")',
    '      set path (__pp_path_join "$path" "$token")',
    '    end',
    '  end',
    '  if test -n "$expect"',
    '    __pp_option_values "$path" "$expect"',
    '  else',
    '    __pp_children "$path"',
    '    __pp_options "$path"',
    '  end',
    'end',
  ].join('\n');
}

function renderPwshPathFunctions(nodes: readonly CliCompletionNode[]): string {
  return [
    'function Join-PpPath {',
    '  param([string]$Path, [string]$Child)',
    '  if ([string]::IsNullOrWhiteSpace($Path)) { return $Child }',
    '  return "$Path $Child"',
    '}',
    'function Get-PpChildren {',
    '  param([string]$Path)',
    '  switch ($Path) {',
    ...renderPwshPathCases(nodes, (node) => renderPwshArray(node.subcommands), '    '),
    '    default { @() }',
    '  }',
    '}',
    'function Get-PpOptions {',
    '  param([string]$Path)',
    '  switch ($Path) {',
    ...renderPwshPathCases(nodes, (node) => renderPwshArray(node.options.map((optionSpec) => optionSpec.name)), '    '),
    '    default { @() }',
    '  }',
    '}',
    'function Get-PpOptionValues {',
    '  param([string]$Path, [string]$Option)',
    '  switch ("$Path|$Option") {',
    ...renderPwshOptionValueCases(nodes, '    '),
    '    default { @() }',
    '  }',
    '}',
    'function Test-PpOptionTakesValue {',
    '  param([string]$Path, [string]$Option)',
    '  switch ("$Path|$Option") {',
    ...renderPwshOptionTakesValueCases(nodes, '    '),
    '    default { return $false }',
    '  }',
    '}',
    'function Test-PpIsChild {',
    '  param([string]$Path, [string]$Child)',
    '  return (Get-PpChildren $Path) -contains $Child',
    '}',
  ].join('\n');
}

function renderShellPathCases(
  nodes: readonly CliCompletionNode[],
  renderBody: (node: CliCompletionNode) => string,
  indent: string
): string[] {
  return nodes.map((node) => `${indent}${shellCasePattern(node.path)})\n${indent}  ${renderBody(node)}\n${indent}  ;;`);
}

function renderFishPathCases(nodes: readonly CliCompletionNode[], renderBody: (node: CliCompletionNode) => string): string[] {
  return nodes.map((node) => `    case ${fishCasePattern(node.path)}\n${indentBlock(renderBody(node), '      ')}`);
}

function renderPwshPathCases(
  nodes: readonly CliCompletionNode[],
  renderBody: (node: CliCompletionNode) => string,
  indent: string
): string[] {
  return nodes.map((node) => `${indent}${pwshString(pathKey(node.path))} { ${renderBody(node)} }`);
}

function renderShellOptionValueCases(nodes: readonly CliCompletionNode[], indent: string): string[] {
  const cases = collectOptionValueCases(nodes);
  return cases.map((entry) => `${indent}${shellCasePattern([...entry.path, entry.option.name], '|')})\n${indent}  ${renderPrintfLines(entry.option.values ?? [])}\n${indent}  ;;`);
}

function renderZshOptionValueCases(nodes: readonly CliCompletionNode[], indent: string): string[] {
  const cases = collectOptionValueCases(nodes);
  return cases.map((entry) => `${indent}${shellCasePattern([...entry.path, entry.option.name], '|')})\n${indent}  ${renderPrintLines(entry.option.values ?? [])}\n${indent}  ;;`);
}

function renderFishOptionValueCases(nodes: readonly CliCompletionNode[]): string[] {
  return collectOptionValueCases(nodes).map(
    (entry) => `    case ${fishCasePattern([...entry.path, entry.option.name], '|')}\n${indentBlock(renderFishEchoLines(entry.option.values ?? []), '      ')}`
  );
}

function renderPwshOptionValueCases(nodes: readonly CliCompletionNode[], indent: string): string[] {
  return collectOptionValueCases(nodes).map(
    (entry) => `${indent}${pwshString(`${pathKey(entry.path)}|${entry.option.name}`)} { ${renderPwshArray(entry.option.values ?? [])} }`
  );
}

function renderShellOptionTakesValueCases(nodes: readonly CliCompletionNode[], indent: string): string[] {
  return collectOptionsThatTakeValues(nodes).map(
    (entry) => `${indent}${shellCasePattern([...entry.path, entry.name], '|')})\n${indent}  return 0\n${indent}  ;;`
  );
}

function renderFishOptionTakesValueCases(nodes: readonly CliCompletionNode[]): string[] {
  return collectOptionsThatTakeValues(nodes).map((entry) => `    case ${fishCasePattern([...entry.path, entry.name], '|')}\n      return 0`);
}

function renderPwshOptionTakesValueCases(nodes: readonly CliCompletionNode[], indent: string): string[] {
  return collectOptionsThatTakeValues(nodes).map(
    (entry) => `${indent}${pwshString(`${pathKey(entry.path)}|${entry.name}`)} { return $true }`
  );
}

function collectOptionValueCases(nodes: readonly CliCompletionNode[]): Array<{ path: readonly string[]; option: CliOptionSpec }> {
  return nodes.flatMap((node) => node.options.filter((optionSpec) => (optionSpec.values?.length ?? 0) > 0).map((option) => ({ path: node.path, option })));
}

function collectOptionsThatTakeValues(nodes: readonly CliCompletionNode[]): Array<{ path: readonly string[]; name: string }> {
  return nodes.flatMap((node) => node.options.filter((optionSpec) => optionSpec.takesValue).map((optionSpec) => ({ path: node.path, name: optionSpec.name })));
}

function renderPrintfLines(values: readonly string[]): string {
  return values.length > 0 ? `printf '%s\n' ${values.map(bashSingleQuote).join(' ')}` : ':';
}

function renderPrintLines(values: readonly string[]): string {
  return values.length > 0 ? `print -l -- ${values.map(zshSingleQuote).join(' ')}` : ':';
}

function renderFishEchoLines(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `echo ${fishSingleQuote(value)}`).join('\n') : 'true';
}

function renderPwshArray(values: readonly string[]): string {
  return `@(${values.map(pwshString).join(', ')})`;
}

function shellCasePattern(parts: readonly string[], separator = ' '): string {
  return bashSingleQuote(parts.join(separator));
}

function fishCasePattern(parts: readonly string[], separator = ' '): string {
  return fishSingleQuote(parts.join(separator));
}

function pathKey(path: readonly string[]): string {
  return path.join(' ');
}

function bashSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function zshSingleQuote(value: string): string {
  return bashSingleQuote(value);
}

function fishSingleQuote(value: string): string {
  return bashSingleQuote(value);
}

function pwshString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function indentBlock(value: string, indent: string): string {
  return value
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function suggestNextActions(options: {
  pathExists: boolean;
  projectDiscovered: boolean;
  configFileExists: boolean;
}): string[] {
  const completionAction =
    process.platform === 'win32' ? 'pp completion pwsh | Out-String | Invoke-Expression' : 'pp completion zsh > ~/.zfunc/_pp';
  const actions = [`pp version`, completionAction];

  if (!options.configFileExists) {
    actions.push(`pp auth profile list --config-dir "${getGlobalConfigDir()}"`);
  }

  if (options.pathExists && options.projectDiscovered) {
    actions.push('pp project doctor --format json');
  } else if (options.pathExists) {
    actions.push('pp project init --plan --format markdown');
  }

  actions.push('pp diagnostics bundle --format json > pp-diagnostics.json');
  return actions;
}

function asWarning(diagnostic: Diagnostic): Diagnostic {
  return diagnostic.level === 'warning'
    ? diagnostic
    : {
        ...diagnostic,
        level: 'warning',
      };
}

async function pathExistsOnDisk(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
