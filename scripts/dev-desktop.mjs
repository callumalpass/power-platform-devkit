import { spawn } from 'node:child_process';
import { constants as fsConstants, accessSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import {
  buildDesktop,
  createDesktopBuildPaths,
  ensureDesktopDir,
  htmlTemplateBuildOptions,
  mainBuildOptions,
  preloadBuildOptions,
  rendererBuildOptions,
  writeHtml,
  writeRendererBundle,
} from './desktop-build-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const paths = createDesktopBuildPaths(repoRoot);
const reloadSignalPath = path.join(paths.desktopDir, '.reload');

let electronProcess;
let stoppingForRestart = false;
let shuttingDown = false;
let restartTimer;
let reloadTimer;
const contexts = [];

await buildDesktop(paths, { dev: true });
await writeFile(reloadSignalPath, '0\n', 'utf8');

await startWatchers();
startElectron();

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function startWatchers() {
  await ensureDesktopDir(paths);

  contexts.push(await watchContext('main', mainBuildOptions(paths, {
    dev: true,
    plugins: [onRebuild('main', scheduleElectronRestart)],
  })));
  contexts.push(await watchContext('preload', preloadBuildOptions(paths, {
    dev: true,
    plugins: [onRebuild('preload', scheduleElectronRestart)],
  })));
  contexts.push(await watchContext('renderer', rendererBuildOptions(paths, {
    dev: true,
    plugins: [onRebuild('renderer', async (result) => {
      await writeRendererBundle(paths, result);
      scheduleRendererReload();
    })],
  })));
  contexts.push(await watchContext('html', htmlTemplateBuildOptions(paths, {
    dev: true,
    plugins: [onRebuild('html', async () => {
      await writeHtml(paths);
      scheduleRendererReload();
    })],
  })));
}

async function watchContext(label, options) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log(`[desktop-dev] watching ${label}`);
  return context;
}

function onRebuild(label, callback) {
  let initialBuild = true;
  return {
    name: `desktop-dev-${label}`,
    setup(build) {
      build.onEnd((result) => {
        if (initialBuild) {
          initialBuild = false;
          return;
        }
        if (result.errors.length) {
          console.error(`[desktop-dev] ${label} rebuild failed`);
          return;
        }
        Promise.resolve(callback(result)).catch((error) => {
          console.error(`[desktop-dev] ${label} rebuild hook failed:`, error);
        });
      });
    },
  };
}

function startElectron() {
  const electronBin = resolveElectronBin();
  console.log('[desktop-dev] starting Electron');
  stoppingForRestart = false;
  electronProcess = spawn(electronBin, [paths.mainOutfile], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      PP_DESKTOP_DEV: '1',
      PP_DESKTOP_DEV_RELOAD_FILE: reloadSignalPath,
    },
  });

  electronProcess.on('exit', (code, signal) => {
    electronProcess = undefined;
    if (shuttingDown || stoppingForRestart) return;
    console.log(`[desktop-dev] Electron exited${signal ? ` by ${signal}` : ` with ${code ?? 0}`}`);
    void shutdown(code ?? 0);
  });
}

function scheduleElectronRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (shuttingDown) return;
    console.log('[desktop-dev] restarting Electron');
    if (!electronProcess) {
      startElectron();
      return;
    }
    stoppingForRestart = true;
    electronProcess.once('exit', () => {
      if (!shuttingDown) startElectron();
    });
    electronProcess.kill();
  }, 100);
}

function scheduleRendererReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    if (shuttingDown) return;
    console.log('[desktop-dev] reloading renderer');
    void writeFile(reloadSignalPath, `${Date.now()}\n`, 'utf8').catch((error) => {
      console.error('[desktop-dev] failed to signal renderer reload:', error);
    });
  }, 100);
}

function resolveElectronBin() {
  const localBin = process.platform === 'win32'
    ? path.join(repoRoot, 'node_modules/.bin/electron.cmd')
    : path.join(repoRoot, 'node_modules/.bin/electron');
  return localBinExists(localBin) ? localBin : 'electron';
}

function localBinExists(filePath) {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  clearTimeout(reloadTimer);
  for (const context of contexts) {
    await context.dispose().catch(() => undefined);
  }
  await rm(paths.htmlTemplateOutfile, { force: true }).catch(() => undefined);
  if (electronProcess) {
    electronProcess.kill();
  }
  process.exit(exitCode);
}
