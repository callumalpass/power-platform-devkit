# Safety and provenance

This repo treats `OperationResult<T>` metadata as part of the product contract,
not optional polish.

## Result metadata policy

Every exported service or package operation should set `supportTier`. The other
metadata fields should be added when they materially affect operator trust or
automation decisions.

Use `provenance` when a result depends on external metadata, harvested registry
content, or inferred guidance. Use `knownLimitations` when the surface is
partial, delegated, placeholder-only, or otherwise narrower than its command
shape might suggest. Use `suggestedNextActions` when the result leaves the
operator with a concrete next step, whether repo-local or on the platform.

Read-only or fully supported flows may omit `provenance`, `knownLimitations`,
and `suggestedNextActions` when there is nothing useful to say. Partial or
delegated flows should prefer a short, explicit metadata block over prose hidden
only in docs.

## Mutation safety policy

Mutation-capable CLI commands should follow the shared flag shape: `--dry-run`,
`--plan`, and `--yes`.

Both `--dry-run` and `--plan` must suppress side effects. Guarded live apply
paths must block cleanly without `--yes`. Preview payloads that represent
placeholder or delegated flows should include top-level `supportTier`,
`provenance`, `knownLimitations`, and `suggestedNextActions` so they do not look
like fully supported success payloads by accident.

## Package guidance

When adding a new package or command surface, return `OperationResult<T>` from
package boundaries and set `supportTier` deliberately instead of relying on the
implicit preview default. Add provenance records for official APIs and artifacts
versus inferred guidance. Add known limitations for partial surfaces on both
success previews and failures. Keep mutation previews and live-apply failures
aligned on the same metadata.

## `.ops` task-path policy

Canonical local task paths in this repo live under `.ops/tasks/`. Historical
`tasks/` references may still appear in older generated prompts, sidecars, or
run artifacts. Treat those as legacy records, not the current path contract for
new docs, commands, or examples.
