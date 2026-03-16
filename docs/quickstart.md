# Quickstart

This guide walks you through your first working session with `pp`, starting from a repo checkout. By the end you will have a working CLI build, a saved auth profile, an environment alias, and proof that Dataverse access works.

## Before you start

You will need three things: a clone of the `pp` repo, access to a Dataverse environment URL, and permission to sign in to that environment.

The commands below use `pp` for brevity. When running from source, replace `pp` with one of these invocations:

```bash
pnpm pp -- <command>
node scripts/run-pp-dev.mjs <command>
```

Use `pnpm pp -- ...` for interactive work. Use `node scripts/run-pp-dev.mjs ...` when you need clean machine-readable stdout.

## 1. Build the CLI

Start by installing dependencies, building the workspace, and running the tests:

```bash
pnpm install
pnpm build
pnpm test
```

Then verify that the CLI itself runs and can report its own health:

```bash
pp version --format raw
pp diagnostics doctor
```

If install scripts are disabled in your environment, you can build just the CLI package directly:

```bash
pnpm --filter @pp/cli build
```

## 2. Sign in and save a profile

Create a reusable auth profile so you do not have to re-authenticate on every command. The `--resource` flag tells `pp` which Dataverse environment to target, and `pp` derives the appropriate delegated scope from that URL:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
```

If you need to force a fresh browser prompt or use device-code flow (useful in headless environments), pass the corresponding flag:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com --force-prompt
pp auth login --name build-user --resource https://example.crm.dynamics.com --device-code
```

Confirm that the profile was saved and looks correct:

```bash
pp auth profile list
pp auth profile inspect dev-user
```

## 3. Register an environment alias

Environment aliases let you refer to a Dataverse environment by a short local name instead of repeating the full URL. Bind one to the profile you just created:

```bash
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
pp env inspect dev
pp env list
```

After this, most remote commands accept `--env dev` in place of the full URL.

## 4. Prove Dataverse access works

Run a few read-only queries to confirm that authentication, alias resolution, and the Dataverse client are all wired up correctly:

```bash
pp dv whoami --env dev
pp dv query accounts --env dev --select name,accountnumber --top 5
pp dv metadata tables --env dev --select LogicalName,SchemaName --top 10
```

To fetch a single record by ID:

```bash
pp dv get accounts 00000000-0000-0000-0000-000000000001 --env dev --select name
```

If these commands succeed, the core moving parts are working: token acquisition, environment alias resolution, Dataverse client resolution, and basic command output handling.

## 5. Inspect or create a solution

Solution commands are another well-established part of the CLI, so they make a good next test. List what is already in the environment, then inspect one:

```bash
pp solution list --env dev
pp solution inspect Core --env dev
```

If you need to create a test solution to work with:

```bash
pp solution create Core --env dev --friendly-name "Core" --publisher-unique-name DefaultPublisher
pp solution inspect Core --env dev
```

Exporting a solution is a useful check that packaging paths are wired correctly. The `--plan` flag shows what the export will contain before writing the file:

```bash
pp solution export Core --env dev --out ./artifacts/solutions/Core.zip --plan
```

## 6. Use isolated config for tests or CI

For CI pipelines, smoke tests, or sandboxed runs, you can point auth and environment commands at a custom config directory so they do not touch your global configuration:

```bash
pp auth profile list --config-dir ./.tmp/pp-config
pp env list --config-dir ./.tmp/pp-config
```

By default, `pp` stores its configuration at these locations:

```text
Windows: %APPDATA%\pp\config.json
macOS/Linux: ~/.config/pp/config.json
```

## Where to go next

Choose the guide that matches the work you need to do:

- [Auth and environments](auth-and-environments.md): more auth profile types, browser profiles, and config isolation
- [Dataverse and solutions](dataverse-and-solutions.md): broader Dataverse and solution command coverage
- [Canvas](canvas.md): offline canvas validation, build, and registry management
- [Flow](flow.md): flow artifact lifecycle and remote inspection
- [Model-driven apps](model.md): model app inspection
- [Supported surfaces](supported-surfaces.md): what to use first and what is still incomplete
