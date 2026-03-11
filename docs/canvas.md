# Canvas registries

Canvas support starts with pinned template metadata. The current `@pp/canvas`
surface now includes:

- remote canvas-app listing and inspection through Dataverse
- template registry documents and support-matrix resolution
- normalized source loading from both manifest JSON trees and unpacked
  `.pa.yaml` app roots
- `canvas validate`
- `canvas lint`
- `canvas inspect`
- deterministic `canvas build`
- structured `canvas diff`

Live registry refresh is documented separately in
[`docs/canvas-harvesting.md`](./canvas-harvesting.md). Normal `pp canvas`
commands consume committed registries; they do not perform live harvesting.

## Why the registry exists

Canvas builds are not treated as derivable from source alone. Built-in controls
depend on externally acquired metadata, so the tool needs a clear answer to:

- which template metadata exists locally
- where it came from
- which versions and modes are supported
- which builds should fail immediately

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
either:

- canonical `templates` arrays
- `templates` or `controlTemplates` object maps keyed by template name
- `supportMatrix` or `support` arrays

## Provenance fields

Each template entry carries provenance so failures can explain what metadata is
trusted and what is not.

Current fields:

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

Version matching currently supports:

- exact versions such as `1.0.0`
- wildcard patterns such as `1.*`
- catch-all `*`

The most specific matching rule wins. Later rules override earlier ones on ties.

## Build modes

Current resolution rules are deterministic:

- `seeded`: only source-provided or explicitly seeded registries are used
- `registry`: only loaded pinned registries are used
- `strict`: seeded registries are checked first, then pinned registries, and
  missing metadata remains a hard failure

## Supported source roots

`pp canvas` now accepts two offline source shapes:

1. The older normalized manifest tree:

```text
apps/MyCanvas/
  canvas.json
  seed.templates.json          # optional
  screens/
    Home.json
    Settings.json
```

2. An unpacked canvas app root:

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
forward-looking path is the unpacked `.pa.yaml` root, where:

- `Src/App.pa.yaml` and `Src/*.pa.yaml` are the authored source of truth
- control constructors such as `Classic/Button@2.2.0` resolve through pinned
  harvested registries
- `inspect` and `validate` surface authored control inventory plus optional
  `References/DataSources.json` summaries
- `lint` is an alias for `validate` when you want a diagnostics-first workflow
- allowed-property validation comes from harvested template metadata rather
  than an inferred local schema

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

Current validation rules across both source kinds:

- at least one screen must be present
- each control must declare a resolvable template identity and version
- template metadata must resolve in the selected build mode
- authored properties are checked against the harvested template surface when
  the registry exposes one
- formula-like properties in the legacy JSON slice must still be strings

## LSP workflows

`@pp/canvas` now ships a canvas LSP entrypoint for editor consumers:

```bash
pnpm --filter @pp/canvas exec pp-canvas-lsp --project . --mode strict
```

Current editor features:

- diagnostics come from the same `lintCanvasApp` pipeline used by batch linting
- unsaved `Src/*.pa.yaml` edits are analyzed through in-memory file overlays so
  editor diagnostics stay aligned with batch output for the current buffer
- hover is available for supported control definitions, selected property
  metadata, and resolved formula bindings
- definition is available for resolved control references inside supported Power
  Fx formulas
- completion is available for formula symbols backed by the shared semantic
  model

Workspace behavior:

- the server resolves the nearest `pp.config.*` and loads `templateRegistries`
  from that project config
- repeated `--registry FILE` flags add or override registry inputs for editor
  sessions
- metadata-backed references continue to flow from
  `References/DataSources.json` in unpacked canvas roots

Current support boundaries:

- rich hover, definition, and completion are currently targeted at unpacked
  `.pa.yaml` canvas roots where source spans exist
- the older JSON manifest slice still participates in batch validation, but
  editor navigation remains limited there
- definition currently resolves control references; data-source and metadata
  bindings do not yet jump to authored source locations
- completion is intentionally narrow in the first pass and favors shared
  semantic symbols over editor-only snippets

## CLI commands

```bash
pp canvas list --env dev --solution Core
pp canvas inspect "My Canvas App" --env dev --solution Core
pp canvas list --help
pp canvas inspect --help
pp canvas create --help
pp canvas import --help
pp canvas validate ./apps/MyCanvas --project .
pp canvas lint ./apps/MyCanvas --project .
pp canvas inspect ./apps/MyCanvas --project . --mode strict
pp canvas build ./apps/MyCanvas --project . --out ./dist/MyCanvas.msapp
pp canvas diff ./apps/MyCanvas ./apps/MyCanvas-next
pp canvas workspace inspect ./canvas.workspace.json
pp canvas templates import ./fixtures/canvas/registries/import-source.json --out ./tmp/runtime-registry.json --source imported-catalog --acquired-at 2026-03-10T00:00:00.000Z
pp canvas templates inspect ./registries/canvas-controls.json
pp canvas templates diff ./registries/canvas-controls.json ./registries/canvas-controls.next.json
pp canvas templates pin ./registries/canvas-controls.json --out ./registries/canvas-controls.pinned.json
pp canvas templates refresh ./fixtures/canvas/registries/import-source.json --current ./registries/canvas-controls.json --out ./registries/canvas-controls.json
pp canvas templates audit ./registries/canvas-controls.json
pp canvas patch plan MyCanvas --workspace ./canvas.workspace.json --file ./patches/title.patch.json
pp canvas patch apply MyCanvas --workspace ./canvas.workspace.json --file ./patches/title.patch.json --out ./tmp/MyCanvas-patched
```

Useful flags:

- `--env` and optional `--solution` for remote `canvas list` and remote
  `canvas inspect`
- `canvas list --help` and `canvas inspect --help` for stable remote/local
  command-contract discovery without triggering validation failures
- `--project` to resolve `templateRegistries` from `pp.config.*`
- `--workspace FILE` to resolve a workspace app name plus shared catalogs
- repeated `--registry FILE` to override project registries
- `--mode strict|seeded|registry`
- `--cache-dir` for `cache:NAME` registry references
- `--out` for build output
- `canvas templates import` also accepts provenance overrides:
  `--kind`, `--source`, `--acquired-at`, `--source-artifact`,
  `--source-app-id`, `--platform-version`, and `--app-version`
- `canvas templates refresh` accepts the same provenance overrides plus
  `--current FILE` to diff a refreshed catalog against the currently pinned one

Remote mutation placeholders:

- `pp canvas download <displayName|name|id> --env <alias> --solution UNIQUE_NAME [--out FILE]`
  exports the containing solution through Dataverse, extracts the matching
  `CanvasApps/*.msapp`, and writes a live `.msapp` artifact without leaving
  `pp`
- `pp canvas download ... --extract-to-directory DIR` preserves both forms in
  one invocation by expanding the downloaded `.msapp` into a normalized local
  source tree; archive backslashes such as `Src\App.pa.yaml` are rewritten to
  portable paths like `Src/App.pa.yaml`
- `pp canvas create --env <alias> [--solution UNIQUE_NAME] [--name DISPLAY_NAME]`
  still returns a stable machine-readable diagnostic by default instead of
  performing server-side blank-app creation
- `pp canvas import <file.msapp> --env <alias> [--solution UNIQUE_NAME] [--name DISPLAY_NAME]`
  currently returns a stable machine-readable diagnostic instead of importing a
  remote app
- `pp canvas create --env <alias> --solution UNIQUE_NAME --name DISPLAY_NAME --delegate --browser-profile NAME`
  is the canonical browser-mediated create path inside `pp`; it drives the
  solution-scoped Maker blank-app flow through a persisted browser profile,
  saves/publishes in Studio, waits for the Dataverse `canvasapps` row, and
  returns the created app id plus screenshot/session artifacts when it succeeds
- adding `--dry-run` or `--plan` to either placeholder resolves the target
  environment and solution, then returns a structured no-op preview with the
  Maker handoff URLs, verification commands, and known limitations instead of a
  failure
- the structured preview now exposes a `fallback` object with machine-readable
  Maker handoff metadata plus exact `inspect`, `list`, and `solution
  components` verification commands, so agents do not need to parse those
  commands back out of prose
- `--name DISPLAY_NAME` lets the import placeholder return an exact
  post-import `pp canvas inspect ...` verification command even when the
  imported app name will differ from the `.msapp` basename
- when `pp canvas import` receives a file path, the placeholder guidance
  derives a likely display name from the `.msapp` filename and includes an
  exact `pp canvas inspect ... --env ... [--solution ...]` verification command
  for the post-import path
- both placeholders also accept `--maker-env-id ID` when you want exact Maker
  deep links for a one-off run without persisting that metadata on the
  environment alias first
- when the environment alias does not already store `makerEnvironmentId`, the
  placeholder create/import flow also tries to discover it live from the Power
  Platform environments API so exact Maker handoff URLs still work without a
  manual override, and real create/import runs cache that discovered id onto
  the alias for later handoffs
- if you want to pre-seed that metadata before a canvas workflow, run
  `pp env resolve-maker-id <alias>` once so later `canvas create` and Maker
  handoffs do not need to rediscover it during the step itself
- both placeholders also accept `--open --browser-profile NAME` for apply mode,
  which launches the resolved Maker handoff URL directly into a persisted
  browser profile instead of only printing fallback instructions
- delegated create also accepts `--artifacts-dir DIR`, `--timeout-ms N`,
  `--poll-timeout-ms N`, `--settle-ms N`, `--slow-mo-ms N`, and `--debug` so
  harnesses can preserve browser evidence and tune Studio timing without
  leaving `pp`
- both placeholder commands resolve the target environment first, validate the
  requested solution when one is provided or inherited from `defaultSolution`,
  and then return suggested next actions for Maker fallback plus `pp canvas
  list`, `pp canvas inspect`, and `pp solution components` verification
- the non-preview JSON/YAML/NDJSON failure payload now includes the same
  machine-readable fallback metadata under `details`, alongside the existing
  human-readable `suggestedNextActions`
- when the target environment alias carries `makerEnvironmentId`, or the
  command provides `--maker-env-id`, the placeholder diagnostics include exact
  solution-scoped Maker URLs for the blank-app or import fallback path instead
  of only generic portal guidance
- if `--open` is requested before `pp` can build an exact Maker URL, the
  command now returns a stable `CANVAS_MAKER_HANDOFF_URL_UNAVAILABLE`
  diagnostic instead of failing deeper in browser-launch logic

Path detection is automatic:

- when `--env` is present, `canvas inspect` resolves a remote app by display
  name, logical name, or id instead of reading local source
- point at a directory containing `canvas.json` for the legacy manifest slice
- point at an unpacked app root or `Src/` directory for the `.pa.yaml` slice

`canvas build` behavior depends on the source kind:

- unpacked `.pa.yaml` roots build a native `.msapp` zip by regenerating
  `References/Templates.json` and control payloads from the pinned registry
  while passing through the rest of the unpacked app baseline from the source
  root
- legacy manifest JSON roots still write the deterministic preview JSON package
  payload used by the existing fixture/golden coverage

Current native `.msapp` build expects an unpacked app root that still contains
baseline packaging artifacts such as:

- `Header.json`
- `Properties.json`
- `Controls/1.json`

## Project config wiring

Project config still uses `templateRegistries`:

```yaml
templateRegistries:
  - ./registries/canvas-controls.json
  - cache:seeded-controls
```

Rules:

- relative paths resolve from the project root
- `cache:NAME` resolves to `${cacheDir}/NAME.json` when a cache directory is
  provided to the canvas registry loader
- later registry files override earlier files for the same
  `templateName@templateVersion`

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

Canvas template registries now have first-class lifecycle commands:

- `templates inspect`: summarize a pinned registry snapshot, hashes, and
  provenance coverage
- `templates diff`: compare template and support-rule drift between two
  snapshots
- `templates pin`: normalize a registry into the canonical committed form
- `templates refresh`: re-import a source catalog and optionally diff it against
  the currently pinned snapshot
- `templates audit`: report provenance completeness across imported templates

These commands stay deterministic because they operate on the same normalized
registry document shape used by local validate/build workflows.

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

Supported operations today are:

- `set-property`
- `remove-property`
- `add-control`
- `remove-control`

`patch plan` validates the control paths before any writes occur. `patch apply`
either mutates the app in place or writes a patched copy into `--out`.

## Current boundary

This is still a deliberately narrow support matrix rather than a general canvas
compiler. The implemented workflow is real, but it only claims support for the
declared normalized source shape and the pinned control/template versions that
the registry marks as supported.

Remote canvas operations are also intentionally limited today:

- remote `list` and `inspect` are implemented
- remote `create` defaults to a discoverable preview handoff and optional
  delegated Maker browser automation
- remote `import` is still a discoverable preview placeholder only
- the CLI still does not perform first-class server-side remote blank-app
  creation/import; delegated create depends on Maker browser automation
