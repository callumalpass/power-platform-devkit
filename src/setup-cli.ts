import process from 'node:process';
import { startSetupServer, type RunningSetupServer, type SetupServerOptions } from './setup-server.js';

type SetupCliStreams = {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
};

export async function runSetupCli(args: string[], streams: SetupCliStreams = {}): Promise<number> {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;

  if (wantsHelp(args)) {
    printSetupHelp(stdout);
    return 0;
  }

  let options: SetupServerOptions;
  try {
    options = readSetupOptions(args, stderr);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    printSetupHelp(stderr);
    return 1;
  }

  let running: RunningSetupServer;
  try {
    running = await startSetupServer(options);
  } catch (error) {
    stderr.write(`Failed to start PP Setup Manager: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  stdout.write([
    `PP Setup Manager is running at ${running.url}`,
    'Use the Quit action in the browser or press Ctrl+C to stop it.',
    '',
  ].join('\n'));

  const shutdown = () => {
    void running.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await running.closed;
  process.off('SIGINT', shutdown);
  process.off('SIGTERM', shutdown);
  return 0;
}

export function printSetupHelp(stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(
    [
      'pp setup',
      '',
      'Open the browser-based PP Setup Manager.',
      '',
      'Usage:',
      '  pp setup [--config-dir DIR] [--port PORT] [--no-open] [--idle-timeout-ms MS]',
      '',
      'Options:',
      '  --config-dir DIR       Override config directory',
      '  --port PORT            Bind a specific localhost port instead of a random port',
      '  --no-open              Print the URL without opening a browser',
      '  --idle-timeout-ms MS   Stop after this many idle milliseconds (default: 1800000)',
      '',
      'Setup Manager binds to 127.0.0.1 and requires a random per-run token for API requests.',
    ].join('\n') + '\n',
  );
}

function readSetupOptions(args: string[], stderr: NodeJS.WritableStream): SetupServerOptions {
  return {
    configDir: readFlag(args, '--config-dir'),
    port: readOptionalInteger(args, '--port'),
    idleTimeoutMs: readOptionalInteger(args, '--idle-timeout-ms'),
    assetsDir: readFlag(args, '--assets-dir'),
    openBrowser: !hasFlag(args, '--no-open'),
    stderr,
  };
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function readOptionalInteger(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer.`);
  return number;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function wantsHelp(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h') || args[0] === 'help';
}
