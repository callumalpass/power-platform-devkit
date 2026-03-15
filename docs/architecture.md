# Architecture

This guide is for contributors who need to understand where behavior belongs in
the repo. It is not the best starting point for learning how to use `pp`.

If you are trying to get work done with the CLI, start with:

- [quickstart.md](quickstart.md)
- [dataverse-and-solutions.md](dataverse-and-solutions.md)
- [project-config.md](project-config.md)
- [deploy.md](deploy.md)

## Mental model

`pp` is a package-first monorepo. The CLI is the main shipped interface, but
most behavior lives in narrower workspace packages with explicit contracts.

The practical layers are:

1. core infrastructure and shared contracts
2. domain packages for Power Platform and adjacent providers
3. local project analysis and deploy orchestration
4. interface layers such as the CLI, MCP server, and CI adapters

That split matters because most user-facing commands are compositions of the
same underlying services.

## Package map

Core packages:

- `@pp/auth`: auth profiles, browser-profile management, token acquisition
- `@pp/config`: persisted config for auth profiles and environment aliases
- `@pp/diagnostics`: `OperationResult`, diagnostics, and failure helpers
- `@pp/http`: shared HTTP helpers
- `@pp/artifacts`: stable JSON and YAML artifact IO

Project and orchestration packages:

- `@pp/project`: `pp.config.*` discovery, init, doctor, topology, parameters,
  and provider bindings
- `@pp/analysis`: human and machine-readable project analysis
- `@pp/deploy`: deploy plan/apply/release orchestration
- `@pp/extensions`: extension manifest, registry, compatibility, and trust
  policy

Primary domain packages:

- `@pp/dataverse`: Dataverse client resolution, rows, metadata, connection
  references, and environment variables
- `@pp/solution`: solution lifecycle, analysis, compare, pack/unpack,
  import/export
- `@pp/canvas`: template registries, offline validation/build, diff, LSP, and
  harvesting helpers
- `@pp/flow`: flow discovery, runtime inspection, artifact lifecycle, graph,
  and patch helpers
- `@pp/model`: model-driven app inspection and dependency tracing

Adjacent provider packages:

- `@pp/sharepoint`
- `@pp/powerbi`

Interface and adapter packages:

- `@pp/cli`
- `@pp/mcp`
- `@pp/adapter-github-actions`
- `@pp/adapter-azure-devops`
- `@pp/adapter-power-platform-pipelines`

## Runtime flow

For a typical CLI command:

1. `@pp/cli` parses argv and shared output flags.
2. It resolves config or project state through `@pp/config` and `@pp/project`.
3. It calls a domain package such as `@pp/dataverse`, `@pp/solution`, or
   `@pp/flow`.
4. The result is normalized through `@pp/diagnostics` and rendered through the
   shared command contract.

For local-only commands such as `project inspect`, `analysis report`, or
`deploy plan`, the path often stops in `@pp/project`, `@pp/analysis`, and
`@pp/deploy` without touching a live environment.

## Repo-local project model

The repo is organized around a local project contract rather than a loose set
of scripts.

That project model gives the rest of the stack:

- a discoverable root via `pp.config.json|yaml|yml`
- default environment and solution aliases
- stage-aware topology
- parameter resolution rules
- provider bindings for adjacent systems
- known asset roots such as `apps/`, `flows/`, `solutions/`, and `docs/`

This is why commands such as `project inspect`, `analysis context`, and
`deploy apply` can share the same language and data.

## What matters most in practice

- The strongest current slices are auth/config, Dataverse inspection and
  metadata authoring, solution lifecycle, project analysis, and deploy
  planning/apply.
- Canvas, flow runtime, SharePoint, Power BI, MCP, and extensions are real
  surfaces, but some are more specialized or still incomplete in parts.

Use [supported-surfaces.md](supported-surfaces.md) for product adoption
guidance. Use this architecture guide only when you need to place new code or
reason about ownership boundaries.
