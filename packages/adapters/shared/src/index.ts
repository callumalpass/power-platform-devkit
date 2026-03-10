import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { executeDeploy, resolveDeployBindings, type DeployExecutionMode, type DeployExecutionResult, type ResolvedDeployBindings } from '@pp/deploy';
import { discoverProject } from '@pp/project';

export interface ResolvedDeployAdapterOptions {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
  confirm?: boolean;
  publishBindings?: DeployBindingPublisher;
}

export type DeployBindingPublisher = (
  bindings: ResolvedDeployBindings,
  context: {
    mode: DeployExecutionMode;
    environment: NodeJS.ProcessEnv;
    result: DeployExecutionResult;
  }
) => Promise<OperationResult<void>> | OperationResult<void>;

export function resolveDeployMode(
  explicitMode: DeployExecutionMode | undefined,
  environmentMode: string | undefined,
  source: string,
  hint: string
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
      hint,
    })
  );
}

export function resolveParameterOverrides(
  explicitOverrides: Record<string, string | number | boolean> | undefined,
  serializedOverrides: string | undefined,
  source: string,
  hint: string
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
          hint,
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
        hint,
      })
    );
  }
}

export function resolveDeployConfirm(
  explicitConfirm: boolean | undefined,
  serializedConfirm: string | undefined,
  source: string,
  hint: string
): OperationResult<boolean | undefined> {
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
    createDiagnostic(
      'error',
      'DEPLOY_ADAPTER_CONFIRM_INVALID',
      `Unsupported deploy confirmation value "${serializedConfirm}". Expected true/false, yes/no, or 1/0.`,
      {
        source,
        hint,
      }
    )
  );
}

export async function runResolvedDeploy(options: ResolvedDeployAdapterOptions): Promise<OperationResult<DeployExecutionResult>> {
  const project = await discoverProject(options.projectPath, {
    stage: options.stage,
    parameterOverrides: options.parameterOverrides,
    environment: options.environment,
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

  const result = await executeDeploy(project.data, {
    mode: options.mode,
    confirmed: options.confirm,
  });

  if (!result.success || !result.data || !options.publishBindings) {
    return result;
  }

  const publication = await options.publishBindings(resolveDeployBindings(project.data), {
    mode: result.data.mode,
    environment: options.environment,
    result: result.data,
  });

  if (publication.success) {
    return result;
  }

  return {
    ...result,
    warnings: [...result.warnings, ...publication.diagnostics, ...publication.warnings],
  };
}
