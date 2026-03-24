#!/usr/bin/env node

import process from 'node:process';
import { startPpMcpServer, type PpMcpServerOptions } from './mcp.js';

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const { server } = await startPpMcpServer(options);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

function readOptions(args: string[]): PpMcpServerOptions {
  return {
    configDir: readFlag(args, '--config-dir'),
    allowInteractiveAuth: args.includes('--allow-interactive-auth'),
  };
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
