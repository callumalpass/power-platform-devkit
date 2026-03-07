import { describe, expect, it } from 'vitest';
import { renderMarkdownReport } from './index';
import type { ProjectContext } from '@pp/project';

describe('renderMarkdownReport', () => {
  it('renders a stable project report', () => {
    const project: ProjectContext = {
      root: '/tmp/demo',
      config: {
        defaults: {
          environment: 'dev',
          solution: 'core',
        },
      },
      providerBindings: {
        marketing: {
          kind: 'sharepoint-site',
          target: 'https://example.test/sites/marketing',
        },
      },
      parameters: {
        API_BASE_URL: {
          name: 'API_BASE_URL',
          type: 'string',
          source: 'environment',
          value: 'https://api.example.test',
          definition: {
            fromEnv: 'PP_API_BASE_URL',
          },
        },
      },
      assets: [
        {
          name: 'apps',
          path: '/tmp/demo/apps',
          kind: 'directory',
          exists: true,
        },
      ],
      diagnostics: [],
    };

    const report = renderMarkdownReport(project);
    expect(report).toContain('# Project Report');
    expect(report).toContain('Default environment');
    expect(report).toContain('API_BASE_URL');
  });
});
