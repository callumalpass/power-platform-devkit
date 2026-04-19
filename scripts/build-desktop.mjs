import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const desktopDir = path.join(distDir, 'desktop');

await mkdir(desktopDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'src/desktop/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(desktopDir, 'main.cjs'),
  external: ['electron'],
  logLevel: 'silent',
});

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'src/desktop/preload.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(desktopDir, 'preload.cjs'),
  external: ['electron'],
  logLevel: 'silent',
});

const rendererResult = await esbuild.build({
  entryPoints: [path.join(repoRoot, 'src/ui-react/main.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  sourcemap: false,
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
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
});

const rendererOutput = rendererResult.outputFiles?.[0]?.text;
if (!rendererOutput) throw new Error('No output generated for the Desktop renderer bundle.');

const monacoCssPath = path.join(repoRoot, 'node_modules/monaco-editor/min/vs/editor/editor.main.css');
const monacoCss = await readFile(monacoCssPath, 'utf8').catch(() => '');
const styleBoot = monacoCss
  ? `(()=>{const style=document.createElement("style");style.textContent=${JSON.stringify(monacoCss)};document.head.appendChild(style);})();\n`
  : '';
await writeFile(path.join(desktopDir, 'renderer.js'), `${styleBoot}${rendererOutput.trim()}\n`, 'utf8');

const htmlTemplatePath = path.join(desktopDir, '.html-template.mjs');
await esbuild.build({
  entryPoints: [path.join(repoRoot, 'src/ui-app.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: htmlTemplatePath,
  logLevel: 'silent',
});
const { renderHtml } = await import(pathToFileURL(htmlTemplatePath).href);
await writeFile(path.join(desktopDir, 'index.html'), renderHtml({ scriptSrc: './renderer.js' }), 'utf8');
await rm(htmlTemplatePath, { force: true });
