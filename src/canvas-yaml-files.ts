import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';

export type CanvasYamlFile = {
  path: string;
  content: string;
};

export function readCanvasYamlFetchFiles(value: unknown): CanvasYamlFile[] | undefined {
  const response = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  const files = Array.isArray(response?.files) ? response.files : undefined;
  return files
    ?.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === 'object'))
    .flatMap((file) => {
      const path = String(file.path ?? '');
      return path && typeof file.content === 'string' ? [{ path, content: file.content }] : [];
    });
}

export async function readCanvasYamlDirectory(rootDir: string): Promise<CanvasYamlFile[]> {
  const root = resolve(rootDir);
  const out: CanvasYamlFile[] = [];
  const visited = new Set<string>();

  async function visit(dir: string): Promise<void> {
    const realDir = await realpath(dir);
    if (visited.has(realDir)) return;
    visited.add(realDir);

    for (const entry of await readdir(dir)) {
      const fullPath = join(dir, entry);
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await visit(fullPath);
      } else if (/\.pa\.ya?ml$/i.test(entry)) {
        out.push({
          path: relative(root, fullPath).replace(/\\/g, '/'),
          content: await readFile(fullPath, 'utf8')
        });
      }
    }
  }

  await visit(root);
  return out;
}

export async function writeCanvasYamlFiles(rootDir: string, files: CanvasYamlFile[]): Promise<string[]> {
  const root = resolve(rootDir);
  await mkdir(root, { recursive: true });
  const rootReal = await realpath(root);
  const written: string[] = [];

  for (const file of files) {
    const target = resolveCanvasYamlOutputTarget(root, file.path);
    if (!target) continue;
    await mkdir(dirname(target), { recursive: true });
    if (!(await isSafeExistingFileTarget(target))) continue;
    if (!(await isSafeRealParent(rootReal, dirname(target)))) continue;
    await writeFile(target, file.content, 'utf8');
    written.push(file.path);
  }

  return written;
}

function resolveCanvasYamlOutputTarget(root: string, filePath: string): string | undefined {
  if (filePath.includes('\0') || filePath.includes('\\') || isAbsolute(filePath) || win32.isAbsolute(filePath) || filePath.split('/').some((part) => part === '..')) {
    return undefined;
  }

  const target = resolve(root, filePath);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return target;
}

async function isSafeExistingFileTarget(target: string): Promise<boolean> {
  try {
    const info = await lstat(target);
    return !info.isSymbolicLink();
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
  }
}

async function isSafeRealParent(rootReal: string, parentDir: string): Promise<boolean> {
  const parent = await realpath(parentDir);
  const rel = relative(rootReal, parent);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
