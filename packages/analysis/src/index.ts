import { fail, ok, type OperationResult } from '@pp/diagnostics';
import { buildDeployPlan, type DeployPlan } from '@pp/deploy';
import { summarizeProject, summarizeResolvedParameter, type ProjectContext, type ProjectSummary } from '@pp/project';

export interface AnalysisContextPack {
  generatedAt: string;
  project: ProjectSummary;
  providerBindings: Record<string, string>;
  topology: {
    defaultStage?: string;
    selectedStage?: string;
    activeEnvironment?: string;
    activeSolution?: string;
    stages: Array<{
      name: string;
      environment?: string;
      defaultSolution?: string;
    }>;
  };
  parameters: Array<{
    name: string;
    source: string;
    hasValue: boolean;
    sensitive: boolean;
    reference?: string;
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
      topology: {
        defaultStage: project.topology.defaultStage,
        selectedStage: project.topology.selectedStage,
        activeEnvironment: project.topology.activeEnvironment,
        activeSolution: project.topology.activeSolution?.uniqueName,
        stages: Object.values(project.topology.stages).map((stage) => ({
          name: stage.name,
          environment: stage.environment,
          defaultSolution: stage.defaultSolution?.uniqueName,
        })),
      },
      parameters: Object.values(project.parameters).map((parameter) => {
        const summary = summarizeResolvedParameter(parameter);
        return {
          name: summary.name,
          source: summary.source,
          hasValue: summary.hasValue,
          sensitive: summary.sensitive,
          reference: summary.reference,
          mappings: summary.mappings,
        };
      }),
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
      const summary = summarizeResolvedParameter(parameter);
      const valueState = summary.hasValue ? 'resolved' : 'missing';
      return `- \`${summary.name}\`: ${summary.source} (${valueState}${summary.sensitive ? ', sensitive' : ''})`;
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
    `- Selected stage: \`${summary.selectedStage ?? 'unset'}\``,
    `- Active environment: \`${summary.activeEnvironment ?? 'unset'}\``,
    `- Active solution: \`${summary.activeSolution ?? 'unset'}\``,
    `- Topology stages: ${summary.topologyStageCount}`,
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
