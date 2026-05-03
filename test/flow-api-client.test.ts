import test from 'node:test';
import assert from 'node:assert/strict';
import { executeFlowUiRequest } from '../src/ui-react/automate/flow-api-client.js';

type DesktopRequest = { path: string; method?: string; body?: unknown };

test('executeFlowUiRequest wraps desktop request execution payloads consistently', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requests: DesktopRequest[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ppDesktopTest: {
        request(input: DesktopRequest) {
          requests.push(input);
          return { status: 200, body: { success: true, data: { response: { ok: true } } } };
        }
      }
    }
  });

  try {
    const result = await executeFlowUiRequest('dev', 'flow', '/flows/abc', false, 'POST', { enabled: true }, { 'api-version': '1' }, 'void');

    assert.deepEqual(result.response, { ok: true });
    assert.deepEqual(requests, [
      {
        path: '/api/request/execute',
        method: 'POST',
        body: {
          environment: 'dev',
          api: 'flow',
          method: 'POST',
          path: '/flows/abc',
          query: { 'api-version': '1' },
          allowInteractive: false,
          softFail: true,
          responseType: 'void',
          body: JSON.stringify({ enabled: true })
        }
      }
    ]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
