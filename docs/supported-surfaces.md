# Supported surfaces

This guide is the current boundary document for `pp`.

It is intentionally product-facing rather than package-facing: the goal is to
make it obvious which workflows are stable, which are preview or experimental,
and where users should still expect rough edges.

## Stable core

These are the most complete workflows in the repo today:

- auth profile management and environment aliases
- Dataverse read operations and generic Web API access
- Dataverse metadata inspection plus the current typed metadata create/update slice
- solution lifecycle commands: create, delete, inspect, components, dependencies, analyze, compare, export/import, pack/unpack, set-metadata
- local project discovery, `project init`, `project doctor`, `project inspect`, and `project feedback`
- analysis outputs and deploy plan/apply/release orchestration
- shared CLI output contract, diagnostics, completion, and support bundles

These surfaces have the best combination of tests, docs, and end-to-end
coherence.

## Preview but usable

These areas are implemented and documented, but still intentionally bounded:

- canvas offline inspection, validation, lint, build, diff, workspace inspection, template registry management, and LSP support
- flow local artifact workflows: unpack, normalize, validate, graph, patch, pack, deploy
- flow remote discovery, inspect, export, promote, runs, errors, connrefs, and doctor
- model-driven app composition inspection
- SharePoint and Power BI targeted inspection commands
- CI adapter wrappers and runner scripts
- extension registry and contribution contract

Common reasons these remain preview:

- the underlying product surfaces are inconsistent or partially opaque
- the repo only claims a bounded mutation slice instead of a full lifecycle
- some workflows depend on external product behavior that is not fully stable

## Experimental or intentionally incomplete

These are real surfaces, but users should expect sharper edges:

- remote canvas create/import, which still uses Maker handoff guidance or explicit not-yet-implemented diagnostics
- flow runtime correlation, which depends on runtime tables and supported source payloads being present
- MCP as a broad automation interface beyond the current controlled surface
- third-party extension loading beyond repo-local or tightly controlled packages
- broader packaging/distribution ergonomics beyond the current monorepo and tarball flow

## Read-first versus mutation-first

`pp` is not mutation-heavy everywhere.

A useful way to assess risk is:

- mutation-first and reasonably mature: Dataverse metadata, environment variables, connection references, solution lifecycle, deploy apply
- read-first or bounded mutation: model-driven apps, SharePoint, Power BI, flow runtime, parts of canvas, parts of MCP

When a command is mutation-capable, prefer `--dry-run` or `--plan` first when
available.

## Current rough edges to expect

- some live workflows still depend on browser-mediated auth or maker-session bootstrapping
- canvas registry quality depends on the pinned harvested metadata you commit
- flow remote deploy/promotion only carries the normalized supported artifact and bounded workflow metadata
- SharePoint and Power BI are focused inspection and deploy-adjacent utilities, not full authoring suites
- packaging and install ergonomics are still source-repo oriented

## Recommended starting paths

If you are deciding where to adopt `pp`, start here:

- repo-local project modeling and diagnostics
- Dataverse inspection and metadata authoring
- solution analysis and lifecycle operations
- deploy planning and controlled apply

Treat these as later or more selective adoption areas:

- canvas authoring/build pipelines
- flow runtime diagnostics and promotion
- adjacent provider automation
- extensions and MCP integrations
