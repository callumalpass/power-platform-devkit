import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSharePointAccountName } from '../src/ui-react/setup/ToolsPanel.js';
import type { AccountSummary, ShellState } from '../src/ui-react/ui-types.js';

test('defaultSharePointAccountName prefers the account attached to a configured environment', () => {
  const accounts: AccountSummary[] = [
    { name: 'student@example.com', kind: 'user', loginHint: 'student@example.com' },
    {
      name: 'work@example.com',
      kind: 'user',
      loginHint: 'work@example.com',
      accountUsername: 'work@example.com',
      tokenCacheKey: 'work@example.com'
    }
  ];
  const shellData = {
    environments: [{ alias: 'dev', account: 'work@example.com', url: 'https://example.crm.dynamics.com', makerEnvironmentId: 'env-1', tenantId: 'tenant-1' }]
  } as ShellState;

  assert.equal(defaultSharePointAccountName(accounts, shellData), 'work@example.com');
});

test('defaultSharePointAccountName falls back to an account with saved MSAL identity', () => {
  const accounts: AccountSummary[] = [
    { name: 'student@example.com', kind: 'user', loginHint: 'student@example.com' },
    { name: 'work@example.com', kind: 'user', accountUsername: 'work@example.com' }
  ];

  assert.equal(defaultSharePointAccountName(accounts, null), 'work@example.com');
});
