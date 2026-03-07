# Dataverse and solutions

The current Dataverse surface is read-oriented and environment-alias driven.

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

## `dv query`

```bash
pp dv query accounts --env dev
pp dv query accounts --env dev --select name,accountnumber --top 10
pp dv query solutions --env dev --filter "uniquename eq 'Core'"
```

Supported flags today:

- `--env`
- `--select a,b,c`
- `--top N`
- `--filter "<odata filter>"`
- `--format`

The command builds a basic Dataverse Web API query against the resolved environment’s API path.

## `dv get`

```bash
pp dv get accounts 00000000-0000-0000-0000-000000000001 --env dev --select name
```

This fetches a single row by logical table name and GUID.

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
- table query with select/top/filter
- row-by-ID fetch
- solution list
- solution inspect by unique name

Not implemented yet:

- Dataverse create/update/delete
- metadata browsing
- solution import/export
- richer diagnostics for dependency graphs
