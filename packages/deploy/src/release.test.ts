import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureDataverseClient, mockDataverseResolution } from '../../../test/dataverse-fixture';
import { executeReleaseManifest, type ReleaseManifest } from './index';

describe('release orchestration', () => {
  it('executes staged release manifests with approvals, validation, and rollback planning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-release-'));

    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'defaults:',
        '  stage: test',
        'topology:',
        '  defaultStage: test',
        '  stages:',
        '    test:',
        '      environment: test',
        '      solution: core',
        '    prod:',
        '      environment: prod',
        '      solution: core',
        'solutions:',
        '  core:',
        '    uniqueName: CoreManaged',
        'parameters:',
        '  tenantDomain:',
        '    type: string',
        '    value: contoso.example',
        '    mapsTo:',
        '      - kind: dataverse-envvar',
        '        target: pp_TenantDomain',
      ].join('\n'),
      'utf8'
    );

    const fixtureClient = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-1',
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
            _solutionid_value: 'solution-1',
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

    mockDataverseResolution({
      test: fixtureClient,
      prod: fixtureClient,
    });

    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      kind: 'pp.release',
      name: 'enterprise-rollout',
      projectRoot: root,
      stages: [
        {
          id: 'test',
          stage: 'test',
          validations: [
            { kind: 'preflight-ok' },
            { kind: 'apply-summary', minChanged: 1, maxFailed: 0 },
            {
              kind: 'operation-status',
              operationKind: 'dataverse-envvar-set',
              allowedStatuses: ['skipped'],
              message: 'Force rollback planning after a changed preview.',
            },
          ],
          rollback: {
            onFailure: true,
          },
        },
        {
          id: 'prod',
          stage: 'prod',
          approvals: [
            {
              id: 'prod-approval',
            },
          ],
        },
      ],
    };

    const result = await executeReleaseManifest(manifest, {
      mode: 'plan',
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.summary).toEqual({
      totalStages: 2,
      completed: 0,
      failed: 1,
      blocked: 0,
      rolledBack: 0,
      rollbackFailed: 0,
      skipped: 1,
    });
    expect(result.data?.stages[0]?.status).toBe('failed');
    expect(result.data?.stages[0]?.rollback.status).toBe('planned');
    expect(result.data?.stages[0]?.rollback.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-envvar-set',
        support: 'supported',
        rollbackValuePreview: 'old.example',
      })
    );
    expect(result.data?.stages[0]?.rollback.plan?.operations).toEqual([
      expect.objectContaining({
        kind: 'dataverse-envvar-set',
        valuePreview: 'old.example',
      }),
    ]);
    expect(result.data?.stages[1]?.status).toBe('skipped');
    expect(result.data?.audit.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(['release-started', 'stage-validation-failed', 'stage-rollback-planned', 'release-completed'])
    );
  });
});
