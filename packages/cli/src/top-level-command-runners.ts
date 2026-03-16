import { createDiagnostic, fail } from '@pp/diagnostics';
import type { CliOutputFormat } from './contract';
import * as cliHelp from './help';

interface DiagnosticsHandlers {
  runDiagnosticsDoctor(args: string[]): Promise<number>;
  runDiagnosticsBundle(args: string[]): Promise<number>;
}

interface CommonCliDeps {
  outputFormat(args: string[], fallback: CliOutputFormat): CliOutputFormat;
  positionalArgs(args: string[]): string[];
  printByFormat(value: unknown, format: CliOutputFormat): void;
  printFailure(result: ReturnType<typeof fail<CliOutputFormat>>): number;
  renderCompletionScript(shell: 'bash' | 'zsh' | 'fish' | 'pwsh'): string;
  cliPackageName: string;
  cliVersion: string;
}

interface GroupDispatchDeps {
  runDiagnosticsGroup(
    command: string | undefined,
    args: string[],
    handlers: DiagnosticsHandlers
  ): Promise<number>;
}

export function createTopLevelCommandRunners(common: CommonCliDeps, groups: GroupDispatchDeps) {
  async function runDiagnostics(command: string | undefined, args: string[], handlers: DiagnosticsHandlers): Promise<number> {
    return groups.runDiagnosticsGroup(command, args, handlers);
  }

  async function runVersion(args: string[]): Promise<number> {
    const format = common.outputFormat(args, 'json');
    const payload = {
      name: 'pp',
      packageName: common.cliPackageName,
      version: common.cliVersion,
    };

    if (format === 'raw') {
      process.stdout.write(`${common.cliVersion}\n`);
      return 0;
    }

    common.printByFormat(payload, format);
    return 0;
  }

  async function runCompletion(args: string[]): Promise<number> {
    const shell = common.positionalArgs(args)[0] as 'bash' | 'zsh' | 'fish' | 'pwsh' | undefined;

    if (!shell || args.includes('--help') || args.includes('help')) {
      cliHelp.printCompletionHelp();
      return shell ? 0 : 1;
    }

    if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish' && shell !== 'pwsh') {
      return common.printFailure(
        fail(
          createDiagnostic('error', 'COMPLETION_SHELL_UNSUPPORTED', `Unsupported completion shell ${shell}.`, {
            source: '@pp/cli',
            hint: 'Use one of: bash, zsh, fish, pwsh.',
          }),
          {
            suggestedNextActions: ['pp completion bash', 'pp completion zsh', 'pp completion fish', 'pp completion pwsh'],
          }
        )
      );
    }

    process.stdout.write(common.renderCompletionScript(shell));
    return 0;
  }

  return {
    runCompletion,
    runDiagnostics,
    runVersion,
  };
}
