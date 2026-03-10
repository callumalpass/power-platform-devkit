import { describe, expect, it, vi } from 'vitest';
import {
  publishAzurePipelineDeployBindings,
  resolveDeployConfirm,
  resolveDeployMode,
  resolveParameterOverrides,
  runResolvedDeploy,
  type DeployBindingPublisher,
} from './index';
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

  it('publishes resolved bindings as Azure Pipelines output variables on hosted agents', async () => {
    const commandWriter = vi.fn<(command: string) => void>();
    const result = await publishAzurePipelineDeployBindings(
      {
        inputs: [
          {
            kind: 'deploy-input',
            parameter: 'sqlEndpoint',
            source: 'parameter',
            sensitive: false,
            status: 'resolved',
            target: 'sql-endpoint',
            value: 'sql.contoso.example',
            valuePreview: 'sql.contoso.example',
          },
        ],
        secrets: [
          {
            kind: 'deploy-secret',
            parameter: 'apiToken',
            source: 'secret',
            sensitive: true,
            status: 'resolved',
            target: 'api-token',
            reference: 'app_token',
            value: 'super-secret',
            valuePreview: '<redacted>',
          },
        ],
      },
      {
        source: '@pp/adapter-shared-test',
        environment: {
          TF_BUILD: 'True',
        },
        commandWriter,
      }
    );

    expect(result.success).toBe(true);
    expect(commandWriter.mock.calls).toEqual([
      ['##vso[task.setvariable variable=PP_DEPLOY_SQL_ENDPOINT;isOutput=true]sql.contoso.example\n'],
      ['##vso[task.setvariable variable=PP_DEPLOY_API_TOKEN;isOutput=true;isSecret=true]super-secret\n'],
    ]);
  });

  it('does not emit Azure Pipelines commands outside hosted agents', async () => {
    const commandWriter = vi.fn<(command: string) => void>();
    const result = await publishAzurePipelineDeployBindings(
      {
        inputs: [
          {
            kind: 'deploy-input',
            parameter: 'sqlEndpoint',
            source: 'parameter',
            sensitive: false,
            status: 'resolved',
            target: 'sql-endpoint',
            value: 'sql.contoso.example',
            valuePreview: 'sql.contoso.example',
          },
        ],
        secrets: [],
      },
      {
        source: '@pp/adapter-shared-test',
        environment: {},
        commandWriter,
      }
    );

    expect(result.success).toBe(true);
    expect(commandWriter).not.toHaveBeenCalled();
  });

  it('returns a diagnostic when Azure Pipelines output publication fails', async () => {
    const result = await publishAzurePipelineDeployBindings(
      {
        inputs: [
          {
            kind: 'deploy-input',
            parameter: 'sqlEndpoint',
            source: 'parameter',
            sensitive: false,
            status: 'resolved',
            target: 'sql-endpoint',
            value: 'line1\nline2',
            valuePreview: 'line1 line2',
          },
        ],
        secrets: [],
      },
      {
        source: '@pp/adapter-shared-test',
        environment: {
          TF_BUILD: 'true',
        },
        commandWriter: () => {
          throw new Error('stdout closed');
        },
      }
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_AZURE_PIPELINES_OUTPUT_WRITE_FAILED');
  });
});
