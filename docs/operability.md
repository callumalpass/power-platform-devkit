# Operability

This guide covers installation, command discovery, diagnostics, packaging, and
guidance for working with `pp` in larger repos and CI environments. For
day-to-day product use, start with [quickstart.md](quickstart.md) instead.

## Installing and building from source

Clone the repo and install dependencies. In a normal checkout, `pnpm install`
prepares the CLI bundle automatically. If install scripts are disabled in your
environment, run `pnpm --filter @pp/cli build` before using the CLI.

```bash
pnpm install
node packages/cli/dist/index.cjs version
```

To produce a publishable tarball from the workspace, use the `pack:cli` script,
which builds `@pp/cli` and creates an npm package tarball from `packages/cli/`.

```bash
pnpm pack:cli
```

The repo is still source-first operationally. For orientation on package roles
and maturity, pair this guide with [architecture.md](architecture.md) and
[supported-surfaces.md](supported-surfaces.md).

For development, the quickest way to run `pp` from source is through one of
these entrypoints. `pnpm pp` is best for interactive work, while
`run-pp-dev.mjs` produces clean machine-readable stdout suitable for agents and
CI jobs.

```bash
pnpm pp -- version
node scripts/run-pp-dev.mjs version
node packages/cli/dist/index.cjs version
```

## Discovering commands

The built-in help surface is the best way to explore what `pp` can do.

```bash
pp --help
pp diagnostics --help
pp version --format raw
```

Shell completion makes command discovery faster in daily use. Generate a
completion script for your shell and source it.

```bash
pp completion zsh > ~/.zfunc/_pp
autoload -U compinit && compinit
```

Bash and fish are also supported through `pp completion bash` and
`pp completion fish`. The generated scripts cover the implemented top-level
command surface plus the next subcommand layer, so you can tab-complete your way
through workflows without memorizing the whole tree.

## Diagnostics and support bundles

Use `diagnostics doctor` when you want to check whether your install and local
repo state are coherent. It summarizes CLI version, config paths, and any issues
it finds.

```bash
pp diagnostics doctor
pp diagnostics doctor ./repo --format table
```

Use `diagnostics bundle` when you need a structured snapshot for support triage
or CI artifacts. The bundle includes the CLI version and package location,
Node and platform metadata, global config and MSAL cache paths, project
discovery state for the inspected path, and any unresolved project diagnostics
when a local `pp.config.*` file is present.

```bash
pp diagnostics bundle --format json > pp-diagnostics.json
pp diagnostics bundle ./repo --config-dir ./.tmp/pp-config --format yaml
```

## Working with larger repos

`pp` separates local-only workflows from remote Dataverse operations, and that
separation becomes especially useful in larger repos. Use `--workspace` for
canvas workspace resolution and `--registry` for explicit registry inputs so
you do not rely on ad-hoc path guessing. Keep canvas template registries
explicit through committed files or `cache:NAME` references rather than
ambient machine state. When debugging failures, capture `pp diagnostics bundle`
output before and after the failing workflow so config drift and discovery
changes are visible in the artifacts.

## CI and agent use

For CI pipelines and agent-driven workflows, prefer machine-readable output
with `--format json`, `--format yaml`, or `--format ndjson`. Persist
`pp diagnostics bundle` output as a build artifact when a job fails, and
include `pp version` in logs so support reports can tie behavior to a concrete
CLI build.

## Related docs

- [quickstart.md](quickstart.md) for first-run setup
- [testing.md](testing.md) for contributor validation lanes
