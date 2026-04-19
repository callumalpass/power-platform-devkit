import { chooseSelect, clickIfVisible, expect, openApp, test, visitSetupSubTab, visitTab } from './fixtures.js';

test('setup account form switches credential modes without leaking stale fields', async ({ page, audit }) => {
  await openApp(page);
  await visitTab(page, 'Setup');
  await visitSetupSubTab(page, 'Accounts');

  await page.getByRole('button', { name: '+ Add account' }).click();
  const addAccount = page.locator('.setup-split-detail').filter({ hasText: 'Add account' }).first();
  await expect(addAccount.locator('input[name="name"]')).toBeVisible();

  await addAccount.getByRole('tab', { name: /advanced options/i }).click();

  await chooseSelect(page, '.setup-split-detail .pp-select:has(input[name="kind"]) .pp-select-trigger', 'Client secret');
  await expect(addAccount.locator('input[name="clientSecretEnv"]')).toBeVisible();
  await expect(addAccount.locator('input[name="environmentVariable"]')).toHaveCount(0);
  await expect(addAccount.getByRole('button', { name: 'Save & log in' })).toHaveCount(0);

  await chooseSelect(page, '.setup-split-detail .pp-select:has(input[name="kind"]) .pp-select-trigger', 'Environment token variable');
  await expect(addAccount.locator('input[name="environmentVariable"]')).toBeVisible();
  await expect(addAccount.locator('input[name="clientSecretEnv"]')).toHaveCount(0);

  await chooseSelect(page, '.setup-split-detail .pp-select:has(input[name="kind"]) .pp-select-trigger', 'Interactive (browser login)');
  await expect(addAccount.getByRole('button', { name: 'Save & log in' })).toBeVisible();
  await expect(addAccount.getByText('Platform Admin')).toBeVisible();

  await audit.assertClean();
});

test('theme toggle persists across reloads without page errors', async ({ page, audit }) => {
  await openApp(page);
  const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.locator('#theme-toggle').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
  audit.clear();
  await page.reload();
  audit.clear();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
  await audit.assertClean();
});

test('dataverse workspace builders can switch panels and build preview payloads', async ({ page, audit }) => {
  await openApp(page);
  await visitTab(page, 'Dataverse');

  await page.locator('#panel-dataverse').getByRole('button', { name: 'Query', exact: true }).click();
  await expect(page.locator('#dv-subpanel-dv-query')).toBeVisible();
  const entityInput = page.locator('#query-entity-set');
  if (await entityInput.count()) {
    await entityInput.fill('accounts');
    await page.locator('#query-preview-btn').click();
    await expect(page.locator('#query-preview')).toContainText('/accounts');
  }

  await page.locator('#panel-dataverse').getByRole('button', { name: 'FetchXML', exact: true }).click();
  await expect(page.locator('#dv-subpanel-dv-fetchxml')).toBeVisible();
  await clickIfVisible(page, 'button:has-text("Build from fields")');

  await page.locator('#panel-dataverse').getByRole('button', { name: 'Relationships', exact: true }).click();
  await expect(page.locator('#dv-subpanel-dv-relationships')).toBeVisible();

  await audit.assertClean();
});

test('inventory refresh controls fail quietly with valid envelopes', async ({ page, audit }) => {
  await openApp(page);

  await visitTab(page, 'Automate');
  await clickIfVisible(page, '#flow-refresh');

  await visitTab(page, 'Apps');
  await clickIfVisible(page, '#app-refresh');

  await visitTab(page, 'Platform');
  await clickIfVisible(page, '#plat-env-refresh');

  await page.waitForTimeout(1_000);
  await audit.assertClean();
});
