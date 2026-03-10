import { chromium, type Frame, type Locator, type Page } from 'playwright-core';

const userDataDir = '/home/calluma/.config/pp/browser-profiles/test-canvas-harvest';
const studioUrl =
  'https://make.powerapps.com/e/default-de129291-a3f3-4b2f-b179-aec503ae5650/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F1550c4d1-459d-48fe-bab5-aea226d4480f&tenantId=de129291-a3f3-4b2f-b179-aec503ae5650&hint=b9a61c42-ad3d-4396-9445-8ded77dd016c';

const probeControl = [
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

    const studioFrame = await waitForStudio(page);
    await dismissStudioOverlays(studioFrame);
    await page.waitForTimeout(3000);

    const screenNode = studioFrame.locator('[title="Screen1"]').first();
    await screenNode.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    await screenNode.click({ button: 'right', timeout: 5000 });
    await page.waitForTimeout(1000);

    const viewCode = studioFrame.getByText(/View code/i).first();
    await viewCode.click({ timeout: 5000 });
    await page.waitForTimeout(2500);

    const editor = studioFrame.locator('textarea[aria-label*="Editor content"]').first();
    await editor.waitFor({ state: 'visible', timeout: 15000 });
    const existing = (await editor.inputValue()).trimEnd();

    if (!existing.includes('HarvestProbeText')) {
      const updated = `${existing}\n${probeControl}\n`;
      await editor.click({ timeout: 5000, force: true });
      await page.waitForTimeout(250);
      await page.keyboard.press(`${shortcutModifier()}+A`);
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(updated);
      await page.waitForTimeout(1500);
    }

    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(1000);

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

    const probeNode = studioFrame.locator('[title="HarvestProbeText"]').first();
    const probeVisible = await probeNode.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('PROBE_VISIBLE', probeVisible);

    await page.screenshot({
      path: '/tmp/probe-powerapps-codewrite.png',
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
