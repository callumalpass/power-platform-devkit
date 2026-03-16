# Canvas harvesting

`pnpm harvest:canvas` is the manual registry-refresh workflow for canvas
controls. It is intentionally separate from normal `pp canvas` commands. Use it
when you need to refresh pinned template metadata from a real TEST environment.
Do not use it as part of ordinary local builds or CI validation.

## What a harvest run does

A single harvest run can resolve the target Dataverse environment and canvas
app, optionally reset the fixture solution from a known baseline zip, open
Power Apps Studio in a persisted `pp` browser profile, seed a fixture app from
`.pa.yaml` snippets or insert published controls, save and publish the app,
export the solution through Dataverse, unpack the solution zip and `.msapp`,
analyze the exported app into a normalized registry document, and write the
pinned registry to `registries/canvas-controls.json`.

The implementation lives in `scripts/canvas-harvest.ts`,
`scripts/canvas-studio-apply.ts`, and `packages/canvas/src/harvest.ts`. The
dedicated TEST fixture app and solution contract is pinned in
`fixtures/canvas-harvest/fixture-solution.json`.

## How it works

The harvester runs in two deliberate phases. The first phase handles Studio
authoring: it launches the target app in a persisted `pp` browser profile,
seeds the fixture app either by pasting `.pa.yaml` snippets or by inserting
controls from the docs-backed catalog, and saves and publishes through Studio
runtime APIs rather than relying on Insert-pane DOM clicks. The key Studio
calls are `documentViewModel.doPasteYamlAsync(...)`,
`documentViewModel._controlGallery.addControlAsync(...)`,
`shell._fileSaveManager.saveAsync(...)`, and
`AppMagic.context.publishAppAsync(false)`.

The second phase handles artifact harvesting: it exports the solution through
Dataverse, unpacks the solution zip and the contained `.msapp`, normalizes
metadata from `References/Templates.json`, embedded dynamic-control definitions
in `Controls/*.json`, and runtime rule and property samples in exported control
trees, and then writes a normalized registry plus a run summary.

The Studio helper launches Playwright using the resolved browser-profile
settings instead of assuming a visible Chrome session, so the authenticated
maker profile's browser kind, explicit command, extra args, and `--headless`
mode all flow through to fixture preparation.

## Prerequisites

Install workspace dependencies with `pnpm install`. You also need `unzip` on
`PATH`, a configured auth profile and environment alias, a managed browser
profile that can reach a real Power Apps Studio session, and a TEST solution
containing the target canvas app.

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
known TEST baseline.

```bash
pnpm harvest:canvas \
  --env test \
  --solution TEST \
  --display-name TEST \
  --all-controls \
  --reset-solution-zip /tmp/pp-canvas-harvest-modern/TEST-solution.zip
```

By default, the target environment alias, solution unique name, and app display
name come from `fixtures/canvas-harvest/fixture-solution.json`. Output goes to a
new temp directory like `/tmp/pp-canvas-harvest-<timestamp>`, and the pinned
registry is written to `registries/canvas-controls.json` with a docs-backed
catalog at `registries/canvas-control-catalog.json`.

The most important flags are `--env` for the Dataverse environment alias,
`--solution` for the solution unique name to export, `--display-name` for the
canvas app display name, `--fixture-manifest` to override the pinned TEST
fixture manifest, `--skip-ui` to export and analyze without Studio edits,
`--skip-publish` to save without publishing, `--reset-solution-zip` to import a
known baseline before Studio work, and `--browser-profile` to override the
persisted browser profile name. You can also select apps more precisely with
`--app-id` or `--app-name`, point at a specific snippet directory with
`--screen-dir`, run headlessly with `--headless`, and tune timing with
`--timeout-ms` and `--settle-ms`.

## Full-catalog and chunked runs

The `--all-controls` flag switches the Studio phase from snippet paste mode to
the published-control insertion workflow backed by the pinned control catalog.
You can filter by family with `--catalog-family classic|modern`, start at a
specific control with `--catalog-start-at`, limit how many controls are
inserted with `--catalog-limit`, include retired controls with
`--include-retired`, use a fixed catalog snapshot with `--catalog-json`, or
resume from an earlier insert report with `--catalog-resume-report`.

For long runs, the loop wrapper chunks the work into manageable pieces.

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

The loop writes chunk outputs under `<out-dir>/chunks/chunk-###/` and a root
manifest at `<out-dir>/canvas-harvest-loop.json`. It only applies
`--reset-solution-zip` to chunk 1, keeps `registries/canvas-controls.json`
untouched until the selected slice is exhausted, and writes root-level
`latest-*` artifacts after each successful chunk. To resume a bounded loop,
pass the manifest from a previous run with `--catalog-resume-loop`.

```bash
pnpm harvest:canvas --all-controls --catalog-loop --catalog-resume-loop /tmp/<run>/canvas-harvest-loop.json
```

## Dedicated TEST fixture contract

The repo keeps the dedicated TEST harvest target in
`fixtures/canvas-harvest/fixture-solution.json` instead of relying on repeated
hard-coded `TEST` defaults. That manifest defines the expected TEST environment
alias, solution unique name, app display name, persisted Studio browser profile
name, default generated snippet directory for fixture seeding, and pinned
registry and docs-catalog output targets. Keep that file aligned when the
dedicated TEST app or solution changes. The reset baseline zip remains
environment-local and should still be passed explicitly with
`--reset-solution-zip`.

## Outputs

Each successful run writes a `canvas-registry.json` with the analyzed registry,
a `canvas-harvest-summary.json` with environment, app, and harvest metadata, a
`canvas-app.json` with resolved Dataverse canvas app metadata, a
`solution-unpacked/` directory with exported solution zip contents, and an
`msapp-unpacked/` directory with the unpacked canvas app artifact. When UI
insertion runs are active, the output also includes `studio-session.json` with
browser profile and Studio session context and
`canvas-control-insert-report.json` with insert results, the selected chunk,
and a resume checkpoint.

The project-level promotion targets are `registries/canvas-controls.json` and,
when the run fetched the docs-backed catalog, `registries/canvas-control-catalog.json`.

## Relationship to normal canvas commands

Harvesting is a refresh workflow. Normal `pp canvas validate`, `inspect`, and
`build` continue to consume committed registry files through
`templateRegistries` in `pp.config.*`, so harvesting can use live environment
access, browser automation, and TEST-only state while normal canvas analysis and
builds stay deterministic and offline.

## Refreshing fixture artifacts after a harvest

The harvester refreshes the pinned registry. The fixture-planning scratchpads
used for follow-up prototype work are maintained separately through dedicated
generation scripts.

```bash
node --import tsx ./scripts/generate-canvas-harvest-fixture.ts
node --import tsx ./scripts/generate-canvas-harvest-prototype-drafts.ts --merge-existing fixtures/canvas-harvest/generated/prototype-drafts.json
node --import tsx ./scripts/generate-canvas-harvest-prototype-promotion-batch.ts --merge-existing fixtures/canvas-harvest/generated/prototype-promotion-batch.json --name 'classic/Container'
node --import tsx ./scripts/generate-canvas-harvest-prototype-validation-batch.ts --merge-existing fixtures/canvas-harvest/generated/prototype-validation/batch.json
```

Use the merge-preserving paths when refreshing tracked scratchpads so manual
review notes and edited statuses survive.

## Operational notes

A modern-enabled reset baseline is currently the reliable starting point for
broad classic-plus-modern sweeps. The current full sweep pins 71 harvested
template entries in `registries/canvas-controls.json`. The `--skip-ui` flag is
useful for reanalysis of an already exported solution, but it does not refresh
Studio-authored control coverage. If Studio opens to Microsoft sign-in instead
of a ready editor session, bootstrap the browser profile again rather than
retrying the harvest blindly. The repo-pinned registry should only be updated
from a coherent successful run or an exhausted loop, not from partial or
exploratory subsets.
