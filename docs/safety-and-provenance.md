# Safety And Provenance

This repo treats `OperationResult<T>` metadata as part of the product contract,
not optional polish.

## Result metadata policy

Every exported service or package operation should set `supportTier`.

Add the other metadata fields when they materially affect operator trust or
automation:

- `provenance`: when a result depends on external metadata, harvested registry
  content, or inferred guidance
- `knownLimitations`: when the surface is partial, delegated, placeholder-only,
  or otherwise narrower than its command shape might suggest
- `suggestedNextActions`: when the result leaves the operator with a concrete
  next repo-local or platform step

Defaults:

- read-only or fully supported flows may omit `provenance`,
  `knownLimitations`, and `suggestedNextActions` when there is nothing useful to
  say
- partial or delegated flows should prefer a short, explicit metadata block over
  prose hidden only in docs

## Mutation safety policy

Mutation-capable CLI commands should follow the shared flag shape:

- `--dry-run`
- `--plan`
- `--yes`

Expectations:

- `--dry-run` and `--plan` must suppress side effects
- guarded live apply paths must block cleanly without `--yes`
- preview payloads that represent placeholder or delegated flows should include
  top-level `supportTier`, `provenance`, `knownLimitations`, and
  `suggestedNextActions` so they do not look like fully supported success
  payloads by accident

## Package guidance

When adding a new package or command surface:

1. Return `OperationResult<T>` from package boundaries.
2. Set `supportTier` deliberately instead of relying on the implicit preview
   default unless the surface is genuinely preview.
3. Add provenance records for official APIs/artifacts vs inferred guidance.
4. Add known limitations for partial surfaces on both success previews and
   failures.
5. Keep mutation previews and live-apply failures aligned on the same metadata.

## `.ops` task-path policy

Canonical local task paths in this repo live under `.ops/tasks/...`.

Historical `tasks/...` references may still appear in older generated prompts,
sidecars, or run artifacts. Treat those as legacy records, not the current path
contract for new docs, commands, or examples.
