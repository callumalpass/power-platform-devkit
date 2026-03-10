import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverProject } from '@pp/project';
import { executeDeploy } from './index';

vi.mock('@pp/auth', async () => {
  const diagnostics = await import('@pp/diagnostics');

  return {
    AuthService: class {
      async getProfile(name: string) {
        return diagnostics.ok({
          name,
          type: 'static-token' as const,
          token: `${name}-token`,
        });
      }
    },
    createTokenProvider: () =>
      diagnostics.ok({
        async getAccessToken() {
          return 'fixture-token';
        },
      }),
  };
});

describe('deploy adjacent provider workflows', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('plans and applies SharePoint file updates and Power BI dataset refreshes through shared deploy orchestration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-deploy-providers-'));
    const graphRequests: string[] = [];
    const powerBiRequests: string[] = [];

    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'providerBindings:',
        '  financeSite:',
        '    kind: sharepoint-site',
        '    target: site-1',
        '    metadata:',
        '      authProfile: graph-user',
        '  releaseNotesFile:',
        '    kind: sharepoint-file',
        '    target: /Shared Documents/release.txt',
        '    metadata:',
        '      site: financeSite',
        '      drive: 11111111-1111-4111-8111-111111111111',
        '  financeWorkspace:',
        '    kind: powerbi-workspace',
        '    target: 22222222-2222-4222-8222-222222222222',
        '    metadata:',
        '      authProfile: powerbi-user',
        '  financeDataset:',
        '    kind: powerbi-dataset',
        '    target: 33333333-3333-4333-8333-333333333333',
        '    metadata:',
        '      workspace: financeWorkspace',
        'parameters:',
        '  releaseNotes:',
        '    value: release-2026.03.11',
        '    mapsTo:',
        '      - kind: sharepoint-file-text',
        '        target: releaseNotesFile',
        '  refreshSemanticModel:',
        '    value: true',
        '    mapsTo:',
        '      - kind: powerbi-dataset-refresh',
        '        target: financeDataset',
        '        notifyOption: MailOnFailure',
        '        refreshType: full',
      ].join('\n'),
      'utf8'
    );

    global.fetch = vi.fn(async (input, init) => {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      if (url.origin === 'https://graph.microsoft.com') {
        graphRequests.push(`${init?.method ?? 'GET'} ${url.pathname}`);

        if (init?.method === 'PUT' && url.pathname.endsWith('/content')) {
          return new Response(
            JSON.stringify({
              id: 'item-1',
              name: 'release.txt',
              webUrl: 'https://example.sharepoint.com/sites/finance/Shared%20Documents/release.txt',
              parentReference: {
                driveId: '11111111-1111-4111-8111-111111111111',
                path: '/drives/11111111-1111-4111-8111-111111111111/root:/Shared Documents',
              },
              file: {
                mimeType: 'text/plain',
                hashes: {
                  quickXorHash: '123',
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            id: 'item-1',
            name: 'release.txt',
            webUrl: 'https://example.sharepoint.com/sites/finance/Shared%20Documents/release.txt',
            parentReference: {
              driveId: '11111111-1111-4111-8111-111111111111',
              path: '/drives/11111111-1111-4111-8111-111111111111/root:/Shared Documents',
            },
            file: {
              mimeType: 'text/plain',
              hashes: {
                quickXorHash: '123',
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.origin === 'https://api.powerbi.com') {
        powerBiRequests.push(`${init?.method ?? 'GET'} ${url.pathname}`);

        if (url.pathname.endsWith('/refreshes')) {
          return new Response(null, { status: 202 });
        }

        if (url.pathname.endsWith('/datasources')) {
          return new Response(JSON.stringify({ value: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.pathname.endsWith('/refreshSchedule')) {
          return new Response(
            JSON.stringify({
              enabled: true,
              timezone: 'UTC',
              times: ['06:00'],
              days: ['Monday'],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        if (url.pathname.endsWith('/reports')) {
          return new Response(JSON.stringify({ value: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.pathname === '/v1.0/myorg/groups/22222222-2222-4222-8222-222222222222') {
          return new Response(
            JSON.stringify({
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Finance Workspace',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        if (url.pathname.endsWith('/datasets')) {
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: '33333333-3333-4333-8333-333333333333',
                  name: 'Finance Model',
                  isRefreshable: true,
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Finance Model',
            isRefreshable: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response('unexpected request', { status: 500 });
    }) as typeof fetch;

    const discovery = await discoverProject(root);
    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const result = await executeDeploy(discovery.data!, {
      mode: 'apply',
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.preflight.ok).toBe(true);
    expect(result.data?.plan.operations.map((operation) => operation.kind)).toEqual([
      'sharepoint-file-text-set',
      'powerbi-dataset-refresh',
    ]);
    expect(result.data?.apply.operations).toEqual([
      expect.objectContaining({
        kind: 'sharepoint-file-text-set',
        status: 'applied',
      }),
      expect.objectContaining({
        kind: 'powerbi-dataset-refresh',
        status: 'applied',
      }),
    ]);
    expect(result.data?.apply.summary).toEqual({
      attempted: 2,
      applied: 2,
      created: 0,
      failed: 0,
      skipped: 0,
      changed: 2,
      resolved: 0,
    });
    expect(graphRequests).toContain(
      'PUT /v1.0/drives/11111111-1111-4111-8111-111111111111/root:/Shared%20Documents/release.txt:/content'
    );
    expect(powerBiRequests).toContain(
      'POST /v1.0/myorg/groups/22222222-2222-4222-8222-222222222222/datasets/33333333-3333-4333-8333-333333333333/refreshes'
    );
  });

  it('fails preflight when a provider deploy mapping cannot resolve an auth profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pp-deploy-provider-auth-'));

    await writeFile(
      join(root, 'pp.config.yaml'),
      [
        'providerBindings:',
        '  financeSite:',
        '    kind: sharepoint-site',
        '    target: site-1',
        '  releaseNotesFile:',
        '    kind: sharepoint-file',
        '    target: /Shared Documents/release.txt',
        '    metadata:',
        '      site: financeSite',
        '      drive: 11111111-1111-4111-8111-111111111111',
        'parameters:',
        '  releaseNotes:',
        '    value: release-2026.03.11',
        '    mapsTo:',
        '      - kind: sharepoint-file-text',
        '        target: releaseNotesFile',
      ].join('\n'),
      'utf8'
    );

    global.fetch = vi.fn(async () => new Response('unexpected request', { status: 500 })) as typeof fetch;

    const discovery = await discoverProject(root);
    expect(discovery.success).toBe(true);
    expect(discovery.data).toBeDefined();

    const result = await executeDeploy(discovery.data!, {
      mode: 'plan',
    });

    expect(result.success).toBe(true);
    expect(result.data?.plan.operations).toEqual([]);
    expect(result.data?.preflight.ok).toBe(false);
    expect(result.data?.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_SHAREPOINT_AUTH_PROFILE_MISSING',
        target: 'releaseNotesFile',
      })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
