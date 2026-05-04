import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCredentialStoreDir, type ConfigStoreOptions } from './config.js';
import { CredentialStoreUnavailableError, type CredentialStore } from './credential-store.js';

const DEFAULT_CREDENTIAL_STORE_COMMAND_TIMEOUT_MS = 10_000;

export function createWindowsDpapiCredentialStore(options: ConfigStoreOptions = {}, service = 'pp'): CredentialStore {
  return new WindowsDpapiCredentialStore(options, service);
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
    if (isWindowsDpapiUnreadableBlob(result)) {
      await rm(path, { force: true }).catch(() => undefined);
      return undefined;
    }
    throw commandFailure('Windows secure cache decrypt failed', result);
  }

  async set(key: string, value: string): Promise<void> {
    const result = await runPowerShell(WINDOWS_DPAPI_ENCRYPT_SCRIPT, value);
    if (result.status !== 0) throw commandFailure('Windows secure cache encrypt failed', result);
    const path = this.pathForKey(key);
    await mkdir(join(getCredentialStoreDir(this.options), 'secure-cache', this.service), { recursive: true, mode: 0o700 });
    await writeFile(path, result.stdout, { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathForKey(key), { force: true });
  }

  private pathForKey(key: string): string {
    return join(getCredentialStoreDir(this.options), 'secure-cache', this.service, `${encodeKey(key)}.blob`);
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

function commandFailure(prefix: string, result: CommandResult): Error {
  if (result.error?.code === 'ENOENT') return new CredentialStoreUnavailableError(`${prefix}: command not found.`);
  if (result.status === 124) return new CredentialStoreUnavailableError(`${prefix}: ${trimTrailingNewline(result.stderr) || 'command timed out.'}`);
  const detail = trimTrailingNewline(result.stderr || result.error?.message || `exit ${result.status}`);
  return new Error(detail ? `${prefix}: ${detail}` : prefix);
}

function isWindowsDpapiUnreadableBlob(result: CommandResult): boolean {
  return /CryptographicException|FromBase64String|Invalid length for a Base-64|not a valid Base-64|The parameter is incorrect|Key not valid for use in specified state/i.test(result.stderr);
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
