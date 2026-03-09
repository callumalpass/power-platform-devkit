# pp

TypeScript monorepo for an agent-oriented Power Platform toolkit.

The repository is structured around small workspace packages rather than a single CLI application. The CLI currently exposes the first useful slice of that architecture: auth profile management, Dataverse environment aliases, Dataverse read operations, metadata authoring, solution inspection, project discovery, stage-aware topology inspection, analysis context generation, and deploy-plan generation.

## Current scope

Implemented today:

- auth profiles for browser user login, device code, environment tokens, client secret, and static tokens
- named browser profiles for isolated interactive auth contexts
- environment aliases that bind a Dataverse URL to an auth profile
- Dataverse commands: `whoami`, generic Web API requests, query/get, create/update/delete, normalized metadata inspection, metadata create for phase 1/2 plus a phase-3 slice (`autonumber`, `file`, `image`, many-to-many, customer relationships, option-set updates)
- solution commands: `list`, `inspect`
- project discovery from `pp.config.json|yaml|yml`
- stage-aware project topology, solution alias resolution, and secret-backed parameter resolution
- analysis outputs for agent context and markdown reports
- deploy-plan generation from local project state
- read-only live smoke coverage through `pnpm smoke:live`

Scaffolded but not yet implemented in depth:

- canvas compilation
- flow artifact handling
- SharePoint and Power BI provider logic
- CI/CD adapters

## Workspace layout

- infrastructure: `auth`, `http`, `diagnostics`, `cache`, `config`
- local context: `project`
- domains: `dataverse`, `solution`, `model`, `canvas`, `flow`, `artifacts`, `sharepoint`, `powerbi`
- application: `analysis`, `deploy`
- interfaces: `cli`, `mcp`
- adapters: `github-actions`, `azure-devops`, `power-platform-pipelines`

## Running the CLI

There are three practical ways to run commands:

1. From source during development:

```bash
pnpm --filter @pp/cli dev -- project inspect
```

2. From the built workspace:

```bash
pnpm build
node packages/cli/dist/index.js project inspect
```

3. As `pp` once the CLI package is linked or installed:

```bash
pp project inspect
```

The examples below use `pp` for brevity. When working directly from the repo, replace `pp` with either `pnpm --filter @pp/cli dev --` or `node packages/cli/dist/index.js`.

## Getting started

### 1. Install and build

```bash
pnpm install
pnpm build
pnpm test
```

### 2. Sign in with a user profile

Browser login is the default user flow:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
```

That creates or updates a named auth profile, tries silent token reuse if a cache already exists, and otherwise opens a browser for sign-in. If interactive sign-in fails, the profile can fall back to device code.

When you need isolated interactive sessions per customer or tenant:

```bash
pp auth browser-profile add --name tenant-a --kind edge
pp auth login --name dev-user --resource https://example.crm.dynamics.com --browser-profile tenant-a
```

### 3. Bind an environment alias

```bash
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
pp env inspect dev
```

### 4. Query Dataverse

```bash
pp dv whoami --env dev
pp dv query accounts --env dev --select name,accountnumber --top 10
pp dv get accounts 00000000-0000-0000-0000-000000000001 --env dev --select name
pp dv request --env dev --path "EntityDefinitions?\$select=LogicalName,SchemaName"
pp dv metadata tables --env dev --select LogicalName,SchemaName --top 10
pp dv metadata columns account --env dev --select LogicalName,SchemaName,AttributeType --top 10
pp dv metadata column account name --env dev --select LogicalName,SchemaName,AttributeType
pp dv metadata column account name --env dev --view raw
pp dv metadata option-set pp_projectstatus --env dev
pp dv metadata relationship pp_project_account --env dev
pp dv metadata create-table --env dev --file ./specs/project.table.yaml --solution Core
pp dv metadata add-column pp_project --env dev --file ./specs/client-code.column.yaml --solution Core
pp dv metadata create-option-set --env dev --file ./specs/status.optionset.yaml --solution Core
pp dv metadata update-option-set --env dev --file ./specs/status.update.yaml --solution Core
pp dv metadata create-relationship --env dev --file ./specs/project-account.relationship.yaml --solution Core
pp dv metadata create-many-to-many --env dev --file ./specs/project-contact.m2m.yaml --solution Core
pp dv metadata create-customer-relationship --env dev --file ./specs/project-customer.relationship.yaml --solution Core
pp solution list --env dev
```

Metadata create commands consume JSON or YAML spec files rather than raw Dataverse metadata JSON. Publish is on by default; use `--no-publish` when you want to stage changes without publishing.

### 5. Add a local project config

Create a `pp.config.yaml` in your repo root:

```yaml
name: demo
defaults:
  environment: dev
  solution: Core
assets:
  apps: apps
  flows: flows
providerBindings:
  primaryDataverse:
    kind: dataverse
    target: dev
parameters:
  tenantDomain:
    type: string
    fromEnv: PP_TENANT_DOMAIN
    required: true
  releaseName:
    type: string
    value: preview
```

Then inspect it:

```bash
pp project inspect
pp analysis report
pp analysis context --format json
pp deploy plan
```

## Auth and environments

Global config is stored in `~/.config/pp/config.json` by default. Use `--config-dir` on auth and environment commands when you want an isolated config store for testing or automation.

Examples:

```bash
pp auth profile list
pp auth profile inspect dev-user
pp auth token --profile dev-user --resource https://example.crm.dynamics.com
pp env list
```

Headless and automation-friendly profiles are also supported:

```bash
pp auth profile add-env --name dev-token --env-var PP_TOKEN --resource https://example.crm.dynamics.com
pp auth profile add-client-secret \
  --name build-sp \
  --tenant-id <tenant> \
  --client-id <client> \
  --secret-env PP_CLIENT_SECRET \
  --resource https://example.crm.dynamics.com
```

More detail is in [docs/auth-and-environments.md](docs/auth-and-environments.md).

## Project analysis

The `project`, `analysis`, and `deploy` commands work entirely from local repo state:

- `project inspect` summarizes assets, provider bindings, resolved parameters, and stage topology
- `analysis report` emits a markdown report suitable for humans or agent handoff
- `analysis context` emits a JSON context pack with deploy-plan data included
- `deploy plan` turns resolved project parameters, topology, and assets into a structured plan

The project config format and parameter resolution rules are documented in [docs/project-config.md](docs/project-config.md).

## Live smoke

Run the read-only live smoke path against the configured test-like environment alias and auth profile:

```bash
pnpm smoke:live
```

Override target selection when needed:

```bash
PP_SMOKE_ENV=test pnpm smoke:live
PP_SMOKE_PROFILE=test-user pnpm smoke:live
PP_CONFIG_DIR=./.tmp/pp-config pnpm smoke:live
```

## Fixture goldens

Fixture-backed golden tests now cover the first canvas artifact slice, the first
flow artifact mutation path, and project analysis outputs.

Run them directly:

```bash
pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/analysis/src/golden.test.ts
```

Refresh the committed goldens deterministically:

```bash
PP_UPDATE_GOLDENS=1 pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/analysis/src/golden.test.ts
```

## Documentation

- [Documentation index](docs/README.md)
- [Command contract](docs/command-contract.md)
- [Quickstart](docs/quickstart.md)
- [Auth and environments](docs/auth-and-environments.md)
- [Project config](docs/project-config.md)
- [Dataverse and solutions](docs/dataverse-and-solutions.md)

## Notes

- The current CLI surface is still preview-level in breadth even though the package layout is broader.
- The browser-auth path is implemented, but it still needs validation against a real tenant and Dataverse environment beyond local build and test coverage.
