# Canvas registries

Canvas support in `pp` centers on pinned template metadata. The `@pp/canvas`
package handles offline inspection, validation, deterministic builds, structured
diffs, and registry-backed source resolution. It also provides remote canvas-app
listing and inspection through Dataverse.

On the source side, `pp canvas` loads both the older normalized manifest JSON
trees and the newer unpacked `.pa.yaml` app roots. On the registry side, it
manages template registry documents, support-matrix resolution, provenance
tracking, and lifecycle operations such as import, pin, diff, and audit.

Live registry refresh is documented separately in
[`docs/canvas-harvesting.md`](./canvas-harvesting.md). Normal `pp canvas`
commands consume committed registries; they do not perform live harvesting.

## Common jobs

Most users come here for one of four jobs: validating or inspecting a local
canvas source tree, building a deterministic `.msapp` from a repo-local source
root, inspecting or diffing template registries, or inspecting a remote canvas
app before deciding on a manual or adjacent workflow.

### Validate a local app

```bash
pp canvas validate ./apps/MyCanvas
pp canvas inspect ./apps/MyCanvas --mode strict
```

### Build and diff locally

```bash
pp canvas build ./apps/MyCanvas --out ./dist/MyCanvas.msapp
pp canvas diff ./apps/MyCanvas ./apps/MyCanvas-next
```

### Work with template registries

```bash
pp canvas templates inspect ./registries/canvas-controls.json
pp canvas templates diff ./registries/canvas-controls.json ./registries/canvas-controls.next.json
pp canvas templates pin ./registries/canvas-controls.json --out ./registries/canvas-controls.pinned.json
```

### Inspect remote apps

```bash
pp canvas list --env dev --solution Core
pp canvas inspect "My Canvas App" --env dev --solution Core
```

## Why the registry exists

Canvas builds are not treated as derivable from source alone. Built-in controls
depend on externally acquired metadata, so the tool needs to know which template
metadata exists locally, where it came from, which versions and modes are
supported, and which builds should fail immediately. The registry document
captures all of this in a single committed artifact that validation, build, and
diff commands can consume without network access.

## Registry document

Canonical registry files are JSON documents with this shape:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-03-09T00:00:00.000Z",
  "templates": [
    {
      "templateName": "Button",
      "templateVersion": "1.0.0",
      "aliases": {
        "displayNames": ["Primary Button"],
        "constructors": ["Button"],
        "yamlNames": ["button"]
      },
      "files": {
        "Controls/Button.json": {
          "kind": "button"
        }
      },
      "contentHash": "<computed sha256>",
      "provenance": {
        "kind": "official-artifact",
        "source": "seed-app",
        "sourceArtifact": "References/Templates.json",
        "platformVersion": "3.24092.14"
      }
    }
  ],
  "supportMatrix": [
    {
      "templateName": "Button",
      "version": "1.*",
      "status": "supported",
      "modes": ["strict", "seeded", "registry"],
      "notes": ["validated against the current fixture set"]
    }
  ]
}
```

Imported catalogs are normalized into the canonical shape. The importer accepts
canonical `templates` arrays, `templates` or `controlTemplates` object maps
keyed by template name, and `supportMatrix` or `support` arrays.

## Provenance fields

Each template entry carries provenance so failures can explain what metadata is
trusted and what is not. The provenance object includes the following fields:

- `kind`: `official-api`, `official-artifact`, `harvested`, or `inferred`
- `source`: short human-readable origin label
- `acquiredAt`
- `sourceArtifact`
- `sourceAppId`
- `platformVersion`
- `appVersion`
- `importedFrom`

`contentHash` is always recomputed from normalized template content so pinning
and diffing stay deterministic even when imported files arrive in different key
orders.

## Support matrix rules

The support matrix is separate from the template payload. That keeps "metadata
exists" distinct from "this build is supported".

Rule fields:

- `templateName`
- `version`
- `status`: `supported`, `partial`, or `unsupported`
- `modes`: optional subset of `strict`, `seeded`, `registry`
- `notes`

Version matching currently supports exact versions such as `1.0.0`, wildcard
patterns such as `1.*`, and catch-all `*`. The most specific matching rule wins.
Later rules override earlier ones on ties.

## Build modes

The three build modes control how template metadata is resolved during
validation and build. In `seeded` mode, only source-provided or explicitly
seeded registries are used. In `registry` mode, only loaded pinned registries
are used. In `strict` mode, seeded registries are checked first, then pinned
registries, and missing metadata remains a hard failure. These rules are
deterministic; no network access occurs during resolution.

## Supported source roots

`pp canvas` accepts two offline source shapes.

The first is the older normalized manifest tree, where `canvas.json` anchors the
app and individual screens live as JSON files:

```text
apps/MyCanvas/
  canvas.json
  seed.templates.json          # optional
  screens/
    Home.json
    Settings.json
```

The second is an unpacked canvas app root, where `.pa.yaml` files under `Src/`
are the authored source of truth:

```text
apps/MyCanvas/
  Src/
    App.pa.yaml
    Screen1.pa.yaml
    _EditorState.pa.yaml       # optional but used for screen ordering
  References/
    DataSources.json           # optional
    Templates.json             # regenerated during native build
  Controls/
    1.json                     # required seed packaging metadata
  Header.json
  Properties.json
```

The JSON manifest slice stays supported for compatibility. The primary
forward-looking path is the unpacked `.pa.yaml` root. In that layout,
`Src/App.pa.yaml` and `Src/*.pa.yaml` are the authored source of truth, and
control constructors such as `Classic/Button@2.2.0` resolve through pinned
harvested registries. The `inspect` and `validate` commands surface the authored
control inventory plus optional `References/DataSources.json` summaries, and
`lint` is an alias for `validate` when you want a diagnostics-first workflow.
Allowed-property validation comes from harvested template metadata rather than
an inferred local schema.

The legacy manifest slice still uses explicit normalized screen JSON:

```json
{
  "name": "Home",
  "controls": [
    {
      "name": "SaveButton",
      "templateName": "Button",
      "templateVersion": "1.0.0",
      "properties": {
        "TextFormula": "\"Save\""
      }
    }
  ]
}
```

### Validation rules

Validation enforces the same checks across both source kinds. Every app must
contain at least one screen, and each control must declare a resolvable template
identity and version. Template metadata must resolve in the selected build mode.
When the registry exposes a template surface, authored properties are checked
against it. In the legacy JSON slice, formula-like properties must still be
strings.

## LSP workflows

`@pp/canvas` ships a canvas LSP entrypoint for editor consumers:

```bash
pnpm --filter @pp/canvas exec pp-canvas-lsp --mode strict
```

Diagnostics come from the same `lintCanvasApp` pipeline used by batch linting.
Unsaved `Src/*.pa.yaml` edits are analyzed through in-memory file overlays, so
editor diagnostics stay aligned with batch output for the current buffer. Hover
is available for supported control definitions, selected property metadata, and
resolved formula bindings. Definition support covers resolved control references
inside supported Power Fx formulas. Completion covers formula symbols backed by
the shared semantic model.

The server resolves the nearest `pp.config.*` and loads `templateRegistries`
from that project config. Repeated `--registry FILE` flags add or override
registry inputs for editor sessions, and metadata-backed references continue to
flow from `References/DataSources.json` in unpacked canvas roots.

Rich hover, definition, and completion are currently targeted at unpacked
`.pa.yaml` canvas roots where source spans exist. The older JSON manifest slice
still participates in batch validation, but editor navigation remains limited
there. Definition currently resolves control references; data-source and
metadata bindings do not yet jump to authored source locations. Completion is
intentionally narrow in the first pass and favors shared semantic symbols over
editor-only snippets.

## CLI commands

### Local source commands

These commands operate on a local canvas source root (either a manifest JSON
tree or an unpacked `.pa.yaml` root).

```bash
pp canvas validate ./apps/MyCanvas
pp canvas lint ./apps/MyCanvas
pp canvas inspect ./apps/MyCanvas --mode strict
pp canvas build ./apps/MyCanvas --out ./dist/MyCanvas.msapp
pp canvas diff ./apps/MyCanvas ./apps/MyCanvas-next
```

The `--mode strict|seeded|registry` flag controls template resolution for
validate, inspect, and build. The `--out` flag sets the build output path.
`--workspace FILE` lets you resolve a workspace app name instead of passing a
raw filesystem path. Repeated `--registry FILE` flags add or override registry
inputs.

### Remote commands

Remote commands require `--env` and optionally accept `--solution` to scope
results to a specific Dataverse solution.

```bash
pp canvas list --env dev --solution Core
pp canvas inspect "My Canvas App" --env dev --solution Core
```

Both commands accept `--help` for stable command-contract discovery without
triggering validation failures.

### Template registry commands

These commands manage the lifecycle of pinned template registries.

```bash
pp canvas templates inspect ./registries/canvas-controls.json
pp canvas templates diff ./registries/canvas-controls.json ./registries/canvas-controls.next.json
pp canvas templates pin ./registries/canvas-controls.json --out ./registries/canvas-controls.pinned.json
pp canvas templates refresh ./fixtures/canvas/registries/import-source.json --current ./registries/canvas-controls.json --out ./registries/canvas-controls.json
pp canvas templates audit ./registries/canvas-controls.json
pp canvas templates import ./fixtures/canvas/registries/import-source.json --out ./tmp/runtime-registry.json --source imported-catalog --acquired-at 2026-03-10T00:00:00.000Z
```

`templates import` accepts provenance overrides: `--kind`, `--source`,
`--acquired-at`, `--source-artifact`, `--source-app-id`, `--platform-version`,
and `--app-version`. `templates refresh` accepts the same provenance overrides
plus `--current FILE` to diff a refreshed catalog against the currently pinned
snapshot.

### Workspace commands

```bash
pp canvas workspace inspect ./canvas.workspace.json
```

### Patch commands

```bash
pp canvas patch plan MyCanvas --workspace ./canvas.workspace.json --file ./patches/title.patch.json
pp canvas patch apply MyCanvas --workspace ./canvas.workspace.json --file ./patches/title.patch.json --out ./tmp/MyCanvas-patched
```

## Remote mutations

Remote mutation support in `pp canvas` varies by operation. Download is fully
implemented, create has both a diagnostic preview mode and a delegated
browser-automation mode, and import is currently a diagnostic preview
placeholder.

### Download

The `download` command exports the containing solution through Dataverse,
extracts the matching `CanvasApps/*.msapp`, and writes a live `.msapp` artifact
without leaving `pp`:

```bash
pp canvas download <displayName|name|id> --env <alias> --solution UNIQUE_NAME [--out FILE]
```

Adding `--extract-to-directory DIR` preserves both forms in one invocation by
expanding the downloaded `.msapp` into a normalized local source tree. Archive
backslashes such as `Src\App.pa.yaml` are rewritten to portable paths like
`Src/App.pa.yaml`.

### Create

By default, `pp canvas create` returns a stable machine-readable diagnostic
instead of performing server-side blank-app creation:

```bash
pp canvas create --env <alias> [--solution UNIQUE_NAME] [--name DISPLAY_NAME]
```

The canonical browser-mediated create path is the `--delegate` mode. It drives
the solution-scoped Maker blank-app flow through a persisted browser profile,
saves and publishes in Studio, waits for the Dataverse `canvasapps` row, and
returns the created app id plus screenshot/session artifacts when it succeeds:

```bash
pp canvas create --env <alias> --solution UNIQUE_NAME --name DISPLAY_NAME --delegate --browser-profile NAME
```

Delegated create also accepts timing and debugging flags: `--artifacts-dir DIR`,
`--timeout-ms N`, `--poll-timeout-ms N`, `--settle-ms N`, `--slow-mo-ms N`, and
`--debug`. These let harnesses preserve browser evidence and tune Studio timing
without leaving `pp`.

### Import

`pp canvas import` currently returns a stable machine-readable diagnostic
instead of importing a remote app:

```bash
pp canvas import <file.msapp> --env <alias> [--solution UNIQUE_NAME] [--name DISPLAY_NAME]
```

When a file path is provided, the placeholder guidance derives a likely display
name from the `.msapp` filename and includes an exact `pp canvas inspect ...
--env ... [--solution ...]` verification command for the post-import path. The
`--name DISPLAY_NAME` flag lets the import placeholder return an exact
post-import verification command even when the imported app name will differ
from the `.msapp` basename.

### Preview and dry-run behavior

Adding `--dry-run` or `--plan` to either `create` or `import` resolves the
target environment and solution, then returns a structured no-op preview with
the Maker handoff URLs, verification commands, and known limitations instead of
a failure. The structured preview exposes a `fallback` object with
machine-readable Maker handoff metadata plus exact `inspect`, `list`, and
`solution components` verification commands, so agents do not need to parse
those commands back out of prose.

The non-preview JSON/YAML/NDJSON failure payload includes the same
machine-readable fallback metadata under `details`, alongside the existing
human-readable `suggestedNextActions`.

### Maker environment IDs and handoff URLs

Both placeholder commands resolve the target environment first, validate the
requested solution when one is provided or inherited from `defaultSolution`, and
then return suggested next actions for Maker fallback plus `pp canvas list`,
`pp canvas inspect`, and `pp solution components` verification commands.

When the target environment alias carries `makerEnvironmentId`, or the command
provides `--maker-env-id`, the placeholder diagnostics include exact
solution-scoped Maker URLs for the blank-app or import fallback path instead of
only generic portal guidance. Both placeholders also accept `--maker-env-id ID`
when you want exact Maker deep links for a one-off run without persisting that
metadata on the environment alias first.

When the environment alias does not already store `makerEnvironmentId`, the
placeholder create/import flow also tries to discover it live from the Power
Platform environments API so exact Maker handoff URLs still work without a
manual override. Real create/import runs cache that discovered id onto the alias
for later handoffs. If you want to pre-seed that metadata before a canvas
workflow, run `pp env resolve-maker-id <alias>` once so later `canvas create`
and Maker handoffs do not need to rediscover it during the step itself.

### Browser-based handoff

Both placeholders accept `--open --browser-profile NAME` for apply mode, which
launches the resolved Maker handoff URL directly into a persisted browser
profile instead of only printing fallback instructions. If `--open` is requested
before `pp` can build an exact Maker URL, the command returns a stable
`CANVAS_MAKER_HANDOFF_URL_UNAVAILABLE` diagnostic instead of failing deeper in
browser-launch logic.

## Path detection

Path detection is automatic. When `--env` is present, `canvas inspect` resolves
a remote app by display name, logical name, or id instead of reading local
source. Pointing at a directory containing `canvas.json` selects the legacy
manifest slice, while pointing at an unpacked app root or `Src/` directory
selects the `.pa.yaml` slice.

## Build behavior

Build behavior depends on the source kind. Unpacked `.pa.yaml` roots build a
native `.msapp` zip by regenerating `References/Templates.json` and control
payloads from the pinned registry while passing through the rest of the unpacked
app baseline from the source root. Legacy manifest JSON roots still write the
deterministic preview JSON package payload used by the existing fixture/golden
coverage.

The native `.msapp` build expects an unpacked app root that still contains
baseline packaging artifacts: `Header.json`, `Properties.json`, and
`Controls/1.json`.

## Project config wiring

Project config still uses `templateRegistries`:

```yaml
templateRegistries:
  - ./registries/canvas-controls.json
  - cache:seeded-controls
```

Relative paths resolve from the project root. `cache:NAME` resolves to
`${cacheDir}/NAME.json` when a cache directory is provided to the canvas
registry loader. Later registry files override earlier files for the same
`templateName@templateVersion`.

## Workspace manifests

Canvas workspaces are versioned JSON manifests that let several apps share
catalogs without collapsing back into per-app registry wiring:

```json
{
  "schemaVersion": 1,
  "name": "Finance Workspace",
  "registries": ["./registries/shared-runtime.json"],
  "catalogs": [
    {
      "name": "shared",
      "registries": ["./registries/shared-runtime.json"]
    }
  ],
  "apps": [
    {
      "name": "invoices",
      "path": "./apps/InvoicesCanvas",
      "catalogs": ["shared"],
      "registries": ["./registries/invoices-overrides.json"]
    }
  ]
}
```

`pp canvas workspace inspect` reports the resolved app paths and registry stack.
Local `inspect`, `validate`, `lint`, `build`, and `patch` commands also accept
`--workspace FILE`, so the positional app target can be a workspace app name
instead of a raw filesystem path.

## Registry lifecycle

Canvas template registries have first-class lifecycle commands. `templates
inspect` summarizes a pinned registry snapshot, including hashes and provenance
coverage. `templates diff` compares template and support-rule drift between two
snapshots. `templates pin` normalizes a registry into the canonical committed
form. `templates refresh` re-imports a source catalog and optionally diffs it
against the currently pinned snapshot. `templates audit` reports provenance
completeness across imported templates. These commands stay deterministic
because they operate on the same normalized registry document shape used by
local validate/build workflows.

## Patch workflows

`pp canvas patch plan` and `pp canvas patch apply` provide bounded transforms
over the supported JSON-manifest canvas slice. The current patch document shape
is:

```json
{
  "schemaVersion": 1,
  "operations": [
    {
      "op": "set-property",
      "controlPath": "Home/Layout/Title",
      "property": "TextFormula",
      "value": "=\"Updated\""
    }
  ]
}
```

Supported operations today are `set-property`, `remove-property`,
`add-control`, and `remove-control`. `patch plan` validates the control paths
before any writes occur. `patch apply` either mutates the app in place or writes
a patched copy into `--out`.

## Current boundary

This is still a deliberately narrow support matrix rather than a general canvas
compiler. The implemented workflow is real, but it only claims support for the
declared normalized source shape and the pinned control/template versions that
the registry marks as supported.

Remote canvas operations are also intentionally limited today. Remote `list` and
`inspect` are implemented. Remote `create` defaults to a discoverable preview
handoff and supports optional delegated Maker browser automation. Remote
`import` is still a discoverable preview placeholder only. The CLI does not
perform first-class server-side remote blank-app creation or import; delegated
create depends on Maker browser automation.
