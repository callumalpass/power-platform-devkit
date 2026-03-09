# Flow artifacts

The current flow module is split into two first-class surfaces:

- Dataverse-backed discovery and inspection for remote flows
- canonical local `pp.flow.artifact` JSON for unpack, normalize, validate, and
  bounded patching

## Remote commands

List flows from an environment:

```bash
pp flow list --env dev
pp flow list --env dev --solution Core
```

Inspect a remote flow by name, id, or unique name:

```bash
pp flow inspect "Invoice Sync" --env dev
pp flow inspect crd_InvoiceSync --env dev --solution Core
```

Current remote inspection returns:

- flow id, name, and unique name
- state and status codes
- whether client-definition data was present
- parsed connection reference names
- parameter references
- environment-variable references detected from expressions

The current remote slice intentionally targets Dataverse `workflows` plus
solution-component filtering. It does not yet claim a full deploy/runtime
surface.

## Local artifact format

The canonical unpacked artifact is `flow.json`:

```json
{
  "schemaVersion": 1,
  "kind": "pp.flow.artifact",
  "metadata": {
    "name": "Invoice Flow",
    "displayName": "Invoice Flow",
    "connectionReferences": [
      {
        "name": "shared_office365",
        "connectionReferenceLogicalName": "shared_office365"
      }
    ],
    "parameters": {
      "ApiBaseUrl": "https://example.test"
    },
    "environmentVariables": ["pp_ApiUrl"]
  },
  "definition": {
    "actions": {}
  },
  "unknown": {}
}
```

The normalizer accepts either:

- a canonical `pp.flow.artifact`
- a raw exported flow JSON payload with `properties.definition`
- a directory containing `flow.json`

## Local commands

```bash
pp flow unpack ./exports/invoice-flow.json --out ./flows/invoice
pp flow inspect ./flows/invoice
pp flow normalize ./flows/invoice
pp flow validate ./flows/invoice
pp flow patch ./flows/invoice --file ./patches/invoice.dev.json --out ./flows/invoice-dev
```

## Normalization behavior

The current normalizer:

- converts raw exports into the canonical artifact shape
- strips obviously noisy metadata such as `createdTime` and
  `lastModifiedTime`
- preserves unknown fields in `definition` and top-level `unknown`
- applies stable JSON ordering through the shared artifact helpers

## Patch model

The first bounded patch document supports:

- `connectionReferences`
- `parameters`
- `expressions`
- `values`

Example:

```json
{
  "connectionReferences": {
    "shared_office365": "shared_exchangeonline"
  },
  "parameters": {
    "ApiBaseUrl": "https://next.example.test"
  },
  "expressions": {
    "actions.SendMail.inputs.subject": "@{parameters('ApiBaseUrl')}"
  },
  "values": {
    "actions.SendMail.inputs.priority": "High"
  }
}
```

The patcher is deliberately narrow. It updates known connection-reference and
parameter locations plus explicit dotted paths inside the real definition
payload without inventing a separate DSL.

## Validation boundary

Current validation checks:

- artifact has a name/display name
- definition payload exists
- connection reference names are present and non-duplicated

This is the artifact-first foundation for the runtime diagnostics and doctor
work that follows.
