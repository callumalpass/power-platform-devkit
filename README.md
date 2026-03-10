# pp

`pp` is a Power Platform engineering toolkit built as a TypeScript monorepo.
It is aimed at agent, operator, and contributor workflows that need a repo-local
project model, explicit command contracts, and automation surfaces that are
more scriptable than the Maker UI alone.

The repository is organized as small workspace packages rather than one large
application. The CLI is the main entrypoint today, but the same packages also
power local analysis, deploy planning/apply, CI adapters, canvas tooling, and
an MCP surface.

## Current scope

Implemented today:

- auth profiles for browser user login, device code, environment tokens, client secret, and static tokens
- named browser profiles for isolated interactive auth contexts
- environment aliases that bind a Dataverse URL to an auth profile
- Dataverse commands: `whoami`, generic Web API requests, query/get, create/update/delete, normalized metadata inspection, metadata create for phase 1/2 plus a phase-3 slice (`autonumber`, `file`, `image`, many-to-many, customer relationships, option-set updates)
- solution commands: `list`, `inspect`
- project discovery from `pp.config.json|yaml|yml`
- project scaffolding with `project init` and layout validation with `project doctor`
- stage-aware project topology, solution alias resolution, and secret-backed parameter resolution
- analysis outputs for agent context and markdown reports
- deploy-plan generation plus the first shared `deploy apply` orchestration slice for Dataverse environment variable mappings
- thin CI/CD adapters and repo-local runner scripts for GitHub Actions, Azure DevOps, and Power Platform Pipelines
- a typed extension contract and registry for provider, analysis, deploy-adapter, CLI, and MCP contributions
- read-only live smoke coverage through `pnpm smoke:live`

Preview or intentionally bounded:

- remote canvas download now works for solution-scoped apps via Dataverse solution export, while remote canvas create/import still fall back to a Maker handoff or explicit not-yet-implemented diagnostics
- flow deploy/promotion is intentionally bounded to the current normalized artifact contract, not the full cloud-flow lifecycle
- SharePoint and Power BI currently expose targeted inspection and deploy-adjacent workflows, not full authoring surfaces
- broader distribution, packaging, and marketplace-style extension delivery remain early

## Documentation map

Start with the path that matches your role:

- new user: [docs/quickstart.md](docs/quickstart.md)
- operator or CI owner: [docs/operability.md](docs/operability.md)
- project author: [docs/project-config.md](docs/project-config.md)
- Dataverse and solution workflows: [docs/dataverse-and-solutions.md](docs/dataverse-and-solutions.md)
- canvas workflows: [docs/canvas.md](docs/canvas.md)
- flow workflows: [docs/flow.md](docs/flow.md)
- model-driven inspection and bounded create/attach authoring: [docs/model.md](docs/model.md)
- auth and environment setup: [docs/auth-and-environments.md](docs/auth-and-environments.md)
- deploy planning and apply: [docs/deploy.md](docs/deploy.md)
- support tiers and product boundaries: [docs/supported-surfaces.md](docs/supported-surfaces.md)
- package and architecture layout: [docs/architecture.md](docs/architecture.md)
- agent skill packaging: [docs/skills.md](docs/skills.md)
- full documentation index: [docs/README.md](docs/README.md)

## Workspace layout

- infrastructure: `auth`, `http`, `diagnostics`, `cache`, `config`
- local context: `project`
- domains: `dataverse`, `solution`, `model`, `canvas`, `flow`, `artifacts`, `sharepoint`, `powerbi`
- application: `analysis`, `deploy`
- extensibility: `extensions`
- interfaces: `cli`, `mcp`
- adapters: `github-actions`, `azure-devops`, `power-platform-pipelines`

The package-level responsibilities and data flow are described in
[docs/architecture.md](docs/architecture.md).

## Running the CLI

There are three practical ways to run commands:

1. From source during development:

```bash
pnpm pp -- project inspect
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

The examples below use `pp` for brevity. When working directly from the repo,
replace `pp` with either `pnpm pp --` or
`node packages/cli/dist/index.js`.

For packaging and operator workflows:

```bash
pnpm pack:cli
pp version --format raw
pp completion zsh > ~/.zfunc/_pp
pp diagnostics doctor
pp diagnostics bundle --format json > pp-diagnostics.json
```

## Quickstart

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

### 4. Query Dataverse and solutions

```bash
pp dv whoami --env dev
pp dv query accounts --env dev --select name,accountnumber --top 10
pp dv get accounts 00000000-0000-0000-0000-000000000001 --env dev --select name
pp dv request --env dev --path "EntityDefinitions?\$select=LogicalName,SchemaName"
pp dv rows export accounts --env dev --select accountid,name --all --out ./artifacts/accounts.yaml
pp dv rows apply --env dev --file ./specs/account-ops.yaml --solution Core
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
pp solution create Core --env dev --friendly-name "Core" --publisher-unique-name DefaultPublisher
pp solution list --env dev
pp solution inspect Core --env dev
pp solution export Core --env dev --out ./artifacts/solutions/Core.zip --plan
pp solution set-metadata Core --env dev --version 1.2.3.4 --publisher-unique-name DefaultPublisher
```

Metadata create commands consume JSON or YAML spec files rather than raw Dataverse metadata JSON. Publish is on by default; use `--no-publish` when you want to stage changes without publishing.
`pp dv rows export` packages a query slice into a stable row-set artifact, and `pp dv rows apply` consumes a typed manifest for bounded create/update/upsert/delete batches without hand-authoring raw `$batch` payloads.
The solution lifecycle surface now also covers create/delete, source-vs-target
compare, pack/unpack, export/import, and solution-scoped component analysis.

### 5. Add a local project config

Create a `pp.config.yaml` in your repo root, or let `pp` scaffold one:

```bash
pp project init --name demo --env dev --solution Core
pp project doctor
pp project feedback
```

The scaffold is intentionally lightweight. It creates:

- `pp.config.yaml`
- `apps/`
- `flows/`
- `solutions/`
- `docs/`
- `artifacts/solutions/`

`pp project init --plan --format markdown` now renders the scaffold shape,
including the recommended packaged solution output path under
`artifacts/solutions/<Solution>.zip`, so you do not need to inspect the
filesystem to understand the source-vs-artifact split.

If you prefer to create the config manually, start with:

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

From there, move into the domain docs rather than relying on `--help` alone:

- [docs/dataverse-and-solutions.md](docs/dataverse-and-solutions.md)
- [docs/canvas.md](docs/canvas.md)
- [docs/flow.md](docs/flow.md)
- [docs/model.md](docs/model.md)
- [docs/deploy.md](docs/deploy.md)

## Auth and environments

Global config is stored in `~/.config/pp/config.json` by default. Use `--config-dir` on auth and environment commands when you want an isolated config store for testing or automation.

Examples:

```bash
pp auth profile list
pp auth profile inspect dev-user
pp auth profile inspect --env dev
pp auth token --profile dev-user --resource https://example.crm.dynamics.com
pp env list
```

When you inspect a profile through `--env`, the JSON output includes the
resolved environment URL, the actual target resource for that environment, and
a boolean that tells you whether the profile's stored home resource still
matches that environment.

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

## Architecture and extensions

The repo now includes [`@pp/extensions`](/home/calluma/projects/pp/packages/extensions/src/index.ts), a narrow extension contract for:

- provider packages
- analysis modules
- deploy adapters
- CLI command registration
- MCP tool registration

Extensions declare compatibility, support tier, support model, and trust level up front. The registry enforces those rules during loading so repo-local and third-party additions participate in the same diagnostics and policy model as built-in capabilities.

More detail is in [docs/extensions.md](docs/extensions.md) and
[docs/architecture.md](docs/architecture.md).

## Local project, analysis, and deploy workflows

The `project`, `analysis`, and `deploy` commands work entirely from local repo state:

- `project init` scaffolds a minimal repo-local `pp` layout without imposing a heavy framework
- `project doctor` reports whether the current config, asset paths, topology, and required inputs form a coherent local project model
- `project inspect` summarizes assets, provider bindings, resolved parameters, and stage topology; machine-readable output now carries discovery hints and unresolved-input diagnostics in the stdout document itself
- `analysis report` emits a markdown report suitable for humans or agent handoff
- `analysis context` emits a JSON context pack with deploy-plan data included
- `analysis portfolio`, `analysis drift`, `analysis usage`, and `analysis policy` aggregate multiple project roots into governance-grade portfolio views for CI, dashboards, or recurring review
- `deploy plan` turns resolved project parameters, topology, and assets into a structured plan
- `deploy apply` runs the shared resolve/preflight/plan/apply/report path locally or through the CI adapter wrappers

The project config format and parameter resolution rules are documented in [docs/project-config.md](docs/project-config.md).
Deploy usage and CI examples are documented in [docs/deploy.md](docs/deploy.md).
Install/completion/diagnostics guidance is documented in [docs/operability.md](docs/operability.md).

## Contributor workflow

Normal contributor checks:

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Focused references:

- [docs/testing.md](docs/testing.md) for fixture-backed goldens and live smoke
- [docs/command-contract.md](docs/command-contract.md) for stdout/stderr and format rules
- [docs/safety-and-provenance.md](docs/safety-and-provenance.md) for mutation and artifact expectations

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
flow artifact mutation path, project analysis outputs, and representative CLI
workflows over those committed fixtures.

Run them directly:

```bash
pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/analysis/src/golden.test.ts packages/cli/src/integration.test.ts
```

Refresh the committed goldens deterministically:

```bash
PP_UPDATE_GOLDENS=1 pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/analysis/src/golden.test.ts packages/cli/src/integration.test.ts
```

The lane split is:

- fast/local CI: `pnpm test` and targeted fixture checks via the fixture command above
- scheduled or manual live validation: `pnpm smoke:live`

## Documentation

- [Documentation index](docs/README.md)
- [Command contract](docs/command-contract.md)
- [Quickstart](docs/quickstart.md)
- [Auth and environments](docs/auth-and-environments.md)
- [Project config](docs/project-config.md)
- [Dataverse and solutions](docs/dataverse-and-solutions.md)
- [Testing](docs/testing.md)

## Notes

- The current CLI surface is still preview-level in breadth even though the package layout is broader.
- The browser-auth path is implemented, but it still needs validation against a real tenant and Dataverse environment beyond local build and test coverage.
