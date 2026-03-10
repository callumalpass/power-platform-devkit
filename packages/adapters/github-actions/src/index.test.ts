import { describe, expect, it } from 'vitest';
import { resolveGitHubActionsDeployOptions } from './index';

describe('resolveGitHubActionsDeployOptions', () => {
  it('hydrates adapter options from GitHub Actions inputs and workspace defaults', () => {
    const result = resolveGitHubActionsDeployOptions({
      environment: {
        GITHUB_WORKSPACE: '/workspace/repo',
        INPUT_STAGE: 'prod',
        INPUT_MODE: 'dry-run',
        INPUT_CONFIRM: 'true',
        INPUT_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example","retryCount":3,"enabled":true}',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      projectPath: '/workspace/repo',
      stage: 'prod',
      mode: 'dry-run',
      confirm: true,
      environment: {
        GITHUB_WORKSPACE: '/workspace/repo',
        INPUT_STAGE: 'prod',
        INPUT_MODE: 'dry-run',
        INPUT_CONFIRM: 'true',
        INPUT_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example","retryCount":3,"enabled":true}',
      },
      parameterOverrides: {
        tenantDomain: 'contoso.example',
        retryCount: 3,
        enabled: true,
      },
    });
  });

  it('lets explicit options override environment-derived values', () => {
    const result = resolveGitHubActionsDeployOptions({
      projectPath: '/tmp/project',
      stage: 'test',
      mode: 'plan',
      parameterOverrides: {
        tenantDomain: 'override.example',
      },
      environment: {
        GITHUB_WORKSPACE: '/workspace/repo',
        INPUT_STAGE: 'prod',
        INPUT_MODE: 'dry-run',
        INPUT_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.projectPath).toBe('/tmp/project');
    expect(result.data?.stage).toBe('test');
    expect(result.data?.mode).toBe('plan');
    expect(result.data?.parameterOverrides).toEqual({
      tenantDomain: 'override.example',
    });
  });

  it('fails on invalid GitHub Actions mode input', () => {
    const result = resolveGitHubActionsDeployOptions({
      environment: {
        INPUT_MODE: 'live',
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_MODE_INVALID');
  });

  it('fails on invalid GitHub Actions confirmation input', () => {
    const result = resolveGitHubActionsDeployOptions({
      environment: {
        INPUT_CONFIRM: 'deploy-now',
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_CONFIRM_INVALID');
  });
});
