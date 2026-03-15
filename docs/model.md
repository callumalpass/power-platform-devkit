# Model-driven apps

Model-driven app support in `pp` is Dataverse-backed and useful today for
inspection, dependency tracing, and a small amount of app record authoring.

It turns model-driven apps from opaque solution components into inspectable
composition objects.

## Common jobs

Most users come here for one of these jobs:

1. inspect a model-driven app and its composition
2. inspect sitemap, forms, views, and dependencies
3. create an app record or attach one to a solution

Use these command paths first:

```bash
pp model list --env dev
pp model inspect SalesHub --env dev
pp model sitemap SalesHub --env dev
pp model dependencies SalesHub --env dev
```

If you need authoring:

```bash
pp model create SalesHub --env dev --name "Sales Hub" --solution Core
pp model attach SalesHub --env dev --solution Core
```

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
- `dependencies` as an inferred fallback when `appmodulecomponents` is blocked
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

When tenants reject `appmodule_appmodulecomponent` reads, `pp model inspect`
now falls back to `dependencies` rows where the model-driven app is the
dependent component. That recovers sitemap, form, view, and table detail with a
warning that the composition is inferred rather than direct membership.

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

## What model support includes today

Model support includes app-record authoring for:

- solution-aware app creation through `model create`
- supported solution attachment through `model attach`

It does not include:

- sitemap mutation
- form or view authoring
- model-driven packaging or deploy orchestration

That is a deliberate scope choice, not a statement that the whole module is
fragile. The main value here is composition visibility and dependency tracing,
with create/attach support so callers do not have to drop to raw Dataverse
`appmodule` writes for the basic app record lifecycle.
