import { chromium } from 'playwright-core';

const userDataDir = '/home/calluma/.config/pp/browser-profiles/test-canvas-harvest';
const studioUrl =
  'https://make.powerapps.com/e/default-de129291-a3f3-4b2f-b179-aec503ae5650/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F1550c4d1-459d-48fe-bab5-aea226d4480f&tenantId=de129291-a3f3-4b2f-b179-aec503ae5650&hint=b9a61c42-ad3d-4396-9445-8ded77dd016c';

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
    await page.waitForTimeout(15000);

    const skipVisible = await page.getByText(/^Skip$/i).first().isVisible({ timeout: 1000 }).catch(() => false);
    console.log('TOP_SKIP_VISIBLE', skipVisible);

    if (skipVisible) {
      await page.getByText(/^Skip$/i).first().click({ timeout: 5000 });
      await page.waitForTimeout(5000);
    }

    console.log('PAGE', page.url());

    for (const [index, frame] of page.frames().entries()) {
      console.log(`FRAME ${index}`, {
        name: frame.name(),
        url: frame.url(),
      });

      for (const label of ['See a preview of this app', 'Skip', 'Read-only', 'File', 'Insert', 'Save']) {
        const visible = await frame
          .getByText(label, { exact: false })
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);
        console.log(`  text:${label}`, visible);
      }

      const buttons = await frame
        .locator('button')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => ({
              text: (node.textContent ?? '').trim(),
              ariaLabel: node.getAttribute('aria-label'),
              title: node.getAttribute('title'),
              id: node.getAttribute('id'),
              disabled: node.hasAttribute('disabled'),
            }))
            .slice(0, 40)
        )
        .catch(() => []);
      console.log('  buttons', buttons);

      const dialogs = await frame
        .locator('[role="dialog"]')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
            .filter((value) => value.length > 0)
            .slice(0, 10)
        )
        .catch(() => []);
      console.log('  dialogs', dialogs);
    }

    const studioFrame = page.frames().find((frame) => frame.name() === 'EmbeddedStudio');

    if (studioFrame) {
      for (const label of ['Skip', 'Override', 'Got it']) {
        const locator = studioFrame.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
        const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
        console.log(`ACTION ${label}`, visible);
        if (visible) {
          await locator.click({ timeout: 5000 });
          await page.waitForTimeout(2000);
        }
      }

      console.log('POST_ACTIONS');
      for (const label of ['Read-only', 'File', 'Insert', 'Skip', 'Override', 'Got it']) {
        const visible = await studioFrame
          .getByText(label, { exact: false })
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);
        console.log(`  text:${label}`, visible);
      }
    }

    await page.screenshot({
      path: '/tmp/inspect-powerapps-studio.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
