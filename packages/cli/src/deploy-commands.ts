import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import {
  buildDeployPlan,
  executeDeploy,
  executeDeployPlan,
  executeReleaseManifest,
  inspectDeployTargetResolution,
  type DeployPlan,
  type ReleaseManifest,
} from '@pp/deploy';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { discoverProject } from '@pp/project';
import { createSuccessPayload, type CliOutputFormat } from './contract';
import YAML from 'yaml';

type OutputFormat = CliOutputFormat;
type DiscoveryOptions = { stage?: string; parameterOverrides?: Record<string, string> };

interface DeployCommandDependencies {
  positionalArgs(args: string[]): string[];
  resolveDefaultInvocationPath(): string;
  outputFormat(args: string[], fallback: OutputFormat): OutputFormat;
  readProjectDiscoveryOptions(args: string[]): OperationResult<DiscoveryOptions>;
  printFailure(result: OperationResult<unknown>): number;
  printFailureWithMachinePayload?(result: OperationResult<unknown>, format: OutputFormat): number;
  printByFormat(value: unknown, format: OutputFormat): void;
  printResultDiagnostics(result: OperationResult<unknown>, format: OutputFormat): void;
  readFlag(args: string[], name: string): string | undefined;
  readRepeatedFlags(args: string[], name: string): string[];
  hasFlag(args: string[], name: string): boolean;
  readValueFlag(args: string[], name: string): string | undefined;
  argumentFailure(code: string, message: string): OperationResult<never>;
  printHelp(): void;
}

export async function runDeployPlanCommand(args: string[], deps: DeployCommandDependencies): Promise<number> {
  const projectPath = deps.readFlag(args, '--project') ?? deps.resolveDefaultInvocationPath();
  const format = deps.outputFormat(args, 'json');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return deps.printFailure(project);
  }

  const stageNotFound = project.diagnostics.find((diagnostic) => diagnostic.code === 'PROJECT_STAGE_NOT_FOUND');
  if (stageNotFound) {
    const availableStages = Object.keys(project.data.topology.stages).sort();
    const result = fail(stageNotFound, {
      supportTier: project.supportTier,
      warnings: project.warnings,
      suggestedNextActions:
        availableStages.length > 0
          ? [`Use one of the configured project stages instead: ${availableStages.join(', ')}.`]
          : ['Define at least one stage in project topology or omit `--stage` to use the default target.'],
      details: {
        requestedStage: discoveryOptions.data.stage,
        projectRoot: project.data.root,
        defaultStage: project.data.topology.defaultStage,
        selectedStage: project.data.topology.selectedStage,
        activeEnvironment: project.data.topology.activeEnvironment,
        activeSolution: project.data.topology.activeSolution?.uniqueName,
        availableStages,
      },
    });

    return deps.printFailureWithMachinePayload ? deps.printFailureWithMachinePayload(result, format) : deps.printFailure(result);
  }

  const plan = buildDeployPlan(project.data);
  const targetInspection = plan.success && plan.data ? await inspectDeployTargetResolution(plan.data.target) : ok(undefined);

  if (!plan.success || !plan.data) {
    return deps.printFailure(plan);
  }

  deps.printByFormat(
    createSuccessPayload(plan.data, {
      diagnostics: [...project.diagnostics, ...plan.diagnostics, ...targetInspection.diagnostics],
      warnings: [...project.warnings, ...plan.warnings, ...targetInspection.warnings],
      supportTier: plan.supportTier,
      suggestedNextActions: [
        ...(project.suggestedNextActions ?? []),
        ...(plan.suggestedNextActions ?? []),
        ...(targetInspection.suggestedNextActions ?? []),
      ],
      provenance: [...(project.provenance ?? []), ...(plan.provenance ?? []), ...(targetInspection.provenance ?? [])],
      knownLimitations: [...(project.knownLimitations ?? []), ...(plan.knownLimitations ?? []), ...(targetInspection.knownLimitations ?? [])],
    }),
    format
  );
  deps.printResultDiagnostics(project, format);
  deps.printResultDiagnostics(plan, format);
  deps.printResultDiagnostics(targetInspection, format);
  return 0;
}

export async function runDeployApplyCommand(args: string[], deps: DeployCommandDependencies): Promise<number> {
  const explicitProjectPath = deps.readFlag(args, '--project');
  const projectPath = explicitProjectPath ?? deps.resolveDefaultInvocationPath();
  const format = deps.outputFormat(args, 'json');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const mutation = readDeployApplyFlags(args, deps);

  if (!mutation.success || !mutation.data) {
    return deps.printFailure(mutation);
  }

  const expectedPlan = mutation.data.planPath
    ? await loadDeployPlanFile(mutation.data.planPath)
    : ok<DeployPlan | undefined>(undefined, { supportTier: 'preview' });

  if (!expectedPlan.success) {
    return deps.printFailure(expectedPlan);
  }

  if (expectedPlan.data && !explicitProjectPath) {
    const result = await executeDeployPlan(expectedPlan.data, {
      mode: mutation.data.mode,
      confirmed: mutation.data.yes,
      parameterOverrides: discoveryOptions.data.parameterOverrides,
    });

    if (!result.data) {
      return deps.printFailure(result);
    }

    deps.printByFormat(result.data, format);
    deps.printResultDiagnostics(result, format);
    return result.data.preflight.ok && result.data.apply.summary.failed === 0 ? 0 : 1;
  }

  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return deps.printFailure(project);
  }

  const result = await executeDeploy(project.data, {
    mode: mutation.data.mode,
    confirmed: mutation.data.yes,
    expectedPlan: expectedPlan.data,
  });

  if (!result.data) {
    return deps.printFailure(result);
  }

  deps.printByFormat(result.data, format);
  deps.printResultDiagnostics(project, format);
  deps.printResultDiagnostics(result, format);
  return result.data.preflight.ok && result.data.apply.summary.failed === 0 ? 0 : 1;
}

export async function runDeployReleaseCommand(args: string[], deps: DeployCommandDependencies): Promise<number> {
  const [action, ...rest] = args;

  if (!action || action === 'help' || action === '--help') {
    deps.printHelp();
    return 0;
  }

  const format = deps.outputFormat(rest, 'json');
  const manifestPath = deps.readFlag(rest, '--file') ?? deps.positionalArgs(rest)[0];

  if (!manifestPath) {
    return deps.printFailure(
      deps.argumentFailure('RELEASE_MANIFEST_REQUIRED', 'Use `deploy release <plan|apply> --file <manifest.yml>`.')
    );
  }

  const manifest = await loadReleaseManifestFile(manifestPath);

  if (!manifest.success || !manifest.data) {
    return deps.printFailure(manifest);
  }

  const discoveryOptions = deps.readProjectDiscoveryOptions(rest);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const yes = deps.hasFlag(rest, '--yes');
  const mode: 'plan' | 'dry-run' | 'apply' = action === 'plan' ? 'plan' : deps.hasFlag(rest, '--dry-run') ? 'dry-run' : 'apply';
  const result = await executeReleaseManifest(manifest.data, {
    mode,
    confirmed: yes,
    approvedStages: deps.readRepeatedFlags(rest, '--approve'),
    parameterOverrides: discoveryOptions.data.parameterOverrides,
  });

  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  deps.printByFormat(result.data, format);
  deps.printResultDiagnostics(result, format);
  return result.data.summary.failed === 0 && result.data.summary.blocked === 0 && result.data.summary.rollbackFailed === 0 ? 0 : 1;
}

function readDeployApplyFlags(
  args: string[],
  deps: Pick<DeployCommandDependencies, 'readValueFlag' | 'argumentFailure'>
): OperationResult<{ mode: 'apply' | 'dry-run' | 'plan'; dryRun: boolean; plan: boolean; yes: boolean; planPath?: string }> {
  const dryRun = args.includes('--dry-run');
  const planPath = deps.readValueFlag(args, '--plan');
  const plan = args.includes('--plan') && !planPath;
  const yes = args.includes('--yes');

  if (dryRun && (plan || planPath)) {
    return deps.argumentFailure('CLI_MUTATION_MODE_CONFLICT', 'Use either --dry-run, --plan, or --plan <file>, not multiple preview/apply modes.');
  }

  return ok(
    {
      mode: plan ? 'plan' : dryRun ? 'dry-run' : 'apply',
      dryRun,
      plan,
      yes,
      planPath,
    },
    {
      supportTier: 'preview',
    }
  );
}

async function loadDeployPlanFile(path: string): Promise<OperationResult<DeployPlan>> {
  let raw: string;

  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    return fail(
      createDiagnostic('error', 'DEPLOY_PLAN_FILE_READ_FAILED', `Could not read deploy plan file ${path}.`, {
        source: '@pp/cli',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'DEPLOY_PLAN_FILE_INVALID_JSON', `Deploy plan file ${path} is not valid JSON.`, {
        source: '@pp/cli',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }

  if (!isDeployPlanShape(parsed)) {
    return fail(
      createDiagnostic('error', 'DEPLOY_PLAN_FILE_INVALID', `Deploy plan file ${path} does not match the expected deploy plan shape.`, {
        source: '@pp/cli',
        path,
      })
    );
  }

  return ok(parsed, {
    supportTier: 'preview',
  });
}

async function loadReleaseManifestFile(path: string): Promise<OperationResult<ReleaseManifest>> {
  let raw: string;

  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    return fail(
      createDiagnostic('error', 'RELEASE_MANIFEST_READ_FAILED', `Could not read release manifest ${path}.`, {
        source: '@pp/cli',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }

  let parsed: unknown;

  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'RELEASE_MANIFEST_INVALID', `Release manifest ${path} is not valid YAML or JSON.`, {
        source: '@pp/cli',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }

  if (!isReleaseManifestShape(parsed)) {
    return fail(
      createDiagnostic('error', 'RELEASE_MANIFEST_SHAPE_INVALID', `Release manifest ${path} does not match the expected release manifest shape.`, {
        source: '@pp/cli',
        path,
      })
    );
  }

  return ok(resolveReleaseManifestPaths(parsed, path), {
    supportTier: 'preview',
  });
}

function isDeployPlanShape(value: unknown): value is DeployPlan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<DeployPlan>;
  return typeof candidate.generatedAt === 'string' && typeof candidate.projectRoot === 'string' && Array.isArray(candidate.operations);
}

function isReleaseManifestShape(value: unknown): value is ReleaseManifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ReleaseManifest>;
  return candidate.schemaVersion === 1 && candidate.kind === 'pp.release' && typeof candidate.name === 'string' && Array.isArray(candidate.stages);
}

function resolveReleaseManifestPaths(manifest: ReleaseManifest, manifestPath: string): ReleaseManifest {
  const manifestDir = dirname(resolvePath(manifestPath));
  return {
    ...manifest,
    projectRoot: manifest.projectRoot
      ? isAbsolute(manifest.projectRoot)
        ? manifest.projectRoot
        : resolvePath(manifestDir, manifest.projectRoot)
      : manifest.projectRoot,
    bundle: manifest.bundle
      ? {
          ...manifest.bundle,
          manifestPath: resolvePath(manifestPath),
        }
      : {
          manifestPath: resolvePath(manifestPath),
        },
    stages: manifest.stages.map((stage) => ({
      ...stage,
      projectPath: stage.projectPath
        ? isAbsolute(stage.projectPath)
          ? stage.projectPath
          : resolvePath(manifestDir, stage.projectPath)
        : stage.projectPath,
      planPath: stage.planPath
        ? isAbsolute(stage.planPath)
          ? stage.planPath
          : resolvePath(manifestDir, stage.planPath)
        : stage.planPath,
    })),
  };
}
