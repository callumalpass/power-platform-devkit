import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildDeployPlan, executeDeploy, executeDeployPlan, resolveDeployBindings, type DeployPlan } from './index';
import { discoverProject } from '@pp/project';
import { createFixtureDataverseClient, mockDataverseResolution } from '../../../test/dataverse-fixture';
import { expectGoldenJson, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';

function normalizeDeploySnapshot<T>(value: T): T {
  return mapSnapshotStrings(value, (entry) =>
    entry
      .replaceAll(repoRoot, '<REPO_ROOT>')
      .replaceAll('\\', '/')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<GENERATED_AT>')
  );
}

describe('deploy fixture-backed goldens', () => {
  it('captures deploy plans from the committed analysis fixture project', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const plan = buildDeployPlan(discovery.data!);

    expect(plan.success).toBe(true);
    expect(plan.data?.operations.map((operation) => operation.kind)).toEqual(['dataverse-envvar-set', 'deploy-secret-bind']);
    expect(plan.data?.bindings).toEqual({
      inputs: [
        {
          kind: 'deploy-input',
          parameter: 'sqlEndpoint',
          reference: undefined,
          source: 'missing',
          sensitive: false,
          status: 'missing',
          target: 'sql-endpoint',
          valuePreview: undefined,
        },
      ],
      secrets: [
        {
          kind: 'deploy-secret',
          parameter: 'apiToken',
          reference: 'app_token',
          source: 'secret',
          sensitive: true,
          status: 'resolved',
          target: 'api-token',
          valuePreview: '<redacted>',
        },
      ],
    });

    await expectGoldenJson(plan.data, 'fixtures/analysis/golden/deploy-plan.json', {
      normalize: normalizeDeploySnapshot,
    });
  });

  it('resolves adapter bindings with values for library consumers while preserving redaction in summaries', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const bindings = resolveDeployBindings(discovery.data!);

    expect(bindings.inputs).toEqual([
      {
        kind: 'deploy-input',
        parameter: 'sqlEndpoint',
        source: 'missing',
        sensitive: false,
        status: 'missing',
        target: 'sql-endpoint',
        reference: undefined,
        value: undefined,
        valuePreview: undefined,
      },
    ]);
    expect(bindings.secrets).toEqual([
      {
        kind: 'deploy-secret',
        parameter: 'apiToken',
        source: 'secret',
        sensitive: true,
        status: 'resolved',
        target: 'api-token',
        reference: 'app_token',
        value: 'super-secret',
        valuePreview: '<redacted>',
      },
    ]);
  });

  it('marks conflicting deploy binding targets and blocks the shared preflight', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-deploy-conflict-'));
    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'defaults:',
        '  stage: prod',
        'topology:',
        '  defaultStage: prod',
        '  stages:',
        '    prod:',
        '      environment: prod',
        '      solution: core',
        'solutions:',
        '  core:',
        '    uniqueName: CoreManaged',
        'parameters:',
        '  sqlEndpoint:',
        '    type: string',
        '    fromEnv: PP_SQL_ENDPOINT',
        '    required: true',
        '    mapsTo:',
        '      - kind: deploy-input',
        '        target: shared-output',
        '  sqlEndpointFallback:',
        '    type: string',
        '    value: fallback.contoso.example',
        '    mapsTo:',
        '      - kind: deploy-input',
        '        target: shared-output',
      ].join('\n'),
      'utf8'
    );

    const discovery = await discoverProject(root, {
      environment: {
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const bindings = resolveDeployBindings(discovery.data!);
    expect(bindings.inputs).toEqual([
      expect.objectContaining({
        parameter: 'sqlEndpoint',
        status: 'conflict',
        target: 'shared-output',
        value: 'sql.contoso.example',
      }),
      expect.objectContaining({
        parameter: 'sqlEndpointFallback',
        status: 'conflict',
        target: 'shared-output',
        value: 'fallback.contoso.example',
      }),
    ]);

    const result = await executeDeploy(discovery.data!, {
      mode: 'plan',
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_BINDING_TARGET_CONFLICT',
        target: 'shared-output',
      })
    );
    expect(result.data?.apply.operations).toEqual([
      expect.objectContaining({
        kind: 'deploy-input-bind',
        parameter: 'sqlEndpoint',
        status: 'skipped',
        message: 'Blocked by conflicting deploy target mappings.',
      }),
      expect.objectContaining({
        kind: 'deploy-input-bind',
        parameter: 'sqlEndpointFallback',
        status: 'skipped',
        message: 'Blocked by conflicting deploy target mappings.',
      }),
    ]);
  });

  it('fails preflight when a saved deploy plan no longer matches current project resolution', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const expectedPlan = buildDeployPlan(discovery.data!).data!;
    const mismatchedPlan = {
      ...expectedPlan,
      operations: expectedPlan.operations.map((operation) =>
        operation.kind === 'dataverse-envvar-set' ? { ...operation, target: 'pp_UnexpectedTarget' } : operation
      ),
    };

    const result = await executeDeploy(discovery.data!, {
      mode: 'plan',
      expectedPlan: mismatchedPlan,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_PLAN_MISMATCH',
        details: {
          mismatchedSections: ['operations'],
        },
      })
    );
  });

  it('executes a saved deploy plan directly without rediscovering the source project', async () => {
    const savedPlan: DeployPlan = {
      projectRoot: '/tmp/detached-plan',
      generatedAt: '2026-03-10T00:00:00.000Z',
      executionStages: ['resolve', 'preflight', 'plan', 'apply', 'report'],
      supportedAdapters: ['github-actions', 'azure-devops', 'power-platform-pipelines'],
      target: {
        stage: 'prod',
        environmentAlias: 'prod',
        solutionUniqueName: 'CoreManaged',
      },
      inputs: [
        {
          name: 'tenantDomain',
          value: 'contoso.example',
          source: 'value',
          hasValue: true,
          sensitive: false,
          mappings: [
            {
              kind: 'dataverse-envvar',
              target: 'pp_TenantDomain',
            },
          ],
        },
      ],
      providerBindings: [],
      topology: [],
      templateRegistries: [],
      build: {},
      assets: [],
      bindings: {
        inputs: [],
        secrets: [],
      },
      operations: [
        {
          kind: 'dataverse-envvar-set',
          parameter: 'tenantDomain',
          source: 'value',
          sensitive: false,
          target: 'pp_TenantDomain',
          valuePreview: 'contoso.example',
        },
      ],
    };

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [{ objectid: 'envvar-def-1' }],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });
    const updateSpy = vi.spyOn(client, 'update');

    const result = await executeDeployPlan(savedPlan, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(true);
    expect(result.data?.apply.summary.applied).toBe(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(result.data?.apply.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-envvar-set',
        status: 'applied',
        currentValue: 'old.example',
        nextValue: 'contoso.example',
      })
    );
  });

  it('blocks detached saved-plan execution when only redacted values are available', async () => {
    const savedPlan: DeployPlan = {
      projectRoot: '/tmp/detached-plan',
      generatedAt: '2026-03-10T00:00:00.000Z',
      executionStages: ['resolve', 'preflight', 'plan', 'apply', 'report'],
      supportedAdapters: ['github-actions', 'azure-devops', 'power-platform-pipelines'],
      target: {
        stage: 'prod',
      },
      inputs: [
        {
          name: 'apiToken',
          source: 'secret',
          hasValue: true,
          sensitive: true,
          reference: 'app_token',
          mappings: [
            {
              kind: 'deploy-secret',
              target: 'api-token',
            },
          ],
        },
      ],
      providerBindings: [],
      topology: [],
      templateRegistries: [],
      build: {},
      assets: [],
      bindings: {
        inputs: [],
        secrets: [
          {
            kind: 'deploy-secret',
            parameter: 'apiToken',
            source: 'secret',
            sensitive: true,
            target: 'api-token',
            status: 'resolved',
            reference: 'app_token',
            valuePreview: '<redacted>',
          },
        ],
      },
      operations: [
        {
          kind: 'deploy-secret-bind',
          parameter: 'apiToken',
          source: 'secret',
          sensitive: true,
          target: 'api-token',
          valuePreview: '<redacted>',
        },
      ],
    };

    const result = await executeDeployPlan(savedPlan, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_PLAN_OPERATION_VALUE_REDACTED',
        target: 'api-token',
      })
    );
    expect(result.data?.apply.operations).toContainEqual(
      expect.objectContaining({
        kind: 'deploy-secret-bind',
        status: 'skipped',
        message: 'Saved deploy plan redacted the resolved value for api-token; rediscover the project to execute it.',
      })
    );
  });

  it('executes detached saved-plan operations when explicit parameter overrides replace redacted values', async () => {
    const savedPlan: DeployPlan = {
      projectRoot: '/tmp/detached-plan',
      generatedAt: '2026-03-10T00:00:00.000Z',
      executionStages: ['resolve', 'preflight', 'plan', 'apply', 'report'],
      supportedAdapters: ['github-actions', 'azure-devops', 'power-platform-pipelines'],
      target: {
        stage: 'prod',
        environmentAlias: 'prod',
        solutionUniqueName: 'CoreManaged',
      },
      inputs: [
        {
          name: 'tenantDomain',
          source: 'secret',
          hasValue: true,
          sensitive: true,
          reference: 'tenant_domain',
          mappings: [
            {
              kind: 'dataverse-envvar',
              target: 'pp_TenantDomain',
            },
          ],
        },
      ],
      providerBindings: [],
      topology: [],
      templateRegistries: [],
      build: {},
      assets: [],
      bindings: {
        inputs: [],
        secrets: [],
      },
      operations: [
        {
          kind: 'dataverse-envvar-set',
          parameter: 'tenantDomain',
          source: 'secret',
          sensitive: true,
          target: 'pp_TenantDomain',
          valuePreview: '<redacted>',
        },
      ],
    };

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [{ objectid: 'envvar-def-1' }],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });
    const updateSpy = vi.spyOn(client, 'update');

    const result = await executeDeployPlan(savedPlan, {
      mode: 'apply',
      confirmed: true,
      parameterOverrides: {
        tenantDomain: 'contoso.example',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(true);
    expect(result.data?.plan.inputs).toEqual([
      expect.objectContaining({
        name: 'tenantDomain',
        source: 'value',
        hasValue: true,
        value: '<redacted>',
      }),
    ]);
    expect(result.data?.plan.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-envvar-set',
        source: 'value',
        valuePreview: '<redacted>',
      })
    );
    expect(result.data?.preflight.checks.some((check) => check.code === 'DEPLOY_PREFLIGHT_PLAN_OPERATION_VALUE_REDACTED')).toBe(false);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(result.data?.apply.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-envvar-set',
        status: 'applied',
        nextValue: 'contoso.example',
      })
    );
  });

  it('executes the supported deploy slice as a machine-readable dry run', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: undefined,
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    mockDataverseResolution({
      prod: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-prod-1',
              uniquename: 'CoreManaged',
              friendlyname: 'Core Managed',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [{ objectid: 'envvar-def-1' }],
          dependencies: [],
          connectionreferences: [],
          environmentvariabledefinitions: [
            {
              environmentvariabledefinitionid: 'envvar-def-1',
              schemaname: 'pp_TenantDomain',
              displayname: 'Tenant Domain',
              defaultvalue: '',
              type: 'string',
              _solutionid_value: 'solution-prod-1',
            },
          ],
          environmentvariablevalues: [
            {
              environmentvariablevalueid: 'envvar-value-1',
              value: 'old.example',
              _environmentvariabledefinitionid_value: 'envvar-def-1',
              statecode: 0,
            },
          ],
        },
      }),
    });

    const result = await executeDeploy(discovery.data!, {
      mode: 'dry-run',
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.bindings).toEqual({
      inputs: [
        {
          kind: 'deploy-input',
          parameter: 'sqlEndpoint',
          reference: undefined,
          source: 'missing',
          sensitive: false,
          status: 'missing',
          target: 'sql-endpoint',
          valuePreview: undefined,
        },
      ],
      secrets: [
        {
          kind: 'deploy-secret',
          parameter: 'apiToken',
          reference: 'app_token',
          source: 'secret',
          sensitive: true,
          status: 'resolved',
          target: 'api-token',
          valuePreview: '<redacted>',
        },
      ],
    });
    expect(result.data?.preflight.checks.some((check) => check.code === 'DEPLOY_PREFLIGHT_INPUT_SOURCE_MISSING')).toBe(true);
    expect(result.data?.apply.operations.some((operation) => operation.kind === 'deploy-secret-bind' && operation.status === 'resolved')).toBe(true);
    expect(result.data?.apply.operations.some((operation) => operation.kind === 'deploy-input-bind' && operation.status === 'planned')).toBe(false);
    expect(result.data?.apply.summary.resolved).toBe(1);

    await expectGoldenJson(result.data, 'fixtures/analysis/golden/deploy-apply-dry-run.json', {
      normalize: normalizeDeploySnapshot,
    });
  });

  it('blocks live apply when confirmation is not provided', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    mockDataverseResolution({
      prod: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-prod-1',
              uniquename: 'CoreManaged',
              friendlyname: 'Core Managed',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [{ objectid: 'envvar-def-1' }],
          dependencies: [],
          connectionreferences: [],
          environmentvariabledefinitions: [
            {
              environmentvariabledefinitionid: 'envvar-def-1',
              schemaname: 'pp_TenantDomain',
              displayname: 'Tenant Domain',
              defaultvalue: '',
              type: 'string',
              _solutionid_value: 'solution-prod-1',
            },
          ],
          environmentvariablevalues: [
            {
              environmentvariablevalueid: 'envvar-value-1',
              value: 'old.example',
              _environmentvariabledefinitionid_value: 'envvar-def-1',
              statecode: 0,
            },
          ],
        },
      }),
    });

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
    });

    expect(result.success).toBe(true);
    expect(result.data?.confirmation).toEqual({
      required: true,
      confirmed: false,
      status: 'blocked',
    });
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.preflight.checks.some((check) => check.code === 'DEPLOY_PREFLIGHT_APPLY_CONFIRMATION_REQUIRED')).toBe(true);
    expect(result.data?.apply.summary.applied).toBe(0);
  });

  it('executes live apply after confirmation is provided', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
        },
        queryAll: {
          solutioncomponents: [{ objectid: 'envvar-def-1' }],
          dependencies: [],
          connectionreferences: [],
          environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });
    const updateSpy = vi.spyOn(client, 'update');

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.confirmation).toEqual({
      required: true,
      confirmed: true,
      status: 'confirmed',
    });
    expect(result.data?.preflight.ok).toBe(true);
    expect(result.data?.preflight.checks.some((check) => check.code === 'DEPLOY_PREFLIGHT_INPUT_SOURCE_MISSING')).toBe(false);
    expect(result.data?.apply.summary.applied).toBe(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(result.data?.apply.operations.find((operation) => operation.kind === 'dataverse-envvar-set')).toMatchObject({
      status: 'applied',
      currentValue: 'old.example',
      nextValue: 'contoso.example',
      changed: true,
    });
  });

  it('skips live apply writes when the target environment variable is already up to date', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
        },
        queryAll: {
          solutioncomponents: [{ objectid: 'envvar-def-1' }],
          dependencies: [],
          connectionreferences: [],
          environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'contoso.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });
    const updateSpy = vi.spyOn(client, 'update');

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(true);
    expect(result.data?.apply.summary.applied).toBe(0);
    expect(result.data?.apply.summary.skipped).toBe(1);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.data?.apply.operations.find((operation) => operation.kind === 'dataverse-envvar-set')).toMatchObject({
      status: 'skipped',
      currentValue: 'contoso.example',
      nextValue: 'contoso.example',
      changed: false,
      message: 'pp_TenantDomain is already up to date.',
    });
  });

  it('applies dataverse connection reference mappings through the shared deploy path', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
        PP_SQL_CONNECTION_ID: 'conn-target-sql',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    discovery.data!.parameters.sqlConnection = {
      name: 'sqlConnection',
      type: 'string',
      source: 'environment',
      value: 'conn-target-sql',
      definition: {
        type: 'string',
        fromEnv: 'PP_SQL_CONNECTION_ID',
        required: true,
        mapsTo: [
          {
            kind: 'dataverse-connref',
            target: 'pp_shared_sql',
          },
        ],
      },
      sensitive: false,
      hasValue: true,
      reference: undefined,
      resolvedBy: undefined,
    };

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [{ objectid: 'envvar-def-1' }],
        dependencies: [],
        connectionreferences: [
          {
            connectionreferenceid: 'connref-1',
            connectionreferencelogicalname: 'pp_shared_sql',
            displayname: 'Shared SQL',
            connectorid: '/providers/Microsoft.PowerApps/apis/shared_sql',
            connectionid: 'conn-old-sql',
            _solutionid_value: 'solution-prod-1',
            statecode: 0,
          },
        ],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });
    const updateSpy = vi.spyOn(client, 'update');

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(true);
    expect(result.data?.apply.summary.applied).toBe(2);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(result.data?.plan.operations.map((operation) => operation.kind)).toContain('dataverse-connref-set');
    expect(result.data?.apply.operations.find((operation) => operation.kind === 'dataverse-connref-set')).toMatchObject({
      status: 'applied',
      currentValue: 'conn-old-sql',
      nextValue: 'conn-target-sql',
      changed: true,
    });
  });

  it('creates missing dataverse connection references through the shared deploy path when configured', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
        PP_SQL_CONNECTION_ID: 'conn-target-sql',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    discovery.data!.parameters.sqlConnection = {
      name: 'sqlConnection',
      type: 'string',
      source: 'environment',
      value: 'conn-target-sql',
      definition: {
        type: 'string',
        fromEnv: 'PP_SQL_CONNECTION_ID',
        required: true,
        mapsTo: [
          {
            kind: 'dataverse-connref-create',
            target: 'pp_shared_sql',
            displayName: 'Shared SQL',
            connectorId: '/providers/Microsoft.PowerApps/apis/shared_sql',
          },
        ],
      },
      sensitive: false,
      hasValue: true,
      reference: undefined,
      resolvedBy: undefined,
    };

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [{ objectid: 'envvar-def-1' }],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });
    const createSpy = vi.spyOn(client, 'create');

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(true);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_CONNREF_TARGET_CREATE',
        status: 'pass',
        target: 'pp_shared_sql',
      })
    );
    expect(result.data?.plan.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-connref-upsert',
        target: 'pp_shared_sql',
        createOptions: {
          displayName: 'Shared SQL',
          connectorId: '/providers/Microsoft.PowerApps/apis/shared_sql',
        },
      })
    );
    expect(result.data?.apply.operations.find((operation) => operation.kind === 'dataverse-connref-upsert')).toMatchObject({
      status: 'applied',
      targetExists: false,
      currentValue: undefined,
      nextValue: 'conn-target-sql',
      changed: true,
      message: 'Created and updated pp_shared_sql.',
      createOptions: {
        displayName: 'Shared SQL',
        connectorId: '/providers/Microsoft.PowerApps/apis/shared_sql',
      },
    });
    expect(createSpy).toHaveBeenCalledWith(
      'connectionreferences',
      {
        connectionreferencelogicalname: 'pp_shared_sql',
        connectionreferencedisplayname: 'Shared SQL',
        connectorid: '/providers/Microsoft.PowerApps/apis/shared_sql',
        connectionid: 'conn-target-sql',
      },
      expect.objectContaining({
        solutionUniqueName: 'CoreManaged',
      })
    );
  });

  it('fails preflight when dataverse connection reference create mappings omit connector metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-deploy-connref-create-'));
    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'defaults:',
        '  stage: prod',
        'topology:',
        '  defaultStage: prod',
        '  stages:',
        '    prod:',
        '      environment: prod',
        '      solution: core',
        'solutions:',
        '  core:',
        '    uniqueName: CoreManaged',
        'parameters:',
        '  sqlConnection:',
        '    type: string',
        '    value: conn-target-sql',
        '    mapsTo:',
        '      - kind: dataverse-connref-create',
        '        target: pp_shared_sql',
      ].join('\n'),
      'utf8'
    );

    const discovery = await discoverProject(root);

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [],
        environmentvariablevalues: [],
      },
    });

    mockDataverseResolution({ prod: client });

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_CONNREF_CREATE_CONNECTOR_MISSING',
        target: 'pp_shared_sql',
      })
    );
    expect(result.data?.apply.operations.find((operation) => operation.kind === 'dataverse-connref-upsert')).toMatchObject({
      status: 'skipped',
      targetExists: false,
      changed: false,
      message: 'Configured connection reference create mapping is missing connector metadata.',
    });
  });

  it('creates missing dataverse environment variables through the shared deploy path when configured', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
        PP_FEATURE_FLAG: 'true',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    discovery.data!.parameters.featureFlag = {
      name: 'featureFlag',
      type: 'boolean',
      source: 'environment',
      value: true,
      definition: {
        type: 'boolean',
        fromEnv: 'PP_FEATURE_FLAG',
        required: true,
        mapsTo: [
          {
            kind: 'dataverse-envvar-create',
            target: 'pp_FeatureFlag',
            displayName: 'Feature Flag',
            defaultValue: false,
            type: 'secret',
            valueSchema: '{"type":"boolean"}',
            secretStore: 0,
          },
        ],
      },
      sensitive: false,
      hasValue: true,
      reference: undefined,
      resolvedBy: undefined,
    };

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [{ objectid: 'envvar-def-1' }],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });
    const createSpy = vi.spyOn(client, 'create');

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(true);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_ENVVAR_TARGET_CREATE',
        status: 'pass',
        target: 'pp_FeatureFlag',
      })
    );
    expect(result.data?.plan.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-envvar-upsert',
        target: 'pp_FeatureFlag',
        createOptions: {
          displayName: 'Feature Flag',
          defaultValue: 'false',
          type: 'secret',
          valueSchema: '{"type":"boolean"}',
          secretStore: 0,
        },
      })
    );
    expect(result.data?.apply.operations.find((operation) => operation.kind === 'dataverse-envvar-upsert')).toMatchObject({
      status: 'applied',
      targetExists: false,
      currentValue: undefined,
      nextValue: 'true',
      changed: true,
      message: 'Created and updated pp_FeatureFlag.',
      createOptions: {
        displayName: 'Feature Flag',
        defaultValue: 'false',
        type: 'secret',
        valueSchema: '{"type":"boolean"}',
        secretStore: 0,
      },
    });
    expect(createSpy).toHaveBeenCalledWith(
      'environmentvariabledefinitions',
      {
        schemaname: 'pp_FeatureFlag',
        displayname: 'Feature Flag',
        defaultvalue: 'false',
        type: 100000005,
        valueschema: '{"type":"boolean"}',
        secretstore: 0,
      },
      expect.objectContaining({
        solutionUniqueName: 'CoreManaged',
      })
    );
    expect(createSpy).toHaveBeenCalledWith(
      'environmentvariablevalues',
      expect.objectContaining({
        value: 'true',
      })
    );
  });

  it('fails preflight when dataverse envvar create mappings configure an unsupported type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-deploy-envvar-type-'));
    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'defaults:',
        '  stage: prod',
        'topology:',
        '  defaultStage: prod',
        '  stages:',
        '    prod:',
        '      environment: prod',
        '      solution: core',
        'solutions:',
        '  core:',
        '    uniqueName: CoreManaged',
        'parameters:',
        '  featureFlag:',
        '    type: string',
        '    value: enabled',
        '    mapsTo:',
        '      - kind: dataverse-envvar-create',
        '        target: pp_FeatureFlag',
        '        displayName: Feature Flag',
        '        type: unsupported-type',
      ].join('\n'),
      'utf8'
    );

    const discovery = await discoverProject(root);

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [],
        environmentvariablevalues: [],
      },
    });

    mockDataverseResolution({ prod: client });
    const createSpy = vi.spyOn(client, 'create');

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_ENVVAR_CREATE_TYPE_INVALID',
        status: 'fail',
        target: 'pp_FeatureFlag',
        details: {
          parameter: 'featureFlag',
          configuredType: 'unsupported-type',
        },
      })
    );
    expect(result.data?.apply.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-envvar-upsert',
        target: 'pp_FeatureFlag',
        status: 'skipped',
        message: 'Configured environment variable create type is not supported.',
        createOptions: {
          displayName: 'Feature Flag',
          type: 'unsupported-type',
        },
      })
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('blocks conflicting dataverse envvar targets before remote preflight or apply', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const discovery = await discoverProject(fixtureRoot, {
      environment: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    discovery.data!.parameters.tenantDomainOverride = {
      name: 'tenantDomainOverride',
      type: 'string',
      source: 'value',
      value: 'override.example',
      definition: {
        type: 'string',
        value: 'override.example',
        required: true,
        mapsTo: [
          {
            kind: 'dataverse-envvar',
            target: 'pp_TenantDomain',
          },
        ],
      },
      sensitive: false,
      hasValue: true,
      reference: undefined,
      resolvedBy: undefined,
    };

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });
    const updateSpy = vi.spyOn(client, 'update');
    const querySpy = vi.spyOn(client, 'query');
    const queryAllSpy = vi.spyOn(client, 'queryAll');

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_ENVVAR_TARGET_CONFLICT',
        target: 'pp_TenantDomain',
      })
    );
    expect(result.data?.apply.operations.filter((operation) => operation.kind === 'dataverse-envvar-set')).toEqual([
      expect.objectContaining({
        parameter: 'tenantDomain',
        status: 'skipped',
        message: 'Blocked by conflicting deploy target mappings.',
      }),
      expect.objectContaining({
        parameter: 'tenantDomainOverride',
        status: 'skipped',
        message: 'Blocked by conflicting deploy target mappings.',
      }),
    ]);
    expect(querySpy).not.toHaveBeenCalled();
    expect(queryAllSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
