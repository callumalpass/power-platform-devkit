#!/usr/bin/env node

import process from 'node:process';
import { startPpMcpServer, type PpMcpServerOptions } from './mcp.js';

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const { server } = await startPpMcpServer(options);
  const keepAlive = setInterval(() => undefined, 2 ** 31 - 1);
  let sawInput = false;
  process.stdin.on('data', () => {
    sawInput = true;
  });
  process.stdin.resume();

  const shutdown = async () => {
    clearInterval(keepAlive);
    await server.close();
    process.exit(0);
  };

  process.stdin.on('end', () => {
    if (sawInput) void shutdown();
  });
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

function readOptions(args: string[]): PpMcpServerOptions {
  return {
    configDir: readFlag(args, '--config-dir'),
    credentialStore: readCredentialStore(args),
    allowInteractiveAuth: args.includes('--allow-interactive-auth'),
    toolNameStyle: readToolNameStyle(args)
  };
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readToolNameStyle(args: string[]): PpMcpServerOptions['toolNameStyle'] {
  const value = readFlag(args, '--tool-name-style');
  if (value === undefined) return undefined;
  if (value === 'dotted' || value === 'underscore') return value;
  throw new Error(`Invalid --tool-name-style value "${value}". Expected "dotted" or "underscore".`);
}

function readCredentialStore(args: string[]): PpMcpServerOptions['credentialStore'] {
  const value = readFlag(args, '--credential-store');
  if (value === undefined) return undefined;
  if (value === 'auto' || value === 'os' || value === 'file') return value;
  throw new Error(`Invalid --credential-store value "${value}". Expected "auto", "os", or "file".`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
