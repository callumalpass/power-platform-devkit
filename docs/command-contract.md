# Command contract

`pp` treats output formats and mutation behavior as a shared CLI contract
rather than leaving each command to invent its own conventions. This guide
describes that contract. See also
[`docs/safety-and-provenance.md`](./safety-and-provenance.md) for the repo
policy around result metadata, placeholder reporting, and `.ops` conventions.

## Output formats

Every command that produces structured output accepts a `--format` flag. The
supported values are `table`, `json`, `yaml`, `ndjson`, `markdown`, and `raw`.

Table output uses intentionally simple and stable rendering. Lists of objects
become row-oriented tables, singleton objects become two-column `field` /
`value` tables with nested object fields flattened into dotted keys like
`auth.profile`, and scalar values render as a one-column table. The `ndjson`
format emits one JSON object per line: arrays produce one line per item, and a
singleton object produces one line.

## Errors and warnings

Commands emit their primary payload on stdout. How diagnostics are routed
depends on the success or failure state and the output format.

For successful commands using machine-oriented formats (`json`, `yaml`,
`ndjson`), the primary payload stays on stdout and any success-side diagnostics
or warnings go to stderr, unless the command embeds them directly in the stdout
contract. For non-zero exits, most machine-oriented commands emit a structured
failure envelope on stdout and leave stderr empty, so callers always receive one
parseable machine document. Human-oriented formats (`table`, `markdown`, `raw`)
emit readable diagnostic summaries on stderr, including `suggestedNextActions`
when the command can point to a concrete next step. Warnings always stay off
stdout so structured payloads remain parseable.

`flow validate` is a current exception: its machine-readable formats embed
validation diagnostics directly in the stdout payload even when the report is
semantically invalid and the command exits `1`. Human-oriented `flow validate`
formats still use stderr for diagnostic summaries. In general, parser guidance
should treat stdout as authoritative on non-zero exits unless a specific command
documents a different exception.

## Result metadata

Structured diagnostics on stderr carry a shared metadata envelope with
`supportTier`, `suggestedNextActions`, `provenance`, and `knownLimitations`
fields. For successful mutation previews, stdout should also carry those fields
when the preview represents a partial, delegated, or placeholder workflow. This
prevents dry-run and plan payloads from looking fully supported when they are
really handoff contracts.

## Mutation flags

Mutation-capable commands share a consistent flag shape. `--dry-run` and
`--plan` both suppress side effects and emit a structured preview payload.
`--yes` is accepted consistently so that future guarded workflows can use the
same shape without requiring another CLI change.

This contract is currently wired through auth profile create and remove,
environment add and remove, canvas build, flow normalize, generic Dataverse
requests when the method is not `GET`, Dataverse row create, update, and
delete, and Dataverse metadata authoring commands.
