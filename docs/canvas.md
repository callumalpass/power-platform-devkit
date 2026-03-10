# Canvas registries

Canvas support starts with pinned template metadata. The current `@pp/canvas`
surface now includes:

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

## CLI commands

```bash
pp canvas validate ./apps/MyCanvas --project .
pp canvas lint ./apps/MyCanvas --project .
pp canvas inspect ./apps/MyCanvas --project . --mode strict
pp canvas build ./apps/MyCanvas --project . --out ./dist/MyCanvas.msapp
pp canvas diff ./apps/MyCanvas ./apps/MyCanvas-next
pp canvas templates import ./fixtures/canvas/registries/import-source.json --out ./tmp/runtime-registry.json --source imported-catalog --acquired-at 2026-03-10T00:00:00.000Z
```

Useful flags:

- `--project` to resolve `templateRegistries` from `pp.config.*`
- repeated `--registry FILE` to override project registries
- `--mode strict|seeded|registry`
- `--cache-dir` for `cache:NAME` registry references
- `--out` for build output
- `canvas templates import` also accepts provenance overrides:
  `--kind`, `--source`, `--acquired-at`, `--source-artifact`,
  `--source-app-id`, `--platform-version`, and `--app-version`

Path detection is automatic:

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

## Current boundary

This is still a deliberately narrow support matrix rather than a general canvas
compiler. The implemented workflow is real, but it only claims support for the
declared normalized source shape and the pinned control/template versions that
the registry marks as supported.
