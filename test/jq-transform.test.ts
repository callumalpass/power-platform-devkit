import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJqTransform, normalizeJqTransform } from '../src/jq-transform.js';

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

test('applyJqTransform supports raw text output', async () => {
  const result = await applyJqTransform({ value: [{ name: 'A' }, { name: 'B' }] }, { expr: '.value[].name', raw: true });
  assert.equal(result.success, true);
  assert.equal(result.data, 'A\nB');
});

test('applyJqTransform enforces output limits', async () => {
  const result = await applyJqTransform({ value: ['abcdef'] }, { expr: '.value', maxOutputBytes: 4 });
  assert.equal(result.success, false);
  assert.equal(result.diagnostics[0]?.code, 'JQ_OUTPUT_TOO_LARGE');
});

test('normalizeJqTransform validates scope', () => {
  const result = normalizeJqTransform({ expr: '.', scope: 'invalid' as 'response' });
  assert.equal(result.success, false);
  assert.equal(result.diagnostics[0]?.code, 'JQ_SCOPE_INVALID');
});
