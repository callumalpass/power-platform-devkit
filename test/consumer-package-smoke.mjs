import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const distIndex = join(repoRoot, 'dist', 'index.js');

if (!existsSync(distIndex)) {
  throw new Error('dist/index.js is missing. Run pnpm run build before test:package.');
}

const workRoot = join(repoRoot, '.tmp-test', 'consumer-package');
const packDir = join(workRoot, 'pack');
const consumerDir = join(workRoot, 'consumer');
const consumerNodeModules = join(consumerDir, 'node_modules');
const packJsonPath = join(workRoot, 'pack.json');

await mkdir(consumerNodeModules, { recursive: true });

const packed = JSON.parse(await readFile(packJsonPath, 'utf8'))[0];
assert.equal(packed.name, 'pp');
assert.equal(packed.version, packageJson.version);
assert.ok(packed.files.some((file) => file.path === 'dist/index.js'));
assert.ok(packed.files.some((file) => file.path === 'dist/cli.cjs'));
assert.ok(packed.files.some((file) => file.path === 'docs/library.md'));
assert.ok(packed.files.some((file) => file.path === 'docs/api-stability.md'));
assert.ok(packed.files.some((file) => file.path === 'LICENSE'));
assert.equal(packed.files.some((file) => file.path.startsWith('dist/desktop/')), false);
assert.ok(packed.unpackedSize < 3_500_000, `packed package is unexpectedly large: ${packed.unpackedSize}`);

const tar = await loadNpmTar();
await tar.x({ file: join(packDir, packed.filename), cwd: consumerNodeModules });
await rename(join(consumerNodeModules, 'package'), join(consumerNodeModules, 'pp'));
await linkDependencies(Object.keys(packageJson.dependencies ?? {}));
await linkDependencies(['@types/node']);

await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
  name: 'pp-consumer-smoke',
  private: true,
  type: 'module',
}, null, 2) + '\n');

await writeFile(join(consumerDir, 'esm.mjs'), `
import assert from 'node:assert/strict';
import { PpClient, ok } from 'pp';
import { buildRequest } from 'pp/request';
import { analyzeFlow } from 'pp/flow-language';

assert.equal(typeof PpClient, 'function');
const result = ok({ ready: true });
assert.equal(result.success, true);
assert.equal(result.data.ready, true);

const request = buildRequest(undefined, 'work', 'https://graph.microsoft.com/v1.0/me', 'graph');
assert.equal(request.success, true);
assert.equal(request.data.path, '/v1.0/me');

const analysis = analyzeFlow('{"definition":{"triggers":{},"actions":{}}}', 0);
assert.equal(analysis.summary.actionCount, 0);
`);

await writeFile(join(consumerDir, 'cjs.cjs'), `
const assert = require('node:assert/strict');
const { PpClient, ok } = require('pp');
const { buildRequest } = require('pp/request');

assert.equal(typeof PpClient, 'function');
const result = ok('ready');
assert.equal(result.success, true);
assert.equal(result.data, 'ready');

const request = buildRequest(undefined, 'work', 'https://graph.microsoft.com/v1.0/me', 'graph');
assert.equal(request.success, true);
assert.equal(request.data.path, '/v1.0/me');
`);

await writeFile(join(consumerDir, 'types-esm.mts'), `
import { PpClient, ok, type OperationResult } from 'pp';
import { buildRequest, type RequestInput } from 'pp/request';
import { analyzeFetchXml } from 'pp/fetchxml-language';

const client = new PpClient({ configDir: '.pp' });
const pending = client.request<{ value: Array<{ name?: string }> }>({
  env: 'dev',
  api: 'dv',
  path: '/accounts',
  readIntent: true,
  tokenProviderOverride: { getAccessToken: async () => 'token' },
});

const requestInput: RequestInput = { accountName: 'work', api: 'graph', path: '/me' };
const prepared = buildRequest(undefined, 'work', 'https://graph.microsoft.com/v1.0/me', 'graph');
const fetchXml = analyzeFetchXml('<fetch><entity name="account" /></fetch>');
const narrowed: OperationResult<{ name: string }> = ok({ name: 'Contoso' });

if (narrowed.success) {
  const name: string = narrowed.data.name;
}

void pending;
void requestInput;
void prepared;
void fetchXml;
`);

await writeFile(join(consumerDir, 'types-cjs.cts'), `
import pp = require('pp');
import request = require('pp/request');

const client = new pp.PpClient();
const result = pp.ok(123);

if (result.success) {
  const value: number = result.data;
}

const prepared = request.buildRequest(undefined, 'work', 'https://graph.microsoft.com/v1.0/me', 'graph');
void client;
void prepared;
`);

await writeFile(join(consumerDir, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['node'],
  },
  include: ['types-esm.mts', 'types-cjs.cts'],
}, null, 2) + '\n');

assert.deepEqual(await captureOutput(() => import(pathToFileURL(join(consumerDir, 'esm.mjs')).href)), {
  stdout: '',
  stderr: '',
});

const requireFromConsumer = createRequire(join(consumerDir, 'cjs.cjs'));
assert.deepEqual(await captureOutput(() => Promise.resolve(requireFromConsumer('./cjs.cjs'))), {
  stdout: '',
  stderr: '',
});

await assertCliVersion();
await assertTypesCompile();

async function assertCliVersion() {
  const cliPath = join(consumerNodeModules, 'pp', packageJson.bin.pp);
  const oldArgv = process.argv;
  const oldExitCode = process.exitCode;
  try {
    const output = await captureOutput(async () => {
      process.argv = [process.execPath, cliPath, 'version'];
      process.exitCode = undefined;
      await import(pathToFileURL(cliPath).href);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(process.exitCode, 0);
    });
    assert.deepEqual(output, {
      stdout: `pp ${packageJson.version}\n`,
      stderr: '',
    });
  } finally {
    process.argv = oldArgv;
    process.exitCode = oldExitCode;
  }
}

async function assertTypesCompile() {
  const tsModule = await import(pathToFileURL(join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')).href);
  const ts = tsModule.default ?? tsModule;
  const configPath = join(consumerDir, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined, config.error ? ts.formatDiagnosticsWithColorAndContext([config.error], formatHost(ts)) : '');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, consumerDir);
  assert.deepEqual(parsed.errors, [], ts.formatDiagnosticsWithColorAndContext(parsed.errors, formatHost(ts)));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics, [], ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost(ts)));
}

async function linkDependencies(names) {
  for (const name of names) {
    const source = join(repoRoot, 'node_modules', name);
    if (!existsSync(source)) throw new Error(`Missing dependency in repo node_modules: ${name}`);
    const target = join(consumerNodeModules, name);
    await mkdir(dirname(target), { recursive: true });
    await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

async function loadNpmTar() {
  const tarPath = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'node_modules', 'tar', 'index.js');
  if (!existsSync(tarPath)) throw new Error(`Could not find npm tar library at ${tarPath}`);
  const module = await import(pathToFileURL(tarPath).href);
  return module.default ?? module;
}

async function captureOutput(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = function write(chunk) {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = function write(chunk) {
    stderr += String(chunk);
    return true;
  };
  try {
    await fn();
    return { stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function formatHost(ts) {
  return {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => consumerDir,
    getNewLine: () => ts.sys.newLine,
  };
}
