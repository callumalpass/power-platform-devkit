import { ok, type OperationResult } from '@pp/diagnostics';
import { summarizeResolvedParameter, type ProjectContext, type ResolvedProjectParameter } from '@pp/project';

export interface DeployInput {
  name: string;
  value?: string | number | boolean;
  source: ResolvedProjectParameter['source'];
  hasValue: boolean;
  sensitive: boolean;
  reference?: string;
  mappings: Array<{ kind: string; target: string }>;
}

export interface DeployPlan {
  projectRoot: string;
  generatedAt: string;
  defaultEnvironment?: string;
  defaultSolution?: string;
  selectedStage?: string;
  activeEnvironment?: string;
  activeSolution?: string;
  inputs: DeployInput[];
  providerBindings: string[];
  topology: Array<{
    name: string;
    environment?: string;
    defaultSolution?: string;
  }>;
  templateRegistries: string[];
  build: Record<string, unknown>;
  assets: Array<{
    name: string;
    path: string;
    kind: string;
    exists: boolean;
  }>;
}

export function buildDeployPlan(project: ProjectContext): OperationResult<DeployPlan> {
  const inputs = Object.values(project.parameters).map((parameter) => {
    const summary = summarizeResolvedParameter(parameter);
    return {
      name: summary.name,
      value: summary.value,
      source: summary.source,
      hasValue: summary.hasValue,
      sensitive: summary.sensitive,
      reference: summary.reference,
      mappings: summary.mappings,
    };
  });

  return ok(
    {
      projectRoot: project.root,
      generatedAt: new Date().toISOString(),
      defaultEnvironment: project.config.defaults?.environment,
      defaultSolution: project.config.defaults?.solution,
      selectedStage: project.topology.selectedStage,
      activeEnvironment: project.topology.activeEnvironment,
      activeSolution: project.topology.activeSolution?.uniqueName,
      inputs,
      providerBindings: Object.keys(project.providerBindings),
      topology: Object.values(project.topology.stages).map((stage) => ({
        name: stage.name,
        environment: stage.environment,
        defaultSolution: stage.defaultSolution?.uniqueName,
      })),
      templateRegistries: project.templateRegistries,
      build: project.build,
      assets: project.assets.map((asset) => ({
        name: asset.name,
        path: asset.path,
        kind: asset.kind,
        exists: asset.exists,
      })),
    },
    {
      supportTier: 'preview',
    }
  );
}
