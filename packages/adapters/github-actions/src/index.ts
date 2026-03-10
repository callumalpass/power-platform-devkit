import { appendFile } from 'node:fs/promises';
import {
  resolveDeployConfirm,
  resolveDeployMode,
  resolveParameterOverrides,
  runResolvedDeploy,
  type DeployBindingPublisher,
  type ResolvedDeployAdapterOptions,
} from '../../shared/src/index';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { type DeployExecutionMode, type DeployExecutionResult, type ResolvedDeployBindings } from '@pp/deploy';

export const adapter_github_actionsPackage = '@pp/adapter-github-actions';

export interface GitHubActionsDeployOptions {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment?: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
  confirm?: boolean;
}

export type ResolvedGitHubActionsDeployOptions = ResolvedDeployAdapterOptions;

export async function publishGitHubActionsDeployBindings(
  bindings: ResolvedDeployBindings,
  environment: NodeJS.ProcessEnv = process.env
): Promise<OperationResult<void>> {
  const outputPath = environment.GITHUB_OUTPUT;

  if (!outputPath) {
    return ok(undefined);
  }

  const entries = [...bindings.inputs, ...bindings.secrets].filter((entry) => entry.status === 'resolved' && entry.value !== undefined);

  if (entries.length === 0) {
    return ok(undefined);
  }

  const payload = entries.map((entry, index) => formatGitHubOutputEntry(entry.target, entry.value!, index)).join('');

  try {
    await appendFile(outputPath, payload, 'utf8');
    return ok(undefined);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'DEPLOY_ADAPTER_GITHUB_OUTPUT_WRITE_FAILED', 'Could not publish resolved deploy bindings to GITHUB_OUTPUT.', {
        source: '@pp/adapter-github-actions',
        detail: error instanceof Error ? error.message : String(error),
        hint: 'Ensure GITHUB_OUTPUT points to a writable file for the current step.',
      })
    );
  }
}

export function resolveGitHubActionsDeployOptions(
  options: GitHubActionsDeployOptions = {}
): OperationResult<ResolvedGitHubActionsDeployOptions> {
  const environment = options.environment ?? process.env;
  const projectPath = options.projectPath ?? environment.INPUT_PROJECT_PATH ?? environment.PP_DEPLOY_PROJECT_PATH ?? environment.GITHUB_WORKSPACE;
  const stage = options.stage ?? environment.INPUT_STAGE ?? environment.PP_DEPLOY_STAGE;
  const modeResult = resolveDeployMode(
    options.mode,
    environment.INPUT_MODE ?? environment.PP_DEPLOY_MODE,
    '@pp/adapter-github-actions',
    'Set INPUT_MODE or PP_DEPLOY_MODE to apply, dry-run, or plan.'
  );

  if (!modeResult.success) {
    return fail(modeResult.diagnostics, {
      supportTier: modeResult.supportTier,
      warnings: modeResult.warnings,
      suggestedNextActions: modeResult.suggestedNextActions,
      provenance: modeResult.provenance,
      knownLimitations: modeResult.knownLimitations,
    });
  }

  const parameterOverridesResult = resolveParameterOverrides(
    options.parameterOverrides,
    environment.INPUT_PARAMETER_OVERRIDES ?? environment.PP_DEPLOY_PARAMETER_OVERRIDES,
    '@pp/adapter-github-actions',
    'Set INPUT_PARAMETER_OVERRIDES or PP_DEPLOY_PARAMETER_OVERRIDES to a JSON object such as {"tenantDomain":"contoso.example"}.'
  );

  if (!parameterOverridesResult.success) {
    return fail(parameterOverridesResult.diagnostics, {
      supportTier: parameterOverridesResult.supportTier,
      warnings: parameterOverridesResult.warnings,
      suggestedNextActions: parameterOverridesResult.suggestedNextActions,
      provenance: parameterOverridesResult.provenance,
      knownLimitations: parameterOverridesResult.knownLimitations,
    });
  }

  const confirmResult = resolveDeployConfirm(
    options.confirm,
    environment.INPUT_CONFIRM ?? environment.PP_DEPLOY_CONFIRM,
    '@pp/adapter-github-actions',
    'Set INPUT_CONFIRM or PP_DEPLOY_CONFIRM to true, false, yes, no, 1, or 0.'
  );

  if (!confirmResult.success) {
    return fail(confirmResult.diagnostics, {
      supportTier: confirmResult.supportTier,
      warnings: confirmResult.warnings,
      suggestedNextActions: confirmResult.suggestedNextActions,
      provenance: confirmResult.provenance,
      knownLimitations: confirmResult.knownLimitations,
    });
  }

  return ok({
    projectPath,
    stage,
    parameterOverrides: parameterOverridesResult.data,
    environment,
    mode: modeResult.data,
    confirm: confirmResult.data,
  });
}

export async function runGitHubActionsDeploy(options: GitHubActionsDeployOptions = {}): Promise<OperationResult<DeployExecutionResult>> {
  const resolved = resolveGitHubActionsDeployOptions(options);

  if (!resolved.success || !resolved.data) {
    return fail(resolved.diagnostics, {
      supportTier: resolved.supportTier,
      warnings: resolved.warnings,
      suggestedNextActions: resolved.suggestedNextActions,
      provenance: resolved.provenance,
      knownLimitations: resolved.knownLimitations,
    });
  }

  const publishBindings: DeployBindingPublisher = async (bindings, context) =>
    publishGitHubActionsDeployBindings(bindings, context.environment);

  return runResolvedDeploy({
    ...resolved.data,
    publishBindings,
  });
}

function formatGitHubOutputEntry(name: string, value: string | number | boolean, index: number): string {
  const delimiter = `PP_DEPLOY_${name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_${index}`;
  return `${name}<<${delimiter}\n${String(value)}\n${delimiter}\n`;
}
