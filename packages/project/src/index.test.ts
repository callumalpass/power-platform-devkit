import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverProject } from './index';

describe('discoverProject', () => {
  it('loads config and resolves environment-backed parameters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-project-'));
    await mkdir(join(root, 'apps'));
    await writeFile(
      join(root, 'pp.config.json'),
      JSON.stringify(
        {
          defaults: {
            environment: 'dev',
            solution: 'core',
            stage: 'dev',
          },
          solutions: {
            core: {
              uniqueName: 'Core',
            },
          },
          providerBindings: {
            marketing: {
              kind: 'sharepoint-site',
              target: 'https://example.sharepoint.com/sites/marketing',
            },
          },
          parameters: {
            API_BASE_URL: {
              fromEnv: 'PP_API_BASE_URL',
              required: true,
            },
          },
          topology: {
            defaultStage: 'dev',
            stages: {
              dev: {
                environment: 'dev',
                solution: 'core',
              },
            },
          },
        },
        null,
        2
      )
    );

    process.env.PP_API_BASE_URL = 'https://api.example.test';
    const result = await discoverProject(root);

    expect(result.success).toBe(true);
    expect(result.data?.parameters.API_BASE_URL?.value).toBe('https://api.example.test');
    expect(result.data?.assets.find((asset) => asset.name === 'apps')?.exists).toBe(true);
    expect(result.data?.topology.selectedStage).toBe('dev');
    expect(result.data?.topology.activeSolution?.uniqueName).toBe('Core');
  });

  it('resolves stage overrides, secret refs, and cli parameter overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-project-topology-'));
    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'defaults:',
        '  environment: dev',
        '  solution: core',
        'solutions:',
        '  core:',
        '    uniqueName: CoreDev',
        'parameters:',
        '  releaseName:',
        '    type: string',
        '    value: preview',
        '  apiToken:',
        '    secretRef: app_token',
        '    required: true',
        'secrets:',
        '  defaultProvider: pipeline',
        '  providers:',
        '    pipeline:',
        '      kind: env',
        '      prefix: PP_SECRET_',
        'topology:',
        '  defaultStage: prod',
        '  stages:',
        '    prod:',
        '      environment: prod',
        '      solution: core',
        '      solutions:',
        '        core:',
        '          uniqueName: CoreProd',
        '      parameters:',
        '        releaseName: release',
      ].join('\n'),
      'utf8'
    );

    process.env.PP_SECRET_app_token = 'super-secret';

    const result = await discoverProject(root, {
      stage: 'prod',
      parameterOverrides: {
        releaseName: 'override',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.topology.selectedStage).toBe('prod');
    expect(result.data?.topology.activeEnvironment).toBe('prod');
    expect(result.data?.topology.activeSolution?.uniqueName).toBe('CoreProd');
    expect(result.data?.parameters.releaseName?.value).toBe('override');
    expect(result.data?.parameters.apiToken?.source).toBe('secret');
    expect(result.data?.parameters.apiToken?.sensitive).toBe(true);
    expect(result.data?.parameters.apiToken?.hasValue).toBe(true);
  });
});
