# Quickstart

This guide is for the first successful use of `pp` from a repo checkout.

By the end, you should have:

- a working CLI build
- a saved auth profile
- an environment alias
- proof that Dataverse access works
- a minimal `pp.config.yaml`

This quickstart uses the implemented, most reliable core of `pp`: auth,
environment aliases, Dataverse inspection, solution inspection, and local
project modeling.

## Before you start

This quickstart assumes:

- you are running from the `pp` repo source
- you have access to a Dataverse environment URL
- you have permission to sign in to that environment

The commands below use `pp` for brevity. When running from source, use either:

```bash
pnpm pp -- <command>
node scripts/run-pp-dev.mjs <command>
```

Use `pnpm pp -- ...` for interactive work. Use `node scripts/run-pp-dev.mjs ...`
when you need clean machine-readable stdout.

## 1. Build the CLI

```bash
pnpm install
pnpm build
pnpm test
```

Sanity-check the CLI:

```bash
pp version --format raw
pp diagnostics doctor
```

If install scripts are disabled in your environment, run:

```bash
pnpm --filter @pp/cli build
```

## 2. Sign in once and save the profile

Create a reusable auth profile:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
```

For normal Dataverse usage, prefer `--resource`. `pp` derives the usual
Dataverse delegated scope from that URL.

Common variants:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com --force-prompt
pp auth login --name build-user --resource https://example.crm.dynamics.com --device-code
```

Check that the profile is saved:

```bash
pp auth profile list
pp auth profile inspect dev-user
```

## 3. Register an environment alias

Bind a short local alias to the environment URL and auth profile:

```bash
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
pp env inspect dev
pp env list
```

After this, most remote commands use `--env dev` instead of repeating the full
Dataverse URL.

## 4. Prove Dataverse access works

Start with the safest read path:

```bash
pp dv whoami --env dev
pp dv query accounts --env dev --select name,accountnumber --top 5
pp dv metadata tables --env dev --select LogicalName,SchemaName --top 10
```

If you want one record-level example:

```bash
pp dv get accounts 00000000-0000-0000-0000-000000000001 --env dev --select name
```

If these succeed, the most important moving parts are already working:

- auth token acquisition
- environment alias resolution
- Dataverse client resolution
- basic command output handling

## 5. Inspect or create a solution

Use solution commands next, because they are another mature core workflow:

```bash
pp solution list --env dev
pp solution inspect Core --env dev
```

If you need to create a test solution:

```bash
pp solution create Core --env dev --friendly-name "Core" --publisher-unique-name DefaultPublisher
pp solution inspect Core --env dev
```

Export is a useful proof that packaging paths are wired correctly:

```bash
pp solution export Core --env dev --out ./artifacts/solutions/Core.zip --plan
```

## 6. Initialize a local `pp` project

The fastest path is:

```bash
pp project init --name demo --env dev --solution Core
pp project doctor
pp project inspect
```

That gives you a minimal `pp.config.yaml` plus the default local folders:

- `apps/`
- `flows/`
- `solutions/`
- `docs/`

If you prefer to start by hand, the smallest useful config is:

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
```

Useful follow-up commands:

```bash
pp project doctor
pp project feedback
pp project inspect
pp analysis report
pp deploy plan
```

## 7. Use isolated config for tests or CI

For CI, smoke tests, or sandboxed runs, point auth and env commands at a custom
config directory:

```bash
pp auth profile list --config-dir ./.tmp/pp-config
pp env list --config-dir ./.tmp/pp-config
```

Default global config locations:

```text
Windows: %APPDATA%\pp\config.json
macOS/Linux: ~/.config/pp/config.json
```

## Where to go next

Choose the next guide based on the job you actually need to do:

- [Auth and environments](auth-and-environments.md): more auth profile types,
  browser profiles, and config isolation
- [Dataverse and solutions](dataverse-and-solutions.md): broader Dataverse and
  solution command coverage
- [Project config](project-config.md): stages, parameters, provider bindings,
  and project topology
- [Deploy](deploy.md): preview and apply supported deployment operations
- [Supported surfaces](supported-surfaces.md): what to use first and what is
  still incomplete
