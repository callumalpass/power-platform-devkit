import { readFileSync } from 'node:fs';
import { chromium, type Frame, type Locator, type Page } from 'playwright-core';

const userDataDir = '/home/calluma/.config/pp/browser-profiles/test-canvas-harvest';
const studioUrl =
  'https://make.powerapps.com/e/default-de129291-a3f3-4b2f-b179-aec503ae5650/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F1550c4d1-459d-48fe-bab5-aea226d4480f&tenantId=de129291-a3f3-4b2f-b179-aec503ae5650&hint=b9a61c42-ad3d-4396-9445-8ded77dd016c';

const clipboardYaml = normalizeScreenYamlForStudio(
  readFileSync('/tmp/pp-canvas-paste-unique/HarvestVerifyScreen.pa.yaml', 'utf8')
);

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

    for (const target of [studioFrame.locator('[title="Screen1"]').first()]) {
      if (!(await target.isVisible({ timeout: 1000 }).catch(() => false))) {
        continue;
      }

      await target.click({ timeout: 5000, force: true }).catch(() => undefined);
      await page.waitForTimeout(500);
      await page.keyboard.press(`${shortcutModifier()}+V`);
      await page.waitForTimeout(4000);

      const visible = await studioFrame.locator('[title="HarvestVerifyScreen"]').first().isVisible({ timeout: 1000 }).catch(() => false);
      console.log('SCREEN_VISIBLE_AFTER_TARGET', await describeTarget(target), visible);
      if (visible) {
        break;
      }
    }

    const finalVisible = await studioFrame.locator('[title="HarvestVerifyScreen"]').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log('FINAL_SCREEN_VISIBLE', finalVisible);

    await page.screenshot({
      path: '/tmp/probe-powerapps-screen-paste.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
}

function shortcutModifier(): 'Meta' | 'Control' {
  return process.platform === 'darwin' ? 'Meta' : 'Control';
}

async function describeTarget(target: Locator): Promise<string> {
  return (
    (await target.getAttribute('title').catch(() => null)) ??
    (await target.textContent().catch(() => null))?.replace(/\s+/g, ' ').trim() ??
    'unknown'
  );
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

function normalizeScreenYamlForStudio(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const stripped = [...lines];

  while (stripped.length > 0) {
    const line = stripped[0];
    if (line.trim() === '') {
      stripped.shift();
      continue;
    }

    if (line.startsWith('#')) {
      stripped.shift();
      continue;
    }

    break;
  }

  return `${stripped.join('\n').trimEnd()}\n`;
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
