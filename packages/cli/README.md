# `@pp/cli`

Power Platform CLI package for the `pp` command.

This package is the main user-facing entrypoint into the monorepo, but it is
not the whole product by itself. Most command behavior is delegated into
workspace packages such as `@pp/project`, `@pp/dataverse`, `@pp/solution`,
`@pp/flow`, `@pp/canvas`, and `@pp/deploy`.

## Install

From the monorepo:

```bash
pnpm install
pnpm --filter @pp/cli build
node packages/cli/dist/index.cjs version
```

To produce a publishable tarball from the workspace:

```bash
pnpm --filter @pp/cli build
pnpm --filter @pp/cli pack
```

## Shell completion

```bash
pp completion zsh > ~/.zfunc/_pp
autoload -U compinit && compinit
```

Supported shells: `bash`, `zsh`, `fish`.

## Diagnostics

```bash
pp diagnostics doctor
pp diagnostics bundle --format json > pp-diagnostics.json
```

`diagnostics doctor` summarizes install, config, and local project findings.
`diagnostics bundle` emits a structured snapshot that is suitable for CI
artifacts or support triage.

## Commands

Start with:

```bash
pp --help
pp project --help
pp diagnostics --help
```

Repo-level documentation lives under [`docs/`](/home/calluma/projects/pp/docs/README.md).

Recommended docs:

- [`docs/quickstart.md`](/home/calluma/projects/pp/docs/quickstart.md)
- [`docs/architecture.md`](/home/calluma/projects/pp/docs/architecture.md)
- [`docs/supported-surfaces.md`](/home/calluma/projects/pp/docs/supported-surfaces.md)
- [`docs/operability.md`](/home/calluma/projects/pp/docs/operability.md)
