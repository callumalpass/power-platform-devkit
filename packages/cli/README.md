# `@pp/cli`

This is the Power Platform CLI package for the `pp` command. It is the main
user-facing entrypoint into the monorepo, but most command behavior is
delegated to workspace packages like `@pp/dataverse`, `@pp/solution`,
`@pp/flow`, `@pp/canvas`, and `@pp/model`.

## Install

From the monorepo, install dependencies and the CLI bundle will be prepared
automatically. If your checkout skips install scripts, build the CLI package
first.

```bash
pnpm install
node packages/cli/dist/index.cjs version
```

To produce a publishable tarball from the workspace:

```bash
pnpm --filter @pp/cli build
pnpm --filter @pp/cli pack
```

## Shell completion

Generate a completion script for your shell so you can tab-complete commands.

```bash
pp completion zsh > ~/.zfunc/_pp
autoload -U compinit && compinit
```

Bash and fish are also supported through `pp completion bash` and
`pp completion fish`.

## Diagnostics

`diagnostics doctor` checks whether your install, config, and local project
state are coherent. `diagnostics bundle` emits a structured snapshot suitable
for CI artifacts or support triage.

```bash
pp diagnostics doctor
pp diagnostics bundle --format json > pp-diagnostics.json
```

## MCP

Run the stdio MCP server through the main CLI entrypoint. This is the preferred
host command for packaged installs because the MCP client can start `pp` on
demand instead of requiring a separate long-running service.

```bash
pp mcp serve
```

## Commands

Use `pp --help` and `pp diagnostics --help` to discover the available command
surface. Repo-level documentation lives under
[`docs/`](/home/calluma/projects/pp/docs/README.md), starting with the
[quickstart](../../docs/quickstart.md).
