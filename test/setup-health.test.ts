import test from 'node:test';
import assert from 'node:assert/strict';
import { healthHint, isInteractiveAuthRequiredHealthEntry, summarizeAccessError, summarizeHealthFailure } from '../src/ui-react/setup/health.js';
import { ApiRequestError } from '../src/ui-react/utils.js';

test('summarizeHealthFailure treats auth-required detail as a concise login state', () => {
  const entry = summarizeHealthFailure({
    success: false,
    diagnostics: [
      {
        code: 'TOKEN_ACQUISITION_FAILED',
        message: 'Failed to acquire a token for work.',
        detail: 'Interactive authentication is disabled for account work.'
      }
    ]
  });

  assert.equal(entry.summary, 'Needs login for this API');
  assert.equal(entry.detail, '');
  assert.equal(isInteractiveAuthRequiredHealthEntry(entry), true);
  assert.equal(healthHint(entry), 'Sign in to this account, then re-check health.');
});

test('summarizeAccessError hides raw interactive-disabled diagnostics', () => {
  const error = new ApiRequestError(
    'Failed to acquire a token for work.',
    {
      diagnostics: [
        {
          message: 'Failed to acquire a token for work.',
          detail: 'Interactive authentication is disabled for account work.'
        }
      ]
    },
    200
  );

  assert.equal(summarizeAccessError(error), 'Sign in to the environment account before viewing access.');
});
