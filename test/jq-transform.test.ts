import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJqTransform } from '../src/jq-transform.js';

test('applyJqTransform projects JSON with jq', async () => {
  const result = await applyJqTransform({ value: [{ name: 'Contoso', accountid: 'a1', ignored: true }] }, '.value | map({name, accountid})');
  assert.equal(result.success, true);
  assert.deepEqual(result.data, [{ name: 'Contoso', accountid: 'a1' }]);
});

test('applyJqTransform returns multiple jq outputs as an array', async () => {
  const result = await applyJqTransform({ value: [{ name: 'A' }, { name: 'B' }] }, '.value[] | {name}');
  assert.equal(result.success, true);
  assert.deepEqual(result.data, [{ name: 'A' }, { name: 'B' }]);
});

test('applyJqTransform reports jq expression errors', async () => {
  const result = await applyJqTransform({ value: [] }, '.value |');
  assert.equal(result.success, false);
  assert.equal(result.diagnostics[0]?.code, 'JQ_TRANSFORM_FAILED');
});
