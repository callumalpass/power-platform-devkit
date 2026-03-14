import { createDiagnostic, fail } from '@pp/diagnostics';
import type { CliOutputFormat } from './contract';
import * as cliHelp from './help';

interface ProjectHandlers {
  runProjectInit(args: string[]): Promise<number>;
  runProjectDoctor(args: string[]): Promise<number>;
  runProjectFeedback(args: string[]): Promise<number>;
  runProjectInspect(args: string[]): Promise<number>;
  runProjectSolutionPull(args: string[]): Promise<number>;
}

interface AnalysisHandlers {
  runAnalysisReport(args: string[]): Promise<number>;
  runAnalysisContext(args: string[]): Promise<number>;
  runAnalysisPortfolio(args: string[]): Promise<number>;
  runAnalysisDrift(args: string[]): Promise<number>;
  runAnalysisUsage(args: string[]): Promise<number>;
  runAnalysisPolicy(args: string[]): Promise<number>;
}

interface DeployHandlers {
  runDeployPlan(args: string[]): Promise<number>;
  runDeployApply(args: string[]): Promise<number>;
  runDeployRelease(args: string[]): Promise<number>;
}

interface DiagnosticsHandlers {
  runDiagnosticsDoctor(args: string[]): Promise<number>;
  runDiagnosticsBundle(args: string[]): Promise<number>;
}

interface SharePointHandlers {
  runSharePointSiteInspect(args: string[]): Promise<number>;
  runSharePointListInspect(args: string[]): Promise<number>;
  runSharePointFileInspect(args: string[]): Promise<number>;
  runSharePointPermissionsInspect(args: string[]): Promise<number>;
}

interface PowerBiHandlers {
  runPowerBiWorkspaceInspect(args: string[]): Promise<number>;
  runPowerBiDatasetInspect(args: string[]): Promise<number>;
  runPowerBiReportInspect(args: string[]): Promise<number>;
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
  runProjectGroup(
    command: string | undefined,
    args: string[],
    handlers: ProjectHandlers
  ): Promise<number>;
  runAnalysisGroup(
    command: string | undefined,
    args: string[],
    handlers: AnalysisHandlers
  ): Promise<number>;
  runDeployGroup(
    command: string | undefined,
    args: string[],
    handlers: DeployHandlers
  ): Promise<number>;
  runDiagnosticsGroup(
    command: string | undefined,
    args: string[],
    handlers: DiagnosticsHandlers
  ): Promise<number>;
  runSharePointGroup(
    command: string | undefined,
    args: string[],
    handlers: SharePointHandlers
  ): Promise<number>;
  runPowerBiGroup(
    command: string | undefined,
    args: string[],
    handlers: PowerBiHandlers
  ): Promise<number>;
}

export function createTopLevelCommandRunners(common: CommonCliDeps, groups: GroupDispatchDeps) {
  async function runProject(command: string | undefined, args: string[], handlers: ProjectHandlers): Promise<number> {
    return groups.runProjectGroup(command, args, handlers);
  }

  async function runAnalysis(command: string | undefined, args: string[], handlers: AnalysisHandlers): Promise<number> {
    return groups.runAnalysisGroup(command, args, handlers);
  }

  async function runDeploy(command: string | undefined, args: string[], handlers: DeployHandlers): Promise<number> {
    return groups.runDeployGroup(command, args, handlers);
  }

  async function runDiagnostics(command: string | undefined, args: string[], handlers: DiagnosticsHandlers): Promise<number> {
    return groups.runDiagnosticsGroup(command, args, handlers);
  }

  async function runSharePoint(command: string | undefined, args: string[], handlers: SharePointHandlers): Promise<number> {
    return groups.runSharePointGroup(command, args, handlers);
  }

  async function runPowerBi(command: string | undefined, args: string[], handlers: PowerBiHandlers): Promise<number> {
    return groups.runPowerBiGroup(command, args, handlers);
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
    runAnalysis,
    runCompletion,
    runDeploy,
    runDiagnostics,
    runPowerBi,
    runProject,
    runSharePoint,
    runVersion,
  };
}
