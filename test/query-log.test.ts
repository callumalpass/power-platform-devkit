import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAccount, saveEnvironment, saveQueryLogSettings, type Environment } from '../src/config.js';
import { flushQueryLogWrites, loadQueryLogEntries } from '../src/query-log.js';
import { executeApiRequest } from '../src/services/api.js';

const environment: Environment = {
  alias: 'dev',
  account: 'admin',
  url: 'https://org.crm.dynamics.com',
  makerEnvironmentId: 'maker-env-id',
  tenantId: 'tenant-id'
};

async function prepareConfig() {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-query-log-'));
  await saveAccount({ name: 'admin', kind: 'static-token', token: 'test-token' }, { configDir });
  await saveEnvironment(environment, { configDir });
  return configDir;
}

test('executeApiRequest logs request metadata without results by default', async () => {
  const configDir = await prepareConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ value: [{ name: 'Acme' }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  try {
    const result = await executeApiRequest(
      {
        environmentAlias: 'dev',
        api: 'dv',
        method: 'GET',
        path: '/accounts',
        query: { $top: '1', token: 'secret-value' },
        headers: { authorization: 'Bearer explicit', 'x-test': 'kept' },
        log: { source: 'cli' }
      },
      { configDir }
    );
    assert.equal(result.success, true);
    await flushQueryLogWrites();

    const entries = await loadQueryLogEntries({ configDir });
    assert.equal(entries.success, true);
    assert.equal(entries.data?.length, 1);
    const entry = entries.data?.[0];
    assert.equal(entry?.source, 'cli');
    assert.equal(entry?.method, 'GET');
    assert.equal(entry?.path, '/accounts');
    assert.equal(entry?.query?.$top, '1');
    assert.equal(entry?.query?.token, '[redacted]');
    assert.equal(entry?.headers?.authorization, '[redacted]');
    assert.equal(entry?.headers?.['x-test'], 'kept');
    assert.equal(entry?.status, 200);
    assert.equal(entry?.resultCaptured, false);
    assert.equal(entry?.responsePreview, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('query log captures redacted result previews only when requested', async () => {
  const configDir = await prepareConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ value: [{ name: 'Acme', secret: 'hidden' }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  try {
    const result = await executeApiRequest(
      {
        environmentAlias: 'dev',
        api: 'dv',
        method: 'GET',
        path: '/accounts',
        log: { source: 'cli', captureResults: true }
      },
      { configDir }
    );
    assert.equal(result.success, true);
    await flushQueryLogWrites();

    const entries = await loadQueryLogEntries({ configDir });
    const entry = entries.data?.[0];
    assert.equal(entry?.resultCaptured, true);
    assert.match(entry?.responsePreview?.text ?? '', /Acme/);
    assert.doesNotMatch(entry?.responsePreview?.text ?? '', /hidden/);
    assert.match(entry?.responsePreview?.text ?? '', /\[redacted\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('query log uses configured result and request body capture when request intent does not override it', async () => {
  const configDir = await prepareConfig();
  await saveQueryLogSettings({ captureResults: true, captureRequestBody: true }, { configDir });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ created: true, id: 'row-1' }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  try {
    const result = await executeApiRequest(
      {
        environmentAlias: 'dev',
        api: 'dv',
        method: 'POST',
        path: '/accounts',
        body: { name: 'Acme' },
        log: { source: 'desktop-console' }
      },
      { configDir }
    );
    assert.equal(result.success, true);
    await flushQueryLogWrites();

    const entries = await loadQueryLogEntries({ configDir });
    const entry = entries.data?.[0];
    assert.equal(entry?.source, 'desktop-console');
    assert.equal(entry?.resultCaptured, true);
    assert.match(entry?.responsePreview?.text ?? '', /created/);
    assert.equal(entry?.requestBodyCaptured, true);
    assert.match(entry?.requestBodyPreview?.text ?? '', /Acme/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('query log honors disabled settings and per-request overrides', async () => {
  const configDir = await prepareConfig();
  await saveQueryLogSettings({ enabled: false }, { configDir });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  try {
    await executeApiRequest({ environmentAlias: 'dev', api: 'dv', path: '/WhoAmI', log: { source: 'cli' } }, { configDir });
    await executeApiRequest({ environmentAlias: 'dev', api: 'dv', path: '/accounts', log: { source: 'cli', enabled: true } }, { configDir });
    await executeApiRequest({ environmentAlias: 'dev', api: 'dv', path: '/contacts', log: { source: 'cli', enabled: false } }, { configDir });
    await flushQueryLogWrites();

    const entries = await loadQueryLogEntries({ configDir });
    assert.equal(entries.success, true);
    assert.equal(entries.data?.length, 1);
    assert.equal(entries.data?.[0]?.path, '/accounts');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
