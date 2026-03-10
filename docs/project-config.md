# Project config

`pp` discovers project configuration from the nearest:

- `pp.config.json`
- `pp.config.yaml`
- `pp.config.yml`

If no config file is found, the project commands still run, but they fall back to defaults and emit a warning.

## Init and doctor

`pp` now exposes a lightweight local-project-management wedge:

```bash
pp project init
pp project doctor
```

`project init` intentionally stays small:

- writes a minimal `pp.config.yaml`
- creates `apps/`, `flows/`, `solutions/`, and `docs/` if they do not exist
- creates `artifacts/solutions/` as the default packaged-solution artifact root
- seeds one default stage, one solution alias, and one primary Dataverse provider binding
- returns an explicit `contract` summary describing the editable solution root, canonical bundle path, and stage-to-environment-to-solution mapping
- returns a `preview` block that renders the scaffold shape and explains how `solutions/` relates to `artifacts/solutions/<Solution>.zip`

It does not try to create remote environments, auth profiles, solutions, or
provider-specific artifacts.

`project doctor` is the validation companion. It reports:

- whether a `pp.config.*` file is present
- whether configured or default asset paths exist
- whether provider bindings and topology are defined
- whether required parameters remain unresolved
- existing project-discovery diagnostics in a more explicit local-layout check list
- a `contract` block that makes the solution-source vs. artifact-bundle split and per-stage target mapping explicit

## Shape

Current supported fields:

```yaml
name: demo
defaults:
  stage: dev
  environment: dev
  solution: Core
solutions:
  Core:
    environment: dev
    uniqueName: Core
assets:
  apps: apps
  flows: flows
  solutions: solutions
  docs: docs
providerBindings:
  primaryDataverse:
    kind: dataverse
    target: dev
    description: Main Dataverse environment
parameters:
  tenantDomain:
    type: string
    fromEnv: PP_TENANT_DOMAIN
    required: true
    mapsTo:
      - kind: dataverse-envvar
        target: pp_TenantDomain
  releaseName:
    type: string
    value: preview
  apiToken:
    type: string
    secretRef: pipeline:app_token
    required: true
    mapsTo:
      - kind: deploy-secret
        target: api-token
  sqlEndpoint:
    type: string
    fromEnv: PP_SQL_ENDPOINT
    required: true
    mapsTo:
      - kind: deploy-input
        target: sql-endpoint
  mailConnectionReference:
    type: string
    value: shared_exchangeonline
    mapsTo:
      - kind: flow-connref
        path: flows/invoice-sync/flow.json
        target: shared_office365
  runtimeApiEnvironmentVariable:
    type: string
    value: pp_RuntimeUrl
    mapsTo:
      - kind: flow-envvar
        path: flows/invoice-sync/flow.json
        target: pp_ApiUrl
  useManagedIdentity:
    type: boolean
    value: false
topology:
  defaultStage: dev
  stages:
    dev:
      environment: dev
      solution: Core
    prod:
      environment: prod
      solution: Core
      solutions:
        Core:
          uniqueName: CoreManaged
      parameters:
        releaseName: production
secrets:
  defaultProvider: pipeline
  providers:
    pipeline:
      kind: env
      prefix: PP_SECRET_
templateRegistries:
  - ./registries/canvas-controls.json
  - cache:seeded-controls
build:
  canvas:
    mode: seeded
docs:
  owner: platform-team
  paths:
    - docs
```

## Defaults and asset discovery

If `assets` is omitted, `pp` checks these default paths relative to the project root:

- `apps`
- `flows`
- `solutions`
- `docs`

Each asset is reported as a directory, file, or missing path.

## Parameter resolution

Each parameter can resolve from one of three sources:

1. explicit `value`
2. `fromEnv`
3. `secretRef`

Resolution order is exactly that order. If `value` is present, it wins even when `fromEnv` is also set.

Current behaviors:

- `value` becomes a resolved parameter immediately
- `fromEnv` reads from the current process environment
- `secretRef` resolves through the configured secret provider contract
- required parameters with no resolved value are reported as errors in project diagnostics
- secret-backed values are treated as sensitive and are redacted in human-facing summaries

Supported secret reference forms:

- `env:VARIABLE_NAME` for a direct environment lookup
- `provider:key` for a configured provider under `secrets.providers`
- bare `key` when `secrets.defaultProvider` is set

The first supported provider kind is:

- `env`, which resolves `${prefix}${key}` from the current process environment

Supported types:

- `string`
- `number`
- `boolean`

If `type` is omitted, it is inferred from `value` when possible and otherwise defaults to `string`.

## Topology and stage overrides

`topology` lets a repo describe stage-aware environment and solution targets.

Each stage can override:

- the environment alias
- the default solution alias
- solution unique names for that stage
- project parameter values or parameter-definition fields

Commands can then select a stage explicitly:

```bash
pp project inspect --stage prod
pp analysis context --stage prod --param releaseName=hotfix
pp deploy plan --stage prod --param releaseName=2026.03.09
```

Precedence is:

1. repeated `--param NAME=VALUE` command-line overrides
2. selected stage parameter overrides
3. project-level parameter definitions

Stage selection precedence is:

1. `--stage`
2. `topology.defaultStage`
3. `defaults.stage`

## Provider bindings

`providerBindings` are local project-level names for remote targets or external systems. They are not the same thing as Dataverse environment aliases, though they can point at them.

Example:

```yaml
providerBindings:
  primaryDataverse:
    kind: dataverse
    target: dev
  financePowerBi:
    kind: powerbi
    target: finance-workspace
  financeReports:
    kind: powerbi-report
    target: Executive Overview
    metadata:
      workspace: financePowerBi
      authProfile: powerbi-user
  financeBudget:
    kind: sharepoint-file
    target: /Shared Documents/Budget.xlsx
    metadata:
      site: https://example.sharepoint.com/sites/finance
      drive: Documents
      authProfile: graph-user
```

For provider-aware inspection commands, the adjacent provider domains use
binding metadata to resolve project-local names into concrete targets:

- `sharepoint-site` binds directly to a site URL or site id
- `sharepoint-list` binds to a list title or id and should declare `metadata.site`
- `sharepoint-file` binds to a drive item path or id and should declare
  `metadata.site`; `metadata.drive` is optional when the default document
  library is enough
- `powerbi` and `powerbi-workspace` bind directly to a workspace name or id
- `powerbi-dataset` and `powerbi-report` bind to dataset/report names or ids
  and should declare `metadata.workspace`
- `metadata.authProfile` is optional on SharePoint and Power BI bindings; when
  present, the CLI uses it as the default auth profile for those targets

Provider-aware deploy mappings also reuse those bindings:

- `sharepoint-file-text` targets a `sharepoint-file` binding and uploads UTF-8
  text content to the resolved file target
- `powerbi-dataset-refresh` targets a `powerbi-dataset` binding and submits a
  refresh request for the resolved dataset
- deploy mappings can also provide `site`, `drive`, or `workspace` when the
  mapping uses a literal provider target instead of a named binding

## Project commands

### Init

```bash
pp project init
pp project init /path/to/repo --name demo --env dev --solution Core --stage prod --plan --format json
```

Use `--plan` or `--dry-run` when you want the scaffold plan without writing
files. Use `--force` to replace an existing `pp.config.*` file. For human review,
`--format markdown` renders the planned layout and the source-to-artifact
contract directly.

### Doctor

```bash
pp project doctor
pp project doctor /path/to/repo --stage prod --format json
```

Returns a repo-local layout report with:

- the inspected path plus `canonicalProjectRoot` so descendant auto-selection names the effective local project anchor directly in stdout
- summary flags for config, assets, topology, provider bindings, registries, and required inputs
- a per-check assessment list (`pass`, `warn`, `fail`, `info`)
- the resolved asset inventory used by `pp`
- a `contract` summary with `solutionSourceRoot`, `canonicalBundlePath`, `defaultTarget`, `activeTarget`, and ordered `stageMappings`

## Template registries

`templateRegistries` declares pinned canvas metadata catalogs used by the
canvas package.

Resolution rules today:

- relative paths resolve from the project root
- `cache:NAME` resolves to `NAME.json` under the cache directory selected by
  the canvas registry loader
- later files override earlier ones when they define the same
  `templateName@templateVersion`

The canvas support matrix lives inside those registry files rather than inside
`pp.config.*`, which keeps project intent separate from imported template
metadata and provenance.

### Inspect

```bash
pp project inspect
pp project inspect /path/to/repo --stage prod --param releaseName=2026.03.09 --format json
```

Returns:

- project summary
- resolved topology, active environment, and active solution target
- resolved parameters
- provider bindings
- discovered assets
- template registries, build conventions, and docs metadata
- for `json`, `yaml`, and `ndjson`, the stdout payload also includes
  `diagnostics`, `warnings`, `supportTier`, and related result metadata so
  automation can parse one complete response without reading stderr

When the current directory is not itself a `pp` project, `project inspect`
auto-selects the lone descendant `pp.config.*` it finds below the inspected path
and treats that project as the canonical local anchor. If there are multiple
descendant projects, it keeps the default-layout fallback and reports the
candidates in diagnostics. The JSON payload includes a `discovery` object when
`pp` had to infer or auto-select the local project root, including the
auto-selection reason, a `canonicalAnchorReason` summary, plus anchor evidence
such as the selected config path, asset keys, stage names, provider bindings,
and docs paths.

### Analysis report

```bash
pp analysis report
```

Produces a markdown report summarizing:

- repo root
- default environment and solution
- selected stage and active targets
- provider bindings
- parameter resolution state
- discovered assets
- missing required parameters

### Analysis context

```bash
pp analysis context --format json
pp analysis context --asset apps
```

Produces a structured JSON context pack intended for coding agents or other automation. It includes project summary, provider bindings, parameter state, assets, and the deploy plan.

### Portfolio analysis

```bash
pp analysis portfolio --project ./apps/core --project ./apps/sales --format json
pp analysis drift ./apps/core ./apps/sales --format json
pp analysis usage ./apps/core ./apps/sales --format json
pp analysis policy ./apps/core ./apps/sales --allow-provider-kind dataverse --format json
```

Produces structured multi-project governance outputs:

- portfolio summaries with per-project ownership and topology context
- cross-project drift findings across stages, provider bindings, parameters, and assets
- usage inventories for owners, assets, provider bindings, and parameters
- policy findings for missing owners, missing provenance/docs paths, unsupported provider kinds, missing assets, unresolved required parameters, and sensitive literal values

### Deploy plan

```bash
pp deploy plan
```

Produces a structured plan with:

- project root
- default and active stage targets
- resolved input state with secret values redacted
- provider binding names
- topology summary
- template registries and build conventions
- asset inventory

At the moment this is a local planning artifact, not a remote deployment executor.
