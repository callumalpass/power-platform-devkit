# Testing

`pp` currently uses three practical test lanes:

- `pnpm test`: the normal fast suite for package tests, including fixture-backed CLI integration tests
- `pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/analysis/src/golden.test.ts packages/cli/src/integration.test.ts`: the focused fixture/golden lane for canvas, flow, analysis, and representative CLI workflows
- `pnpm smoke:live`: the gated live smoke lane that builds the workspace and runs the read-only external-environment checks

The repository now wires that split into GitHub Actions:

- `.github/workflows/fast-ci.yml`: normal fast CI on pull requests and pushes to `main`
- `.github/workflows/live-smoke.yml`: isolated live smoke lane on manual trigger or schedule

## Fixture-backed goldens

The committed fixtures currently cover:

- canvas template import, inspect, validate, build, and diff outputs
- flow unpack, validate, patch, and normalize outputs
- flow remote inspect, runtime runs, grouped error, connection-health, and doctor outputs from committed Dataverse-like fixtures
- project analysis context and markdown reporting
- CLI workflows that drive those same local fixture paths end to end

Run the focused lane:

```bash
pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/analysis/src/golden.test.ts packages/cli/src/integration.test.ts
```

Refresh committed goldens deterministically:

```bash
PP_UPDATE_GOLDENS=1 pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/analysis/src/golden.test.ts packages/cli/src/integration.test.ts
```

The fixture outputs live under `fixtures/canvas/golden/`, `fixtures/flow/golden/`, and `fixtures/analysis/golden/`. Refreshes should come from commands, not hand-edited snapshots.

## Live smoke

The live smoke lane is intentionally out of the normal fast path. It targets the configured test-like environment alias and auth profile automatically.

Run it manually or from a scheduled pipeline:

```bash
pnpm smoke:live
```

Override target selection when needed:

```bash
PP_SMOKE_ENV=test pnpm smoke:live
PP_SMOKE_PROFILE=test-user pnpm smoke:live
PP_CONFIG_DIR=./.tmp/pp-config pnpm smoke:live
```

The GitHub Actions workflow bootstraps a repo-local config directory before
running `pnpm smoke:live`. Configure these repository secrets for
`.github/workflows/live-smoke.yml`:

- `PP_SMOKE_URL`
- `PP_SMOKE_TENANT_ID`
- `PP_SMOKE_CLIENT_ID`
- `PP_SMOKE_CLIENT_SECRET`

The workflow writes a client-secret auth profile plus a matching environment
alias into `PP_CONFIG_DIR=./.tmp/pp-smoke-config`, then runs the same live
smoke command documented above. That keeps external-environment validation out
of pull-request CI while still making it schedulable and repeatable.
