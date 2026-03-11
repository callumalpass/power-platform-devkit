export function printHelp(): void {
  process.stdout.write(
    [
      'pp',
      '',
      'Power Platform CLI for local project work, Dataverse environments, solutions, and deployment workflows.',
      '',
      'Concepts:',
      '  auth profile        how pp gets credentials',
      '  environment alias   named Dataverse target that points to a URL and auth profile',
      '  stage               project topology selector for deploy and analysis workflows',
      '',
      'Resolution model:',
      '  project/stage -> environment alias -> auth profile -> token -> Dataverse/solution',
      '',
      'Top-level areas:',
      '  auth          manage auth profiles, browser profiles, login, and tokens',
      '  env           manage Dataverse environment aliases',
      '  dv            Dataverse requests, rows, and metadata workflows',
      '  solution      inspect and mutate solutions',
      '  connref       inspect, validate, and mutate connection references',
      '  envvar        inspect and mutate environment variables',
      '  canvas        inspect and package canvas apps',
      '  flow          inspect and package flows',
      '  model         inspect model-driven apps',
      '  project       manage local pp project layout and topology',
      '  analysis      project analysis and context capture',
      '  deploy        deployment planning and apply workflows',
      '  sharepoint    inspect SharePoint bindings and assets',
      '  powerbi       inspect Power BI bindings and assets',
      '  diagnostics   install/config/project diagnostics',
      '  completion    shell completion script generation',
      '  version       print the CLI version',
      '',
      'Getting started:',
      '  pp auth profile add-user --name work',
      '  pp env add --name dev --url https://contoso.crm.dynamics.com --profile work',
      '  pp dv whoami --environment dev',
      '',
      'Examples:',
      '  pp auth --help',
      '  pp auth profile --help',
      '  pp env add --help',
      '  pp solution list --help',
      '',
      'Common output option:',
      '  --format table|json|yaml|ndjson|markdown|raw',
      '',
      'Mutation command options:',
      '  --dry-run  render a mutation preview without side effects',
      '  --plan     render a mutation plan without side effects',
      '  --yes      record non-interactive confirmation for guarded workflows',
    ].join('\n') + '\n'
  );
}

export function printAuthHelp(): void {
  process.stdout.write(
    [
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
      'Examples:',
      '  pp auth profile add-user --name work',
      '  pp auth profile add-env --name ci --env-var PP_ACCESS_TOKEN',
      '  pp auth browser-profile add --name edge-work --kind edge',
      '  pp auth login --name work --resource https://contoso.crm.dynamics.com',
      '',
      'See also:',
      '  - Use `pp env add` to bind a Dataverse environment URL to an existing auth profile.',
    ].join('\n') + '\n'
  );
}

export function printAuthProfileHelp(): void {
  process.stdout.write(
    [
      'Usage: auth profile <command> [options]',
      '',
      'Manage authentication profiles used by pp.',
      '',
      'A profile defines how pp gets credentials.',
      'Use `pp env add` separately to bind a Dataverse environment URL to a profile.',
      'Multiple environment aliases may point at the same auth profile.',
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
    ].join('\n') + '\n'
  );
}

export function printAuthProfileListHelp(): void {
  process.stdout.write(
    [
      'Usage: auth profile list [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Lists auth profiles known to pp.',
      '  - Returns the profile name, type, default resource, and browser-profile association when present.',
      '',
      'Examples:',
      '  pp auth profile list',
      '  pp auth profile list --format json',
    ].join('\n') + '\n'
  );
}

export function printAuthProfileInspectHelp(): void {
  process.stdout.write(
    [
      'Usage:',
      '  auth profile inspect <name> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  auth profile inspect --environment ALIAS [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Inspects one auth profile directly by name.',
      '  - Or resolves the auth profile attached to a Dataverse environment alias.',
      '  - Environment-scoped output includes the resolved alias URL, target resource, and whether the profile default resource still matches that alias.',
      '  - Includes reverse relationship context: which environment aliases reuse this profile and whether the current project routes any stages through them.',
      '',
      'Examples:',
      '  pp auth profile inspect work',
      '  pp auth profile inspect --environment dev',
    ].join('\n') + '\n'
  );
}

export function printAuthProfileAddUserHelp(): void {
  process.stdout.write(
    [
      'Usage: auth profile add-user --name NAME [--resource URL] [--login-hint user@contoso.com] [--browser-profile NAME] [--config-dir path]',
      '',
      'Behavior:',
      '  - Creates an auth profile that can sign in as a user through the browser flow.',
      '  - Optionally records a browser profile for later interactive auth or Maker handoff use.',
      '',
      'Examples:',
      '  pp auth profile add-user --name work',
      '  pp auth profile add-user --name work --login-hint user@contoso.com --browser-profile edge-work',
      '',
      'See also:',
      '  - Use `pp env add --name dev --url https://contoso.crm.dynamics.com --profile work` after the profile exists.',
    ].join('\n') + '\n'
  );
}

export function printAuthProfileAddStaticHelp(): void {
  process.stdout.write(
    [
      'Usage: auth profile add-static --name NAME --token TOKEN [--resource URL]',
      '',
      'Behavior:',
      '  - Creates an auth profile backed by a literal access token value.',
      '  - Best suited to short-lived testing or controlled automation, not long-lived local setup.',
      '',
      'Examples:',
      '  pp auth profile add-static --name fixture --token eyJ...',
    ].join('\n') + '\n'
  );
}

export function printAuthProfileAddEnvHelp(): void {
  process.stdout.write(
    [
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
      '',
      'Examples:',
      '  pp auth profile add-env --name ci --env-var PP_ACCESS_TOKEN',
      '  pp env add --name dev --url https://contoso.crm.dynamics.com --profile ci',
    ].join('\n') + '\n'
  );
}

export function printAuthProfileAddClientSecretHelp(): void {
  process.stdout.write(
    [
      'Usage: auth profile add-client-secret --name NAME --tenant-id TENANT --client-id CLIENT --secret-env ENV_VAR [--resource URL] [--scope s1,s2]',
      '',
      'Behavior:',
      '  - Creates an app-based auth profile using client credentials.',
      '  - The client secret is read from the named environment variable at runtime.',
      '',
      'Examples:',
      '  pp auth profile add-client-secret --name ci-app --tenant-id <tenant> --client-id <app-id> --secret-env PP_CLIENT_SECRET',
    ].join('\n') + '\n'
  );
}

export function printAuthProfileAddDeviceCodeHelp(): void {
  process.stdout.write(
    [
      'Usage: auth profile add-device-code --name NAME [--resource URL] [--login-hint user@contoso.com] [--config-dir path]',
      '',
      'Behavior:',
      '  - Creates an auth profile that signs in with the device code flow.',
      '  - Useful when a browser is unavailable or you want a more explicit interactive flow.',
      '',
      'Examples:',
      '  pp auth profile add-device-code --name work-device',
    ].join('\n') + '\n'
  );
}

export function printAuthProfileRemoveHelp(): void {
  process.stdout.write(
    [
      'Usage: auth profile remove <name> [--config-dir path]',
      '',
      'Behavior:',
      '  - Removes one auth profile from pp config.',
      '  - Environment aliases that point to this profile will need to be updated separately.',
      '',
      'Examples:',
      '  pp auth profile remove work',
    ].join('\n') + '\n'
  );
}

export function printAuthBrowserProfileHelp(): void {
  process.stdout.write(
    [
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
    ].join('\n') + '\n'
  );
}

export function printAuthBrowserProfileListHelp(): void {
  process.stdout.write(
    [
      'Usage: auth browser-profile list [--config-dir path]',
      '',
      'Behavior:',
      '  - Lists configured browser profiles and their launch configuration.',
    ].join('\n') + '\n'
  );
}

export function printAuthBrowserProfileInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: auth browser-profile inspect <name> [--config-dir path]',
      '',
      'Behavior:',
      '  - Inspects one browser profile, including its launcher kind and directory when configured.',
    ].join('\n') + '\n'
  );
}

export function printAuthBrowserProfileAddHelp(): void {
  process.stdout.write(
    [
      'Usage: auth browser-profile add --name NAME [--kind edge|chrome|chromium|custom] [--command PATH] [--arg ARG] [--directory PATH] [--config-dir path]',
      '',
      'Behavior:',
      '  - Creates a named browser launch profile for interactive auth or Maker handoff flows.',
      '',
      'Examples:',
      '  pp auth browser-profile add --name edge-work --kind edge',
      '  pp auth browser-profile add --name custom-chrome --kind custom --command /path/to/chrome --directory ~/.config/pp-chrome',
    ].join('\n') + '\n'
  );
}

export function printAuthBrowserProfileBootstrapHelp(): void {
  process.stdout.write(
    [
      'Usage: auth browser-profile bootstrap <name> [--url URL] [--no-wait] [--config-dir path]',
      '',
      'Behavior:',
      '  - Launches the named browser profile against a bootstrap URL.',
      '  - Useful for warming a session before interactive auth or Maker automation.',
    ].join('\n') + '\n'
  );
}

export function printAuthBrowserProfileRemoveHelp(): void {
  process.stdout.write(
    [
      'Usage: auth browser-profile remove <name> [--config-dir path]',
      '',
      'Behavior:',
      '  - Removes one browser profile from pp config.',
    ].join('\n') + '\n'
  );
}

export function printAuthLoginHelp(): void {
  process.stdout.write(
    [
      'Usage: auth login --name NAME --resource URL [--login-hint user@contoso.com] [--browser-profile NAME] [--force-prompt] [--device-code] [--config-dir path]',
      '',
      'Behavior:',
      '  - Performs an interactive sign-in for the named auth profile and target resource.',
      '  - Use `--device-code` to force the device code flow.',
    ].join('\n') + '\n'
  );
}

export function printAuthTokenHelp(): void {
  process.stdout.write(
    [
      'Usage: auth token --profile NAME [--resource URL] [--format raw|json]',
      '',
      'Behavior:',
      '  - Prints an access token resolved through the named auth profile.',
      '  - Useful for debugging profile setup or wiring pp auth into adjacent tooling.',
    ].join('\n') + '\n'
  );
}

export function printModelHelp(): void {
  process.stdout.write(
    [
      'Usage: model <command> [options]',
      '',
      'Commands:',
      '  create <uniqueName>         create a model-driven app through a solution-aware Dataverse workflow',
      '  attach <name|id|uniqueName> attach an existing model-driven app to a solution through AddSolutionComponent',
      '  list                        list model-driven apps',
      '  inspect <name|id|uniqueName> inspect one model-driven app',
      '  composition <name|id|uniqueName> emit a normalized composition graph',
      '  impact <name|id|uniqueName> preview artifact impact within one model-driven app',
      '  sitemap <name|id|uniqueName> list sitemap artifacts',
      '  forms <name|id|uniqueName>   list form artifacts',
      '  views <name|id|uniqueName>   list view artifacts',
      '  dependencies <name|id|uniqueName> list dependency artifacts',
      '  patch plan <name|id|uniqueName> preview bounded rename mutations',
      '',
      'Examples:',
      '  pp model create SalesHub --environment dev --name "Sales Hub" --solution Core',
      '  pp model attach SalesHub --environment dev --solution Core',
      '  pp model inspect SalesHub --environment dev --solution Core',
      '',
      'Notes:',
      '  - `model create` uses solution-scoped Dataverse creation when `--solution` or the environment alias defaultSolution is available.',
      '  - `model attach` uses `--solution` when provided, otherwise the environment alias defaultSolution when configured.',
      '  - `model attach` uses the supported solution component action rather than direct raw row writes.',
      '  - Composition inspection and patch planning remain bounded to the current read-first model surface.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas <command> [options]',
      '',
      'Work with canvas apps in two modes:',
      '  remote  inspect or download apps already in Dataverse',
      '  local   validate, inspect, patch, diff, and build source trees in the repo',
      '',
      'Remote canvas commands:',
      '  list                         list remote canvas apps through Dataverse',
      '  attach <displayName|name|id> attach an existing remote canvas app to a solution through AddSolutionComponent',
      '  download <displayName|name|id> export a solution-scoped remote canvas app into an .msapp',
      '  inspect <displayName|name|id> inspect a remote canvas app when used with --environment',
      '  create                       preview handoff today; `--delegate` can drive the Maker blank-app flow through a browser profile',
      '  import <file.msapp>          reserved for future remote import; currently returns diagnostics',
      '',
      'Local canvas commands:',
      '  validate <path>              validate a local canvas source tree',
      '  lint <path>                  emit metadata-aware lint diagnostics for a local canvas source tree',
      '  inspect <path>               inspect a local canvas source tree',
      '  build <path>                 package a local canvas source tree into an .msapp',
      '  diff <leftPath> <rightPath>  diff two local canvas source trees',
      '  workspace inspect <path>     inspect a versioned canvas workspace manifest',
      '  patch plan <path> --file ... preview a bounded canvas patch against json-manifest apps',
      '  patch apply <path> --file ... apply a bounded canvas patch in place or into --out',
      '',
      'Template registry commands:',
      '  templates import <sourcePath> import harvested or official template metadata',
      '  templates inspect <registry> summarize a pinned registry snapshot',
      '  templates diff <left> <right> compare two registry snapshots',
      '  templates pin <registry> --out FILE normalize and write a pinned registry file',
      '  templates refresh <source>   re-import a source catalog and optionally diff against --current',
      '  templates audit <registry>   summarize provenance coverage and version metadata',
      '',
      'How to think about it:',
      '  - Use remote commands when the app already exists in an environment and you need discovery or export.',
      '  - Use local commands once the artifact is in source form and you want deterministic validation or packaging.',
      '  - Create/import still rely on preview handoff flows because Microsoft does not expose a fully supported server-side path here.',
      '',
      'Examples:',
      '  pp canvas list --environment dev --solution Core',
      '  pp canvas attach "Harness Canvas" --environment dev --solution Core',
      '  pp canvas download "Harness Canvas" --environment dev --solution Core --out ./artifacts/HarnessCanvas.msapp',
      '  pp canvas inspect "Harness Canvas" --environment dev --solution Core',
      '  pp canvas inspect ./apps/MyCanvas --project . --mode strict',
      '  pp canvas build ./apps/MyCanvas --project . --out ./dist/MyCanvas.msapp',
      '',
      'Notes:',
      '  - Remote canvas download exports the containing solution through Dataverse and extracts CanvasApps/*.msapp without leaving pp.',
      '  - Remote create/import still use preview flows rather than first-class server-side APIs.',
      '  - `canvas create --delegate` can drive the Maker blank-app flow and wait for the created app id through Dataverse.',
      '  - Attempted remote create/import calls return machine-readable diagnostics with next steps.',
      '  - Use --environment to switch canvas inspect from local-path mode to remote lookup mode.',
      '  - Use --workspace to resolve a workspace app name plus shared registry catalogs.',
      '  - Canvas patching currently targets the supported json-manifest source slice only.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasAttachHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas attach <displayName|name|id> --environment ALIAS --solution UNIQUE_NAME [options]',
      '',
      'Status:',
      '  Attaches an existing remote canvas app to a solution through Dataverse AddSolutionComponent.',
      '',
      'Behavior:',
      '  - Requires `--environment` and `--solution` to resolve the target environment alias and solution.',
      '  - Uses the existing pp Dataverse auth context; it does not shell out to pac.',
      '  - Includes required solution components by default; pass `--no-add-required-components` to opt out.',
      '',
      'Examples:',
      '  pp canvas attach "Harness Canvas" --environment dev --solution Core',
      '  pp canvas attach crd_HarnessCanvas --environment dev --solution Core --no-add-required-components',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseHelp(): void {
  process.stdout.write(
    [
      'Usage: dv <command> [options]',
      '',
      'Commands:',
      '  whoami                      resolve the current caller and target environment',
      '  request                     issue a raw Dataverse Web API request',
      '  action <name>               invoke a Dataverse action with typed parameters',
      '  function <name>             invoke a Dataverse function with typed parameters',
      '  batch                       execute a Dataverse $batch manifest',
      '  rows ...                    export row sets or apply typed row manifests',
      '  query <table>               query table rows through Dataverse',
      '  get <table> <id>            fetch one Dataverse row by id',
      '  create <table>              create one Dataverse row',
      '  update <table> <id>         update one Dataverse row',
      '  delete <table> <id>         delete one Dataverse row',
      '  metadata ...                inspect or mutate Dataverse metadata',
      '',
      'Examples:',
      '  pp dv whoami --environment dev --format json',
      '  pp dv query solutions --environment dev --select solutionid,uniquename --top 5',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseWhoAmIHelp(): void {
  process.stdout.write(
    [
      'Usage: dv whoami --environment ALIAS [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Resolves the target environment alias and auth profile.',
      '  - Returns the current Dataverse caller and business unit ids with environment context.',
      '',
      'Examples:',
      '  pp dv whoami --environment dev',
      '  pp dv whoami --environment dev --format json',
      '  pp dv whoami --environment dev --no-interactive-auth --format json',
      '',
      'Options:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseRowsHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows <command> [options]',
      '',
      'Commands:',
      '  export <table>              export a Dataverse row set with query metadata',
      '  apply                       apply a typed row-mutation manifest through Dataverse batch',
      '',
      'Examples:',
      '  pp dv rows export accounts --environment dev --select accountid,name --all --out ./accounts.json',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml --solution Core',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseRowsExportHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows export <table> --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Queries Dataverse rows and packages them into a stable row-set artifact.',
      '  - Includes query metadata so the exported file records how the slice was collected.',
      '  - Writes JSON or YAML when `--out` is provided; otherwise prints the artifact to stdout.',
      '',
      'Examples:',
      '  pp dv rows export accounts --environment dev --select accountid,name --top 100',
      '  pp dv rows export accounts --environment dev --filter "statecode eq 0" --all --out ./accounts.yaml',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseRowsApplyHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows apply --file FILE --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Reads a typed row-mutation manifest instead of raw HTTP batch parts.',
      '  - Supports `create`, `update`, `upsert`, and `delete` operations.',
      '  - Uses Dataverse batch under the hood while preserving row-level paths and results.',
      '',
      'Examples:',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml --continue-on-error --solution Core',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseMetadataHelp(): void {
  process.stdout.write(
    [
      'Usage: dv metadata <command> [options]',
      '',
      'Read commands:',
      '  tables                                  list Dataverse tables',
      '  table <logicalName>                     inspect one table definition',
      '  columns <tableLogicalName>              list columns for a table',
      '  column <tableLogicalName> <column>      inspect one column definition',
      '  option-set <name>                       inspect one global option set',
      '  relationship <schemaName>               inspect one relationship definition',
      '  snapshot <kind> ...                     save stable table, columns, option-set, or relationship snapshots',
      '  diff --left FILE --right FILE           compare two saved metadata snapshots',
      '',
      'Write commands:',
      '  apply --file FILE                       apply a metadata manifest',
      '  create-table --file FILE                create a new Dataverse table',
      '  update-table <table> --file FILE        update a table definition',
      '  add-column <table> --file FILE          create a new column on an existing table',
      '  update-column <table> <column> --file FILE',
      '                                         update an existing column definition',
      '  create-option-set --file FILE           create a global option set',
      '  update-option-set --file FILE           update a global option set',
      '  create-relationship --file FILE         create a one-to-many relationship',
      '  update-relationship <schemaName> --kind one-to-many|many-to-many --file FILE',
      '                                         update an existing relationship',
      '  create-many-to-many --file FILE         create a many-to-many relationship',
      '  create-customer-relationship --file FILE',
      '                                         create a customer lookup and paired relationships',
      '',
      'Notes:',
      '  - Read commands accept `--environment ALIAS` plus `--select`, `--expand`, `--filter`, and view flags where supported.',
      '  - Write commands accept `--environment ALIAS`, `--file FILE`, optional `--solution UNIQUE_NAME`, and publish controls.',
      '  - Write results include `entitySummary`; `dv metadata apply` also includes a grouped `summary` for touched tables, columns, relationships, and option sets.',
      '',
      'Examples:',
      '  pp dv metadata tables --environment dev --top 10 --format json',
      '  pp dv metadata column account name --environment dev --view detailed',
      '  pp dv metadata create-table --environment dev --solution Core --file ./specs/project.table.yaml --format json',
      '  pp dv metadata create-relationship --environment dev --solution Core --file ./specs/project-account.relationship.yaml --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printSolutionHelp(): void {
  process.stdout.write(
    [
      'Usage: solution <command> [options]',
      '',
      'Manage the remote application boundary inside a Dataverse environment.',
      '',
      'Remote commands:',
      '  create <uniqueName>         create a solution shell in an environment',
      '  delete <uniqueName>         delete one solution from an environment',
      '  set-metadata <uniqueName>   update solution publisher or version metadata',
      '  list                        list solutions in an environment',
      '  inspect <uniqueName>        inspect one solution',
      '  components <uniqueName>     list solution components',
      '  dependencies <uniqueName>   list solution dependencies',
      '  analyze <uniqueName>        render a normalized analysis view',
      '  compare [uniqueName]        compare source and target solution states',
      '  export <uniqueName>         export a solution package',
      '  import <path.zip>           import a solution package',
      '',
      'Local package commands:',
      '  pack <folder>               pack a local solution folder into a zip',
      '  unpack <path.zip>           unpack a solution zip into a folder',
      '',
      'How to think about it:',
      '  - Use remote commands when the solution already lives in Dataverse and you need inventory, metadata, or lifecycle operations.',
      '  - Use pack/unpack when you are moving between editable local source and packaged zip artifacts.',
      '  - A solution is the ALM boundary that groups canvas apps, flows, model-driven apps, env vars, and connection references.',
      '',
      'Examples:',
      '  pp solution list --environment dev --format json',
      '  pp solution list --environment dev --prefix ppHarness --format json',
      '  pp solution inspect Core --environment dev',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printSolutionListHelp(): void {
  process.stdout.write(
    [
      'Usage: solution list --environment ALIAS [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Lists installed solutions in the target environment across all Dataverse pages.',
      '  - Returns structured records with solution ids, unique names, friendly names, versions, and managed state.',
      '  - Use --prefix to narrow by unique/friendly name prefix or --unique-name for one exact solution.',
      '',
      'Choose this when:',
      '  - You know the environment but not yet the exact solution boundary you need.',
      '',
      'Examples:',
      '  pp solution list --environment dev',
      '  pp solution list --environment dev --format json',
      '  pp solution list --environment dev --no-interactive-auth --format json',
      '  pp solution list --environment dev --prefix ppHarness20260310T200706248Z --format json',
      '',
      'Options:',
      '  --prefix PREFIX            Match solution unique names or friendly names starting with PREFIX',
      '  --unique-name NAME        Match one exact solution unique name',
      '  --no-interactive-auth     Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printSolutionCreateHelp(): void {
  process.stdout.write(
    [
      'Usage: solution create <uniqueName> --environment ALIAS [--friendly-name NAME] [--version X.Y.Z.W] [--description TEXT] (--publisher-id GUID | --publisher-unique-name NAME)',
      '',
      'Behavior:',
      '  - Creates one unmanaged solution shell in the target environment.',
      '  - Requires either a publisher id or publisher unique name so the new solution has an explicit publisher binding.',
      '  - `--help` only prints this text and never validates the solution name or environment flags.',
      '',
      'Choose this when:',
      '  - You need a new ALM boundary in Dataverse before attaching apps, env vars, connection references, or solution-scoped metadata.',
      '',
      'Examples:',
      '  pp solution create Core --environment dev --publisher-unique-name pp',
      '  pp solution create Core --environment dev --friendly-name "Core" --version 1.0.0.0 --publisher-id 00000000-0000-0000-0000-000000000000',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printSolutionSetMetadataHelp(): void {
  process.stdout.write(
    [
      'Usage: solution set-metadata <uniqueName> --environment ALIAS [--version X.Y.Z.W] [--publisher-id GUID | --publisher-unique-name NAME]',
      '',
      'Behavior:',
      '  - Updates publisher binding and/or version metadata for one existing solution.',
      '  - Requires at least one of `--version`, `--publisher-id`, or `--publisher-unique-name`.',
      '  - `--help` only prints this text and never validates the solution name or environment flags.',
      '',
      'Choose this when:',
      '  - The solution already exists and you need to align versioning or publisher ownership before export, deploy, or app attachment.',
      '',
      'Examples:',
      '  pp solution set-metadata Core --environment dev --version 2026.3.11.51035',
      '  pp solution set-metadata Core --environment dev --publisher-unique-name pp',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printSolutionComponentsHelp(): void {
  process.stdout.write(
    [
      'Usage: solution components <uniqueName> --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Lists the components currently attached to one solution in the target environment.',
      '  - Returns stable structured rows including the component type, display name, object id, and solution metadata when available.',
      '  - `--help` only prints this text and never validates the solution name or environment flags.',
      '',
      'Choose this when:',
      '  - You need to verify what a solution contains before export, deploy, or troubleshooting.',
      '',
      'Examples:',
      '  pp solution components Core --environment dev',
      '  pp solution components Core --environment dev --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printSolutionInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: solution inspect <uniqueName> --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Inspects one solution in the target environment.',
      '  - Returns one structured record with the solution id, unique name, friendly name, version, publisher metadata, and managed state when available.',
      '  - `--help` only prints this text and never validates the solution name or environment flags.',
      '',
      'Choose this when:',
      '  - You already know the solution unique name and want metadata rather than the full inventory.',
      '',
      'Examples:',
      '  pp solution inspect Core --environment dev',
      '  pp solution inspect Core --environment dev --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printSolutionDependenciesHelp(): void {
  process.stdout.write(
    [
      'Usage: solution dependencies <uniqueName> --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Lists solution dependency rows for one solution in the target environment.',
      '  - Returns stable structured rows that identify the required and dependent components when Dataverse exposes them.',
      '  - `--help` only prints this text and never validates the solution name or environment flags.',
      '',
      'Choose this when:',
      '  - You suspect missing prerequisites, ALM drift, or packaging/import problems.',
      '',
      'Examples:',
      '  pp solution dependencies Core --environment dev',
      '  pp solution dependencies Core --environment dev --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentHelp(): void {
  process.stdout.write(
    [
      'Usage: env <command> [options]',
      '',
      'Manage Dataverse environment aliases used by pp.',
      '',
      'An environment alias is a named Dataverse target that points to a URL and an existing auth profile.',
      'Many aliases may reuse one auth profile, while each alias binds to one profile at a time.',
      '',
      'Commands:',
      '  list                         list saved environment aliases',
      '  add                          add or update one environment alias',
      '  inspect <alias>              inspect one saved alias',
      '  resolve-maker-id <alias>     discover and persist the Maker environment id for an alias',
      '  cleanup-plan <alias>         list disposable solutions matching a run prefix before bootstrap reset',
      '  reset <alias>                delete disposable solutions matching a run prefix for bootstrap reset',
      '  cleanup <alias>              delete disposable solutions matching a run prefix',
      '  remove <alias>               remove one saved alias from local config',
      '',
      'Examples:',
      '  pp env add --name dev --url https://contoso.crm.dynamics.com --profile work',
      '  pp env list',
      '  pp env inspect dev',
      '  pp env cleanup-plan test --prefix ppHarness20260310T013401820Z --format json',
      '  pp env reset test --prefix ppHarness20260310T013401820Z --dry-run --format json',
      '  pp env cleanup test --prefix ppHarness20260310T013401820Z --dry-run --format json',
      '',
      'Common confusion:',
      '  - `pp env add` adds a Dataverse environment alias.',
      '  - `pp auth profile add-env` adds an auth profile backed by a token environment variable.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentListHelp(): void {
  process.stdout.write(
    [
      'Usage: env list [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Lists Dataverse environment aliases known to pp.',
      '  - Shows the bound URL, auth profile, default solution, and Maker environment id when available.',
      '',
      'Examples:',
      '  pp env list',
      '  pp env list --format json',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentAddHelp(): void {
  process.stdout.write(
    [
      'Usage: env add --name ALIAS --url URL --profile PROFILE [--default-solution NAME] [--maker-env-id GUID] [--config-dir path]',
      '',
      'Behavior:',
      '  - Adds one Dataverse environment alias that points to an existing auth profile.',
      '  - The alias becomes the value you pass later with `--environment ALIAS`.',
      '',
      'Requirements:',
      '  - `--profile` must name an existing auth profile.',
      '',
      'Examples:',
      '  pp env add --name dev --url https://contoso.crm.dynamics.com --profile work',
      '  pp env add --name uat --url https://contoso-uat.crm.dynamics.com --profile work --default-solution Core',
      '',
      'See also:',
      '  - If you still need credentials, create the profile first with `pp auth profile add-user` or another `auth profile add-*` command.',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: env inspect <alias> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Inspects one Dataverse environment alias and its bound auth profile state.',
      '  - When the auth profile uses a browser profile, includes its last bootstrap metadata and refresh command for Maker workflows.',
      '  - Includes current-project stage usage when the inspected alias is referenced by the local project topology.',
      '  - Includes tooling advisories such as whether pac is likely to share the pp auth context.',
      '',
      'Examples:',
      '  pp env inspect dev',
      '  pp env inspect dev --format json',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentResolveMakerIdHelp(): void {
  process.stdout.write(
    [
      'Usage: env resolve-maker-id <alias> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Resolves the Maker environment id for the alias through the Power Platform environments API.',
      '  - Persists the resolved id so later Maker handoff commands do not need an explicit override.',
      '',
      'Examples:',
      '  pp env resolve-maker-id dev',
      '  pp env resolve-maker-id dev --format json',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentCleanupPlanHelp(): void {
  process.stdout.write(
    [
      'Usage: env cleanup-plan <alias> --prefix PREFIX [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Lists remote solutions whose unique name or friendly name starts with PREFIX, case-insensitively.',
      '  - Intended for harness bootstrap or disposable-environment reset flows where stale disposable harness assets should be removed before reuse.',
      '  - Returns candidate solutions together with next-step guidance for `pp env reset`.',
      '  - Follow with `pp env reset <alias> --prefix PREFIX [--dry-run|--plan]` when you are ready to delete the matches.',
      '  - Related commands: env reset <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw], env cleanup <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Examples:',
      '  pp env cleanup-plan test --prefix ppHarness20260310T013401820Z',
      '  pp env cleanup-plan test --prefix ppHarness20260310T013401820Z --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentResetHelp(): void {
  process.stdout.write(
    [
      'Usage: env reset <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Deletes remote solutions whose unique name or friendly name starts with PREFIX, case-insensitively.',
      '  - Intended as the first-class bootstrap reset command for clearing stale disposable harness assets before environment reuse.',
      '  - Use `--dry-run` or `--plan` first to preview the matching solutions without mutating the environment.',
      '  - Equivalent remote deletion behavior to `pp env cleanup`, but named for bootstrap/reset workflows.',
      '',
      'Examples:',
      '  pp env reset test --prefix ppHarness20260310T013401820Z --dry-run --format json',
      '  pp env reset test --prefix ppHarness20260310T013401820Z --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentCleanupHelp(): void {
  process.stdout.write(
    [
      'Usage: env cleanup <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Deletes remote solutions whose unique name or friendly name starts with PREFIX, case-insensitively.',
      '  - Use `--dry-run` or `--plan` first to preview the matching solutions without mutating the environment.',
      '  - Intended for clearing stale disposable harness assets before bootstrap reuses an environment.',
      '',
      'Examples:',
      '  pp env cleanup test --prefix ppHarness20260310T013401820Z --dry-run --format json',
      '  pp env cleanup test --prefix ppHarness20260310T013401820Z --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentVariableHelp(): void {
  process.stdout.write(
    [
      'Usage: envvar <command> [options]',
      '',
      'Commands:',
      '  create <schemaName>         create an environment variable definition',
      '  list                        list environment variable definitions and values',
      '  inspect <identifier>        inspect one environment variable by schema name, display name, or id',
      '  set <identifier>            set the current value for one environment variable',
      '',
      'Examples:',
      '  pp envvar list --environment dev --solution Core --no-interactive-auth --format json',
      '  pp envvar inspect pp_ApiUrl --environment dev --no-interactive-auth',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printConnectionReferenceHelp(): void {
  process.stdout.write(
    [
      'Usage: connref <command> [options]',
      '',
      'Commands:',
      '  create <logicalName>        create one connection reference with connector metadata and a bound connection id',
      '  list                        list connection references',
      '  inspect <identifier>        inspect one connection reference by logical name, display name, or id',
      '  set <identifier>            update the bound connection id for one connection reference',
      '  validate                    validate connection reference bindings and health',
      '',
      'Examples:',
      '  pp connref create pp_shared_sql --environment dev --solution Core --connector-id /providers/Microsoft.PowerApps/apis/shared_sql --connection-id /providers/Microsoft.PowerApps/apis/shared_sql/connections/shared-sql-123 --format json',
      '  pp connref list --environment dev --solution Core --no-interactive-auth --format json',
      '  pp connref set pp_shared_sql --environment dev --connection-id /providers/Microsoft.PowerApps/apis/shared_sql/connections/shared-sql-456 --format json',
      '  pp connref validate --environment dev --solution Core --no-interactive-auth',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printConnectionReferenceCreateHelp(): void {
  process.stdout.write(
    [
      'Usage: connref create <logicalName> --environment ALIAS --connection-id CONNECTION_ID [--display-name NAME] [--connector-id CONNECTOR_ID] [--custom-connector-id CONNECTOR_ID] [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Creates one connection reference in the target environment or solution scope.',
      '  - Requires either `--connector-id` or `--custom-connector-id` so the created reference preserves connector metadata.',
      '',
      'Examples:',
      '  pp connref create pp_shared_sql --environment dev --solution Core --connector-id /providers/Microsoft.PowerApps/apis/shared_sql --connection-id /providers/Microsoft.PowerApps/apis/shared_sql/connections/shared-sql-123',
      '  pp connref create pp_shared_custom --environment dev --custom-connector-id custom-connector-guid --connection-id /providers/Microsoft.PowerApps/apis/shared_customapi/connections/shared-custom-123 --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printConnectionReferenceListHelp(): void {
  process.stdout.write(
    [
      'Usage: connref list --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Lists connection references visible in the target environment or solution scope.',
      '  - Returns stable structured rows with logical names, connector metadata, and bound connection ids when available.',
      '',
      'Examples:',
      '  pp connref list --environment dev',
      '  pp connref list --environment dev --solution Core --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printConnectionReferenceInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: connref inspect <logicalName|displayName|id> --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Resolves one connection reference in the target environment or solution scope.',
      '  - Returns a stable CONNREF_NOT_FOUND diagnostic when the identifier does not match a connection reference in scope.',
      '',
      'Examples:',
      '  pp connref inspect shared_office365 --environment dev',
      '  pp connref inspect shared_office365 --environment dev --solution Core --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printConnectionReferenceSetHelp(): void {
  process.stdout.write(
    [
      'Usage: connref set <logicalName|displayName|id> --environment ALIAS --connection-id CONNECTION_ID [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Updates the bound connection id for one connection reference in the target environment or solution scope.',
      '  - Returns the updated reference after the write succeeds.',
      '',
      'Examples:',
      '  pp connref set pp_shared_sql --environment dev --connection-id /providers/Microsoft.PowerApps/apis/shared_sql/connections/shared-sql-456',
      '  pp connref set pp_shared_sql --environment dev --solution Core --connection-id /providers/Microsoft.PowerApps/apis/shared_sql/connections/shared-sql-456 --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printConnectionReferenceValidateHelp(): void {
  process.stdout.write(
    [
      'Usage: connref validate --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Validates connection references visible in the target environment or solution scope.',
      '  - Returns stable structured rows for missing bindings, connector mismatches, or other validation findings.',
      '',
      'Examples:',
      '  pp connref validate --environment dev',
      '  pp connref validate --environment dev --solution Core --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentVariableCreateHelp(): void {
  process.stdout.write(
    [
      'Usage: envvar create <schemaName> --environment ALIAS [--display-name NAME] [--default-value VALUE] [--type string|number|boolean|json|data-source|secret] [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Creates one environment variable definition in the target environment.',
      '  - Uses the schema name as the display name when `--display-name` is omitted.',
      '',
      'Examples:',
      '  pp envvar create pp_ApiUrl --environment dev --solution Core --type string',
      '  pp envvar create pp_ApiUrl --environment dev --solution Core --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentVariableListHelp(): void {
  process.stdout.write(
    [
      'Usage: envvar list --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Lists environment variable definitions and current values visible in the target environment or solution scope.',
      '  - Returns stable structured rows including schema names, types, default values, and current values when present.',
      '',
      'Examples:',
      '  pp envvar list --environment dev',
      '  pp envvar list --environment dev --solution Core --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentVariableInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: envvar inspect <schemaName|displayName|id> --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Resolves one environment variable definition and its current value when present.',
      '  - Returns a stable ENVVAR_NOT_FOUND diagnostic when the identifier does not match a definition in the target scope.',
      '',
      'Examples:',
      '  pp envvar inspect pp_ApiUrl --environment dev',
      '  pp envvar inspect pp_ApiUrl --environment dev --solution Core --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printEnvironmentVariableSetHelp(): void {
  process.stdout.write(
    [
      'Usage: envvar set <schemaName|displayName|id> --environment ALIAS --value VALUE [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Sets the current value for one environment variable in the target environment or solution scope.',
      '  - Returns the updated definition and current value after the write succeeds.',
      '',
      'Examples:',
      '  pp envvar set pp_ApiUrl --environment dev --value https://next.example.test',
      '  pp envvar set pp_ApiUrl --environment dev --solution Core --value https://next.example.test --no-interactive-auth --format json',
      '',
      'Remote auth option:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasCreateHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas create --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [options]',
      '',
      'Status:',
      '  Preview handoff by default. `--delegate` can drive the Maker blank-app flow through a persisted browser profile.',
      '',
      'Choose this when:',
      '  - You need a brand-new remote canvas app in a Dataverse environment.',
      '  - You are willing to use a Maker handoff or delegated browser automation because there is no first-class server-side create API.',
      '',
      'Choose a different path when:',
      '  - The app already exists remotely and you only need to inspect or export it: use `pp canvas list`, `inspect`, or `download`.',
      '  - You already have local source and need a package artifact: use `pp canvas build`.',
      '',
      'Options:',
      '  --maker-env-id ID          Optional Maker environment id override for deep-link guidance',
      '  --delegate                 Drive the solution-scoped Maker blank-app flow and wait for the created app id',
      '  --open                     Launch the resolved Maker handoff URL instead of only printing it',
      '  --browser-profile NAME     Optional override for the browser profile used with --open',
      '  --artifacts-dir DIR        Persist delegated screenshots/session metadata under DIR',
      '  --timeout-ms N             Delegated Studio readiness timeout in milliseconds',
      '  --poll-timeout-ms N        Delegated Dataverse polling timeout in milliseconds',
      '  --settle-ms N              Delegated post-save and post-publish settle delay in milliseconds',
      '  --slow-mo-ms N             Delegated browser slow motion delay in milliseconds',
      '  --debug                    Keep the delegated browser visible instead of running headless',
      '',
      'What works today:',
      '  - Use `pp canvas list --environment <alias> --solution <solution>` to inspect existing remote canvas apps.',
      '  - Use `pp canvas inspect <displayName|name|id> --environment <alias> --solution <solution>` to inspect a specific remote app.',
      '  - Use `--delegate --browser-profile <name> --solution <solution> --name <display-name>` to let pp drive the Maker blank-app flow and return the created app id when Studio save/publish succeeds.',
      '  - Use `--open` to launch the resolved Maker handoff when the environment auth profile already names a browser profile.',
      '  - Use `--open --browser-profile <name>` to override that browser profile for a one-off handoff.',
      '',
      'Recommended flow:',
      '  1. Confirm the target environment and solution with `pp env inspect <alias>` and `pp solution inspect <uniqueName> --environment <alias>`.',
      '  2. Start with `--delegate` if you want pp to wait for the resulting app id.',
      '  3. Fall back to `--open` if you only want pp to construct the Maker handoff URL and launch context.',
      '',
      'Next steps for new apps today:',
      '  - Prefer `--delegate` when you want pp to wait for the created app id through Dataverse.',
      '  - Finish blank-app creation in Maker when you need a new remote canvas app but do not want delegated browser automation.',
      '  - Use `pp canvas build <path> --out <file.msapp>` if you are packaging a local canvas source tree.',
      '',
      'Known limitations:',
      '  - Delegated create still depends on Maker browser automation rather than a first-class remote API.',
      '  - Studio readiness and publish timing can still vary by tenant and browser session.',
      '',
      'Preview options:',
      '  --dry-run                     Resolve env/solution context and print a structured no-op preview',
      '  --plan                        Resolve env/solution context and print a structured fallback plan',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasDownloadHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas download <displayName|name|id> --environment ALIAS --solution UNIQUE_NAME [--out FILE] [--extract-to-directory DIR] [options]',
      '',
      'Status:',
      '  Exports the containing solution through Dataverse and extracts the matching CanvasApps/*.msapp entry.',
      '',
      'Behavior:',
      '  - Requires `--environment` and `--solution` so pp can export the correct solution package.',
      '  - Uses the existing pp Dataverse auth context; it does not shell out to pac for canvas download.',
      '  - When `--out` is omitted, writes `<displayName|name|id>.msapp` in the current working directory.',
      '  - `--extract-to-directory` also expands the downloaded `.msapp` into a normalized source tree, converting archive backslashes into portable folder separators.',
      '',
      'Examples:',
      '  pp canvas download "Harness Canvas" --environment dev --solution Core',
      '  pp canvas download crd_HarnessCanvas --environment dev --solution Core --out ./artifacts/HarnessCanvas.msapp',
      '  pp canvas download "Harness Canvas" --environment dev --solution Core --out ./artifacts/HarnessCanvas.msapp --extract-to-directory ./artifacts/HarnessCanvas',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasListHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas list --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Status:',
      '  Lists remote canvas apps through Dataverse.',
      '',
      'Behavior:',
      '  - Requires `--environment` to resolve the target environment alias.',
      '  - When `--solution` is provided, filters the result to canvas apps that are solution components.',
      '  - Returns remote app ids and any Maker open URIs currently available from Dataverse.',
      '',
      'Examples:',
      '  pp canvas list --environment dev',
      '  pp canvas list --environment dev --solution Core',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasImportHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas import <file.msapp> --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [options]',
      '',
      'Status:',
      '  Preview placeholder. Remote canvas import is not implemented yet.',
      '',
      'Choose this when:',
      '  - You already have an `.msapp` artifact and want guidance for getting it into a remote environment.',
      '',
      'Choose a different path when:',
      '  - You only need a packaged artifact from local source: use `pp canvas build`.',
      '  - You need to inspect or export an existing remote app: use `pp canvas list`, `inspect`, or `download`.',
      '',
      'Options:',
      '  --name DISPLAY_NAME        Expected remote display name for post-import verification guidance',
      '  --maker-env-id ID          Optional Maker environment id override for deep-link guidance',
      '  --open                     Launch the resolved Maker handoff URL instead of only printing it',
      '  --browser-profile NAME     Optional override for the browser profile used with --open',
      '',
      'What works today:',
      '  - Use `pp canvas build <path> --out <file.msapp>` to package a local canvas source tree.',
      '  - Use `pp canvas list --environment <alias> --solution <solution>` to inspect existing remote canvas apps.',
      '  - Use `--open` to launch the resolved Maker handoff when the environment auth profile already names a browser profile.',
      '  - Use `--open --browser-profile <name>` to override that browser profile for a one-off handoff.',
      '',
      'Recommended flow today:',
      '  1. Build or locate the `.msapp` artifact you intend to import.',
      '  2. Use `--open` if you want pp to take you to the right Maker context for the target environment.',
      '  3. Use Maker or solution tooling for the actual import step until `pp canvas import` exists.',
      '',
      'Next steps for remote import today:',
      '  - Use Maker or solution tooling for the remote import step until `pp canvas import` exists.',
      '',
      'Known limitations:',
      '  - Remote canvas coverage in pp is currently read-only.',
      '  - pp does not yet return a remote canvas app id for create/import workflows.',
      '',
      'Preview options:',
      '  --dry-run                     Resolve env/solution context and print a structured no-op preview',
      '  --plan                        Resolve env/solution context and print a structured fallback plan',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas inspect <path|displayName|name|id> [--environment ALIAS] [--solution UNIQUE_NAME] [options]',
      '',
      'Modes:',
      '  - Without `--environment`, inspects a local canvas source tree.',
      '  - With `--environment`, inspects a remote canvas app by display name, logical name, or id.',
      '',
      'Remote behavior:',
      '  - Requires the positional identifier plus `--environment`.',
      '  - Accepts optional `--solution` to scope remote lookup to a solution.',
      '',
      'Local behavior:',
      '  - Accepts a local canvas path plus `--project`, repeated `--registry`, `--cache-dir`, and `--mode` options.',
      '',
      'Examples:',
      '  pp canvas inspect "Harness Canvas" --environment dev --solution Core',
      '  pp canvas inspect ./apps/MyCanvas --project . --mode strict',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowHelp(): void {
  process.stdout.write(
    [
      'Usage: flow <command> [options]',
      '',
      'Work with Power Automate flows in two modes:',
      '  remote  inspect, export, promote, deploy, and diagnose flows in Dataverse',
      '  local   unpack, pack, normalize, validate, graph, and patch flow artifacts',
      '',
      'Commands:',
      '  list                        list remote flows',
      '  inspect <name|id|...>       inspect a remote flow or a local artifact',
      '  export <name|id|...>        export a remote flow artifact',
      '  promote <name|id|...>       move a flow between environments',
      '  deploy <path>               deploy a local flow artifact into an environment',
      '  unpack <path>               unpack a flow artifact into a folder',
      '  pack <path>                 pack a folder back into a flow artifact',
      '  normalize <path>            rewrite a local artifact into normalized shape',
      '  validate <path>             validate a local artifact',
      '  graph <path>                emit a graph view of a local artifact',
      '  patch <path> --file ...     apply a bounded patch to a local artifact',
      '  runs <name|id|...>          inspect recent remote run history',
      '  errors <name|id|...>        summarize remote runtime failures',
      '  connrefs <name|id|...>      inspect connection references used by a flow',
      '  doctor <name|id|...>        summarize remote runtime health and dependencies',
      '',
      'How to think about it:',
      '  - Use remote commands when the flow already exists in an environment and you need lifecycle or runtime insight.',
      '  - Use local commands when the artifact is on disk and you want deterministic analysis or edits.',
      '  - `deploy` updates one target environment from a local artifact; `promote` copies a remote flow between environments.',
      '',
      'Examples:',
      '  pp flow inspect ./flows/invoice/flow.json',
      '  pp flow inspect InvoiceSync --environment dev --solution Core',
      '  pp flow deploy ./flows/invoice/flow.json --environment dev --solution Core --dry-run --format json',
      '  pp flow promote InvoiceSync --source-environment dev --target-environment uat --solution-package --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowListHelp(): void {
  process.stdout.write(
    [
      'Usage: flow list --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Behavior:',
      '  - Lists remote flows visible in the target environment.',
      '  - Use `--solution` when you want the result scoped to one solution boundary.',
      '',
      'Examples:',
      '  pp flow list --environment dev',
      '  pp flow list --environment dev --solution Core --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: flow inspect <name|id|uniqueName|path> [--environment ALIAS] [--solution UNIQUE_NAME] [options]',
      '',
      'Modes:',
      '  - Without `--environment`, inspect a local flow artifact on disk.',
      '  - With `--environment`, inspect a remote flow by name, id, or unique name.',
      '',
      'Choose this when:',
      '  - You want to understand one flow before export, deploy, promote, or runtime diagnosis.',
      '',
      'Examples:',
      '  pp flow inspect ./flows/invoice/flow.json',
      '  pp flow inspect InvoiceSync --environment dev --solution Core --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowExportHelp(): void {
  process.stdout.write(
    [
      'Usage: flow export <name|id|uniqueName> --environment ALIAS --out PATH [--solution UNIQUE_NAME] [options]',
      '',
      'Behavior:',
      '  - Exports one remote flow artifact into a local file.',
      '  - Use this when you want to move from a live environment into the local validation/editing pipeline.',
      '',
      'Examples:',
      '  pp flow export InvoiceSync --environment dev --out ./artifacts/invoice-flow.json',
      '  pp flow export InvoiceSync --environment dev --solution Core --out ./artifacts/invoice-flow.json --dry-run --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowPromoteHelp(): void {
  process.stdout.write(
    [
      'Usage: flow promote <name|id|uniqueName> --source-environment ALIAS --target-environment ALIAS [--source-solution UNIQUE_NAME] [--target-solution UNIQUE_NAME] [--target <name|id|uniqueName>] [--create-if-missing] [--workflow-state draft|activated|suspended] [--solution-package] [--managed-solution-package] [--overwrite-unmanaged-customizations] [--holding-solution] [--skip-product-update-dependencies] [--no-publish-workflows] [--import-job-id GUID] [options]',
      '',
      'Choose this when:',
      '  - The source flow already exists remotely and you want to move it between environments.',
      '',
      'Choose `flow deploy` instead when:',
      '  - Your source of truth is a local artifact on disk.',
      '',
      'Recommended flow:',
      '  1. Inspect the source flow and target solution first.',
      '  2. Decide whether this should stay direct or go through `--solution-package`.',
      '  3. Use `--dry-run` or `--plan` first when you want a non-mutating preview.',
      '',
      'Examples:',
      '  pp flow promote InvoiceSync --source-environment dev --target-environment uat --format json',
      '  pp flow promote InvoiceSync --source-environment dev --target-environment uat --target-solution Core --solution-package --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowUnpackHelp(): void {
  process.stdout.write(
    [
      'Usage: flow unpack <path> --out <dir> [options]',
      '',
      'Behavior:',
      '  - Unpacks a flow artifact into an editable local folder.',
      '',
      'Examples:',
      '  pp flow unpack ./artifacts/invoice-flow.json --out ./flows/invoice',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowPackHelp(): void {
  process.stdout.write(
    [
      'Usage: flow pack <path> --out <file.json> [options]',
      '',
      'Behavior:',
      '  - Packs an editable local flow folder back into a deployable artifact.',
      '',
      'Examples:',
      '  pp flow pack ./flows/invoice --out ./artifacts/invoice-flow.json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowDeployHelp(): void {
  process.stdout.write(
    [
      'Usage: flow deploy <path> --environment ALIAS [--solution UNIQUE_NAME] [--target <name|id|uniqueName>] [--create-if-missing] [--workflow-state draft|activated|suspended] [options]',
      '',
      'Choose this when:',
      '  - Your source of truth is a local flow artifact on disk and you want to push it into one environment.',
      '',
      'Choose `flow promote` instead when:',
      '  - The source flow already lives remotely and should be moved between environments.',
      '',
      'Examples:',
      '  pp flow deploy ./flows/invoice/flow.json --environment dev --solution Core --dry-run --format json',
      '  pp flow deploy ./flows/invoice/flow.json --environment dev --solution Core --create-if-missing --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowNormalizeHelp(): void {
  process.stdout.write(
    [
      'Usage: flow normalize <path> [--out PATH] [options]',
      '',
      'Behavior:',
      '  - Rewrites a local flow artifact into pp’s normalized shape.',
      '',
      'Examples:',
      '  pp flow normalize ./flows/invoice/flow.json',
      '  pp flow normalize ./flows/invoice/flow.json --out ./artifacts/invoice-flow.normalized.json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowValidateHelp(): void {
  process.stdout.write(
    [
      'Usage: flow validate <path> [options]',
      '',
      'Behavior:',
      '  - Validates a local flow artifact and returns structured diagnostics.',
      '',
      'Examples:',
      '  pp flow validate ./flows/invoice/flow.json',
      '  pp flow validate ./flows/invoice/flow.json --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowGraphHelp(): void {
  process.stdout.write(
    [
      'Usage: flow graph <path> [options]',
      '',
      'Behavior:',
      '  - Emits a graph-oriented view of a local flow artifact.',
      '',
      'Examples:',
      '  pp flow graph ./flows/invoice/flow.json --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowPatchHelp(): void {
  process.stdout.write(
    [
      'Usage: flow patch <path> --file PATCH.json [--out PATH] [options]',
      '',
      'Behavior:',
      '  - Applies a bounded patch document to a local flow artifact.',
      '',
      'Examples:',
      '  pp flow patch ./flows/invoice/flow.json --file ./patches/invoice.patch.json --out ./artifacts/invoice-flow.patched.json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowRunsHelp(): void {
  process.stdout.write(
    [
      'Usage: flow runs <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--status STATUS] [--since 7d] [options]',
      '',
      'Behavior:',
      '  - Lists recent remote runs for one flow.',
      '',
      'Examples:',
      '  pp flow runs InvoiceSync --environment dev --since 7d --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowErrorsHelp(): void {
  process.stdout.write(
    [
      'Usage: flow errors <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--status STATUS] [--since 7d] [--group-by errorCode|errorMessage|connectionReference] [options]',
      '',
      'Behavior:',
      '  - Summarizes recent remote flow failures and can group them by error or connection reference.',
      '',
      'Examples:',
      '  pp flow errors InvoiceSync --environment dev --since 7d --group-by errorCode --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowConnrefsHelp(): void {
  process.stdout.write(
    [
      'Usage: flow connrefs <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--since 7d] [options]',
      '',
      'Behavior:',
      '  - Reports the connection references used by one remote flow.',
      '',
      'Examples:',
      '  pp flow connrefs InvoiceSync --environment dev --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowDoctorHelp(): void {
  process.stdout.write(
    [
      'Usage: flow doctor <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--since 7d] [options]',
      '',
      'Behavior:',
      '  - Summarizes runtime health, failures, and connection-reference context for one remote flow.',
      '',
      'Examples:',
      '  pp flow doctor InvoiceSync --environment dev --since 7d --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printSharePointHelp(): void {
  process.stdout.write(
    [
      'Usage: sharepoint <command> <action> [options]',
      '',
      'Commands:',
      '  site inspect <site|binding>              inspect a SharePoint site by URL, site id, or project binding',
      '  list inspect <list|binding> --site ...   inspect a SharePoint list by title, id, or project binding',
      '  file inspect <file|binding> --site ...   inspect a drive item by path, id, or project binding',
      '  permissions inspect --site ...           inspect site, list, or drive item permissions',
      '',
      'Binding notes:',
      '  - SharePoint bindings support `sharepoint-site`, `sharepoint-list`, and `sharepoint-file` kinds.',
      '  - `sharepoint-list` and `sharepoint-file` bindings should declare `metadata.site`; file bindings can also declare `metadata.drive`.',
      '  - Bindings can declare `metadata.authProfile` so commands do not need `--profile`.',
      '',
      'Examples:',
      '  pp sharepoint site inspect financeSite --project .',
      '  pp sharepoint list inspect Campaigns --site financeSite --profile graph-user',
      '  pp sharepoint file inspect financeBudget --project .',
      '  pp sharepoint permissions inspect --site financeSite --file /Shared Documents/Budget.xlsx --drive Documents --profile graph-user',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printPowerBiHelp(): void {
  process.stdout.write(
    [
      'Usage: powerbi <command> <action> [options]',
      '',
      'Commands:',
      '  workspace inspect <workspace|binding>                    inspect a Power BI workspace by name, id, or project binding',
      '  dataset inspect <dataset|binding> --workspace ...        inspect a dataset plus datasource and refresh metadata',
      '  report inspect <report|binding> --workspace ...          inspect a report and its workspace linkage',
      '',
      'Binding notes:',
      '  - Power BI bindings support `powerbi` or `powerbi-workspace`, plus `powerbi-dataset` and `powerbi-report`.',
      '  - Dataset and report bindings should declare `metadata.workspace` to point at a workspace binding or raw workspace name/id.',
      '  - Bindings can declare `metadata.authProfile` so commands do not need `--profile`.',
      '',
      'Examples:',
      '  pp powerbi workspace inspect financeWorkspace --project .',
      '  pp powerbi dataset inspect financeDataset --project .',
      '  pp powerbi report inspect "Executive Overview" --workspace Finance --profile powerbi-user',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printAnalysisHelp(): void {
  process.stdout.write(
    [
      'Usage: analysis <command> [options]',
      '',
      'Capture project context and higher-level analysis views for agents, CI, and delivery workflows.',
      '',
      'Commands:',
      '  report [path]               render a high-level project report',
      '  context                     emit one structured analysis context payload',
      '  portfolio [path ...]        aggregate multiple projects into one portfolio view',
      '  drift [path ...]            focus the portfolio view on drift and mismatch signals',
      '  usage [path ...]            focus the portfolio view on provider and asset usage',
      '  policy [path ...]           focus the portfolio view on policy and operability signals',
      '',
      'How to think about it:',
      '  - `context` is the most direct machine-readable entrypoint for an agent.',
      '  - `report` is better for a human-oriented summary.',
      '  - `portfolio`, `drift`, `usage`, and `policy` are multi-project views over the same underlying model.',
      '',
      'Examples:',
      '  pp analysis context --project . --format json',
      '  pp analysis report . --stage prod',
      '  pp analysis drift . ../other-project --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printAnalysisReportHelp(): void {
  process.stdout.write(
    [
      'Usage: analysis report [path] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Behavior:',
      '  - Discovers the project, resolves stage and parameter context, and renders a high-level summary.',
      '  - Defaults to markdown for human-readable output; use `--format json` for a structured context pack.',
      '',
      'Choose this when:',
      '  - You want a readable summary of what pp thinks the project is, how it resolves, and what matters next.',
      '',
      'Choose `analysis context` instead when:',
      '  - An agent, script, or CI job needs one machine-readable payload to reason over.',
      '',
      'Examples:',
      '  pp analysis report .',
      '  pp analysis report . --stage prod --format markdown',
      '  pp analysis report . --stage prod --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printAnalysisPortfolioHelp(): void {
  process.stdout.write(
    [
      'Usage: analysis portfolio [path ...] [--project path] [--allow-provider-kind KIND] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Behavior:',
      '  - Aggregates one or more projects into a shared analysis view.',
      '  - Use repeated `--project` flags or positional paths to choose the portfolio scope.',
      '',
      'Examples:',
      '  pp analysis portfolio . ../other-project --format json',
      '  pp analysis portfolio --project . --project ../other-project --allow-provider-kind dataverse',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printAnalysisPortfolioViewHelp(view: 'drift' | 'usage' | 'policy'): void {
  process.stdout.write(
    [
      `Usage: analysis ${view} [path ...] [--project path] [--allow-provider-kind KIND] [--stage STAGE] [--param NAME=VALUE] [options]`,
      '',
      'Behavior:',
      `  - Runs the shared portfolio analysis pipeline and emphasizes the ${view} view in the output.`,
      '  - Accepts the same project-selection and stage-resolution options as `analysis portfolio`.',
      '',
      'Examples:',
      `  pp analysis ${view} . --format json`,
      `  pp analysis ${view} . ../other-project --stage prod --format json`,
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDeployHelp(): void {
  process.stdout.write(
    [
      'Usage: deploy <command> [options]',
      '',
      'Plan and apply stage-aware deployment workflows from the local pp project model.',
      '',
      'Commands:',
      '  plan                         resolve the deploy plan without mutating anything',
      '  apply                        execute a deploy plan or preview it in dry-run/plan mode',
      '  release                      plan or apply a multi-stage release manifest',
      '',
      'How to think about it:',
      '  - `deploy plan` turns project topology into concrete operations.',
      '  - `deploy apply` executes those operations for one stage, or previews them with `--dry-run` / `--plan`.',
      '  - `deploy release` is the multi-stage orchestration layer over saved release manifests.',
      '',
      'Examples:',
      '  pp deploy plan --project . --stage dev --format json',
      '  pp deploy apply --project . --stage dev --dry-run --format json',
      '  pp deploy release --help',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDeployPlanHelp(): void {
  process.stdout.write(
    [
      'Usage: deploy plan [--project path] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Behavior:',
      '  - Discovers the local project, resolves stage-aware topology, and produces a concrete deploy plan.',
      '  - Does not mutate the target environment.',
      '',
      'Examples:',
      '  pp deploy plan --project . --stage dev --format json',
      '  pp deploy plan --stage prod --param releaseName=2026.03.11',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDeployApplyHelp(): void {
  process.stdout.write(
    [
      'Usage: deploy apply [--project path] [--stage STAGE] [--param NAME=VALUE] [--dry-run|--plan|--plan FILE] [--yes] [options]',
      '',
      'Behavior:',
      '  - Applies the stage-aware deploy workflow for one project.',
      '  - Use `--dry-run` or `--plan` to preview without side effects.',
      '  - Use `--plan FILE` to apply a previously saved deploy plan without rediscovering the project.',
      '',
      'Examples:',
      '  pp deploy apply --project . --stage dev --dry-run --format json',
      '  pp deploy apply --project . --stage dev --yes --format json',
      '  pp deploy apply --plan ./artifacts/deploy-plan.json --yes --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDeployReleaseHelp(): void {
  process.stdout.write(
    [
      'Usage:',
      '  deploy release plan --file MANIFEST.yml [--approve GATE] [--param NAME=VALUE] [options]',
      '  deploy release apply --file MANIFEST.yml [--approve GATE] [--param NAME=VALUE] [--dry-run] [--yes] [options]',
      '',
      'Behavior:',
      '  - Plans or applies a release manifest that spans multiple stages or gates.',
      '  - Use `plan` first to understand the release graph before `apply`.',
      '',
      'Choose this when:',
      '  - You are coordinating a release across more than one stage, gate, or approval point.',
      '',
      'Choose `deploy plan` / `deploy apply` instead when:',
      '  - You only need to work one stage at a time from the current project topology.',
      '',
      'Recommended flow:',
      '  1. Start with `deploy release plan --file ...` to inspect the resolved release graph.',
      '  2. Add `--approve GATE` only when the manifest expects a specific gate approval.',
      '  3. Use `deploy release apply --dry-run` before live apply if you want one last non-mutating pass.',
      '',
      'Examples:',
      '  pp deploy release plan --file ./release.yml --format json',
      '  pp deploy release apply --file ./release.yml --approve prod-ready --yes --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printProjectHelp(): void {
  process.stdout.write(
    [
      'Usage: project <command> [options]',
      '',
      'Commands:',
      '  init [path]                 scaffold a minimal local pp project layout',
      '  doctor [path]               validate project config, assets, and required inputs',
      '  feedback [path]             capture conceptual project feedback and derive follow-up tasks',
      '  inspect [path]              inspect resolved project topology and asset roots',
      '',
      'Examples:',
      '  pp project init ./demo --name Demo --environment dev --solution Core',
      '  pp project doctor ./demo --stage prod --format json',
      '  pp project feedback ./demo --stage prod --format markdown',
      '  pp project inspect ./demo --stage prod --param releaseName=2026.03.10 --format json',
      '',
      'Notes:',
      '  - Use `pp project init --plan` or `--dry-run` to preview scaffold changes without writing files.',
      '  - `pp project doctor`, `pp project feedback`, and `pp project inspect` are read-only local-structure workflows.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printProjectInitHelp(): void {
  process.stdout.write(
    [
      'Usage: project init [path] [--name NAME] [--environment ALIAS] [--solution UNIQUE_NAME] [--stage STAGE] [options]',
      '',
      'Status:',
      '  Scaffolds a minimal local pp project layout.',
      '',
      'Behavior:',
      '  - Writes `pp.config.yaml` unless a project config already exists and `--force` is not set.',
      '  - Creates `apps/`, `flows/`, `solutions/`, `docs/`, and `artifacts/solutions/` when they do not already exist.',
      '  - Seeds one default stage, one solution alias, and one primary Dataverse provider binding.',
      '  - The scaffold is source-first: reserve `solutions/` for editable solution source and place packaged exports under `artifacts/solutions/<Solution>.zip` when the repo tracks both.',
      '',
      'Choose this when:',
      '  - You are starting a new repo or want pp to establish the canonical project layout.',
      '',
      'Choose `project inspect` or `project doctor` instead when:',
      '  - The repo already exists and you want to understand or validate it before writing files.',
      '',
      'Safety:',
      '  - `--help` only prints this text and never inspects or mutates the target path.',
      '  - Use `--plan` or `--dry-run` for a structured no-op preview before applying the scaffold.',
      '',
      'Options:',
      '  --name NAME                Project name to store in `pp.config.yaml`',
      '  --environment ALIAS        Default Dataverse environment alias',
      '  --solution UNIQUE_NAME     Default solution alias and unique name seed',
      '  --stage STAGE              Default topology stage name',
      '  --force                    Replace an existing project config file',
      '  --dry-run                  Render a mutation preview without side effects',
      '  --plan                     Render a mutation plan without side effects',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printProjectDoctorHelp(): void {
  process.stdout.write(
    [
      'Usage: project doctor [path] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Validates a local pp project layout.',
      '',
      'Behavior:',
      '  - Reports config presence, asset-path checks, provider bindings, topology, registries, and unresolved required parameters.',
      '  - Machine-readable formats emit one payload on stdout, including diagnostics and suggested next actions.',
      '  - Reads project context without mutating the filesystem.',
      '  - Calls out when packaged solution zips live inline under `solutions/` instead of the canonical `artifacts/solutions/` bundle path.',
      '  - Makes the stage -> environment alias -> auth profile -> solution chain explicit when those external relationships can be resolved.',
      '',
      'Choose this when:',
      '  - You want pp to tell you what is broken, missing, or unresolved in the local project model.',
      '',
      'Choose `project inspect` instead when:',
      '  - You mainly want the resolved shape, not a health-oriented checklist.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printProjectFeedbackHelp(): void {
  process.stdout.write(
    [
      'Usage: project feedback [path] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Captures retrospective conceptual feedback for a local pp project.',
      '',
      'Behavior:',
      '  - Reuses the discovered project model to summarize workflow wins, current frictions, and concrete follow-up tasks.',
      '  - Renders the canonical bundle path and stage mappings so retrospectives can stay inside `pp`.',
      '  - Reads project context without mutating the filesystem.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printProjectInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: project inspect [path] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Inspects resolved local project topology and asset roots.',
      '',
      'Behavior:',
      '  - Returns project summary, the canonical local layout contract, resolved topology, parameters, provider bindings, asset inventory, registries, build metadata, and docs metadata.',
      '  - Reads project context without mutating the filesystem.',
      '  - Auto-selects the lone descendant `pp.config.*` under the inspected path and reports discovery details when the current path is not itself a pp project.',
      '  - Calls out that editable sources belong under `apps/`, `flows/`, `solutions/`, and `docs/`, while generated solution zips belong under `artifacts/solutions/`.',
      '  - Pair with `pp project doctor` for layout validation and `pp project init` to scaffold a canonical `apps/`, `flows/`, `solutions/`, and `docs/` workspace.',
      '  - Makes the active stage -> environment alias -> auth profile -> solution relationship explicit when the referenced environment metadata is available.',
      '',
      'Choose this when:',
      '  - You want the resolved project model that an agent, analysis command, or deploy workflow will actually see.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printAnalysisContextHelp(): void {
  process.stdout.write(
    [
      'Usage: analysis context [--project path] [--asset assetRef] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Captures analysis-ready project context for agent and automation workflows.',
      '',
      'Behavior:',
      '  - Resolves the local project model and emits discovery, topology, provider binding, parameter, asset, and deploy-plan context in one payload.',
      '  - Reports the inspected path, resolved project root, and any descendant auto-selection directly in the structured output.',
      '  - Reads project context without mutating the filesystem.',
      '  - Relative `--project` paths resolve from the invocation root (`INIT_CWD` when wrapped by pnpm), not from `packages/cli`.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCompletionHelp(): void {
  process.stdout.write(
    [
      'Usage: completion <bash|zsh|fish>',
      '',
      'Status:',
      '  Emits a shell completion script for `pp`.',
      '',
      'Examples:',
      '  pp completion zsh > ~/.zfunc/_pp',
      '  autoload -U compinit && compinit',
      '  pp completion fish > ~/.config/fish/completions/pp.fish',
      '',
      'Notes:',
      '  - Completion covers top-level commands plus the next subcommand layer.',
      '  - Redirect the output into your shell completion directory; `pp` does not edit shell startup files for you.',
      '',
    ].join('\n') + '\n'
  );
}

export function printDiagnosticsHelp(): void {
  process.stdout.write(
    [
      'Usage: diagnostics <doctor|bundle> [path] [options]',
      '',
      'Commands:',
      '  doctor [path]              summarize install, config, and project operability findings',
      '  bundle [path]              emit a structured debug bundle for support or CI artifacts',
      '',
      'Examples:',
      '  pp diagnostics doctor',
      '  pp diagnostics doctor ./repo --format table',
      '  pp diagnostics bundle ./repo --format json > pp-diagnostics.json',
      '',
      'Common options:',
      '  --config-dir path',
      '  --format table|json|yaml|ndjson|markdown|raw',
      '',
    ].join('\n') + '\n'
  );
}

export function printDiagnosticsDoctorHelp(): void {
  process.stdout.write(
    [
      'Usage: diagnostics doctor [path] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Status:',
      '  Summarizes install, config, and local project operability findings for `pp` itself.',
      '',
      'Behavior:',
      '  - Checks whether the diagnostics target exists.',
      '  - Reports global config and MSAL cache paths plus whether they already exist.',
      '  - Tries to discover a local `pp.config.*` project and surfaces unresolved project diagnostics when one is found.',
      '',
    ].join('\n') + '\n'
  );
}

export function printDiagnosticsBundleHelp(): void {
  process.stdout.write(
    [
      'Usage: diagnostics bundle [path] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Status:',
      '  Emits a structured debug bundle for `pp` install, runtime, config, and project context.',
      '',
      'Behavior:',
      '  - Includes CLI version, runtime metadata, config roots, and project-discovery state.',
      '  - Intended for CI artifacts, support triage, or before/after troubleshooting snapshots.',
      '',
    ].join('\n') + '\n'
  );
}
