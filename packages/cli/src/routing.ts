import type { OperationResult } from '@pp/diagnostics';
import { readOutputFormat, type CliOutputFormat } from './contract';
import { dispatchCommandRoute } from './command-dispatch';
import { resolveCommandPath } from './cli-command-spec';
import * as cliHelp from './help';

export interface MainGroupHandlers {
  runVersion(args: string[]): Promise<number>;
  runCompletion(args: string[]): Promise<number>;
  runMcp(command: string | undefined, args: string[]): Promise<number>;
  runDiagnostics(command: string | undefined, args: string[]): Promise<number>;
  runInit(command: string | undefined, args: string[]): Promise<number>;
  runAuth(command: string | undefined, args: string[]): Promise<number>;
  runEnvironment(command: string | undefined, args: string[]): Promise<number>;
  runDataverse(command: string | undefined, args: string[]): Promise<number>;
  runSolution(command: string | undefined, args: string[]): Promise<number>;
  runConnectionReference(command: string | undefined, args: string[]): Promise<number>;
  runEnvironmentVariable(command: string | undefined, args: string[]): Promise<number>;
  runCanvas(command: string | undefined, args: string[]): Promise<number>;
  runFlow(command: string | undefined, args: string[]): Promise<number>;
  runModel(command: string | undefined, args: string[]): Promise<number>;
  runProject(command: string | undefined, args: string[]): Promise<number>;
  runSharePoint(command: string | undefined, args: string[]): Promise<number>;
  runPowerBi(command: string | undefined, args: string[]): Promise<number>;
  runAnalysis(command: string | undefined, args: string[]): Promise<number>;
  runDeploy(command: string | undefined, args: string[]): Promise<number>;
  printFailureForInvalidFormat(result: OperationResult<CliOutputFormat>): number;
}

export function normalizeCliArgs(argv: string[]): string[] {
  if (argv[0] === '--') {
    return argv.slice(1);
  }

  return argv;
}

export async function dispatchMainCommand(argv: string[], handlers: MainGroupHandlers): Promise<number> {
  const normalizedArgv = normalizeCliArgs(argv);
  const [group, command, ...rest] = normalizedArgv;
  const resolved = resolveCommandPath(normalizedArgv);
  const canonicalGroup = resolved.path[0] ?? group;

  if (!group || group === 'help' || group === '--help') {
    cliHelp.printHelp();
    return 0;
  }

  if (group === 'version' || group === '--version') {
    return handlers.runVersion([command, ...rest].filter((value): value is string => value !== undefined));
  }

  if (group === 'completion') {
    return handlers.runCompletion([command, ...rest].filter((value): value is string => value !== undefined));
  }

  if (canonicalGroup === 'diagnostics') {
    return handlers.runDiagnostics(command, rest);
  }

  if (canonicalGroup === 'mcp') {
    return handlers.runMcp(command, rest);
  }

  if (canonicalGroup === 'init') {
    return handlers.runInit(command, rest);
  }

  const requestedFormat = readOutputFormat(normalizedArgv, 'json');

  if (!requestedFormat.success && !allowsCustomOutputFormat(normalizedArgv)) {
    return handlers.printFailureForInvalidFormat(requestedFormat);
  }

  return dispatchCommandRoute(
    {
      help: cliHelp.printHelp,
      children: [
        { name: 'auth', delegate: true, run: (args) => handlers.runAuth(args[0], args.slice(1)) },
        { name: 'env', aliases: ['environment'], delegate: true, run: (args) => handlers.runEnvironment(args[0], args.slice(1)) },
        { name: 'dv', delegate: true, run: (args) => handlers.runDataverse(args[0], args.slice(1)) },
        { name: 'solution', delegate: true, run: (args) => handlers.runSolution(args[0], args.slice(1)) },
        { name: 'connref', delegate: true, run: (args) => handlers.runConnectionReference(args[0], args.slice(1)) },
        { name: 'envvar', delegate: true, run: (args) => handlers.runEnvironmentVariable(args[0], args.slice(1)) },
        { name: 'canvas', delegate: true, run: (args) => handlers.runCanvas(args[0], args.slice(1)) },
        { name: 'flow', delegate: true, run: (args) => handlers.runFlow(args[0], args.slice(1)) },
        { name: 'model', delegate: true, run: (args) => handlers.runModel(args[0], args.slice(1)) },
        { name: 'project', delegate: true, run: (args) => handlers.runProject(args[0], args.slice(1)) },
        { name: 'sharepoint', delegate: true, run: (args) => handlers.runSharePoint(args[0], args.slice(1)) },
        { name: 'powerbi', delegate: true, run: (args) => handlers.runPowerBi(args[0], args.slice(1)) },
        { name: 'analysis', delegate: true, run: (args) => handlers.runAnalysis(args[0], args.slice(1)) },
        { name: 'deploy', delegate: true, run: (args) => handlers.runDeploy(args[0], args.slice(1)) },
      ],
    },
    [canonicalGroup, command, ...rest].filter((value): value is string => value !== undefined)
  );
}

function allowsCustomOutputFormat(argv: string[]): boolean {
  return argv[0] === 'dv' && argv[1] === 'metadata' && argv[2] === 'schema';
}
