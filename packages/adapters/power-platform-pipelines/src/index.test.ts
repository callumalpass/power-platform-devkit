import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePowerPlatformPipelinesDeployOptions, runPowerPlatformPipelinesDeploy } from './index';
import { createFixtureDataverseClient, mockDataverseResolution } from '../../../../test/dataverse-fixture';
import { resolveRepoPath } from '../../../../test/golden';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolvePowerPlatformPipelinesDeployOptions', () => {
  it('hydrates adapter options from pipeline workspace variables', () => {
    const result = resolvePowerPlatformPipelinesDeployOptions({
      environment: {
        PIPELINE_WORKSPACE: '/pipelines/workspace',
        PIPELINE_STAGE: 'release',
        PP_DEPLOY_MODE: 'dry-run',
        PP_DEPLOY_CONFIRM: '1',
        PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example","enabled":true}',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      projectPath: '/pipelines/workspace',
      stage: 'release',
      mode: 'dry-run',
      confirm: true,
      environment: {
        PIPELINE_WORKSPACE: '/pipelines/workspace',
        PIPELINE_STAGE: 'release',
        PP_DEPLOY_MODE: 'dry-run',
        PP_DEPLOY_CONFIRM: '1',
        PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example","enabled":true}',
      },
      parameterOverrides: {
        tenantDomain: 'contoso.example',
        enabled: true,
      },
    });
  });

  it('falls back to system working directory for Power Platform pipelines', () => {
    const result = resolvePowerPlatformPipelinesDeployOptions({
      environment: {
        SYSTEM_DEFAULTWORKINGDIRECTORY: '/pipeline/default',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.projectPath).toBe('/pipeline/default');
  });

  it('rejects unsupported Power Platform pipeline mode values', () => {
    const result = resolvePowerPlatformPipelinesDeployOptions({
      environment: {
        PP_DEPLOY_MODE: 'execute',
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_MODE_INVALID');
  });

  it('rejects unsupported Power Platform pipeline confirmation values', () => {
    const result = resolvePowerPlatformPipelinesDeployOptions({
      environment: {
        PP_DEPLOY_CONFIRM: 'later',
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_CONFIRM_INVALID');
  });

  it('publishes resolved bindings as Power Platform pipeline output variables on hosted agents', async () => {
    mockDataverseResolution({
      release: createFixtureDataverseClient({
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

    const result = await runPowerPlatformPipelinesDeploy({
      projectPath: resolveRepoPath('fixtures', 'analysis', 'project'),
      stage: 'release',
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

  it('preserves deploy success and records a warning when Power Platform pipeline output publication fails', async () => {
    mockDataverseResolution({
      release: createFixtureDataverseClient({
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

    const result = await runPowerPlatformPipelinesDeploy({
      projectPath: resolveRepoPath('fixtures', 'analysis', 'project'),
      stage: 'release',
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
