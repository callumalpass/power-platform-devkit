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
pp flow export "Invoice Sync" --env dev --solution Core --out ./flows/invoice-remote
pp flow promote "Invoice Sync" --source-environment dev --source-solution Core --target-environment test --target-solution Core
pp flow promote "Invoice Sync" --source-environment dev --source-solution Core --target-environment test --solution-package --managed-solution-package --holding-solution --no-publish-workflows
```

Current remote inspection returns:

- flow id, name, bounded description metadata, and unique name
- bounded workflow-shell metadata for `type`, `mode`, `ondemand`, and
  `primaryentity` when present
- normalized workflow state labels plus the underlying state and status codes
- whether client-definition data was present
- parsed connection reference names
- parameter references
- environment-variable references detected from expressions

The current remote slice intentionally targets Dataverse `workflows` plus
solution-component filtering, bounded export/deploy/create flows, and a bounded
remote-to-remote promotion path. It does not yet claim a full
solution-packaged import/export surface.

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
  connection-reference heuristic and now includes latest-seen timing plus
  aggregate duration/retry metadata per cluster
- `flow connrefs` combines runtime failures with connection-reference and
  environment-variable health, and now attaches source-node locations when the
  remote flow's `clientdata` still contains a supported definition payload
- `flow doctor` produces a compact pre-triaged report with recent failures,
  grouped errors, invalid connection references, missing environment variables,
  synthesized findings, runtime status/duration/retry summaries, daily trend
  buckets, and a first runtime-to-source correlation slice that maps supported
  connection-reference or environment-variable evidence back to normalized
  action/trigger nodes

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
    "description": "Synchronize invoice payloads to downstream systems.",
    "category": 5,
    "workflowMetadata": {
      "type": 1,
      "mode": 0,
      "onDemand": false,
      "primaryEntity": "none"
    },
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
pp flow export "Invoice Sync" --env dev --solution Core --out ./flows/invoice-remote
pp flow inspect ./flows/invoice
pp flow normalize ./flows/invoice
pp flow validate ./flows/invoice
pp flow graph ./flows/invoice
pp flow patch ./flows/invoice --file ./patches/invoice.dev.json --out ./flows/invoice-dev
pp flow pack ./flows/invoice-dev --out ./dist/invoice-flow.raw.json
pp flow deploy ./flows/invoice-dev --env dev --solution Core
pp flow deploy ./flows/invoice-dev --env dev --solution Core --create-if-missing --workflow-state activated
pp flow promote "Invoice Sync" --source-environment dev --source-solution Core --target-environment test --target-solution Core --create-if-missing --workflow-state draft
```

## Normalization behavior

The current normalizer:

- converts raw exports into the canonical artifact shape
- strips obviously noisy metadata such as `createdTime` and
  `lastModifiedTime`
- preserves unknown fields in `definition` and top-level `unknown`
- applies stable JSON ordering through the shared artifact helpers

`pp flow export <name|id|uniqueName> --environment ALIAS --out PATH` now pulls a
remote cloud flow back into the canonical `pp.flow.artifact` shape when the
remote `workflows.clientdata` still exposes a supported definition payload, so a
source environment can feed the same local normalize/validate/patch/graph path
as exported JSON artifacts. `pp flow pack <path> --out <file.json>` repacks a
canonical `pp.flow.artifact` back into a raw export-shaped JSON payload so a
local flow can move through unpack, patch, validate, and repack without
hand-editing the Maker export shape. `pp flow deploy <path> --environment ALIAS`
now carries that lifecycle one step further for an already-existing target cloud
flow by validating the local artifact, resolving a remote workflow by `--target`
or the artifact metadata (`uniqueName`, then `name`, then `displayName`, then
`id`), and PATCHing the normalized definition plus a bounded workflow-shell
metadata slice (`name`, `description`, `category`, `type`, `mode`,
`ondemand`, `primaryentity`, `statecode`, and `statuscode` when present)
back into Dataverse `workflows`.
Supported workflow state/status metadata is now validated and normalized as part
of that lifecycle: the current bounded surface accepts Draft `(0,1)`,
Activated `(1,2)`, and Suspended `(2,3)` pairs, infers the missing side when
only one of those codes is supplied locally, and fails invalid combinations
before repack or remote mutation.
Direct remote lifecycle commands can now also override that bounded state at
mutation time with `--workflow-state draft|activated|suspended` on
`pp flow deploy` and artifact-mode `pp flow promote`, which lets engineers
promote or deploy the same validated artifact into a target environment with a
different supported activation state without editing the local artifact JSON.
Remote inspection plus export/deploy/promote results now also surface the
normalized workflow-state label alongside raw `stateCode` / `statusCode`, so
automation and CLI users do not need to decode the supported Dataverse pairs
manually.
Those same remote source/target summaries now retain bounded workflow
`description` and `category` fields too, so lifecycle automation can inspect
the shell metadata that export/deploy/promote already preserve without
re-reading the local artifact or Dataverse row separately.
The same bounded lifecycle also enforces the supported cloud-flow category
contract: when `category` is declared locally it must remain `5`, and when it
is omitted the repack and direct deploy surfaces normalize it back to category
`5` instead of leaving the cloud-flow shell ambiguous.
The bounded workflow-shell metadata contract is now explicit too: supported
cloud flows currently require `type: 1`, `mode: 0`, `ondemand: false`, and
`primaryentity: "none"`. Local validation fails unsupported values, while
repack and direct deploy/create normalize omitted shell fields back to those
cloud-flow defaults.
When `--create-if-missing` is supplied, the same command can also provision a
bounded missing cloud-flow shell using the artifact `metadata.uniqueName`,
bounded workflow metadata, and the normalized `clientdata` definition.
`pp flow promote <name|id|uniqueName> --source-environment SRC --target-environment DST`
builds directly on the same contract: it exports a supported remote source flow
into the canonical artifact model in memory, runs the shared local validator,
then deploys that normalized definition into the target environment with the
same `--target` and `--create-if-missing` behavior as local artifact deploy.
The canonical artifact now also preserves bounded non-definition
`workflows.clientdata` sibling fields, so remote export, local artifact edits,
repack, deploy, create-if-missing, and artifact-mode promotion no longer drop
that supported `clientdata` context by default.
When `--solution` on deploy or `--target-solution` on artifact-mode promotion is
supplied, the direct flow lifecycle now also runs remote target-environment
checks over the projected post-patch connection references and environment
variables before mutation: missing target solution assets fail fast, while
unbound connection references or environment variables without an effective
value surface as warnings in the deploy result.
When `--solution-package` is supplied, `pp flow promote` can also take a
solution-scoped route for the selected flow: it verifies that the flow exists
inside `--source-solution`, runs the same bounded local validator against the
normalized source artifact, exports the whole containing solution through the
shared solution service, and imports that package into the target environment.
`--managed-solution-package` switches that package export from unmanaged to
managed. This route is intentionally whole-solution and does not support
`--target` or `--create-if-missing`, but it now forwards the same bounded
solution-import controls as `pp solution import`:
`--overwrite-unmanaged-customizations`, `--holding-solution`,
`--skip-product-update-dependencies`, `--no-publish-workflows`, and
`--import-job-id`.

The current pack/deploy boundary is:

- remote export currently requires `workflows.clientdata.definition` to remain
  available and JSON-shaped, and it preserves bounded non-definition sibling
  fields from `workflows.clientdata` in the canonical local artifact instead
  of flattening them away
- writes a raw `properties.definition` payload plus supported metadata fields
  such as `displayName`, `name`, `description`, `uniquename`, `category`,
  `type`, `mode`, `ondemand`, `primaryentity`, `statecode`, and `statuscode`
- repack also restores the supported top-level raw workflow shell fields
  (`name`, `description`, `uniquename`, `category`, `type`, `mode`,
  `ondemand`, `primaryentity`, `statecode`, `statuscode`) instead of
  narrowing them down to `properties.*` only
- repack also restores that bounded preserved `clientdata` context alongside
  `properties.definition` so local export/edit/repack flows can round-trip the
  supported remote payload shape
- preserves top-level unknown fields captured during normalization
- intentionally does not reintroduce stripped noisy timestamps such as
  `createdTime` or `lastModifiedTime`
- local validation now fails unsupported workflow `statecode` / `statuscode`
  combinations, and repack/deploy/create normalize supported one-sided values
  onto the canonical Draft `(0,1)`, Activated `(1,2)`, or Suspended `(2,3)`
  pair before writing a raw export or Dataverse payload
- local validation also fails unsupported workflow `category` values; the
  current direct lifecycle only supports Dataverse cloud flows (`category: 5`)
- local validation also fails unsupported workflow shell metadata values; the
  current direct lifecycle only supports the canonical cloud-flow shell
  `type: 1`, `mode: 0`, `ondemand: false`, and `primaryentity: "none"`, and
  repack/deploy/create normalize omitted shell fields back to those defaults
- remote deploy currently updates only a bounded workflow shell (`name`,
  `description`, `category`, `type`, `mode`, `ondemand`, `primaryentity`,
  `statecode`, `statuscode`) plus the normalized `clientdata` definition and
  any preserved bounded `clientdata` siblings after the shared local validator
  passes, and when a destination solution scope is supplied it also checks that
  projected connection references and environment variables exist there before
  mutation, unless `--create-if-missing` is used; when `metadata.uniqueName`
  is declared it must also match the resolved existing target workflow instead
  of silently retargeting another flow by name or id; `--workflow-state` can
  override the bounded state/status pair for that mutation without changing the
  local artifact
- remote promotion currently transfers that same bounded workflow shell plus
  the normalized definition, including the same solution-scoped target checks
  for artifact-mode promotion; artifact-mode promotion also accepts the same
  `--workflow-state` override, while solution-package promotion intentionally
  does not because it imports the packaged workflow state as-is
- `pp flow promote --solution-package` imports the whole selected solution that
  contains the flow, preserves the packaged solution unique name, requires
  `--source-solution`, does not support `--target` or `--create-if-missing`,
  and accepts the same bounded import controls as `pp solution import`
- create-if-missing currently requires artifact `metadata.uniqueName`, creates
  only a bounded workflow shell (`category`, `name`, `description`,
  `uniquename`, `type`, `mode`, `ondemand`, `primaryentity`,
  `statecode`/`statuscode` when present, plus normalized `clientdata`), and
  fails explicitly instead of guessing if the same flow already exists outside
  the requested solution filter
- solution-packaged import/export and broader workflow metadata or state
  transitions still belong to later deploy-oriented work

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
  "variables": {
    "counter": "runCount"
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
parameter locations, supports bounded action-identifier and variable-name
rewrites, and applies explicit dotted paths inside the real definition payload
without inventing a separate DSL.

Current action rename support is intentionally bounded:

- renames action keys inside supported `actions` containers
- rewrites supported `runAfter` targets and supported
  `actions('...')` / `body('...')` / `outputs('...')` references
- rejects rename chains or target-name collisions instead of guessing through
  ambiguous rewrites

Current variable rename support is intentionally bounded:

- renames supported `InitializeVariable.inputs.variables[*].name` declarations
- rewrites supported variable-write action targets such as `SetVariable`,
  `IncrementVariable`, `DecrementVariable`, and append-variable actions
- rewrites supported `variables('...')` references
- rejects rename chains or target-name collisions instead of guessing through
  ambiguous variable merges

Current connection-reference and environment-variable rename support is
intentionally bounded:

- renames declared `metadata.connectionReferences[*]` entries plus the
  canonical `definition.parameters.$connections.value.<name>` keys
- rewrites supported `parameters('$connections')['...']` references, including
  canonical connector host connection-name expressions
- rewrites supported `environmentVariables('...')` references with either
  single-quoted or double-quoted names
- rejects missing rename sources, rename chains, or target-name collisions
  instead of silently leaving stale references behind

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
  - the OpenAPI manifest can now declare connector bucket normalization modes
    for the bounded supported slice so official definitions can derive the
    Power Automate artifact bucket shape directly:
    `flattened` for connectors whose path/query inputs land in
    `inputs.parameters`, and `native-plus-parameters` for connectors like the
    current Dataverse slice that accept both compact `inputs.parameters` and
    explicit `inputs.pathParameters` / `inputs.queries`
  - the same manifest can also append bounded operation-specific parameter
    augmentations when the checked-in connector snapshot omits a
    Power-Automate-visible field, and overlay operations now merge at the
    parameter level instead of replacing the whole derived contract
  - the first bounded OpenAPI-ingested slice currently covers selected
    `shared_office365`, `shared_sharepointonline`, and
    `shared_commondataserviceforapps` operations, and the remaining overlay is
    now thinner because Office 365 plus selected SharePoint and Dataverse
    bucket quirks derive from the manifest instead of being duplicated as full
    local operation tables
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
