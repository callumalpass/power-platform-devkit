# Project shape and ALM

This reference is the shared conceptual model behind the `pp-development`
skill. Use it when a task depends on understanding how a `pp` project should be
organized locally and how that local model maps to remote environments.

## Local anchor

Use `pp project doctor` and `pp project inspect --format json` before trying to
infer the repo layout manually.

The intended local split is:

- `solutions/`: unpacked or source-oriented solution assets
- `artifacts/solutions/`: packaged solution bundles such as `Core.zip`
- `apps/`: canvas app artifacts and related local files
- `flows/`: normalized flow artifacts
- `docs/`: human-facing project notes

The point is to keep editable source separate from generated or imported
bundles.

## Scope hierarchy

Think in this order:

1. `project`: what the repo says should exist
2. `stage`: which deployment context is active
3. `environment`: which remote Dataverse alias the stage resolves to
4. `solution`: which solution alias or unique name the stage resolves to

That hierarchy avoids baking environment-specific source trees into the repo.

## Stage-aware changes

Prefer one source tree plus topology overrides:

- project-level defaults describe the common case
- `topology.stages.<name>` overrides environment, solution, or parameters
- deploy mappings apply stage-specific values at plan/apply time

Use:

- `pp project inspect --stage <stage>`
- `pp analysis context --stage <stage>`
- `pp deploy plan --stage <stage>`

Do not fork local source only because dev and prod resolve to different remote
aliases or solution unique names.

## ALM workflow

Default mental model:

1. inspect and validate the local project
2. inspect the remote environment and solution state
3. author supported changes through `pp`
4. run `pp deploy plan` before `pp deploy apply`
5. keep local artifacts and remote state aligned through explicit stage or
   solution targeting

For local-to-remote promotion, prefer `pp` plan/apply and solution-aware
commands before custom scripts.

## Command anchors

Use these commands first:

- project shape: `pp project init`, `pp project doctor`, `pp project inspect`
- topology/context: `pp analysis context`, `pp analysis report`
- environment access: `pp auth profile inspect`, `pp env inspect`, `pp dv whoami`
- Dataverse work: `pp dv query`, `pp dv get`, `pp dv metadata ...`
- solution work: `pp solution list`, `pp solution inspect`, `pp solution export`,
  `pp solution import`, `pp solution set-metadata`
- deployment: `pp deploy plan`, `pp deploy apply`, `pp deploy release plan`

Only drop to generic `pp dv request` when a typed command does not yet cover
the needed Dataverse shape.
