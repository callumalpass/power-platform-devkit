# Testing

`pp` uses three test lanes, each serving a different purpose.

The **fast suite** (`pnpm test`) runs normal package tests including
fixture-backed CLI integration tests. This is the default path for routine
development and pull-request CI, wired through
`.github/workflows/fast-ci.yml`.

The **focused fixture and golden lane** runs the golden-file tests across
canvas, flow, solution, model, and CLI packages. These tests compare live
command output against committed fixture snapshots and are the primary way to
verify that output contracts have not drifted.

```bash
pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/solution/src/golden.test.ts packages/model/src/golden.test.ts packages/cli/src/integration.test.ts packages/cli/src/contract.test.ts
```

The **live smoke lane** (`pnpm smoke:live`) builds the workspace and runs
read-only checks against a real external environment. It is intentionally
separate from pull-request CI and runs on manual trigger or schedule through
`.github/workflows/live-smoke.yml`.

## Fixture-backed goldens

The committed fixtures provide broad coverage across the product surface. On the
canvas side, they cover template import, inspect, validate, build, and diff
outputs, along with unpacked `.pa.yaml` source loading, native `.msapp`
packaging, formula-heavy happy-path packaging with data-source and entity
strings, semantic diagnostics for invalid formulas and missing template
metadata, and mode-specific failures when fixture metadata is intentionally
split between seeded sources and external registries.

Flow fixtures cover local artifact inspect, unpack, validate, patch, and
normalize outputs including round-trip connection-reference rename consistency,
invalid-artifact validation diagnostics, and remote list, inspect, runtime runs,
grouped error outputs, connection-health, and doctor outputs from committed
Dataverse-like fixtures.

Solution and model fixtures cover solution list, inspect, components,
dependencies, analysis, and source-vs-target comparison outputs, as well as
model-driven app list, inspect, sitemap, forms, views, and dependency outputs,
all from committed Dataverse-like fixtures.

CLI fixtures cover contract rendering for structured outputs, machine-friendly
failures, warning streams, dry-run and plan previews, protocol outputs from the
real command router across table, YAML, NDJSON, and human-readable paths, remote
canvas discovery and placeholder mutation contracts, and end-to-end CLI
workflows over committed fixture paths.

To refresh committed goldens deterministically, set `PP_UPDATE_GOLDENS=1` before
running the golden lane.

```bash
PP_UPDATE_GOLDENS=1 pnpm exec vitest run packages/canvas/src/golden.test.ts packages/flow/src/golden.test.ts packages/solution/src/golden.test.ts packages/model/src/golden.test.ts packages/cli/src/integration.test.ts packages/cli/src/contract.test.ts
```

The fixture outputs live under `fixtures/canvas/golden/`,
`fixtures/flow/golden/`, `fixtures/solution/golden/`, `fixtures/model/golden/`,
and `fixtures/cli/golden/`. Refreshes should always come from commands, not
hand-edited snapshots.

## Live smoke

The live smoke lane targets the configured test-like environment alias and auth
profile automatically. Run it manually or from a scheduled pipeline.

```bash
pnpm smoke:live
```

You can override the target environment, auth profile, or config directory
through environment variables when needed.

```bash
PP_SMOKE_ENV=test pnpm smoke:live
PP_SMOKE_PROFILE=test-user pnpm smoke:live
PP_CONFIG_DIR=./.tmp/pp-config pnpm smoke:live
```

When you want the smoke evidence to prove a particular solution, canvas app, or
filtered row instead of only generic environment reachability, pass
scenario-specific assertions through `PP_SMOKE_EXPECTATIONS_JSON`.

```bash
EXPECTATIONS=$(cat <<'EOF'
{"solutionUniqueName":"HarnessSolution","canvas":{"identifier":"demo","solutionUniqueName":"HarnessSolution"},"rows":[{"table":"pp_projects","filter":"pp_name eq 'Harness Project Seed 20260311A'","label":"project seed"}]}
EOF
)
PP_SMOKE_EXPECTATIONS_JSON="$EXPECTATIONS" pnpm smoke:live
```

The smoke runner accepts both legacy raw-array command output and the current
success-envelope machine-readable payloads (`data`, `results`, `runs`), so
scenario assertions keep working even when the underlying `pp` command emits
metadata alongside the row data.

### GitHub Actions configuration

The GitHub Actions workflow bootstraps a repo-local config directory before
running the smoke lane. Configure these repository secrets for
`.github/workflows/live-smoke.yml`: `PP_SMOKE_URL`, `PP_SMOKE_TENANT_ID`,
`PP_SMOKE_CLIENT_ID`, and `PP_SMOKE_CLIENT_SECRET`.

The workflow writes a client-secret auth profile plus a matching environment
alias into `PP_CONFIG_DIR=./.tmp/pp-smoke-config`, then runs the same
`pnpm smoke:live` command documented above. This keeps external-environment
validation out of pull-request CI while still making it schedulable and
repeatable.
