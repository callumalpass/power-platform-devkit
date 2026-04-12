import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const distDir = path.join(repoRoot, 'dist');
const seaDir = path.join(repoRoot, 'dist', 'sea');

const platform = process.platform;
const arch = process.arch;
const ext = platform === 'win32' ? '.exe' : '';
const outputDir = path.join(repoRoot, 'release', `${platform}-${arch}`);
const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const entries = [
  { name: 'pp', main: path.join(distDir, 'index.cjs') },
  { name: 'pp-mcp', main: path.join(distDir, 'mcp-server.cjs') },
  { name: 'pp-ui', main: path.join(distDir, 'ui-launcher.cjs'), windowsSubsystem: 'gui' },
];

await mkdir(seaDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

// Re-bundle each entry with all dependencies inlined for SEA.
for (const entry of entries) {
  await esbuild.build({
    entryPoints: [entry.main],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(seaDir, `${entry.name}.cjs`),
    // Only keep true Node built-ins external.
    packages: 'bundle',
  });
}

for (const entry of entries) {
  const bundledMain = path.join(seaDir, `${entry.name}.cjs`);
  const configPath = path.join(outputDir, `${entry.name}.sea-config.json`);
  const blobPath = path.join(outputDir, `${entry.name}.blob`);
  const exePath = path.join(outputDir, `${entry.name}${ext}`);

  await writeFile(configPath, JSON.stringify({
    main: bundledMain,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  }, null, 2) + '\n', 'utf8');

  await run(process.execPath, ['--experimental-sea-config', configPath]);
  await copyFile(process.execPath, exePath);

  const postjectArgs = [
    postjectCliPath(), exePath, 'NODE_SEA_BLOB', blobPath,
    '--sentinel-fuse', sentinelFuse,
  ];
  if (platform === 'darwin') {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }
  await run(process.execPath, postjectArgs);

  if (platform === 'darwin') {
    await run('codesign', ['--sign', '-', '--force', exePath]);
  }
  if (platform === 'win32' && entry.windowsSubsystem === 'gui') {
    await setWindowsSubsystem(exePath, 2);
  }
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

async function setWindowsSubsystem(exePath, subsystem) {
  const buffer = await readFile(exePath);
  const peHeaderOffset = buffer.readUInt32LE(0x3c);
  const peSignature = buffer.toString('ascii', peHeaderOffset, peHeaderOffset + 4);
  if (peSignature !== 'PE\u0000\u0000') {
    throw new Error(`${exePath} is not a PE executable.`);
  }
  const optionalHeaderOffset = peHeaderOffset + 4 + 20;
  const subsystemOffset = optionalHeaderOffset + 68;
  buffer.writeUInt16LE(subsystem, subsystemOffset);
  await writeFile(exePath, buffer);
}
