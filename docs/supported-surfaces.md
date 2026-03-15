# Supported surfaces

Use this guide to decide what you should confidently use in `pp` today, what is
worth using when you need it, and what is still incomplete.

## Recommended for routine use

These workflows are the best place to start and should be treated as the core
of `pp`:

- auth profile management and environment aliases
- Dataverse reads and generic Web API access
- Dataverse metadata inspection and the current typed metadata authoring slice
- solution lifecycle commands
- local project discovery with `project init`, `project doctor`, and
  `project inspect`
- analysis outputs and deploy plan/apply orchestration
- shared diagnostics, output formatting, and support bundles

If you are adopting `pp` for real work, start here.

## Good, but more specialized

These areas are useful and documented, but they are usually a second step after
the core workflows above:

- canvas offline inspection, validation, lint, build, diff, workspace
  inspection, and template registry management
- flow local artifact workflows such as unpack, normalize, validate, graph,
  patch, pack, deploy, and promote
- flow remote discovery, export, inspect, runs, errors, connrefs, doctor, and
  monitor
- model-driven app inspection and create/attach authoring
- SharePoint and Power BI targeted inspection and deploy-adjacent operations
- CI adapter wrappers and runner scripts
- extension registry and contribution contract

These are not weak areas. They are simply not the first workflows most users
should learn.

## Still incomplete

These areas should be described plainly as incomplete:

- remote canvas create/import paths that still depend on Maker handoff guidance
- flow runtime correlation when the required runtime evidence is missing or thin
- MCP as a broad automation surface beyond the current implemented tool set
- third-party extension loading outside repo-local or tightly controlled setups
- packaging and installation ergonomics beyond the current repo-oriented flow

## Practical adoption order

If you want the most reliable path through the product:

1. Set up auth profiles and environment aliases.
2. Use `pp dv ...` and `pp solution ...` for inspection and controlled changes.
3. Add `pp.config.yaml` and run `pp project doctor`.
4. Use `pp deploy plan` and `pp deploy apply --dry-run` before live deploys.
5. Add flow, canvas, or adjacent-provider workflows when the repo needs them.

## Specific limitations that matter

This is the part that should stay concrete:

- some live workflows still depend on browser-mediated auth or maker-session
  bootstrapping
- a few MCP and CLI flows are still asymmetric in confirmation-heavy paths
- canvas registry quality depends on the harvested metadata you commit
- flow remote deploy and promotion focus on the supported artifact and workflow
  metadata contract, not every possible remote workflow shape
- SharePoint and Power BI support is focused, not a full authoring suite
- packaging and install ergonomics are still stronger for repo users than
  general CLI distribution

## How to read the rest of the docs

- Start with [quickstart.md](quickstart.md) if you are new.
- Read [dataverse-and-solutions.md](dataverse-and-solutions.md) for the core
  remote workflow.
- Read [project-config.md](project-config.md) and [deploy.md](deploy.md) when
  you are ready to model a repo and automate changes.
- Read [architecture.md](architecture.md) only when package ownership or repo
  layering actually matters to the task in front of you.
