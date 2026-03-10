import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { executeDeploy, type DeployExecutionMode, type DeployExecutionResult } from '@pp/deploy';
import { discoverProject } from '@pp/project';

export const adapter_azure_devopsPackage = '@pp/adapter-azure-devops';

export interface AzureDevOpsDeployOptions {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment?: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
}

export interface ResolvedAzureDevOpsDeployOptions {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
}

export function resolveAzureDevOpsDeployOptions(
  options: AzureDevOpsDeployOptions = {}
): OperationResult<ResolvedAzureDevOpsDeployOptions> {
  const environment = options.environment ?? process.env;
  const projectPath =
    options.projectPath ?? environment.PP_DEPLOY_PROJECT_PATH ?? environment.BUILD_SOURCESDIRECTORY ?? environment.SYSTEM_DEFAULTWORKINGDIRECTORY;
  const stage = options.stage ?? environment.PP_DEPLOY_STAGE ?? environment.RELEASE_ENVIRONMENTNAME ?? environment.SYSTEM_STAGEDISPLAYNAME;
  const modeResult = resolveDeployMode(options.mode, environment.PP_DEPLOY_MODE, '@pp/adapter-azure-devops');

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
    '@pp/adapter-azure-devops'
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

  return ok({
    projectPath,
    stage,
    parameterOverrides: parameterOverridesResult.data,
    environment,
    mode: modeResult.data,
  });
}

export async function runAzureDevOpsDeploy(options: {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment?: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
} = {}): Promise<OperationResult<DeployExecutionResult>> {
  const resolved = resolveAzureDevOpsDeployOptions(options);

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
