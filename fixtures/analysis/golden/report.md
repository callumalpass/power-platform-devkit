# Project Report

- Root: `<REPO_ROOT>/fixtures/analysis/project`
- Default environment: `dev`
- Default solution: `core`
- Selected stage: `prod`
- Active environment: `prod`
- Active solution: `CoreManaged`
- Topology stages: 2
- Assets discovered: 4
- Provider bindings: 2
- Parameters: 5

## Provider bindings
- `primaryDataverse`: dataverse -> dev
- `financeSharePoint`: sharepoint-site -> https://example.sharepoint.com/sites/finance

## Parameters
- `tenantDomain`: environment (resolved)
- `apiToken`: secret (resolved, sensitive)
- `sqlEndpoint`: missing (missing)
- `releaseName`: value (resolved)
- `useManagedIdentity`: value (resolved)

## Assets
- `apps`: directory at `<REPO_ROOT>/fixtures/analysis/project/apps`
- `flows`: directory at `<REPO_ROOT>/fixtures/analysis/project/flows`
- `solutionBundle`: file at `<REPO_ROOT>/fixtures/analysis/project/solutions/Core.zip`
- `docs`: directory at `<REPO_ROOT>/fixtures/analysis/project/docs`

## Missing required parameters
- `sqlEndpoint`
