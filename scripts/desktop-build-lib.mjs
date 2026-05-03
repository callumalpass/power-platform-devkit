import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const NODE_NATIVE_EXTERNALS = ['@azure/msal-node-extensions'];

export function createDesktopBuildPaths(repoRoot) {
  const distDir = path.join(repoRoot, 'dist');
  const desktopDir = path.join(distDir, 'desktop');
  const setupDir = path.join(distDir, 'setup');
  return {
    repoRoot,
    distDir,
    desktopDir,
    setupDir,
    mainOutfile: path.join(desktopDir, 'main.cjs'),
    preloadOutfile: path.join(desktopDir, 'preload.cjs'),
    rendererOutfile: path.join(desktopDir, 'renderer.js'),
    setupRendererOutfile: path.join(setupDir, 'renderer.js'),
    htmlOutfile: path.join(desktopDir, 'index.html'),
    packageJsonOutfile: path.join(desktopDir, 'package.json'),
    htmlTemplateOutfile: path.join(desktopDir, '.html-template.mjs'),
    iconIcoSource: path.join(repoRoot, 'packaging', 'windows', 'assets', 'pp-icon.ico'),
    iconPngSource: path.join(repoRoot, 'packaging', 'windows', 'assets', 'pp-icon-256x256.png'),
    iconIcoOutfile: path.join(desktopDir, 'pp-icon.ico'),
    iconPngOutfile: path.join(desktopDir, 'pp-icon-256x256.png')
  };
}

export async function ensureDesktopDir(paths) {
  await mkdir(paths.desktopDir, { recursive: true });
  await mkdir(paths.setupDir, { recursive: true });
}

export function mainBuildOptions(paths, options = {}) {
  return {
    entryPoints: [path.join(paths.repoRoot, 'src/desktop/main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: paths.mainOutfile,
    external: ['electron', ...NODE_NATIVE_EXTERNALS],
    sourcemap: options.dev ? 'inline' : false,
    logLevel: 'silent',
    plugins: options.plugins
  };
}

export function preloadBuildOptions(paths, options = {}) {
  return {
    entryPoints: [path.join(paths.repoRoot, 'src/desktop/preload.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: paths.preloadOutfile,
    external: ['electron', ...NODE_NATIVE_EXTERNALS],
    sourcemap: options.dev ? 'inline' : false,
    logLevel: 'silent',
    plugins: options.plugins
  };
}

export function rendererBuildOptions(paths, options = {}) {
  return browserRendererBuildOptions(paths, path.join(paths.repoRoot, 'src/ui-react/main.tsx'), options);
}

export function setupRendererBuildOptions(paths, options = {}) {
  return browserRendererBuildOptions(paths, path.join(paths.repoRoot, 'src/ui-react/setup-main.tsx'), options);
}

function browserRendererBuildOptions(paths, entryPoint, options = {}) {
  return {
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    sourcemap: options.dev ? 'inline' : false,
    minify: !options.dev,
    define: {
      'process.env.NODE_ENV': options.dev ? '"development"' : '"production"'
    },
    alias: {
      'monaco-editor/esm/vs/editor/editor.api': 'monaco-editor/esm/vs/editor/editor.api.js',
      'monaco-editor/esm/vs/editor/common/commands/shiftCommand': 'monaco-editor/esm/vs/editor/common/commands/shiftCommand.js'
    },
    loader: {
      '.css': 'text',
      '.ttf': 'dataurl'
    },
    logLevel: 'silent',
    plugins: options.plugins
  };
}

export function htmlTemplateBuildOptions(paths, options = {}) {
  return {
    entryPoints: [path.join(paths.repoRoot, 'src/ui-app.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: paths.htmlTemplateOutfile,
    sourcemap: options.dev ? 'inline' : false,
    logLevel: 'silent',
    plugins: options.plugins
  };
}

export async function writeRendererBundle(paths, result, outfile = paths.rendererOutfile, options = {}) {
  const rendererOutput = result.outputFiles?.[0]?.text;
  if (!rendererOutput) throw new Error('No output generated for the Desktop renderer bundle.');
  const monacoCssPath = path.join(paths.repoRoot, 'node_modules/monaco-editor/min/vs/editor/editor.main.css');
  const monacoCss = options.includeMonacoCss === false ? '' : await readFile(monacoCssPath, 'utf8').catch(() => '');
  const styleBoot = monacoCss ? `(()=>{const style=document.createElement("style");style.textContent=${JSON.stringify(monacoCss)};document.head.appendChild(style);})();\n` : '';
  await writeFile(outfile, `${styleBoot}${rendererOutput.trim()}\n`, 'utf8');
}

export async function writeHtml(paths) {
  const { renderHtml } = await import(`${pathToFileURL(paths.htmlTemplateOutfile).href}?t=${Date.now()}`);
  await writeFile(paths.htmlOutfile, renderHtml({ scriptSrc: './renderer.js' }), 'utf8');
}

export async function writeDesktopPackage(paths) {
  const rootPackage = JSON.parse(await readFile(path.join(paths.repoRoot, 'package.json'), 'utf8'));
  await writeFile(
    paths.packageJsonOutfile,
    JSON.stringify(
      {
        name: 'pp-desktop',
        productName: 'PP Desktop',
        version: rootPackage.version,
        description: 'Desktop app for working with Microsoft Power Platform.',
        main: 'main.cjs',
        packageManager: 'traversal@0.0.0',
        author: rootPackage.author ?? 'pp',
        license: rootPackage.license,
        dependencies: {}
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
}

export async function copyDesktopIcons(paths) {
  await copyFile(paths.iconIcoSource, paths.iconIcoOutfile);
  await copyFile(paths.iconPngSource, paths.iconPngOutfile);
}

export async function copyDesktopRuntimePackages(paths) {
  const targetNodeModules = path.join(paths.desktopDir, 'node_modules');
  await rm(targetNodeModules, { recursive: true, force: true });

  const extensionPackageJson = require.resolve('@azure/msal-node-extensions/package.json');
  const extensionRequire = createRequire(extensionPackageJson);
  const keytarPackageJson = extensionRequire.resolve('keytar/package.json');
  await ensureKeytarNativePackage(keytarPackageJson);
  await copyNodePackage(paths, '@azure/msal-node-extensions', extensionPackageJson);
  await copyNodePackage(paths, '@azure/msal-node-runtime', extensionRequire.resolve('@azure/msal-node-runtime/package.json'));
  await copyNodePackage(paths, 'keytar', keytarPackageJson);
  assertNativePackageReadiness(paths);
}

async function copyNodePackage(paths, packageName, packageJsonPath) {
  const packageRoot = path.dirname(packageJsonPath);
  const target = path.join(paths.desktopDir, 'node_modules', ...packageName.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await cp(packageRoot, target, { recursive: true, dereference: true, force: true });
}

function assertNativePackageReadiness(paths) {
  if (process.platform !== 'win32') return;

  const keytarNode = path.join(paths.desktopDir, 'node_modules', 'keytar', 'build', 'Release', 'keytar.node');
  if (!existsSync(keytarNode)) {
    throw new Error('Windows desktop secure cache packaging requires keytar.node. Run pnpm approve-builds for keytar, then reinstall or rebuild dependencies.');
  }
}

async function ensureKeytarNativePackage(packageJsonPath) {
  if (process.platform !== 'win32') return;

  const packageRoot = path.dirname(packageJsonPath);
  const keytarNode = path.join(packageRoot, 'build', 'Release', 'keytar.node');
  if (existsSync(keytarNode)) return;

  await runNpmScript(packageRoot, 'install');

  if (!existsSync(keytarNode)) {
    throw new Error('Windows desktop secure cache packaging requires keytar.node, but keytar did not produce build/Release/keytar.node.');
  }
}

function runNpmScript(cwd, script) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', script], {
      cwd,
      stdio: 'inherit',
      shell: false
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${npmCommand} run ${script} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

export async function buildDesktop(paths, options = {}) {
  await ensureDesktopDir(paths);
  await esbuild.build(mainBuildOptions(paths, options));
  await esbuild.build(preloadBuildOptions(paths, options));
  await writeRendererBundle(paths, await esbuild.build(rendererBuildOptions(paths, options)));
  await writeRendererBundle(paths, await esbuild.build(setupRendererBuildOptions(paths, options)), paths.setupRendererOutfile, { includeMonacoCss: false });
  await esbuild.build(htmlTemplateBuildOptions(paths, options));
  await writeHtml(paths);
  await writeDesktopPackage(paths);
  await copyDesktopIcons(paths);
  await copyDesktopRuntimePackages(paths);
  await rm(paths.htmlTemplateOutfile, { force: true });
}
