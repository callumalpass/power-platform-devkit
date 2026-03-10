import { chromium, type Frame, type Locator, type Page } from 'playwright-core';

const userDataDir = '/home/calluma/.config/pp/browser-profiles/test-canvas-harvest';
const studioUrl =
  'https://make.powerapps.com/e/default-de129291-a3f3-4b2f-b179-aec503ae5650/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F1550c4d1-459d-48fe-bab5-aea226d4480f&tenantId=de129291-a3f3-4b2f-b179-aec503ae5650&hint=b9a61c42-ad3d-4396-9445-8ded77dd016c';

const clipboardYaml = [
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
    }, clipboardYaml);

    const studioFrame = await waitForStudio(page);
    await dismissStudioOverlays(studioFrame);
    await page.waitForTimeout(3000);

    await inspectTarget(page, studioFrame, 'Screen1', studioFrame.locator('[title="Screen1"]').first());
    await inspectTarget(page, studioFrame, 'Text1', studioFrame.locator('[title="Text1"]').first());
    await inspectTarget(page, studioFrame, 'New screen', studioFrame.getByText(/^New screen$/i).first());
    await inspectTarget(page, studioFrame, 'Screens tab', studioFrame.getByRole('tab', { name: /^Screens$/i }).first());

    await page.screenshot({
      path: '/tmp/inspect-powerapps-paste-options.png',
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
  await page.waitForTimeout(800);

  console.log('TARGET_OPTIONS', label, {
    pasteCode: await isVisibleAnywhere(page, studioFrame, /^Paste code$/i),
    viewCode: await isVisibleAnywhere(page, studioFrame, /^View code$/i),
    copyCode: await isVisibleAnywhere(page, studioFrame, /^Copy code$/i),
    cut: await isVisibleAnywhere(page, studioFrame, /^Cut$/i),
    duplicate: await isVisibleAnywhere(page, studioFrame, /^Duplicate$/i),
    delete: await isVisibleAnywhere(page, studioFrame, /^Delete$/i),
  });

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(500);
}

async function isVisibleAnywhere(page: Page, studioFrame: Frame, text: RegExp): Promise<boolean> {
  const candidates = [studioFrame.getByText(text).first(), page.getByText(text).first()];

  for (const candidate of candidates) {
    if (await candidate.isVisible({ timeout: 300 }).catch(() => false)) {
      return true;
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
