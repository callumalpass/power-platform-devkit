# Dataverse and solutions

The current Dataverse surface is environment-alias driven and exposes both generic Web API access and a first useful layer of typed helpers.

You authenticate once through an auth profile, bind an environment alias to that profile, and then run `dv` or `solution` commands against the alias.

## Prerequisite

```bash
pp auth login --name dev-user --resource https://example.crm.dynamics.com
pp env add --name dev --url https://example.crm.dynamics.com --profile dev-user
```

## `dv whoami`

```bash
pp dv whoami --env dev
pp dv whoami --env dev --format json
```

Calls Dataverse `WhoAmI()` and returns:

- `BusinessUnitId`
- `OrganizationId`
- `UserId`
- the resolved environment alias and auth profile

Supported flags:

- `--format`

## `dv request`

For raw Web API access, use:

```bash
pp dv request --env dev --path "EntityDefinitions?\$select=LogicalName,SchemaName"
```

You can also send arbitrary methods and request bodies:

```bash
pp dv request \
  --env dev \
  --method POST \
  --path "accounts" \
  --body '{"name":"Acme"}'
```

Supported flags:

- `--method`
- `--path`
- `--body`
- `--body-file`
- `--response-type json|text|void`
- repeated `--header "Name: value"`
- `--format`

## `dv action`

For first-class Dataverse actions, use:

```bash
pp dv action ExportSolution --env dev --body '{"SolutionName":"Core","Managed":false}'
pp dv action AddToQueue --env dev --bound-path 'queues(<queue-id>)' --body-file ./queue-item.json
```

Supported flags:

- `--body`
- `--body-file`
- `--bound-path`
- `--response-type json|text|void`
- repeated `--header "Name: value"`
- `--solution`
- `--format`

## `dv function`

For first-class Dataverse functions, use:

```bash
pp dv function sample_GetCount --env dev --param logicalName=account
pp dv function RetrieveTotalRecordCount --env dev --param-json includeInternal=false
```

Supported flags:

- repeated `--param key=value`
- repeated `--param-json key=JSON`
- `--bound-path`
- `--response-type json|text|void`
- repeated `--header "Name: value"`
- `--format`

## `dv batch`

Execute a Dataverse `$batch` manifest:

```bash
pp dv batch --env dev --file ./specs/account-batch.yaml
```

Supported flags:

- `--file`
- `--continue-on-error`
- `--solution`
- `--annotations`
- `--format`

Example batch manifest:

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

## `dv query`

```bash
pp dv query accounts --env dev
pp dv query accounts --env dev --select name,accountnumber --top 10
pp dv query solutions --env dev --filter "uniquename eq 'Core'"
pp dv query accounts --env dev --expand primarycontactid($select=fullname) --orderby name asc --count
pp dv query accounts --env dev --all
pp dv query accounts --env dev --page-info
```

Supported flags today:

- `--env`
- `--select a,b,c`
- `--expand x,y`
- `--orderby expr`
- `--top N`
- `--filter "<odata filter>"`
- `--count`
- `--all`
- `--page-info`
- `--max-page-size`
- `--annotations`
- `--format`

`--all` follows `@odata.nextLink` until the full result set is collected. `--page-info` returns the first page together with `count` and `nextLink`.

## `dv get`

```bash
pp dv get accounts 00000000-0000-0000-0000-000000000001 --env dev --select name
```

This fetches a single row by logical table name and GUID.

Supported row options today:

- `--select`
- `--expand`
- `--annotations`

## `dv create`

```bash
pp dv create accounts --env dev --body '{"name":"Acme"}'
pp dv create accounts --env dev --body-file ./account.json --return-representation
```

Supported flags:

- `--body`
- `--body-file`
- `--return-representation`
- `--select`
- `--expand`
- `--if-match`
- `--if-none-match`
- `--annotations`

## `dv update`

```bash
pp dv update accounts 00000000-0000-0000-0000-000000000001 \
  --env dev \
  --body '{"name":"Renamed"}'
```

Supported flags:

- `--body`
- `--body-file`
- `--return-representation`
- `--if-match`
- `--if-none-match`
- `--select`
- `--expand`
- `--annotations`

## `dv delete`

```bash
pp dv delete accounts 00000000-0000-0000-0000-000000000001 --env dev
```

Supported flags:

- `--if-match`

## Connection references

## `solution list`

```bash
pp solution list --env dev
pp solution list --env dev --format json
```

Lists installed solutions for the resolved environment alias.

Supported flags:

- `--format`

List, inspect, and validate connection references as first-class ALM objects:

```bash
pp connref list --env dev
pp connref inspect pp_sharedconnector --env dev
pp connref validate --env dev --solution Core
```

Validation is intentionally structured and focuses on deployment blockers such
as:

- missing connector bindings
- missing active connection ids
- solution-scoped filtering when `--solution` is supplied

## Environment variables

Inspect effective values and set current values through bounded commands:

```bash
pp envvar create pp_ApiUrl --env dev --solution Core --display-name "API URL"
pp envvar list --env dev
pp envvar inspect pp_ApiUrl --env dev
pp envvar set pp_ApiUrl --env dev --value https://next.example.test
```

The inspect and list outputs include:

- schema name and display name
- default value
- current value, if present
- effective value
- value record id when a current value exists

`envvar create` seeds an environment variable definition through the typed CLI
surface and can add it directly into a solution by passing `--solution`, which
avoids dropping to raw `pp dv request` for the common "create definition, then
set value" workflow.

## `dv metadata`

List tables:

```bash
pp dv metadata tables --env dev --select LogicalName,SchemaName --top 10
pp dv metadata tables --env dev --all
```

Notes:

- `--select`, `--filter`, and `--expand` are sent to the metadata endpoint.
- `--top` is applied client-side because `EntityDefinitions` does not support `$top`.
- `--orderby` and `--count` are not supported for `dv metadata tables`.

Inspect a specific table definition:

```bash
pp dv metadata table account --env dev --select LogicalName,SchemaName,ObjectTypeCode
```

List columns for a table:

```bash
pp dv metadata columns account --env dev --select LogicalName,SchemaName,AttributeType --top 10
pp dv metadata columns account --env dev --filter "AttributeType eq Microsoft.Dynamics.CRM.AttributeTypeCode'String'"
```

Inspect a specific column definition:

```bash
pp dv metadata column account name --env dev --select LogicalName,SchemaName,AttributeType
pp dv metadata column account name --env dev --view raw
```

Notes:

- `dv metadata columns` follows the same query rules as `dv metadata tables`.
- `dv metadata columns` defaults to a normalized `common` view.
- `dv metadata column` defaults to a normalized `detailed` view.
- use `--view raw` to return the original Dataverse metadata payload.
- `--top` is applied client-side.
- `--orderby` and `--count` are not supported.

Create metadata from structured spec files:

```bash
pp dv metadata apply --env dev --file ./specs/schema.apply.yaml --solution Core
pp dv metadata create-table --env dev --file ./specs/project.table.yaml --solution Core
pp dv metadata update-table pp_project --env dev --file ./specs/project.table.update.yaml --solution Core
pp dv metadata add-column pp_project --env dev --file ./specs/client-code.column.yaml --solution Core
pp dv metadata update-column pp_project pp_clientcode --env dev --file ./specs/client-code.column.update.yaml --solution Core
pp dv metadata create-option-set --env dev --file ./specs/status.optionset.yaml --solution Core
pp dv metadata update-option-set --env dev --file ./specs/status.update.yaml --solution Core
pp dv metadata create-relationship --env dev --file ./specs/project-account.relationship.yaml --solution Core
pp dv metadata update-relationship pp_project_account --env dev --kind one-to-many --file ./specs/project-account.relationship.update.yaml --solution Core
pp dv metadata create-many-to-many --env dev --file ./specs/project-contact.m2m.yaml --solution Core
pp dv metadata create-customer-relationship --env dev --file ./specs/project-customer.relationship.yaml --solution Core
```

Supported creation scope today:

- custom tables with a primary-name column
- column kinds: `string`, `memo`, `integer`, `decimal`, `money`, `datetime`, `boolean`, `choice`, `autonumber`, `file`, `image`
- global option set create and option-value updates
- one-to-many relationships with lookup creation
- many-to-many relationship creation
- customer lookup relationship creation through the Dataverse customer-relationship action
- typed update flows for table labels/descriptions, column labels/required-level/boolean labels, and relationship menu or cascade metadata

Inspect richer metadata definitions:

```bash
pp dv metadata option-set pp_projectstatus --env dev
pp dv metadata relationship pp_project_account --env dev
pp dv metadata relationship pp_project_contact --env dev --kind many-to-many
pp dv metadata snapshot columns pp_project --env dev --out ./artifacts/pp_project.columns.json
pp dv metadata snapshot relationship pp_project_account --env dev --kind one-to-many --out ./artifacts/pp_project_account.relationship.json
pp dv metadata diff --left ./artifacts/pp_project.columns.before.json --right ./artifacts/pp_project.columns.after.json
```

Normalized inspection defaults:

- `dv metadata option-set` returns `name`, `displayName`, `description`, `metadataId`, `optionSetType`, `isGlobal`, `introducedVersion`, and normalized `options` entries with `value`, `label`, optional `description`, `color`, and `isManaged`
- `dv metadata relationship` returns a normalized relationship summary instead of raw Dataverse metadata
- one-to-many relationship output includes `referencedEntity`, `referencedAttribute`, `referencingEntity`, lookup identity/display labels, and cascade configuration when present
- many-to-many relationship output includes `entity1LogicalName`, `entity2LogicalName`, `intersectEntityName`, and navigation property names when Dataverse exposes them
- use `--view raw` on either command when you need the original Dataverse payload
- `dv metadata snapshot` emits stable JSON artifacts for `table`, `columns`, `option-set`, and `relationship` domains
- `dv metadata diff` compares two saved snapshot artifacts and reports field-level adds, removes, and changes

Common flags:

- `--file` accepts JSON, YAML, or YML
- `dv metadata apply --file` accepts a manifest whose `operations` entries point at isolated spec files; `add-column` entries also require `tableLogicalName`
- `--solution` adds `MSCRM.SolutionUniqueName` to the metadata request
- `--language-code` defaults to `1033`
- publish happens by default after create; use `--no-publish` to skip it

Example apply manifest:

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

Example table spec:

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

Example column spec:

```yaml
kind: string
schemaName: pp_ClientCode
displayName: Client Code
description: External client code
requiredLevel: recommended
maxLength: 50
format: text
```

Example autonumber column spec:

```yaml
kind: autonumber
schemaName: pp_ProjectNumber
displayName: Project Number
autoNumberFormat: PROJ-{SEQNUM:6}
maxLength: 20
```

Example file column spec:

```yaml
kind: file
schemaName: pp_Specification
displayName: Specification
maxSizeInKB: 10240
```

Example image column spec:

```yaml
kind: image
schemaName: pp_Thumbnail
displayName: Thumbnail
maxSizeInKB: 5120
canStoreFullImage: true
```

Example global option set spec:

```yaml
name: pp_projectstatus
displayName: Project Status
options:
  - label: New
    value: 100000000
  - label: Active
    value: 100000001
```

Example global option set update spec:

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

Update semantics:

- `add` inserts new options and can omit `value` to let Dataverse assign one
- `update` targets existing options by numeric `value`; `mergeLabels` defaults to `true` when omitted
- `removeValues` and `orderValues` both operate on numeric option values

Example table update spec:

```yaml
displayName: Projects
pluralDisplayName: Projects
description: Updated table description
```

Example column update spec:

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

Example one-to-many relationship spec:

```yaml
schemaName: pp_project_account
referencedEntity: account
referencingEntity: pp_project
lookup:
  schemaName: pp_AccountId
  displayName: Account
```

Example many-to-many relationship spec:

```yaml
schemaName: pp_project_contact
entity1LogicalName: pp_project
entity2LogicalName: contact
entity1Menu:
  label: Contacts
```

Optional `entity1Menu` and `entity2Menu` blocks let you control the associated
menu label, behavior, group, and order for many-to-many navigation.

Example one-to-many relationship update spec:

```yaml
associatedMenuLabel: Customers
associatedMenuBehavior: useLabel
cascade:
  delete: restrict
  share: cascade
```

Example many-to-many relationship update spec:

```yaml
entity1Menu:
  label: Projects
  behavior: useLabel
```

Example customer relationship spec:

```yaml
tableLogicalName: pp_project
lookup:
  schemaName: pp_CustomerId
  displayName: Customer
accountReferencedAttribute: id
contactReferencedAttribute: id
```

Customer relationship creation uses the Dataverse customer-relationship action
to create the complex lookup plus the paired account and contact one-to-many
relationships. Optional `accountMenu` and `contactMenu` blocks customize the
associated menu metadata for those generated relationships.

Notes:

- create commands return the initial Dataverse response plus the fetched definition when read-back succeeds
- update commands read the current metadata definition, apply the typed overlay, and send the required Dataverse metadata `PUT`
- read-back or publish problems are reported as warnings when the underlying create call has already succeeded
- the authoring surface is intentionally smaller than raw Dataverse metadata JSON so `pp` can validate and shape payloads consistently

## Solution commands

Create an unmanaged remote solution shell:

```bash
pp solution create HarnessShell --env dev \
  --friendly-name "Harness Shell" \
  --publisher-unique-name DefaultPublisher \
  --description "Disposable unmanaged shell for test work."
```

Update solution metadata without dropping to raw `dv update`:

```bash
pp solution set-metadata HarnessShell --env dev \
  --version 2026.3.10.34135 \
  --publisher-unique-name HarnessPublisher
```

List the first 100 solutions:

```bash
pp solution list --env dev
```

Inspect a solution by unique name:

```bash
pp solution inspect Core --env dev
```

Inspect solution inventory and preflight facts:

```bash
pp solution components Core --env dev
pp solution dependencies Core --env dev
pp solution analyze Core --env dev
pp solution compare Core --source-env dev --target-env prod
pp solution compare Core --source-env dev --target-zip ./artifacts/Core_managed.zip --pac /path/to/pac
pp solution compare --source-folder ./src/solutions/Core --target-zip ./artifacts/Core_managed.zip --pac /path/to/pac
```

Current solution output includes:

- `solutionid`
- `uniquename`
- `friendlyname`
- `version`
- `ismanaged`
- `publisher.publisherid`
- `publisher.uniquename`
- `publisher.friendlyname`
- `publisher.customizationprefix`
- `publisher.customizationoptionvalueprefix`
- normalized component inventory
- dependency edges with missing-required-component flags
- connection-reference validation failures
- environment variables with missing effective values
- source/target drift summaries for compare output

## Environment alias fields that matter here

When adding an environment alias, these fields currently influence Dataverse resolution:

- `--url`
- `--profile`
- `--api-path`

Additional alias metadata used by other workflows:

- `--default-solution`
- `--maker-env-id`: optional Maker environment id for building deep links in
  canvas fallback diagnostics

If `--api-path` is omitted, Dataverse defaults to:

```text
/api/data/v9.2/
```

Example:

```bash
pp env add \
  --name dev \
  --url https://example.crm.dynamics.com \
  --profile dev-user \
  --api-path /api/data/v9.2/
```

## Output formats

Most current commands default to JSON output. Some project and analysis commands also support markdown output. The CLI help text in `packages/cli/src/index.ts` is the current source of truth for exact flags.

## Current boundaries

Implemented today:

- solution create for unmanaged shells
- solution export through the Dataverse `ExportSolution` action with `pp` release manifests
- solution import through the Dataverse `ImportSolution` action with structured retry guidance
- typed Dataverse action, function, and `$batch` invocation helpers plus CLI commands
- local solution pack and unpack orchestration through `pac solution pack|unpack`
- Dataverse `WhoAmI`
- generic Web API request execution
- table query with select/top/filter/expand/orderby/count
- query paging with `--all`
- row-by-ID fetch
- create/update/delete primitives
- metadata table listing and inspection
- normalized option-set and relationship inspection
- metadata create for phase 1, 2, and part of phase 3 assets
- gated live smoke runner through `pnpm smoke:live`
- solution list
- solution inspect by unique name
- solution component inventory
- solution dependency and preflight analysis
- solution comparison across environments, solution zips, and unpacked roots

Not implemented yet:

- deeper metadata browsing beyond basic table listing and single-table inspection
- state/status metadata, owner-style lookups, formula-column edge cases, and other remaining phase 3 metadata assets
- deploy consumption of solution release manifests and rollback bundles
