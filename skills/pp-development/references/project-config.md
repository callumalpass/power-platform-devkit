# pp.config.yaml — schema

## Minimal config

```yaml
name: my-project
defaults:
  environment: dev
  solution: Core
```

## Full schema

```yaml
name: string                    # project identifier (required)

defaults:
  stage: string                 # default topology stage
  environment: string           # default environment alias
  solution: string              # default solution unique name

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
    kind: dataverse
    target: string              # env alias
    description: string         # optional

topology:
  defaultStage: string
  stages:
    StageName:
      environment: string       # env alias for this stage
      solution: string          # solution unique name for this stage

templateRegistries:             # canvas template registries
  - path: ./registries/myregistry.json
  - cache: registry-name

build:
  canvas:
    mode: seeded | registry     # default canvas build mode

docs:
  owner: string
  paths:
    - string                    # documentation directory paths
```

## Asset discovery

When `assets` is omitted, `pp` checks these paths relative to the project root:

```
apps/
flows/
solutions/
docs/
```

## pp.config.yaml vs pp.config.json vs pp.config.yml

`pp` accepts all three formats. The project root is the nearest ancestor
directory containing any of these files. Use whichever format your toolchain
prefers; YAML is conventional.

## Common mistakes

- Hard-coding environment URLs instead of using env aliases
- Omitting `--solution` from metadata authoring commands (required for
  solution-scoped mutations)
