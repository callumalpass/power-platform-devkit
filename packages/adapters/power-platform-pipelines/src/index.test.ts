import { describe, expect, it } from 'vitest';
import { resolvePowerPlatformPipelinesDeployOptions } from './index';

describe('resolvePowerPlatformPipelinesDeployOptions', () => {
  it('hydrates adapter options from pipeline workspace variables', () => {
    const result = resolvePowerPlatformPipelinesDeployOptions({
      environment: {
        PIPELINE_WORKSPACE: '/pipelines/workspace',
        PIPELINE_STAGE: 'release',
        PP_DEPLOY_MODE: 'dry-run',
        PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example","enabled":true}',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      projectPath: '/pipelines/workspace',
      stage: 'release',
      mode: 'dry-run',
      environment: {
        PIPELINE_WORKSPACE: '/pipelines/workspace',
        PIPELINE_STAGE: 'release',
        PP_DEPLOY_MODE: 'dry-run',
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
});
