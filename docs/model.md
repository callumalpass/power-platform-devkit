# Model-driven apps

The current model module is read-first and Dataverse-backed. It turns
model-driven apps from opaque solution components into inspectable composition
objects.

## Commands

```bash
pp model create SalesHub --env dev --name "Sales Hub" --solution Core
pp model attach SalesHub --env dev --solution Core
pp model list --env dev
pp model inspect SalesHub --env dev
pp model sitemap SalesHub --env dev
pp model forms SalesHub --env dev
pp model views SalesHub --env dev
pp model dependencies SalesHub --env dev
```

All commands also accept `--solution UNIQUE_NAME` to limit the app set to
solution-scoped model-driven apps.

## Current inspection surface

The service queries:

- `appmodules`
- `appmodulecomponents`
- `systemforms`
- `savedqueries`
- `sitemaps`
- table metadata through `EntityDefinitions`

That produces:

- app identity and version info
- sitemap references
- form composition
- view composition
- table references
- dependency summaries with resolved vs missing component state

## Output shape

`model inspect` returns one combined composition object:

- `app`
- `sitemaps`
- `forms`
- `views`
- `tables`
- `dependencies`
- `missingComponents`

This keeps the domain language model-focused instead of leaking raw Dataverse
table names into normal use.

## Current boundary

This tranche now includes a bounded authoring slice for model-driven app
records themselves:

- solution-aware app creation through `model create`
- supported solution attachment through `model attach`

It still does not yet claim write support for:

- sitemap mutation
- form or view authoring
- model-driven packaging or deploy orchestration

The goal remains composition visibility and dependency tracing first, with a
small supported create/attach workflow so callers do not have to drop to raw
Dataverse appmodule writes.
