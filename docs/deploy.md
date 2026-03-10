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

## Current limits

- Only `dataverse-envvar` mappings are applied today.
- Missing target environment variables fail preflight.
- Connection reference and missing-environment-variable findings from solution analysis are surfaced as warnings in preflight.
