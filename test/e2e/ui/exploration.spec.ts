import { chooseSelect, expect, getDesktopApiCalls, installDesktopApiMocks, openApp, test, visitTab } from './fixtures.js';

function apiEnvelope(data: unknown) {
  return { success: true, diagnostics: [], data };
}

function requestResult(response: unknown) {
  return apiEnvelope({ status: 200, headers: {}, response });
}

async function consoleProbeCalls(page: Parameters<typeof getDesktopApiCalls>[0]) {
  return (await getDesktopApiCalls(page)).map((request) => request.body as Record<string, unknown> | undefined).filter((body) => body?.path === '/playwright-probe');
}

test('hash deep links land on the requested primary tab', async ({ page, audit }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.location.hash = 'console';
  });
  await expect(page.getByRole('button', { name: 'Console' })).toHaveClass(/active/);
  await expect(page.locator('#panel-console')).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = 'platform';
  });
  await expect(page.getByRole('button', { name: 'Platform' })).toHaveClass(/active/);
  await expect(page.locator('#panel-platform')).toBeVisible();

  await audit.assertClean();
});

test('console sends structured request payloads and drops body fields for GET', async ({ page, audit }) => {
  await installDesktopApiMocks(page, [{ method: 'POST', path: '/api/request/execute', bodyPath: '/playwright-probe', body: requestResult({ ok: true }) }]);

  await openApp(page);
  await visitTab(page, 'Console');

  await chooseSelect(page, '#console-method', 'POST');
  await page.locator('#console-path').fill('/playwright-probe');
  await page.getByRole('button', { name: 'Body', exact: true }).click();
  await page.getByLabel('Request body (JSON)').fill('{ "probe": true }');

  await page.getByRole('button', { name: 'Query', exact: true }).click();
  await page.getByLabel('Query key 1').fill('include');
  await page.getByLabel('Query value 1').fill('yes');

  await page.getByRole('button', { name: 'Headers', exact: true }).click();
  await page.getByLabel('Header name 1').fill('x-pp-probe');
  await page.getByLabel('Header value 1').fill('1');

  await page.locator('#console-send').click();
  await expect.poll(async () => (await consoleProbeCalls(page)).length).toBe(1);
  const consoleRequests = await consoleProbeCalls(page);
  expect(consoleRequests[0]).toMatchObject({
    api: 'dv',
    method: 'POST',
    path: '/playwright-probe',
    query: { include: 'yes' },
    headers: { 'x-pp-probe': '1' },
    body: { probe: true }
  });

  await chooseSelect(page, '#console-method', 'GET');
  await expect(page.getByRole('button', { name: 'Body', exact: true })).toBeDisabled();
  await page.locator('#console-send').click();
  await expect.poll(async () => (await consoleProbeCalls(page)).length).toBe(2);
  const updatedConsoleRequests = await consoleProbeCalls(page);
  expect(updatedConsoleRequests[1]).toMatchObject({
    api: 'dv',
    method: 'GET',
    path: '/playwright-probe',
    query: { include: 'yes' },
    headers: { 'x-pp-probe': '1' }
  });
  expect(updatedConsoleRequests[1]).not.toHaveProperty('body');

  await audit.assertClean();
});

test('dataverse query result can toggle table and JSON without corrupting payloads', async ({ page, audit }) => {
  await installDesktopApiMocks(page, [
    {
      method: 'POST',
      path: '/api/dv/query/execute',
      body: apiEnvelope({
        path: '/api/data/v9.2/accounts?$select=accountid,name&$top=1',
        entitySetName: 'accounts',
        logicalName: 'account',
        records: [{ accountid: '00000000-0000-0000-0000-000000000001', name: 'Playwright Probe' }]
      })
    }
  ]);

  await openApp(page);
  await visitTab(page, 'Dataverse');
  await page.locator('#panel-dataverse').getByRole('button', { name: 'Query', exact: true }).click();
  await page.locator('#query-entity-set').fill('accounts');
  await page.locator('#query-select').fill('accountid,name');
  await page.locator('#query-run-btn').click();

  const queryResultPanel = page.locator('.panel').filter({ hasText: 'Query Result' }).last();
  await expect(queryResultPanel.getByText('Playwright Probe')).toBeVisible();
  await queryResultPanel.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(queryResultPanel.locator('pre.viewer')).toContainText('Playwright Probe');
  await queryResultPanel.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(queryResultPanel.getByText('Playwright Probe')).toBeVisible();

  const executeRequest = (await getDesktopApiCalls(page)).find((request) => request.path === '/api/dv/query/execute');
  expect(executeRequest?.body).toMatchObject({
    environmentAlias: expect.any(String),
    entitySetName: 'accounts',
    selectCsv: 'accountid,name'
  });
  await audit.assertClean();
});

test('relationship graph validation stays client-side until an entity is selected', async ({ page, audit }) => {
  await openApp(page);
  await visitTab(page, 'Dataverse');
  await page.locator('#panel-dataverse').getByRole('button', { name: 'Relationships', exact: true }).click();
  audit.clear();
  await installDesktopApiMocks(page, []);

  await page.locator('#dv-subpanel-dv-relationships').getByRole('button', { name: 'Load Graph' }).click();
  await expect(page.locator('#toasts')).toContainText('Select an entity first');
  expect((await getDesktopApiCalls(page)).filter((request) => request.path.startsWith('/api/dv/entities/'))).toEqual([]);
  await audit.assertClean();
});

test('changing environment clears Dataverse query builder state', async ({ page, audit }) => {
  await openApp(page);
  const environmentSelect = page.locator('#global-environment');
  const options = await environmentSelect.locator('option').evaluateAll((items) =>
    items
      .map((item) => ({
        value: (item as HTMLOptionElement).value,
        selected: (item as HTMLOptionElement).selected
      }))
      .filter((item) => item.value)
  );
  if (options.length < 2) {
    test.skip(true, 'local config has fewer than two environments');
  }
  const current = options.find((item) => item.selected)?.value || options[0].value;
  const next = options.find((item) => item.value !== current)!.value;

  await visitTab(page, 'Dataverse');
  await page.locator('#panel-dataverse').getByRole('button', { name: 'Query', exact: true }).click();
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
  await installDesktopApiMocks(page, [
    { method: 'POST', path: '/api/request/execute', bodyPath: '/history-probe', body: requestResult({ path: '/history-probe' }) },
    { method: 'PUT', path: '/api/ui/saved-requests', body: apiEnvelope({ entries: [] }) }
  ]);

  await openApp(page);
  await visitTab(page, 'Console');
  await page.evaluate(() => {
    localStorage.removeItem('pp-console-history');
    localStorage.removeItem('pp-console-saved');
    localStorage.removeItem('__ppDesktopMockSavedRequests');
  });
  await page.reload();
  audit.clear();
  await visitTab(page, 'Console');

  await page.locator('#console-path').fill('/history-probe');
  await page.locator('#console-send').click();
  const historyItem = page.locator('.console-rail-list .history-item').first();
  await expect(historyItem).toContainText('/history-probe');
  await historyItem.getByRole('button', { name: 'Pin request' }).click();
  await page.getByRole('button', { name: /Saved/ }).click();
  await expect(page.locator('.console-rail-list')).toContainText('/history-probe');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('__ppDesktopMockSavedRequests') || '')).toContain('/history-probe');

  audit.clear();
  await page.reload();
  audit.clear();
  await openApp(page);
  await page.getByRole('button', { name: /Saved/ }).click();
  await expect(page.locator('.console-rail-list')).toContainText('/history-probe');
  await page.locator('.console-rail-list .saved-item').first().click();
  await expect(page.locator('#console-path')).toHaveValue('/history-probe');

  await audit.assertClean();
});

test('Apps and Platform detail actions seed the API console', async ({ page, audit }) => {
  await installDesktopApiMocks(page, [
    {
      method: 'POST',
      path: '/api/request/execute',
      bodyApi: 'powerapps',
      bodyPath: '/apps',
      body: requestResult({ value: [{ name: 'app-probe', properties: { displayName: 'App Probe', appType: 'CanvasApp' } }] })
    },
    {
      method: 'POST',
      path: '/api/request/execute',
      bodyApi: 'bap',
      bodyPath: '/environments',
      body: requestResult({ value: [{ name: 'env-probe', location: 'australia', properties: { displayName: 'Environment Probe', states: { management: { id: 'Ready' } } } }] })
    }
  ]);

  await openApp(page);
  await visitTab(page, 'Apps');
  const appItem = page.getByRole('button', { name: /App Probe/ });
  await expect(appItem).toBeVisible();
  await appItem.click();
  await page.locator('#app-open-console').click();
  await expect(page.getByRole('button', { name: 'Console' })).toHaveClass(/active/);
  await expect(page.locator('#console-api')).toContainText('Power Apps');
  await expect(page.locator('#console-path')).toHaveValue('/apps/app-probe');

  await visitTab(page, 'Platform');
  const platformItem = page.getByRole('button', { name: /Environment Probe/ });
  await expect(platformItem).toBeVisible();
  await platformItem.click();
  await page.locator('#plat-env-open-console').click();
  await expect(page.getByRole('button', { name: 'Console' })).toHaveClass(/active/);
  await expect(page.locator('#console-api')).toContainText('BAP');
  await expect(page.locator('#console-path')).toHaveValue('/environments/env-probe');

  await audit.assertClean();
});

test('result tables sort without changing the underlying JSON payload', async ({ page, audit }) => {
  await installDesktopApiMocks(page, [
    {
      method: 'POST',
      path: '/api/dv/query/execute',
      body: apiEnvelope({
        path: '/api/data/v9.2/accounts?$select=accountid,name&$top=2',
        entitySetName: 'accounts',
        logicalName: 'account',
        records: [
          { accountid: '00000000-0000-0000-0000-000000000002', name: 'Zulu Probe' },
          { accountid: '00000000-0000-0000-0000-000000000001', name: 'Alpha Probe' }
        ]
      })
    }
  ]);

  await openApp(page);
  await visitTab(page, 'Dataverse');
  await page.locator('#panel-dataverse').getByRole('button', { name: 'Query', exact: true }).click();
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
  const responseForPath: Record<string, unknown> = {
    '/flows': {
      value: [
        {
          name: 'flow-probe',
          properties: {
            displayName: 'Flow Probe',
            state: 'Started',
            createdTime: '2026-01-01T00:00:00Z',
            lastModifiedTime: '2026-01-02T00:00:00Z',
            definitionSummary: { triggers: [{ type: 'Request' }], actions: [{ name: 'Compose' }] }
          }
        }
      ]
    },
    '/flows/flow-probe': {
      name: 'flow-probe',
      properties: {
        displayName: 'Flow Probe',
        state: 'Started',
        definition: {
          triggers: { manual: { type: 'Request' } },
          actions: { Compose: { type: 'Compose', inputs: 'hello' } }
        }
      }
    },
    '/flows/flow-probe/runs?$top=20': {
      value: [
        {
          name: 'run-probe',
          properties: {
            status: 'Succeeded',
            startTime: '2026-01-03T00:00:00Z',
            endTime: '2026-01-03T00:00:02Z',
            trigger: { name: 'manual', status: 'Succeeded' }
          }
        }
      ]
    },
    '/flows/flow-probe/runs/run-probe/actions': {
      value: [
        {
          name: 'Compose',
          properties: {
            status: 'Succeeded',
            type: 'Compose',
            startTime: '2026-01-03T00:00:01Z',
            endTime: '2026-01-03T00:00:02Z'
          }
        }
      ]
    },
    '/flows/flow-probe/runs/run-probe?$expand=properties/actions,properties/flow&include=repetitionCount&isMigrationSource=false': {
      name: 'run-probe',
      properties: {
        status: 'Succeeded',
        trigger: { name: 'manual', status: 'Succeeded' },
        flow: {
          name: 'flow-probe',
          properties: {
            definition: {
              triggers: { manual: { type: 'Request' } },
              actions: { Compose: { type: 'Compose', inputs: 'hello' } }
            }
          }
        }
      }
    },
    '/flows/flow-probe/runs/run-probe/actions/Compose': {
      name: 'Compose',
      properties: {
        status: 'Succeeded',
        type: 'Compose',
        inputs: { message: 'hello' },
        outputs: { message: 'hello' },
        startTime: '2026-01-03T00:00:01Z',
        endTime: '2026-01-03T00:00:02Z'
      }
    }
  };
  await installDesktopApiMocks(
    page,
    Object.entries(responseForPath).map(([bodyPath, response]) => ({
      method: 'POST',
      path: '/api/request/execute',
      bodyApi: 'flow',
      bodyPath,
      body: requestResult(response)
    }))
  );

  await openApp(page);
  await visitTab(page, 'Automate');
  await expect(page.locator('[data-flow="flow-probe"]')).toContainText('Flow Probe');
  await page.locator('[data-flow="flow-probe"]').click();
  await expect(page.locator('#panel-automate')).toContainText('Flow Probe');
  await page.getByRole('button', { name: 'Add Action' }).click();
  await page.getByRole('button', { name: /Compose/ }).click();
  await page.getByRole('button', { name: 'Insert Action' }).click();
  await expect(page.locator('#panel-automate')).toContainText('Compose_2');

  await page.getByRole('button', { name: 'Runs' }).click();
  await expect(page.locator('[data-flow-run="run-probe"]')).toContainText('Succeeded');
  await page.locator('[data-flow-run="run-probe"]').click();
  const runAction = page.locator('.run-expanded').getByText('Compose', { exact: true }).first();
  await expect(runAction).toBeVisible();
  await runAction.click();
  await expect(page.locator('.run-action-detail')).toContainText('Compose');
  await expect(page.locator('.run-action-detail')).toContainText('Succeeded');

  const flowPaths = (await getDesktopApiCalls(page))
    .map((request) => request.body as { api?: string; path?: string } | undefined)
    .filter((body) => body?.api === 'flow')
    .map((body) => body?.path);
  expect(flowPaths).toEqual(
    expect.arrayContaining(['/flows', '/flows/flow-probe', '/flows/flow-probe/runs?$top=20', '/flows/flow-probe/runs/run-probe/actions', '/flows/flow-probe/runs/run-probe/actions/Compose'])
  );

  await audit.assertClean();
});
