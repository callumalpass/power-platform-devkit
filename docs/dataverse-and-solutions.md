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
```

Calls Dataverse `WhoAmI()` and returns:

- `BusinessUnitId`
- `OrganizationId`
- `UserId`
- the resolved environment alias and auth profile

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
```

Notes:

- `dv metadata columns` follows the same query rules as `dv metadata tables`.
- `--top` is applied client-side.
- `--orderby` and `--count` are not supported.

## Solution commands

List the first 100 solutions:

```bash
pp solution list --env dev
```

Inspect a solution by unique name:

```bash
pp solution inspect Core --env dev
```

Current solution output is a lightweight summary:

- `solutionid`
- `uniquename`
- `friendlyname`
- `version`

## Environment alias fields that matter here

When adding an environment alias, these fields currently influence Dataverse resolution:

- `--url`
- `--profile`
- `--api-path`

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

- Dataverse `WhoAmI`
- generic Web API request execution
 - table query with select/top/filter/expand/orderby/count
- query paging with `--all`
- row-by-ID fetch
- create/update/delete primitives
- metadata table listing and inspection
- solution list
- solution inspect by unique name

Not implemented yet:

 - deeper metadata browsing beyond basic table listing and single-table inspection
- solution import/export
- richer diagnostics for dependency graphs
