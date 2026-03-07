import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function sortValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)])
    );
  }

  return value;
}

export function stableStringify(value: JsonValue, indentation = 2): string {
  return JSON.stringify(sortValue(value), null, indentation);
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function writeJsonFile(path: string, value: JsonValue, indentation = 2): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stableStringify(value, indentation) + '\n', 'utf8');
}

export function relativeSummary(path: string, hash: string): string {
  return `${path}#${hash.slice(0, 12)}`;
}
