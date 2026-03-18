---
name: pp-development
description: Use this skill for any Power Platform development or troubleshooting task involving the `pp` CLI. Trigger when the user mentions `pp`, Power Platform, Dataverse, Power Automate flows, canvas apps, model-driven apps, SharePoint, solutions, or when working in a directory with pp.config.yaml. Also trigger for auth setup, environment alias management, connection references, environment variables, notebooks, and MCP server usage.
version: 3.0.0
---

# pp-development

`pp` is a CLI and SDK for Power Platform engineering. Use it for Dataverse
operations, solution lifecycle, SharePoint inspection, flow inspection, canvas
apps, model-driven apps, auth management, notebooks, and MCP automation.

## Invoking pp

Check which form works in the current workspace before doing anything else:

```sh
pp --version                               # global install
pnpm pp -- --version                       # monorepo (most common)
node packages/cli/dist/index.js --version  # direct fallback
```

---

## How pp works

`pp` is driven by two things: **auth profiles** and **environment aliases**.
Every remote command takes `--environment <alias>` (or `--env` for short).
An optional `pp.config.yaml` in a repo provides defaults so you can omit
`--environment` and `--solution` flags.

### Without pp.config.yaml (direct mode)

Auth profile + environment alias is all you need. Use this for:
- troubleshooting an environment you don't own
- one-off queries and inspections
- exploring an unfamiliar Dataverse org

```sh
pp auth profile list                        # what credentials exist
pp env list                                 # what environment aliases exist
pp dv whoami --env <alias>                  # confirm connectivity and identity
```

### With pp.config.yaml (project defaults)

`pp` walks ancestor directories to find the nearest `pp.config.yaml` (or
`.json` / `.yml`). When found, its `defaults` section supplies the environment
alias and solution so you don't have to pass them on every command.

See [`references/project-config.md`](references/project-config.md) for the
config schema.

---

## Core concepts

**Auth profile** — a named set of credentials stored locally (browser login,
client secret, device code, static token, or env-var token). Each profile
targets a specific resource URL. Created once, referenced by name.

```sh
pp auth profile list
pp auth profile add-user --name myprofile
pp auth login --profile myprofile
pp auth token --profile myprofile
```

**Environment alias** — a local name that maps to a Dataverse environment URL
plus an auth profile. Commands always use the alias name, never raw URLs.

```sh
pp env add --name dev --url https://myorg.crm.dynamics.com --profile myprofile
pp env inspect dev
```

**Solution** — a Dataverse solution that lives inside an environment. Required
when authoring metadata, creating artifacts, or managing connection references
and environment variables. Many read operations (query, get, metadata inspect)
do not require `--solution`.

---

## Orientation by context

### In an unfamiliar Dataverse environment

```sh
pp dv whoami --env <alias>                  # identity + base URL confirmation
pp solution list --env <alias>              # what solutions exist
pp dv metadata tables --env <alias>         # custom table inventory
pp connref list --env <alias>               # connection reference bindings
pp envvar list --env <alias>                # environment variable values
```

### First time in a workspace — auth not yet set up

```sh
# 1. Create an auth profile
pp auth profile add-user --name dev-user
pp auth login --profile dev-user

# 2. Register an environment alias
pp env add --name dev --url https://myorg.crm.dynamics.com --profile dev-user

# 3. Verify
pp dv whoami --env dev
```

---

## Dataverse — reads and inspection

No `--solution` required. Safe to run in any environment.

```sh
pp dv whoami --env <alias>
pp dv query <table> --env <alias> --select col1,col2 --filter "..." --top 20
pp dv get <table> <guid> --env <alias> --select col1,col2
pp dv request <path> --env <alias>                # raw Web API request
pp dv action <action> --env <alias> --body '{}'   # bound/unbound action
pp dv function <function> --env <alias>           # bound/unbound function

pp dv metadata tables --env <alias>
pp dv metadata table <logicalName> --env <alias>
pp dv metadata columns <table> --env <alias>
pp dv metadata column <table> <col> --env <alias>
pp dv metadata option-set <name> --env <alias>
pp dv metadata relationship <name> --env <alias>
pp dv metadata snapshot --env <alias> --out ./snapshot.json
pp dv metadata diff --env <alias> --file ./snapshot.json
pp dv metadata schema <table> --env <alias>
```

## Dataverse — writes (--solution required for metadata authoring)

Always run with `--plan` first unless you know the change is safe.

```sh
# Row mutations
pp dv create <table> --env <alias> --body '{"name":"Acme"}' [--plan]
pp dv update <table> <guid> --env <alias> --body '{"name":"Renamed"}' [--plan]
pp dv delete <table> <guid> --env <alias>
pp dv rows apply --env <alias> --file ./rows.yaml [--plan]
pp dv rows export <table> --env <alias> --out ./rows.yaml
pp dv batch --env <alias> --file ./batch.yaml

# Metadata authoring (solution-scoped)
pp dv metadata init create-table               # scaffold a table spec file
pp dv metadata create-table --env <alias> --file ./table.yaml --solution <name> [--plan]
pp dv metadata add-column <table> --env <alias> --file ./column.yaml --solution <name> [--plan]
pp dv metadata create-option-set --env <alias> --file ./optionset.yaml --solution <name> [--plan]
pp dv metadata create-relationship --env <alias> --file ./rel.yaml --solution <name> [--plan]
pp dv metadata apply --env <alias> --file ./manifest.yaml --solution <name> [--plan]
```

See [`references/schemas.md`](references/schemas.md) for the spec file formats.

## Solution lifecycle

```sh
pp solution list --env <alias>
pp solution inspect <uniqueName> --env <alias> --format json
pp solution components <uniqueName> --env <alias>
pp solution dependencies <uniqueName> --env <alias>
pp solution publishers --env <alias>
pp solution analyze <uniqueName>                  # dependency report (local)
pp solution compare <uniqueName> --source-env dev --target-env prod
pp solution sync-status <uniqueName> --env <alias>
pp solution checkpoint <uniqueName> --env <alias>
pp solution publish <uniqueName> --env <alias>
pp solution export <uniqueName> --env <alias> --out ./Core.zip
pp solution import ./Core.zip --env <alias> [--plan]
pp solution create --env <alias> --publisher-unique-name <prefix> [--plan]
pp solution delete <uniqueName> --env <alias>
pp solution set-metadata <uniqueName> --env <alias>
pp solution pack <path> --out ./Core.zip
pp solution unpack ./Core.zip --out ./solution/
```

## Connection references and environment variables

```sh
pp connref list --env <alias>
pp connref inspect <name> --env <alias>
pp connref create --env <alias> --solution <name>
pp connref set <name> --env <alias> --value <connectionId> --solution <name> [--plan]
pp connref validate --env <alias>

pp envvar list --env <alias>
pp envvar inspect <schemaName> --env <alias>
pp envvar create --env <alias> --solution <name>
pp envvar set <schemaName> --env <alias> --value <value> --solution <name> [--plan]
```

## Flows

```sh
# Remote inspection
pp flow list --env <alias> [--solution <name>]
pp flow inspect <name|id> --env <alias>
pp flow export <name|id> --env <alias> --solution <name> --out ./flows/myflow/
pp flow activate <name|id> --env <alias> --solution <name> [--plan]
pp flow connrefs <name|id> --env <alias> --solution <name>
pp flow access <name|id> --env <alias>
pp flow attach <name|id> --env <alias> --solution <name>

# Run inspection
pp flow runs <name|id> --env <alias> [--since 24h] [--status Failed]
pp flow runs <name|id> --env <alias> --run-id <runId> --include-actions
pp flow runs <name|id> --env <alias> --run-id <runId> --include-action-io

# Direct Power Automate API access
pp flow request <path> --env <alias> [--method GET|POST|PATCH|DELETE] [--query key=value] [--body '{}']
pp flow request /flows/<flowId>/runs --env <alias> --format json
pp flow request /flows/<flowId>/runs/<runId>/actions --env <alias>

# Local artifact operations (see schemas.md for the artifact format)
pp flow normalize ./flows/myflow/
pp flow validate ./flows/myflow/
```

## Canvas apps

```sh
# Remote
pp canvas list --env <alias> [--solution <name>]
pp canvas download <name|id> --env <alias> --out ./apps/myapp/
pp canvas inspect <path-or-id> [--env <alias>]
pp canvas probe <name|id> --env <alias> --browser-profile <name>
pp canvas access <name|id> --env <alias>
pp canvas create --env <alias> --solution <name> --name MyApp [--plan]
pp canvas import <path> --env <alias> --solution <name> [--plan]
pp canvas attach <name|id> --env <alias> --solution <name> [--plan]

# Local artifact operations
pp canvas validate <path>
pp canvas lint <path>
pp canvas build <path> --out ./dist/
pp canvas diff <path1> <path2>
pp canvas patch plan --file ./patch.yaml <path>
pp canvas patch apply --file ./patch.yaml <path> --out ./patched/

# Templates
pp canvas templates import --registry <name> --out ./apps/myapp/
pp canvas templates inspect <path>
pp canvas templates diff <path>
pp canvas templates pin <path> --out ./pinned/
pp canvas templates refresh --current <path>
pp canvas templates audit <path>

# Workspace
pp canvas workspace inspect [--workspace <path>] [--registry <name>]
```

## SharePoint

```sh
pp sharepoint site list --env <alias> --resource https://graph.microsoft.com
pp sharepoint site inspect <site-id|hostname:/path|url> --env <alias> --resource https://graph.microsoft.com
pp sharepoint list list --env <alias> --site <site> --resource https://graph.microsoft.com
pp sharepoint list items <list> --env <alias> --site <site> --resource https://graph.microsoft.com
pp sharepoint file list --env <alias> --site <site> [--drive <name>] [--path /folder] --resource https://graph.microsoft.com
pp sharepoint file inspect <item-id|/path|url> --env <alias> --site <site> [--drive <name>] --resource https://graph.microsoft.com
pp sharepoint permission list --env <alias> --site <site> [--list <list>|--file <path>] --resource https://graph.microsoft.com
```

## Model-driven apps

```sh
pp model list --env <alias> [--solution <name>]
pp model inspect <name|id> --env <alias>
pp model create --env <alias> --solution <name>
pp model attach <name|id> --env <alias> --solution <name>
pp model access <name|id> --env <alias>
pp model composition <name|id> --env <alias>
pp model impact <name|id> --env <alias> [--kind app|form|view|sitemap] [--target <name>]
pp model sitemap <name|id> --env <alias>
pp model forms <name|id> --env <alias>
pp model views <name|id> --env <alias>
pp model dependencies <name|id> --env <alias>
pp model patch plan <name|id> --env <alias> [--kind app|form|view|sitemap] [--target <name>] [--rename <name>]
```

## Notebook — local dashboards (HTML or Markdown)

`pp notebook serve` runs a local HTTP server that renders HTML or Markdown files
with embedded `pp` commands. Use it for quick environment dashboards, comparison
reports, or any repeatable query set you want to view in a browser.

```sh
pp notebook serve report.html                     # serve HTML and open browser
pp notebook serve report.md                       # serve Markdown notebook
pp notebook serve report.html --port 8080         # fixed port
pp notebook serve report.html --no-open           # skip browser launch
```

Write standard HTML with `data-pp` attributes, or use Markdown with ` ```pp `
fenced blocks. The value is the CLI argv without the `pp` prefix:

```html
<pre data-pp="dv whoami --environment dev --format json"></pre>
<pre data-pp="solution list --environment dev --format table"></pre>
```

Commands run in-process using local credentials. The browser auto-reloads when
the source file changes (via SSE file watching). Output streams in real time.
Per-cell timeouts default to 60 seconds and are configurable via
`data-pp-timeout`. Cell variables (`data-pp-var` + `{{name}}`) let one cell's
output feed into another cell's command.

See [`references/notebook.md`](references/notebook.md) for the full source
format, server routes, cell attributes, variables, error display, snapshot
export, and worked examples.

## MCP server

`pp mcp serve` starts an MCP server exposing pp's domain capabilities to AI
agents.

```sh
pp mcp serve                                      # stdio transport
pp mcp serve --allow-interactive-auth              # allow browser-based auth
```

## Diagnostics

```sh
pp diagnostics doctor                              # system health report
pp diagnostics bundle                              # collect diagnostics for filing
```

---

## Troubleshooting workflows

### Auth and connectivity

```sh
pp auth profile list                              # what profiles exist
pp auth token --profile <name>                    # test token acquisition
pp dv whoami --env <alias>                        # identity + URL check
pp diagnostics doctor                             # system health report
pp diagnostics bundle                             # collect diagnostics for filing
```

If `dv whoami` fails: check that the profile's resource URL matches the env URL
exactly. Token acquisition uses the profile's resource; a mismatch means the
token is valid but for a different audience.

### Flow errors

Work from summary to detail:

```sh
pp flow runs <name> --env <alias> --since 7d --status Failed
# → recent failed runs

pp flow runs <name> --env <alias> --run-id <runId> --include-actions
# → action-level detail for a specific run

pp flow runs <name> --env <alias> --run-id <runId> --include-action-io
# → full action input/output payloads

pp flow connrefs <name> --env <alias> --solution <name>
# → what connection references this flow binds to

pp flow request /flows/<flowId>/runs --env <alias> --query '$filter=properties/status eq \'Failed\'' --format json
# → direct API query for more control
```

### Schema drift between environments

```sh
pp dv metadata snapshot --env dev --out ./dev-snapshot.json
pp dv metadata diff --env prod --file ./dev-snapshot.json
# → what tables/columns exist in dev but not prod

pp solution compare <uniqueName> --source-env dev --target-env prod
# → solution-level component diff
```

### Broken solution import

```sh
pp solution analyze <path>
# → dependency report for a local solution zip

pp connref validate --env <alias>
# → which connection references are unbound

pp envvar list --env <alias>
# → which environment variables have no value set
```

---

## Mutation discipline

`pp` marks every mutation-capable command. The pattern is consistent:

- `--plan` / `--dry-run` — preflight check, shows what would change, no side effects
- `--yes` — applies without an interactive prompt
- no flag — interactive prompt (only in terminal; fails in non-interactive contexts)

The `--plan` output includes `suggestedNextActions`, `knownLimitations`, and
`provenance`. Read them. A clean preflight does not guarantee a clean apply, but
it catches missing connection references and authorization gaps before they
cause partial state.

Metadata authoring and solution import are the highest-risk mutations because
they can fail mid-operation and leave partial state. Run `--plan` first without
exception. For solution import in particular, check `pp solution analyze` on the
target before importing.

---

## Fallback rules

Reach for another `pp` command first — the surface is wide and the help text
is explicit about what is and isn't implemented.

Leave `pp` only when:
1. `pp` returns an explicit not-implemented or capability-gap diagnostic
2. The docs classify the workflow as **preview**, **bounded**, or **experimental**
3. The workflow is inherently browser-only (Maker UI with no API surface)
4. The platform surface is opaque (some Microsoft admin portals, Power Platform
   admin center operations)

When you fall back, classify why:

- **pp gap** — not yet in `pp`; try `pac` or file an issue
- **platform limitation** — no API exists; browser handoff or manual step is correct
- **auth/runtime issue** — token, session, or environment setup problem; fix the auth
- **user config issue** — bad alias, missing asset, malformed pp.config.yaml; fix the config

Fallback order: `pp` alternative → `pac` (for admin/ALM gaps) → browser automation → manual handoff.

---

## Stability tiers

Affects how much you trust a command's output and whether to have a recovery plan.

**Stable** — auth, env aliases, Dataverse reads/writes/metadata, solution lifecycle,
connection references, environment variables, flow inspection and runs, CLI output
contract, diagnostics, notebooks.

**Preview** — canvas offline validate/build/patch, flow local artifact operations,
flow remote export, model-driven app inspection, canvas templates.

**Experimental** — canvas remote create/import, model-driven app patching,
broad MCP automation.

Preview and experimental commands are real but may return partial results or
change behavior. Always inspect output before acting on it.

---

## References

- [`references/schemas.md`](references/schemas.md) — spec file formats for metadata authoring, rows, and flows
- [`references/project-config.md`](references/project-config.md) — pp.config.yaml schema
