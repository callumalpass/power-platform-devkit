import { describe, expect, it, vi } from 'vitest';
import { resolveDeployConfirm, resolveDeployMode, resolveParameterOverrides, runResolvedDeploy, type DeployBindingPublisher } from './index';
import { createFixtureDataverseClient, mockDataverseResolution } from '../../../../test/dataverse-fixture';
import { resolveRepoPath } from '../../../../test/golden';

describe('adapter shared deploy option helpers', () => {
  it('rejects unsupported deploy modes with the provided hint', () => {
    const result = resolveDeployMode(undefined, 'live', '@pp/adapter-shared-test', 'set a real mode');

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'DEPLOY_ADAPTER_MODE_INVALID',
      hint: 'set a real mode',
    });
  });

  it('parses JSON parameter overrides into scalar values', () => {
    const result = resolveParameterOverrides(
      undefined,
      '{"tenantDomain":"contoso.example","retryCount":3,"enabled":true}',
      '@pp/adapter-shared-test',
      'set valid json'
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      tenantDomain: 'contoso.example',
      retryCount: 3,
      enabled: true,
    });
  });

  it('rejects unsupported confirmation strings with the provided hint', () => {
    const result = resolveDeployConfirm(undefined, 'deploy-now', '@pp/adapter-shared-test', 'set a real confirm value');

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'DEPLOY_ADAPTER_CONFIRM_INVALID',
      hint: 'set a real confirm value',
    });
  });

  it('publishes resolved bindings after shared deploy execution completes', async () => {
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

    const publishBindings = vi.fn<DeployBindingPublisher>().mockResolvedValue({
      success: true,
      data: undefined,
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
    });

    const result = await runResolvedDeploy({
      projectPath: resolveRepoPath('fixtures', 'analysis', 'project'),
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
      mode: 'dry-run',
      publishBindings,
    });

    expect(result.success).toBe(true);
    expect(publishBindings).toHaveBeenCalledTimes(1);
    expect(publishBindings.mock.calls[0]?.[0]).toMatchObject({
      inputs: [
        expect.objectContaining({
          target: 'sql-endpoint',
          value: 'sql.contoso.example',
        }),
      ],
      secrets: [
        expect.objectContaining({
          target: 'api-token',
          value: 'super-secret',
        }),
      ],
    });
  });
});
