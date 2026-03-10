import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishGitHubActionsDeployBindings, resolveGitHubActionsDeployOptions, runGitHubActionsDeploy } from './index';
import { createFixtureDataverseClient, mockDataverseResolution } from '../../../../test/dataverse-fixture';
import { resolveRepoPath } from '../../../../test/golden';

describe('resolveGitHubActionsDeployOptions', () => {
  it('hydrates adapter options from GitHub Actions inputs and workspace defaults', () => {
    const result = resolveGitHubActionsDeployOptions({
      environment: {
        GITHUB_WORKSPACE: '/workspace/repo',
        INPUT_STAGE: 'prod',
        INPUT_MODE: 'dry-run',
        INPUT_CONFIRM: 'true',
        INPUT_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example","retryCount":3,"enabled":true}',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      projectPath: '/workspace/repo',
      stage: 'prod',
      mode: 'dry-run',
      confirm: true,
      environment: {
        GITHUB_WORKSPACE: '/workspace/repo',
        INPUT_STAGE: 'prod',
        INPUT_MODE: 'dry-run',
        INPUT_CONFIRM: 'true',
        INPUT_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example","retryCount":3,"enabled":true}',
      },
      parameterOverrides: {
        tenantDomain: 'contoso.example',
        retryCount: 3,
        enabled: true,
      },
    });
  });

  it('lets explicit options override environment-derived values', () => {
    const result = resolveGitHubActionsDeployOptions({
      projectPath: '/tmp/project',
      stage: 'test',
      mode: 'plan',
      parameterOverrides: {
        tenantDomain: 'override.example',
      },
      environment: {
        GITHUB_WORKSPACE: '/workspace/repo',
        INPUT_STAGE: 'prod',
        INPUT_MODE: 'dry-run',
        INPUT_PARAMETER_OVERRIDES: '{"tenantDomain":"contoso.example"}',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.projectPath).toBe('/tmp/project');
    expect(result.data?.stage).toBe('test');
    expect(result.data?.mode).toBe('plan');
    expect(result.data?.parameterOverrides).toEqual({
      tenantDomain: 'override.example',
    });
  });

  it('fails on invalid GitHub Actions mode input', () => {
    const result = resolveGitHubActionsDeployOptions({
      environment: {
        INPUT_MODE: 'live',
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_MODE_INVALID');
  });

  it('fails on invalid GitHub Actions confirmation input', () => {
    const result = resolveGitHubActionsDeployOptions({
      environment: {
        INPUT_CONFIRM: 'deploy-now',
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_CONFIRM_INVALID');
  });

  it('publishes resolved bindings to GITHUB_OUTPUT when available', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pp-gha-deploy-'));
    const outputPath = join(tempDir, 'github-output.txt');
    await writeFile(outputPath, '', 'utf8');

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

    const result = await runGitHubActionsDeploy({
      projectPath: resolveRepoPath('fixtures', 'analysis', 'project'),
      mode: 'dry-run',
      environment: {
        GITHUB_OUTPUT: outputPath,
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(result.success).toBe(true);
    expect(await readFile(outputPath, 'utf8')).toContain('sql-endpoint<<PP_DEPLOY_SQL_ENDPOINT_0');
    expect(await readFile(outputPath, 'utf8')).toContain('sql.contoso.example');
    expect(await readFile(outputPath, 'utf8')).toContain('api-token<<PP_DEPLOY_API_TOKEN_1');
    expect(await readFile(outputPath, 'utf8')).toContain('super-secret');
  });

  it('returns a warning when GitHub binding publication fails', async () => {
    const result = await publishGitHubActionsDeployBindings(
      {
        inputs: [],
        secrets: [
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
        ],
      },
      {
        GITHUB_OUTPUT: join(tmpdir(), 'missing-dir', 'github-output.txt'),
      }
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DEPLOY_ADAPTER_GITHUB_OUTPUT_WRITE_FAILED');
  });

  it('preserves deploy success and records a warning when GitHub output publication fails in the adapter flow', async () => {
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

    const result = await runGitHubActionsDeploy({
      projectPath: resolveRepoPath('fixtures', 'analysis', 'project'),
      mode: 'dry-run',
      environment: {
        GITHUB_OUTPUT: join(tmpdir(), 'missing-dir', 'github-output.txt'),
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: 'sql.contoso.example',
      },
    });

    expect(result.success).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'DEPLOY_ADAPTER_GITHUB_OUTPUT_WRITE_FAILED')).toBe(true);
  });
});
