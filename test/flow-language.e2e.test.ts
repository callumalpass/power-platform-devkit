import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { analyzeFlow } from '../src/flow-language.js';

const execFileAsync = promisify(execFile);

function fixturePath(name: string): string {
  return path.resolve(process.cwd(), 'test/fixtures/flows', name);
}

async function readFixture(name: string): Promise<string> {
  return readFile(fixturePath(name), 'utf8');
}

async function findOpenPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('analyzeFlow understands a workflow definition wrapper from a real sample', async () => {
  const source = await readFixture('ratings-workflow.json');
  const result = analyzeFlow(source, source.indexOf("Get_records_that_haven"));
  assert.equal(result.summary.wrapperKind, 'definition-wrapper');
  assert.ok(result.summary.actionCount > 5);
  assert.ok(result.summary.variableCount >= 2);
  assert.ok(result.symbols.some((item) => item.kind === 'action' && item.name === 'For_each_record'));
  assert.ok(result.references.some((item) => item.kind === 'action' && item.name === 'Get_Blob_for_this_product'));
});

test('analyzeFlow extracts definitions from ARM template resources', async () => {
  const source = await readFixture('recurrence-template.json');
  const result = analyzeFlow(source, source.indexOf('ExecuteRecurrenceJob'));
  assert.equal(result.summary.wrapperKind, 'arm-template-resource-definition');
  assert.ok(result.summary.actionCount > 3);
  assert.ok(result.outline.length > 0);
});

test('analyzeFlow emits actionable diagnostics for broken references', async () => {
  const source = await readFixture('broken-power-automate-wrapper.json');
  const result = analyzeFlow(source, source.indexOf("DoesNotExist"));
  const codes = new Set(result.diagnostics.map((item) => item.code));
  assert.ok(codes.has('FLOW_REFERENCE_UNRESOLVED'));
  assert.ok(codes.has('FLOW_RUN_AFTER_TARGET_MISSING'));
});

test('pp flow validate returns a failing exit code for broken files', async () => {
  const cliEntry = path.resolve(process.cwd(), '.tmp-test/src/index.js');
  try {
    await execFileAsync('node', [cliEntry, 'flow', 'validate', fixturePath('broken-power-automate-wrapper.json')], { cwd: process.cwd() });
    assert.fail('expected validation command to fail');
  } catch (error) {
    const failure = error as { stdout?: string; code?: number };
    assert.equal(failure.code, 1);
    assert.match(failure.stdout ?? '', /FLOW_REFERENCE_UNRESOLVED/);
    assert.match(failure.stdout ?? '', /FLOW_RUN_AFTER_TARGET_MISSING/);
  }
});

test('pp flow inspect returns structured summary data for valid files', async () => {
  const cliEntry = path.resolve(process.cwd(), '.tmp-test/src/index.js');
  const { stdout } = await execFileAsync('node', [cliEntry, 'flow', 'inspect', fixturePath('ratings-workflow.json')], { cwd: process.cwd() });
  assert.match(stdout, /"outline"/);
  assert.match(stdout, /"summary"/);
  assert.match(stdout, /"actionCount"/);
});

test('pp ui serves flow language analysis over HTTP', async () => {
  const cliEntry = path.resolve(process.cwd(), '.tmp-test/src/index.js');
  const port = await findOpenPort();
  const child = spawn('node', [cliEntry, 'ui', '--no-open', '--port', String(port), '--no-interactive-auth'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  await waitFor(() => stdout.includes('pp UI listening at'), 10000, 'UI server did not start');

  const response = await fetch(`http://127.0.0.1:${port}/api/flow/language/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: await readFixture('broken-power-automate-wrapper.json'),
      cursor: 0,
    }),
  });

  const payload = await response.json() as { success: boolean; data?: { summary?: { wrapperKind?: string }, diagnostics?: Array<{ code: string }> } };
  child.kill('SIGTERM');
  await once(child, 'exit');

  assert.equal(response.status, 200, stderr || stdout);
  assert.equal(payload.success, true);
  assert.equal(payload.data?.summary?.wrapperKind, 'resource-properties-definition');
  assert.ok(payload.data?.diagnostics?.some((item) => item.code === 'FLOW_REFERENCE_UNRESOLVED'));
});

test('pp ui reuses an existing running instance for the same config', async () => {
  const cliEntry = path.resolve(process.cwd(), '.tmp-test/src/index.js');
  const port = await findOpenPort();
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'pp-ui-reuse-'));
  const first = spawn('node', [cliEntry, 'ui', '--no-open', '--port', String(port), '--config-dir', configDir, '--no-interactive-auth'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let firstStdout = '';
  first.stdout.on('data', (chunk) => { firstStdout += String(chunk); });
  await waitFor(() => firstStdout.includes('pp UI listening at'), 10000, 'Initial UI server did not start');

  const { stdout } = await execFileAsync('node', [cliEntry, 'ui', '--no-open', '--config-dir', configDir, '--no-interactive-auth'], { cwd: process.cwd() });
  assert.match(stdout, /pp UI already running at/);

  first.kill('SIGTERM');
  await once(first, 'exit');
  await rm(configDir, { recursive: true, force: true });
});

test('pp ui pairing blocks unpaired browsers and grants a session cookie', async () => {
  const cliEntry = path.resolve(process.cwd(), '.tmp-test/src/index.js');
  const port = await findOpenPort();
  const child = spawn('node', [cliEntry, 'ui', '--no-open', '--port', String(port), '--lan', '--pair', '--no-interactive-auth'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  try {
    await waitFor(() => stdout.includes('Pairing code:'), 10000, 'UI pairing code was not printed');
    assert.match(stdout, /LAN URL:/);
    const code = /Pairing code: (\d+)/.exec(stdout)?.[1];
    assert.ok(code, stdout);

    const blocked = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(blocked.status, 401, stderr || stdout);

    const paired = await fetch(`http://127.0.0.1:${port}/pair?code=${code}`, { redirect: 'manual' });
    assert.equal(paired.status, 302, stderr || stdout);
    const cookie = paired.headers.get('set-cookie');
    assert.match(cookie ?? '', /pp_ui_session=/);

    const allowed = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: cookie?.split(';')[0] ?? '' } });
    assert.equal(allowed.status, 200, stderr || stdout);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
});

async function waitFor(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
