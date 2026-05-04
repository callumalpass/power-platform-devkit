#!/usr/bin/env node

import process from 'node:process';
import { createWindowsDpapiCredentialStore } from './windows-dpapi-store.js';

type SecureCacheRequest = {
  action?: unknown;
  service?: unknown;
  key?: unknown;
  value?: unknown;
  configDir?: unknown;
};

type SecureCacheResponse =
  | { ok: true; value?: string }
  | {
      ok: false;
      code?: string;
      error: string;
    };

void main().catch((error) => {
  writeResponse({
    ok: false,
    code: 'UNHANDLED',
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    writeResponse({ ok: false, code: 'UNSUPPORTED_PLATFORM', error: 'PP secure cache is only supported on Windows.' });
    process.exitCode = 1;
    return;
  }

  const request = readRequest(await readStdin());
  if (!request.ok) {
    writeResponse({ ok: false, code: 'INVALID_REQUEST', error: request.error });
    process.exitCode = 1;
    return;
  }

  const { action, service, key, value, configDir } = request.data;
  const store = createWindowsDpapiCredentialStore(configDir ? { configDir } : {}, service);

  try {
    if (action === 'status') {
      const probeKey = '__pp_secure_cache_probe__';
      const probeValue = `probe:${process.pid}:${Date.now()}`;
      let roundTrip: string | undefined;
      try {
        await store.set(probeKey, probeValue);
        roundTrip = await store.get(probeKey);
      } finally {
        await store.delete(probeKey).catch(() => undefined);
      }
      if (roundTrip !== probeValue) throw new Error('Secure cache probe did not round-trip.');
      writeResponse({ ok: true });
      return;
    }
    if (action === 'get') {
      const cached = await store.get(key);
      writeResponse(cached === undefined ? { ok: false, code: 'NOT_FOUND', error: 'Secure cache entry was not found.' } : { ok: true, value: cached });
      return;
    }
    if (action === 'set') {
      await store.set(key, value ?? '');
      writeResponse({ ok: true });
      return;
    }
    if (action === 'delete') {
      await store.delete(key);
      writeResponse({ ok: true });
      return;
    }
  } catch (error) {
    writeResponse({
      ok: false,
      code: 'SECURE_CACHE_FAILED',
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
    return;
  }

  writeResponse({ ok: false, code: 'INVALID_ACTION', error: `Unsupported secure cache action "${action}".` });
  process.exitCode = 1;
}

function readRequest(
  raw: string
): { ok: true; data: { action: 'status' | 'get' | 'set' | 'delete'; service: string; key: string; value?: string; configDir?: string } } | { ok: false; error: string } {
  let parsed: SecureCacheRequest;
  try {
    parsed = JSON.parse(raw) as SecureCacheRequest;
  } catch {
    return { ok: false, error: 'Request body must be JSON.' };
  }

  const action = parsed.action;
  const service = parsed.service;
  const key = parsed.key;
  const value = parsed.value;
  const configDir = parsed.configDir;

  if (action !== 'status' && action !== 'get' && action !== 'set' && action !== 'delete') return { ok: false, error: 'action must be status, get, set, or delete.' };
  if (typeof service !== 'string' || !service) return { ok: false, error: 'service must be a non-empty string.' };
  if (typeof key !== 'string') return { ok: false, error: 'key must be a string.' };
  if (action === 'set' && typeof value !== 'string') return { ok: false, error: 'set requires a string value.' };
  if (configDir !== undefined && typeof configDir !== 'string') return { ok: false, error: 'configDir must be a string.' };

  return {
    ok: true,
    data: {
      action,
      service,
      key,
      ...(typeof value === 'string' ? { value } : {}),
      ...(typeof configDir === 'string' ? { configDir } : {})
    }
  };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once('error', reject);
    process.stdin.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.resume();
  });
}

function writeResponse(response: SecureCacheResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

export { readRequest };
