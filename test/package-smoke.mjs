import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);

const expectedRootExports = [
  'AuthService',
  'VERSION',
  'executeApiRequest',
  'listAccountSummaries',
];

const esm = await captureOutput(() => import('pp'));
assert.equal(esm.stdout, '');
assert.equal(esm.stderr, '');
assertRootExports(esm.value);

const cjs = await captureOutput(() => Promise.resolve(require('pp')));
assert.equal(cjs.stdout, '');
assert.equal(cjs.stderr, '');
assertRootExports(cjs.value);

const subpaths = [
  ['pp/api', 'executeApiRequest'],
  ['pp/auth', 'AuthService'],
  ['pp/config', 'loadConfig'],
  ['pp/dataverse', 'buildFetchXml'],
  ['pp/diagnostics', 'ok'],
  ['pp/environments', 'listConfiguredEnvironments'],
  ['pp/fetchxml-language', 'analyzeFetchXml'],
  ['pp/flow-language', 'analyzeFlow'],
  ['pp/request', 'buildRequest'],
  ['pp/experimental/canvas-authoring', 'startCanvasAuthoringSession'],
];

for (const [specifier, symbol] of subpaths) {
  const imported = await captureOutput(() => import(specifier));
  assert.equal(imported.stdout, '');
  assert.equal(imported.stderr, '');
  assert.equal(typeof imported.value[symbol], 'function', `${specifier} should export ${symbol}`);
  assert.equal(typeof require(specifier)[symbol], 'function', `${specifier} should be require-able`);
}

assert.equal(pkg.bin.pp, './dist/cli.cjs');
assert.equal(typeof require('pp').VERSION, 'string');

function assertRootExports(mod) {
  assert.deepEqual(
    expectedRootExports.map((name) => [name, typeof mod[name]]),
    expectedRootExports.map((name) => [name, name === 'VERSION' ? 'string' : 'function']),
  );
}

async function captureOutput(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = function write(chunk, ...args) {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = function write(chunk, ...args) {
    stderr += String(chunk);
    return true;
  };
  try {
    return { value: await fn(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
