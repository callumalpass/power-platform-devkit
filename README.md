# pp

A focused Power Platform CLI for authenticated Dataverse access, solution
lifecycle, and local canvas and flow tooling.

## What it does

- **auth** — browser login, device code, environment tokens, client secret,
  and static token profiles with isolated browser contexts
- **env** — named Dataverse environment aliases binding a URL to an auth profile
- **dv** — Dataverse Web API: whoami, query, get, create, update, delete,
  batch, metadata inspection and mutation
- **solution** — list, inspect, create, delete, export, import, publish,
  pack/unpack, analyze, compare
- **canvas** — local validation, linting, building, inspection, diffing, and
  harvesting of canvas source trees
- **flow** — local validation, linting, inspection, and normalization of flow
  artifacts
- **mcp** — stdio MCP server exposing the same capabilities to AI agents

## Getting started

```bash
pnpm install && pnpm build && pnpm test
```

### 1. Sign in

```bash
pp auth profile add-user --name work
pp auth login --name work --resource https://contoso.crm.dynamics.com
```

### 2. Register an environment

```bash
pp env add dev --url https://contoso.crm.dynamics.com --profile work
```

### 3. Use it

```bash
pp dv whoami --env dev
pp solution list --env dev
pp solution inspect Core --env dev
pp solution export Core --env dev --out .pp/solutions/Core.zip
pp canvas validate ./apps/MyCanvas
pp canvas build ./apps/MyCanvas --out ./dist/MyCanvas.msapp
pp flow validate ./flows/invoice/flow.json
```

## Local defaults

Create a `pp.config.yaml` in your repo root for convenience defaults:

```yaml
defaults:
  environment: dev
  solution: Core
artifacts:
  solutions: .pp/solutions
```

When `--environment` is omitted, `pp` walks up from the current directory to
find `pp.config.yaml` and uses `defaults.environment`. The resolution chain is:

    explicit flag → config defaults → environment alias → auth profile → token

## Running from source

```bash
pnpm pp -- dv whoami --env dev          # interactive use
node scripts/run-pp-dev.mjs dv whoami   # clean stdout (no pnpm banners)
```

## Output formats

All commands support `--format table|json|yaml|ndjson|markdown|raw`.
Mutation commands support `--dry-run` and `--plan` for preview.

## MCP server

```bash
pp mcp serve
```

The MCP server exposes tools matching the CLI command set: auth, environment,
dataverse, solution, canvas, and flow operations. Connect it to any
MCP-compatible agent.

## Workspace packages

- infrastructure: `auth`, `http`, `diagnostics`, `config`, `cache`, `artifacts`
- domains: `dataverse`, `solution`, `model`, `canvas`, `flow`
- interfaces: `cli`, `mcp`

## Tests

```bash
pnpm test                           # full suite
pnpm vitest run packages/cli/src    # CLI integration tests only
PP_UPDATE_GOLDENS=1 pnpm test       # refresh golden snapshots
```

## Shell completion

```bash
pp completion bash > ~/.local/share/bash-completion/completions/pp
pp completion zsh > ~/.zfunc/_pp
pp completion fish > ~/.config/fish/completions/pp.fish
```
