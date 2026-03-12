# Command contract

`pp` now treats output and mutation behavior as a shared CLI contract rather
than command-by-command conventions.

See also: [`docs/safety-and-provenance.md`](./safety-and-provenance.md) for the
repo policy around result metadata, placeholder reporting, and `.ops`
conventions.

## Output formats

Supported `--format` values:

- `table`
- `json`
- `yaml`
- `ndjson`
- `markdown`
- `raw`

Table semantics are intentionally simple and stable:

- lists of objects render as row-oriented tables
- singleton objects render as `field` / `value` tables, flattening nested object fields into dotted keys such as `auth.profile`
- scalar values render as a one-column table

`ndjson` emits one JSON object per line. Arrays become one line per item; a
singleton object becomes one line.

## Errors and warnings

Commands still emit primary payloads on stdout. Diagnostic routing differs today
by success/failure state.

- for successful commands, machine-oriented formats (`json`, `yaml`, `ndjson`)
  keep the primary payload on stdout and send success-side diagnostics/warnings
  to stderr when the command does not embed them in the stdout contract
- for non-zero exits, most machine-oriented commands currently emit the
  structured failure envelope on stdout and leave stderr empty so callers still
  receive one parseable machine document
- human-oriented formats (`table`, `markdown`, `raw`) emit readable diagnostic
  summaries on stderr for the same cases, including `suggestedNextActions`
  when the command can point to a canonical next step
- warnings stay off stdout so structured payloads remain parseable

`project inspect` and `flow validate` are the current exceptions for
machine-readable formats:

- successful `project inspect --format json|yaml|ndjson` responses embed
  `diagnostics`, `warnings`, `supportTier`, and related metadata directly in the
  stdout payload
- `flow validate --format json|yaml|ndjson` does the same, including validation
  diagnostics when the report is semantically invalid and the command exits `1`
- those successful machine-readable `project inspect` and `flow validate`
  responses do not emit a second diagnostics envelope on stderr, so
  single-stream parsers can consume one complete document
- human-oriented `project inspect` formats still print diagnostic summaries on
  stderr
- failure-side stdout envelopes are the current general machine-readable
  behavior, so parser guidance should treat stdout as authoritative on non-zero
  exits unless a command documents a different exception

## Result metadata

Structured diagnostics on stderr carry the shared metadata envelope:

- `supportTier`
- `suggestedNextActions`
- `provenance`
- `knownLimitations`

For successful mutation previews, stdout should also carry those fields when the
preview represents a partial, delegated, or placeholder workflow. That keeps
dry-run and plan payloads from looking fully supported when they are really
handoff contracts.

For successful machine-readable stdout payloads, the current direction is the
same shared envelope:

- singleton read commands should include `success`, `diagnostics`, `warnings`,
  and related metadata alongside the domain fields
- collection read commands should expose the collection under a named data key
  such as `solutions`, `profiles`, or `runs` rather than returning a bare array
- older bare-object and bare-array success payloads should be treated as legacy
  shapes to migrate, not the preferred contract for new or updated commands

## Mutation flags

Mutation-capable commands accept the same flag shape:

- `--dry-run`
- `--plan`
- `--yes`

Current behavior:

- `--dry-run` and `--plan` both suppress side effects and emit a structured
  preview payload
- `--yes` is accepted consistently so later guarded workflows can use the same
  shape without another CLI break
- `deploy apply` also accepts `--plan <file>` as a saved-plan execution
  checkpoint; that path still uses live apply mode and fails preflight if the
  current project no longer matches the saved plan. When `--project` is omitted,
  repeatable `--param NAME=VALUE` overrides can supply executable values for
  detached saved-plan apply
Today this contract is wired through:

- auth profile create/remove commands
- environment add/remove commands
- canvas build
- flow unpack/normalize/patch
- generic Dataverse requests when the method is not `GET`
- Dataverse row create/update/delete
- Dataverse metadata authoring commands

## Project-scoped overrides

Project-aware commands also share:

- `--stage STAGE`
- repeatable `--param NAME=VALUE`

These apply to:

- `project doctor`
- `project inspect`
- `analysis report`
- `analysis context`
- `analysis portfolio`
- `analysis drift`
- `analysis usage`
- `analysis policy`
- `deploy plan`
- `deploy apply`

`project init` also supports the shared mutation preview flags:

- `--dry-run`
- `--plan`
