# Canvas registries

Canvas support starts with pinned template metadata. The current `@pp/canvas`
surface defines the registry document, provenance model, support-matrix rules,
and deterministic path resolution that later build commands consume.

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

This tranche establishes the registry contract and support evaluation helpers.
The canvas validate/build/inspect/diff commands land in the next backlog item.
