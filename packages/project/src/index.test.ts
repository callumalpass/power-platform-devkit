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
  });
});
