import { resolve as resolvePath } from 'node:path';
import {
  generateContextPack,
  generatePortfolioReport,
  renderMarkdownPortfolioReport,
  renderMarkdownReport,
} from '@pp/analysis';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { discoverProject, type ProjectContext } from '@pp/project';
import type { CliOutputFormat } from './contract';

type OutputFormat = CliOutputFormat;
type AnalysisView = 'drift' | 'usage' | 'policy';
type DiscoveryOptions = { stage?: string; parameterOverrides?: Record<string, string> };

interface AnalysisCommandDependencies {
  positionalArgs(args: string[]): string[];
  resolveDefaultInvocationPath(): string;
  outputFormat(args: string[], fallback: OutputFormat): OutputFormat;
  readProjectDiscoveryOptions(args: string[]): OperationResult<DiscoveryOptions>;
  printFailure(result: OperationResult<unknown>): number;
  printByFormat(value: unknown, format: OutputFormat): void;
  printResultDiagnostics(result: OperationResult<unknown>, format: OutputFormat): void;
  readFlag(args: string[], name: string): string | undefined;
  readRepeatedFlags(args: string[], name: string): string[];
  readAnalysisPortfolioProjectPaths(args: string[]): string[];
}

export async function runAnalysisReportCommand(args: string[], deps: AnalysisCommandDependencies): Promise<number> {
  const path = deps.positionalArgs(args)[0] ?? deps.resolveDefaultInvocationPath();
  const format = deps.outputFormat(args, 'markdown');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const project = await discoverProject(path, discoveryOptions.data);

  if (!project.success || !project.data) {
    return deps.printFailure(project);
  }

  if (format === 'markdown') {
    process.stdout.write(renderMarkdownReport(project.data) + '\n');
    deps.printResultDiagnostics(project, format);
    return 0;
  }

  const context = generateContextPack(project.data);

  if (!context.success || !context.data) {
    return deps.printFailure(context);
  }

  deps.printByFormat(context.data, format);
  deps.printResultDiagnostics(project, format);
  deps.printResultDiagnostics(context, format);
  return 0;
}

export async function runAnalysisContextCommand(args: string[], deps: AnalysisCommandDependencies): Promise<number> {
  const projectPath = deps.readFlag(args, '--project') ?? deps.resolveDefaultInvocationPath();
  const asset = deps.readFlag(args, '--asset');
  const format = deps.outputFormat(args, 'json');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return deps.printFailure(project);
  }

  const context = generateContextPack(project.data, asset);

  if (!context.success || !context.data) {
    return deps.printFailure(context);
  }

  deps.printByFormat(context.data, format);
  deps.printResultDiagnostics(project, format);
  deps.printResultDiagnostics(context, format);
  return 0;
}

export async function runAnalysisPortfolioCommand(args: string[], deps: AnalysisCommandDependencies): Promise<number> {
  const format = deps.outputFormat(args, 'json');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const projects = await discoverAnalysisPortfolioProjects(args, discoveryOptions.data, deps);

  if (!projects.success || !projects.data) {
    return deps.printFailure(projects);
  }

  const report = generatePortfolioReport(projects.data, {
    focusAsset: deps.readFlag(args, '--asset'),
    allowedProviderKinds: deps.readRepeatedFlags(args, '--allow-provider-kind'),
  });

  if (!report.success || !report.data) {
    return deps.printFailure(report);
  }

  if (format === 'markdown') {
    process.stdout.write(renderMarkdownPortfolioReport(report.data) + '\n');
  } else {
    deps.printByFormat(report.data, format);
  }

  deps.printResultDiagnostics(projects, format);
  deps.printResultDiagnostics(report, format);
  return 0;
}

export async function runAnalysisDriftCommand(args: string[], deps: AnalysisCommandDependencies): Promise<number> {
  return runAnalysisPortfolioViewCommand(args, 'drift', deps);
}

export async function runAnalysisUsageCommand(args: string[], deps: AnalysisCommandDependencies): Promise<number> {
  return runAnalysisPortfolioViewCommand(args, 'usage', deps);
}

export async function runAnalysisPolicyCommand(args: string[], deps: AnalysisCommandDependencies): Promise<number> {
  return runAnalysisPortfolioViewCommand(args, 'policy', deps);
}

async function runAnalysisPortfolioViewCommand(
  args: string[],
  view: AnalysisView,
  deps: AnalysisCommandDependencies
): Promise<number> {
  const format = deps.outputFormat(args, 'json');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const projects = await discoverAnalysisPortfolioProjects(args, discoveryOptions.data, deps);

  if (!projects.success || !projects.data) {
    return deps.printFailure(projects);
  }

  const report = generatePortfolioReport(projects.data, {
    focusAsset: deps.readFlag(args, '--asset'),
    allowedProviderKinds: deps.readRepeatedFlags(args, '--allow-provider-kind'),
  });

  if (!report.success || !report.data) {
    return deps.printFailure(report);
  }

  const payload = view === 'drift' ? report.data.drift : view === 'usage' ? report.data.inventories : report.data.governance;

  deps.printByFormat(payload, format);
  deps.printResultDiagnostics(projects, format);
  deps.printResultDiagnostics(report, format);
  return 0;
}

async function discoverAnalysisPortfolioProjects(
  args: string[],
  options: DiscoveryOptions,
  deps: AnalysisCommandDependencies
): Promise<OperationResult<ProjectContext[]>> {
  const projectPaths = deps.readAnalysisPortfolioProjectPaths(args);
  const projects: ProjectContext[] = [];
  const warnings: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const projectPath of projectPaths) {
    const resolvedPath = resolvePath(projectPath);

    if (seen.has(resolvedPath)) {
      warnings.push(
        createDiagnostic('warning', 'ANALYSIS_PORTFOLIO_DUPLICATE_PROJECT', `Skipping duplicate portfolio project ${resolvedPath}`, {
          source: '@pp/cli',
        })
      );
      continue;
    }

    seen.add(resolvedPath);
    const project = await discoverProject(resolvedPath, {
      ...options,
      environment: process.env,
    });

    if (!project.success || !project.data) {
      return fail([...warnings, ...project.diagnostics], {
        warnings: [...warnings, ...project.warnings],
        supportTier: project.supportTier,
        suggestedNextActions: project.suggestedNextActions,
        provenance: project.provenance,
        knownLimitations: project.knownLimitations,
      });
    }

    warnings.push(...project.warnings);
    projects.push(project.data);
  }

  return ok(projects, {
    warnings,
    supportTier: 'preview',
  });
}
