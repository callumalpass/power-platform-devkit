import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { executeDeploy, type DeployExecutionMode, type DeployExecutionResult } from '@pp/deploy';
import { discoverProject } from '@pp/project';

export const adapter_power_platform_pipelinesPackage = '@pp/adapter-power-platform-pipelines';

export interface PowerPlatformPipelinesDeployOptions {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment?: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
  confirm?: boolean;
}

export interface ResolvedPowerPlatformPipelinesDeployOptions {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
  confirm?: boolean;
}

export function resolvePowerPlatformPipelinesDeployOptions(
  options: PowerPlatformPipelinesDeployOptions = {}
): OperationResult<ResolvedPowerPlatformPipelinesDeployOptions> {
  const environment = options.environment ?? process.env;
  const projectPath = options.projectPath ?? environment.PP_DEPLOY_PROJECT_PATH ?? environment.PIPELINE_WORKSPACE ?? environment.SYSTEM_DEFAULTWORKINGDIRECTORY;
  const stage = options.stage ?? environment.PP_DEPLOY_STAGE ?? environment.PIPELINE_STAGE;
  const modeResult = resolveDeployMode(options.mode, environment.PP_DEPLOY_MODE, '@pp/adapter-power-platform-pipelines');

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
    '@pp/adapter-power-platform-pipelines'
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

  const confirmResult = resolveDeployConfirm(options.confirm, environment.PP_DEPLOY_CONFIRM, '@pp/adapter-power-platform-pipelines');

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

export async function runPowerPlatformPipelinesDeploy(options: {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment?: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
  confirm?: boolean;
} = {}): Promise<OperationResult<DeployExecutionResult>> {
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

  const project = await discoverProject(resolved.data.projectPath, {
    stage: resolved.data.stage,
    parameterOverrides: resolved.data.parameterOverrides,
    environment: resolved.data.environment,
  });

  if (!project.success || !project.data) {
    return fail(project.diagnostics, {
      supportTier: project.supportTier,
      warnings: project.warnings,
      suggestedNextActions: project.suggestedNextActions,
      provenance: project.provenance,
      knownLimitations: project.knownLimitations,
    });
  }

  return executeDeploy(project.data, {
    mode: resolved.data.mode,
    confirmed: resolved.data.confirm,
  });
}

function resolveDeployMode(
  explicitMode: DeployExecutionMode | undefined,
  environmentMode: string | undefined,
  source: string
): OperationResult<DeployExecutionMode | undefined> {
  const mode = explicitMode ?? environmentMode;

  if (mode === undefined) {
    return ok(undefined);
  }

  if (mode === 'apply' || mode === 'dry-run' || mode === 'plan') {
    return ok(mode);
  }

  return fail(
    createDiagnostic('error', 'DEPLOY_ADAPTER_MODE_INVALID', `Unsupported deploy mode "${mode}". Expected apply, dry-run, or plan.`, {
      source,
      hint: 'Set PP_DEPLOY_MODE to apply, dry-run, or plan.',
    })
  );
}

function resolveParameterOverrides(
  explicitOverrides: Record<string, string | number | boolean> | undefined,
  serializedOverrides: string | undefined,
  source: string
): OperationResult<Record<string, string | number | boolean> | undefined> {
  if (explicitOverrides) {
    return ok(explicitOverrides);
  }

  if (!serializedOverrides) {
    return ok(undefined);
  }

  try {
    const parsed = JSON.parse(serializedOverrides) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail(
        createDiagnostic('error', 'DEPLOY_ADAPTER_PARAMETER_OVERRIDES_INVALID', 'Deploy parameter overrides must be a JSON object.', {
          source,
          hint: 'Set PP_DEPLOY_PARAMETER_OVERRIDES to a JSON object such as {"tenantDomain":"contoso.example"}.',
        })
      );
    }

    const normalized: Record<string, string | number | boolean> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return fail(
          createDiagnostic(
            'error',
            'DEPLOY_ADAPTER_PARAMETER_OVERRIDE_VALUE_INVALID',
            `Deploy parameter override "${key}" must resolve to a string, number, or boolean.`,
            {
              source,
            }
          )
        );
      }

      normalized[key] = value;
    }

    return ok(normalized);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'DEPLOY_ADAPTER_PARAMETER_OVERRIDES_PARSE_FAILED', 'Could not parse deploy parameter overrides JSON.', {
        source,
        detail: error instanceof Error ? error.message : String(error),
        hint: 'Set PP_DEPLOY_PARAMETER_OVERRIDES to valid JSON.',
      })
    );
  }
}

function resolveDeployConfirm(explicitConfirm: boolean | undefined, serializedConfirm: string | undefined, source: string): OperationResult<boolean | undefined> {
  if (explicitConfirm !== undefined) {
    return ok(explicitConfirm);
  }

  if (serializedConfirm === undefined || serializedConfirm === '') {
    return ok(undefined);
  }

  const normalized = serializedConfirm.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return ok(true);
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return ok(false);
  }

  return fail(
    createDiagnostic('error', 'DEPLOY_ADAPTER_CONFIRM_INVALID', `Unsupported deploy confirmation value "${serializedConfirm}". Expected true/false, yes/no, or 1/0.`, {
      source,
      hint: 'Set PP_DEPLOY_CONFIRM to true or false.',
    })
  );
}
