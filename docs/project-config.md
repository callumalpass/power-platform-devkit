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
  useManagedIdentity:
    type: boolean
    value: false
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
- `secretRef` is recorded as a secret-backed parameter, but secret lookup is not implemented yet
- required parameters with no resolved value are reported as errors in project diagnostics

Supported types:

- `string`
- `number`
- `boolean`

If `type` is omitted, it is inferred from `value` when possible and otherwise defaults to `string`.

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
pp project inspect /path/to/repo --format json
```

Returns:

- project summary
- resolved parameters
- provider bindings
- discovered assets

### Analysis report

```bash
pp analysis report
```

Produces a markdown report summarizing:

- repo root
- default environment and solution
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
- default environment and solution
- resolved input values
- provider binding names
- asset inventory

At the moment this is a local planning artifact, not a remote deployment executor.
