import { fail, ok, type OperationResult } from '@pp/diagnostics';
import { buildDeployPlan, type DeployPlan } from '@pp/deploy';
import { summarizeProject, type ProjectContext, type ProjectSummary } from '@pp/project';

export interface AnalysisContextPack {
  generatedAt: string;
  project: ProjectSummary;
  providerBindings: Record<string, string>;
  parameters: Array<{
    name: string;
    source: string;
    hasValue: boolean;
    mappings: Array<{ kind: string; target: string }>;
  }>;
  assets: Array<{
    name: string;
    path: string;
    kind: string;
    exists: boolean;
  }>;
  deployPlan: DeployPlan;
  focusAsset?: string;
}

export function generateContextPack(project: ProjectContext, focusAsset?: string): OperationResult<AnalysisContextPack> {
  const deployPlanResult = buildDeployPlan(project);

  if (!deployPlanResult.success || !deployPlanResult.data) {
    return fail(deployPlanResult.diagnostics, {
      supportTier: deployPlanResult.supportTier,
      warnings: deployPlanResult.warnings,
      suggestedNextActions: deployPlanResult.suggestedNextActions,
      provenance: deployPlanResult.provenance,
      knownLimitations: deployPlanResult.knownLimitations,
    });
  }

  return ok(
    {
      generatedAt: new Date().toISOString(),
      project: summarizeProject(project),
      providerBindings: Object.fromEntries(
        Object.entries(project.providerBindings).map(([name, binding]) => [name, `${binding.kind}:${binding.target}`])
      ),
      parameters: Object.values(project.parameters).map((parameter) => ({
        name: parameter.name,
        source: parameter.source,
        hasValue: parameter.value !== undefined || parameter.source === 'secret-ref',
        mappings: parameter.definition.mapsTo ?? [],
      })),
      assets: project.assets.map((asset) => ({
        name: asset.name,
        path: asset.path,
        kind: asset.kind,
        exists: asset.exists,
      })),
      deployPlan: deployPlanResult.data,
      focusAsset,
    },
    {
      supportTier: 'preview',
    }
  );
}

export function renderMarkdownReport(project: ProjectContext): string {
  const summary = summarizeProject(project);
  const providerBindings = Object.entries(project.providerBindings)
    .map(([name, binding]) => `- \`${name}\`: ${binding.kind} -> ${binding.target}`)
    .join('\n');
  const parameters = Object.values(project.parameters)
    .map((parameter) => {
      const valueState = parameter.value !== undefined || parameter.source === 'secret-ref' ? 'resolved' : 'missing';
      return `- \`${parameter.name}\`: ${parameter.source} (${valueState})`;
    })
    .join('\n');
  const assets = project.assets
    .map((asset) => `- \`${asset.name}\`: ${asset.kind} at \`${asset.path}\`${asset.exists ? '' : ' (missing)'}`)
    .join('\n');

  return [
    '# Project Report',
    '',
    `- Root: \`${summary.root}\``,
    `- Default environment: \`${summary.defaultEnvironment ?? 'unset'}\``,
    `- Default solution: \`${summary.defaultSolution ?? 'unset'}\``,
    `- Assets discovered: ${summary.assetCount}`,
    `- Provider bindings: ${summary.providerBindingCount}`,
    `- Parameters: ${summary.parameterCount}`,
    '',
    '## Provider bindings',
    providerBindings || '- None',
    '',
    '## Parameters',
    parameters || '- None',
    '',
    '## Assets',
    assets || '- None',
    '',
    summary.missingRequiredParameters.length > 0
      ? `## Missing required parameters\n${summary.missingRequiredParameters.map((name) => `- \`${name}\``).join('\n')}`
      : '## Missing required parameters\n- None',
  ].join('\n');
}
