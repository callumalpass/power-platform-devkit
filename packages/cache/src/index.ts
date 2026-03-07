import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CacheEntry<T> {
  value: T;
  writtenAt: string;
}

export class FileCache {
  constructor(private readonly cacheDir: string) {}

  private resolveKey(key: string): string {
    return join(this.cacheDir, `${key.replaceAll(/[\\/]/g, '__')}.json`);
  }

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      return JSON.parse(await readFile(this.resolveKey(key), 'utf8')) as CacheEntry<T>;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<CacheEntry<T>> {
    const entry: CacheEntry<T> = {
      value,
      writtenAt: new Date().toISOString(),
    };

    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.resolveKey(key), JSON.stringify(entry, null, 2) + '\n', 'utf8');
    return entry;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async clear(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
  }
}
