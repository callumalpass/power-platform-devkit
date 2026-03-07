export interface MspToolDefinition {
  name: string;
  description: string;
}

export const initialMcpTools: MspToolDefinition[] = [
  { name: 'project.inspect', description: 'Inspect the local project context.' },
  { name: 'analysis.report', description: 'Generate a documentation-friendly project report.' },
  { name: 'deploy.plan', description: 'Build a deploy plan from the current project.' },
];
