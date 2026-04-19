import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

export function createDesktopBuildPaths(repoRoot) {
  const distDir = path.join(repoRoot, 'dist');
  const desktopDir = path.join(distDir, 'desktop');
  return {
    repoRoot,
    distDir,
    desktopDir,
    mainOutfile: path.join(desktopDir, 'main.cjs'),
    preloadOutfile: path.join(desktopDir, 'preload.cjs'),
    rendererOutfile: path.join(desktopDir, 'renderer.js'),
    htmlOutfile: path.join(desktopDir, 'index.html'),
    htmlTemplateOutfile: path.join(desktopDir, '.html-template.mjs'),
  };
}

export async function ensureDesktopDir(paths) {
  await mkdir(paths.desktopDir, { recursive: true });
}

export function mainBuildOptions(paths, options = {}) {
  return {
    entryPoints: [path.join(paths.repoRoot, 'src/desktop/main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: paths.mainOutfile,
    external: ['electron'],
    sourcemap: options.dev ? 'inline' : false,
    logLevel: 'silent',
    plugins: options.plugins,
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
    external: ['electron'],
    sourcemap: options.dev ? 'inline' : false,
    logLevel: 'silent',
    plugins: options.plugins,
  };
}

export function rendererBuildOptions(paths, options = {}) {
  return {
    entryPoints: [path.join(paths.repoRoot, 'src/ui-react/main.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    sourcemap: options.dev ? 'inline' : false,
    minify: !options.dev,
    define: {
      'process.env.NODE_ENV': options.dev ? '"development"' : '"production"',
    },
    alias: {
      'monaco-editor/esm/vs/editor/editor.api': 'monaco-editor/esm/vs/editor/editor.api.js',
      'monaco-editor/esm/vs/editor/common/commands/shiftCommand': 'monaco-editor/esm/vs/editor/common/commands/shiftCommand.js',
    },
    loader: {
      '.css': 'text',
      '.ttf': 'dataurl',
    },
    logLevel: 'silent',
    plugins: options.plugins,
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
    plugins: options.plugins,
  };
}

export async function writeRendererBundle(paths, result) {
  const rendererOutput = result.outputFiles?.[0]?.text;
  if (!rendererOutput) throw new Error('No output generated for the Desktop renderer bundle.');
  const monacoCssPath = path.join(paths.repoRoot, 'node_modules/monaco-editor/min/vs/editor/editor.main.css');
  const monacoCss = await readFile(monacoCssPath, 'utf8').catch(() => '');
  const styleBoot = monacoCss
    ? `(()=>{const style=document.createElement("style");style.textContent=${JSON.stringify(monacoCss)};document.head.appendChild(style);})();\n`
    : '';
  await writeFile(paths.rendererOutfile, `${styleBoot}${rendererOutput.trim()}\n`, 'utf8');
}

export async function writeHtml(paths) {
  const { renderHtml } = await import(`${pathToFileURL(paths.htmlTemplateOutfile).href}?t=${Date.now()}`);
  await writeFile(paths.htmlOutfile, renderHtml({ scriptSrc: './renderer.js' }), 'utf8');
}

export async function buildDesktop(paths, options = {}) {
  await ensureDesktopDir(paths);
  await esbuild.build(mainBuildOptions(paths, options));
  await esbuild.build(preloadBuildOptions(paths, options));
  await writeRendererBundle(paths, await esbuild.build(rendererBuildOptions(paths, options)));
  await esbuild.build(htmlTemplateBuildOptions(paths, options));
  await writeHtml(paths);
  await rm(paths.htmlTemplateOutfile, { force: true });
}
