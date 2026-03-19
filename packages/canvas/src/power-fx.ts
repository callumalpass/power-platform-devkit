import { existsSync } from 'node:fs';
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { PowerFxAstNode } from './semantic-model';

interface ParseResult {
  ast?: PowerFxAstNode;
  valid: boolean;
  unsupportedReason?: string;
}

interface PowerFxBridgeResponse {
  success: boolean;
  ast?: PowerFxAstNode;
  errors?: string[];
}

interface PowerFxBridgeServerRequest {
  id: number;
  expression: string;
  allowsSideEffects: boolean;
}

interface PowerFxBridgeServerResponse extends PowerFxBridgeResponse {
  id: number;
}

const parseCache = new Map<string, ParseResult>();
const parseInflight = new Map<string, Promise<ParseResult>>();
let bridgeReady = false;
const POWER_FX_BRIDGE_TIMEOUT_MS = 5_000;
const POWER_FX_BUILD_TIMEOUT_MS = 60_000;

const dotnetEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  DOTNET_NOLOGO: '1',
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
};
let bridgeSession: PowerFxBridgeSession | undefined;
let bridgeCleanupRegistered = false;

export async function parsePowerFxExpression(expression: string, options: { allowsSideEffects?: boolean } = {}): Promise<ParseResult> {
  const cacheKey = `${options.allowsSideEffects ? '1' : '0'}:${expression}`;
  const cached = parseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inflight = parseInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const pending = (async (): Promise<ParseResult> => {
    try {
      ensureBridgeBuilt();
      const response = await invokeBridge(expression, options);
      const unsupportedReason = findUnsupportedReason(response.ast);
      const result: ParseResult = {
        ast: response.ast,
        valid: response.success && !unsupportedReason,
        unsupportedReason: !response.success
          ? response.errors?.[0] ?? 'Power Fx parsing failed.'
          : unsupportedReason,
      };
      parseCache.set(cacheKey, result);
      return result;
    } catch (error) {
      const result: ParseResult = {
        valid: false,
        unsupportedReason: error instanceof Error ? error.message : String(error),
      };
      parseCache.set(cacheKey, result);
      return result;
    } finally {
      parseInflight.delete(cacheKey);
    }
  })();

  parseInflight.set(cacheKey, pending);
  return pending;
}

export function visitPowerFxAst(node: PowerFxAstNode, visitor: (node: PowerFxAstNode, parent?: PowerFxAstNode) => void, parent?: PowerFxAstNode): void {
  visitor(node, parent);

  switch (node.kind) {
    case 'CallExpression':
      visitPowerFxAst(node.callee, visitor, node);
      node.arguments.forEach((argument) => visitPowerFxAst(argument, visitor, node));
      break;
    case 'MemberExpression':
      visitPowerFxAst(node.object, visitor, node);
      visitPowerFxAst(node.property, visitor, node);
      break;
    case 'RecordExpression':
      node.fields.forEach((field) => {
        visitPowerFxAst(field.name, visitor, node);
        visitPowerFxAst(field.value, visitor, node);
      });
      break;
    case 'BinaryExpression':
      visitPowerFxAst(node.left, visitor, node);
      visitPowerFxAst(node.right, visitor, node);
      break;
    case 'UnaryExpression':
      visitPowerFxAst(node.argument, visitor, node);
      break;
    case 'ChainExpression':
      node.expressions.forEach((expression) => visitPowerFxAst(expression, visitor, node));
      break;
    default:
      break;
  }
}

export function ensurePowerFxBridgeReady(): void {
  ensureBridgeBuilt();
}

function ensureBridgeBuilt(): void {
  if (bridgeReady && existsSync(getBridgeDllPath())) {
    return;
  }

  const projectPath = getBridgeProjectPath();
  const build = spawnSync('dotnet', ['build', projectPath, '-c', 'Release', '-nologo'], {
    encoding: 'utf8',
    timeout: POWER_FX_BUILD_TIMEOUT_MS,
    env: dotnetEnv,
  });

  if (build.signal === 'SIGTERM') {
    throw new Error(`Power Fx bridge build timed out after ${POWER_FX_BUILD_TIMEOUT_MS / 1_000}s. Check your .NET SDK installation and network connectivity.`);
  }

  if (build.status !== 0) {
    throw new Error(build.stderr.trim() || build.stdout.trim() || 'Failed to build Power Fx bridge.');
  }

  bridgeReady = true;
}

async function invokeBridge(expression: string, options: { allowsSideEffects?: boolean }): Promise<PowerFxBridgeResponse> {
  const session = getBridgeSession();
  return session.parse(expression, options);
}

function findUnsupportedReason(ast: PowerFxAstNode | undefined): string | undefined {
  if (!ast) {
    return undefined;
  }

  let reason: string | undefined;

  visitPowerFxAst(ast, (node) => {
    if (!reason && node.kind === 'UnsupportedExpression') {
      reason = node.reason;
    }
  });

  return reason;
}

function getBridgeProjectPath(): string {
  return join(getCanvasPackageRoot(), 'powerfx-bridge', 'PowerFxBridge.csproj');
}

function getBridgeDllPath(): string {
  return join(getCanvasPackageRoot(), 'powerfx-bridge', 'bin', 'Release', 'net10.0', 'PowerFxBridge.dll');
}

function getCanvasPackageRoot(): string {
  return join(dirname(__filename), '..');
}

function getBridgeSession(): PowerFxBridgeSession {
  if (!bridgeSession) {
    bridgeSession = new PowerFxBridgeSession(getBridgeDllPath());
  }

  if (!bridgeCleanupRegistered) {
    bridgeCleanupRegistered = true;
    process.once('exit', () => {
      bridgeSession?.dispose();
      bridgeSession = undefined;
    });
  }

  return bridgeSession;
}

class PowerFxBridgeSession {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private readonly pending = new Map<
    number,
    {
      resolve: (response: PowerFxBridgeResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(private readonly bridgeDllPath: string) {}

  async parse(expression: string, options: { allowsSideEffects?: boolean }): Promise<PowerFxBridgeResponse> {
    const child = this.ensureChild();
    const id = this.nextId++;

    return new Promise<PowerFxBridgeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.reset();
        reject(new Error(`Power Fx bridge timed out after ${POWER_FX_BRIDGE_TIMEOUT_MS}ms.`));
      }, POWER_FX_BRIDGE_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });

      const request: PowerFxBridgeServerRequest = {
        id,
        expression,
        allowsSideEffects: Boolean(options.allowsSideEffects),
      };
      const writeOk = child.stdin.write(`${JSON.stringify(request)}\n`, 'utf8');

      if (!writeOk) {
        child.stdin.once('drain', () => undefined);
      }
    });
  }

  dispose(): void {
    this.reset();
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return this.child;
    }

    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    const child = spawn('dotnet', [this.bridgeDllPath, '--server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: dotnetEnv,
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.unref();
    (child.stdin as NodeJS.WritableStream & { unref?(): void }).unref?.();
    (child.stdout as NodeJS.ReadableStream & { unref?(): void }).unref?.();
    (child.stderr as NodeJS.ReadableStream & { unref?(): void }).unref?.();
    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-8_192);
    });
    child.on('error', (error) => {
      this.failPending(new Error(`Power Fx bridge failed to start: ${error.message}`));
      this.child = undefined;
    });
    child.on('close', (code, signal) => {
      const detail = this.stderrBuffer.trim();
      const suffix = detail ? ` ${detail}` : '';
      this.failPending(new Error(`Power Fx bridge exited unexpectedly (${signal ?? code ?? 'unknown'}).${suffix}`));
      this.child = undefined;
    });

    this.child = child;
    return child;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        this.handleResponseLine(line);
      }

      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleResponseLine(line: string): void {
    let response: PowerFxBridgeServerResponse;

    try {
      response = JSON.parse(line) as PowerFxBridgeServerResponse;
    } catch (error) {
      this.failPending(new Error(`Power Fx bridge emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      this.reset();
      return;
    }

    const pending = this.pending.get(response.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    pending.resolve({
      success: response.success,
      ast: response.ast,
      errors: response.errors,
    });
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pending.clear();
  }

  private reset(): void {
    const child = this.child;
    this.child = undefined;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';

    if (child && child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  }
}
