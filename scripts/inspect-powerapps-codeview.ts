import { chromium, type Frame, type Locator, type Page } from 'playwright-core';

const userDataDir = '/home/calluma/.config/pp/browser-profiles/test-canvas-harvest';
const studioUrl =
  'https://make.powerapps.com/e/default-de129291-a3f3-4b2f-b179-aec503ae5650/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F1550c4d1-459d-48fe-bab5-aea226d4480f&tenantId=de129291-a3f3-4b2f-b179-aec503ae5650&hint=b9a61c42-ad3d-4396-9445-8ded77dd016c';

const controlYaml = [
  '- HarvestProbeText:',
  '    Control: ModernText@1.0.0',
  '    Properties:',
  '      Height: =40',
  '      Width: =180',
  '      X: =200',
  '      Y: =200',
].join('\n');

async function main(): Promise<void> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: ['--no-first-run', '--new-window'],
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(studioUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await grantClipboardPermissions(page);
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, controlYaml);

    const studioFrame = await waitForStudio(page);
    await dismissStudioOverlays(studioFrame);
    await page.waitForTimeout(3000);

    await inspectTarget(page, studioFrame, 'Screen1', studioFrame.locator('[title="Screen1"]').first());
    await inspectTarget(page, studioFrame, 'Text1', studioFrame.locator('[title="Text1"]').first());
    await inspectTarget(page, studioFrame, 'New screen', studioFrame.getByText(/^New screen$/i).first());
    await inspectTarget(page, studioFrame, 'Screens tab', studioFrame.getByRole('tab', { name: /^Screens$/i }).first());

    await inspectViewCode(page, studioFrame);

    await page.screenshot({
      path: '/tmp/inspect-powerapps-codeview.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
}

async function inspectTarget(page: Page, studioFrame: Frame, label: string, locator: Locator): Promise<void> {
  const target = locator.first();
  const visible = await target.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    console.log('TARGET_MISSING', label);
    return;
  }

  await target.click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  await target.click({ button: 'right', timeout: 5000 });
  await page.waitForTimeout(1000);

  const menuItems = await collectVisibleMenuItems(page, studioFrame);
  console.log('TARGET_MENU', label, menuItems);

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(500);
}

async function inspectViewCode(page: Page, studioFrame: Frame): Promise<void> {
  const screenNode = studioFrame.locator('[title="Screen1"]').first();
  await screenNode.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  await screenNode.click({ button: 'right', timeout: 5000 });
  await page.waitForTimeout(1000);

  const viewCode = studioFrame.getByText(/View code/i).first();
  const viewCodeVisible = await viewCode.isVisible({ timeout: 2000 }).catch(() => false);
  console.log('VIEW_CODE_VISIBLE', viewCodeVisible);

  if (!viewCodeVisible) {
    await page.keyboard.press('Escape').catch(() => undefined);
    return;
  }

  await viewCode.click({ timeout: 5000 });
  await page.waitForTimeout(3000);

  const panelTextareas = await studioFrame
    .locator('textarea')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: (node as HTMLTextAreaElement).value,
        ariaLabel: node.getAttribute('aria-label'),
        role: node.getAttribute('role'),
      }))
    )
    .catch(() => []);
  console.log('CODE_TEXTAREAS', panelTextareas);

  const panelButtons = await studioFrame
    .locator('button, [role="button"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ariaLabel: node.getAttribute('aria-label'),
          title: node.getAttribute('title'),
        }))
        .filter((node) => node.text || node.ariaLabel || node.title)
    )
    .catch(() => []);
  console.log('CODE_BUTTONS', panelButtons);

  const codeText = await studioFrame
    .locator('textarea, pre, code')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ('value' in node ? String((node as HTMLTextAreaElement).value ?? '') : node.textContent ?? ''))
        .join('\n---\n')
    )
    .catch(() => '');
  console.log('CODE_TEXT', codeText.slice(0, 4000));

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(500);
}

async function collectVisibleMenuItems(page: Page, studioFrame: Frame): Promise<unknown[]> {
  const scopes = [studioFrame.locator('[role="menu"]'), page.locator('[role="menu"]')];
  const items: Array<{
    text: string;
    ariaLabel: string | null;
    title: string | null;
    role: string | null;
  }> = [];

  for (const scope of scopes) {
    const visible = await scope
      .filter({ has: scope.locator('[role="menuitem"], [role="option"], button') })
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (!visible) {
      continue;
    }

    const scopeItems = await scope
      .first()
      .locator('[role="menuitem"], [role="option"], button')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => ({
            text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
            ariaLabel: node.getAttribute('aria-label'),
            title: node.getAttribute('title'),
            role: node.getAttribute('role'),
          }))
          .filter((node) => node.text || node.ariaLabel || node.title)
      )
      .catch(() => []);

    items.push(...scopeItems);
  }

  return items;
}

async function waitForStudio(page: Page): Promise<Frame> {
  const deadline = Date.now() + 120000;

  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.name() === 'EmbeddedStudio');
    if (frame) {
      const ready = await frame.locator('[title="Screen1"]').first().isVisible({ timeout: 1000 }).catch(() => false);
      if (ready) {
        return frame;
      }
    }

    await page.waitForTimeout(1000);
  }

  throw new Error('Timed out waiting for EmbeddedStudio frame.');
}

async function dismissStudioOverlays(studioFrame: Frame): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const clicked =
      (await studioFrame.getByRole('button', { name: /^Skip$/i }).first().click({ timeout: 1000 }).then(() => true).catch(() => false)) ||
      (await studioFrame.getByRole('button', { name: /^Override$/i }).first().click({ timeout: 1000 }).then(() => true).catch(() => false)) ||
      (await studioFrame.getByRole('button', { name: /^Got it$/i }).first().click({ timeout: 1000 }).then(() => true).catch(() => false));

    if (!clicked) {
      return;
    }

    await studioFrame.page().waitForTimeout(1500);
  }
}

async function grantClipboardPermissions(page: Page): Promise<void> {
  const origin = new URL(studioUrl).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
