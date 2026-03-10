# Deploy

`pp deploy` now has two layers:

- `deploy plan`: local project resolution into a structured deploy plan
- `deploy apply`: shared orchestration with machine-readable preflight, apply, and report output

## Supported apply slice

The shared deploy contract currently recognizes project parameters mapped with:

```yaml
mapsTo:
  - kind: dataverse-envvar
    target: pp_TenantDomain
  - kind: dataverse-envvar-create
    target: pp_FeatureFlag
  - kind: dataverse-connref
    target: pp_shared_sql
  - kind: deploy-secret
    target: api-token
  - kind: deploy-input
    target: sql-endpoint
```

During `deploy apply`, `pp`:

1. resolves the active project stage, environment alias, and solution
2. resolves the Dataverse client for the active environment alias
3. analyzes the target solution for preflight facts
4. inspects environment variables and connection references in that solution
5. resolves adapter-facing input and secret bindings into the shared operation result
6. updates matching environment variable values and connection reference bindings for supported Dataverse mappings when the target differs, otherwise records a no-op skip
7. creates missing environment variable definitions first for `dataverse-envvar-create` mappings, then applies the requested value through the same shared env-var execution path

Preflight also rejects conflicting mappings before any remote inspection or apply work starts. If multiple parameters map to the same Dataverse environment variable, Dataverse connection reference, or adapter binding target, deploy returns a machine-readable failure instead of choosing an arbitrary winner.

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

Apply from a previously saved deploy plan:

```bash
pp deploy plan --project . --format json > ./dist/deploy-plan.json
pp deploy apply --project . --plan ./dist/deploy-plan.json --yes --format json
```

Live apply is guarded. Without `--yes`, `mode: apply` returns a machine-readable
preflight failure instead of mutating the target environment.
When `--plan <file>` is used, `pp` still rediscovers the current project and
runs the shared orchestration path, but it adds a preflight gate that fails if
the saved plan no longer matches the current resolved target, bindings, or
operations.

The output includes:

- `plan`: resolved deploy target, inputs, and supported operations
- `bindings`: adapter-facing deploy inputs and secrets as a machine-readable summary with secret values redacted
- `confirmation`: whether live apply required confirmation and whether it was provided
- `preflight`: machine-readable checks and pass/warn/fail status
- `apply`: per-operation results and summary counts, including adapter-facing bindings that resolved locally
  and unchanged Dataverse operations that were skipped as already up to date
- `report`: execution timestamps and duration

## CI and adapters

The adapter packages call the shared deploy service rather than reimplementing deploy semantics:

- `@pp/adapter-github-actions`
- `@pp/adapter-azure-devops`
- `@pp/adapter-power-platform-pipelines`

Each adapter discovers the project and invokes the shared deploy execution path, so CI wrappers stay thin.
Library consumers that need the resolved binding values directly can also call `resolveDeployBindings()` from `@pp/deploy`; the JSON plan/result shape keeps that same information in a redacted `bindings` summary.
GitHub Actions publishes resolved `deploy-input` and `deploy-secret` bindings into the step output file when `GITHUB_OUTPUT` is available, so later steps can consume the same adapter-facing values without reparsing the deploy result.
Azure DevOps and Power Platform Pipelines publish the same resolved bindings as Azure Pipelines output variables when the wrapper is running on a hosted agent (`TF_BUILD=true`). Those host-native output variables are normalized to `PP_DEPLOY_<TARGET>` names such as `PP_DEPLOY_SQL_ENDPOINT`.

The repo now includes turnkey Node entrypoints for those wrappers:

- `scripts/run-github-deploy.mjs`
- `scripts/run-azure-deploy.mjs`
- `scripts/run-pp-pipeline-deploy.mjs`

These scripts invoke the built adapter entrypoints and, if needed, bootstrap a workspace build before retrying. They emit a machine-readable JSON `OperationResult` and exit with status `1` when adapter option resolution, project discovery, or deploy execution fails.

Concrete packaging examples live under `docs/examples/deploy/`:

- `github-actions-deploy.yml`
- `azure-devops-deploy.yml`
- `power-platform-pipelines-deploy.yml`

Each example installs the workspace, runs the thin wrapper script for that host, and passes only the small adapter contract through environment variables.

The adapter entrypoints now resolve a small pipeline-friendly contract before calling shared deploy services:

- `projectPath`
- `stage`
- `mode`
- `parameterOverrides`

Explicit function options win over environment variables. If no explicit `projectPath` is provided, each adapter falls back to the workspace variables that are natural for that CI host.

### GitHub Actions

- Workspace fallback: `GITHUB_WORKSPACE`
- Input aliases: `INPUT_PROJECT_PATH`, `INPUT_STAGE`, `INPUT_MODE`, `INPUT_CONFIRM`, `INPUT_PARAMETER_OVERRIDES`
- Shared fallback aliases: `PP_DEPLOY_PROJECT_PATH`, `PP_DEPLOY_STAGE`, `PP_DEPLOY_MODE`, `PP_DEPLOY_CONFIRM`, `PP_DEPLOY_PARAMETER_OVERRIDES`

Example:

```yaml
- id: deploy
  name: Deploy with shared orchestration
  env:
    INPUT_STAGE: prod
    INPUT_MODE: apply
    INPUT_CONFIRM: true
    INPUT_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}'
  run: node ./scripts/run-github-deploy.mjs

- name: Use a resolved deploy binding
  run: echo "${{ steps.deploy.outputs['sql-endpoint'] }}"
```

### Azure DevOps

- Workspace fallback: `BUILD_SOURCESDIRECTORY`, then `SYSTEM_DEFAULTWORKINGDIRECTORY`
- Stage aliases: `PP_DEPLOY_STAGE`, `RELEASE_ENVIRONMENTNAME`, `SYSTEM_STAGEDISPLAYNAME`
- Mode, confirmation, and parameter overrides: `PP_DEPLOY_MODE`, `PP_DEPLOY_CONFIRM`, `PP_DEPLOY_PARAMETER_OVERRIDES`

Example:

```yaml
steps:
  - script: node ./scripts/run-azure-deploy.mjs
    name: deploy
    env:
      PP_DEPLOY_STAGE: prod
      PP_DEPLOY_MODE: apply
      PP_DEPLOY_CONFIRM: true
      PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}'

  - script: echo $(deploy.PP_DEPLOY_SQL_ENDPOINT)
    displayName: Use a resolved deploy binding
```

### Power Platform Pipelines

- Workspace fallback: `PIPELINE_WORKSPACE`, then `SYSTEM_DEFAULTWORKINGDIRECTORY`
- Stage aliases: `PP_DEPLOY_STAGE`, `PIPELINE_STAGE`
- Mode, confirmation, and parameter overrides: `PP_DEPLOY_MODE`, `PP_DEPLOY_CONFIRM`, `PP_DEPLOY_PARAMETER_OVERRIDES`

Example:

```yaml
steps:
  - script: node ./scripts/run-pp-pipeline-deploy.mjs
    name: deploy
    env:
      PP_DEPLOY_STAGE: prod
      PP_DEPLOY_MODE: apply
      PP_DEPLOY_CONFIRM: true
      PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}'

  - script: echo $(deploy.PP_DEPLOY_SQL_ENDPOINT)
    displayName: Use a resolved deploy binding
```

`*_PARAMETER_OVERRIDES` values must be JSON objects whose values are strings, numbers, or booleans. Invalid JSON or unsupported `mode` values fail before project discovery or deploy execution begins.
`*_CONFIRM` values accept `true`/`false`, `yes`/`no`, or `1`/`0`.

## Current limits

- `dataverse-envvar`, `dataverse-envvar-create`, and `dataverse-connref` are the supported Dataverse mutation kinds today.
- `deploy-input` and `deploy-secret` bindings are included in the shared deploy plan/result model, but they resolve locally for adapter consumption rather than calling a remote API.
- Mapped parameters without a resolved value now fail deploy preflight explicitly.
- Missing target environment variables still fail preflight for `dataverse-envvar`, while `dataverse-envvar-create` records a machine-readable creation check and creates the definition during live apply.
- Missing target connection references fail preflight.
- Duplicate target mappings within the same deploy family fail preflight explicitly.
- Connection reference and missing-environment-variable findings from solution analysis are surfaced as warnings in preflight.
