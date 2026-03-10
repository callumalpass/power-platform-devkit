import { relative } from 'node:path';
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

export interface AnalysisPortfolioOptions {
  focusAsset?: string;
  allowedProviderKinds?: string[];
}

export interface PortfolioProjectSummary {
  root: string;
  configPath?: string;
  owner?: string;
  docsPaths: string[];
  templateRegistries: string[];
  summary: ProjectSummary;
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
  assets: Array<{
    name: string;
    path: string;
    relativePath: string;
    kind: string;
    exists: boolean;
  }>;
  providerBindings: Array<{
    name: string;
    kind: string;
    target: string;
    hasMetadata: boolean;
  }>;
  parameters: Array<{
    name: string;
    type: string;
    source: string;
    hasValue: boolean;
    sensitive: boolean;
    reference?: string;
    mappings: Array<{ kind: string; target: string }>;
  }>;
}

export interface PortfolioOwnerInventoryEntry {
  owner: string;
  projectCount: number;
  projectRoots: string[];
  assetCount: number;
  providerBindingCount: number;
}

export interface PortfolioAssetUsageEntry {
  assetName: string;
  kind: string;
  projectCount: number;
  projectRoots: string[];
  missingInProjects: string[];
  relativePaths: string[];
}

export interface PortfolioProviderUsageEntry {
  bindingName: string;
  kind: string;
  target: string;
  projectCount: number;
  projectRoots: string[];
}

export interface PortfolioParameterUsageEntry {
  parameterName: string;
  projectCount: number;
  projectRoots: string[];
  missingInProjects: string[];
  mappingKinds: string[];
}

export interface PortfolioDriftFinding {
  code: 'PORTFOLIO_STAGE_DRIFT' | 'PORTFOLIO_PROVIDER_BINDING_DRIFT' | 'PORTFOLIO_PARAMETER_DRIFT' | 'PORTFOLIO_ASSET_DRIFT';
  assetClass: 'topology-stage' | 'provider-binding' | 'parameter' | 'asset';
  subject: string;
  message: string;
  variants: Array<{
    signature: string;
    projectRoots: string[];
  }>;
}

export interface PortfolioGovernanceFinding {
  severity: 'error' | 'warning';
  category: 'ownership' | 'provenance' | 'connector' | 'dependency' | 'mutation-surface';
  code:
    | 'PORTFOLIO_OWNER_MISSING'
    | 'PORTFOLIO_PROVENANCE_MISSING'
    | 'PORTFOLIO_UNSUPPORTED_PROVIDER_KIND'
    | 'PORTFOLIO_MISSING_ASSET'
    | 'PORTFOLIO_REQUIRED_PARAMETER_MISSING'
    | 'PORTFOLIO_UNSAFE_SENSITIVE_VALUE';
  projectRoot: string;
  subject: string;
  message: string;
}

export interface AnalysisPortfolioReport {
  generatedAt: string;
  focusAsset?: string;
  summary: {
    projectCount: number;
    owners: string[];
    unownedProjectCount: number;
    environmentCount: number;
    assetCount: number;
    providerBindingCount: number;
    parameterCount: number;
    driftCount: number;
    governanceFindingCount: number;
  };
  projects: PortfolioProjectSummary[];
  inventories: {
    owners: PortfolioOwnerInventoryEntry[];
    assetUsage: PortfolioAssetUsageEntry[];
    providerBindings: PortfolioProviderUsageEntry[];
    parameters: PortfolioParameterUsageEntry[];
  };
  drift: {
    findings: PortfolioDriftFinding[];
  };
  governance: {
    allowedProviderKinds: string[];
    findings: PortfolioGovernanceFinding[];
  };
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

export function generatePortfolioReport(
  projects: ProjectContext[],
  options: AnalysisPortfolioOptions = {}
): OperationResult<AnalysisPortfolioReport> {
  const allowedProviderKinds =
    options.allowedProviderKinds && options.allowedProviderKinds.length > 0
      ? options.allowedProviderKinds
      : ['dataverse', 'sharepoint-site', 'powerbi-workspace'];
  const portfolioProjects = projects
    .map((project) => toPortfolioProjectSummary(project))
    .sort((left, right) => left.root.localeCompare(right.root));

  const owners = buildOwnerInventory(portfolioProjects);
  const assetUsage = buildAssetUsageInventory(portfolioProjects);
  const providerBindings = buildProviderUsageInventory(portfolioProjects);
  const parameters = buildParameterUsageInventory(portfolioProjects);
  const driftFindings = buildDriftFindings(portfolioProjects);
  const governanceFindings = buildGovernanceFindings(portfolioProjects, allowedProviderKinds);
  const environments = new Set<string>();

  for (const project of portfolioProjects) {
    if (project.topology.activeEnvironment) {
      environments.add(project.topology.activeEnvironment);
    }

    for (const stage of project.topology.stages) {
      if (stage.environment) {
        environments.add(stage.environment);
      }
    }
  }

  return ok(
    {
      generatedAt: new Date().toISOString(),
      focusAsset: options.focusAsset,
      summary: {
        projectCount: portfolioProjects.length,
        owners: owners.map((entry) => entry.owner),
        unownedProjectCount: portfolioProjects.filter((project) => !project.owner).length,
        environmentCount: environments.size,
        assetCount: portfolioProjects.reduce((total, project) => total + project.assets.length, 0),
        providerBindingCount: portfolioProjects.reduce((total, project) => total + project.providerBindings.length, 0),
        parameterCount: portfolioProjects.reduce((total, project) => total + project.parameters.length, 0),
        driftCount: driftFindings.length,
        governanceFindingCount: governanceFindings.length,
      },
      projects: portfolioProjects,
      inventories: {
        owners,
        assetUsage,
        providerBindings,
        parameters,
      },
      drift: {
        findings: driftFindings,
      },
      governance: {
        allowedProviderKinds: [...allowedProviderKinds].sort((left, right) => left.localeCompare(right)),
        findings: governanceFindings,
      },
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

export function renderMarkdownPortfolioReport(report: AnalysisPortfolioReport): string {
  const ownerLines = report.inventories.owners.map(
    (owner) => `- \`${owner.owner}\`: ${owner.projectCount} projects, ${owner.assetCount} assets, ${owner.providerBindingCount} bindings`
  );
  const assetLines = report.inventories.assetUsage.map(
    (asset) =>
      `- \`${asset.assetName}\` (${asset.kind}): ${asset.projectCount} projects${asset.missingInProjects.length > 0 ? `, missing in ${asset.missingInProjects.length}` : ''}`
  );
  const driftLines = report.drift.findings.map((finding) => `- \`${finding.subject}\`: ${finding.message}`);
  const governanceLines = report.governance.findings.map(
    (finding) => `- [${finding.severity}] \`${finding.code}\` in \`${finding.projectRoot}\`: ${finding.message}`
  );

  return [
    '# Portfolio Report',
    '',
    `- Projects: ${report.summary.projectCount}`,
    `- Owners: ${report.summary.owners.length}`,
    `- Unowned projects: ${report.summary.unownedProjectCount}`,
    `- Environments: ${report.summary.environmentCount}`,
    `- Assets: ${report.summary.assetCount}`,
    `- Provider bindings: ${report.summary.providerBindingCount}`,
    `- Parameters: ${report.summary.parameterCount}`,
    `- Drift findings: ${report.summary.driftCount}`,
    `- Governance findings: ${report.summary.governanceFindingCount}`,
    '',
    '## Ownership',
    ownerLines.length > 0 ? ownerLines.join('\n') : '- None',
    '',
    '## Asset usage',
    assetLines.length > 0 ? assetLines.join('\n') : '- None',
    '',
    '## Drift',
    driftLines.length > 0 ? driftLines.join('\n') : '- None',
    '',
    '## Governance',
    governanceLines.length > 0 ? governanceLines.join('\n') : '- None',
  ].join('\n');
}

function toPortfolioProjectSummary(project: ProjectContext): PortfolioProjectSummary {
  return {
    root: project.root,
    configPath: project.configPath,
    owner: project.docs?.owner,
    docsPaths: [...(project.docs?.paths ?? [])].sort((left, right) => left.localeCompare(right)),
    templateRegistries: [...project.templateRegistries].sort((left, right) => left.localeCompare(right)),
    summary: summarizeProject(project),
    topology: {
      defaultStage: project.topology.defaultStage,
      selectedStage: project.topology.selectedStage,
      activeEnvironment: project.topology.activeEnvironment,
      activeSolution: project.topology.activeSolution?.uniqueName,
      stages: Object.values(project.topology.stages)
        .map((stage) => ({
          name: stage.name,
          environment: stage.environment,
          defaultSolution: stage.defaultSolution?.uniqueName,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    },
    assets: project.assets
      .map((asset) => ({
        name: asset.name,
        path: asset.path,
        relativePath: relative(project.root, asset.path),
        kind: asset.kind,
        exists: asset.exists,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    providerBindings: Object.entries(project.providerBindings)
      .map(([name, binding]) => ({
        name,
        kind: binding.kind,
        target: binding.target,
        hasMetadata: Boolean(binding.metadata && Object.keys(binding.metadata).length > 0),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    parameters: Object.values(project.parameters)
      .map((parameter) => {
        const summary = summarizeResolvedParameter(parameter);
        return {
          name: summary.name,
          type: summary.type,
          source: summary.source,
          hasValue: summary.hasValue,
          sensitive: summary.sensitive,
          reference: summary.reference,
          mappings: [...summary.mappings].sort((left, right) =>
            `${left.kind}:${left.target}`.localeCompare(`${right.kind}:${right.target}`)
          ),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function buildOwnerInventory(projects: PortfolioProjectSummary[]): PortfolioOwnerInventoryEntry[] {
  const byOwner = new Map<string, PortfolioOwnerInventoryEntry>();

  for (const project of projects) {
    if (!project.owner) {
      continue;
    }

    const current = byOwner.get(project.owner) ?? {
      owner: project.owner,
      projectCount: 0,
      projectRoots: [],
      assetCount: 0,
      providerBindingCount: 0,
    };
    current.projectCount += 1;
    current.projectRoots.push(project.root);
    current.assetCount += project.assets.length;
    current.providerBindingCount += project.providerBindings.length;
    byOwner.set(project.owner, current);
  }

  return [...byOwner.values()]
    .map((entry) => ({
      ...entry,
      projectRoots: entry.projectRoots.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.owner.localeCompare(right.owner));
}

function buildAssetUsageInventory(projects: PortfolioProjectSummary[]): PortfolioAssetUsageEntry[] {
  const byAsset = new Map<string, PortfolioAssetUsageEntry>();

  for (const project of projects) {
    for (const asset of project.assets) {
      const key = `${asset.name}::${asset.kind}`;
      const current = byAsset.get(key) ?? {
        assetName: asset.name,
        kind: asset.kind,
        projectCount: 0,
        projectRoots: [],
        missingInProjects: [],
        relativePaths: [],
      };
      current.projectCount += 1;
      current.projectRoots.push(project.root);
      current.relativePaths.push(asset.relativePath);
      if (!asset.exists) {
        current.missingInProjects.push(project.root);
      }
      byAsset.set(key, current);
    }
  }

  return [...byAsset.values()]
    .map((entry) => ({
      ...entry,
      projectRoots: entry.projectRoots.sort((left, right) => left.localeCompare(right)),
      missingInProjects: entry.missingInProjects.sort((left, right) => left.localeCompare(right)),
      relativePaths: [...new Set(entry.relativePaths)].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => `${left.assetName}:${left.kind}`.localeCompare(`${right.assetName}:${right.kind}`));
}

function buildProviderUsageInventory(projects: PortfolioProjectSummary[]): PortfolioProviderUsageEntry[] {
  const byBinding = new Map<string, PortfolioProviderUsageEntry>();

  for (const project of projects) {
    for (const binding of project.providerBindings) {
      const key = `${binding.name}::${binding.kind}::${binding.target}`;
      const current = byBinding.get(key) ?? {
        bindingName: binding.name,
        kind: binding.kind,
        target: binding.target,
        projectCount: 0,
        projectRoots: [],
      };
      current.projectCount += 1;
      current.projectRoots.push(project.root);
      byBinding.set(key, current);
    }
  }

  return [...byBinding.values()]
    .map((entry) => ({
      ...entry,
      projectRoots: entry.projectRoots.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => `${left.bindingName}:${left.kind}:${left.target}`.localeCompare(`${right.bindingName}:${right.kind}:${right.target}`));
}

function buildParameterUsageInventory(projects: PortfolioProjectSummary[]): PortfolioParameterUsageEntry[] {
  const byParameter = new Map<string, PortfolioParameterUsageEntry>();

  for (const project of projects) {
    for (const parameter of project.parameters) {
      const current = byParameter.get(parameter.name) ?? {
        parameterName: parameter.name,
        projectCount: 0,
        projectRoots: [],
        missingInProjects: [],
        mappingKinds: [],
      };
      current.projectCount += 1;
      current.projectRoots.push(project.root);
      current.mappingKinds.push(...parameter.mappings.map((mapping) => mapping.kind));
      byParameter.set(parameter.name, current);
    }
  }

  return [...byParameter.values()]
    .map((entry) => ({
      ...entry,
      projectRoots: entry.projectRoots.sort((left, right) => left.localeCompare(right)),
      missingInProjects: projects.filter((project) => !project.parameters.some((parameter) => parameter.name === entry.parameterName)).map((project) => project.root),
      mappingKinds: [...new Set(entry.mappingKinds)].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.parameterName.localeCompare(right.parameterName));
}

function buildDriftFindings(projects: PortfolioProjectSummary[]): PortfolioDriftFinding[] {
  const findings: PortfolioDriftFinding[] = [];
  findings.push(
    ...buildVariantFindings(projects, 'topology-stage', 'PORTFOLIO_STAGE_DRIFT', (project) =>
      project.topology.stages.map((stage) => ({
        subject: stage.name,
        signature: `${stage.environment ?? 'unset'}|${stage.defaultSolution ?? 'unset'}`,
      }))
    )
  );
  findings.push(
    ...buildVariantFindings(projects, 'provider-binding', 'PORTFOLIO_PROVIDER_BINDING_DRIFT', (project) =>
      project.providerBindings.map((binding) => ({
        subject: binding.name,
        signature: `${binding.kind}|${binding.target}`,
      }))
    )
  );
  findings.push(
    ...buildVariantFindings(projects, 'parameter', 'PORTFOLIO_PARAMETER_DRIFT', (project) =>
      project.parameters.map((parameter) => ({
        subject: parameter.name,
        signature: `${parameter.type}|${parameter.sensitive ? 'sensitive' : 'plain'}|${parameter.mappings.map((mapping) => `${mapping.kind}:${mapping.target}`).join(',')}`,
      }))
    )
  );
  findings.push(
    ...buildVariantFindings(projects, 'asset', 'PORTFOLIO_ASSET_DRIFT', (project) =>
      project.assets.map((asset) => ({
        subject: asset.name,
        signature: `${asset.kind}|${asset.relativePath}`,
      }))
    )
  );

  return findings.sort((left, right) => `${left.assetClass}:${left.subject}`.localeCompare(`${right.assetClass}:${right.subject}`));
}

function buildVariantFindings(
  projects: PortfolioProjectSummary[],
  assetClass: PortfolioDriftFinding['assetClass'],
  code: PortfolioDriftFinding['code'],
  projectEntries: (project: PortfolioProjectSummary) => Array<{ subject: string; signature: string }>
): PortfolioDriftFinding[] {
  const subjects = new Map<string, Map<string, string[]>>();

  for (const project of projects) {
    for (const entry of projectEntries(project)) {
      const variants = subjects.get(entry.subject) ?? new Map<string, string[]>();
      const roots = variants.get(entry.signature) ?? [];
      roots.push(project.root);
      variants.set(entry.signature, roots);
      subjects.set(entry.subject, variants);
    }
  }

  return [...subjects.entries()]
    .filter(([, variants]) => variants.size > 1)
    .map(([subject, variants]) => ({
      code,
      assetClass,
      subject,
      message: `${assetClass} ${subject} differs across ${variants.size} portfolio variants`,
      variants: [...variants.entries()]
        .map(([signature, projectRoots]) => ({
          signature,
          projectRoots: projectRoots.sort((left, right) => left.localeCompare(right)),
        }))
        .sort((left, right) => left.signature.localeCompare(right.signature)),
    }));
}

function buildGovernanceFindings(
  projects: PortfolioProjectSummary[],
  allowedProviderKinds: string[]
): PortfolioGovernanceFinding[] {
  const allowed = new Set(allowedProviderKinds);
  const findings: PortfolioGovernanceFinding[] = [];

  for (const project of projects) {
    if (!project.owner) {
      findings.push({
        severity: 'warning',
        category: 'ownership',
        code: 'PORTFOLIO_OWNER_MISSING',
        projectRoot: project.root,
        subject: 'docs.owner',
        message: 'Project is missing a documented owner for portfolio governance review.',
      });
    }

    if (project.docsPaths.length === 0) {
      findings.push({
        severity: 'warning',
        category: 'provenance',
        code: 'PORTFOLIO_PROVENANCE_MISSING',
        projectRoot: project.root,
        subject: 'docs.paths',
        message: 'Project does not declare documentation or provenance paths for portfolio context packs.',
      });
    }

    for (const binding of project.providerBindings) {
      if (!allowed.has(binding.kind)) {
        findings.push({
          severity: 'warning',
          category: 'connector',
          code: 'PORTFOLIO_UNSUPPORTED_PROVIDER_KIND',
          projectRoot: project.root,
          subject: binding.name,
          message: `Provider binding kind ${binding.kind} is outside the allowed portfolio governance set.`,
        });
      }
    }

    for (const asset of project.assets) {
      if (!asset.exists) {
        findings.push({
          severity: 'error',
          category: 'dependency',
          code: 'PORTFOLIO_MISSING_ASSET',
          projectRoot: project.root,
          subject: asset.name,
          message: `Configured asset ${asset.name} is missing at ${asset.relativePath}.`,
        });
      }
    }

    for (const missing of project.summary.missingRequiredParameters) {
      findings.push({
        severity: 'error',
        category: 'dependency',
        code: 'PORTFOLIO_REQUIRED_PARAMETER_MISSING',
        projectRoot: project.root,
        subject: missing,
        message: `Required parameter ${missing} is unresolved.`,
      });
    }

    for (const parameter of project.parameters) {
      if (parameter.sensitive && parameter.source === 'value') {
        findings.push({
          severity: 'warning',
          category: 'mutation-surface',
          code: 'PORTFOLIO_UNSAFE_SENSITIVE_VALUE',
          projectRoot: project.root,
          subject: parameter.name,
          message: `Sensitive parameter ${parameter.name} is stored as a literal value instead of an environment or secret reference.`,
        });
      }
    }
  }

  return findings.sort((left, right) => `${left.projectRoot}:${left.code}:${left.subject}`.localeCompare(`${right.projectRoot}:${right.code}:${right.subject}`));
}
