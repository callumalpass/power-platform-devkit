import { chromium, type Frame, type Locator, type Page } from 'playwright-core';

const userDataDir = '/home/calluma/.config/pp/browser-profiles/test-canvas-harvest';
const studioUrl =
  'https://make.powerapps.com/e/default-de129291-a3f3-4b2f-b179-aec503ae5650/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F1550c4d1-459d-48fe-bab5-aea226d4480f&tenantId=de129291-a3f3-4b2f-b179-aec503ae5650&hint=b9a61c42-ad3d-4396-9445-8ded77dd016c';

const containerName = 'HarvestFixtureContainer';
const containerYaml = [
  `- ${containerName}:`,
  '    Control: GroupContainer@1.4.0',
  '    Variant: ManualLayout',
  '    Properties:',
  '      DropShadow: =DropShadow.None',
  '      Height: =320',
  '      Width: =600',
  '      X: =40',
  '      Y: =220',
  '    Children:',
  '      - HarvestFixtureText:',
  '          Control: ModernText@1.0.0',
  '          Properties:',
  '            Height: =40',
  '            Width: =220',
  '            X: =24',
  '            Y: =24',
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
    const studioFrame = await waitForStudio(page);
    await dismissStudioOverlays(studioFrame);
    await page.waitForTimeout(3000);

    const existing = studioFrame.locator(`[title="${containerName}"]`).first();
    if (await existing.isVisible({ timeout: 1000 }).catch(() => false)) {
      await existing.click({ timeout: 5000, force: true });
      await page.waitForTimeout(500);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(2000);
    }

    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, containerYaml);

    const screenNode = studioFrame.locator('[title="Screen1"]').first();
    await screenNode.click({ timeout: 5000, force: true });
    await page.waitForTimeout(500);
    await page.keyboard.press(`${shortcutModifier()}+V`);
    await page.waitForTimeout(5000);

    const containerVisible = await studioFrame.locator(`[title="${containerName}"]`).first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log('CONTAINER_VISIBLE_AFTER_PASTE', containerVisible);

    await clickAny([
      studioFrame.locator('#commandBar_save'),
      studioFrame.getByRole('button', { name: /Save/i }),
      studioFrame.getByRole('menuitem', { name: /Save/i }),
    ]);
    await page.waitForTimeout(8000);

    await clickAny([
      studioFrame.locator('#commandBar_publish'),
      studioFrame.getByRole('button', { name: /Publish/i }),
      studioFrame.getByRole('menuitem', { name: /Publish/i }),
      studioFrame.getByText(/Publish this version/i).first(),
    ]);
    await page.waitForTimeout(3000);
    await clickAny([
      studioFrame.locator('#commandBar_publish'),
      studioFrame.getByRole('button', { name: /Publish/i }),
      studioFrame.getByRole('button', { name: /Confirm/i }),
    ]);
    await page.waitForTimeout(10000);

    const visibleAfterPublish = await studioFrame.locator(`[title="${containerName}"]`).first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log('CONTAINER_VISIBLE_AFTER_PUBLISH', visibleAfterPublish);

    await page.screenshot({
      path: '/tmp/probe-powerapps-paste-container.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
}

function shortcutModifier(): 'Meta' | 'Control' {
  return process.platform === 'darwin' ? 'Meta' : 'Control';
}

async function clickAny(locators: Locator[]): Promise<boolean> {
  for (const locator of locators) {
    const candidate = locator.first();

    try {
      if (await candidate.isVisible({ timeout: 1000 })) {
        await candidate.click({ timeout: 5000 });
        return true;
      }
    } catch {
      // Keep trying.
    }
  }

  return false;
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
