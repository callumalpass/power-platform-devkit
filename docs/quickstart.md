# Quickstart

This quickstart assumes you are working from the repo source rather than a globally installed CLI.

## 1. Install and build

```bash
pnpm install
pnpm build
pnpm test
```

For local development, run commands through the CLI package:

```bash
pnpm --filter @pp/cli dev -- project doctor
```

Once built, you can also call the CLI directly:

```bash
node packages/cli/dist/index.js project doctor
```

Sanity-check the packaged CLI surface:

```bash
pp version --format raw
pp diagnostics doctor
```

The examples below use `pp` for brevity.

If you are new to the repo, read [architecture.md](architecture.md) after this
quickstart and [supported-surfaces.md](supported-surfaces.md) before adopting a
workflow that looks preview or experimental.

## 2. Sign in

Create a reusable named auth profile with browser login:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
```

Useful variants:

- force account selection again:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com --force-prompt
```

- prefer device code:

```bash
pp auth login --name build-user --resource https://example.crm.dynamics.com --device-code
```

## 3. Register an environment alias

```bash
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
pp env inspect dev
pp env list
```

The alias is what the Dataverse and solution commands use. You do not need to repeat the full environment URL on every command after this.

## 4. Call Dataverse

```bash
pp dv whoami --env dev
pp dv query accounts --env dev --select name,accountnumber --top 5
pp dv get accounts 00000000-0000-0000-0000-000000000001 --env dev --select name
pp dv metadata tables --env dev --select LogicalName,SchemaName --top 10
pp dv metadata columns account --env dev --select LogicalName,SchemaName,AttributeType --top 10
pp dv metadata column account name --env dev
```

For metadata listing, `--top` is applied locally after retrieval because Dataverse metadata endpoints do not support server-side `$top`.

You can also create supported schema metadata from YAML or JSON specs:

```bash
pp dv metadata create-table --env dev --file ./specs/project.table.yaml --solution Core
pp dv metadata add-column pp_project --env dev --file ./specs/client-code.column.yaml --solution Core
```

## 5. Inspect solutions

```bash
pp solution create Core --env dev --friendly-name "Core" --publisher-unique-name DefaultPublisher
pp solution list --env dev
pp solution inspect Core --env dev
pp solution export Core --env dev --out ./artifacts/solutions/Core.zip --plan
pp solution set-metadata Core --env dev --version 1.2.3.4 --publisher-unique-name DefaultPublisher
```

## 6. Add a project config

Fastest path:

```bash
pp project init --name demo --env dev --solution Core
pp project doctor
pp project feedback
```

That creates a minimal `pp.config.yaml` plus the default local folders:
`apps/`, `flows/`, `solutions/`, and `docs/`.

If you want to start by hand, create `pp.config.yaml`:

```yaml
name: demo
defaults:
  environment: dev
  solution: Core
assets:
  apps: apps
  flows: flows
  solutions: solutions
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

Then inspect the local repo context:

```bash
pp project doctor
pp project feedback
pp project inspect
pp analysis report
pp analysis context --format json
pp deploy plan
```

Deeper workflow docs:

- [auth-and-environments.md](auth-and-environments.md)
- [dataverse-and-solutions.md](dataverse-and-solutions.md)
- [canvas.md](canvas.md)
- [flow.md](flow.md)
- [deploy.md](deploy.md)

## 7. Use isolated config when needed

For tests or CI, point auth and env commands at a custom config directory:

```bash
pp auth profile list --config-dir ./.tmp/pp-config
pp env list --config-dir ./.tmp/pp-config
```

By default, global config lives under `~/.config/pp/config.json`.
