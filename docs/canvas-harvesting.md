# Canvas Harvesting

`pnpm harvest:canvas` is the manual registry-refresh workflow for canvas
controls. It is intentionally separate from normal `pp canvas` commands.

Use it when you need to refresh pinned template metadata from a real TEST
environment. Do not use it as part of ordinary local builds or CI validation.

## What it does

One harvest run can:

- resolve the target Dataverse environment and canvas app
- optionally reset the fixture solution from a known baseline zip
- open Power Apps Studio in a persisted `pp` browser profile
- seed a fixture app from `.pa.yaml` snippets or insert published controls
- save and publish the app
- export the solution through Dataverse
- unpack the solution zip and `.msapp`
- analyze the exported app into a normalized registry document
- write the pinned registry to `registries/canvas-controls.json`

The current implementation lives in:

- `scripts/canvas-harvest.ts`
- `scripts/canvas-studio-apply.ts`
- `packages/canvas/src/harvest.ts`

The dedicated TEST fixture app/solution contract is pinned in:

- `fixtures/canvas-harvest/fixture-solution.json`

## How it works

The harvester is split into two deliberate phases.

1. Studio authoring
   - launches the target app in a persisted `pp` browser profile
   - seeds the fixture app either by pasting `.pa.yaml` snippets or by
     inserting controls from the docs-backed catalog
   - saves and publishes through Studio runtime APIs rather than relying only
     on Insert-pane DOM clicks
2. Artifact harvesting
   - exports the solution through Dataverse
   - unpacks the solution zip and the contained `.msapp`
   - normalizes metadata from:
     - `References/Templates.json`
     - embedded dynamic-control definitions in `Controls/*.json`
     - runtime rule/property samples in exported control trees
   - writes a normalized registry plus a run summary

The current Studio automation path is runtime-backed. The key calls are:

- `documentViewModel.doPasteYamlAsync(...)`
- `documentViewModel._controlGallery.addControlAsync(...)`
- `shell._fileSaveManager.saveAsync(...)`
- `AppMagic.context.publishAppAsync(false)`

The Studio helper launches Playwright using the resolved browser-profile
settings instead of assuming a visible Chrome session, so the authenticated
maker profile's browser kind, explicit command, extra args, and `--headless`
mode now flow through to fixture preparation.

## Prerequisites

Install workspace dependencies first:

```bash
pnpm install
```

You also need:

- `unzip` on `PATH`
- a configured auth profile and environment alias
- a managed browser profile that can reach a real Power Apps Studio session
- a TEST solution containing the target canvas app

Typical auth setup:

```bash
pp auth login --name test-user --resource https://<env>.crm.dynamics.com --browser-profile test-canvas-harvest
pp env add --name test --url https://<env>.crm.dynamics.com --profile test-user
pp env resolve-maker-id test
```

If browser-backed login does not land in an already signed-in Studio session,
bootstrap the browser profile once:

```bash
pp auth browser-profile bootstrap test-canvas-harvest --url https://make.powerapps.com/
```

## Normal one-shot harvest

This is the primary path when you want to refresh the pinned registry from a
known TEST baseline:

```bash
pnpm harvest:canvas \
  --env test \
  --solution TEST \
  --display-name TEST \
  --all-controls \
  --reset-solution-zip /tmp/pp-canvas-harvest-modern/TEST-solution.zip
```

Default behavior:

- target environment alias: `test` from `fixtures/canvas-harvest/fixture-solution.json`
- target solution unique name: `TEST` from `fixtures/canvas-harvest/fixture-solution.json`
- target app display name: `TEST` from `fixtures/canvas-harvest/fixture-solution.json`
- output root: a new temp directory such as `/tmp/pp-canvas-harvest-<timestamp>`
- pinned registry output: `registries/canvas-controls.json`
- pinned docs-backed catalog output: `registries/canvas-control-catalog.json`

Important flags:

- `--env <alias>`: Dataverse environment alias
- `--solution <name>`: solution unique name to export
- `--display-name <name>`: canvas app display name selector
- `--fixture-manifest <path>`: override the pinned TEST fixture manifest that seeds default environment, solution, app, screen-dir, and output paths
- `--app-id <guid>` or `--app-name <logical-name>`: stricter app selection
- `--screen-dir <dir>`: directory containing `.pa.yaml` snippet files for UI seeding
- `--skip-ui`: export and analyze only; no Studio edits
- `--skip-publish`: save without publish
- `--reset-solution-zip <zip>`: import a known baseline before Studio work
- `--browser-profile <name>`: override the persisted browser profile name
- `--headless`: run the browser without a visible window
- `--timeout-ms <n>` and `--settle-ms <n>`: runtime wait tuning

## Full-catalog and chunked runs

`--all-controls` switches the Studio phase from snippet paste mode to the
published-control insertion workflow backed by the pinned control catalog.

Useful selectors:

- `--catalog-family classic|modern`
- `--catalog-start-at <name|family/name>`
- `--catalog-limit <n>`
- `--include-retired`
- `--catalog-json <path>` to use a fixed catalog snapshot
- `--catalog-resume-report <path>` to continue from an earlier insert report

For long runs, prefer the loop wrapper:

```bash
pnpm harvest:canvas \
  --env test \
  --solution TEST \
  --display-name TEST \
  --all-controls \
  --catalog-loop \
  --catalog-limit 15 \
  --catalog-max-chunks 2 \
  --reset-solution-zip /tmp/pp-canvas-harvest-modern/TEST-solution.zip
```

Loop behavior:

- writes chunk outputs under `<out-dir>/chunks/chunk-###/`
- writes a root manifest at `<out-dir>/canvas-harvest-loop.json`
- only applies `--reset-solution-zip` to chunk 1
- keeps `registries/canvas-controls.json` untouched until the selected slice is exhausted
- writes root-level `latest-*` artifacts after each successful chunk

Resume a bounded loop with:

```bash
pnpm harvest:canvas --all-controls --catalog-loop --catalog-resume-loop /tmp/<run>/canvas-harvest-loop.json
```

## Dedicated TEST fixture contract

The repo now keeps the dedicated TEST harvest target in
`fixtures/canvas-harvest/fixture-solution.json` instead of relying on repeated
hard-coded `TEST` defaults.

That manifest currently defines:

- the expected TEST environment alias, solution unique name, and app display name
- the persisted Studio browser profile name used for maker automation
- the default generated snippet directory for fixture seeding
- the pinned registry and docs-catalog output targets

Keep that file aligned when the dedicated TEST app/solution changes. The reset
baseline zip remains environment-local and should still be passed explicitly
with `--reset-solution-zip`.

## Outputs

Each successful run writes:

- `canvas-registry.json`: analyzed registry for that run
- `canvas-harvest-summary.json`: environment, app, and harvest summary
- `canvas-app.json`: resolved Dataverse canvas app metadata
- `solution-unpacked/`: exported solution zip contents
- `msapp-unpacked/`: unpacked canvas app artifact

When UI insertion runs are active, the same output root also contains:

- `studio-session.json`: browser profile and Studio session context
- `canvas-control-insert-report.json`: insert results, selected chunk, and resume checkpoint

Project-level promotion targets:

- `registries/canvas-controls.json`
- `registries/canvas-control-catalog.json` when the run fetched the docs-backed catalog itself

The pinned registry is the downstream artifact that matters. Normal
`pp canvas validate`, `inspect`, `lint`, and unpacked-app `build` consume the
committed registry; they do not rerun the harvester.

## Relationship to normal canvas commands

Harvesting is a refresh workflow. Normal `pp canvas validate`, `inspect`, and
`build` continue to consume committed registry files through `templateRegistries`
in `pp.config.*`.

Current project wiring:

```yaml
templateRegistries:
  - ./registries/canvas-controls.json
```

That means:

- harvesting can use live environment access, browser automation, and TEST-only state
- normal canvas analysis and builds stay deterministic and offline

## Refreshing fixture artifacts after a harvest

The harvester refreshes the pinned registry. The fixture-planning scratchpads
used for follow-up prototype work are maintained separately.

Typical follow-up commands:

```bash
node --import tsx ./scripts/generate-canvas-harvest-fixture.ts
node --import tsx ./scripts/generate-canvas-harvest-prototype-drafts.ts --merge-existing fixtures/canvas-harvest/generated/prototype-drafts.json
node --import tsx ./scripts/generate-canvas-harvest-prototype-promotion-batch.ts --merge-existing fixtures/canvas-harvest/generated/prototype-promotion-batch.json --name 'classic/Container'
node --import tsx ./scripts/generate-canvas-harvest-prototype-validation-batch.ts --merge-existing fixtures/canvas-harvest/generated/prototype-validation/batch.json
```

Use the merge-preserving paths when refreshing tracked scratchpads so manual
review notes and edited statuses survive.

## Operational notes

- A modern-enabled reset baseline is currently the reliable starting point for
  broad classic-plus-modern sweeps.
- The current full sweep pins 71 harvested template entries in
  `registries/canvas-controls.json`.
- `--skip-ui` is useful for reanalysis of an already exported solution, but it
  does not refresh Studio-authored control coverage.
- If Studio opens to Microsoft sign-in instead of a ready editor session,
  bootstrap the browser profile again rather than retrying the harvest blindly.
- The repo-pinned registry should only be updated from a coherent successful run
  or an exhausted loop, not from partial or exploratory subsets.
