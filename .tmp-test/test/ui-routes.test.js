import test from 'node:test';
import assert from 'node:assert/strict';
import { handleUiRequest } from '../src/ui-routes.js';
function createContext() {
    return {
        configOptions: {},
        allowInteractiveAuth: false,
        host: '127.0.0.1',
        port: 4733,
        jobs: {
            createJob() { throw new Error('not used'); },
            getJob() { return undefined; },
            cancelJob() { return undefined; },
        },
        fetchXmlCatalog: {
            analyze: async () => ({ diagnostics: [], completions: [], context: { from: 0, to: 0 } }),
        },
        sendVendorModule: async () => { throw new Error('not used'); },
    };
}
function createResponse() {
    const result = {
        statusCode: 0,
        headers: {},
        body: '',
        writeHead(statusCode, headers) {
            result.statusCode = statusCode;
            result.headers = headers;
            return result;
        },
        end(chunk) {
            result.body = chunk ?? '';
            return result;
        },
    };
    return result;
}
test('handleUiRequest serves client asset modules', async () => {
    const response = createResponse();
    await handleUiRequest({ method: 'GET', url: '/assets/ui/runtime.js' }, response, createContext());
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /export const els/);
});
test('handleUiRequest returns 404 for unknown routes', async () => {
    const response = createResponse();
    await handleUiRequest({ method: 'GET', url: '/api/unknown' }, response, createContext());
    assert.equal(response.statusCode, 404);
    assert.match(response.body, /NOT_FOUND/);
});
