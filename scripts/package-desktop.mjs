import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const desktopDir = path.join(repoRoot, 'dist', 'desktop');
const configOutfile = path.join(desktopDir, '.electron-builder.json');

await mkdir(desktopDir, { recursive: true });
await writeFile(configOutfile, JSON.stringify(await createConfig(), null, 2) + '\n', 'utf8');
await run(process.execPath, [require.resolve('electron-builder/cli.js'), '--dir', '--config', configOutfile], {
  cwd: desktopDir,
  env: {
    ...process.env,
    npm_config_user_agent: `npm/10.9.0 node/${process.versions.node}`,
    npm_execpath: ''
  }
});

async function createConfig() {
  const rootConfig = JSON.parse(await readFile(path.join(repoRoot, 'electron-builder.json'), 'utf8'));
  const config = {
    ...rootConfig,
    electronVersion: require('electron/package.json').version,
    directories: {
      output: relativeFromDesktop(path.join(repoRoot, 'release', 'electron'))
    }
  };
  delete config.extraMetadata;

  for (const platform of ['win', 'linux', 'mac']) {
    if (config[platform]?.icon) {
      config[platform] = {
        ...config[platform],
        icon: relativeFromDesktop(path.join(repoRoot, config[platform].icon))
      };
    }
  }

  return config;
}

function relativeFromDesktop(target) {
  return path.relative(desktopDir, target).replaceAll(path.sep, '/');
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
    });
  });
}
