export interface CliOptionSpec {
  name: string;
  takesValue?: boolean;
  values?: readonly string[];
}

export interface CliCommandSpec {
  name: string;
  aliases?: readonly string[];
  options?: readonly CliOptionSpec[];
  children?: readonly CliCommandSpec[];
}

export interface CliCompletionNode {
  path: readonly string[];
  subcommands: readonly string[];
  options: readonly CliOptionSpec[];
}

const booleanFlagNames = new Set([
  '--help',
  '--count',
  '--all',
  '--page-info',
  '--return-representation',
  '--plan',
  '--dry-run',
  '--delegate',
  '--open',
  '--overwrite-unmanaged-customizations',
  '--no-publish-workflows',
  '--allow-interactive-auth',
  '--no-interactive',
]);

const HELP_OPTION = option('--help');
const FORMAT_OPTION = option('--format', ['table', 'json', 'yaml', 'ndjson', 'markdown', 'raw']);
const CONFIG_DIR_OPTION = option('--config-dir');
const PROJECT_OPTION = option('--project');
const PROFILE_OPTION = option('--profile');
const ENVIRONMENT_OPTION = option('--environment');
const SOLUTION_OPTION = option('--solution');
const WORKSPACE_OPTION = option('--workspace');
const REGISTRY_OPTION = option('--registry');
const CACHE_DIR_OPTION = option('--cache-dir');
const BROWSER_PROFILE_OPTION = option('--browser-profile');
const PLAN_OPTION = option('--plan');
const DRY_RUN_OPTION = option('--dry-run');
const MODE_OPTION = option('--mode', ['strict', 'seeded', 'registry']);
const KIND_OPTION = option('--kind', ['app', 'form', 'view', 'sitemap']);
const COMMON_OUTPUT_OPTIONS = [HELP_OPTION, FORMAT_OPTION] as const;
const COMMON_ENVIRONMENT_OPTIONS = [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, ENVIRONMENT_OPTION] as const;
const COMMON_ENVIRONMENT_SOLUTION_OPTIONS = [
  HELP_OPTION,
  FORMAT_OPTION,
  CONFIG_DIR_OPTION,
  ENVIRONMENT_OPTION,
  SOLUTION_OPTION,
] as const;
const COMMON_CANVAS_LOCAL_OPTIONS = [
  HELP_OPTION,
  FORMAT_OPTION,
  PROJECT_OPTION,
  WORKSPACE_OPTION,
  REGISTRY_OPTION,
  CACHE_DIR_OPTION,
  MODE_OPTION,
] as const;
const COMMON_MUTATION_OPTIONS = [HELP_OPTION, FORMAT_OPTION, PLAN_OPTION, DRY_RUN_OPTION] as const;
const COMMON_MUTATION_ENV_OPTIONS = [
  HELP_OPTION,
  FORMAT_OPTION,
  CONFIG_DIR_OPTION,
  ENVIRONMENT_OPTION,
  PLAN_OPTION,
  DRY_RUN_OPTION,
] as const;

export const CLI_COMMAND_SPEC: CliCommandSpec = {
  name: 'pp',
  children: [
    command('auth', {
      children: [
        command('profile', {
          children: [
            command('list', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
            command('inspect', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
            command('add-user', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, option('--name')] }),
            command('add-static', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, option('--name')] }),
            command('add-env', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, option('--name'), option('--env-var')] }),
            command('add-client-secret', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, option('--name')] }),
            command('add-device-code', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, option('--name')] }),
            command('remove', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
          ],
        }),
        command('browser-profile', {
          children: [
            command('list', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
            command('inspect', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
            command('add', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, option('--name')] }),
            command('bootstrap', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, option('--name')] }),
            command('remove', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
          ],
        }),
        command('login', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, PROFILE_OPTION] }),
        command('token', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, PROFILE_OPTION] }),
      ],
    }),
    command('env', {
      aliases: ['environment'],
      children: [
        command('list', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
        command('add', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION, PROFILE_OPTION, option('--url')] }),
        command('inspect', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
        command('baseline', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
        command('resolve-maker-id', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
        command('cleanup-plan', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
        command('reset', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
        command('cleanup', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
        command('remove', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
      ],
    }),
    command('dv', {
      children: [
        command('whoami', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('request', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('action', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('function', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('batch', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('rows', {
          children: [
            command('export', {
              options: [
                ...COMMON_ENVIRONMENT_SOLUTION_OPTIONS,
                option('--select'),
                option('--top'),
                option('--filter'),
                option('--expand'),
                option('--orderby'),
                option('--count'),
                option('--max-page-size'),
                option('--annotations'),
                option('--all'),
                option('--out'),
              ],
            }),
            command('apply', {
              options: [
                ...COMMON_ENVIRONMENT_SOLUTION_OPTIONS,
                ...COMMON_MUTATION_OPTIONS,
                option('--file'),
                option('--annotations'),
              ],
            }),
          ],
        }),
        command('query', {
          options: [
            ...COMMON_ENVIRONMENT_SOLUTION_OPTIONS,
            option('--select'),
            option('--top'),
            option('--filter'),
            option('--expand'),
            option('--orderby'),
            option('--count'),
            option('--max-page-size'),
            option('--annotations'),
            option('--all'),
            option('--page-info'),
          ],
        }),
        command('get', { options: [...COMMON_ENVIRONMENT_OPTIONS, option('--select'), option('--expand'), option('--annotations')] }),
        command('create', {
          options: [
            ...COMMON_MUTATION_ENV_OPTIONS,
            option('--body'),
            option('--body-file'),
            option('--select'),
            option('--expand'),
            option('--annotations'),
            option('--return-representation'),
            option('--if-none-match'),
            option('--if-match'),
          ],
        }),
        command('update', {
          options: [
            ...COMMON_MUTATION_ENV_OPTIONS,
            option('--body'),
            option('--body-file'),
            option('--select'),
            option('--expand'),
            option('--annotations'),
            option('--return-representation'),
            option('--if-none-match'),
            option('--if-match'),
          ],
        }),
        command('delete', { options: [...COMMON_MUTATION_ENV_OPTIONS, option('--if-match')] }),
        command('metadata', {
          options: COMMON_ENVIRONMENT_OPTIONS,
          children: [
            command('tables', { options: COMMON_ENVIRONMENT_OPTIONS }),
            command('table', { options: COMMON_ENVIRONMENT_OPTIONS }),
            command('columns', { options: COMMON_ENVIRONMENT_OPTIONS }),
            command('column', { options: COMMON_ENVIRONMENT_OPTIONS }),
            command('option-set', { options: COMMON_ENVIRONMENT_OPTIONS }),
            command('relationship', { options: COMMON_ENVIRONMENT_OPTIONS }),
            command('snapshot', { options: COMMON_ENVIRONMENT_OPTIONS }),
            command('diff', { options: COMMON_OUTPUT_OPTIONS }),
            command('schema', { options: COMMON_OUTPUT_OPTIONS }),
            command('init', { options: COMMON_OUTPUT_OPTIONS }),
            command('apply', { options: [...COMMON_MUTATION_ENV_OPTIONS, option('--file')] }),
            command('create-table', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('update-table', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('add-column', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('update-column', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('create-option-set', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('update-option-set', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('create-relationship', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('update-relationship', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('create-many-to-many', { options: COMMON_MUTATION_ENV_OPTIONS }),
            command('create-customer-relationship', { options: COMMON_MUTATION_ENV_OPTIONS }),
          ],
        }),
      ],
    }),
    command('solution', {
      children: [
        command('create', { options: [...COMMON_ENVIRONMENT_OPTIONS, ...COMMON_MUTATION_OPTIONS, option('--publisher-id'), option('--publisher-unique-name')] }),
        command('delete', { options: [...COMMON_MUTATION_ENV_OPTIONS] }),
        command('set-metadata', { options: [...COMMON_MUTATION_ENV_OPTIONS] }),
        command('publish', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('sync-status', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('checkpoint', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('list', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('publishers', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('inspect', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('components', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('dependencies', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('analyze', { options: COMMON_OUTPUT_OPTIONS }),
        command('compare', { options: COMMON_OUTPUT_OPTIONS }),
        command('export', { options: [...COMMON_ENVIRONMENT_OPTIONS, option('--out')] }),
        command('import', { options: [...COMMON_MUTATION_ENV_OPTIONS, option('--import-job-id')] }),
        command('pack', { options: COMMON_OUTPUT_OPTIONS }),
        command('unpack', { options: COMMON_OUTPUT_OPTIONS }),
      ],
    }),
    command('connref', {
      children: [
        command('create', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('list', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('inspect', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('set', { options: [...COMMON_MUTATION_ENV_OPTIONS, SOLUTION_OPTION] }),
        command('validate', { options: COMMON_ENVIRONMENT_OPTIONS }),
      ],
    }),
    command('envvar', {
      children: [
        command('create', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('list', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('inspect', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('set', { options: [...COMMON_MUTATION_ENV_OPTIONS, SOLUTION_OPTION] }),
      ],
    }),
    command('canvas', {
      children: [
        command('list', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('attach', { options: [...COMMON_ENVIRONMENT_SOLUTION_OPTIONS, ...COMMON_MUTATION_OPTIONS] }),
        command('download', {
          options: [...COMMON_ENVIRONMENT_SOLUTION_OPTIONS, option('--out'), option('--extract-to-directory')],
        }),
        command('inspect', { options: [...COMMON_CANVAS_LOCAL_OPTIONS, ...COMMON_ENVIRONMENT_SOLUTION_OPTIONS] }),
        command('probe', { options: [...COMMON_ENVIRONMENT_SOLUTION_OPTIONS, BROWSER_PROFILE_OPTION, option('--artifacts-dir')] }),
        command('access', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('create', {
          options: [
            ...COMMON_ENVIRONMENT_SOLUTION_OPTIONS,
            ...COMMON_MUTATION_OPTIONS,
            BROWSER_PROFILE_OPTION,
            option('--delegate'),
            option('--open'),
            option('--name'),
            option('--maker-env-id'),
            option('--artifacts-dir'),
            option('--timeout-ms'),
          ],
        }),
        command('import', {
          options: [
            ...COMMON_ENVIRONMENT_SOLUTION_OPTIONS,
            ...COMMON_MUTATION_OPTIONS,
            option('--target'),
            option('--overwrite-unmanaged-customizations'),
            option('--no-publish-workflows'),
          ],
        }),
        command('validate', { options: COMMON_CANVAS_LOCAL_OPTIONS }),
        command('lint', { options: COMMON_CANVAS_LOCAL_OPTIONS }),
        command('build', { options: [...COMMON_CANVAS_LOCAL_OPTIONS, option('--out')] }),
        command('diff', { options: COMMON_CANVAS_LOCAL_OPTIONS }),
        command('templates', {
          children: [
            command('import', { options: [HELP_OPTION, FORMAT_OPTION, option('--out'), REGISTRY_OPTION] }),
            command('inspect', { options: COMMON_OUTPUT_OPTIONS }),
            command('diff', { options: COMMON_OUTPUT_OPTIONS }),
            command('pin', { options: [HELP_OPTION, FORMAT_OPTION, option('--out')] }),
            command('refresh', { options: [HELP_OPTION, FORMAT_OPTION, option('--current')] }),
            command('audit', { options: COMMON_OUTPUT_OPTIONS }),
          ],
        }),
        command('workspace', {
          children: [command('inspect', { options: [HELP_OPTION, FORMAT_OPTION, WORKSPACE_OPTION, REGISTRY_OPTION] })],
        }),
        command('patch', {
          children: [
            command('plan', { options: [...COMMON_CANVAS_LOCAL_OPTIONS, option('--file')] }),
            command('apply', { options: [...COMMON_CANVAS_LOCAL_OPTIONS, option('--file'), option('--out')] }),
          ],
        }),
      ],
    }),
    command('flow', {
      children: [
        command('list', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('inspect', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('export', { options: [...COMMON_ENVIRONMENT_SOLUTION_OPTIONS, option('--out')] }),
        command('activate', { options: [...COMMON_ENVIRONMENT_SOLUTION_OPTIONS, ...COMMON_MUTATION_OPTIONS] }),
        command('normalize', { options: COMMON_OUTPUT_OPTIONS }),
        command('validate', { options: COMMON_OUTPUT_OPTIONS }),
        command('connrefs', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('access', { options: COMMON_ENVIRONMENT_OPTIONS }),
        command('lsp', { options: [] }),
      ],
    }),
    command('model', {
      children: [
        command('create', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('attach', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('list', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('inspect', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('access', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('composition', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('impact', { options: [...COMMON_ENVIRONMENT_SOLUTION_OPTIONS, KIND_OPTION, option('--target')] }),
        command('sitemap', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('forms', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('views', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('dependencies', { options: COMMON_ENVIRONMENT_SOLUTION_OPTIONS }),
        command('patch', {
          children: [
            command('plan', { options: [...COMMON_ENVIRONMENT_SOLUTION_OPTIONS, KIND_OPTION, option('--target'), option('--rename')] }),
          ],
        }),
      ],
    }),
    command('mcp', {
      children: [
        command('serve', { options: [HELP_OPTION, CONFIG_DIR_OPTION, option('--allow-interactive-auth')] }),
      ],
    }),
    command('diagnostics', {
      children: [
        command('doctor', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
        command('bundle', { options: [HELP_OPTION, FORMAT_OPTION, CONFIG_DIR_OPTION] }),
      ],
    }),
    command('completion', {
      children: [
        command('bash'),
        command('zsh'),
        command('fish'),
        command('pwsh'),
      ],
    }),
    command('version', { options: [HELP_OPTION, FORMAT_OPTION] }),
  ],
};

export const TOP_LEVEL_COMMANDS = listSubcommands(CLI_COMMAND_SPEC);

export function listSubcommands(spec: CliCommandSpec): string[] {
  return (spec.children ?? []).map((child) => child.name);
}

export function resolveCommandPath(argv: readonly string[], spec: CliCommandSpec = CLI_COMMAND_SPEC): {
  path: string[];
  node: CliCommandSpec;
  consumedArgs: number;
} {
  let node = spec;
  const path: string[] = [];
  let consumedArgs = 0;
  let awaitingValueFor: CliOptionSpec | undefined;

  for (const token of argv) {
    if (awaitingValueFor) {
      awaitingValueFor = undefined;
      consumedArgs += 1;
      continue;
    }

    if (token.startsWith('-')) {
      const optionSpec = findOptionForPath(path, token, spec);
      if (optionSpec?.takesValue) {
        awaitingValueFor = optionSpec;
      }
      consumedArgs += 1;
      continue;
    }

    const child = findChild(node, token);

    if (!child) {
      break;
    }

    node = child;
    path.push(child.name);
    consumedArgs += 1;
  }

  return {
    path,
    node,
    consumedArgs,
  };
}

export function buildCompletionNodes(spec: CliCommandSpec = CLI_COMMAND_SPEC): CliCompletionNode[] {
  const nodes: CliCompletionNode[] = [];

  visitCompletionNodes(spec, [], [], nodes);

  return nodes;
}

export function findOptionForPath(
  path: readonly string[],
  optionName: string,
  spec: CliCommandSpec = CLI_COMMAND_SPEC
): CliOptionSpec | undefined {
  const node = findNodeByPath(path, spec);

  if (!node) {
    return undefined;
  }

  return collectOptionsForPath(path, spec).find((optionSpec) => optionSpec.name === optionName);
}

export function collectOptionsForPath(path: readonly string[], spec: CliCommandSpec = CLI_COMMAND_SPEC): CliOptionSpec[] {
  const options: CliOptionSpec[] = [];
  let node = spec;

  pushUniqueOptions(options, node.options ?? []);

  for (const segment of path) {
    const child = findChild(node, segment);

    if (!child) {
      break;
    }

    node = child;
    pushUniqueOptions(options, child.options ?? []);
  }

  return options;
}

function visitCompletionNodes(
  node: CliCommandSpec,
  path: string[],
  inheritedOptions: readonly CliOptionSpec[],
  result: CliCompletionNode[]
): void {
  const options = uniqueOptions([...inheritedOptions, ...(node.options ?? [])]);

  result.push({
    path,
    subcommands: listSubcommands(node),
    options,
  });

  for (const child of node.children ?? []) {
    visitCompletionNodes(child, [...path, child.name], options, result);
  }
}

function findNodeByPath(path: readonly string[], spec: CliCommandSpec): CliCommandSpec | undefined {
  let node: CliCommandSpec | undefined = spec;

  for (const segment of path) {
    node = node ? findChild(node, segment) : undefined;

    if (!node) {
      return undefined;
    }
  }

  return node;
}

function findChild(node: CliCommandSpec, token: string): CliCommandSpec | undefined {
  return (node.children ?? []).find((child) => child.name === token || child.aliases?.includes(token));
}

function pushUniqueOptions(target: CliOptionSpec[], source: readonly CliOptionSpec[]): void {
  for (const optionSpec of source) {
    if (!target.some((candidate) => candidate.name === optionSpec.name)) {
      target.push(optionSpec);
    }
  }
}

function uniqueOptions(options: readonly CliOptionSpec[]): CliOptionSpec[] {
  const result: CliOptionSpec[] = [];
  pushUniqueOptions(result, options);
  return result;
}

function command(name: string, overrides: Omit<CliCommandSpec, 'name'> = {}): CliCommandSpec {
  return {
    name,
    ...overrides,
  };
}

function option(name: string, values?: readonly string[]): CliOptionSpec {
  return {
    name,
    takesValue: values !== undefined || name !== '--help' && !name.startsWith('--no-') && !booleanFlagNames.has(name),
    values,
  };
}
