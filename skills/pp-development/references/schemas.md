# Spec file schemas

These are the file formats `pp` reads as input. They cannot be inferred from
`--help` output. All formats accept both YAML and JSON unless noted.

---

## Dataverse table spec (`dv metadata create-table`)

```yaml
schemaName: pp_Project           # required; prefix_PascalCase
displayName: Project             # required
pluralDisplayName: Projects      # required
description: Project tracking table
ownership: userOwned             # userOwned (default) | organizationOwned
hasActivities: false
hasNotes: true
isActivity: false
primaryName:                     # required
  schemaName: pp_Name
  displayName: Name
  maxLength: 100
  requiredLevel: none            # none | recommended | required
```

---

## Dataverse column spec (`dv metadata add-column`)

The `kind` field determines which other fields are valid.

### string
```yaml
kind: string
schemaName: pp_CompanyName
displayName: Company Name
description: Legal company name
maxLength: 100
format: text                     # text | email | phone | url | tickersymbol | textarea
requiredLevel: recommended       # none | recommended | required
```

### memo (long text)
```yaml
kind: memo
schemaName: pp_Notes
displayName: Notes
maxLength: 2000
format: textArea                 # textArea | richtext
```

### integer
```yaml
kind: integer
schemaName: pp_Priority
displayName: Priority
minValue: 1
maxValue: 5
format: none                     # none | duration | timezone | language | locale
```

### decimal
```yaml
kind: decimal
schemaName: pp_BudgetAmount
displayName: Budget Amount
minValue: 0
maxValue: 1000000
precision: 2
```

### money
```yaml
kind: money
schemaName: pp_ContractValue
displayName: Contract Value
minValue: 0
precision: 2
precisionSource: 1               # 0=precision field, 1=currency precision, 2=pricing decimal precision
```

### datetime
```yaml
kind: datetime
schemaName: pp_StartDate
displayName: Start Date
format: dateOnly                 # dateOnly | dateAndTime
behavior: userLocal              # userLocal | dateOnly | timeZoneIndependent
```

### boolean
```yaml
kind: boolean
schemaName: pp_IsActive
displayName: Is Active
defaultValue: true
trueLabel: Yes
falseLabel: No
```

### choice (local option set)
```yaml
kind: choice
schemaName: pp_Status
displayName: Status
options:
  - label: Proposed
  - label: Active
  - label: Closed
# optional per-option fields:
#   value: 100000000   (auto-assigned if omitted)
#   description: ...
#   color: "#0078D4"
```

### choice (global option set reference)
```yaml
kind: choice
schemaName: pp_Status
displayName: Status
globalOptionSetName: pp_status
```

### autonumber
```yaml
kind: autonumber
schemaName: pp_ProjectNumber
displayName: Project Number
autoNumberFormat: "PROJ-{SEQNUM:6}"
maxLength: 20
```

### file
```yaml
kind: file
schemaName: pp_Specification
displayName: Specification
maxSizeInKB: 10240
```

### image
```yaml
kind: image
schemaName: pp_Thumbnail
displayName: Thumbnail
maxSizeInKB: 5120
canStoreFullImage: true
isPrimaryImage: false
```

---

## Global option set spec (`dv metadata create-option-set`)

```yaml
name: pp_status                  # logical name; no prefix required but conventional
displayName: Status
description: Project status values
options:
  - label: Proposed
    value: 100000000
    description: In proposal stage
    color: "#0078D4"
  - label: Active
    value: 100000001
  - label: Closed
    value: 100000002
```

### Update spec (`dv metadata update-option-set`)

```yaml
name: pp_status
add:
  - label: Paused
update:
  - value: 100000000
    label: New Label
    mergeLabels: false
removeValues:
  - 100000009
orderValues:
  - 100000000
  - 100000001
  - 100000002
```

---

## Relationship spec (`dv metadata create-relationship`)

### One-to-many
```yaml
schemaName: pp_project_account
referencedEntity: account        # the "one" side
referencingEntity: pp_project    # the "many" side (gets the lookup column)
lookup:
  schemaName: pp_AccountId
  displayName: Account
associatedMenuBehavior: useCollectionName  # useCollectionName | useLabel | doNotDisplay
associatedMenuGroup: details
associatedMenuOrder: 10000
cascade:
  delete: restrict               # cascade | restrict | noCascade | removeLink | userOwned
  assign: cascade
  merge: noCascade
  reparent: noCascade
  share: noCascade
  unshare: noCascade
```

### Many-to-many
```yaml
schemaName: pp_project_contact
entity1LogicalName: pp_project
entity2LogicalName: contact
intersectEntityName: pp_project_contact
entity1NavigationPropertyName: pp_contacts
entity2NavigationPropertyName: pp_projects
entity1Menu:
  label: Contacts
  behavior: useCollectionName
  group: details
  order: 10000
entity2Menu:
  label: Projects
  behavior: useLabel
  group: sales
  order: 20000
```

### Customer (polymorphic lookup)
```yaml
tableLogicalName: pp_project
lookup:
  schemaName: pp_CustomerId
  displayName: Customer
accountReferencedAttribute: id
contactReferencedAttribute: id
accountRelationshipSchemaName: pp_project_account
contactRelationshipSchemaName: pp_project_contact
```

---

## Rows manifest (`dv rows apply --file`)

Supported `kind` values: `create`, `update`, `upsert`, `delete`.

```yaml
table: accounts
operations:
  - kind: create
    requestId: create-acme        # optional; used in response correlation
    body:
      name: Acme Corporation
      accountnumber: A-1000
      telephone1: "+1 555 0100"

  - kind: upsert
    requestId: upsert-acme
    path: accounts(accountnumber='A-1000')   # alternate key path
    ifMatch: "*"
    body:
      telephone1: "+1 555 0101"

  - kind: update
    requestId: update-acme
    recordId: 00000000-0000-0000-0000-000000000001
    body:
      description: Updated description

  - kind: delete
    requestId: delete-old
    recordId: 00000000-0000-0000-0000-000000000002
```

---

## Batch manifest (`dv batch --file`)

Raw OData batch requests. Use `atomicGroup` to wrap related mutations.

```yaml
requests:
  - id: query-accounts
    method: GET
    path: accounts?$select=accountid,name

  - id: create-account
    method: POST
    path: accounts
    body:
      name: Fabrikam
      accountnumber: F-003

  - id: update-account
    method: PATCH
    path: accounts(00000000-0000-0000-0000-000000000001)
    atomicGroup: writes
    body:
      description: Updated via batch

  - id: delete-account
    method: DELETE
    path: accounts(00000000-0000-0000-0000-000000000002)
    atomicGroup: writes
```

---

## Flow artifact (`pp.flow.artifact`)

A canonical flow artifact is a single JSON file produced by `pp flow unpack`
or `pp flow export`. The directory form is a folder with a `flow.json` inside.

```json
{
  "schemaVersion": 1,
  "kind": "pp.flow.artifact",
  "metadata": {
    "name": "Invoice Sync",
    "displayName": "Invoice Sync",
    "description": "Sync invoice payloads to downstream systems.",
    "id": "<flow-guid>",
    "uniqueName": "crd_InvoiceSync",
    "connectionReferences": [
      {
        "name": "shared_office365",
        "connectionReferenceLogicalName": "shared_office365",
        "connectionId": "/connections/office365",
        "apiId": "/providers/microsoft.powerapps/apis/shared_office365"
      }
    ],
    "parameters": {
      "ApiBaseUrl": "https://api.example.com"
    },
    "environmentVariables": ["pp_ApiUrl"]
  },
  "definition": {
    "parameters": {
      "$connections": { "value": {} },
      "ApiBaseUrl": { "defaultValue": "https://api.example.com" }
    },
    "triggers": {
      "manual": { "type": "Request" }
    },
    "actions": {}
  }
}
```

Run `pp flow normalize` after unpack to ensure the artifact is in canonical form
before patching or committing to source control.

## Flow patch file (`pp flow patch --file`)

```json
{
  "connectionReferences": {
    "shared_office365": "shared_exchangeonline_prod"
  },
  "parameters": {
    "ApiBaseUrl": "https://api.prod.example.com"
  },
  "expressions": {
    "actions.ComposePayload.inputs.message": "@{parameters('ApiBaseUrl')}"
  },
  "values": {
    "actions.ComposePayload.inputs.priority": "High"
  }
}
```

- `connectionReferences` — remap connection reference logical names
- `parameters` — override parameter default values
- `expressions` — replace full expression strings in action inputs
- `values` — set literal (non-expression) values

