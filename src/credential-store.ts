import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCredentialStoreDir, type ConfigStoreOptions } from './config.js';

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
  if (process.platform === 'win32') return new WindowsDpapiCredentialStore(options, service);
  return undefined;
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
    const result = await runCommand('secret-tool', ['lookup', 'service', this.service, 'account', key]);
    if (result.status === 0) return trimTrailingNewline(result.stdout);
    if (isSecretServiceUnavailable(result)) throw new CredentialStoreUnavailableError(secretServiceUnavailableMessage(result));
    return undefined;
  }

  async set(key: string, value: string): Promise<void> {
    const result = await runCommand('secret-tool', ['store', `--label=pp ${key}`, 'service', this.service, 'account', key], value);
    if (result.status === 0) return;
    if (isSecretServiceUnavailable(result)) throw new CredentialStoreUnavailableError(secretServiceUnavailableMessage(result));
    throw commandFailure('Secret Service write failed', result);
  }

  async delete(key: string): Promise<void> {
    const result = await runCommand('secret-tool', ['clear', 'service', this.service, 'account', key]);
    if (result.status === 0 || result.status === 1) return;
    if (isSecretServiceUnavailable(result)) throw new CredentialStoreUnavailableError(secretServiceUnavailableMessage(result));
    throw commandFailure('Secret Service delete failed', result);
  }
}

class WindowsDpapiCredentialStore implements CredentialStore {
  readonly kind = 'os' as const;

  constructor(
    private readonly options: ConfigStoreOptions,
    private readonly service: string
  ) {}

  async get(key: string): Promise<string | undefined> {
    const path = this.pathForKey(key);
    let encrypted: string;
    try {
      encrypted = await readFile(path, 'utf8');
    } catch {
      return undefined;
    }
    const result = await runPowerShell(WINDOWS_DPAPI_DECRYPT_SCRIPT, encrypted);
    if (result.status === 0) return result.stdout;
    throw commandFailure('Windows DPAPI decrypt failed', result);
  }

  async set(key: string, value: string): Promise<void> {
    const result = await runPowerShell(WINDOWS_DPAPI_ENCRYPT_SCRIPT, value);
    if (result.status !== 0) throw commandFailure('Windows DPAPI encrypt failed', result);
    const path = this.pathForKey(key);
    await mkdir(join(getCredentialStoreDir(this.options), 'dpapi', this.service), { recursive: true, mode: 0o700 });
    await writeFile(path, result.stdout, { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathForKey(key), { force: true });
  }

  private pathForKey(key: string): string {
    return join(getCredentialStoreDir(this.options), 'dpapi', this.service, `${encodeKey(key)}.blob`);
  }
}

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
};

function runPowerShell(script: string, input: string): Promise<CommandResult> {
  return runCommand(process.env.ComSpec ? 'powershell.exe' : 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], input);
}

function runCommand(command: string, args: string[], input?: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve({
        status: typeof error.errno === 'number' ? error.errno : 127,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        error
      });
    });
    child.on('close', (status) => {
      resolve({
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function commandFailure(prefix: string, result: CommandResult): Error {
  if (result.error?.code === 'ENOENT') return new CredentialStoreUnavailableError(`${prefix}: command not found.`);
  const detail = trimTrailingNewline(result.stderr || result.error?.message || `exit ${result.status}`);
  return new Error(detail ? `${prefix}: ${detail}` : prefix);
}

function isMacosNotFound(stderr: string): boolean {
  return /could not be found|The specified item could not be found/i.test(stderr);
}

function isSecretServiceUnavailable(result: CommandResult): boolean {
  if (result.error?.code === 'ENOENT') return true;
  return /org\.freedesktop\.secrets|Cannot autolaunch|No such interface|could not connect|command not found/i.test(result.stderr);
}

function secretServiceUnavailableMessage(result: CommandResult): string {
  if (result.error?.code === 'ENOENT') return 'Secret Service is unavailable because secret-tool is not installed.';
  return `Secret Service is unavailable: ${trimTrailingNewline(result.stderr) || `exit ${result.status}`}`;
}

function encodeKey(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

function trimTrailingNewline(value: string): string {
  return value.replace(/[\r\n]+$/, '');
}

const WINDOWS_DPAPI_ENCRYPT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const WINDOWS_DPAPI_DECRYPT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd().Trim()
$protected = [Convert]::FromBase64String($raw)
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
`;
