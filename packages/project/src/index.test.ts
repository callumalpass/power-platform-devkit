import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverProject, doctorProject, initProject, planProjectInit } from './index';

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

  it('scaffolds a minimal project config and default asset directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-project-init-'));
    const plan = planProjectInit(root, {
      name: 'demo',
      environment: 'sandbox',
      solution: 'CoreLifecycle',
      stage: 'dev',
    });

    expect(plan.configPath).toBe(join(root, 'pp.config.yaml'));
    expect(plan.actions).toHaveLength(6);
    expect(plan.layout).toEqual({
      scaffoldProfile: 'source-first',
      scaffoldedAssetRoots: ['apps', 'flows', 'solutions', 'docs'],
      recommendedBundlePath: 'artifacts/solutions/CoreLifecycle.zip',
      sourceFirstConvention:
        'The default scaffold is source-first: keep editable solution source in `solutions/` alongside `apps/`, `flows/`, and `docs/`.',
      bundleFirstConvention:
        'If the repo primarily tracks exported packages, keep packaged solution zips under `artifacts/solutions/CoreLifecycle.zip` instead of mixing them into `solutions/`.',
    });

    const result = await initProject(root, {
      name: 'demo',
      environment: 'sandbox',
      solution: 'CoreLifecycle',
      stage: 'dev',
    });

    expect(result.success).toBe(true);
    expect(result.data?.created).toContain(join(root, 'pp.config.yaml'));
    expect(result.data?.created).toContain(join(root, 'apps'));
    expect(result.data?.created).toContain(join(root, 'flows'));
    expect(result.data?.created).toContain(join(root, 'solutions'));
    expect(result.data?.created).toContain(join(root, 'docs'));
    expect(result.data?.created).toContain(join(root, 'artifacts', 'solutions'));
    expect(result.data?.layout.recommendedBundlePath).toBe('artifacts/solutions/CoreLifecycle.zip');
    expect(result.data?.contract).toEqual({
      layoutProfile: 'source-first',
      editableAssetRoots: ['apps', 'flows', 'solutions', 'docs'],
      solutionSourceRoot: 'solutions',
      canonicalBundlePath: 'artifacts/solutions/CoreLifecycle.zip',
      defaultTarget: {
        stage: 'dev',
        environmentAlias: 'sandbox',
        solutionAlias: 'CoreLifecycle',
        solutionUniqueName: 'CoreLifecycle',
      },
      activeTarget: {
        stage: 'dev',
        environmentAlias: 'sandbox',
        solutionAlias: 'CoreLifecycle',
        solutionUniqueName: 'CoreLifecycle',
      },
      stageMappings: [
        {
          stage: 'dev',
          environmentAlias: 'sandbox',
          solutionAlias: 'CoreLifecycle',
          solutionUniqueName: 'CoreLifecycle',
          solutionMappings: [
            {
              alias: 'CoreLifecycle',
              environmentAlias: 'sandbox',
              uniqueName: 'CoreLifecycle',
              source: 'project',
            },
          ],
          parameterOverrides: [],
        },
      ],
    });
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining([
        'Run `pp project doctor` to inspect the scaffolded layout and any missing inputs.',
        'Keep unpacked solution source under `solutions/` and write generated zips to `artifacts/solutions/CoreLifecycle.zip`.',
      ])
    );

    const discovery = await discoverProject(root);
    expect(discovery.success).toBe(true);
    expect(discovery.data?.config.defaults?.environment).toBe('sandbox');
    expect(discovery.data?.topology.activeSolution?.uniqueName).toBe('CoreLifecycle');

    const doctor = await doctorProject(root);
    expect(doctor.success).toBe(true);
    expect(doctor.data?.summary.layoutProfile).toBe('source-first');
    expect(doctor.data?.layout.normalizedAssets.solutionBundle).toBe('artifacts/solutions/CoreLifecycle.zip');
    expect(doctor.data?.contract.canonicalBundlePath).toBe('artifacts/solutions/CoreLifecycle.zip');
    expect(doctor.data?.contract.stageMappings).toEqual([
      {
        stage: 'dev',
        environmentAlias: 'sandbox',
        solutionAlias: 'CoreLifecycle',
        solutionUniqueName: 'CoreLifecycle',
        solutionMappings: [
          {
            alias: 'CoreLifecycle',
            environmentAlias: 'sandbox',
            uniqueName: 'CoreLifecycle',
            source: 'project',
          },
        ],
        parameterOverrides: [],
      },
    ]);
  });

  it('reports layout problems and missing required parameters through doctorProject', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-project-doctor-'));
    await mkdir(join(root, 'apps'));
    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'defaults:',
        '  environment: dev',
        '  solution: Core',
        'parameters:',
        '  tenantDomain:',
        '    type: string',
        '    fromEnv: PP_TENANT_DOMAIN',
        '    required: true',
      ].join('\n'),
      'utf8'
    );

    const report = await doctorProject(root, {
      environment: {
        PP_TENANT_DOMAIN: undefined,
      },
    });

    expect(report.success).toBe(true);
    expect(report.data?.summary.hasConfig).toBe(true);
    expect(report.data?.summary.missingAssetCount).toBeGreaterThan(0);
    expect(report.data?.summary.unresolvedRequiredParameterCount).toBe(1);
    expect(report.data?.checks.some((check) => check.code === 'PROJECT_PARAMETER_MISSING')).toBe(true);
    expect(report.data?.checks.some((check) => check.code === 'PROJECT_DOCTOR_ASSET_MISSING')).toBe(true);
  });

  it('auto-selects the only descendant project root when discovery starts above it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-project-discovery-'));
    const fixtureProjectRoot = join(root, 'fixtures', 'analysis', 'project');
    await mkdir(fixtureProjectRoot, { recursive: true });
    await writeFile(
      join(fixtureProjectRoot, 'pp.config.yaml'),
      [
        'defaults:',
        '  environment: prod',
        '  solution: core',
        'topology:',
        '  defaultStage: prod',
        '  stages:',
        '    prod:',
        '      environment: prod',
        '      solution: core',
        'solutions:',
        '  core:',
        '    uniqueName: CoreManaged',
      ].join('\n'),
      'utf8'
    );

    const discovery = await discoverProject(root);
    const doctor = await doctorProject(root);

    expect(discovery.success).toBe(true);
    expect(discovery.data?.discovery).toEqual({
      inspectedPath: root,
      resolvedRoot: fixtureProjectRoot,
      configFound: true,
      usedDefaultLayout: false,
      descendantProjectConfigs: [],
      descendantProjectRoots: [],
      autoSelectedProjectRoot: 'fixtures/analysis/project',
      autoSelectedReason: 'only-descendant-project',
      canonicalAnchorReason:
        'Treat fixtures/analysis/project as the canonical local project for this invocation because it is the only descendant pp project under the inspected path. It defines its own config, 1 stage(s).',
      anchorEvidence: {
        configPath: 'fixtures/analysis/project/pp.config.yaml',
        assetKeys: [],
        stageNames: ['prod'],
        providerBindingNames: [],
        docsPaths: [],
      },
    });
    expect(discovery.data?.root).toBe(fixtureProjectRoot);
    expect(discovery.data?.configPath).toBe(join(fixtureProjectRoot, 'pp.config.yaml'));

    expect(doctor.success).toBe(true);
    expect(doctor.data?.discovery?.autoSelectedProjectRoot).toBe('fixtures/analysis/project');
    expect(doctor.data?.checks.some((check) => check.code === 'PROJECT_DOCTOR_AUTO_SELECTED_PROJECT_ROOT')).toBe(true);
    expect(doctor.data?.checks.find((check) => check.code === 'PROJECT_DOCTOR_AUTO_SELECTED_PROJECT_ROOT')?.detail).toContain(
      'Treat fixtures/analysis/project as the canonical local project for this invocation'
    );
  });

  it('flags source-first projects that keep generated bundles inside solutions', async () => {
    const report = await doctorProject(join(process.cwd(), 'fixtures', 'analysis', 'project'), {
      environment: {
        PP_TENANT_DOMAIN: undefined,
        PP_SECRET_app_token: undefined,
        PP_SQL_ENDPOINT: undefined,
      },
    });

    expect(report.success).toBe(true);
    expect(report.data?.summary.layoutProfile).toBe('source-first-inline-bundle');
    expect(report.data?.layout.generatedBundlePaths).toContain('solutions/Core.zip');
    expect(report.data?.checks.some((check) => check.code === 'PROJECT_DOCTOR_LAYOUT_INLINE_BUNDLE')).toBe(true);
    expect(report.data?.contract).toMatchObject({
      solutionSourceRoot: 'solutions',
      canonicalBundlePath: 'artifacts/solutions/core.zip',
      activeTarget: {
        stage: 'prod',
        environmentAlias: 'prod',
        solutionAlias: 'core',
        solutionUniqueName: 'CoreManaged',
      },
      stageMappings: [
        {
          stage: 'dev',
          environmentAlias: 'dev',
          solutionAlias: 'core',
          solutionUniqueName: 'CoreDev',
        },
        {
          stage: 'prod',
          environmentAlias: 'prod',
          solutionAlias: 'core',
          solutionUniqueName: 'CoreManaged',
        },
      ],
    });
    expect(report.suggestedNextActions).toEqual(
      expect.arrayContaining([expect.stringContaining('artifacts/solutions/core.zip')])
    );
  });

});
