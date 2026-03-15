---
name: pp-development
description: Use this skill for any Power Platform development, troubleshooting, or project management task involving the `pp` CLI. Trigger when the user mentions `pp`, Power Platform, Dataverse, Power Automate flows, canvas apps, model-driven apps, solutions, deploy orchestration, or when working in a directory with pp.config.yaml. Also trigger for auth setup, environment alias management, connection references, environment variables, and analysis or reporting workflows.
version: 2.0.0
---

# pp-development

`pp` is a CLI and SDK for Power Platform engineering. Use it for Dataverse
operations, solution lifecycle, flow artifacts, canvas apps, auth management,
deploy orchestration, and project analysis.

## Invoking pp

Check which form works in the current workspace before doing anything else:

```sh
pp --version                               # global install
pnpm pp -- --version                       # monorepo (most common)
node packages/cli/dist/index.js --version  # direct fallback
```

---

## Three operating modes

`pp` works in three modes depending on what's in the current directory tree.
Understanding which mode you're in shapes every decision.

### 1. Direct mode — no project config

Auth profile + environment alias is all you need. Use this for:
- troubleshooting an environment you don't own
- one-off queries and inspections
- exploring an unfamiliar Dataverse org
- any task where there's no local repo or pp.config.yaml

```sh
pp auth profile list                        # what credentials exist
pp env list                                 # what environment aliases exist
pp dv whoami --env <alias>                  # confirm connectivity and identity
```

Every command takes `--env <alias>` directly. No project required.

### 2. Project mode — pp.config.yaml present

`pp` walks ancestor directories to find the nearest `pp.config.yaml` (or
`.json` / `.yml`). When found, that directory is the project root and its
`defaults` apply: default environment alias, default solution, default stage.

Commands without explicit `--env` or `--solution` use those defaults.
`pp project`, `pp analysis`, and `pp deploy` commands become available.

```sh
pp project doctor                           # validate config, auth, asset layout
pp project inspect --format json            # resolved defaults and topology
```

### 3. Stage mode — topology configured

When `pp.config.yaml` has a `topology` section, a single `--stage <name>`
resolves the environment alias, solution unique name, and parameter overrides
for that stage. This is the right mode for multi-environment promotion and
deploy orchestration.

```sh
pp project inspect --stage prod --format json   # what "prod" resolves to
pp deploy plan --stage prod --format json       # deployment preview for prod
```

Never hard-code environment URLs or solution unique names. If you see yourself
writing `--env https://...` or `--solution MyOrg_Core_12345`, check whether
topology covers it and use `--stage` instead.

---

## Core concepts and their relationships

These four things are independent layers. Confusing them causes most errors.

**Auth profile** — a named set of credentials stored locally (browser login,
client secret, device code, static token, or env-var token). Each profile
targets a specific resource URL. Created once, referenced by name.

```sh
pp auth login --name myprofile --resource https://myorg.crm.dynamics.com
pp auth profile list
```

**Environment alias** — a local name that maps to a Dataverse environment URL
plus an auth profile. Commands always use the alias name, never raw URLs.
Created once per environment you work with.

```sh
pp env add --name dev --url https://myorg.crm.dynamics.com --profile myprofile
pp env inspect dev
```

**Project** — an optional local config (`pp.config.yaml`) that provides
defaults and asset discovery. Adds `pp project`, `pp analysis`, and
`pp deploy` capabilities. Not required for raw Dataverse or solution work.

**Solution** — a Dataverse solution that lives inside an environment. Required
when authoring metadata, creating artifacts, or managing connection references
and environment variables. Many read operations (query, get, metadata inspect)
do not require `--solution`.

---

## Orientation by context

### In an unfamiliar repo with pp.config.yaml

```sh
pp project doctor                           # health: config, auth, asset layout
pp project inspect --format json            # defaults, stage topology, asset paths
pp analysis context --format json           # parameter map, provider bindings
```

Read the output before touching anything. Look for: default stage, which
environment alias is targeted, which solution is scoped, and what assets are
declared under `assets`.

### In an unfamiliar Dataverse environment (no project)

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
pp auth login --name dev-user --resource https://myorg.crm.dynamics.com

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

pp dv metadata tables --env <alias>
pp dv metadata table <logicalName> --env <alias>
pp dv metadata columns <table> --env <alias>
pp dv metadata column <table> <col> --env <alias>
pp dv metadata option-set <name> --env <alias>
pp dv metadata snapshot --env <alias> --out ./snapshot.json
pp dv metadata diff --env <alias> --file ./snapshot.json
```

## Dataverse — writes (--solution required for metadata authoring)

Always run with `--plan` first unless you know the change is safe.

```sh
# Row mutations
pp dv create <table> --env <alias> --body '{"name":"Acme"}' [--plan]
pp dv update <table> <guid> --env <alias> --body '{"name":"Renamed"}' [--plan]
pp dv delete <table> <guid> --env <alias>
pp dv rows apply --env <alias> --file ./rows.yaml [--plan]
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
pp solution analyze <uniqueName> --env <alias>          # dependency report
pp solution compare <uniqueName> --source-env dev --target-env prod
pp solution publish <uniqueName> --env <alias>
pp solution export <uniqueName> --env <alias> --out ./Core.zip
pp solution import ./Core.zip --env <alias> [--plan] [--yes]
```

## Connection references and environment variables

```sh
pp connref list --env <alias>
pp connref set <name> --env <alias> --value <connectionId> --solution <name> [--plan]
pp connref validate --env <alias> --solution <name>

pp envvar list --env <alias>
pp envvar set <schemaName> --env <alias> --value <value> --solution <name> [--plan]
```

## Flows

```sh
# Remote lifecycle
pp flow list --env <alias> [--solution <name>]
pp flow inspect <name|id> --env <alias>
pp flow export <name|id> --env <alias> --solution <name> --out ./flows/myflow/
pp flow deploy ./flows/myflow/ --env <alias> --solution <name> [--create-if-missing] [--plan]
pp flow promote <name|id> --source-environment <alias> --target-environment <alias>

# Local artifact operations (see schemas.md for the artifact format)
pp flow unpack ./export.json --out ./flows/myflow/
pp flow normalize ./flows/myflow/
pp flow validate ./flows/myflow/
pp flow patch ./flows/myflow/ --file ./patches/dev.json --out ./flows/myflow-dev/
pp flow pack ./flows/myflow/ --out ./dist/myflow.json

# Diagnostics
pp flow doctor <name> --env <alias> [--since 7d]
pp flow errors <name> --env <alias> [--group-by connectionReference]
pp flow runs <name> --env <alias> [--since 24h]
pp flow monitor <name> --env <alias> [--since 2h]
```

## Deploy orchestration

```sh
pp deploy plan [--stage <stage>] [--format json]
pp deploy apply [--stage <stage>] --plan [--format json]   # preview
pp deploy apply [--stage <stage>] --yes [--format json]    # apply
pp deploy release plan --file ./release.yaml [--format json]
pp deploy release apply --file ./release.yaml --approve <gateId> [--yes]
```

## Analysis

```sh
pp analysis context [--stage <stage>] [--format json]
pp analysis report
pp analysis portfolio [--project <path>] [--format json]
pp analysis drift [--project <path>]
```

---

## Troubleshooting workflows

### Auth and connectivity

```sh
pp auth profile list                              # what profiles exist
pp auth token --profile <name> --resource <url>   # test token acquisition
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
pp flow doctor <name> --env <alias> --since 7d
# → shows run stats, error rate, most common failure categories

pp flow errors <name> --env <alias> --group-by connectionReference
# → if connref issues: which references are broken

pp flow runs <name> --env <alias> --since 24h
# → individual run status for recent window

pp flow connrefs <name> --env <alias> --solution <name>
# → what connection references this flow binds to
```

### Broken deploy

```sh
pp deploy plan --stage <stage> --format json
# → shows what would be applied; look for unresolved params or missing bindings

pp connref validate --env <alias> --solution <name>
# → which connection references are unbound

pp envvar list --env <alias>
# → which environment variables have no value set

pp project inspect --stage <stage> --format json
# → confirms which env + solution the stage resolves to
```

### Schema drift between environments

```sh
pp dv metadata snapshot --env dev --out ./dev-snapshot.json
pp dv metadata diff --env prod --file ./dev-snapshot.json
# → what tables/columns exist in dev but not prod

pp solution compare <uniqueName> --source-env dev --target-env prod
# → solution-level component diff
```

### Parameter resolution failures

Run `pp project inspect --stage <stage> --format json` and look at the
`parameters` section. Each parameter shows its resolved value and which
resolution path was used (value, fromEnv, secretRef). If a required parameter
has no value, it appears as unresolved with the missing source.

Check `pp analysis context --format json` for provider binding health — a
binding to a misconfigured or missing env alias shows as a diagnostic.

---

## Mutation discipline

`pp` marks every mutation-capable command. The pattern is consistent:

- `--plan` / `--dry-run` — preflight check, shows what would change, no side effects
- `--yes` — applies without an interactive prompt
- no flag — interactive prompt (only in terminal; fails in non-interactive contexts)

The `--plan` output includes `suggestedNextActions`, `knownLimitations`, and
`provenance`. Read them. A clean preflight does not guarantee a clean apply, but
it catches parameter resolution failures, missing connection references, and
authorization gaps before they cause partial state.

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

When you fall back, classify why. The category matters because it determines
what to try next:

- **pp gap** — not yet in `pp`; try `pac` or file an issue
- **platform limitation** — no API exists; browser handoff or manual step is correct
- **auth/runtime issue** — token, session, or environment setup problem; fix the auth
- **user config issue** — bad alias, missing asset, malformed pp.config.yaml; fix the config

Fallback order: `pp` alternative → `pac` (for admin/ALM gaps) → browser automation → manual handoff.

---

## Stability tiers

Affects how much you trust a command's output and whether to have a recovery plan.

**Stable** — auth, env aliases, Dataverse reads/writes/metadata, solution lifecycle,
project init/doctor/inspect, analysis, deploy orchestration, CLI output contract.

**Preview** — canvas offline validate/build/patch, flow local artifact operations,
flow remote export/promote, model-driven app inspection, CI adapter wrappers.

**Experimental** — canvas remote create/import, flow runtime correlation, broad MCP
automation, third-party extensions.

Preview and experimental commands are real but may return partial results or
change behavior. Always inspect output before acting on it.

---

## References

- [`references/schemas.md`](references/schemas.md) — spec file formats for metadata authoring, rows, flows, deploy manifests
- [`references/project-config.md`](references/project-config.md) — pp.config.yaml schema and parameter resolution
