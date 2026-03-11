import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildBlankAppUrl,
  buildSolutionAppsUrl,
  getStudioRuntimeCandidates,
  isBlankAppTargetUrl,
  isBrowserProfileAlreadyInUseError,
  launchDelegatedBrowserContext,
  resolveInitialTargetUrl,
  selectEmbeddedStudioFrame,
} from './canvas-create-delegate';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('detects persistent-profile lock launch errors', () => {
    expect(isBrowserProfileAlreadyInUseError(new Error('Chromium user data directory is already in use.'))).toBe(true);
    expect(isBrowserProfileAlreadyInUseError(new Error('ProcessSingleton startup lock is busy'))).toBe(true);
    expect(isBrowserProfileAlreadyInUseError(new Error('Navigation timeout'))).toBe(false);
  });

  it('clones the browser profile into a disposable retry directory when the persisted profile is locked', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'pp-browser-profile-'));
    await writeFile(join(sourceDir, 'Local State'), '{}', 'utf8');
    await writeFile(join(sourceDir, 'SingletonLock'), 'locked', 'utf8');
    await writeFile(join(sourceDir, 'Preferences'), '{"profile":"fixture"}', 'utf8');

    const launch = vi
      .spyOn(chromium, 'launchPersistentContext')
      .mockRejectedValueOnce(new Error('Chromium user data directory is already in use at /tmp/source'))
      .mockResolvedValueOnce({
        pages: () => [],
        newPage: vi.fn(),
        close: vi.fn(),
      } as never);

    const outDir = await mkdtemp(join(tmpdir(), 'pp-canvas-artifacts-'));
    const launched = await launchDelegatedBrowserContext(
      sourceDir,
      { name: 'maker-fixture', kind: 'edge' },
      {
        envAlias: 'fixture',
        solutionUniqueName: 'HarnessSolution',
        solutionId: 'solution-1',
        appName: 'Harness Canvas',
        browserProfileName: 'maker-fixture',
        browserProfile: { name: 'maker-fixture', kind: 'edge' },
        browserProfileDir: sourceDir,
        client: {} as never,
        makerEnvironmentId: 'env-123',
        outDir,
        headless: true,
        slowMoMs: 0,
        timeoutMs: 60_000,
        pollTimeoutMs: 60_000,
        settleMs: 1_000,
      }
    );

    expect(launch).toHaveBeenCalledTimes(2);
    expect(launch.mock.calls[0]?.[0]).toBe(sourceDir);
    expect(launch.mock.calls[1]?.[0]).toContain('.browser-profile-clones');
    expect(launch.mock.calls[1]?.[0]).toContain('maker-fixture-locked-retry');
    expect(launched.requestedUserDataDir).toBe(sourceDir);
    expect(launched.effectiveUserDataDir).toBe(launch.mock.calls[1]?.[0]);
    expect(launched.fallbackClone).toMatchObject({
      sourceUserDataDir: sourceDir,
      clonedUserDataDir: launch.mock.calls[1]?.[0],
      omittedEntries: ['SingletonCookie', 'SingletonLock', 'SingletonSocket'],
    });
  });
});
