import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetupChecklist, summarizeEnvironmentStatus } from '../src/ui-react/desktop-status.js';
import type { AccountSummary, EnvironmentSummary } from '../src/ui-react/ui-types.js';
import type { HealthMap, TokenStatusMap } from '../src/ui-react/setup/types.js';

const account: AccountSummary = { name: 'work', kind: 'user', accountUsername: 'work@example.com' };
const environment: EnvironmentSummary = { alias: 'dev', account: 'work', url: 'https://org.crm.dynamics.com', makerEnvironmentId: 'env-1', tenantId: 'tenant-1' };

test('summarizeEnvironmentStatus reports unauthenticated active account before API health', () => {
  const tokenStatus: TokenStatusMap = { work: { authenticated: false } };
  const health: HealthMap = {};

  const summary = summarizeEnvironmentStatus(environment, [account], tokenStatus, health);

  assert.equal(summary.level, 'error');
  assert.equal(summary.label, 'Sign in required');
  assert.equal(summary.issueCount, 5);
});

test('summarizeEnvironmentStatus counts failed API checks for a healthy token', () => {
  const tokenStatus: TokenStatusMap = { work: { authenticated: true } };
  const health: HealthMap = {
    dev: {
      dv: { status: 'ok', summary: 'Reachable' },
      flow: { status: 'error', summary: 'Permission or consent required' },
      graph: { status: 'ok', summary: 'Reachable' },
      bap: { status: 'ok', summary: 'Reachable' },
      powerapps: { status: 'ok', summary: 'Reachable' }
    }
  };

  const summary = summarizeEnvironmentStatus(environment, [account], tokenStatus, health);

  assert.equal(summary.level, 'error');
  assert.equal(summary.label, 'API issues');
  assert.equal(summary.issueCount, 1);
});

test('buildSetupChecklist gives direct recovery targets for setup gaps', () => {
  const checklist = buildSetupChecklist([account], [], {}, {});

  assert.deepEqual(
    checklist.map((item) => [item.key, item.level, item.action]),
    [
      ['accounts', 'ok', 'accounts'],
      ['tokens', 'warning', 'accounts'],
      ['environments', 'warning', 'environments'],
      ['health', 'unknown', 'environments']
    ]
  );
});
