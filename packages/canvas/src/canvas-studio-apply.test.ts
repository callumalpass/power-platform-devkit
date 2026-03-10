import { describe, expect, it } from 'vitest';
import { buildPersistentContextLaunchOptions, parseArgs } from '../../../scripts/canvas-studio-apply';

describe('canvas studio apply argument parsing', () => {
  it('requires an explicit browser kind', () => {
    expect(() =>
      parseArgs(['--studio-url', 'https://example.test', '--browser-profile-dir', '/tmp/profile', '--yaml-dir', '/tmp/yaml'])
    ).toThrowError('--studio-url, --browser-profile-dir, --browser-kind, and --yaml-dir are required.');
  });

  it('parses browser launch flags for profile-backed automation', () => {
    const options = parseArgs([
      '--studio-url',
      'https://example.test',
      '--browser-profile-dir',
      '/tmp/profile',
      '--browser-kind',
      'edge',
      '--browser-arg',
      '--disable-features=FeatureA',
      '--browser-arg',
      '--start-maximized',
      '--yaml-dir',
      '/tmp/yaml',
      '--headless',
    ]);

    expect(options.browserKind).toBe('edge');
    expect(options.browserArgs).toEqual(['--disable-features=FeatureA', '--start-maximized']);
    expect(options.headless).toBe(true);
  });
});

describe('canvas studio apply persistent context launch options', () => {
  it('maps edge profiles onto the matching Playwright channel', () => {
    const launchOptions = buildPersistentContextLaunchOptions({
      browserKind: 'edge',
      browserArgs: ['--start-maximized'],
      debug: false,
      headless: true,
      slowMoMs: 250,
    });

    expect(launchOptions.channel).toBe('msedge');
    expect(launchOptions.executablePath).toBeUndefined();
    expect(launchOptions.headless).toBe(true);
    expect(launchOptions.args).toEqual(['--no-first-run', '--new-window', '--start-maximized']);
  });

  it('uses an explicit browser command when provided', () => {
    const launchOptions = buildPersistentContextLaunchOptions({
      browserKind: 'custom',
      browserCommand: '/opt/browser/custom-browser',
      browserArgs: ['--flag'],
      debug: true,
      headless: true,
      slowMoMs: 500,
    });

    expect(launchOptions.executablePath).toBe('/opt/browser/custom-browser');
    expect(launchOptions.channel).toBeUndefined();
    expect(launchOptions.headless).toBe(false);
    expect(launchOptions.slowMo).toBe(500);
    expect(launchOptions.args).toEqual(['--no-first-run', '--new-window', '--auto-open-devtools-for-tabs', '--flag']);
  });

  it('rejects custom browser profiles without a command', () => {
    expect(() =>
      buildPersistentContextLaunchOptions({
        browserKind: 'custom',
        browserArgs: [],
        debug: false,
        headless: false,
        slowMoMs: 250,
      })
    ).toThrowError('--browser-command is required when --browser-kind custom is selected.');
  });
});
