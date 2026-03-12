import type { OperationResult } from '@pp/diagnostics';
import { readOutputFormat, type CliOutputFormat } from './contract';
import * as cliHelp from './help';

export interface MainGroupHandlers {
  runVersion(args: string[]): Promise<number>;
  runCompletion(args: string[]): Promise<number>;
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

  if (group === 'diagnostics') {
    return handlers.runDiagnostics(command, rest);
  }

  if (group === 'init') {
    return handlers.runInit(command, rest);
  }

  const requestedFormat = readOutputFormat(normalizedArgv, 'json');

  if (!requestedFormat.success && !allowsCustomOutputFormat(normalizedArgv)) {
    return handlers.printFailureForInvalidFormat(requestedFormat);
  }

  switch (group) {
    case 'auth':
      return handlers.runAuth(command, rest);
    case 'env':
    case 'environment':
      return handlers.runEnvironment(command, rest);
    case 'dv':
      return handlers.runDataverse(command, rest);
    case 'solution':
      return handlers.runSolution(command, rest);
    case 'connref':
      return handlers.runConnectionReference(command, rest);
    case 'envvar':
      return handlers.runEnvironmentVariable(command, rest);
    case 'canvas':
      return handlers.runCanvas(command, rest);
    case 'flow':
      return handlers.runFlow(command, rest);
    case 'model':
      return handlers.runModel(command, rest);
    case 'project':
      return handlers.runProject(command, rest);
    case 'sharepoint':
      return handlers.runSharePoint(command, rest);
    case 'powerbi':
      return handlers.runPowerBi(command, rest);
    case 'analysis':
      return handlers.runAnalysis(command, rest);
    case 'deploy':
      return handlers.runDeploy(command, rest);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

function allowsCustomOutputFormat(argv: string[]): boolean {
  return argv[0] === 'dv' && argv[1] === 'metadata' && argv[2] === 'schema';
}
