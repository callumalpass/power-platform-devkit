import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiRequestInput, readDataverseQuerySpec, readEnvironmentInput, readFetchXmlSpec, readLoginInput } from '../src/ui-request-parsing.js';
test('readLoginInput validates required account fields', () => {
    const result = readLoginInput({});
    assert.equal(result.success, false);
    assert.equal(result.diagnostics[0]?.code, 'ACCOUNT_NAME_REQUIRED');
});
test('readEnvironmentInput parses valid environment payload', () => {
    const result = readEnvironmentInput({ alias: 'dev', url: 'https://example.crm.dynamics.com', account: 'me', accessMode: 'read-only' });
    assert.equal(result.success, true);
    assert.equal(result.data?.alias, 'dev');
    assert.equal(result.data?.accessMode, 'read-only');
});
test('readApiRequestInput derives read intent from method', () => {
    const getResult = readApiRequestInput({ environment: 'dev', path: '/WhoAmI', method: 'GET' }, true);
    assert.equal(getResult.success, true);
    assert.equal(getResult.data?.readIntent, true);
    const postResult = readApiRequestInput({ environment: 'dev', path: '/accounts', method: 'POST' }, true);
    assert.equal(postResult.success, true);
    assert.equal(postResult.data?.readIntent, false);
});
test('readDataverseQuerySpec accepts raw path without entity set name', () => {
    const result = readDataverseQuerySpec({ environmentAlias: 'dev', rawPath: '/accounts?$top=5' });
    assert.equal(result.success, true);
    assert.equal(result.data?.rawPath, '/accounts?$top=5');
});
test('readFetchXmlSpec requires entity or raw xml', () => {
    const result = readFetchXmlSpec({ environmentAlias: 'dev' });
    assert.equal(result.success, false);
    assert.equal(result.diagnostics[0]?.code, 'DV_FETCHXML_ENTITY_REQUIRED');
});
