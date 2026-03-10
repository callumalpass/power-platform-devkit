# Architecture

`pp` is a package-first monorepo. The CLI is the main shipped interface, but it
mostly coordinates narrower workspace packages with explicit contracts rather
than owning all behavior directly.

## Mental model

The repository has four practical layers:

1. Core infrastructure and contracts
2. Domain packages for Power Platform and adjacent providers
3. Local project analysis and deploy orchestration
4. Interfaces such as the CLI, MCP server, and CI adapters

That split matters because most user-facing commands are thin compositions of
the same lower-level services. If you understand which package owns which
contract, the repo stops feeling larger than it is.

## Package map

Core packages:

- `@pp/auth`: auth profiles, browser-profile management, token acquisition
- `@pp/config`: persisted config store for auth profiles and environment aliases
- `@pp/diagnostics`: `OperationResult`, diagnostics, failure/warning helpers
- `@pp/http`: shared HTTP client helpers
- `@pp/artifacts`: stable JSON/YAML file IO and artifact helpers

Project and orchestration packages:

- `@pp/project`: `pp.config.*` discovery, init, doctor, topology, parameter resolution, provider binding resolution
- `@pp/analysis`: human and machine-readable project analysis outputs
- `@pp/deploy`: deploy plan/apply/release orchestration and adapter-facing bindings
- `@pp/extensions`: extension manifest, registry, compatibility, and trust policy

Primary domain packages:

- `@pp/dataverse`: Dataverse client resolution, rows, metadata, connection references, environment variables
- `@pp/solution`: solution lifecycle, analysis, compare, pack/unpack, import/export
- `@pp/canvas`: template registries, offline validation/build, diff, LSP, harvesting helpers
- `@pp/flow`: flow discovery, runtime inspection, normalized local artifact lifecycle, graph and patch helpers
- `@pp/model`: model-driven app composition and dependency inspection

Adjacent provider packages:

- `@pp/sharepoint`: targeted SharePoint inspection surfaces
- `@pp/powerbi`: targeted Power BI inspection surfaces

Interface and adapter packages:

- `@pp/cli`: `pp` command router and output contract
- `@pp/mcp`: MCP server entrypoint and tool wiring
- `@pp/adapter-github-actions`
- `@pp/adapter-azure-devops`
- `@pp/adapter-power-platform-pipelines`

## Runtime flow

For a typical CLI command, the path is:

1. `@pp/cli` parses argv and output/mutation flags.
2. It resolves local config or project context through `@pp/config` and `@pp/project`.
3. It calls a domain package such as `@pp/dataverse`, `@pp/solution`, `@pp/flow`, or `@pp/canvas`.
4. The result is normalized through `@pp/diagnostics` and rendered with the shared command contract.

For local-only commands such as `project inspect`, `analysis report`, or
`deploy plan`, the path often stops at `@pp/project`, `@pp/analysis`, and
`@pp/deploy` without touching a live environment.

## Repo-local project model

`pp` is designed around a repo-local project contract rather than a loose
collection of independent scripts.

That project model gives the rest of the stack:

- a discoverable root via `pp.config.json|yaml|yml`
- default environment and solution aliases
- stage-aware topology
- parameter resolution rules
- provider bindings for adjacent systems
- known asset roots such as `apps/`, `flows/`, `solutions/`, and `docs/`

This is why commands like `project inspect`, `analysis context`, and
`deploy apply` share language and data instead of each inventing their own
config format.

## Artifact-first domains

Two domains lean heavily on local canonical artifacts:

- canvas: pinned template registries plus offline source roots and native `.msapp` packaging
- flow: canonical `pp.flow.artifact` JSON for normalize, validate, patch, graph, deploy, and promote

This keeps repo workflows deterministic and reviewable. Live environment APIs
still matter, but they are not the only source of truth for every operation.

## Support boundary

Not every package is equally mature.

- The most production-ready slices are auth/config, Dataverse reads and metadata authoring, solution lifecycle workflows, local project analysis, deploy planning/apply, and the shared CLI contract.
- Canvas, flow runtime, SharePoint, Power BI, MCP, and extensions are real implemented surfaces, but some areas remain intentionally preview, bounded, or read-first.

Use [supported-surfaces.md](supported-surfaces.md) as the current product
boundary document.

## Where to go next

- setup and first-run: [quickstart.md](quickstart.md)
- auth and aliases: [auth-and-environments.md](auth-and-environments.md)
- project model: [project-config.md](project-config.md)
- deploy orchestration: [deploy.md](deploy.md)
- support tiers: [supported-surfaces.md](supported-surfaces.md)
