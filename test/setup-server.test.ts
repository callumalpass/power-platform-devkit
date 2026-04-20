import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSetupServer, type RunningSetupServer } from '../src/setup-server.js';

async function createAssetsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pp-setup-assets-'));
  await writeFile(join(dir, 'renderer.js'), 'window.__ppSetupAssetLoaded = true;\n', 'utf8');
  return dir;
}

async function startTestServer(): Promise<RunningSetupServer> {
  return startSetupServer({
    assetsDir: await createAssetsDir(),
    configDir: await mkdtemp(join(tmpdir(), 'pp-setup-config-')),
    openBrowser: false,
    idleTimeoutMs: 0,
  });
}

test('setup server serves setup-mode html and renderer asset', async (t) => {
  const running = await startTestServer();
  t.after(() => running.close());

  assert.equal(running.host, '127.0.0.1');
  assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/);

  const htmlResponse = await fetch(running.url);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /PP Setup Manager/);
  assert.match(html, /"mode":"setup"/);
  assert.match(html, /"setupToken":/);

  const assetResponse = await fetch(new URL('/assets/ui/app.js', running.url));
  assert.equal(assetResponse.status, 200);
  assert.equal(await assetResponse.text(), 'window.__ppSetupAssetLoaded = true;\n');
});

test('setup server rejects API calls without the per-run token', async (t) => {
  const running = await startTestServer();
  t.after(() => running.close());

  const response = await fetch(new URL('/api/app/status', running.url));
  assert.equal(response.status, 403);
  assert.match(await response.text(), /SETUP_TOKEN_REQUIRED/);
});

test('setup server routes authorized API calls through the shared app API', async (t) => {
  const running = await startTestServer();
  t.after(() => running.close());

  const response = await fetch(new URL('/api/app/status', running.url), {
    headers: { 'x-pp-setup-token': running.token },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.success, true);
  assert.equal(body.data.kind, 'pp-setup');
});
