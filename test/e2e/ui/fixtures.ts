import { expect, test as base, type Page, type Response } from '@playwright/test';

type NetworkRecord = {
  method: string;
  url: string;
  status: number;
  contentType: string;
  body?: unknown;
  parseError?: string;
};

type RequestRecord = {
  method: string;
  url: string;
  postData?: unknown;
  parseError?: string;
};

type UiAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  apiRequests: RequestRecord[];
  apiResponses: NetworkRecord[];
  clear: () => void;
  assertClean: () => Promise<void>;
};

export const test = base.extend<{ audit: UiAudit }>({
  audit: async ({ page }, use) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const apiRequests: RequestRecord[] = [];
    const apiResponses: NetworkRecord[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.stack || error.message);
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
    });
    page.on('request', (request) => {
      if (!isAuditedApiUrl(request.url(), request.frame()?.url())) return;
      const record: RequestRecord = {
        method: request.method(),
        url: request.url(),
      };
      const postData = request.postData();
      if (postData) {
        try {
          record.postData = JSON.parse(postData);
        } catch (error) {
          record.parseError = error instanceof Error ? error.message : String(error);
        }
      }
      apiRequests.push(record);
    });
    page.on('response', (response) => {
      void recordApiResponse(response, apiResponses);
    });

    await use({
      consoleErrors,
      pageErrors,
      failedRequests,
      apiRequests,
      apiResponses,
      clear: () => {
        consoleErrors.length = 0;
        pageErrors.length = 0;
        failedRequests.length = 0;
        apiRequests.length = 0;
        apiResponses.length = 0;
      },
      assertClean: async () => {
        await expect.poll(() => pendingApiResponses(apiResponses), {
          message: 'wait for API response audit to settle',
          timeout: 2_000,
        }).toBe(0);
        expect.soft(consoleErrors, 'browser console errors').toEqual([]);
        expect.soft(pageErrors, 'uncaught page errors').toEqual([]);
        expect.soft(failedRequests, 'failed network requests').toEqual([]);
        for (const request of apiRequests) {
          expect.soft(request.parseError, `${request.method} ${request.url} request JSON parse`).toBeUndefined();
        }
        for (const response of apiResponses) {
          expect.soft(response.status, `${response.method} ${response.url}`).toBeLessThan(500);
          expect.soft(response.contentType, `${response.method} ${response.url} content-type`).toContain('application/json');
          expect.soft(response.parseError, `${response.method} ${response.url} JSON parse`).toBeUndefined();
          if (response.body && typeof response.body === 'object') {
            const envelope = response.body as { success?: unknown; diagnostics?: unknown; data?: unknown };
            expect.soft(typeof envelope.success, `${response.method} ${response.url} success envelope`).toBe('boolean');
            expect.soft(Array.isArray(envelope.diagnostics), `${response.method} ${response.url} diagnostics envelope`).toBe(true);
            expect.soft('data' in envelope || envelope.success === false, `${response.method} ${response.url} data envelope`).toBe(true);
          }
        }
      },
    });
  },
});

export { expect };

export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setup' })).toBeVisible();
}

export async function visitTab(page: Page, tabName: string): Promise<void> {
  const tab = page.locator('.tabs').getByRole('button', { name: tabName });
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveClass(/active/);
  await expect(page.locator('.tab-panel.active')).toHaveCount(1);
  await expect(page.locator('.tab-panel.active')).toBeVisible();
}

export async function visitSetupSubTab(page: Page, tabName: string): Promise<void> {
  await page.locator('#panel-setup').getByRole('button', { name: tabName }).click();
  await expect(page.locator('#panel-setup .dv-subpanel.active, .setup-layout .dv-subpanel.active')).toBeVisible();
}

export async function clickIfVisible(page: Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  if (!(await locator.count())) return false;
  if (!(await locator.isVisible())) return false;
  if (await locator.isDisabled()) return false;
  await locator.click();
  return true;
}

function isAuditedApiResponse(response: Response): boolean {
  return isAuditedApiUrl(response.url(), response.request().frame()?.url());
}

function isAuditedApiUrl(requestUrl: string, frameUrl?: string): boolean {
  const url = new URL(requestUrl);
  if (url.origin !== new URL(frameUrl || requestUrl).origin) return false;
  if (!url.pathname.startsWith('/api/')) return false;
  if (url.pathname.includes('/events')) return false;
  if (url.pathname.startsWith('/api/vendor/')) return false;
  if (url.pathname.startsWith('/api/assets/')) return false;
  return true;
}

async function recordApiResponse(response: Response, records: NetworkRecord[]): Promise<void> {
  if (!isAuditedApiResponse(response)) return;
  const record: NetworkRecord = {
    method: response.request().method(),
    url: response.url(),
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
  };
  records.push(record);
  if (!record.contentType.includes('application/json')) return;
  try {
    record.body = await response.json();
  } catch (error) {
    record.parseError = error instanceof Error ? error.message : String(error);
  }
}

function pendingApiResponses(records: NetworkRecord[]): number {
  return records.filter((record) => record.contentType.includes('application/json') && record.body === undefined && record.parseError === undefined).length;
}
