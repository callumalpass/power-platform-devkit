# Dataverse and solutions

The `pp` CLI provides environment-alias-driven access to Dataverse. You authenticate through an auth profile, bind an environment alias to that profile, and then run `dv` or `solution` commands against the alias.

If you are new to `pp`, run these four commands first to confirm that auth, environment targeting, and solution listing all work:

```bash
pp dv whoami --env dev
pp dv query accounts --env dev --select name,accountnumber --top 5
pp solution list --env dev
pp solution inspect Core --env dev
```

Once those paths are working, use the rest of this guide as needed. The sections are organized around the tasks you are most likely to do: querying data, mutating rows, inspecting or authoring metadata, and working with solutions. If you already know what you need, jump directly to the relevant section. If you are exploring, read linearly from here -- each section builds on the concepts introduced earlier.

## Prerequisite

Before any `dv` or `solution` command will work, you need an auth profile and an environment alias pointing at it:

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
```

## Verifying access with `dv whoami`

The `dv whoami` command calls the Dataverse `WhoAmI()` function and returns the `BusinessUnitId`, `OrganizationId`, and `UserId` along with the resolved environment alias and auth profile. It is the fastest way to confirm that your credentials and environment alias are configured correctly.

```bash
pp dv whoami --env dev
pp dv whoami --env dev --format json
```

Use `--format json` when you need machine-readable output.

## Querying data with `dv query` and `dv get`

`dv query` retrieves a collection of rows from a logical table. You control which columns come back with `--select`, restrict results with `--filter` (any valid OData filter expression), order them with `--orderby`, and cap the count with `--top`. Pass `--expand` to inline related records, and `--count` to include the total row count in the response.

```bash
pp dv query accounts --env dev
pp dv query accounts --env dev --select name,accountnumber --top 10
pp dv query solutions --env dev --filter "uniquename eq 'Core'"
pp dv query accounts --env dev --expand primarycontactid($select=fullname) --orderby name asc --count
```

For paging, `--all` follows `@odata.nextLink` until the full result set is collected, while `--page-info` returns just the first page together with the `count` and `nextLink`. You can also tune page size with `--max-page-size`. The `--annotations` flag controls OData annotation inclusion, and `--format` sets the output format.

```bash
pp dv query accounts --env dev --all
pp dv query accounts --env dev --page-info
```

When you need a single row rather than a collection, use `dv get` with the logical table name and GUID. It supports `--select`, `--expand`, and `--annotations`.

```bash
pp dv get accounts 00000000-0000-0000-0000-000000000001 --env dev --select name
```

## Mutating rows with `dv create`, `dv update`, and `dv delete`

These three commands map directly to Dataverse POST, PATCH, and DELETE operations on entity collections.

`dv create` inserts a new row. Pass the payload as inline JSON with `--body` or from a file with `--body-file`. Adding `--return-representation` tells Dataverse to return the created record, which you can further shape with `--select` and `--expand`. The `--if-match` and `--if-none-match` flags set the corresponding HTTP concurrency headers, and `--annotations` controls OData annotation inclusion.

```bash
pp dv create accounts --env dev --body '{"name":"Acme"}'
pp dv create accounts --env dev --body-file ./account.json --return-representation
```

`dv update` patches an existing row identified by table name and GUID. It accepts the same flags as `dv create`.

```bash
pp dv update accounts 00000000-0000-0000-0000-000000000001 \
  --env dev \
  --body '{"name":"Renamed"}'
```

`dv delete` removes a row. The only additional flag beyond `--env` is `--if-match` for concurrency control.

```bash
pp dv delete accounts 00000000-0000-0000-0000-000000000001 --env dev
```

When you are unsure about the data, prefer read commands first and inspect the resolved output before running mutations.

## Row-set workflows with `dv rows`

When you need to export or apply batches of rows without hand-writing HTTP batch fragments, use `dv rows`.

### Exporting rows

`dv rows export` queries a table slice and writes the result as a stable row-set artifact. It accepts the same query flags as `dv query` (`--select`, `--expand`, `--orderby`, `--top`, `--filter`, `--count`, `--all`, `--max-page-size`, `--annotations`) and adds `--out` to write the result to a file. When `--out` is provided, the file extension determines the format: `.json` writes JSON and `.yaml` or `.yml` write YAML. Without `--out`, the artifact prints to stdout.

```bash
pp dv rows export accounts --env dev --select accountid,name --all --out ./artifacts/accounts.yaml
pp dv rows export contacts --env dev --filter "statecode eq 0" --top 100
```

### Applying row mutations

`dv rows apply` sends a typed row-mutation manifest through Dataverse batch. Pass `--continue-on-error` to allow partial success, `--solution` to scope the batch to a specific solution, and `--annotations` or `--format` as needed.

```bash
pp dv rows apply --env dev --file ./specs/account-ops.yaml
pp dv rows apply --env dev --file ./specs/account-ops.yaml --continue-on-error --solution Core
```

The manifest uses `table` to set the default entity collection and `operations` to list individual mutations. Supported operation kinds are `create`, `update`, `upsert`, and `delete`. For `update` and `upsert`, you can target either a `path` directly or a `table` plus `recordId`. `create` uses the collection path for the resolved table. `delete` ignores `body`.

```yaml
table: accounts
operations:
  - kind: create
    requestId: create-account
    body:
      name: Acme
      accountnumber: A-1000
  - kind: upsert
    requestId: upsert-account
    path: accounts(accountnumber='A-1000')
    ifMatch: "*"
    body:
      telephone1: +1 555 0100
  - kind: delete
    requestId: delete-account
    recordId: 00000000-0000-0000-0000-000000000001
```

## Batch requests with `dv batch`

`dv batch` executes a Dataverse `$batch` manifest from a file. Use `--continue-on-error` to allow partial success, `--solution` to scope the batch to a specific solution, and `--annotations` to control OData annotations.

```bash
pp dv batch --env dev --file ./specs/account-batch.yaml
```

A batch manifest lists individual requests, each with an `id`, `method`, and `path`. Requests that should be atomically grouped share an `atomicGroup` value:

```yaml
requests:
  - id: query
    method: GET
    path: accounts?$select=accountid,name
  - id: update
    method: PATCH
    path: accounts(00000000-0000-0000-0000-000000000001)
    atomicGroup: writes
    body:
      name: Updated from batch
```

## Low-level Web API access

When the typed helpers do not cover your use case, three commands give you direct access to the Dataverse Web API.

### `dv request`

`dv request` sends an arbitrary HTTP request to the Web API path you supply. You can set the HTTP method with `--method` (defaults to GET), pass a request body with `--body` or `--body-file`, add headers with repeatable `--header "Name: value"` flags, and control response parsing with `--response-type` (`json`, `text`, or `void`).

```bash
pp dv request "EntityDefinitions?\$select=LogicalName,SchemaName" --env dev
```

```bash
pp dv request "accounts" \
  --env dev \
  --method POST \
  --body '{"name":"Acme"}'
```

### `dv action`

`dv action` invokes a named Dataverse action. It works like `dv request` but is scoped to actions specifically: pass the action name as the first argument, supply a body with `--body` or `--body-file`, and use `--bound-path` when the action is bound to a specific entity instance. The `--solution` flag sets the `MSCRM.SolutionUniqueName` header.

```bash
pp dv action ExportSolution --env dev --body '{"SolutionName":"Core","Managed":false}'
pp dv action AddToQueue --env dev --bound-path 'queues(<queue-id>)' --body-file ./queue-item.json
```

### `dv function`

`dv function` invokes a named Dataverse function. Pass simple parameters with repeatable `--param key=value` flags, or JSON-typed parameters with `--param-json key=JSON`. Like `dv action`, it supports `--bound-path` for bound functions and `--response-type` for controlling response parsing.

```bash
pp dv function sample_GetCount --env dev --param logicalName=account
pp dv function RetrieveTotalRecordCount --env dev --param-json includeInternal=false
```

## Connection references

Connection references are first-class ALM objects that you can list, inspect, and validate through `pp connref`.

```bash
pp connref list --env dev
pp connref inspect pp_sharedconnector --env dev
pp connref validate --env dev --solution Core
```

Validation focuses on deployment blockers: missing connector bindings, missing active connection IDs, and solution-scoped filtering when `--solution` is supplied.

## Environment variables

The `pp envvar` commands let you inspect effective values and manage current values for Dataverse environment variables. The inspect and list outputs show the schema name and display name, the default value, the current value (if present), the effective value, and the value record ID when a current value exists.

```bash
pp envvar list --env dev
pp envvar inspect pp_ApiUrl --env dev
pp envvar set pp_ApiUrl --env dev --value https://next.example.test
```

`envvar create` seeds a new environment variable definition through the typed CLI surface. Pass `--solution` to add it directly into a solution, which avoids dropping to raw `pp dv request` for the common "create definition, then set value" workflow.

```bash
pp envvar create pp_ApiUrl --env dev --solution Core --display-name "API URL"
```

## Metadata inspection

The `dv metadata` commands let you browse the Dataverse schema: tables, columns, option sets, and relationships. The inspection commands default to normalized views that surface the most useful fields, but you can always pass `--view raw` to get the original Dataverse metadata payload.

### Browsing tables and columns

`dv metadata tables` lists table definitions. It supports `--select`, `--filter`, and `--expand`, which are sent directly to the metadata endpoint. Note that `--top` is applied client-side because `EntityDefinitions` does not support `$top`, and `--orderby` and `--count` are not supported for this command.

```bash
pp dv metadata tables --env dev --select LogicalName,SchemaName --top 10
pp dv metadata tables --env dev --all
```

To inspect a single table definition, use `dv metadata table` with the logical name:

```bash
pp dv metadata table account --env dev --select LogicalName,SchemaName,ObjectTypeCode
```

`dv metadata columns` lists column definitions for a given table. It follows the same query rules and client-side `--top` behavior as `dv metadata tables`, and defaults to a normalized `common` view.

```bash
pp dv metadata columns account --env dev --select LogicalName,SchemaName,AttributeType --top 10
pp dv metadata columns account --env dev --filter "AttributeType eq Microsoft.Dynamics.CRM.AttributeTypeCode'String'"
```

`dv metadata column` inspects a single column and defaults to a normalized `detailed` view. Pass `--view raw` to get the unprocessed Dataverse payload.

```bash
pp dv metadata column account name --env dev --select LogicalName,SchemaName,AttributeType
pp dv metadata column account name --env dev --view raw
```

### Option sets and relationships

`dv metadata option-set` returns a normalized view of a global option set, including the name, display name, description, metadata ID, option set type, whether it is global, its introduced version, and normalized option entries with value, label, optional description, color, and managed status.

```bash
pp dv metadata option-set pp_projectstatus --env dev
```

`dv metadata relationship` returns a normalized relationship summary. For one-to-many relationships, the output includes the referenced and referencing entities, lookup identity and display labels, and cascade configuration. For many-to-many relationships, it includes both entity logical names, the intersect entity name, and navigation property names when Dataverse exposes them. Pass `--kind many-to-many` when inspecting a many-to-many relationship, and `--view raw` when you need the original payload.

```bash
pp dv metadata relationship pp_project_account --env dev
pp dv metadata relationship pp_project_contact --env dev --kind many-to-many
```

### Snapshots and diffs

`dv metadata snapshot` emits stable JSON artifacts for `table`, `columns`, `option-set`, and `relationship` domains. `dv metadata diff` then compares two saved snapshot artifacts and reports field-level adds, removes, and changes. Together they give you a before/after comparison workflow for tracking schema changes.

```bash
pp dv metadata snapshot columns pp_project --env dev --out ./artifacts/pp_project.columns.json
pp dv metadata snapshot relationship pp_project_account --env dev --kind one-to-many --out ./artifacts/pp_project_account.relationship.json
pp dv metadata diff --left ./artifacts/pp_project.columns.before.json --right ./artifacts/pp_project.columns.after.json
```

## Metadata authoring

Beyond inspection, `pp` provides a structured authoring workflow for creating and updating Dataverse schema through spec files. The overall flow is: use `schema` to see the expected spec shape, use `init` to scaffold a starter file, then use `create-*` or `update-*` to apply it, or use `apply` to execute multiple operations from a single manifest.

### Schema and scaffolding

`dv metadata schema` emits a validator-derived JSON Schema for a spec contract, which is useful for editor autocompletion and validation. `dv metadata init` prints a starter scaffold you can fill in. For columns, both commands accept `--kind` to select the column type.

```bash
pp dv metadata schema create-table --format json-schema
pp dv metadata schema add-column --kind string --format json-schema
pp dv metadata init create-table
pp dv metadata init add-column --kind choice
```

You can also run `pp dv metadata --help` to see the full metadata command surface without needing to pick a subcommand first.

### Creating schema objects

Each creation command reads a spec file with `--file` (JSON, YAML, or YML), sends the typed request to Dataverse, publishes by default (use `--no-publish` to skip), and returns the initial Dataverse response plus the fetched definition when read-back succeeds. The `--solution` flag adds `MSCRM.SolutionUniqueName` to the metadata request so the new object lands in the correct solution. The `--language-code` flag defaults to `1033`.

Metadata write commands also include an `entitySummary` field with a normalized table, column, option-set, or relationship summary alongside the raw read-back payload. If read-back or publish encounters a problem after the underlying create has already succeeded, it is reported as a warning rather than a failure.

```bash
pp dv metadata create-table --env dev --file ./specs/project.table.yaml --solution Core
pp dv metadata add-column pp_project --env dev --file ./specs/client-code.column.yaml --solution Core
pp dv metadata create-option-set --env dev --file ./specs/status.optionset.yaml --solution Core
pp dv metadata create-relationship --env dev --file ./specs/project-account.relationship.yaml --solution Core
pp dv metadata create-many-to-many --env dev --file ./specs/project-contact.m2m.yaml --solution Core
pp dv metadata create-customer-relationship --env dev --file ./specs/project-customer.relationship.yaml --solution Core
```

The current creation scope covers custom tables with a primary-name column; column kinds `string`, `memo`, `integer`, `decimal`, `money`, `datetime`, `boolean`, `choice`, `autonumber`, `file`, and `image`; global option sets; one-to-many relationships with lookup creation; many-to-many relationships; and customer lookup relationships through the Dataverse customer-relationship action.

### Updating schema objects

Update commands read the current metadata definition, apply a typed overlay from your spec file, and send the required Dataverse metadata `PUT`. They share the same `--file`, `--solution`, and `--language-code` flags as creation commands.

```bash
pp dv metadata update-table pp_project --env dev --file ./specs/project.table.update.yaml --solution Core
pp dv metadata update-column pp_project pp_clientcode --env dev --file ./specs/client-code.column.update.yaml --solution Core
pp dv metadata update-option-set --env dev --file ./specs/status.update.yaml --solution Core
pp dv metadata update-relationship pp_project_account --env dev --kind one-to-many --file ./specs/project-account.relationship.update.yaml --solution Core
```

Typed update flows exist for table labels and descriptions, column labels, required level, and boolean labels, and relationship menu or cascade metadata.

### Multi-operation manifests with `apply`

`dv metadata apply` accepts a manifest whose `operations` entries point at isolated spec files. Each entry specifies a `kind` (like `create-table` or `add-column`) and a `file` path. Entries with kind `add-column` must also include `tableLogicalName`.

```bash
pp dv metadata apply --env dev --file ./specs/schema.apply.yaml --solution Core
```

```yaml
operations:
  - kind: create-table
    file: ./project.table.yaml
  - kind: add-column
    tableLogicalName: pp_project
    file: ./project-number.column.yaml
  - kind: add-column
    tableLogicalName: pp_project
    file: ./project-status.column.yaml
  - kind: create-relationship
    file: ./task-project.relationship.yaml
```

### Spec file examples

The following examples show the structure of each spec type. These are the files you pass via `--file` to the creation and update commands.

Table spec:

```yaml
schemaName: pp_Project
displayName: Project
pluralDisplayName: Projects
description: Project records
ownership: userOwned
hasNotes: true
primaryName:
  schemaName: pp_Name
  displayName: Name
  maxLength: 200
```

String column spec:

```yaml
kind: string
schemaName: pp_ClientCode
displayName: Client Code
description: External client code
requiredLevel: recommended
maxLength: 50
format: text
```

Autonumber column spec:

```yaml
kind: autonumber
schemaName: pp_ProjectNumber
displayName: Project Number
autoNumberFormat: PROJ-{SEQNUM:6}
maxLength: 20
```

File column spec:

```yaml
kind: file
schemaName: pp_Specification
displayName: Specification
maxSizeInKB: 10240
```

Image column spec:

```yaml
kind: image
schemaName: pp_Thumbnail
displayName: Thumbnail
maxSizeInKB: 5120
canStoreFullImage: true
```

Global option set spec:

```yaml
name: pp_projectstatus
displayName: Project Status
options:
  - label: New
    value: 100000000
  - label: Active
    value: 100000001
```

Global option set update spec -- `add` inserts new options (you can omit `value` to let Dataverse assign one), `update` targets existing options by numeric value with `mergeLabels` defaulting to `true` when omitted, and `removeValues` and `orderValues` both operate on numeric option values:

```yaml
name: pp_projectstatus
add:
  - label: Paused
update:
  - value: 100000000
    label: New
    mergeLabels: true
removeValues:
  - 100000099
orderValues:
  - 100000000
  - 100000001
```

Table update spec:

```yaml
displayName: Projects
pluralDisplayName: Projects
description: Updated table description
```

Column update spec:

```yaml
displayName: Client Code
description: External client code used across systems
requiredLevel: recommended
```

Boolean column labels can also be updated:

```yaml
displayName: Enabled
trueLabel: Enabled
falseLabel: Disabled
```

One-to-many relationship spec:

```yaml
schemaName: pp_project_account
referencedEntity: account
referencingEntity: pp_project
lookup:
  schemaName: pp_AccountId
  displayName: Account
```

Many-to-many relationship spec -- optional `entity1Menu` and `entity2Menu` blocks control the associated menu label, behavior, group, and order for navigation:

```yaml
schemaName: pp_project_contact
entity1LogicalName: pp_project
entity2LogicalName: contact
entity1Menu:
  label: Contacts
```

One-to-many relationship update spec:

```yaml
associatedMenuLabel: Customers
associatedMenuBehavior: useLabel
cascade:
  delete: restrict
  share: cascade
```

Many-to-many relationship update spec:

```yaml
entity1Menu:
  label: Projects
  behavior: useLabel
```

Customer relationship spec -- uses the Dataverse customer-relationship action to create the complex lookup plus paired account and contact one-to-many relationships. Optional `accountMenu` and `contactMenu` blocks customize the associated menu metadata for those generated relationships:

```yaml
tableLogicalName: pp_project
lookup:
  schemaName: pp_CustomerId
  displayName: Customer
accountReferencedAttribute: id
contactReferencedAttribute: id
```

## Solution commands

Solution commands cover the full lifecycle of working with Dataverse solutions: creating shells, inspecting what is installed, publishing, exporting, importing, and comparing across environments.

### Creating and updating solutions

`solution create` creates an unmanaged solution shell in a target environment. You provide the unique name as the first argument and set the friendly name, publisher, and description through flags.

```bash
pp solution create HarnessShell --env dev \
  --friendly-name "Harness Shell" \
  --publisher-unique-name DefaultPublisher \
  --description "Disposable unmanaged shell for test work."
```

`solution set-metadata` updates a solution's metadata (version, publisher) without dropping to raw `dv update`.

```bash
pp solution set-metadata HarnessShell --env dev \
  --version 2026.3.10.34135 \
  --publisher-unique-name HarnessPublisher
```

### Listing and inspecting solutions

`solution list` returns the first 100 solutions installed in the target environment. `solution inspect` retrieves a single solution by unique name and returns a detailed record including the solution ID, unique name, friendly name, version, managed status, and publisher details (publisher ID, unique name, friendly name, customization prefix, and customization option value prefix). Both support `--format` for output control.

```bash
pp solution list --env dev
pp solution inspect Core --env dev
```

### Publishing

`solution publish` triggers the Dataverse `PublishAllXml` action for a solution. Pass `--wait-for-export` along with `--out` to block until export succeeds as a post-publish checkpoint.

```bash
pp solution publish Core --env dev
pp solution publish Core --env dev --wait-for-export --out ./artifacts/Core.zip
```

With `--format json`, the publish response includes a `progress` history, a `readBack`, a machine-readable `blockers` list, a top-level `readiness` assessment, and an `exportCheck` result from one immediate export-backed sync probe. This tells you whether export readiness was confirmed, timed out after polling, or is still blocked on packaged workflow state. Workflow blockers carry remediation metadata that names the primary MCP/CLI activation route plus any richer `pp`-native alternatives such as `pp.flow.deploy`, and explicitly call out when `FLOW_ACTIVATE_DEFINITION_REQUIRED` means `pp` has no further native completion path for that draft modern flow.

### Exporting

```bash
pp solution export Core --env dev --out ./artifacts/solutions/Core.zip --plan
```

`solution export` calls the Dataverse `ExportSolution` action and saves the resulting zip. Use `--plan` to preview the export plan before executing.

### Importing

`solution import` uses the Dataverse `ImportSolution` action with structured retry guidance. The `--plan` flag reads the adjacent release manifest when present and otherwise falls back to solution package metadata, then combines that with live target solution state to surface managed/unmanaged and same-version promotion diagnostics before mutating anything.

### Analysis and comparison

Several commands help you understand what is inside a solution and how it differs across environments.

`solution components` lists the component inventory of a solution. `solution dependencies` shows dependency edges with missing-required-component flags plus import-risk classification (`resolved`, `expected-external`, `likely-import-blocker`, or `review-required`). `solution analyze` combines components and dependencies with connection-reference validation failures and environment variables with missing effective values into a single preflight report. `solution sync-status` checks export readiness with a configurable timeout.

```bash
pp solution components Core --env dev
pp solution dependencies Core --env dev
pp solution analyze Core --env dev
pp solution sync-status Core --env dev --timeout-ms 20000 --format json
```

`solution compare` computes source/target drift summaries. You can compare two live environments, a live environment against a solution zip, or an unpacked solution folder against a zip. By default, model-driven app comparison reports only shell presence; pass `--include-model-composition` for deep model artifact drift. Some comparison modes require a path to the `pac` CLI binary via `--pac`.

```bash
pp solution compare Core --source-env dev --target-env prod
pp solution compare Core --source-env dev --target-env prod --include-model-composition
pp solution compare Core --source-env dev --target-zip ./artifacts/Core_managed.zip --pac /path/to/pac
pp solution compare --source-folder ./src/solutions/Core --target-zip ./artifacts/Core_managed.zip --pac /path/to/pac
```

## Disposable harness baselines

When bootstrap needs to check for stale run-scoped solutions before reuse, use the `env baseline` command. It returns one machine-readable payload that embeds the resolved environment/auth context, prefix collision checks, and optional prior-solution absence checks behind a `readyForBootstrap` result.

```bash
pp env baseline test --prefix ppHarness20260310T013401820Z --format json
```

Prefix-scoped cleanup and reset capabilities are available through the MCP server (`pp.environment.cleanup-plan` and `pp.environment.cleanup`) but are not currently wired as CLI subcommands.

## Environment alias fields

When adding an environment alias, three fields influence Dataverse resolution: `--url` sets the environment URL, `--profile` binds the alias to an auth profile, and `--api-path` overrides the Web API base path (defaults to `/api/data/v9.2/`). Two additional alias fields are used by other workflows: `--default-solution` and `--maker-env-id` (an optional Maker environment ID for building deep links in canvas fallback diagnostics).

```bash
pp env add \
  --name dev \
  --url https://example.crm.dynamics.com \
  --profile dev-user \
  --api-path /api/data/v9.2/
```

## Output formats

Most commands default to JSON output. The CLI help text in `packages/cli/src/index.ts` is the current source of truth for exact flags.

## Current boundaries

The Dataverse surface in `pp` today covers solution lifecycle operations (create, list, inspect, publish, export, import), solution analysis and comparison (component inventory, dependency analysis, preflight checks, cross-environment and zip-based drift detection), row-level CRUD with full query support (select, top, filter, expand, orderby, count, paging), typed Dataverse action, function, and `$batch` invocation, row-set export and batch-apply workflows, metadata inspection and normalized views for tables, columns, option sets, and relationships (including snapshots and diffs), and metadata authoring for tables, most column types, option sets, and all three relationship kinds. Local solution pack/unpack orchestration through `pac solution pack|unpack` and gated live smoke testing through `pnpm smoke:live` are also available.

The areas not yet covered include deeper metadata browsing beyond basic table listing and single-table inspection, remaining phase 3 metadata assets (state/status metadata, owner-style lookups, formula-column edge cases), and deploy consumption of solution release manifests and rollback bundles.
