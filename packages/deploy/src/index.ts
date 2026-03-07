import { ok, type OperationResult } from '@pp/diagnostics';
import type { ProjectContext, ResolvedProjectParameter } from '@pp/project';

export interface DeployInput {
  name: string;
  value?: string | number | boolean;
  source: ResolvedProjectParameter['source'];
  mappings: Array<{ kind: string; target: string }>;
}

export interface DeployPlan {
  projectRoot: string;
  generatedAt: string;
  defaultEnvironment?: string;
  defaultSolution?: string;
  inputs: DeployInput[];
  providerBindings: string[];
  assets: Array<{
    name: string;
    path: string;
    kind: string;
    exists: boolean;
  }>;
}

export function buildDeployPlan(project: ProjectContext): OperationResult<DeployPlan> {
  const inputs = Object.values(project.parameters).map((parameter) => ({
    name: parameter.name,
    value: parameter.value,
    source: parameter.source,
    mappings: parameter.definition.mapsTo ?? [],
  }));

  return ok(
    {
      projectRoot: project.root,
      generatedAt: new Date().toISOString(),
      defaultEnvironment: project.config.defaults?.environment,
      defaultSolution: project.config.defaults?.solution,
      inputs,
      providerBindings: Object.keys(project.providerBindings),
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
