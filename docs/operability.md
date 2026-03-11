# Operability

This guide covers installation, command discovery, diagnostics, packaging, and
large-repo usage for `pp`.

## Install and package

From source:

```bash
pnpm install
node packages/cli/dist/index.cjs version
```

`pnpm install` now prepares the CLI bundle automatically in a normal checkout.
If install scripts are disabled, run `pnpm --filter @pp/cli build` first.

Package the CLI as a tarball:

```bash
pnpm pack:cli
```

That builds `@pp/cli` and produces an npm package tarball from
`packages/cli/`.

The repo is still source-first operationally. For orientation on package roles
and maturity, pair this guide with [architecture.md](architecture.md) and
[supported-surfaces.md](supported-surfaces.md).

For development, the quickest direct entrypoints are:

```bash
pnpm pp -- project inspect
node scripts/run-pp-dev.mjs project inspect
node packages/cli/dist/index.cjs project inspect
```

Prefer `pnpm pp -- ...` at the repo root for interactive source-backed
workflows, or `node scripts/run-pp-dev.mjs ...` when an agent or CI job needs
clean machine-readable stdout. Both preserve the original invocation directory
for local project discovery, so `project inspect` and `project doctor` do not
silently re-root to `packages/cli`.

## Command discovery

Use the built-in help surface first:

```bash
pp --help
pp project --help
pp diagnostics --help
pp version --format raw
```

Install shell completion:

```bash
pp completion zsh > ~/.zfunc/_pp
autoload -U compinit && compinit
```

Other supported shells:

```bash
pp completion bash
pp completion fish
```

The generated completion scripts cover the implemented top-level command surface
plus the next subcommand layer so operators and agents can discover workflows
without memorizing the whole tree.

## Diagnostics and support bundles

Use `diagnostics doctor` when the question is "is this install or repo state
coherent?".

```bash
pp diagnostics doctor
pp diagnostics doctor ./repo --format table
```

Use `diagnostics bundle` when you need a support artifact or CI snapshot.

```bash
pp diagnostics bundle --format json > pp-diagnostics.json
pp diagnostics bundle ./repo --config-dir ./.tmp/pp-config --format yaml
```

The bundle includes:

- CLI version and package location
- Node/runtime platform metadata
- global config and MSAL cache paths
- project discovery state for the inspected path
- unresolved project diagnostics when a local `pp.config.*` is present

## Large-workspace guidance

`pp` already separates local-only workflows from remote Dataverse operations.
For larger repos and environments, prefer that boundary explicitly:

- run `pp project inspect`, `pp project doctor`, `pp analysis context`, and
  `pp deploy plan` from the repo root before live environment commands
- use `--project`, `--workspace`, and stage/parameter overrides to avoid
  ad-hoc path guessing in large monorepos
- keep canvas template registries explicit through committed files or
  `cache:NAME` references rather than relying on ambient machine state
- capture `pp diagnostics bundle` output before and after a failing workflow so
  config drift and discovery changes are visible in artifacts

## CI and agent use

For CI or agent-driven flows:

- prefer machine-readable output with `--format json|yaml|ndjson`
- persist `pp diagnostics bundle` output as a build artifact when a job fails
- use `pp version` in logs so support reports can tie behavior to a concrete
  CLI build

## Repo docs to keep nearby

- [quickstart.md](quickstart.md) for first-run setup
- [project-config.md](project-config.md) for local project topology and parameters
- [deploy.md](deploy.md) for deploy contracts and adapter behavior
- [testing.md](testing.md) for contributor validation lanes
