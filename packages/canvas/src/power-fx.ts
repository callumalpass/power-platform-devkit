import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const parseCache = new Map<string, ParseResult>();
let bridgeReady = false;

export function parsePowerFxExpression(expression: string, options: { allowsSideEffects?: boolean } = {}): ParseResult {
  const cacheKey = `${options.allowsSideEffects ? '1' : '0'}:${expression}`;
  const cached = parseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    ensureBridgeBuilt();
    const response = invokeBridge(expression, options);
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
  }
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

function ensureBridgeBuilt(): void {
  if (bridgeReady && existsSync(getBridgeDllPath())) {
    return;
  }

  const projectPath = getBridgeProjectPath();
  const build = spawnSync('dotnet', ['build', projectPath, '-c', 'Release', '-nologo'], {
    encoding: 'utf8',
  });

  if (build.status !== 0) {
    throw new Error(build.stderr.trim() || build.stdout.trim() || 'Failed to build Power Fx bridge.');
  }

  bridgeReady = true;
}

function invokeBridge(expression: string, options: { allowsSideEffects?: boolean }): PowerFxBridgeResponse {
  const execution = spawnSync('dotnet', [getBridgeDllPath()], {
    input: JSON.stringify({
      expression,
      allowsSideEffects: Boolean(options.allowsSideEffects),
    }),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (execution.status !== 0) {
    throw new Error(execution.stderr.trim() || execution.stdout.trim() || 'Power Fx bridge execution failed.');
  }

  return JSON.parse(execution.stdout) as PowerFxBridgeResponse;
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
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}
