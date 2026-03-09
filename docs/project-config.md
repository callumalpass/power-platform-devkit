# Project config

`pp` discovers project configuration from the nearest:

- `pp.config.json`
- `pp.config.yaml`
- `pp.config.yml`

If no config file is found, the project commands still run, but they fall back to defaults and emit a warning.

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
```

## Project commands

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
