import { expect, openApp, test, visitTab } from './fixtures.js';

test('hash deep links land on the requested primary tab', async ({ page, audit }) => {
  await page.goto('/#console');
  await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Console' })).toHaveClass(/active/);
  await expect(page.locator('#panel-console')).toBeVisible();

  await page.goto('/#platform');
  await expect(page.getByRole('button', { name: 'Platform' })).toHaveClass(/active/);
  await expect(page.locator('#panel-platform')).toBeVisible();

  await audit.assertClean();
});

test('console sends structured request payloads and drops body fields for GET', async ({ page, audit }) => {
  const consoleRequests: any[] = [];
  await page.route('**/api/request/execute', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.path === '/playwright-probe') {
      consoleRequests.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          success: true,
          diagnostics: [],
          data: {
            status: 200,
            headers: { 'content-type': 'application/json' },
            response: { ok: true, method: body.method, query: body.query, headers: body.headers, body: body.body },
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await openApp(page);
  await visitTab(page, 'Console');

  await page.locator('#console-method').selectOption('POST');
  await page.locator('#console-path').fill('/playwright-probe');
  await page.locator('#console-body').fill('{ "probe": true }');

  await page.locator('details').filter({ hasText: 'Query Parameters' }).locator('summary').click();
  await page.locator('#console-query-params .kv-row').first().locator('input').nth(0).fill('include');
  await page.locator('#console-query-params .kv-row').first().locator('input').nth(1).fill('yes');

  await page.locator('details').filter({ hasText: 'Headers' }).locator('summary').click();
  await page.locator('#console-headers .kv-row').first().locator('input').nth(0).fill('x-pp-probe');
  await page.locator('#console-headers .kv-row').first().locator('input').nth(1).fill('1');

  await page.locator('#console-send').click();
  await expect.poll(() => consoleRequests.length).toBe(1);
  expect(consoleRequests[0]).toMatchObject({
    api: 'dv',
    method: 'POST',
    path: '/playwright-probe',
    query: { include: 'yes' },
    headers: { 'x-pp-probe': '1' },
    body: { probe: true },
  });

  await page.locator('#console-method').selectOption('GET');
  await expect(page.locator('#console-body-section')).toHaveCount(0);
  await page.locator('#console-send').click();
  await expect.poll(() => consoleRequests.length).toBe(2);
  expect(consoleRequests[1]).toMatchObject({
    api: 'dv',
    method: 'GET',
    path: '/playwright-probe',
    query: { include: 'yes' },
    headers: { 'x-pp-probe': '1' },
  });
  expect(consoleRequests[1]).not.toHaveProperty('body');

  await audit.assertClean();
});

test('dataverse query result can toggle table and JSON without corrupting payloads', async ({ page, audit }) => {
  await page.route('**/api/dv/query/execute', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        diagnostics: [],
        data: {
          path: '/api/data/v9.2/accounts?$select=accountid,name&$top=1',
          entitySetName: 'accounts',
          logicalName: 'account',
          records: [{ accountid: '00000000-0000-0000-0000-000000000001', name: 'Playwright Probe' }],
        },
      }),
    });
  });

  await openApp(page);
  await visitTab(page, 'Dataverse');
  await page.getByRole('button', { name: 'Query' }).click();
  await page.locator('#query-entity-set').fill('accounts');
  await page.locator('#query-select').fill('accountid,name');
  await page.locator('#query-run-btn').click();

  const queryResultPanel = page.locator('.panel').filter({ hasText: 'Query Result' }).last();
  await expect(queryResultPanel.getByText('Playwright Probe')).toBeVisible();
  await queryResultPanel.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(queryResultPanel.locator('pre.viewer')).toContainText('Playwright Probe');
  await queryResultPanel.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(queryResultPanel.getByText('Playwright Probe')).toBeVisible();

  const executeRequest = audit.apiRequests.find((request) => request.url.includes('/api/dv/query/execute'));
  expect(executeRequest?.postData).toMatchObject({
    environmentAlias: expect.any(String),
    entitySetName: 'accounts',
    selectCsv: 'accountid,name',
  });
  await audit.assertClean();
});

test('relationship graph validation stays client-side until an entity is selected', async ({ page, audit }) => {
  await openApp(page);
  await visitTab(page, 'Dataverse');
  await page.getByRole('button', { name: 'Relationships' }).click();
  audit.clear();

  await page.locator('#dv-subpanel-dv-relationships').getByRole('button', { name: 'Load Graph' }).click();
  await expect(page.locator('#toasts')).toContainText('Select an entity first');
  expect(audit.apiRequests.filter((request) => new URL(request.url).pathname.startsWith('/api/dv/entities/'))).toEqual([]);
  await audit.assertClean();
});

test('changing environment clears Dataverse query builder state', async ({ page, audit }) => {
  await openApp(page);
  const environmentSelect = page.locator('#global-environment');
  const options = await environmentSelect.locator('option').evaluateAll((items) => items.map((item) => ({
    value: (item as HTMLOptionElement).value,
    selected: (item as HTMLOptionElement).selected,
  })).filter((item) => item.value));
  if (options.length < 2) {
    test.skip(true, 'local config has fewer than two environments');
  }
  const current = options.find((item) => item.selected)?.value || options[0].value;
  const next = options.find((item) => item.value !== current)!.value;

  await visitTab(page, 'Dataverse');
  await page.getByRole('button', { name: 'Query' }).click();
  await page.locator('#query-entity-set').fill('accounts');
  await page.locator('#query-select').fill('accountid,name');
  await page.locator('#query-count').check();

  audit.clear();
  await environmentSelect.selectOption(next);
  await expect(page.locator('#query-entity-set')).toHaveValue('');
  await expect(page.locator('#query-select')).toHaveValue('');
  await expect(page.locator('#query-count')).not.toBeChecked();
  await expect(page.locator('#query-preview')).toContainText('Preview a Dataverse path here.');

  await audit.assertClean();
});

test('console history can pin requests and survives reload', async ({ page, audit }) => {
  await page.route('**/api/request/execute', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.path === '/history-probe') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          success: true,
          diagnostics: [],
          data: { status: 200, headers: {}, response: { path: body.path } },
        }),
      });
      return;
    }
    await route.continue();
  });

  await openApp(page);
  await visitTab(page, 'Console');
  await page.evaluate(() => {
    localStorage.removeItem('pp-console-history');
    localStorage.removeItem('pp-console-saved');
  });
  await page.reload();
  audit.clear();
  await visitTab(page, 'Console');

  await page.locator('#console-path').fill('/history-probe');
  await page.locator('#console-send').click();
  await expect(page.locator('#console-history .history-item').first()).toContainText('/history-probe');
  await page.locator('#console-history .history-item').first().locator('.pin-btn').click();
  await expect(page.locator('#console-saved-panel')).toContainText('/history-probe');

  audit.clear();
  await page.reload();
  audit.clear();
  await expect(page.locator('#console-saved-panel')).toContainText('/history-probe');
  await page.locator('#console-saved .saved-item').first().click();
  await expect(page.locator('#console-path')).toHaveValue('/history-probe');

  await audit.assertClean();
});

test('Apps and Platform detail actions seed the API console', async ({ page, audit }) => {
  await page.route('**/api/request/execute', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.api === 'powerapps' && body.path === '/apps') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          success: true,
          diagnostics: [],
          data: { response: { value: [{ name: 'app-probe', properties: { displayName: 'App Probe', appType: 'CanvasApp' } }] } },
        }),
      });
      return;
    }
    if (body.api === 'bap' && body.path === '/environments') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          success: true,
          diagnostics: [],
          data: { response: { value: [{ name: 'env-probe', location: 'australia', properties: { displayName: 'Environment Probe', states: { management: { id: 'Ready' } } } }] } },
        }),
      });
      return;
    }
    await route.continue();
  });

  await openApp(page);
  await visitTab(page, 'Apps');
  await expect(page.locator('#app-list')).toContainText('App Probe');
  await page.locator('[data-app="app-probe"]').click();
  await page.locator('#app-open-console').click();
  await expect(page.getByRole('button', { name: 'Console' })).toHaveClass(/active/);
  await expect(page.locator('#console-api')).toHaveValue('powerapps');
  await expect(page.locator('#console-path')).toHaveValue('/apps/app-probe');

  await visitTab(page, 'Platform');
  await expect(page.locator('#plat-env-list')).toContainText('Environment Probe');
  await page.locator('[data-plat-env="env-probe"]').click();
  await page.locator('#plat-env-open-console').click();
  await expect(page.getByRole('button', { name: 'Console' })).toHaveClass(/active/);
  await expect(page.locator('#console-api')).toHaveValue('bap');
  await expect(page.locator('#console-path')).toHaveValue('/environments/env-probe');

  await audit.assertClean();
});

test('result tables sort without changing the underlying JSON payload', async ({ page, audit }) => {
  await page.route('**/api/dv/query/execute', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        success: true,
        diagnostics: [],
        data: {
          path: '/api/data/v9.2/accounts?$select=accountid,name&$top=2',
          entitySetName: 'accounts',
          logicalName: 'account',
          records: [
            { accountid: '00000000-0000-0000-0000-000000000002', name: 'Zulu Probe' },
            { accountid: '00000000-0000-0000-0000-000000000001', name: 'Alpha Probe' },
          ],
        },
      }),
    });
  });

  await openApp(page);
  await visitTab(page, 'Dataverse');
  await page.getByRole('button', { name: 'Query' }).click();
  await page.locator('#query-entity-set').fill('accounts');
  await page.locator('#query-select').fill('accountid,name');
  await page.locator('#query-run-btn').click();

  const resultPanel = page.locator('.panel').filter({ hasText: 'Query Result' }).last();
  const nameHeader = resultPanel.locator('th').filter({ hasText: 'Name' }).first();
  await nameHeader.click();
  await expect(resultPanel.locator('tbody tr').first()).toContainText('Alpha Probe');
  await nameHeader.click();
  await expect(resultPanel.locator('tbody tr').first()).toContainText('Zulu Probe');

  await resultPanel.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(resultPanel.locator('pre.viewer')).toContainText('Zulu Probe');
  await expect(resultPanel.locator('pre.viewer')).toContainText('Alpha Probe');

  await audit.assertClean();
});

test('Automate flow, run, and action clicks load the expected detail paths', async ({ page, audit }) => {
  await page.route('**/api/request/execute', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.api !== 'flow') {
      await route.continue();
      return;
    }
    const responseForPath: Record<string, unknown> = {
      '/flows': {
        value: [{
          name: 'flow-probe',
          properties: {
            displayName: 'Flow Probe',
            state: 'Started',
            createdTime: '2026-01-01T00:00:00Z',
            lastModifiedTime: '2026-01-02T00:00:00Z',
            definitionSummary: { triggers: [{ type: 'Request' }], actions: [{ name: 'Compose' }] },
          },
        }],
      },
      '/flows/flow-probe': {
        name: 'flow-probe',
        properties: {
          displayName: 'Flow Probe',
          state: 'Started',
          definition: {
            triggers: { manual: { type: 'Request' } },
            actions: { Compose: { type: 'Compose', inputs: 'hello' } },
          },
        },
      },
      '/flows/flow-probe/runs?$top=20': {
        value: [{
          name: 'run-probe',
          properties: {
            status: 'Succeeded',
            startTime: '2026-01-03T00:00:00Z',
            endTime: '2026-01-03T00:00:02Z',
            trigger: { name: 'manual', status: 'Succeeded' },
          },
        }],
      },
      '/flows/flow-probe/runs/run-probe/actions': {
        value: [{
          name: 'Compose',
          properties: {
            status: 'Succeeded',
            type: 'Compose',
            startTime: '2026-01-03T00:00:01Z',
            endTime: '2026-01-03T00:00:02Z',
          },
        }],
      },
      '/flows/flow-probe/runs/run-probe/actions/Compose': {
        name: 'Compose',
        properties: {
          status: 'Succeeded',
          type: 'Compose',
          inputs: { message: 'hello' },
          outputs: { message: 'hello' },
          startTime: '2026-01-03T00:00:01Z',
          endTime: '2026-01-03T00:00:02Z',
        },
      },
      '/operations?api-version=2016-11-01&$top=250': {
        value: [{
          name: 'CreateRelease',
          id: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices/apiOperations/CreateRelease',
          properties: {
            summary: 'Create a new release',
            description: 'Create a release from a definition.',
            operationType: 'OpenApiConnection',
            api: {
              id: '/providers/Microsoft.PowerApps/apis/shared_visualstudioteamservices',
              apiName: 'visualstudioteamservices',
              displayName: 'Azure DevOps',
            },
          },
        }],
      },
    };
    if (body.path in responseForPath) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          success: true,
          diagnostics: [],
          data: { status: 200, headers: {}, response: responseForPath[body.path] },
        }),
      });
      return;
    }
    await route.continue();
  });

  await openApp(page);
  await visitTab(page, 'Automate');
  await expect(page.locator('[data-flow="flow-probe"]')).toContainText('Flow Probe');
  await page.locator('[data-flow="flow-probe"]').click();
  await expect(page.locator('#panel-automate')).toContainText('Flow Probe');
  await page.getByRole('button', { name: 'Add Action' }).click();
  const releaseSearchRequest = page.waitForRequest((request) => {
    try {
      const body = JSON.parse(request.postData() || '{}');
      const requestBody = JSON.parse(body.body || '{}');
      return body.api === 'flow'
        && body.method === 'POST'
        && body.path === '/operations?api-version=2016-11-01&$top=250'
        && requestBody.searchText === 'release';
    } catch {
      return false;
    }
  });
  await page.getByPlaceholder('Search connectors and actions…').fill('release');
  await releaseSearchRequest;
  await page.getByRole('button', { name: /Create a new release/ }).click();
  await page.getByRole('button', { name: 'Insert Action' }).click();
  await expect(page.locator('.flow-rail-header')).toContainText('2 actions');

  await page.getByRole('button', { name: 'Runs' }).click();
  await expect(page.locator('[data-flow-run="run-probe"]')).toContainText('Succeeded');
  await page.locator('[data-flow-run="run-probe"]').click();
  await expect(page.locator('[data-flow-action="Compose"]')).toContainText('Compose');
  await page.locator('[data-flow-action="Compose"]').click();
  await expect(page.locator('.run-action-detail')).toContainText('Compose');
  await expect(page.locator('.run-action-detail')).toContainText('Succeeded');

  const flowPaths = audit.apiRequests
    .map((request) => request.postData as { api?: string; path?: string } | undefined)
    .filter((body) => body?.api === 'flow')
    .map((body) => body?.path);
  expect(flowPaths).toEqual(expect.arrayContaining([
    '/flows',
    '/flows/flow-probe',
    '/operations?api-version=2016-11-01&$top=250',
    '/flows/flow-probe/runs?$top=20',
    '/flows/flow-probe/runs/run-probe/actions',
    '/flows/flow-probe/runs/run-probe/actions/Compose',
  ]));

  await audit.assertClean();
});
