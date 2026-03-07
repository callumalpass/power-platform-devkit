# pp

TypeScript monorepo for an agent-oriented Power Platform toolkit.

The repository is structured around small workspace packages rather than a single CLI application. The CLI currently exposes the first useful slice of that architecture: auth profile management, Dataverse environment aliases, Dataverse read operations, solution inspection, project discovery, analysis context generation, and deploy-plan generation.

## Current scope

Implemented today:

- auth profiles for browser user login, device code, environment tokens, client secret, and static tokens
- environment aliases that bind a Dataverse URL to an auth profile
- Dataverse commands: `whoami`, `query`, `get`
- solution commands: `list`, `inspect`
- project discovery from `pp.config.json|yaml|yml`
- analysis outputs for agent context and markdown reports
- deploy-plan generation from local project state

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
pp solution list --env dev
```

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

- `project inspect` summarizes assets, provider bindings, and resolved parameters
- `analysis report` emits a markdown report suitable for humans or agent handoff
- `analysis context` emits a JSON context pack with deploy-plan data included
- `deploy plan` turns resolved project parameters and assets into a structured plan

The project config format and parameter resolution rules are documented in [docs/project-config.md](docs/project-config.md).

## Documentation

- [Documentation index](docs/README.md)
- [Quickstart](docs/quickstart.md)
- [Auth and environments](docs/auth-and-environments.md)
- [Project config](docs/project-config.md)
- [Dataverse and solutions](docs/dataverse-and-solutions.md)

## Notes

- The current CLI surface is still preview-level in breadth even though the package layout is broader.
- The browser-auth path is implemented, but it still needs validation against a real tenant and Dataverse environment beyond local build and test coverage.
