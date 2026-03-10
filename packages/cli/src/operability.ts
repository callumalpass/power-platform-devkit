import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGlobalConfigDir, getGlobalConfigFilePath, getMsalCacheDir, type ConfigStoreOptions } from '@pp/config';
import { createDiagnostic, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { discoverProject } from '@pp/project';
import packageJson from '../package.json';

export const CLI_PACKAGE_NAME = packageJson.name;
export const CLI_VERSION = packageJson.version;

export const COMMAND_TREE = {
  auth: ['profile', 'browser-profile', 'login', 'token'],
  env: ['list', 'add', 'inspect', 'resolve-maker-id', 'cleanup-plan', 'reset', 'cleanup', 'remove'],
  dv: ['whoami', 'request', 'action', 'function', 'batch', 'rows', 'query', 'get', 'create', 'update', 'delete', 'metadata'],
  solution: ['create', 'delete', 'set-metadata', 'list', 'inspect', 'components', 'compare'],
  connref: ['list', 'inspect', 'validate'],
  envvar: ['list', 'inspect', 'set'],
  canvas: ['list', 'inspect', 'create', 'import', 'validate', 'lint', 'build', 'diff', 'templates', 'workspace', 'patch'],
  flow: ['list', 'inspect', 'unpack', 'normalize', 'validate', 'patch', 'doctor'],
  model: ['list', 'inspect', 'sitemap', 'forms', 'views', 'dependencies', 'impact'],
  project: ['init', 'doctor', 'feedback', 'inspect'],
  analysis: ['report', 'context', 'portfolio', 'drift', 'usage', 'policy'],
  deploy: ['plan', 'apply', 'release'],
  sharepoint: ['site', 'list', 'file', 'permissions'],
  powerbi: ['workspace', 'dataset', 'report'],
  diagnostics: ['doctor', 'bundle'],
  completion: ['bash', 'zsh', 'fish'],
} as const satisfies Record<string, readonly string[]>;

export const TOP_LEVEL_COMMANDS = [...Object.keys(COMMAND_TREE), 'version'] as const;

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

export function renderCompletionScript(shell: 'bash' | 'zsh' | 'fish'): string {
  switch (shell) {
    case 'bash':
      return renderBashCompletion();
    case 'zsh':
      return renderZshCompletion();
    case 'fish':
      return renderFishCompletion();
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
        packageRoot: dirname(fileURLToPath(new URL('../package.json', import.meta.url))),
        entryPath: fileURLToPath(import.meta.url),
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
    return bundle as OperationResult<OperabilityDoctorReport>;
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
  const topLevel = TOP_LEVEL_COMMANDS.join(' ');
  const groups = Object.entries(COMMAND_TREE)
    .map(([name, subcommands]) => `  ${name}) COMPREPLY=( $(compgen -W "${subcommands.join(' ')}" -- "$cur") ) ;;`)
    .join('\n');

  return [
    '# bash completion for pp',
    '_pp_complete() {',
    '  local cur prev',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  if [[ ${COMP_CWORD} -eq 1 ]]; then',
    `    COMPREPLY=( $(compgen -W "${topLevel}" -- "$cur") )`,
    '    return 0',
    '  fi',
    '  case "${COMP_WORDS[1]}" in',
    groups,
    '  esac',
    '  return 0',
    '}',
    'complete -F _pp_complete pp',
    '',
  ].join('\n');
}

function renderZshCompletion(): string {
  const topLevel = TOP_LEVEL_COMMANDS.map((value) => `'${value}'`).join(' ');
  const groups = Object.entries(COMMAND_TREE)
    .map(([name, subcommands]) => {
      const rendered = subcommands.map((value) => `'${value}'`).join(' ');
      return `    ${name})\n      compadd -- ${rendered}\n      return 0\n      ;;`;
    })
    .join('\n');

  return [
    '#compdef pp',
    '_pp() {',
    '  local -a top_level',
    `  top_level=(${topLevel})`,
    '  if (( CURRENT == 2 )); then',
    '    compadd -- "${top_level[@]}"',
    '    return 0',
    '  fi',
    '  case "${words[2]}" in',
    groups,
    '  esac',
    '}',
    'compdef _pp pp',
    '',
  ].join('\n');
}

function renderFishCompletion(): string {
  const lines = ['# fish completion for pp', 'complete -c pp -f'];

  for (const command of TOP_LEVEL_COMMANDS) {
    lines.push(`complete -c pp -n "__fish_use_subcommand" -a "${command}"`);
  }

  for (const [name, subcommands] of Object.entries(COMMAND_TREE)) {
    lines.push(`complete -c pp -n "__fish_seen_subcommand_from ${name}" -a "${subcommands.join(' ')}"`);
  }

  lines.push('');
  return lines.join('\n');
}

function suggestNextActions(options: {
  pathExists: boolean;
  projectDiscovered: boolean;
  configFileExists: boolean;
}): string[] {
  const actions = [`pp version`, `pp completion zsh > ~/.zfunc/_pp`];

  if (!options.configFileExists) {
    actions.push('pp auth profile list --config-dir ~/.config/pp');
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
