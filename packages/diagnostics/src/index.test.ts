import { describe, expect, it } from 'vitest';
import { createDiagnostic, fail, ok } from './index';

describe('diagnostics', () => {
  it('creates successful results', () => {
    const result = ok({ value: 1 }, { supportTier: 'stable' });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe(1);
    expect(result.supportTier).toBe('stable');
  });

  it('creates failed results', () => {
    const result = fail(createDiagnostic('error', 'TEST', 'Broken'));
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('TEST');
  });
});
