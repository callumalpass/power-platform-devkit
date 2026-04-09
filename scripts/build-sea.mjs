import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const distDir = path.join(repoRoot, 'dist');
const outputDir = path.join(repoRoot, 'release', 'win32-x64');
const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const entries = [
  { name: 'pp', main: path.join(distDir, 'index.cjs') },
  { name: 'pp-mcp', main: path.join(distDir, 'mcp-server.cjs') },
  { name: 'pp-ui', main: path.join(distDir, 'ui-launcher.cjs') },
];

if (process.platform !== 'win32') {
  throw new Error('SEA builds are currently supported from a Windows host only. Run this script in Windows CI or on a Windows machine.');
}

await mkdir(outputDir, { recursive: true });

for (const entry of entries) {
  const configPath = path.join(outputDir, `${entry.name}.sea-config.json`);
  const blobPath = path.join(outputDir, `${entry.name}.blob`);
  const exePath = path.join(outputDir, `${entry.name}.exe`);

  await writeFile(configPath, JSON.stringify({
    main: entry.main,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  }, null, 2) + '\n', 'utf8');

  await run(process.execPath, ['--experimental-sea-config', configPath]);
  await copyFile(process.execPath, exePath);
  await run(process.execPath, [postjectCliPath(), exePath, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', sentinelFuse]);
}

function postjectCliPath() {
  const packageJsonPath = require.resolve('postject/package.json');
  return path.join(path.dirname(packageJsonPath), 'dist', 'cli.js');
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
    });
  });
}
