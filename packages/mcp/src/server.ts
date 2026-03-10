#!/usr/bin/env node

import process from 'node:process';
import { startReadFirstMcpServer, type PpMcpServerOptions } from './index.js';

async function main(): Promise<void> {
  const options = readServerOptions(process.argv.slice(2));
  const { server } = await startReadFirstMcpServer(options);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

function readServerOptions(args: string[]): PpMcpServerOptions {
  return {
    configDir: readFlag(args, '--config-dir'),
    projectPath: readFlag(args, '--project'),
    allowInteractiveAuth: args.includes('--allow-interactive-auth'),
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
