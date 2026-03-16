# Model-driven apps

Model-driven app support in `pp` is Dataverse-backed and useful today for
inspection, dependency tracing, and basic app-record authoring. It turns
model-driven apps from opaque solution components into inspectable composition
objects with clear sitemap, form, view, and table relationships.

## Getting started

The most common starting point is listing and inspecting model-driven apps in
a target environment. `model list` shows available apps, and `model inspect`
returns a detailed composition summary including sitemaps, forms, views, tables,
dependencies, and any missing components.

```bash
pp model list --env dev
pp model inspect SalesHub --env dev
```

From there, you can drill into specific aspects of an app's composition. The
sitemap command shows navigation structure, the forms and views commands show
entity-level UI composition, and the dependencies command shows resolved and
missing component relationships.

```bash
pp model sitemap SalesHub --env dev
pp model forms SalesHub --env dev
pp model views SalesHub --env dev
pp model dependencies SalesHub --env dev
```

All of these commands accept `--solution UNIQUE_NAME` to limit the results to
apps scoped to a particular solution.

## Creating and attaching apps

When you need to create a new model-driven app record or attach an existing one
to a solution, use the authoring commands. `model create` creates a
solution-aware app record, and `model attach` adds an existing app to a
solution.

```bash
pp model create SalesHub --env dev --name "Sales Hub" --solution Core
pp model attach SalesHub --env dev --solution Core
```

## How inspection works

Under the hood, the model service queries `appmodules`, `appmodulecomponents`,
`systemforms`, `savedqueries`, `sitemaps`, and `EntityDefinitions` to build a
unified picture of each app's composition. When a tenant rejects
`appmodule_appmodulecomponent` reads, `pp model inspect` falls back to
`dependencies` rows where the model-driven app is the dependent component. That
recovers sitemap, form, view, and table detail with a warning that the
composition is inferred rather than directly queried.

The `model inspect` output combines everything into one composition object with
`app`, `sitemaps`, `forms`, `views`, `tables`, `dependencies`, and
`missingComponents` fields. This keeps the domain language model-focused instead
of leaking raw Dataverse table names into normal use.

## What model support does and does not include

Model support today covers inspection, dependency tracing, app-record creation,
and solution attachment. It does not include sitemap mutation, form or view
authoring, or model-driven packaging and deploy orchestration. That is a
deliberate scope choice. The main value is composition visibility and dependency
tracing, with create and attach support so you do not have to drop to raw
Dataverse `appmodule` writes for basic app record lifecycle.
