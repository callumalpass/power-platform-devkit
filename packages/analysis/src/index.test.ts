import { describe, expect, it } from 'vitest';
import { generatePortfolioReport, renderMarkdownPortfolioReport, renderMarkdownReport } from './index';
import type { ProjectContext } from '@pp/project';

describe('renderMarkdownReport', () => {
  it('renders a stable project report', () => {
    const project: ProjectContext = {
      root: '/tmp/demo',
      discovery: {
        inspectedPath: '/tmp/demo',
        resolvedRoot: '/tmp/demo',
        configFound: true,
        usedDefaultLayout: false,
        descendantProjectConfigs: [],
        descendantProjectRoots: [],
      },
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
          sensitive: false,
          hasValue: true,
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
      topology: {
        defaultStage: 'dev',
        selectedStage: 'dev',
        activeEnvironment: 'dev',
        activeSolution: {
          alias: 'core',
          environment: 'dev',
          uniqueName: 'core',
          source: 'default',
        },
        stages: {
          dev: {
            name: 'dev',
            environment: 'dev',
            defaultSolution: {
              alias: 'core',
              environment: 'dev',
              uniqueName: 'core',
              source: 'default',
            },
            solutions: {},
            parameterOverrides: [],
          },
        },
      },
      templateRegistries: [],
      build: {},
      diagnostics: [],
    };

    const report = renderMarkdownReport(project);
    expect(report).toContain('# Project Report');
    expect(report).toContain('Default environment');
    expect(report).toContain('Selected stage');
    expect(report).toContain('API_BASE_URL');
  });

  it('aggregates portfolio drift, usage, and governance views across projects', () => {
    const baseProject: ProjectContext = {
      root: '/tmp/demo-a',
      configPath: '/tmp/demo-a/pp.config.yaml',
      discovery: {
        inspectedPath: '/tmp/demo-a',
        resolvedRoot: '/tmp/demo-a',
        configFound: true,
        usedDefaultLayout: false,
        descendantProjectConfigs: [],
        descendantProjectRoots: [],
      },
      config: {
        defaults: {
          environment: 'dev',
          solution: 'core',
        },
        docs: {
          owner: 'team-alpha',
          paths: ['docs'],
        },
      },
      providerBindings: {
        primaryDataverse: {
          kind: 'dataverse',
          target: 'dev',
        },
      },
      parameters: {
        API_BASE_URL: {
          name: 'API_BASE_URL',
          type: 'string',
          source: 'environment',
          value: 'https://api.example.test',
          sensitive: false,
          hasValue: true,
          definition: {
            fromEnv: 'PP_API_BASE_URL',
            required: true,
          },
        },
      },
      assets: [
        {
          name: 'apps',
          path: '/tmp/demo-a/apps',
          kind: 'directory',
          exists: true,
        },
      ],
      topology: {
        defaultStage: 'dev',
        selectedStage: 'dev',
        activeEnvironment: 'dev',
        activeSolution: {
          alias: 'core',
          environment: 'dev',
          uniqueName: 'core',
          source: 'default',
        },
        stages: {
          dev: {
            name: 'dev',
            environment: 'dev',
            defaultSolution: {
              alias: 'core',
              environment: 'dev',
              uniqueName: 'core',
              source: 'default',
            },
            solutions: {},
            parameterOverrides: [],
          },
        },
      },
      templateRegistries: [],
      build: {},
      diagnostics: [],
      docs: {
        owner: 'team-alpha',
        paths: ['docs'],
      },
    };
    const driftedProject: ProjectContext = {
      ...baseProject,
      root: '/tmp/demo-b',
      configPath: '/tmp/demo-b/pp.config.yaml',
      discovery: {
        inspectedPath: '/tmp/demo-b',
        resolvedRoot: '/tmp/demo-b',
        configFound: true,
        usedDefaultLayout: false,
        descendantProjectConfigs: [],
        descendantProjectRoots: [],
      },
      config: {
        defaults: {
          environment: 'prod',
          solution: 'core',
        },
      },
      providerBindings: {
        primaryDataverse: {
          kind: 'custom-connector',
          target: 'prod-api',
        },
      },
      parameters: {
        API_BASE_URL: {
          name: 'API_BASE_URL',
          type: 'string',
          source: 'value',
          value: 'https://prod.example.test',
          sensitive: true,
          hasValue: true,
          definition: {
            value: 'https://prod.example.test',
            required: true,
          },
        },
        API_TOKEN: {
          name: 'API_TOKEN',
          type: 'string',
          source: 'missing',
          sensitive: true,
          hasValue: false,
          definition: {
            secretRef: 'api_token',
            required: true,
          },
        },
      },
      assets: [
        {
          name: 'apps',
          path: '/tmp/demo-b/client-apps',
          kind: 'directory',
          exists: true,
        },
        {
          name: 'flows',
          path: '/tmp/demo-b/flows',
          kind: 'directory',
          exists: false,
        },
      ],
      topology: {
        defaultStage: 'prod',
        selectedStage: 'prod',
        activeEnvironment: 'prod',
        activeSolution: {
          alias: 'core',
          environment: 'prod',
          uniqueName: 'core-managed',
          source: 'default',
        },
        stages: {
          dev: {
            name: 'dev',
            environment: 'sandbox',
            defaultSolution: {
              alias: 'core',
              environment: 'sandbox',
              uniqueName: 'core-sandbox',
              source: 'default',
            },
            solutions: {},
            parameterOverrides: [],
          },
        },
      },
      templateRegistries: [],
      build: {},
      diagnostics: [],
      docs: undefined,
    };

    const report = generatePortfolioReport([baseProject, driftedProject]);
    expect(report.success).toBe(true);
    expect(report.data?.summary.projectCount).toBe(2);
    expect(report.data?.summary.driftCount).toBeGreaterThanOrEqual(3);
    expect(report.data?.drift.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'PORTFOLIO_STAGE_DRIFT',
        'PORTFOLIO_PROVIDER_BINDING_DRIFT',
        'PORTFOLIO_PARAMETER_DRIFT',
        'PORTFOLIO_ASSET_DRIFT',
      ])
    );
    expect(report.data?.governance.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'PORTFOLIO_OWNER_MISSING',
        'PORTFOLIO_PROVENANCE_MISSING',
        'PORTFOLIO_UNSUPPORTED_PROVIDER_KIND',
        'PORTFOLIO_MISSING_ASSET',
        'PORTFOLIO_REQUIRED_PARAMETER_MISSING',
        'PORTFOLIO_UNSAFE_SENSITIVE_VALUE',
      ])
    );
    expect(report.data?.inventories.assetUsage.find((entry) => entry.assetName === 'apps')?.relativePaths).toEqual(
      expect.arrayContaining(['apps', 'client-apps'])
    );

    const markdown = renderMarkdownPortfolioReport(report.data!);
    expect(markdown).toContain('# Portfolio Report');
    expect(markdown).toContain('Drift findings');
    expect(markdown).toContain('Governance');
  });
});
