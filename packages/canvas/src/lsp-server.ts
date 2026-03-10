#!/usr/bin/env node

import process from 'node:process';
import { CanvasLspSession, isJsonRpcError, type CanvasLspSessionOptions } from './lsp.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function main(): Promise<void> {
  const session = new CanvasLspSession({
    ...readOptions(process.argv.slice(2)),
    publishDiagnostics: async (params) => {
      writeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params,
      });
    },
  });

  let buffer = Buffer.alloc(0);

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    void drainBuffer();
  });

  async function drainBuffer(): Promise<void> {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');

      if (headerEnd < 0) {
        return;
      }

      const header = decoder.decode(buffer.subarray(0, headerEnd));
      const contentLength = readContentLength(header);

      if (contentLength === undefined) {
        buffer = Buffer.alloc(0);
        return;
      }

      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (buffer.length < bodyEnd) {
        return;
      }

      const payload = decoder.decode(buffer.subarray(bodyStart, bodyEnd));
      buffer = buffer.subarray(bodyEnd);
      await handleMessage(session, JSON.parse(payload) as JsonRpcRequest);
    }
  }
}

async function handleMessage(session: CanvasLspSession, message: JsonRpcRequest): Promise<void> {
  if (!message.method) {
    return;
  }

  if (message.id !== undefined) {
    try {
      const result = await session.handleRequest(message.method, message.params);
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result,
      });
    } catch (error) {
      const payload = isJsonRpcError(error)
        ? error
        : {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          };
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: payload,
      });
    }

    return;
  }

  await session.handleNotification(message.method, message.params);

  if (message.method === 'exit') {
    process.exit(0);
  }
}

function readContentLength(header: string): number | undefined {
  for (const line of header.split('\r\n')) {
    const separator = line.indexOf(':');

    if (separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === 'content-length') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }

  return undefined;
}

function writeMessage(message: unknown): void {
  const payload = encoder.encode(JSON.stringify(message));
  process.stdout.write(`Content-Length: ${payload.byteLength}\r\n\r\n`);
  process.stdout.write(payload);
}

function readOptions(args: string[]): CanvasLspSessionOptions {
  return {
    mode: readFlag(args, '--mode') as CanvasLspSessionOptions['mode'],
    projectPath: readFlag(args, '--project'),
    cacheDir: readFlag(args, '--cache-dir'),
    registries: readRepeatingFlag(args, '--registry'),
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readRepeatingFlag(args: string[], flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1]!);
      index += 1;
    }
  }

  return values;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
