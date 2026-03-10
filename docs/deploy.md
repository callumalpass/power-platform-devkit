# Deploy

`pp deploy` now has two layers:

- `deploy plan`: local project resolution into a structured deploy plan
- `deploy apply`: shared orchestration with machine-readable preflight, apply, and report output

## Supported apply slice

The implemented `apply` path currently supports project parameters mapped with:

```yaml
mapsTo:
  - kind: dataverse-envvar
    target: pp_TenantDomain
```

During `deploy apply`, `pp`:

1. resolves the active project stage, environment alias, and solution
2. resolves the Dataverse client for the active environment alias
3. analyzes the target solution for preflight facts
4. inspects environment variables in that solution
5. updates matching environment variable values for supported mappings

## Local usage

Preview the execution without side effects:

```bash
pp deploy apply --project . --dry-run --format json
```

Render a plan-shaped preview:

```bash
pp deploy apply --project . --plan --format json
```

Apply the supported operations:

```bash
pp deploy apply --project . --yes --format json
```

The output includes:

- `plan`: resolved deploy target, inputs, and supported operations
- `preflight`: machine-readable checks and pass/warn/fail status
- `apply`: per-operation results and summary counts
- `report`: execution timestamps and duration

## CI and adapters

The adapter packages call the shared deploy service rather than reimplementing deploy semantics:

- `@pp/adapter-github-actions`
- `@pp/adapter-azure-devops`
- `@pp/adapter-power-platform-pipelines`

Each adapter discovers the project and invokes the shared deploy execution path, so CI wrappers stay thin.

The adapter entrypoints now resolve a small pipeline-friendly contract before calling shared deploy services:

- `projectPath`
- `stage`
- `mode`
- `parameterOverrides`

Explicit function options win over environment variables. If no explicit `projectPath` is provided, each adapter falls back to the workspace variables that are natural for that CI host.

### GitHub Actions

- Workspace fallback: `GITHUB_WORKSPACE`
- Input aliases: `INPUT_PROJECT_PATH`, `INPUT_STAGE`, `INPUT_MODE`, `INPUT_PARAMETER_OVERRIDES`
- Shared fallback aliases: `PP_DEPLOY_PROJECT_PATH`, `PP_DEPLOY_STAGE`, `PP_DEPLOY_MODE`, `PP_DEPLOY_PARAMETER_OVERRIDES`

Example:

```yaml
- name: Deploy with shared orchestration
  env:
    INPUT_STAGE: prod
    INPUT_MODE: dry-run
    INPUT_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}'
  run: node ./scripts/run-github-deploy.mjs
```

### Azure DevOps

- Workspace fallback: `BUILD_SOURCESDIRECTORY`, then `SYSTEM_DEFAULTWORKINGDIRECTORY`
- Stage aliases: `PP_DEPLOY_STAGE`, `RELEASE_ENVIRONMENTNAME`, `SYSTEM_STAGEDISPLAYNAME`
- Mode and parameter overrides: `PP_DEPLOY_MODE`, `PP_DEPLOY_PARAMETER_OVERRIDES`

Example:

```yaml
steps:
  - script: node ./scripts/run-azure-deploy.mjs
    env:
      PP_DEPLOY_STAGE: prod
      PP_DEPLOY_MODE: plan
      PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}'
```

### Power Platform Pipelines

- Workspace fallback: `PIPELINE_WORKSPACE`, then `SYSTEM_DEFAULTWORKINGDIRECTORY`
- Stage aliases: `PP_DEPLOY_STAGE`, `PIPELINE_STAGE`
- Mode and parameter overrides: `PP_DEPLOY_MODE`, `PP_DEPLOY_PARAMETER_OVERRIDES`

Example:

```yaml
steps:
  - script: node ./scripts/run-pp-pipeline-deploy.mjs
    env:
      PP_DEPLOY_STAGE: prod
      PP_DEPLOY_MODE: dry-run
      PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}'
```

`*_PARAMETER_OVERRIDES` values must be JSON objects whose values are strings, numbers, or booleans. Invalid JSON or unsupported `mode` values fail before project discovery or deploy execution begins.

## Current limits

- Only `dataverse-envvar` mappings are applied today.
- Missing target environment variables fail preflight.
- Connection reference and missing-environment-variable findings from solution analysis are surfaced as warnings in preflight.
