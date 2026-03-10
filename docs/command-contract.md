# Command contract

`pp` now treats output and mutation behavior as a shared CLI contract rather
than command-by-command conventions.

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
- singleton objects render as `field` / `value` tables
- scalar values render as a one-column table

`ndjson` emits one JSON object per line. Arrays become one line per item; a
singleton object becomes one line.

## Errors and warnings

Commands still emit primary payloads on stdout and diagnostics on stderr.

- machine-oriented formats (`json`, `yaml`, `ndjson`) emit structured
  diagnostic envelopes on stderr whenever commands surface diagnostics, even if
  they also emit a primary payload on stdout
- human-oriented formats (`table`, `markdown`, `raw`) emit readable diagnostic
  summaries on stderr for the same cases
- warnings stay off stdout so structured payloads remain parseable

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

- `project inspect`
- `analysis report`
- `analysis context`
- `deploy plan`
