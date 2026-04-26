import { _electron as electron, expect, test as base, type ElectronApplication, type Page, type Response } from '@playwright/test';

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

export type DesktopApiMockRule = {
  method?: string;
  path: string;
  bodyApi?: string;
  bodyPath?: string;
  status?: number;
  body: unknown;
};

export type DesktopApiCall = {
  path: string;
  method: string;
  body?: unknown;
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

export const test = base.extend<{ electronApp: ElectronApplication; page: Page; audit: UiAudit }>({
  electronApp: async ({ browserName: _browserName }, use) => {
    const args = process.platform === 'linux' ? ['--no-sandbox', 'dist/desktop/main.cjs'] : ['dist/desktop/main.cjs'];
    const app = await electron.launch({
      args,
      env: {
        ...process.env,
        PP_DESKTOP_E2E: '1',
        PP_DESKTOP_E2E_WINDOW_MODE: process.env.PP_DESKTOP_E2E_WINDOW_MODE ?? (process.env.PP_DESKTOP_E2E_SHOW_WINDOW === '1' ? 'visible' : 'hidden')
      }
    });
    await use(app);
    await app.close();
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await use(page);
  },
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
        url: request.url()
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
        await expect
          .poll(() => pendingApiResponses(apiResponses), {
            message: 'wait for API response audit to settle',
            timeout: 2_000
          })
          .toBe(0);
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
      }
    });
  }
});

export { expect };

export async function openApp(page: Page): Promise<void> {
  await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setup' })).toBeVisible();
  await page.keyboard.press('Escape').catch(() => undefined);
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

export async function chooseSelect(page: Page, selector: string, label: string): Promise<void> {
  const trigger = page.locator(selector);
  await trigger.click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

export async function installDesktopApiMocks(page: Page, rules: DesktopApiMockRule[]): Promise<void> {
  const install = (mockRules: DesktopApiMockRule[]) => {
    const state = {
      calls: [] as DesktopApiCall[],
      rules: mockRules,
      async request(input: DesktopApiCall) {
        const call = {
          path: input.path,
          method: (input.method || 'GET').toUpperCase(),
          body: input.body
        };
        state.calls.push(call);
        const hasSavedRequestsMock = state.rules.some((rule) => rule.path === '/api/ui/saved-requests');
        if (hasSavedRequestsMock && input.path === '/api/ui/saved-requests') {
          const savedKey = '__ppDesktopMockSavedRequests';
          if (call.method === 'GET') {
            const entries = JSON.parse(window.localStorage.getItem(savedKey) || '[]');
            return { status: 200, body: { success: true, diagnostics: [], data: entries } };
          }
          if (call.method === 'PUT') {
            const inputBody = input.body && typeof input.body === 'object' ? (input.body as { entries?: unknown }) : {};
            const entries = Array.isArray(inputBody.entries) ? inputBody.entries : [];
            window.localStorage.setItem(savedKey, JSON.stringify(entries));
            return { status: 200, body: { success: true, diagnostics: [], data: entries } };
          }
        }
        const body = input.body && typeof input.body === 'object' ? (input.body as Record<string, unknown>) : {};
        const match = state.rules.find((rule) => {
          if (rule.path !== input.path) return false;
          if ((rule.method || 'GET').toUpperCase() !== call.method) return false;
          if (rule.bodyApi !== undefined && body.api !== rule.bodyApi) return false;
          if (rule.bodyPath !== undefined && body.path !== rule.bodyPath) return false;
          return true;
        });
        if (!match) return undefined;
        return { status: match.status ?? 200, body: match.body };
      }
    };
    window.ppDesktopTest = state;
  };
  await page.addInitScript(install, rules);
  await page.evaluate(install, rules);
}

export async function getDesktopApiCalls(page: Page): Promise<DesktopApiCall[]> {
  return page.evaluate(() => (window.ppDesktopTest as { calls?: DesktopApiCall[] } | undefined)?.calls ?? []);
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
    contentType: response.headers()['content-type'] ?? ''
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
