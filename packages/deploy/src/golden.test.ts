import { describe, expect, it } from 'vitest';
import { buildDeployPlan, executeDeploy } from './index';
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

    await expectGoldenJson(plan.data, 'fixtures/analysis/golden/deploy-plan.json', {
      normalize: normalizeDeploySnapshot,
    });
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

    await expectGoldenJson(result.data, 'fixtures/analysis/golden/deploy-apply-dry-run.json', {
      normalize: normalizeDeploySnapshot,
    });
  });
});
