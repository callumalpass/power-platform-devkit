import { describe, expect, it, vi } from 'vitest';
import { buildDeployPlan, executeDeploy, resolveDeployBindings } from './index';
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
});
