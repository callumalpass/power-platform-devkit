import { fail, type OperationResult } from '@pp/diagnostics';
import { executeDeploy, type DeployExecutionMode, type DeployExecutionResult } from '@pp/deploy';
import { discoverProject } from '@pp/project';

export const adapter_github_actionsPackage = '@pp/adapter-github-actions';

export async function runGitHubActionsDeploy(options: {
  projectPath?: string;
  stage?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  environment?: NodeJS.ProcessEnv;
  mode?: DeployExecutionMode;
} = {}): Promise<OperationResult<DeployExecutionResult>> {
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

  return executeDeploy(project.data, {
    mode: options.mode,
  });
}
