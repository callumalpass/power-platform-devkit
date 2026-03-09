import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '@pp/artifacts';
import { expect } from 'vitest';

const UPDATE_GOLDENS = process.env.PP_UPDATE_GOLDENS === '1';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resolveRepoPath(...segments: string[]): string {
  return resolve(repoRoot, ...segments);
}

export function mapSnapshotStrings<T>(value: T, transform: (value: string) => string): T {
  if (typeof value === 'string') {
    return transform(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => mapSnapshotStrings(item, transform)) as T;
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, mapSnapshotStrings(nested, transform)])
    ) as T;
  }

  return value;
}

export async function expectGoldenJson(
  actual: unknown,
  relativePath: string,
  options: {
    normalize?: (value: unknown) => unknown;
  } = {}
): Promise<void> {
  const path = resolveRepoPath(relativePath);
  const normalized = (options.normalize ? options.normalize(actual) : actual) as Parameters<typeof stableStringify>[0];
  const rendered = stableStringify(normalized) + '\n';

  if (UPDATE_GOLDENS) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rendered, 'utf8');
  }

  expect(await readFile(path, 'utf8')).toBe(rendered);
}

export async function expectGoldenText(
  actual: string,
  relativePath: string,
  options: {
    normalize?: (value: string) => string;
  } = {}
): Promise<void> {
  const path = resolveRepoPath(relativePath);
  const normalized = options.normalize ? options.normalize(actual) : actual;
  const rendered = normalized.endsWith('\n') ? normalized : `${normalized}\n`;

  if (UPDATE_GOLDENS) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rendered, 'utf8');
  }

  expect(await readFile(path, 'utf8')).toBe(rendered);
}
