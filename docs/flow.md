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

## Runtime commands

The runtime slice is read-first and currently marked `experimental` because it
depends on the FlowRun ingestion surface being available and reasonably fresh in
the target environment.

```bash
pp flow runs "Invoice Sync" --env dev --since 7d
pp flow errors "Invoice Sync" --env dev --group-by connectionReference
pp flow connrefs "Invoice Sync" --env dev --solution Core
pp flow doctor "Invoice Sync" --env dev --solution Core --since 7d
```

Current behavior:

- `flow runs` returns recent run summaries with status, duration, retries, and
  error fields
- `flow errors` groups failed runs by `errorCode`, `errorMessage`, or a
  connection-reference heuristic
- `flow connrefs` combines runtime failures with connection-reference and
  environment-variable health, and now attaches source-node locations when the
  remote flow's `clientdata` still contains a supported definition payload
- `flow doctor` produces a compact pre-triaged report with recent failures,
  grouped errors, invalid connection references, missing environment variables,
  synthesized findings, and a first runtime-to-source correlation slice that
  maps supported connection-reference or environment-variable evidence back to
  normalized action/trigger nodes

Known limits in this slice:

- runtime ingestion can lag behind the maker portal view
- connector grouping is heuristic until richer runtime fields are exposed
- source correlation is only available when Dataverse `workflows.clientdata`
  still includes a supported definition shape, and error-group correlation is
  currently limited to connection-reference name matches from the group key or
  sample error message
- the runtime tables are treated as read-only evidence, not a mutation surface

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
pp flow graph ./flows/invoice
pp flow patch ./flows/invoice --file ./patches/invoice.dev.json --out ./flows/invoice-dev
pp flow pack ./flows/invoice-dev --out ./dist/invoice-flow.raw.json
```

## Normalization behavior

The current normalizer:

- converts raw exports into the canonical artifact shape
- strips obviously noisy metadata such as `createdTime` and
  `lastModifiedTime`
- preserves unknown fields in `definition` and top-level `unknown`
- applies stable JSON ordering through the shared artifact helpers

`pp flow pack <path> --out <file.json>` now repacks a canonical
`pp.flow.artifact` back into a raw export-shaped JSON payload so a local flow
can move through unpack, patch, validate, and repack without hand-editing the
Maker export shape. The current packer:

- writes a raw `properties.definition` payload plus supported metadata fields
  such as `displayName`, `name`, `uniquename`, `statecode`, and `statuscode`
- preserves top-level unknown fields captured during normalization
- intentionally does not reintroduce stripped noisy timestamps such as
  `createdTime` or `lastModifiedTime`
- stops at local raw-export generation; remote import/promotion still belongs
  to later deploy-oriented work

The flow package now also exposes a first-class parsed intermediate
representation over the unpacked artifact. The current IR is intentionally
artifact-first and bounded:

- every trigger, action, and scope receives a stable hierarchical id derived
  from its normalized definition path
- scope-like actions (`Scope`, `If`, `Switch`, `Foreach`, `Until`) are modeled
  explicitly as scope nodes instead of anonymous JSON containers
- parent-child relationships, branch membership (`actions`, `else`, `default`,
  and named `case:*` branches), and declared `runAfter` dependencies are
  preserved for downstream diagnostics and refactors
- each parsed node now carries a local control-flow/data-flow slice:
  - resolved and unresolved `runAfter` edges plus reverse dependents
  - supported workflow-expression occurrences for both whole-expression values
    and embedded `@{...}` template segments
  - dynamic-content references for supported parameters, environment
    variables, action outputs, variables, and `$connections` lookups
  - variable initialization and write targets for supported variable actions

`pp flow graph <path>` builds on that IR and emits a dependency-oriented local
inspection report with:

- normalized workflow nodes annotated with child scopes, `runAfter`
  dependencies, reverse dependents, and per-node reference counts
- graph edges for containment, control-flow dependencies, action-output reads,
  parameter/environment-variable/connection-reference reads, and variable
  reads/writes
- declared resource summaries for parameters, environment variables,
  connection references, and variables with the nodes that initialize, read, or
  write them
- a small hotspot summary so high-fan-in, high-fan-out, and
  reference-dense nodes are obvious without hand-walking the JSON

## Patch model

The first bounded patch document supports:

- `actions`
- `connectionReferences`
- `parameters`
- `expressions`
- `values`

Example:

```json
{
  "actions": {
    "SendMail": "ComposeMail"
  },
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
parameter locations, supports bounded action-identifier rewrites, and applies
explicit dotted paths inside the real definition payload without inventing a
separate DSL.

Current action rename support is intentionally bounded:

- renames action keys inside supported `actions` containers
- rewrites supported `runAfter` targets and supported
  `actions('...')` / `body('...')` / `outputs('...')` references
- rejects rename chains or target-name collisions instead of guessing through
  ambiguous rewrites

## Validation boundary

Current validation checks:

- artifact has a name/display name
- definition payload exists
- connection reference names are present and non-duplicated
- declared `metadata.connectionReferences` stay coherent with
  `definition.parameters.$connections.value` for the supported canonical shape
- supported `$connections` expression references resolve to declared
  connection-reference keys
- supported connector-action checks now cover `OpenApiConnection` and
  `OpenApiConnectionWebhook` nodes where:
  - `inputs.host.connection.name` uses the canonical
    `@parameters('$connections')['<name>']['connectionId']` form
  - `inputs.host.apiId` is present
  - a supported `operationId` is present
  - the action-level `apiId` matches the resolved connection-reference `apiId`
- supported connector-operation contracts now validate bounded required-field
  and typed optional-field shapes across supported input buckets, currently
  covering:
  - the supported contract inventory is now loaded through a generated local
    registry module built from checked-in connector-definition snapshots listed
    in `packages/flow/connector-operation-openapi.source.json`, then merged
    with a thin local overlay in
    `packages/flow/connector-operation-registry.source.json` via
    `pnpm --filter @pp/flow generate:connector-registry`
  - the first bounded OpenAPI-ingested slice currently covers selected
    `shared_office365`, `shared_sharepointonline`, and
    `shared_commondataserviceforapps` operations while the overlay preserves
    Power Automate-specific bucket and shape quirks plus the wider supported
    inventory
  - `shared_office365` `SendEmailV2` with required
    `inputs.parameters.emailMessage/To`,
    `inputs.parameters.emailMessage/Subject`, and
    `inputs.parameters.emailMessage/Body`
  - `shared_office365` `GetEmailV2` with required
    `inputs.parameters.messageId`, plus bounded optional
    `inputs.parameters.mailboxAddress`,
    `inputs.parameters.includeAttachments`,
    `inputs.parameters.internetMessageId`,
    `inputs.parameters.extractSensitivityLabel`, and
    `inputs.parameters.fetchSensitivityLabelMetadata`
  - `shared_office365` `DeleteEmail_V2` with required
    `inputs.parameters.messageId`, plus optional
    `inputs.parameters.mailboxAddress`
  - `shared_office365` `MoveV2` with required
    `inputs.parameters.messageId` and `inputs.parameters.folderPath`, plus
    optional `inputs.parameters.mailboxAddress`
  - `shared_office365` `MarkAsRead_V3` with required
    `inputs.parameters.messageId` and `inputs.parameters.isRead`, plus
    optional `inputs.parameters.mailboxAddress`
  - `shared_office365` `V4CalendarPostItem` with required
    `inputs.parameters.table`, `inputs.parameters.subject`,
    `inputs.parameters.start`, `inputs.parameters.end`, and
    `inputs.parameters.timeZone`, plus optional
    `inputs.parameters.requiredAttendees` and
    `inputs.parameters.optionalAttendees`
  - `shared_office365` `V4CalendarPatchItem` with required
    `inputs.parameters.table`, `inputs.parameters.id`,
    `inputs.parameters.subject`, `inputs.parameters.start`,
    `inputs.parameters.end`, and `inputs.parameters.timeZone`, plus optional
    `inputs.parameters.requiredAttendees` and
    `inputs.parameters.optionalAttendees`
  - `shared_sharepointonline` `CreateItem` with required
    `inputs.parameters.dataset`, `inputs.parameters.table`, and
    `inputs.parameters.item/Title`
  - `shared_sharepointonline` `GetItem` with required
    `inputs.parameters.dataset`, `inputs.parameters.table`, and
    `inputs.parameters.id`, plus optional `inputs.parameters.view`
  - `shared_sharepointonline` `GetItems` with required
    `inputs.parameters.dataset` and `inputs.parameters.table`, plus bounded
    optional query/list settings including `inputs.parameters.$filter`,
    `inputs.parameters.$orderby`, `inputs.parameters.$top`,
    `inputs.parameters.view`, `inputs.parameters.folderPath`,
    `inputs.parameters.includeNestedItems`, and
    `inputs.parameters.limitColumnsByView`
  - `shared_sharepointonline` `PatchItem` with required
    `inputs.parameters.dataset`, `inputs.parameters.table`, and
    `inputs.parameters.id`, plus a required row payload expressed either as
    `inputs.parameters.item` or one-or-more flattened
    `inputs.parameters.item/<column>` entries, and optional
    `inputs.parameters.view`
  - `shared_sharepointonline` `DeleteItem` with required
    `inputs.parameters.dataset`, `inputs.parameters.table`, and
    `inputs.parameters.id`
  - `shared_sharepointonline` `CreateNewFolder` with required
    `inputs.parameters.dataset`, `inputs.parameters.table`, and
    `inputs.parameters.path`
  - `shared_sharepointonline` `CreateFile` with required
    `inputs.parameters.dataset`, `inputs.parameters.folderPath`,
    `inputs.parameters.name`, and `inputs.parameters.body`
  - `shared_sharepointonline` `GetFileMetadata` with required
    `inputs.parameters.dataset` and `inputs.parameters.id`
  - `shared_sharepointonline` `GetFileMetadataByPath` with required
    `inputs.parameters.dataset` and `inputs.parameters.path`
  - `shared_sharepointonline` `GetFileItem` with required
    `inputs.parameters.dataset`, `inputs.parameters.table`, and
    `inputs.parameters.id`, plus optional `inputs.parameters.view`
  - `shared_sharepointonline` `GetFileItems` with required
    `inputs.parameters.dataset` and `inputs.parameters.table`, plus bounded
    optional library query settings including `inputs.parameters.$filter`,
    `inputs.parameters.$orderby`, `inputs.parameters.$top`,
    `inputs.parameters.folderPath`, `inputs.parameters.view`, and
    `inputs.parameters.viewScopeOption`
  - `shared_sharepointonline` `GetFileContent` with required
    `inputs.parameters.dataset` and `inputs.parameters.id`, plus optional
    `inputs.parameters.inferContentType`
  - `shared_sharepointonline` `GetFileContentByPath` with required
    `inputs.parameters.dataset` and `inputs.parameters.path`, plus optional
    `inputs.parameters.inferContentType`
  - `shared_sharepointonline` `UpdateFile` with required
    `inputs.parameters.dataset`, `inputs.parameters.id`, and
    `inputs.parameters.body`
  - `shared_sharepointonline` `DeleteFile` with required
    `inputs.parameters.dataset` and `inputs.parameters.id`
  - `shared_sharepointonline` `CopyFileAsync` with required
    `inputs.parameters.dataset`, `inputs.parameters.sourceFileId`,
    `inputs.parameters.destinationDataset`,
    `inputs.parameters.destinationFolderPath`, and
    `inputs.parameters.nameConflictBehavior`
  - `shared_sharepointonline` `MoveFileAsync` with required
    `inputs.parameters.dataset`, `inputs.parameters.sourceFileId`,
    `inputs.parameters.destinationDataset`,
    `inputs.parameters.destinationFolderPath`, and
    `inputs.parameters.nameConflictBehavior`
  - `shared_sharepointonline` `CopyFolderAsync` with required
    `inputs.parameters.dataset`, `inputs.parameters.sourceFolderId`,
    `inputs.parameters.destinationDataset`,
    `inputs.parameters.destinationFolderPath`, and
    `inputs.parameters.nameConflictBehavior`
  - `shared_sharepointonline` `MoveFolderAsync` with required
    `inputs.parameters.dataset`, `inputs.parameters.sourceFolderId`,
    `inputs.parameters.destinationDataset`,
    `inputs.parameters.destinationFolderPath`, and
    `inputs.parameters.nameConflictBehavior`
  - `shared_sharepointonline` `GetFolderMetadata` with required
    `inputs.parameters.dataset` and `inputs.parameters.id`
  - `shared_sharepointonline` `GetFolderMetadataByPath` with required
    `inputs.parameters.dataset` and `inputs.parameters.path`
  - `shared_commondataserviceforapps` `ListRecords` with required
    `inputs.parameters.entityName` or `inputs.pathParameters.entityName` plus
    typed optional query inputs accepted from either `inputs.parameters` or
    `inputs.queries`, including `$select`, `$filter`, `$orderby`, `$expand`,
    `fetchXml`, `$top`, `$skiptoken`, `partitionId`,
    `returntotalrecordcount`, and `x-ms-odata-metadata-full`
  - `shared_commondataserviceforapps` `GetItem` with required
    `inputs.parameters.entityName` / `inputs.parameters.recordId` or
    `inputs.pathParameters.entityName` /
    `inputs.pathParameters.recordId` plus typed optional query inputs accepted
    from either `inputs.parameters` or `inputs.queries`, including `$select`,
    `$expand`, `partitionId`, and `x-ms-odata-metadata-full`
  - `shared_commondataserviceforapps` `CreateRecord` with required
    `inputs.parameters.entityName` or `inputs.pathParameters.entityName` plus
    a required row payload expressed either as `inputs.parameters.item` or
    one-or-more flattened `inputs.parameters.item/<column>` entries, plus
    optional `x-ms-odata-metadata-full` from either `inputs.parameters` or
    `inputs.queries`
  - `shared_commondataserviceforapps` `UpdateOnlyRecord` with required
    `inputs.parameters.entityName` / `inputs.parameters.recordId` or
    `inputs.pathParameters.entityName` /
    `inputs.pathParameters.recordId` plus the same bounded row-payload support
    as `CreateRecord` and optional `x-ms-odata-metadata-full`
  - `shared_commondataserviceforapps` `DeleteRecord` with required
    `inputs.parameters.entityName` / `inputs.parameters.recordId` or
    `inputs.pathParameters.entityName` /
    `inputs.pathParameters.recordId`, plus optional `partitionId` accepted
    from either `inputs.parameters` or `inputs.queries`
  - required string fields must remain string literals or string-valued
    expressions, integer fields must remain integer literals or whole
    expressions, and boolean fields must remain boolean literals or whole
    expressions instead of arrays or nested objects
  - bounded binary file payload checks accept direct string literals, whole
    expressions, or canonical `$content` / `$content-type` wrapper objects and
    fail unsupported array/object payload shapes locally
  - bounded Dataverse row payload checks accept object-valued `item` payloads
    or flattened `item/<column>` scalars / whole expressions, and fail
    missing row payloads or nested array/object field shapes locally
- unsupported connector connection-name shapes fail explicitly instead of being
  guessed during contract validation
- supported workflow-expression parsing covers both whole-expression values
  (for example `@parameters('Name')` or `@{variables('X')}`) and embedded
  template segments inside larger strings
- supported expression references resolve for:
  - `parameters('...')`
  - `variables('...')`
  - `actions('...')`, `body('...')`, and `outputs('...')`
- supported variable write operations (`InitializeVariable`, `SetVariable`,
  append, increment, decrement) target declared variables
- `runAfter` dependencies point at known trigger or action nodes
- reliability warnings surface for enabled trigger/action concurrency and high
  retry counts

Validation now also returns a `semanticSummary` with trigger/action/scope
counts, expression and template-expression counts, initialized variable names,
variable read/write counts, dynamic-content reference counts, control-flow edge
counts, and supported reference counts so fixture and CLI outputs can
correlate diagnostics back to the normalized source model. It also returns an
`intermediateRepresentation` summary with parsed node counts plus
control-flow/data-flow totals from the stable IR surface, and each parsed node
retains the supported expression occurrences that produced its reference slice.

The new graph report reuses that same parsed model directly instead of asking
consumers to reconstruct control-flow and data-flow relationships themselves.

The shared deploy preflight now reuses this validator for `flow-parameter`,
`flow-connref`, and `flow-envvar` mappings, so the same supported semantic
errors fail before deploy-time artifact mutation and warning-only reliability
findings appear in the deploy check set. When deploy also has a resolved target
environment and solution, that shared preflight now checks the projected
connection-reference logical names and environment-variable schema names
against the destination solution, failing missing targets before apply and
warning when the remote target exists but is not runtime-ready.

This is the artifact-first foundation for the runtime diagnostics and doctor
work that follows.
