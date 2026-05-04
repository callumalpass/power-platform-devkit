import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigDir, type ConfigStoreOptions } from './config.js';

const DEFAULT_CREDENTIAL_STORE_COMMAND_TIMEOUT_MS = 10_000;
const LINUX_SECRET_SERVICE_COMMAND_TIMEOUT_MS = 2_000;
const LINUX_SECRET_SERVICE_UNAVAILABLE_RETRY_MS = 30_000;

let linuxSecretServiceUnavailableUntil = 0;

export interface CredentialStore {
  readonly kind: 'os';
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class CredentialStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreUnavailableError';
  }
}

export function isCredentialStoreUnavailableError(error: unknown): boolean {
  return error instanceof CredentialStoreUnavailableError;
}

export function createOsCredentialStore(options: ConfigStoreOptions = {}, service = 'pp'): CredentialStore | undefined {
  if (process.platform === 'darwin') return new MacosKeychainCredentialStore(service);
  if (process.platform === 'linux') return new LinuxSecretServiceCredentialStore(service);
  if (process.platform === 'win32') return new WindowsSecureCacheHelperCredentialStore(options, service);
  return undefined;
}

export async function probeOsCredentialStore(options: ConfigStoreOptions = {}, service = 'pp'): Promise<boolean> {
  if (process.platform === 'win32') {
    const result = await runSecureCacheHelper(options, { action: 'status', service, key: '' });
    return result.status === 0 && readSecureCacheResponse(result).ok;
  }
  return Boolean(createOsCredentialStore(options, service));
}

class MacosKeychainCredentialStore implements CredentialStore {
  readonly kind = 'os' as const;

  constructor(private readonly service: string) {}

  async get(key: string): Promise<string | undefined> {
    const result = await runCommand('security', ['find-generic-password', '-s', this.service, '-a', key, '-w']);
    if (result.status === 0) return trimTrailingNewline(result.stdout);
    if (isMacosNotFound(result.stderr)) return undefined;
    throw commandFailure('macOS Keychain read failed', result);
  }

  async set(key: string, value: string): Promise<void> {
    const result = await runCommand('security', ['add-generic-password', '-s', this.service, '-a', key, '-w', value, '-U']);
    if (result.status === 0) return;
    throw commandFailure('macOS Keychain write failed', result);
  }

  async delete(key: string): Promise<void> {
    const result = await runCommand('security', ['delete-generic-password', '-s', this.service, '-a', key]);
    if (result.status === 0 || isMacosNotFound(result.stderr)) return;
    throw commandFailure('macOS Keychain delete failed', result);
  }
}

class LinuxSecretServiceCredentialStore implements CredentialStore {
  readonly kind = 'os' as const;

  constructor(private readonly service: string) {}

  async get(key: string): Promise<string | undefined> {
    assertLinuxSecretServiceAvailable();
    const result = await runCommand('secret-tool', ['lookup', 'service', this.service, 'account', key], undefined, LINUX_SECRET_SERVICE_COMMAND_TIMEOUT_MS);
    if (result.status === 0) return trimTrailingNewline(result.stdout);
    if (isSecretServiceUnavailable(result)) throw linuxSecretServiceUnavailable(result);
    return undefined;
  }

  async set(key: string, value: string): Promise<void> {
    assertLinuxSecretServiceAvailable();
    const result = await runCommand('secret-tool', ['store', `--label=pp ${key}`, 'service', this.service, 'account', key], value, LINUX_SECRET_SERVICE_COMMAND_TIMEOUT_MS);
    if (result.status === 0) return;
    if (isSecretServiceUnavailable(result)) throw linuxSecretServiceUnavailable(result);
    throw commandFailure('Secret Service write failed', result);
  }

  async delete(key: string): Promise<void> {
    assertLinuxSecretServiceAvailable();
    const result = await runCommand('secret-tool', ['clear', 'service', this.service, 'account', key], undefined, LINUX_SECRET_SERVICE_COMMAND_TIMEOUT_MS);
    if (result.status === 0 || result.status === 1) return;
    if (isSecretServiceUnavailable(result)) throw linuxSecretServiceUnavailable(result);
    throw commandFailure('Secret Service delete failed', result);
  }
}

class WindowsSecureCacheHelperCredentialStore implements CredentialStore {
  readonly kind = 'os' as const;

  constructor(
    private readonly options: ConfigStoreOptions,
    private readonly service: string
  ) {}

  async get(key: string): Promise<string | undefined> {
    const result = await runSecureCacheHelper(this.options, { action: 'get', service: this.service, key });
    const response = readSecureCacheResponse(result);
    if (response.ok) {
      if (result.status === 0) return response.value;
      throw secureCacheFailure('Windows secure cache read failed', result, response);
    }
    if (response.code === 'NOT_FOUND') return undefined;
    throw secureCacheFailure('Windows secure cache read failed', result, response);
  }

  async set(key: string, value: string): Promise<void> {
    const result = await runSecureCacheHelper(this.options, { action: 'set', service: this.service, key, value });
    const response = readSecureCacheResponse(result);
    if (response.ok) {
      if (result.status === 0) return;
      throw secureCacheFailure('Windows secure cache write failed', result, response);
    }
    throw secureCacheFailure('Windows secure cache write failed', result, response);
  }

  async delete(key: string): Promise<void> {
    const result = await runSecureCacheHelper(this.options, { action: 'delete', service: this.service, key });
    const response = readSecureCacheResponse(result);
    if (response.ok) {
      if (result.status === 0) return;
      throw secureCacheFailure('Windows secure cache delete failed', result, response);
    }
    throw secureCacheFailure('Windows secure cache delete failed', result, response);
  }
}

type SecureCacheRequest = {
  action: 'status' | 'get' | 'set' | 'delete';
  service: string;
  key: string;
  value?: string;
  configDir?: string;
};

type SecureCacheResponse =
  | { ok: true; value?: string }
  | {
      ok: false;
      code?: string;
      error: string;
    };

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
};

function runCommand(command: string, args: string[], input?: string, timeoutMs = DEFAULT_CREDENTIAL_STORE_COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        status: 124,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: `${command} timed out after ${timeoutMs}ms.`
      });
    }, timeoutMs);

    function finish(result: CommandResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        status: typeof error.errno === 'number' ? error.errno : 127,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        error
      });
    });
    child.on('close', (status) => {
      finish({
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function runSecureCacheHelper(options: ConfigStoreOptions, request: SecureCacheRequest): Promise<CommandResult> {
  const helperPath = resolveSecureCacheHelperPath();
  if (!helperPath) {
    return Promise.resolve({
      status: 127,
      stdout: '',
      stderr: 'PP secure cache add-on is not installed.'
    });
  }
  const input = JSON.stringify({
    ...request,
    configDir: getConfigDir(options)
  });
  return runCommand(helperPath, [], input);
}

function commandFailure(prefix: string, result: CommandResult): Error {
  if (result.error?.code === 'ENOENT') return new CredentialStoreUnavailableError(`${prefix}: command not found.`);
  if (result.status === 124) return new CredentialStoreUnavailableError(`${prefix}: ${trimTrailingNewline(result.stderr) || 'command timed out.'}`);
  const detail = trimTrailingNewline(result.stderr || result.error?.message || `exit ${result.status}`);
  return new Error(detail ? `${prefix}: ${detail}` : prefix);
}

function secureCacheFailure(prefix: string, result: CommandResult, response: SecureCacheResponse): Error {
  if (result.status === 127) return new CredentialStoreUnavailableError(`${prefix}: ${response.ok ? 'helper unavailable' : response.error || 'helper unavailable'}`);
  if (!response.ok && response.code === 'UNAVAILABLE') return new CredentialStoreUnavailableError(`${prefix}: ${response.error}`);
  if (result.status === 124) return new CredentialStoreUnavailableError(`${prefix}: ${trimTrailingNewline(result.stderr) || 'command timed out.'}`);
  const detail = !response.ok ? response.error : trimTrailingNewline(result.stderr || `exit ${result.status}`);
  return new Error(detail ? `${prefix}: ${detail}` : prefix);
}

function readSecureCacheResponse(result: CommandResult): SecureCacheResponse {
  if (result.status === 127 && !result.stdout) {
    return { ok: false, code: 'UNAVAILABLE', error: trimTrailingNewline(result.stderr) || 'PP secure cache add-on is not installed.' };
  }
  try {
    const parsed = JSON.parse(result.stdout) as Partial<SecureCacheResponse>;
    if (parsed.ok === true) return typeof parsed.value === 'string' ? { ok: true, value: parsed.value } : { ok: true };
    if (parsed.ok === false && typeof parsed.error === 'string') {
      return { ok: false, code: typeof parsed.code === 'string' ? parsed.code : undefined, error: parsed.error };
    }
  } catch {}
  return { ok: false, error: trimTrailingNewline(result.stderr || result.stdout || `secure cache helper exited with ${result.status}`) };
}

function isMacosNotFound(stderr: string): boolean {
  return /could not be found|The specified item could not be found/i.test(stderr);
}

function isSecretServiceUnavailable(result: CommandResult): boolean {
  if (result.status === 124) return true;
  if (result.error?.code === 'ENOENT') return true;
  return /org\.freedesktop\.secrets|Cannot autolaunch|No such interface|could not connect|command not found/i.test(result.stderr);
}

function secretServiceUnavailableMessage(result: CommandResult): string {
  if (result.error?.code === 'ENOENT') return 'Secret Service is unavailable because secret-tool is not installed.';
  if (result.status === 124) return `Secret Service is unavailable: ${trimTrailingNewline(result.stderr) || 'secret-tool timed out.'}`;
  return `Secret Service is unavailable: ${trimTrailingNewline(result.stderr) || `exit ${result.status}`}`;
}

function assertLinuxSecretServiceAvailable(): void {
  if (Date.now() < linuxSecretServiceUnavailableUntil) {
    throw new CredentialStoreUnavailableError('Secret Service is unavailable after a recent failed probe.');
  }
}

function linuxSecretServiceUnavailable(result: CommandResult): CredentialStoreUnavailableError {
  linuxSecretServiceUnavailableUntil = Date.now() + LINUX_SECRET_SERVICE_UNAVAILABLE_RETRY_MS;
  return new CredentialStoreUnavailableError(secretServiceUnavailableMessage(result));
}

function trimTrailingNewline(value: string): string {
  return value.replace(/[\r\n]+$/, '');
}

function resolveSecureCacheHelperPath(): string | undefined {
  const executable = process.platform === 'win32' ? 'pp-secure-cache.exe' : 'pp-secure-cache';
  const configured = process.env.PP_SECURE_CACHE_HELPER;
  if (configured && existsSync(configured)) return configured;
  const currentDir = dirname(process.execPath);
  const candidates = [
    join(currentDir, 'secure-cache', executable),
    join(dirname(currentDir), 'secure-cache', executable),
    join(currentDir, executable),
    ...(process.platform === 'win32' ? [process.env.ProgramFiles ? join(process.env.ProgramFiles, 'PP', 'secure-cache', executable) : undefined] : [])
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}
