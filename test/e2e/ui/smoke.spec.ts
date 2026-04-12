import { expect, openApp, test, visitSetupSubTab, visitTab } from './fixtures.js';

const MAIN_TABS = ['Setup', 'Console', 'Dataverse', 'Automate', 'Apps', 'Platform'];
const SETUP_SUB_TABS = ['Status', 'Accounts', 'Environments', 'My Access', 'MCP'];

test('main navigation renders without console errors and returns valid API envelopes', async ({ page, audit }) => {
  await openApp(page);

  for (const tab of MAIN_TABS) {
    await visitTab(page, tab);
    await expect(page.getByRole('button', { name: tab })).toHaveClass(/active/);
    await page.waitForTimeout(300);
  }

  await audit.assertClean();
});

test('setup subtabs render account, environment, access, and MCP surfaces', async ({ page, audit }) => {
  await openApp(page);
  await visitTab(page, 'Setup');

  for (const tab of SETUP_SUB_TABS) {
    await visitSetupSubTab(page, tab);
    await expect(page.getByRole('button', { name: tab })).toHaveClass(/active/);
    await page.waitForTimeout(300);
  }

  await audit.assertClean();
});

test('console request builder keeps request payloads well formed', async ({ page, audit }) => {
  await openApp(page);
  await visitTab(page, 'Console');

  const requestPath = page.locator('textarea[name="path"], input[name="path"], #console-path').first();
  if (await requestPath.count()) {
    await requestPath.fill('/WhoAmI');
  }

  const methodSelect = page.locator('select[name="method"], #console-method').first();
  if (await methodSelect.count()) {
    await methodSelect.selectOption('GET').catch(() => undefined);
  }

  const previewButton = page.getByRole('button', { name: /preview|run|send/i }).first();
  if (await previewButton.count()) {
    await previewButton.click();
    await page.waitForTimeout(500);
  }

  for (const response of audit.apiResponses) {
    const body = response.body as { diagnostics?: Array<{ detail?: string; message?: string }> } | undefined;
    const serialized = JSON.stringify(body?.diagnostics ?? []);
    expect.soft(serialized, `${response.method} ${response.url} diagnostics should not include malformed JSON`).not.toMatch(/Unexpected token|JSON parse|could not be parsed/i);
  }
  await audit.assertClean();
});
