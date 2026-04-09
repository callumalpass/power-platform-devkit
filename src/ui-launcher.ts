#!/usr/bin/env node

import process from 'node:process';
import { hasFlag, readFlag } from './cli-utils.js';
import { startPpUi } from './ui.js';

async function main(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('help')) {
    printHelp();
    return 0;
  }

  const portValue = readFlag(args, '--port');
  const port = portValue === undefined ? undefined : Number(portValue);
  if (portValue !== undefined && (!Number.isInteger(port) || Number(port) < 0 || Number(port) > 65535)) {
    process.stderr.write('Usage: pp-ui [--port PORT] [--no-open] [--config-dir DIR] [--no-interactive-auth]\n');
    return 1;
  }

  const ui = await startPpUi({
    configDir: readFlag(args, '--config-dir'),
    port,
    openBrowser: !hasFlag(args, '--no-open'),
    allowInteractiveAuth: !hasFlag(args, '--no-interactive-auth'),
  });

  if (ui.reused) return 0;

  const shutdown = async () => {
    await ui.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await new Promise<void>(() => undefined);
  return 0;
}

function printHelp(): void {
  process.stdout.write(
    [
      'pp-ui',
      '',
      'Ensure the pp browser UI is running, then open it.',
      '',
      'Usage:',
      '  pp-ui [--port PORT] [--no-open] [--config-dir DIR] [--no-interactive-auth]',
    ].join('\n') + '\n',
  );
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
