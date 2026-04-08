import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createDiagnostic, fail } from './diagnostics.js';
import { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { sendJson } from './ui-http.js';
import { UiJobStore } from './ui-jobs.js';
import { handleUiRequest } from './ui-routes.js';

const moduleRequire: NodeJS.Require = (() => {
  try {
    return eval('require') as NodeJS.Require;
  } catch {
    const anchor = process.argv[1] ? path.resolve(process.argv[1]) : path.join(process.cwd(), '__pp_runtime__.js');
    return createRequire(anchor);
  }
})();

export interface PpUiOptions {
  configDir?: string;
  port?: number;
  openBrowser?: boolean;
  allowInteractiveAuth?: boolean;
}

export async function startPpUi(options: PpUiOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const configOptions = options.configDir ? { configDir: options.configDir } : {};
  const host = '127.0.0.1';
  const port = options.port ?? 4733;
  const allowInteractiveAuth = options.allowInteractiveAuth ?? true;
  const jobs = new UiJobStore();
  const fetchXmlCatalog = new FetchXmlMetadataCatalog();

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, {
        configOptions,
        allowInteractiveAuth,
        host,
        port,
        jobs,
        fetchXmlCatalog,
        sendVendorModule,
      });
    } catch (error) {
      sendJson(
        response,
        500,
        fail(
          createDiagnostic('error', 'UI_UNHANDLED_ERROR', error instanceof Error ? error.message : String(error), {
            source: 'pp/ui',
          }),
        ),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${resolvedPort}`;
  process.stdout.write(`pp UI listening at ${url}\n`);
  if (options.openBrowser !== false) openBrowser(url);

  return {
    url,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

interface RequestContext {
  configOptions: { configDir?: string };
  allowInteractiveAuth: boolean;
  host: string;
  port: number;
  jobs: UiJobStore;
  fetchXmlCatalog: FetchXmlMetadataCatalog;
  sendVendorModule: (response: ServerResponse, specifier: string) => Promise<void>;
}

async function handleRequest(request: Parameters<typeof handleUiRequest>[0], response: ServerResponse, context: RequestContext): Promise<void> {
  await handleUiRequest(request, response, context);
}

async function sendVendorModule(response: ServerResponse, specifier: string): Promise<void> {
  try {
    const resolved = await resolveVendorModulePath(specifier);
    if (resolved.redirect) {
      response.writeHead(302, { location: resolved.redirect, 'cache-control': 'public, max-age=3600' });
      response.end();
      return;
    }
    const source = await readFile(resolved.path, 'utf8');
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    response.end(source);
  } catch (error) {
    sendJson(
      response,
      404,
      fail(createDiagnostic('error', 'UI_VENDOR_MODULE_NOT_FOUND', `Could not resolve browser module ${specifier}.`, {
        source: 'pp/ui',
        detail: error instanceof Error ? error.message : String(error),
      })),
    );
  }
}

async function resolveVendorModulePath(specifier: string): Promise<{ path: string; redirect?: string }> {
  const { packageName, packageSubpath } = splitPackageSpecifier(specifier);
  const cjsEntryPath = moduleRequire.resolve(packageName);
  const packageRoot = derivePackageRoot(cjsEntryPath, packageName);
  if (!packageSubpath) {
    const relativeEntry = readBrowserEntryRelativePath(packageRoot, cjsEntryPath);
    return { path: path.join(packageRoot, relativeEntry), redirect: `/assets/vendor/${packageName}/${relativeEntry}` };
  }
  const resolvedPath = path.resolve(packageRoot, packageSubpath);
  const normalizedRoot = packageRoot.endsWith(path.sep) ? packageRoot : `${packageRoot}${path.sep}`;
  if (!(resolvedPath === packageRoot || resolvedPath.startsWith(normalizedRoot))) {
    throw new Error(`Rejected vendor path traversal for ${specifier}.`);
  }
  return { path: resolvedPath };
}

function splitPackageSpecifier(specifier: string): { packageName: string; packageSubpath: string } {
  const parts = specifier.split('/').filter(Boolean);
  if (!parts.length) throw new Error('Empty vendor specifier.');
  if (specifier.startsWith('@')) {
    return {
      packageName: parts.slice(0, 2).join('/'),
      packageSubpath: parts.slice(2).join('/'),
    };
  }
  return {
    packageName: parts[0],
    packageSubpath: parts.slice(1).join('/'),
  };
}

function derivePackageRoot(entryPath: string, packageName: string): string {
  const marker = `${path.sep}${packageName.split('/').join(path.sep)}${path.sep}`;
  const index = entryPath.lastIndexOf(marker);
  if (index < 0) throw new Error(`Could not derive package root for ${packageName}.`);
  return entryPath.slice(0, index + marker.length - 1);
}

function readBrowserEntryRelativePath(packageRoot: string, cjsEntryPath: string): string {
  const packageJson = moduleRequire(path.join(packageRoot, 'package.json')) as {
    exports?: string | { import?: string };
    module?: string;
  };
  const exportsField = packageJson.exports;
  if (typeof exportsField === 'string') return stripLeadingDotSlash(exportsField);
  if (exportsField && typeof exportsField.import === 'string') return stripLeadingDotSlash(exportsField.import);
  if (typeof packageJson.module === 'string') return stripLeadingDotSlash(packageJson.module);
  return path.relative(packageRoot, cjsEntryPath).split(path.sep).join('/');
}

function stripLeadingDotSlash(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // Best effort only.
  }
}
