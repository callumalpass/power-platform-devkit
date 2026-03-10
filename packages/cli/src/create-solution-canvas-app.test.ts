import { describe, expect, it } from 'vitest';
import { buildBlankAppUrl, buildSolutionAppsUrl, isBlankAppTargetUrl, resolveInitialTargetUrl } from '../../../scripts/create-solution-canvas-app';

describe('create-solution-canvas-app URL routing', () => {
  it('prefers the solution-scoped blank-app deep link when Maker metadata is available', () => {
    expect(
      resolveInitialTargetUrl({
        makerEnvironmentId: 'env-123',
        solutionId: 'solution-1',
        appName: 'Harness Canvas',
      })
    ).toBe(
      'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1'
    );
  });

  it('preserves an explicit target URL override', () => {
    expect(
      resolveInitialTargetUrl({
        explicitTargetUrl: 'https://example.test/custom-target',
        makerEnvironmentId: 'env-123',
        solutionId: 'solution-1',
        appName: 'Harness Canvas',
      })
    ).toBe('https://example.test/custom-target');
  });

  it('fails clearly when it cannot build either deep link', () => {
    expect(() =>
      resolveInitialTargetUrl({
        solutionId: 'solution-1',
        appName: 'Harness Canvas',
      })
    ).toThrow('--maker-env-id or an environment alias with makerEnvironmentId is required.');
  });

  it('classifies blank-app deep links separately from the apps grid', () => {
    expect(
      isBlankAppTargetUrl(
        buildBlankAppUrl({
          makerEnvironmentId: 'env-123',
          solutionId: 'solution-1',
          appName: 'Harness Canvas',
        })
      )
    ).toBe(true);
    expect(
      isBlankAppTargetUrl(
        buildSolutionAppsUrl({
          makerEnvironmentId: 'env-123',
          solutionId: 'solution-1',
        })
      )
    ).toBe(false);
  });
});
