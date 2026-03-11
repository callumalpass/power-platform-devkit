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

  it('reports the derived secret environment variable when a required secret is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-project-secret-miss-'));
    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'parameters:',
        '  apiToken:',
        '    secretRef: app_token',
        '    required: true',
        'secrets:',
        '  defaultProvider: pipeline',
        '  providers:',
        '    pipeline:',
        '      kind: env',
        '      prefix: PP_SECRET_',
      ].join('\n'),
      'utf8'
    );

    const result = await discoverProject(root, {
      environment: {
        PP_SECRET_app_token: undefined,
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PROJECT_PARAMETER_SECRET_MISSING',
          hint: 'Resolve secret ref app_token (expected env var PP_SECRET_app_token) or provide an explicit value override.',
        }),
      ])
    );
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
    expect(plan.preview).toEqual({
      configFile: 'pp.config.yaml',
      editableAssetRoots: ['apps', 'flows', 'solutions', 'docs'],
      artifactRoots: ['artifacts/solutions'],
      recommendedBundlePath: 'artifacts/solutions/CoreLifecycle.zip',
      layoutLines: [
        './pp.config.yaml',
        './apps/',
        './flows/',
        './solutions/',
        './docs/',
        './artifacts/',
        './artifacts/solutions/',
        './artifacts/solutions/CoreLifecycle.zip  # recommended packaged solution output',
      ],
      entries: [
        {
          path: 'pp.config.yaml',
          kind: 'config',
          purpose: 'Project config anchor that defines defaults, assets, bindings, and topology.',
        },
        {
          path: 'apps',
          kind: 'editable-root',
          purpose: 'Editable source asset root tracked directly in the repo.',
        },
        {
          path: 'flows',
          kind: 'editable-root',
          purpose: 'Editable source asset root tracked directly in the repo.',
        },
        {
          path: 'solutions',
          kind: 'editable-root',
          purpose: 'Editable solution source root for unpacked solution content.',
        },
        {
          path: 'docs',
          kind: 'editable-root',
          purpose: 'Editable source asset root tracked directly in the repo.',
        },
        {
          path: 'artifacts/solutions',
          kind: 'artifact-root',
          purpose: 'Artifact root for generated outputs that should stay separate from editable source.',
        },
        {
          path: 'artifacts/solutions/CoreLifecycle.zip',
          kind: 'recommended-bundle',
          purpose: 'Canonical packaged solution zip path for later pack/export output; `project init` creates the directory, not the zip.',
        },
      ],
      relationshipSummary: [
        'Editable solution source lives under `solutions/`.',
        'Packaged solution exports belong under `artifacts/solutions/CoreLifecycle.zip`, separate from source assets.',
        '`project init` creates `artifacts/solutions/` but leaves `artifacts/solutions/CoreLifecycle.zip` absent until a later pack/export step writes the bundle.',
        'Default stage `dev` maps environment `sandbox` to solution `CoreLifecycle`.',
      ],
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
    expect(result.data?.preview).toEqual(plan.preview);
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
    expect(doctor.data?.summary.canonicalBundlePath).toBe('artifacts/solutions/CoreLifecycle.zip');
    expect(doctor.data?.summary.canonicalBundlePresent).toBe(false);
    expect(doctor.data?.summary.bundlePlacementStatus).toBe('absent');
    expect(doctor.data?.summary.bundlePlacementSummary).toBe(
      'No generated bundle is currently present. When you create one, write it to artifacts/solutions/CoreLifecycle.zip and keep solutions for unpacked source.'
    );
    expect(doctor.data?.summary.activeTargetSummary).toBe(
      'Active target: stage dev -> environment sandbox -> solution CoreLifecycle (CoreLifecycle)'
    );
    expect(doctor.data?.summary.environmentAliasProvenance).toBe(
      'Stage dev in pp.config.yaml selects environment alias sandbox. The alias name lives in the project config, but the actual Dataverse URL and auth profile are resolved later from the external pp environment registry.'
    );
    expect(doctor.data?.summary.bundleLifecycleSummary).toBe(
      'The canonical bundle path is artifacts/solutions/CoreLifecycle.zip, but that zip is a generated artifact and may be absent until you pack local source from solutions or export the solution from Dataverse. Typical creation paths are pp solution pack <solution-folder> --out artifacts/solutions/CoreLifecycle.zip or pp solution export CoreLifecycle --environment sandbox --out artifacts/solutions/CoreLifecycle.zip.'
    );
    expect(doctor.data?.summary.deploymentRouteSteps).toEqual([
      'pp.config.yaml maps stage dev to environment alias sandbox and solution CoreLifecycle.',
      'The alias resolves later through the external pp environment registry and its auth context.',
      'The canonical bundle artifacts/solutions/CoreLifecycle.zip is not generated yet; create it with `pp solution pack <solution-folder> --out artifacts/solutions/CoreLifecycle.zip` or `pp solution export CoreLifecycle --environment sandbox --out artifacts/solutions/CoreLifecycle.zip`.',
    ]);
    expect(doctor.data?.layout.normalizedAssets.solutionBundle).toBe('artifacts/solutions/CoreLifecycle.zip');
    expect(doctor.data?.contract.canonicalBundlePath).toBe('artifacts/solutions/CoreLifecycle.zip');
    expect(doctor.data?.topology).toEqual({
      defaultStage: 'dev',
      selectedStage: 'dev',
      defaultTargetSummary: 'Default target: stage dev -> environment sandbox -> solution CoreLifecycle (CoreLifecycle)',
      activeTargetSummary: 'Active target: stage dev -> environment sandbox -> solution CoreLifecycle (CoreLifecycle)',
      stageMappings: [
        {
          stage: 'dev',
          isDefault: true,
          isSelected: true,
          environmentAlias: 'sandbox',
          solutionAlias: 'CoreLifecycle',
          solutionUniqueName: 'CoreLifecycle',
          solutionMappings: ['CoreLifecycle -> sandbox / CoreLifecycle'],
          parameterOverrides: [],
          summary: 'dev (default stage, selected stage) -> environment sandbox -> solution CoreLifecycle (CoreLifecycle)',
        },
      ],
      explanation: [
        'Default target: stage dev -> environment sandbox -> solution CoreLifecycle (CoreLifecycle)',
        'Active target: stage dev -> environment sandbox -> solution CoreLifecycle (CoreLifecycle)',
        'dev (default stage, selected stage) -> environment sandbox -> solution CoreLifecycle (CoreLifecycle)',
      ],
    });
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
    expect(doctor.data?.inspectedPath).toBe(root);
    expect(doctor.data?.canonicalProjectRoot).toBe(fixtureProjectRoot);
    expect(doctor.data?.discovery?.autoSelectedProjectRoot).toBe('fixtures/analysis/project');
    expect(doctor.data?.checks.some((check) => check.code === 'PROJECT_DOCTOR_AUTO_SELECTED_PROJECT_ROOT')).toBe(true);
    expect(doctor.data?.checks.find((check) => check.code === 'PROJECT_DOCTOR_AUTO_SELECTED_PROJECT_ROOT')?.hint).toBe(
      'This descendant root is already the canonical local project anchor for repo-root project commands.'
    );
    expect(doctor.data?.checks.find((check) => check.code === 'PROJECT_DOCTOR_AUTO_SELECTED_PROJECT_ROOT')?.detail).toContain(
      'Treat fixtures/analysis/project as the canonical local project for this invocation'
    );
    expect(doctor.data?.checks.some((check) => check.code === 'PROJECT_CONFIG_DESCENDANT_AUTO_SELECTED')).toBe(false);
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
    expect(report.data?.summary.canonicalBundlePresent).toBe(false);
    expect(report.data?.summary.bundlePlacementStatus).toBe('inline-noncanonical');
    expect(report.data?.summary.bundlePlacementSummary).toBe(
      'Non-canonical bundle placement: solutions/Core.zip is generated artifact output inside editable source space. Treat inline zip files as generated or stale output, not authoritative source; keep unpacked source under solutions and write packaged bundles to artifacts/solutions/core.zip.'
    );
    expect(report.data?.summary.environmentAliasProvenance).toBe(
      'Stage prod in pp.config.yaml selects environment alias prod. The alias name lives in the project config, but the actual Dataverse URL and auth profile are resolved later from the external pp environment registry.'
    );
    expect(report.data?.summary.bundleLifecycleSummary).toBe(
      'The canonical bundle path is artifacts/solutions/core.zip, but that zip is a generated artifact and may be absent until you pack local source from solutions or export the solution from Dataverse. Typical creation paths are pp solution pack <solution-folder> --out artifacts/solutions/core.zip or pp solution export CoreManaged --environment prod --out artifacts/solutions/core.zip.'
    );
    expect(report.data?.layout.generatedBundlePaths).toContain('solutions/Core.zip');
    expect(report.data?.checks.some((check) => check.code === 'PROJECT_DOCTOR_LAYOUT_INLINE_BUNDLE')).toBe(true);
    expect(report.data?.checks.find((check) => check.code === 'PROJECT_DOCTOR_LAYOUT_INLINE_BUNDLE')).toMatchObject({
      message: 'Non-canonical generated bundle detected in editable source space at solutions/Core.zip.',
      hint: 'Treat inline zip files as generated artifact output, not authoritative source. Rebuild or move packaged zips to `artifacts/solutions/core.zip` and reserve `solutions/` for unpacked solution source.',
    });
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
    expect(report.data?.topology).toEqual({
      defaultStage: 'prod',
      selectedStage: 'prod',
      defaultTargetSummary: 'Default target: stage prod -> environment prod -> solution core (CoreManaged)',
      activeTargetSummary: 'Active target: stage prod -> environment prod -> solution core (CoreManaged)',
      stageMappings: [
        {
          stage: 'dev',
          isDefault: false,
          isSelected: false,
          environmentAlias: 'dev',
          solutionAlias: 'core',
          solutionUniqueName: 'CoreDev',
          solutionMappings: ['core -> dev / CoreDev'],
          parameterOverrides: [],
          summary: 'dev -> environment dev -> solution core (CoreDev)',
        },
        {
          stage: 'prod',
          isDefault: true,
          isSelected: true,
          environmentAlias: 'prod',
          solutionAlias: 'core',
          solutionUniqueName: 'CoreManaged',
          solutionMappings: ['core -> prod / CoreManaged (stage override)'],
          parameterOverrides: ['releaseName'],
          summary: 'prod (default stage, selected stage) -> environment prod -> solution core (CoreManaged)',
        },
      ],
      explanation: [
        'Default target: stage prod -> environment prod -> solution core (CoreManaged)',
        'Active target: stage prod -> environment prod -> solution core (CoreManaged)',
        'dev -> environment dev -> solution core (CoreDev)',
        'prod (default stage, selected stage) -> environment prod -> solution core (CoreManaged); parameter overrides: releaseName.',
      ],
    });
    expect(report.data?.checks.some((check) => check.code === 'PROJECT_DOCTOR_ACTIVE_TARGET')).toBe(true);
    expect(report.data?.checks.filter((check) => check.code === 'PROJECT_DOCTOR_STAGE_MAPPING')).toHaveLength(2);
    expect(report.suggestedNextActions).toEqual(
      expect.arrayContaining([expect.stringContaining('artifacts/solutions/core.zip')])
    );
  });

});
