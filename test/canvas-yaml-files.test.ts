import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCanvasYamlDirectory, readCanvasYamlFetchFiles, writeCanvasYamlFiles } from '../src/canvas-yaml-files.js';

test('writeCanvasYamlFiles confines writes to the output directory', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pp-canvas-yaml-'));
  const outDir = join(base, 'out');
  const outsideDir = join(base, 'outside');
  await mkdir(outsideDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await symlink(outsideDir, join(outDir, 'linked'), 'dir');
  await writeFile(join(outsideDir, 'existing.pa.yaml'), 'outside', 'utf8');
  await symlink(join(outsideDir, 'existing.pa.yaml'), join(outDir, 'link-target.pa.yaml'));

  const written = await writeCanvasYamlFiles(outDir, [
    { path: 'good/App.pa.yaml', content: 'good' },
    { path: '../escape.pa.yaml', content: 'traversal' },
    { path: '..\\escape.pa.yaml', content: 'windows traversal' },
    { path: '/absolute.pa.yaml', content: 'absolute' },
    { path: 'C:/absolute.pa.yaml', content: 'windows absolute' },
    { path: 'linked/escape.pa.yaml', content: 'symlink parent' },
    { path: 'link-target.pa.yaml', content: 'symlink target' },
  ]);

  assert.deepEqual(written, ['good/App.pa.yaml']);
  assert.equal(await readFile(join(outDir, 'good/App.pa.yaml'), 'utf8'), 'good');
  assert.equal(await readFile(join(outsideDir, 'existing.pa.yaml'), 'utf8'), 'outside');
  await assert.rejects(access(join(base, 'escape.pa.yaml')));
  await assert.rejects(access(join(outsideDir, 'escape.pa.yaml')));
});

test('readCanvasYamlDirectory ignores symlink loops while collecting YAML files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pp-canvas-yaml-read-'));
  await mkdir(join(root, 'nested'), { recursive: true });
  await writeFile(join(root, 'App.pa.yaml'), 'app', 'utf8');
  await writeFile(join(root, 'nested', 'Screen1.pa.yaml'), 'screen', 'utf8');
  await writeFile(join(root, 'nested', 'notes.txt'), 'ignore', 'utf8');
  try {
    await symlink(root, join(root, 'nested', 'loop'), 'dir');
  } catch (error) {
    t.skip(`Symlink creation is not available: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const files = await readCanvasYamlDirectory(root);
  assert.deepEqual(
    files.sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'App.pa.yaml', content: 'app' },
      { path: 'nested/Screen1.pa.yaml', content: 'screen' },
    ],
  );
});

test('readCanvasYamlFetchFiles returns only file entries with paths and string content', () => {
  assert.deepEqual(readCanvasYamlFetchFiles({
    files: [
      { path: 'App.pa.yaml', content: 'app' },
      { path: '', content: 'empty path' },
      { path: 'MissingContent.pa.yaml' },
      null,
    ],
  }), [
    { path: 'App.pa.yaml', content: 'app' },
  ]);
  assert.equal(readCanvasYamlFetchFiles({ value: [] }), undefined);
});
