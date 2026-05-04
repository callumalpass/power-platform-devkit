export interface CliFlagMetadata {
  name: string;
  description: string;
  valueName?: string;
}

export interface CliSubcommandMetadata {
  name: string;
  description: string;
  usage?: string;
}

export interface CliCommandMetadata {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  flags?: CliFlagMetadata[];
  subcommands?: CliSubcommandMetadata[];
  helpLine?: string;
  aliasHelpLines?: string[];
}

export const CLI_COMMANDS: CliCommandMetadata[] = [
  {
    name: 'auth',
    description: 'Manage accounts',
    usage: 'pp auth <command> [args]',
    subcommands: [
      { name: 'login', description: 'Create or update an account and run login', usage: 'pp auth login <account> [flags]' },
      { name: 'list', description: 'List accounts', usage: 'pp auth list' },
      { name: 'inspect', description: 'Show one account', usage: 'pp auth inspect <account>' },
      { name: 'remove', description: 'Remove an account', usage: 'pp auth remove <account>' }
    ]
  },
  {
    name: 'env',
    description: 'Manage named environments',
    usage: 'pp env <command> [args]',
    subcommands: [
      { name: 'list', description: 'List environments', usage: 'pp env list' },
      { name: 'inspect', description: 'Show one environment', usage: 'pp env inspect <alias>' },
      { name: 'discover', description: 'Discover environments accessible to one account', usage: 'pp env discover <account> [--no-interactive-auth]' },
      { name: 'add', description: 'Add an environment and discover metadata', usage: 'pp env add <alias> --url URL --account ACCOUNT' },
      { name: 'remove', description: 'Remove an environment', usage: 'pp env remove <alias>' }
    ]
  },
  {
    name: 'request',
    description: 'Send an authenticated request',
    usage: 'pp request [api] <path|url> [--env ALIAS|--account ACCOUNT] [flags]',
    flags: [
      { name: '--api', valueName: 'API', description: 'API kind to use for request preparation' },
      { name: '--query', valueName: 'K=V', description: 'Add a query string value' },
      { name: '--header', valueName: 'K:V', description: 'Add a request header' }
    ]
  },
  { name: 'flow', description: 'Validate, inspect, or request against Power Automate', usage: 'pp flow <path> --env ALIAS [request flags]' },
  { name: 'whoami', description: 'Dataverse WhoAmI for an environment', usage: 'pp whoami --env ALIAS [--account ACCOUNT] [--no-interactive-auth]' },
  { name: 'ping', description: 'Basic connectivity check', usage: 'pp ping --env ALIAS [--account ACCOUNT] [--api API] [--no-interactive-auth]' },
  { name: 'token', description: 'Print a token for an environment', usage: 'pp token --env ALIAS [--account ACCOUNT] [--api API] [--device-code] [--no-interactive-auth]' },
  { name: 'dv', description: 'Shortcut for "request --api dv"', usage: 'pp dv <path|url> --env ALIAS [request flags]' },
  { name: 'graph', description: 'Shortcut for "request --api graph"', usage: 'pp graph <path|url> [--account ACCOUNT|--env ALIAS] [request flags]' },
  {
    name: 'sharepoint',
    aliases: ['sp'],
    description: 'Shortcut for "request --api sharepoint"',
    usage: 'pp sharepoint <path|url> [--account ACCOUNT|--env ALIAS] [request flags]',
    aliasHelpLines: ['  sp              Alias for "sharepoint"']
  },
  { name: 'bap', description: 'Shortcut for "request --api bap"', usage: 'pp bap <path|url> --env ALIAS [request flags]' },
  { name: 'powerapps', description: 'Shortcut for "request --api powerapps"', usage: 'pp powerapps <path|url> --env ALIAS [request flags]' },
  {
    name: 'canvas-authoring',
    description: 'Canvas authoring helper commands and request shortcut',
    usage: 'pp canvas-authoring <command|path> [args]',
    helpLine: '  canvas-authoring  Canvas authoring helper commands and request shortcut',
    subcommands: [
      { name: 'session', description: 'Manage canvas authoring sessions' },
      { name: 'invoke', description: 'Invoke a low-level document-server RPC method through REST' },
      { name: 'rpc', description: 'Invoke a low-level document-server RPC method over SignalR' },
      { name: 'yaml', description: 'Fetch or validate source-control YAML files' }
    ]
  },
  { name: 'mcp', description: 'Start the MCP server', usage: 'pp mcp [--config-dir DIR] [--allow-interactive-auth]' },
  { name: 'setup', description: 'Open the browser-based Setup Manager', usage: 'pp setup [flags]' },
  {
    name: 'credential-store',
    description: 'Choose file or OS-backed token cache storage',
    usage: 'pp credential-store status|enable [args]',
    subcommands: [
      { name: 'status', description: 'Show the effective credential store mode', usage: 'pp credential-store status' },
      { name: 'enable', description: 'Persist file, os, or auto mode', usage: 'pp credential-store enable file|os|auto' }
    ]
  },
  { name: 'migrate-config', description: 'Migrate legacy config into pp config', usage: 'pp migrate-config [--source-config PATH] [--source-dir DIR] [--config-dir DIR] [--apply]' },
  { name: 'update', description: 'Check GitHub releases for updates', usage: 'pp update [flags]' },
  { name: 'version', description: 'Print the current version', usage: 'pp version' },
  { name: 'completion', description: 'Print shell completion script', usage: 'pp completion [zsh|bash|powershell]' },
  { name: 'help', description: 'Print help', usage: 'pp help' }
];

export type CliCommandName = (typeof CLI_COMMANDS)[number]['name'];

export function resolveCliCommandName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const command = CLI_COMMANDS.find((item) => item.name === value || item.aliases?.includes(value));
  return command?.name;
}

export function cliCompletionWords(): string[] {
  return CLI_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
}

export function renderMainHelp(): string {
  return [
    'pp',
    '',
    'CLI for Power Platform auth, environments, requests, and MCP access.',
    '',
    'Usage:',
    '  pp <command> [args]',
    '',
    'Commands:',
    ...CLI_COMMANDS.filter((command) => command.name !== 'help').flatMap((command) => [command.helpLine ?? formatHelpLine(command.name, command.description), ...(command.aliasHelpLines ?? [])])
  ].join('\n');
}

export function renderCompletionScript(shell: string): string {
  const words = cliCompletionWords().join(' ');
  if (shell === 'powershell') {
    return [
      '@(',
      `  ${cliCompletionWords()
        .map((command) => `'${command}'`)
        .join(',')}`,
      ') | ForEach-Object {',
      '  Register-ArgumentCompleter -CommandName pp -ScriptBlock { param($wordToComplete) $_ | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, \'ParameterValue\', $_) } }',
      '}'
    ].join('\n');
  }
  if (shell === 'bash') {
    return `complete -W "${words}" pp`;
  }
  return `#compdef pp\n_arguments "1: :((${words}))"`;
}

function formatHelpLine(name: string, description: string): string {
  return `  ${name.padEnd(15)} ${description}`;
}
