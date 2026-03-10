import { describe, expect, it } from 'vitest';
import {
  buildBlankAppUrl,
  buildSolutionAppsUrl,
  getStudioRuntimeCandidates,
  isBlankAppTargetUrl,
  resolveInitialTargetUrl,
  selectEmbeddedStudioFrame,
} from './canvas-create-delegate';

describe('canvas delegated create URL routing', () => {
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

  it('prefers the embedded Studio frame for runtime automation when present', () => {
    const embeddedFrame = {
      name: () => 'EmbeddedStudio',
      url: () => 'https://authoring.powerapps.com/embed/',
    };
    const otherFrame = {
      name: () => 'preloadStudio',
      url: () => 'https://authoring.powerapps.com/embed/?preload=prefetch',
    };
    const page = {
      frames: () => [otherFrame, embeddedFrame],
    };

    expect(selectEmbeddedStudioFrame(page.frames())).toBe(embeddedFrame);
    expect(getStudioRuntimeCandidates(page as never)[0]).toBe(embeddedFrame);
  });

  it('falls back to embed-like frame urls when the named studio frame is absent', () => {
    const frame = {
      name: () => 'authoring-shell',
      url: () => 'https://authoring.powerapps.com/v3/embed/',
    };

    expect(selectEmbeddedStudioFrame([frame] as never)).toBe(frame);
  });
});
