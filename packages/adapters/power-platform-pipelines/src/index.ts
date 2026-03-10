import {
  publishAzurePipelineDeployBindings,
  resolveDeployConfirm,
  resolveDeployMode,
  resolveParameterOverrides,
  runResolvedDeploy,
  type DeployBindingPublisher,
  type ResolvedDeployAdapterOptions,
} from '../../shared/src/index';
import { fail, ok, type OperationResult } from '@pp/diagnostics';
import { type DeployExecutionMode, type DeployExecutionResult } from '@pp/deploy';

export const adapter_power_platform_pipelinesPackage = '@pp/adapter-power-platform-pipelines';

export interface PowerPlatformPipelinesDeployOptions {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment?: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
  confirm?: boolean;
}

export type ResolvedPowerPlatformPipelinesDeployOptions = ResolvedDeployAdapterOptions;

export function resolvePowerPlatformPipelinesDeployOptions(
  options: PowerPlatformPipelinesDeployOptions = {}
): OperationResult<ResolvedPowerPlatformPipelinesDeployOptions> {
  const environment = options.environment ?? process.env;
  const projectPath = options.projectPath ?? environment.PP_DEPLOY_PROJECT_PATH ?? environment.PIPELINE_WORKSPACE ?? environment.SYSTEM_DEFAULTWORKINGDIRECTORY;
  const stage = options.stage ?? environment.PP_DEPLOY_STAGE ?? environment.PIPELINE_STAGE;
  const modeResult = resolveDeployMode(
    options.mode,
    environment.PP_DEPLOY_MODE,
    '@pp/adapter-power-platform-pipelines',
    'Set PP_DEPLOY_MODE to apply, dry-run, or plan.'
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
    environment.PP_DEPLOY_PARAMETER_OVERRIDES,
    '@pp/adapter-power-platform-pipelines',
    'Set PP_DEPLOY_PARAMETER_OVERRIDES to a JSON object such as {"tenantDomain":"contoso.example"}.'
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
    environment.PP_DEPLOY_CONFIRM,
    '@pp/adapter-power-platform-pipelines',
    'Set PP_DEPLOY_CONFIRM to true, false, yes, no, 1, or 0.'
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

export async function runPowerPlatformPipelinesDeploy(
  options: PowerPlatformPipelinesDeployOptions = {}
): Promise<OperationResult<DeployExecutionResult>> {
  const resolved = resolvePowerPlatformPipelinesDeployOptions(options);

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
    publishAzurePipelineDeployBindings(bindings, {
      source: '@pp/adapter-power-platform-pipelines',
      environment: context.environment,
    });

  return runResolvedDeploy({
    ...resolved.data,
    publishBindings,
  });
}
