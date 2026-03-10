import { describe, expect, it } from 'vitest';
import { resolveAzureDevOpsDeployOptions } from './index';

describe('resolveAzureDevOpsDeployOptions', () => {
  it('hydrates adapter options from Azure DevOps pipeline variables', () => {
    const result = resolveAzureDevOpsDeployOptions({
      environment: {
        BUILD_SOURCESDIRECTORY: '/agent/work/repo',
        RELEASE_ENVIRONMENTNAME: 'prod',
        PP_DEPLOY_MODE: 'plan',
        PP_DEPLOY_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      projectPath: '/agent/work/repo',
      stage: 'prod',
      mode: 'plan',
      environment: {
        BUILD_SOURCESDIRECTORY: '/agent/work/repo',
        RELEASE_ENVIRONMENTNAME: 'prod',
        PP_DEPLOY_MODE: 'plan',
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
});
