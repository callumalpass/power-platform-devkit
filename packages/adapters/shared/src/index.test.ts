import { describe, expect, it } from 'vitest';
import { resolveDeployConfirm, resolveDeployMode, resolveParameterOverrides } from './index';

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
});
