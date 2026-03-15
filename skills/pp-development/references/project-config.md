# pp.config.yaml — schema and resolution

## Minimal config

```yaml
name: my-project
defaults:
  stage: dev
  environment: dev
  solution: Core
```

## Full schema

```yaml
name: string                    # project identifier (required)

defaults:
  stage: string                 # default topology stage
  environment: string           # default environment alias
  solution: string              # default solution alias

solutions:                      # explicit solution-to-env mappings
  SolutionName:
    environment: string         # env alias
    uniqueName: string          # solution unique name in that env

assets:                         # local directory paths (relative to project root)
  apps: string                  # default: apps/
  flows: string                 # default: flows/
  solutions: string             # default: solutions/
  docs: string                  # default: docs/

providerBindings:               # named references to external systems
  MyBinding:
    kind: dataverse | sharepoint-site | sharepoint-list | sharepoint-file | powerbi | powerbi-dataset | powerbi-report
    target: string              # env alias (dataverse) or URL/ID (others)
    description: string         # optional
    metadata:
      workspace: string         # powerbi
      site: string              # sharepoint-list / sharepoint-file
      drive: string             # sharepoint-file
      authProfile: string       # override auth profile for this binding

parameters:                     # project parameters with typed resolution
  ParamName:
    type: string | number | boolean
    value: any                  # priority 1: explicit literal
    fromEnv: string             # priority 2: process environment variable name
    secretRef: string           # priority 3: "[provider:]key" or "env:VAR_NAME"
    required: boolean
    mapsTo:                     # deploy target mappings (list)
      - kind: dataverse-envvar | dataverse-envvar-create
        schemaName: string
        solution: string
      - kind: dataverse-connref | dataverse-connref-create
        logicalName: string
        solution: string
      - kind: flow-parameter
        flow: string            # relative path or name
        parameterName: string
      - kind: flow-connref
        flow: string
        from: string
        to: string
      - kind: flow-envvar
        flow: string
        schemaName: string
      - kind: sharepoint-file-text
        binding: string         # providerBinding name
      - kind: powerbi-dataset-refresh
        binding: string
      - kind: deploy-secret | deploy-input
        key: string             # adapter-consumed key

topology:
  defaultStage: string
  stages:
    StageName:
      environment: string       # env alias override for this stage
      solution: string          # solution alias override
      solutions:
        SolutionName:
          uniqueName: string    # unique name override per stage
      parameters:
        ParamName: value        # parameter value override per stage

secrets:
  defaultProvider: string
  providers:
    ProviderName:
      kind: env                 # environment variable provider
      prefix: string            # prepended to secretRef key

templateRegistries:             # canvas template registries
  - path: ./registries/myregistry.json
  - cache: registry-name

build:
  canvas:
    mode: seeded | registry     # default canvas build mode

docs:
  owner: string
  paths:
    - path: string
```

## Parameter resolution order

For each parameter, `pp` resolves the value in this order:

1. **CLI `--param NAME=VALUE`** override (highest priority)
2. **Stage parameter override** (`topology.stages.<stage>.parameters.<name>`)
3. **Explicit `value`** in parameter definition
4. **`fromEnv`** — read `process.env[fromEnv]`
5. **`secretRef`** — resolved through the named secret provider
   - `env:VAR_NAME` reads from environment variable with no prefix
   - `[provider:]key` uses the named provider with its configured prefix

If `required: true` and no value resolves, `pp` emits a diagnostic and stops.

## Topology resolution

`pp project inspect --stage <stage> --format json` shows the fully resolved
model for a given stage: which environment alias, which solution unique names,
and which parameter values are active.

`pp deploy plan --stage <stage>` uses the same resolution before generating
the deploy plan.

## Asset discovery

When `assets` is omitted, `pp` checks these paths relative to the project root:

```
apps/
flows/
solutions/
docs/
```

Assets listed are used by `pp analysis context`, `pp project doctor`, canvas
and flow local commands, and deploy preflight checks.

## pp.config.yaml vs pp.config.json vs pp.config.yml

`pp` accepts all three formats. The project root is the nearest ancestor
directory containing any of these files. Use whichever format your toolchain
prefers; YAML is conventional.

## Common mistakes

- Hard-coding environment URLs in topology instead of using env aliases
- Omitting `--solution` from metadata authoring commands (required for
  solution-scoped mutations)
- Setting `required: true` on parameters without a `fromEnv` or `value` in
  environments where the secret provider is not configured
- Duplicating `solutions/`, `flows/`, or `apps/` trees per stage — use
  topology parameter overrides instead
