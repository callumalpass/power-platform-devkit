import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAzureDevOpsDeployOptions, runAzureDevOpsDeploy } from './index';
import { createFixtureDataverseClient, mockDataverseResolution } from '../../../../test/dataverse-fixture';
import { resolveRepoPath } from '../../../../test/golden';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveAzureDevOpsDeployOptions', () => {
  it('hydrates adapter options from Azure DevOps pipeline variables', () => {
    const result = resolveAzureDevOpsDeployOptions({
      environment: {
        BUILD_SOURCESDIRECTORY: '/agent/work/repo',
        RELEASE_ENVIRONMENTNAME: 'prod',
        PP_DEPLOY_MODE: 'plan',
        PP_DEPLOY_CONFIRM: 'yes',
        PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      projectPath: '/agent/work/repo',
      stage: 'prod',
      mode: 'plan',
      confirm: true,
      environment: {
        BUILD_SOURCESDIRECTORY: '/agent/work/repo',
        RELEASE_ENVIRONMENTNAME: 'prod',
        PP_DEPLOY_MODE: 'plan',
        PP_DEPLOY_CONFIRM: 'yes',
        PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}',
      },
      parameterOverrides: {
        tenantDomain: 'contoso.example',
      },
    });
  });

  it('falls back to system default working directory when source directory is absent', () => {
    const result = resolveAzureDevOpsDeployOptions({
      environment: {
        SYSTEM_DEFAULTWORKINGDIRECTORY: '/agent/default',
        SYSTEM_STAGEDISPLAYNAME: 'uat',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.projectPath).toBe('/agent/default');
    expect(result.data?.stage).toBe('uat');
  });

  it('fails on invalid Azure DevOps parameter override JSON', () => {
    const result = resolveAzureDevOpsDeployOptions({
      environment: {
        PP_DEPLOY_PARAMETER_OVERRIDES: '{bad json}',
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_PARAMETER_OVERRIDES_PARSE_FAILED');
  });

  it('fails on invalid Azure DevOps confirmation input', () => {
    const result = resolveAzureDevOpsDeployOptions({
      environment: {
        PP_DEPLOY_CONFIRM: 'ship-it',
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_CONFIRM_INVALID');
  });

  it('publishes resolved bindings as Azure DevOps output variables on hosted agents', async () => {
    mockDataverseResolution({
      prod: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-prod-1',
              uniquename: 'CoreManaged',
              friendlyname: 'Core Managed',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [],
          dependencies: [],
          connectionreferences: [],
          environmentvariabledefinitions: [
            {
              environmentvariabledefinitionid: 'envvar-def-1',
              schemaname: 'pp_TenantDomain',
              displayname: 'Tenant Domain',
              defaultvalue: '',
              type: 'string',
              _solutionid_value: 'solution-prod-1',
            },
          ],
          environmentvariablevalues: [
            {
              environmentvariablevalueid: 'envvar-value-1',
              value: 'old.example',
              _environmentvariabledefinitionid_value: 'envvar-def-1',
              statecode: 0,
            },
          ],
        },
      }),
    });

    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const result = await runAzureDevOpsDeploy({
      projectPath: resolveRepoPath('fixtures', 'analysis', 'project'),
      mode: 'dry-run',
      environment: {
        TF_BUILD: 'True',
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(result.success).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith('##vso[task.setvariable variable=PP_DEPLOY_SQL_ENDPOINT;isOutput=true]sql.contoso.example\n');
    expect(writeSpy).toHaveBeenCalledWith('##vso[task.setvariable variable=PP_DEPLOY_API_TOKEN;isOutput=true;isSecret=true]super-secret\n');
  });

  it('preserves deploy success and records a warning when Azure DevOps output publication fails', async () => {
    mockDataverseResolution({
      prod: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-prod-1',
              uniquename: 'CoreManaged',
              friendlyname: 'Core Managed',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [],
          dependencies: [],
          connectionreferences: [],
          environmentvariabledefinitions: [
            {
              environmentvariabledefinitionid: 'envvar-def-1',
              schemaname: 'pp_TenantDomain',
              displayname: 'Tenant Domain',
              defaultvalue: '',
              type: 'string',
              _solutionid_value: 'solution-prod-1',
            },
          ],
          environmentvariablevalues: [
            {
              environmentvariablevalueid: 'envvar-value-1',
              value: 'old.example',
              _environmentvariabledefinitionid_value: 'envvar-def-1',
              statecode: 0,
            },
          ],
        },
      }),
    });

    vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      throw new Error('stdout closed');
    });

    const result = await runAzureDevOpsDeploy({
      projectPath: resolveRepoPath('fixtures', 'analysis', 'project'),
      mode: 'dry-run',
      environment: {
        TF_BUILD: 'true',
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(result.success).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'DEPLOY_ADAPTER_AZURE_PIPELINES_OUTPUT_WRITE_FAILED')).toBe(true);
  });
});
