import test from 'node:test';
import assert from 'node:assert/strict';
import { readJqTransform, readRequestQuery } from '../src/cli-utils.js';

test('readRequestQuery merges query-json with repeated query flags', () => {
  const result = readRequestQuery(['--query-json', '{"$select":"name,accountid","$top":50,"include":true}', '--query', '$top=10']);

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    $select: 'name,accountid',
    $top: '10',
    include: 'true'
  });
});

test('readRequestQuery rejects non-scalar query-json values', () => {
  const result = readRequestQuery(['--query-json', '{"$filter":{"statecode":0}}']);

  assert.equal(result.success, false);
  assert.equal(result.diagnostics[0]?.code, 'QUERY_JSON_VALUE_INVALID');
});

test('readJqTransform maps CLI parity flags to the structured jq object', () => {
  const result = readJqTransform(['--jq', '.response.value[].name', '--jq-raw', '--jq-scope', 'envelope', '--jq-timeout-ms', '2000', '--jq-max-output-bytes', '50000']);

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    expr: '.response.value[].name',
    raw: true,
    scope: 'envelope',
    timeoutMs: 2000,
    maxOutputBytes: 50000
  });
});

test('readJqTransform keeps simple --jq as a string', () => {
  const result = readJqTransform(['--jq', '.value[]']);

  assert.equal(result.success, true);
  assert.equal(result.data, '.value[]');
});

test('readJqTransform requires --jq when jq options are used', () => {
  const result = readJqTransform(['--jq-raw']);

  assert.equal(result.success, false);
  assert.equal(result.diagnostics[0]?.code, 'JQ_EXPRESSION_REQUIRED');
});
