function writeHelp(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function printHelp(): void {
  writeHelp([
    'pp',
    '',
    'Power Platform CLI for authenticated Dataverse access, solution lifecycle,',
    'and local canvas and flow tooling.',
    '',
    'Concepts:',
    '  auth profile        how pp gets credentials',
    '  environment alias   named Dataverse target that points to a URL and auth profile',
    '',
    'Resolution:',
    '  --environment flag -> pp.config.yaml defaults -> environment alias -> auth profile -> token',
    '',
    'Commands:',
    '  auth          manage auth profiles, browser profiles, login, and tokens',
    '  env           manage Dataverse environment aliases',
    '  dv            Dataverse requests, rows, and metadata workflows',
    '  solution      solution lifecycle: list, inspect, create, export, import, publish',
    '  canvas        local canvas app validation, linting, building, and inspection',
    '  flow          local flow validation, linting, and inspection',
    '  mcp           stdio MCP server for agent integration',
    '',
    'Utilities:',
    '  diagnostics   installation and configuration diagnostics',
    '  version       print the CLI version',
    '  completion    shell completion script generation',
    '',
    'Getting started:',
    '  pp auth profile add-user --name work',
    '  pp env add dev --url https://contoso.crm.dynamics.com --profile work',
    '  pp dv whoami --env dev',
    '  pp solution list --env dev',
    '',
    'Local defaults (pp.config.yaml):',
    '  defaults:',
    '    environment: dev',
    '    solution: Core',
    '  artifacts:',
    '    solutions: .pp/solutions',
    '',
    'Common options:',
    '  --format table|json|yaml|ndjson|markdown|raw',
    '  --dry-run  preview mutations without side effects',
    '  --plan     render a mutation plan without side effects',
  ]);
}

export function printAuthHelp(): void {
  writeHelp([
    'Usage: auth <command> [options]',
    '',
    'Manage how pp authenticates to remote services.',
    '',
    'Commands:',
    '  profile         create, inspect, and remove auth profiles',
    '  browser-profile manage browser launch profiles used by interactive auth or Maker handoff flows',
    '  login           acquire a token for one profile and resource',
    '  token           print a token for one profile and resource',
    '',
    'Concepts:',
    '  auth profile      stores how pp gets credentials',
    '  browser profile   stores how pp launches a browser session when a flow needs one',
    '',
    'Relationship model:',
    '  one auth profile can be reused by multiple environment aliases',
    '  browser profiles are launch contexts, not identities',
    '',
    'Decision guide:',
    '  - Need pp to read credentials from an environment variable? Use `pp auth profile add-env`.',
    '  - Need a named Dataverse target such as `dev` or `test`? Use `pp env add`.',
    '  - Need to see which profile an alias already uses? Use `pp auth profile inspect --environment dev`.',
    '',
    'Examples:',
    '  pp auth profile add-user --name work',
    '  pp auth profile add-env --name ci --env-var PP_ACCESS_TOKEN',
    '  pp auth browser-profile add --name edge-work --kind edge',
    '  pp auth login --name work --resource https://contoso.crm.dynamics.com',
    '',
    'See also:',
    '  - Use `pp env add` to bind a Dataverse environment URL to an existing auth profile.',
  ]);
}

export function printAuthProfileHelp(): void {
  writeHelp([
    'Usage: auth profile <command> [options]',
    '',
    'Manage authentication profiles used by pp.',
    '',
    'A profile defines how pp gets credentials.',
    'Use `pp env add` separately to bind a Dataverse environment URL to a profile.',
    'Multiple environment aliases may point at the same auth profile.',
    '',
    'Decision guide:',
    '  - `add-user`, `add-device-code`, `add-client-secret`, `add-static`, and `add-env` create credential sources.',
    '  - `add-env` means "read a token from an environment variable", not "register a Dataverse environment".',
    '  - Use `pp env add` for Dataverse aliases, then `pp auth profile inspect --environment <alias>` to confirm the binding later.',
    '',
    'Commands:',
    '  list                 list auth profiles',
    '  inspect <name>       inspect one profile, or resolve the profile behind an environment alias',
    '  add-user             create a profile that uses interactive user login',
    '  add-static           create a profile backed by a literal token value',
    '  add-env              create a token-env auth profile, not a Dataverse environment alias',
    '  add-client-secret    create an app-based profile using client credentials',
    '  add-device-code      create a profile that signs in with the device code flow',
    '  remove <name>        remove one profile',
    '',
    'Examples:',
    '  pp auth profile add-user --name work',
    '  pp auth profile add-env --name ci --env-var PP_ACCESS_TOKEN',
    '  pp auth profile inspect work',
    '  pp auth profile inspect --environment dev',
    '',
    'Common output options:',
    '  --format table|json|yaml|ndjson|markdown|raw',
  ]);
}

export function printAuthProfileListHelp(): void {
  writeHelp([
    'Usage: auth profile list [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
    '',
    'Behavior:',
    '  - Lists auth profiles known to pp.',
    '  - Returns the profile name, type, default resource, and browser-profile association when present.',
    '',
    'Examples:',
    '  pp auth profile list',
    '  pp auth profile list --format json',
  ]);
}

export function printAuthProfileInspectHelp(): void {
  writeHelp([
    'Usage:',
    '  auth profile inspect <name> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
    '  auth profile inspect --environment ALIAS [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
    '',
    'Behavior:',
    '  - Inspects one auth profile directly by name.',
    '  - Or resolves the auth profile attached to a Dataverse environment alias.',
    '  - Also accepts the shorthand positional form `environment:ALIAS` when the surrounding workflow already carries an environment-prefixed target.',
    '  - Environment-scoped output includes the resolved alias URL, target resource, and whether the profile default resource still matches that alias.',
    '  - Includes reverse relationship context: which environment aliases reuse this profile and whether the current project routes any stages through them.',
    '',
    'Examples:',
    '  pp auth profile inspect work',
    '  pp auth profile inspect --environment dev',
    '  pp auth profile inspect environment:dev',
  ]);
}

export function printAuthProfileAddUserHelp(): void {
  writeHelp([
    'Usage: auth profile add-user --name NAME [--resource URL] [--scope s1,s2] [--login-hint user@contoso.com] [--browser-profile NAME] [--config-dir path]',
    '',
    'Behavior:',
    '  - Creates an auth profile that can sign in as a user through the browser flow.',
    '  - If `--scope` is supplied, pp stores those exact delegated scopes on the profile instead of deriving `<resource>/user_impersonation` later.',
    '  - Optionally records a browser profile for later interactive auth or Maker handoff use.',
    '',
    'Examples:',
    '  pp auth profile add-user --name work',
    '  pp auth profile add-user --name graph --scope User.Read,openid --login-hint user@contoso.com',
    '  pp auth profile add-user --name work --login-hint user@contoso.com --browser-profile edge-work',
    '',
    'See also:',
    '  - Use `pp env add dev --url https://contoso.crm.dynamics.com --profile work` after the profile exists.',
  ]);
}

export function printAuthProfileAddStaticHelp(): void {
  writeHelp([
    'Usage: auth profile add-static --name NAME --token TOKEN [--resource URL]',
    '',
    'Behavior:',
    '  - Creates an auth profile backed by a literal access token value.',
    '  - Best suited to short-lived testing or controlled automation, not long-lived local setup.',
    '',
    'Examples:',
    '  pp auth profile add-static --name fixture --token eyJ...',
  ]);
}

export function printAuthProfileAddEnvHelp(): void {
  writeHelp([
    'Usage: auth profile add-env --name NAME --env-var ENV_VAR [--resource URL]',
    '',
    'Behavior:',
    '  - Creates an auth profile that reads its token from an environment variable.',
    '  - This does not add a Dataverse environment alias.',
    '',
    'When to use this:',
    '  - CI or automation already provides an access token in an env var.',
    '',
    'Common confusion:',
    '  - If you want to add a new Dataverse environment to pp, use `pp env add` instead.',
    '  - If you already have an alias and want to see its bound profile, use `pp auth profile inspect --environment <alias>`.',
    '',
    'Examples:',
    '  pp auth profile add-env --name ci --env-var PP_ACCESS_TOKEN',
    '  pp env add dev --url https://contoso.crm.dynamics.com --profile ci',
    '  pp auth profile inspect --environment dev',
  ]);
}

export function printAuthProfileAddClientSecretHelp(): void {
  writeHelp([
    'Usage: auth profile add-client-secret --name NAME --tenant-id TENANT --client-id CLIENT --secret-env ENV_VAR [--resource URL] [--scope s1,s2]',
    '',
    'Behavior:',
    '  - Creates an app-based auth profile using client credentials.',
    '  - The client secret is read from the named environment variable at runtime.',
    '',
    'Examples:',
    '  pp auth profile add-client-secret --name ci-app --tenant-id <tenant> --client-id <app-id> --secret-env PP_CLIENT_SECRET',
  ]);
}

export function printAuthProfileAddDeviceCodeHelp(): void {
  writeHelp([
    'Usage: auth profile add-device-code --name NAME [--resource URL] [--scope s1,s2] [--login-hint user@contoso.com] [--config-dir path]',
    '',
    'Behavior:',
    '  - Creates an auth profile that signs in with the device code flow.',
    '  - If `--scope` is supplied, pp stores those exact scopes on the profile instead of deriving them from `--resource`.',
    '  - Useful when a browser is unavailable or you want a more explicit interactive flow.',
    '',
    'Examples:',
    '  pp auth profile add-device-code --name work-device',
  ]);
}

export function printAuthProfileRemoveHelp(): void {
  writeHelp([
    'Usage: auth profile remove <name> [--config-dir path]',
    '',
    'Behavior:',
    '  - Removes one auth profile from pp config.',
    '  - Environment aliases that point to this profile will need to be updated separately.',
    '',
    'Examples:',
    '  pp auth profile remove work',
  ]);
}

export function printAuthBrowserProfileHelp(): void {
  writeHelp([
    'Usage: auth browser-profile <command> [options]',
    '',
    'Manage browser launch profiles used by interactive auth and Maker handoff workflows.',
    '',
    'Commands:',
    '  list            list browser profiles',
    '  inspect <name>  inspect one browser profile',
    '  add             create a browser profile',
    '  bootstrap <name> open a browser profile against a target URL',
    '  remove <name>   remove a browser profile',
    '',
    'Examples:',
    '  pp auth browser-profile add --name edge-work --kind edge',
    '  pp auth browser-profile bootstrap edge-work',
  ]);
}

export function printAuthBrowserProfileListHelp(): void {
  writeHelp([
    'Usage: auth browser-profile list [--config-dir path]',
    '',
    'Behavior:',
    '  - Lists configured browser profiles and their launch configuration.',
  ]);
}

export function printAuthBrowserProfileInspectHelp(): void {
  writeHelp([
    'Usage: auth browser-profile inspect <name> [--config-dir path]',
    '',
    'Behavior:',
    '  - Inspects one browser profile, including its launcher kind and directory when configured.',
  ]);
}

export function printAuthBrowserProfileAddHelp(): void {
  writeHelp([
    'Usage: auth browser-profile add --name NAME [--kind edge|chrome|chromium|custom] [--command PATH] [--arg ARG] [--directory PATH] [--config-dir path]',
    '',
    'Behavior:',
    '  - Creates a named browser launch profile for interactive auth or Maker handoff flows.',
    '',
    'Examples:',
    '  pp auth browser-profile add --name edge-work --kind edge',
    '  pp auth browser-profile add --name custom-chrome --kind custom --command /path/to/chrome --directory ~/.config/pp-chrome',
  ]);
}

export function printAuthBrowserProfileBootstrapHelp(): void {
  writeHelp([
    'Usage: auth browser-profile bootstrap <name> [--url URL] [--no-wait] [--config-dir path]',
    '',
    'Behavior:',
    '  - Launches the named browser profile against a bootstrap URL.',
    '  - Useful for warming a session before interactive auth or Maker automation.',
  ]);
}

export function printAuthBrowserProfileRemoveHelp(): void {
  writeHelp([
    'Usage: auth browser-profile remove <name> [--config-dir path]',
    '',
    'Behavior:',
    '  - Removes one browser profile from pp config.',
  ]);
}

export function printAuthLoginHelp(): void {
  writeHelp([
    'Usage: auth login --name NAME [--resource URL] [--scope s1,s2] [--login-hint user@contoso.com] [--browser-profile NAME] [--force-prompt] [--device-code] [--config-dir path]',
    '',
    'Behavior:',
    '  - Performs an interactive sign-in for the named auth profile and target resource.',
    '  - For normal Dataverse sign-in, prefer `--resource https://<org>.crm.dynamics.com`.',
    '  - `--resource` lets pp derive a standard scope such as `<resource>/user_impersonation` for user auth.',
    '  - `--scope` is an advanced escape hatch for exact OAuth scopes and those stored scopes take precedence over `--resource` on later logins.',
    '  - Use `--device-code` to force the device code flow.',
    '',
    'Examples:',
    '  pp auth login --name work --resource https://contoso.crm.dynamics.com',
    '  pp auth login --name graph --scope User.Read,openid --login-hint user@contoso.com',
  ]);
}

export function printAuthTokenHelp(): void {
  writeHelp([
    'Usage: auth token --profile NAME [--resource URL] [--format raw|json]',
    '',
    'Behavior:',
    '  - Prints an access token resolved through the named auth profile.',
    '  - Useful for debugging profile setup or wiring pp auth into adjacent tooling.',
  ]);
}
