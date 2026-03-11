import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getInitSession, resumeInitSession, startInitSession } from './init';

describe('init sessions', () => {
  it('completes a non-interactive environment-token bootstrap and scaffolds a project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-init-project-'));
    const configDir = await mkdtemp(join(tmpdir(), 'pp-init-config-'));
    process.env.PP_INIT_TEST_TOKEN = 'fixture-token';

    const result = await startInitSession(
      {
        root,
        goal: 'project',
        authMode: 'environment-token',
        authProfileName: 'ci',
        tokenEnvVar: 'PP_INIT_TEST_TOKEN',
        environmentAlias: 'dev',
        environmentUrl: 'https://example.crm.dynamics.com',
        projectName: 'demo',
        solutionName: 'Core',
        stageName: 'dev',
      },
      { configDir }
    );

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('completed');
    expect(result.data?.artifacts.authProfile).toMatchObject({ name: 'ci', status: 'created' });
    expect(result.data?.artifacts.environment).toMatchObject({ name: 'dev', status: 'created' });
    expect(result.data?.artifacts.project).toMatchObject({ name: 'demo', status: 'created' });
    expect(result.data?.verification).toMatchObject({
      auth: 'verified',
      browserBootstrap: 'skipped',
      project: 'verified',
    });

    const config = await readFile(join(root, 'pp.config.yaml'), 'utf8');
    expect(config).toContain('name: demo');
    expect(config).toContain('environment: dev');
  });

  it('pauses on external auth and browser bootstrap for maker/full workflows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-init-maker-'));
    const configDir = await mkdtemp(join(tmpdir(), 'pp-init-config-'));

    const started = await startInitSession(
      {
        root,
        goal: 'full',
        authMode: 'user',
        authProfileName: 'maker-user',
        loginHint: '',
        environmentAlias: 'dev',
        environmentUrl: 'https://example.crm.dynamics.com',
        browserProfileName: 'maker-browser',
        projectName: 'demo',
        solutionName: 'Core',
        stageName: 'dev',
      },
      { configDir }
    );

    expect(started.success).toBe(true);
    expect(started.data?.status).toBe('active');
    expect(started.data?.externalAction?.kind).toBe('authenticate-profile');
    expect(started.data?.artifacts.browserProfile).toMatchObject({ name: 'maker-browser' });

    const persisted = await getInitSession(started.data?.id as string, { configDir });
    expect(persisted.success).toBe(true);
    expect(persisted.data?.externalAction?.kind).toBe('authenticate-profile');

    await mkdir(join(configDir, 'browser-profiles'), { recursive: true });

    const resumed = await resumeInitSession(started.data?.id as string, {}, { configDir });
    expect(resumed.success).toBe(true);
    expect(resumed.data?.externalAction?.kind).toBe('authenticate-profile');
  });
});
