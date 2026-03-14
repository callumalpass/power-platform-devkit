export {
  printAuthBrowserProfileAddHelp,
  printAuthBrowserProfileBootstrapHelp,
  printAuthBrowserProfileHelp,
  printAuthBrowserProfileInspectHelp,
  printAuthBrowserProfileListHelp,
  printAuthBrowserProfileRemoveHelp,
  printAuthHelp,
  printAuthLoginHelp,
  printAuthProfileAddClientSecretHelp,
  printAuthProfileAddDeviceCodeHelp,
  printAuthProfileAddEnvHelp,
  printAuthProfileAddStaticHelp,
  printAuthProfileAddUserHelp,
  printAuthProfileHelp,
  printAuthProfileInspectHelp,
  printAuthProfileListHelp,
  printAuthProfileRemoveHelp,
  printAuthTokenHelp,
  printHelp,
  printInitAnswerHelp,
  printInitCancelHelp,
  printInitHelp,
  printInitResumeHelp,
  printInitStatusHelp,
} from './help-auth';
export {
  printSolutionCheckpointHelp,
  printSolutionCompareHelp,
  printSolutionComponentsHelp,
  printSolutionCreateHelp,
  printSolutionDependenciesHelp,
  printSolutionExportHelp,
  printSolutionHelp,
  printSolutionImportHelp,
  printSolutionInspectHelp,
  printSolutionListHelp,
  printSolutionPublishHelp,
  printSolutionPublishersHelp,
  printSolutionSetMetadataHelp,
  printSolutionSyncStatusHelp,
} from './help-solution';
export {
  printDataverseCreateHelp,
  printDataverseHelp,
  printDataverseMetadataHelp,
  printDataverseQueryHelp,
  printDataverseRowsApplyHelp,
  printDataverseRowsExportHelp,
  printDataverseRowsHelp,
  printDataverseWhoAmIHelp,
} from './help-dataverse';

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
      '  access <name|id|uniqueName> inspect ownership and explicit share state',
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
      '  pp model access SalesHub --environment dev --format json',
      '',
      'Notes:',
      '  - `model create` uses solution-scoped Dataverse creation when `--solution` or the environment alias defaultSolution is available.',
      '  - `model attach` uses `--solution` when provided, otherwise the environment alias defaultSolution when configured.',
      '  - `model attach` uses the supported solution component action rather than direct raw row writes.',
      '  - `model sitemap`, `forms`, `views`, and `dependencies` emit counts plus inspection coverage so empty outputs explain whether component membership was inspectable.',
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
      '  probe <displayName|name|id>  open the remote play URL in a persisted browser profile and report the landing state',
      '  access <displayName|name|id> inspect ownership and explicit share state for a remote canvas app',
      '  create                       preview handoff today; `--delegate` can drive the Maker blank-app flow through a browser profile',
      '  import <file.msapp>          replace one remote solution-scoped canvas app with a local .msapp',
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
      '  pp canvas import ./dist/HarnessCanvas.msapp --environment dev --solution Core --target "Harness Canvas"',
      '  pp canvas download "Harness Canvas" --environment dev',
      '  pp canvas inspect "Harness Canvas" --environment dev --solution Core',
      '  pp canvas probe "Harness Canvas" --environment dev --solution Core --browser-profile maker-work',
      '  pp canvas access "Harness Canvas" --environment dev --format json',
      '  pp canvas inspect ./apps/MyCanvas --project . --mode strict',
      '  pp canvas build ./apps/MyCanvas --project . --out ./dist/MyCanvas.msapp',
      '',
      'Notes:',
      '  - Remote canvas download exports the containing solution through Dataverse and extracts CanvasApps/*.msapp without leaving pp.',
      '  - Remote canvas import replaces one explicit CanvasApps/*.msapp entry by exporting and re-importing the containing solution through Dataverse.',
      '  - `canvas create --delegate` can drive the Maker blank-app flow and wait for the created app id through Dataverse.',
      '  - `canvas create` remains a guided preview flow, while `canvas import` now requires `--solution` plus an explicit `--target` to avoid destructive guesses.',
      '  - Use --environment to switch canvas inspect from local-path mode to remote lookup mode.',
      '  - Use `canvas probe` when you need `pp` to capture the live browser landing URL/title/host for a play URL handoff.',
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
      'Usage: canvas attach <displayName|name|id> --environment ALIAS --solution UNIQUE_NAME [--plan|--dry-run] [options]',
      '',
      'Status:',
      '  Attaches an existing remote canvas app to a solution through Dataverse AddSolutionComponent.',
      '',
      'Behavior:',
      '  - Requires `--environment` and `--solution` to resolve the target environment alias and solution.',
      '  - Uses the existing pp Dataverse auth context; it does not shell out to pac.',
      '  - Includes required solution components by default; pass `--no-add-required-components` to opt out.',
      '  - `--plan` performs a read-only preflight that reports target-solution baseline, current solution membership, and containing-solution context without mutating.',
      '  - `--dry-run` keeps the generic non-mutating mutation preview contract without live attach planning.',
      '',
      'Examples:',
      '  pp canvas attach "Harness Canvas" --environment dev --solution Core',
      '  pp canvas attach "Harness Canvas" --environment dev --solution Core --plan --format json',
      '  pp canvas attach crd_HarnessCanvas --environment dev --solution Core --no-add-required-components',
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
      'Decision guide:',
      '  - Use `pp env add` when you need a saved Dataverse alias such as `dev`, `test`, or `uat`.',
      '  - Use `pp auth profile add-env` only when the credential source is an access token already present in an environment variable.',
      '  - Use `pp auth profile inspect --environment <alias>` when the workflow starts from an alias and you need the concrete profile behind it.',
      '',
      'Commands:',
      '  list                         list saved environment aliases',
      '  add                          add or update one environment alias',
      '  inspect <alias>              inspect one saved alias',
      '  baseline <alias>             inspect one alias plus bootstrap-reset baseline checks',
      '  resolve-maker-id <alias>     discover and persist the Maker environment id for an alias',
      '  cleanup-plan <alias>         list disposable solutions and orphaned prefixed assets before bootstrap reset',
      '  reset <alias>                delete disposable solutions and orphaned prefixed assets for bootstrap reset',
      '  cleanup <alias>              delete disposable solutions and orphaned prefixed assets',
      '  remove <alias>               remove one saved alias from local config',
      '',
      'Examples:',
      '  pp env add dev --url https://contoso.crm.dynamics.com --profile work',
      '  pp env list',
      '  pp env inspect dev',
      '  pp env baseline test --prefix ppHarness20260310T013401820Z --format json',
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
      'Usage: env add <alias> --url URL --profile PROFILE [--default-solution NAME] [--maker-env-id GUID] [--config-dir path]',
      '',
      'Behavior:',
      '  - Adds one Dataverse environment alias that points to an existing auth profile.',
      '  - The alias becomes the value you pass later with `--environment ALIAS`.',
      '',
      'Requirements:',
      '  - `--profile` must name an existing auth profile.',
      '',
      'Examples:',
      '  pp env add dev --url https://contoso.crm.dynamics.com --profile work',
      '  pp env add uat --url https://contoso-uat.crm.dynamics.com --profile work --default-solution Core',
      '',
      'Compatibility:',
      '  - `--name ALIAS` is still accepted, but the positional alias form matches `env inspect`, `env remove`, and other alias-scoped commands.',
      '',
      'See also:',
      '  - If you still need credentials, create the profile first with `pp auth profile add-user` or another `auth profile add-*` command.',
      '  - If the profile should read a token from an environment variable, use `pp auth profile add-env` before this alias step.',
      '  - To confirm which profile an existing alias resolves to, use `pp auth profile inspect --environment <alias>`.',
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

export function printEnvironmentBaselineHelp(): void {
  process.stdout.write(
    [
      'Usage: env baseline <alias> --prefix PREFIX [--expect-absent-solution NAME ...] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Combines `env inspect` with prefix-scoped reset checks into one non-mutating bootstrap baseline report.',
      '  - Lists disposable solutions plus orphaned prefixed canvas apps, flows, model apps, connection references, and environment variables that match PREFIX, case-insensitively.',
      '  - Optionally verifies that specific prior solutions are absent before the next harness run begins.',
      '  - Returns a `readyForBootstrap` signal plus next-step guidance for `pp env reset` or targeted `pp solution delete` cleanup.',
      '',
      'Examples:',
      '  pp env baseline test --prefix ppHarness20260310T013401820Z --format json',
      '  pp env baseline test --prefix ppHarness20260310T013401820Z --expect-absent-solution ppHarness20260309T215614036ZShell --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
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
      '  - Lists remote disposable solutions plus orphaned prefixed canvas apps, flows, model apps, connection references, and environment variables that match PREFIX, case-insensitively.',
      '  - Intended for harness bootstrap or disposable-environment reset flows where stale disposable harness assets should be removed before reuse.',
      '  - Returns candidate solutions and orphaned assets together with next-step guidance for `pp env reset`.',
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
      '  - Deletes remote disposable solutions plus orphaned prefixed canvas apps, flows, model apps, connection references, and environment variables that match PREFIX, case-insensitively.',
      '  - Intended as the first-class bootstrap reset command for clearing stale disposable harness assets before environment reuse.',
      '  - Use `--dry-run` or `--plan` first to preview the matching disposable solutions and orphaned prefixed assets without mutating the environment.',
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
      '  - Deletes remote disposable solutions plus orphaned prefixed canvas apps, flows, model apps, connection references, and environment variables that match PREFIX, case-insensitively.',
      '  - Use `--dry-run` or `--plan` first to preview the matching disposable solutions and orphaned prefixed assets without mutating the environment.',
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
      'Usage: canvas download <displayName|name|id> --environment ALIAS [--solution UNIQUE_NAME] [--out FILE] [--extract-to-directory DIR] [options]',
      '',
      'Status:',
      '  Exports the containing solution through Dataverse and extracts the matching CanvasApps/*.msapp entry.',
      '',
      'Behavior:',
      '  - Requires `--environment`; pass `--solution` when you already know the containing solution, otherwise pp auto-resolves it when the app belongs to exactly one solution.',
      '  - Uses the existing pp Dataverse auth context; it does not shell out to pac for canvas download.',
      '  - When `--out` is omitted, writes `<displayName|name|id>.msapp` in the current working directory.',
      '  - `--extract-to-directory` also expands the downloaded `.msapp` into a normalized source tree, converting archive backslashes into portable folder separators.',
      '  - When the app is not attached to any solution, pp returns a machine-readable diagnostic explaining that solution membership is required before remote schema harvest/download can proceed.',
      '  - Extracted downloads also emit round-trip handoff details for rebuild/repack and Dataverse table metadata lookup.',
      '',
      'Examples:',
      '  pp canvas download "Harness Canvas" --environment dev',
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
      'Usage: canvas import <file.msapp> --environment ALIAS --solution UNIQUE_NAME --target <displayName|name|id> [options]',
      '',
      'Choose this when:',
      '  - You already rebuilt an `.msapp` artifact and need to replace one existing remote canvas app in a solution.',
      '',
      'Choose a different path when:',
      '  - You only need a packaged artifact from local source: use `pp canvas build`.',
      '  - You need to inspect or export an existing remote app: use `pp canvas list`, `inspect`, or `download`.',
      '',
      'Options:',
      '  --target <name|id>         Required remote canvas app to replace inside the specified solution',
      '  --overwrite-unmanaged-customizations',
      '                            Pass through Dataverse ImportSolution overwrite behavior',
      '  --no-publish-workflows     Skip workflow publishing during the backing solution import',
      '',
      'What works today:',
      '  - Use `pp canvas build <path> --out <file.msapp>` to package a local canvas source tree.',
      '  - Use `pp canvas list --environment <alias> --solution <solution>` to inspect existing remote canvas apps and choose the exact `--target`.',
      '  - `pp canvas import` exports the solution, replaces one `CanvasApps/*.msapp` entry, and imports the rebuilt package back through Dataverse.',
      '',
      'Recommended flow:',
      '  1. Build or locate the `.msapp` artifact you intend to import.',
      '  2. Run `pp canvas list --environment <alias> --solution <solution>` to choose the exact remote app to replace.',
      '  3. Run `pp canvas import <file.msapp> --environment <alias> --solution <solution> --target <displayName|name|id>`.',
      '',
      'Known limitations:',
      '  - Import is solution-scoped and intentionally requires an explicit `--target`; pp will not guess which remote app entry to replace.',
      '  - pp still does not create brand-new remote canvas apps directly; use `pp canvas create --delegate` or Maker for blank-app creation.',
      '',
      'Preview options:',
      '  --dry-run                     Resolve env/solution context and print a structured no-op preview',
      '  --plan                        Resolve env/solution context and print a structured no-op plan',
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
      '  - Remote inspect includes portal provenance plus a runtime handoff block with the play URL, expected hosts, and browser-profile bootstrap guidance when pp can derive them.',
      '  - The runtime handoff block also includes a ready-to-run `pp canvas probe ...` command for built-in landing-state capture.',
      '  - Use repeated `--expect-control-property <controlPath>::<property>::<expectedValue>` to export the remote app package and return a pass/fail proof summary for deployed control bindings.',
      '',
      'Local behavior:',
      '  - Accepts a local canvas path plus `--project`, repeated `--registry`, `--cache-dir`, and `--mode` options.',
      '',
      'Examples:',
      '  pp canvas inspect "Harness Canvas" --environment dev --solution Core',
      '  pp canvas probe "Harness Canvas" --environment dev --solution Core --browser-profile maker-work',
      "  pp canvas inspect \"Harness Canvas\" --environment dev --solution Core --expect-control-property \"Screen1/Gallery1::Items::='PP Harness Projects'\"",
      '  pp canvas inspect ./apps/MyCanvas --project . --mode strict',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasValidateHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas validate <path|workspaceApp> [--workspace FILE] [--project path] [--registry FILE] [--cache-dir DIR] [--mode strict|seeded|registry] [options]',
      '',
      'Behavior:',
      '  - Validates a local canvas source tree without packaging it.',
      '  - `strict` prefers source-provided metadata first, then pinned registries, and fails when required template metadata is still missing.',
      '  - `seeded` limits resolution to source-provided metadata such as `seed.templates.json` or unpacked `References/Templates.json`.',
      '  - `registry` ignores source-provided metadata and uses only pinned registries from `pp.config.*` or repeated `--registry` flags.',
      '',
      'Examples:',
      '  pp canvas validate ./apps/MyCanvas --project . --mode strict',
      '  pp canvas validate ./apps/MyCanvas --registry ./registries/canvas-controls.json --mode registry --format json',
      '  pp canvas validate MyCanvas --workspace ./canvas.workspace.json --mode seeded',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasBuildHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas build <path|workspaceApp> [--workspace FILE] [--project path] [--registry FILE] [--cache-dir DIR] [--mode strict|seeded|registry] [--out FILE] [options]',
      '',
      'Behavior:',
      '  - Packages a local canvas source tree into an `.msapp`.',
      '  - Unpacked `.pa.yaml` roots can auto-consume embedded `References/Templates.json` payloads during strict builds.',
      '  - Legacy json-manifest roots often need either a richer `seed.templates.json` or explicit pinned registries before strict mode can succeed.',
      '',
      'Examples:',
      '  pp canvas build ./apps/MyCanvas --project . --mode strict --out ./dist/MyCanvas.msapp',
      '  pp canvas build ./apps/MyCanvas --registry ./registries/canvas-controls.json --mode registry --out ./dist/MyCanvas.msapp',
      '  pp canvas build MyCanvas --workspace ./canvas.workspace.json --mode seeded --out ./dist/MyCanvas.msapp',
      '',
      'Preview options:',
      '  --dry-run                     Resolve build inputs and print a structured no-op preview',
      '  --plan                        Resolve build inputs and print a structured no-op plan',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasDiffHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas diff <leftPath> <rightPath> [options]',
      '',
      'Behavior:',
      '  - Compares two local canvas source trees and reports structural changes.',
      '  - Supports both legacy json-manifest roots and unpacked `.pa.yaml` roots.',
      '',
      'Examples:',
      '  pp canvas diff ./apps/MyCanvas ./apps/MyCanvas-next',
      '  pp canvas diff ./fixtures/canvas/apps/base-app ./fixtures/canvas/apps/changed-app --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasProbeHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas probe <displayName|name|id> --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Behavior:',
      '  - Resolves the remote canvas app through Dataverse, then opens its play URL in a persisted browser profile.',
      '  - Captures the requested play URL plus the observed final URL, title, host, frames, and browser-profile launch details.',
      '  - Reuses the environment auth profile browser profile by default; use --browser-profile NAME to override it.',
      '  - When the persisted browser profile directory is locked, pp clones it into a disposable retry directory and reports that fallback in the probe output.',
      '',
      'Options:',
      '  --browser-profile NAME     Override the browser profile used for the probe',
      '  --artifacts-dir DIR        Persist screenshots and session json under DIR',
      '  --headless                 Run the browser probe headlessly',
      '  --timeout-ms N             Navigation timeout in milliseconds',
      '  --settle-ms N              Extra wait time after navigation before capture',
      '  --slow-mo-ms N             Slow Playwright actions by N milliseconds',
      '',
      'Examples:',
      '  pp canvas probe "Harness Canvas" --environment dev --solution Core --browser-profile maker-work',
      '  pp canvas probe "Harness Canvas" --environment dev --headless --timeout-ms 45000',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printCanvasAccessHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas access <displayName|name|id> --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Reports owner/creator lookups plus explicit principalobjectaccess shares for one remote canvas app.',
      '',
      'Examples:',
      '  pp canvas access "Harness Canvas" --environment dev --format json',
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
      '  activate <name|id|...>      activate a remote flow in place',
      '  promote <name|id|...>       move a flow between environments',
      '  deploy <path>               deploy a local flow artifact into an environment',
      '  unpack <path>               unpack a flow artifact into a folder',
      '  pack <path>                 pack a folder back into a flow artifact',
      '  normalize <path>            rewrite a local artifact into normalized shape',
      '  validate <path>             validate a local artifact',
      '  graph <path>                emit a graph view of a local artifact',
      '  patch <path> --file ...     apply a bounded patch to a local artifact',
      '  runs <name|id|...>          inspect recent remote run history',
      '  monitor <name|id|...>       summarize follow-up runtime health in one report',
      '  errors <name|id|...>        summarize remote runtime failures',
      '  connrefs <name|id|...>      inspect connection references used by a flow',
      '  doctor <name|id|...>        summarize remote runtime health and dependencies',
      '  access <name|id|...>        inspect ownership and explicit share state',
      '',
      'How to think about it:',
      '  - Use remote commands when the flow already exists in an environment and you need lifecycle or runtime insight.',
      '  - Use local commands when the artifact is on disk and you want deterministic analysis or edits.',
      '  - `deploy` updates one target environment from a local artifact; `promote` copies a remote flow between environments.',
      '',
      'Examples:',
      '  pp flow inspect ./flows/invoice/flow.json',
      '  pp flow inspect InvoiceSync --environment dev --solution Core',
      '  pp flow activate InvoiceSync --environment dev --solution Core --format json',
      '  pp flow access InvoiceSync --environment dev --format json',
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
      'Usage: flow inspect <name|id|uniqueName|path> [--environment ALIAS] [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
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
      '  pp flow inspect InvoiceSync --environment dev --solution Core --no-interactive-auth --format json',
      '',
      'Auth behavior:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowExportHelp(): void {
  process.stdout.write(
    [
      'Usage: flow export <name|id|uniqueName> --environment ALIAS --out PATH [--solution UNIQUE_NAME] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Exports one remote flow artifact into a local file.',
      '  - Use this when you want to move from a live environment into the local validation/editing pipeline.',
      '',
      'Examples:',
      '  pp flow export InvoiceSync --environment dev --out ./artifacts/invoice-flow.json --no-interactive-auth',
      '  pp flow export InvoiceSync --environment dev --solution Core --out ./artifacts/invoice-flow.json --dry-run --no-interactive-auth --format json',
      '',
      'Auth behavior:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printFlowActivateHelp(): void {
  process.stdout.write(
    [
      'Usage: flow activate <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Choose this when:',
      '  - A remote flow already exists in one environment, but it is still draft or suspended and blocking solution export or runtime checks.',
      '',
      'Behavior:',
      '  - Re-applies the selected remote flow back into the same environment with workflow state forced to `activated`.',
      '  - Keeps the operation solution-aware when `--solution` is supplied so resolution stays inside that solution boundary.',
      '',
      'Examples:',
      '  pp flow activate InvoiceSync --environment dev --format json',
      '  pp flow activate crd_InvoiceSync --environment test --solution Core --format json',
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
      '  pp flow activate crd_InvoiceSync --environment test --solution Core --format json',
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
      '  - The patch file must be a JSON object. Omit sections you do not need.',
      '',
      'Patch document shape:',
      '  {',
      '    "actions": { "OldAction": "NewAction" },',
      '    "variables": { "oldVar": "newVar" },',
      '    "connectionReferences": { "shared_old": "shared_new" },',
      '    "environmentVariables": { "pp_OldValue": "pp_NewValue" },',
      '    "parameters": { "ApiBaseUrl": "https://next.example.test" },',
      '    "expressions": { "actions.Compose.inputs.subject": "@{parameters(\'ApiBaseUrl\')}" },',
      '    "values": { "actions.Compose.inputs.priority": "High" }',
      '  }',
      '',
      'Supported sections today:',
      '  - `actions`: bounded action-key renames plus supported `runAfter` / expression rewrites',
      '  - `variables`: bounded variable renames plus supported `variables(...)` and variable-write rewrites',
      '  - `connectionReferences`: declared metadata plus canonical `$connections` rewrites',
      '  - `environmentVariables`: supported `environmentVariables(...)` reference rewrites',
      '  - `parameters`: replace parameter default or literal values by name',
      '  - `expressions` / `values`: write explicit dotted paths inside the normalized definition payload',
      '',
      'Current limitations:',
      '  - Patch is intentionally narrow; it does not support arbitrary structural workflow rewrites.',
      '  - Rename chains and target-name collisions are rejected instead of guessed through automatically.',
      '',
      'Examples:',
      '  pp flow patch ./flows/invoice --file ./patches/invoice.patch.json --plan --format json',
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

export function printFlowMonitorHelp(): void {
  process.stdout.write(
    [
      'Usage: flow monitor <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--since 7d] [--baseline FILE] [options]',
      '',
      'Behavior:',
      '  - Combines recent runs, grouped runtime errors, and doctor findings into one follow-up monitoring report.',
      '  - Emits a health classification so repeated deployment checks do not require manual correlation across multiple commands.',
      '  - When `--baseline` points at a prior monitor JSON payload, also reports whether health, run counts, latest failure, or grouped errors changed since that capture.',
      '',
      'Examples:',
      '  pp flow monitor InvoiceSync --environment dev --since 2h --format json',
      '  pp flow monitor InvoiceSync --environment dev --since 2h --baseline ./artifacts/InvoiceSync.monitor.json --format json',
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
      'Usage: flow connrefs <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--since 7d] [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Reports the connection references used by one remote flow.',
      '',
      'Examples:',
      '  pp flow connrefs InvoiceSync --environment dev --solution Core --no-interactive-auth --format json',
      '',
      'Auth behavior:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
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

export function printFlowAccessHelp(): void {
  process.stdout.write(
    [
      'Usage: flow access <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Behavior:',
      '  - Reports owner/creator lookups plus explicit principalobjectaccess shares for one remote flow.',
      '',
      'Examples:',
      '  pp flow access InvoiceSync --environment dev --solution Core --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printModelAccessHelp(): void {
  process.stdout.write(
    [
      'Usage: model access <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Behavior:',
      '  - Reports owner/creator lookups plus explicit principalobjectaccess shares for one model-driven app.',
      '',
      'Examples:',
      '  pp model access SalesHub --environment dev --solution Core --format json',
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
      'Usage: project doctor [path] [--stage STAGE] [--environment ALIAS] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Validates a local pp project layout.',
      '',
      'Behavior:',
      '  - Reports config presence, asset-path checks, provider bindings, topology, registries, and unresolved required parameters.',
      '  - Machine-readable formats emit one payload on stdout, including diagnostics and suggested next actions.',
      '  - Reads project context without mutating the filesystem.',
      '  - Separates repo-local layout checks from external environment-registry and auth-resolution findings so local shape health is easier to read.',
      '  - Calls out when packaged solution zips live inline under `solutions/` instead of the canonical `artifacts/solutions/` bundle path.',
      '  - Makes the stage -> environment alias -> auth profile -> solution chain explicit when those external relationships can be resolved.',
      '  - When `--environment ALIAS` is provided, compares the selected repo target with that external runtime alias so cross-environment drift is explicit in one diagnostic.',
      '  - Includes per-root placement guidance for `apps/`, `flows/`, `solutions/`, `docs/`, and the canonical bundle output path.',
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
      'Usage: project feedback [path] [--stage STAGE] [--environment ALIAS] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Captures retrospective conceptual feedback for a local pp project.',
      '',
      'Behavior:',
      '  - Reuses the discovered project model to summarize workflow wins, current frictions, and concrete follow-up tasks.',
      '  - Renders the canonical bundle path and stage mappings so retrospectives can stay inside `pp`.',
      '  - When `--environment ALIAS` is provided, records how the selected project target compares with that external runtime alias.',
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
      'Usage: project inspect [path] [--stage STAGE] [--environment ALIAS] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Inspects resolved local project topology and asset roots.',
      '',
      'Behavior:',
      '  - Returns project summary, the canonical local layout contract, resolved topology, parameters, provider bindings, asset inventory, registries, build metadata, and docs metadata.',
      '  - Reads project context without mutating the filesystem.',
      '  - Auto-selects the lone descendant `pp.config.*` under the inspected path and reports discovery details when the current path is not itself a pp project.',
      '  - Calls out that editable sources belong under `apps/`, `flows/`, `solutions/`, and `docs/`, while generated solution zips belong under `artifacts/solutions/`.',
      '  - Includes per-root placement guidance so agents can tell where new app, flow, solution-source, docs, and bundle artifacts should live without repo archaeology.',
      '  - Pair with `pp project doctor` for layout validation and `pp project init` to scaffold a canonical `apps/`, `flows/`, `solutions/`, and `docs/` workspace.',
      '  - Makes the active stage -> environment alias -> auth profile -> solution relationship explicit when the referenced environment metadata is available.',
      '  - When `--environment ALIAS` is provided, compares the selected project target with that external runtime alias and reports whether the repo already maps it.',
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
      'Usage: analysis context [--project path] [--asset assetRef] [--stage STAGE] [--environment ALIAS] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Captures analysis-ready project context for agent and automation workflows.',
      '',
      'Behavior:',
      '  - Resolves the local project model and emits discovery, topology, provider binding, parameter, asset, and deploy-plan context in one payload.',
      '  - Reports the inspected path, resolved project root, and any descendant auto-selection directly in the structured output.',
      '  - When `--environment ALIAS` is provided, adds a repo-target versus runtime-target comparison so cross-environment planning does not require manual reconciliation.',
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
      'Usage: completion <bash|zsh|fish|pwsh>',
      '',
      'Status:',
      '  Emits a shell completion script for `pp`.',
      '',
      'Examples:',
      '  pp completion zsh > ~/.zfunc/_pp',
      '  autoload -U compinit && compinit',
      '  pp completion fish > ~/.config/fish/completions/pp.fish',
      '  pp completion pwsh | Out-String | Invoke-Expression',
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
