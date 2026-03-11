import {
  discoverProject,
  doctorProject,
  feedbackProject,
  initProject,
  planProjectInit,
  summarizeProject,
  summarizeProjectContract,
  summarizeResolvedParameter,
  type ProjectContext,
  type ProjectDoctorReport,
  type ProjectFeedbackReport,
  type ProjectInitPlan,
  type ProjectInitResult,
} from '@pp/project';
import type { OperationResult } from '@pp/diagnostics';
import { createMutationPreview, readMutationFlags, renderOutput, type CliOutputFormat } from './contract';

type OutputFormat = CliOutputFormat;

interface ProjectDiscoveryInput {
  stage?: string;
  parameterOverrides?: Record<string, string>;
}

interface ProjectCommandDependencies {
  positionalArgs(args: string[]): string[];
  resolveInvocationPath(path?: string): string;
  outputFormat(args: string[], fallback: OutputFormat): OutputFormat;
  readProjectDiscoveryOptions(args: string[]): OperationResult<ProjectDiscoveryInput>;
  printFailure(result: OperationResult<unknown>): number;
  printByFormat(value: unknown, format: OutputFormat): void;
  isMachineReadableOutputFormat(format: OutputFormat): boolean;
  printResultDiagnostics(result: OperationResult<unknown>, format: OutputFormat): void;
  readFlag(args: string[], name: string): string | undefined;
  readEnvironmentAlias(args: string[]): string | undefined;
  hasFlag(args: string[], name: string): boolean;
}

export async function runProjectInspectCommand(args: string[], deps: ProjectCommandDependencies): Promise<number> {
  const path = deps.resolveInvocationPath(deps.positionalArgs(args)[0]);
  const format = deps.outputFormat(args, 'json');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const project = await discoverProject(path, discoveryOptions.data);

  if (!project.success || !project.data) {
    return deps.printFailure(project);
  }

  const payload = {
    success: true,
    canonicalProjectRoot: project.data.root,
    summary: summarizeProject(project.data),
    contract: summarizeProjectContract(project.data),
    discovery:
      project.data.discovery.usedDefaultLayout || project.data.discovery.autoSelectedProjectRoot ? project.data.discovery : undefined,
    topology: project.data.topology,
    providerBindings: project.data.providerBindings,
    parameters: Object.fromEntries(
      Object.values(project.data.parameters).map((parameter) => [parameter.name, summarizeResolvedParameter(parameter)])
    ),
    assets: project.data.assets,
    templateRegistries: project.data.templateRegistries,
    build: project.data.build,
    docs: project.data.docs,
    diagnostics: project.diagnostics,
    warnings: project.warnings,
    suggestedNextActions: project.suggestedNextActions ?? [],
    supportTier: project.supportTier,
    provenance: project.provenance,
    knownLimitations: project.knownLimitations,
  };

  if (format === 'table' || format === 'markdown') {
    process.stdout.write(renderProjectInspectOutput(project.data, format));
  } else {
    deps.printByFormat(payload, format);
  }
  if (!deps.isMachineReadableOutputFormat(format)) {
    deps.printResultDiagnostics(project, format);
  }
  return 0;
}

export async function runProjectInitCommand(args: string[], deps: ProjectCommandDependencies): Promise<number> {
  const root = deps.resolveInvocationPath(deps.positionalArgs(args)[0]);
  const format = deps.outputFormat(args, 'json');
  const options = {
    name: deps.readFlag(args, '--name'),
    environment: deps.readEnvironmentAlias(args),
    solution: deps.readFlag(args, '--solution'),
    stage: deps.readFlag(args, '--stage'),
    force: deps.hasFlag(args, '--force'),
  } as const;
  const plan = planProjectInit(root, options);
  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return deps.printFailure(mutation);
  }

  if (mutation.data.mode !== 'apply') {
    const payload = createMutationPreview('project.init', mutation.data, { root: plan.root, configPath: plan.configPath }, plan);

    if (deps.isMachineReadableOutputFormat(format)) {
      deps.printByFormat(payload, format);
    } else {
      process.stdout.write(renderProjectInitOutput(plan, format as Extract<OutputFormat, 'table' | 'markdown' | 'raw'>, mutation.data.mode));
    }
    return 0;
  }

  const result = await initProject(root, options);

  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  if (deps.isMachineReadableOutputFormat(format)) {
    deps.printByFormat(result.data, format);
  } else {
    process.stdout.write(renderProjectInitOutput(result.data, format as Extract<OutputFormat, 'table' | 'markdown' | 'raw'>));
  }
  deps.printResultDiagnostics(result, format);
  return 0;
}

export async function runProjectDoctorCommand(args: string[], deps: ProjectCommandDependencies): Promise<number> {
  const root = deps.resolveInvocationPath(deps.positionalArgs(args)[0]);
  const format = deps.outputFormat(args, 'json');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const result = await doctorProject(root, discoveryOptions.data);

  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  if (format === 'table' || format === 'markdown') {
    process.stdout.write(renderProjectDoctorOutput(result.data, format));
  } else {
    deps.printByFormat(
      {
        success: true,
        ...result.data,
        diagnostics: result.diagnostics,
        warnings: result.warnings,
        suggestedNextActions: result.suggestedNextActions ?? [],
        supportTier: result.supportTier,
        provenance: result.provenance,
        knownLimitations: result.knownLimitations,
      },
      format
    );
  }
  if (!deps.isMachineReadableOutputFormat(format)) {
    deps.printResultDiagnostics(result, format);
  }
  return 0;
}

export async function runProjectFeedbackCommand(args: string[], deps: ProjectCommandDependencies): Promise<number> {
  const root = deps.resolveInvocationPath(deps.positionalArgs(args)[0]);
  const format = deps.outputFormat(args, 'json');
  const discoveryOptions = deps.readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return deps.printFailure(discoveryOptions);
  }

  const result = await feedbackProject(root, discoveryOptions.data);

  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  if (format === 'table' || format === 'markdown') {
    process.stdout.write(renderProjectFeedbackOutput(result.data, format));
  } else {
    deps.printByFormat(result.data, format);
  }
  if (!deps.isMachineReadableOutputFormat(format)) {
    deps.printResultDiagnostics(result, format);
  }
  return 0;
}

function renderProjectInitOutput(
  result: ProjectInitPlan | ProjectInitResult,
  format: Extract<OutputFormat, 'table' | 'markdown' | 'raw'>,
  mode: 'apply' | 'dry-run' | 'plan' = 'apply'
): string {
  const createdPaths = 'created' in result ? result.created : [];
  const overwrittenPaths = 'overwritten' in result ? result.overwritten : [];
  const untouchedPaths = 'untouched' in result ? result.untouched : [];
  const modeLabel = mode === 'apply' ? 'Applied scaffold' : mode === 'plan' ? 'Scaffold plan' : 'Dry-run scaffold preview';
  const actionRows = result.actions.map((action) => ({
    action: action.action,
    kind: action.kind,
    path: action.path,
  }));
  const summaryRows = [
    { field: 'mode', value: modeLabel },
    { field: 'root', value: result.root },
    { field: 'config', value: result.configPath },
    { field: 'source roots', value: result.preview.editableAssetRoots.join(', ') },
    { field: 'artifact root', value: result.preview.artifactRoots.join(', ') },
    { field: 'bundle output', value: result.preview.recommendedBundlePath },
    { field: 'default target', value: formatProjectContractTarget(result.contract.defaultTarget) },
  ];

  if (format === 'table') {
    return [
      renderOutput(summaryRows, 'table').trimEnd(),
      '',
      'Scaffold shape',
      renderOutput(result.preview.entries, 'table').trimEnd(),
      '',
      'Layout preview',
      ...result.preview.layoutLines,
      '',
      'Source-to-artifact contract',
      ...result.preview.relationshipSummary.map((line) => `- ${line}`),
      '',
      'Planned filesystem actions',
      renderOutput(actionRows, 'table').trimEnd(),
      ...('created' in result
        ? [
            '',
            `Created: ${createdPaths.length > 0 ? createdPaths.join(', ') : '(none)'}`,
            `Overwritten: ${overwrittenPaths.length > 0 ? overwrittenPaths.join(', ') : '(none)'}`,
            `Untouched: ${untouchedPaths.length > 0 ? untouchedPaths.join(', ') : '(none)'}`,
          ]
        : []),
      '',
    ].join('\n');
  }

  return [
    `# ${modeLabel}`,
    '',
    `- Root: \`${result.root}\``,
    `- Config: \`${result.configPath}\``,
    `- Source roots: ${result.preview.editableAssetRoots.map((value) => `\`${value}\``).join(', ')}`,
    `- Artifact root: ${result.preview.artifactRoots.map((value) => `\`${value}\``).join(', ')}`,
    `- Bundle output: \`${result.preview.recommendedBundlePath}\``,
    `- Default target: ${formatProjectContractTarget(result.contract.defaultTarget)}`,
    '',
    '## Scaffold Shape',
    ...result.preview.entries.map((entry) => `- \`${entry.path}\` (${entry.kind}): ${entry.purpose}`),
    '',
    '## Layout Preview',
    '```text',
    ...result.preview.layoutLines,
    '```',
    '',
    '## Source-to-Artifact Contract',
    ...result.preview.relationshipSummary.map((line) => `- ${line}`),
    '',
    '## Filesystem Actions',
    ...actionRows.map((row) => `- ${row.action} ${row.kind} \`${row.path}\``),
    ...('created' in result
      ? [
          '',
          '## Result',
          `- Created: ${createdPaths.length > 0 ? createdPaths.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
          `- Overwritten: ${overwrittenPaths.length > 0 ? overwrittenPaths.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
          `- Untouched: ${untouchedPaths.length > 0 ? untouchedPaths.map((value) => `\`${value}\``).join(', ') : '(none)'}`,
        ]
      : []),
    '',
  ].join('\n');
}

function renderProjectInspectOutput(project: ProjectContext, format: Extract<OutputFormat, 'table' | 'markdown'>): string {
  const summary = summarizeProject(project);
  const contract = summarizeProjectContract(project);
  const discoveryNote = summarizeProjectDiscoveryNote(project.discovery);
  const parameterRows = Object.values(project.parameters).map((parameter) => ({
    name: parameter.name,
    source: parameter.source,
    required: parameter.definition.required ? 'yes' : 'no',
    value: parameter.hasValue ? (parameter.sensitive ? '<secret>' : String(parameter.value)) : '<missing>',
  }));
  const assetRows = project.assets.map((asset) => ({
    asset: asset.name,
    kind: asset.kind,
    exists: asset.exists ? 'yes' : 'no',
    path: asset.path,
  }));
  const bindingRows = Object.entries(project.providerBindings).map(([name, binding]) => ({
    binding: name,
    kind: binding.kind,
    target: binding.target,
  }));
  const summaryRows = [
    { field: 'inspected path', value: project.discovery.inspectedPath },
    { field: 'canonical project root', value: project.root },
    { field: 'config path', value: project.configPath ?? '<default layout>' },
    { field: 'selected stage', value: summary.selectedStage ?? '<unset>' },
    { field: 'active environment', value: summary.activeEnvironment ?? '<unset>' },
    { field: 'active solution', value: summary.activeSolution ?? '<unset>' },
    { field: 'editable roots', value: contract.editableAssetRoots.join(', ') || '<none>' },
    { field: 'solution source root', value: contract.solutionSourceRoot },
    { field: 'canonical bundle path', value: contract.canonicalBundlePath },
  ];

  if (format === 'table') {
    return [
      renderOutput(summaryRows, 'table').trimEnd(),
      discoveryNote ? '' : undefined,
      discoveryNote ? `Discovery: ${discoveryNote}` : undefined,
      '',
      `Layout contract: editable assets belong under ${contract.editableAssetRoots.join(', ') || '<none>'}; keep unpacked solution source in ${contract.solutionSourceRoot}; write generated solution zips to ${contract.canonicalBundlePath}.`,
      `Deployment route: ${contract.deploymentRouteSummary}`,
      '',
      'Assets',
      renderOutput(assetRows, 'table').trimEnd(),
      '',
      'Parameters',
      renderOutput(parameterRows, 'table').trimEnd(),
      ...(bindingRows.length > 0 ? ['', 'Provider bindings', renderOutput(bindingRows, 'table').trimEnd()] : []),
      '',
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n');
  }

  return [
    '# Project Inspect',
    '',
    `- Inspected path: \`${project.discovery.inspectedPath}\``,
    `- Canonical project root: \`${project.root}\``,
    `- Config path: \`${project.configPath ?? '<default layout>'}\``,
    `- Selected stage: \`${summary.selectedStage ?? '<unset>'}\``,
    `- Active environment: \`${summary.activeEnvironment ?? '<unset>'}\``,
    `- Active solution: \`${summary.activeSolution ?? '<unset>'}\``,
    `- Editable roots: \`${contract.editableAssetRoots.join('`, `') || '<none>'}\``,
    `- Solution source root: \`${contract.solutionSourceRoot}\``,
    `- Canonical bundle path: \`${contract.canonicalBundlePath}\``,
    ...(discoveryNote ? ['', `Discovery: ${discoveryNote}`] : []),
    '',
    `Layout contract: editable assets belong under ${contract.editableAssetRoots.join(', ') || '<none>'}; keep unpacked solution source in ${contract.solutionSourceRoot}; write generated solution zips to ${contract.canonicalBundlePath}.`,
    `Deployment route: ${contract.deploymentRouteSummary}`,
    '',
    '## Assets',
    ...assetRows.map((row) => `- \`${row.asset}\` (${row.kind}, exists=${row.exists}): \`${row.path}\``),
    '',
    '## Parameters',
    ...(parameterRows.length > 0
      ? parameterRows.map((row) => `- \`${row.name}\` from ${row.source} (required=${row.required}): \`${row.value}\``)
      : ['- None']),
    ...(bindingRows.length > 0
      ? ['', '## Provider Bindings', ...bindingRows.map((row) => `- \`${row.binding}\` (${row.kind}): \`${row.target}\``)]
      : []),
    '',
  ].join('\n');
}

function renderProjectDoctorOutput(report: ProjectDoctorReport, format: Extract<OutputFormat, 'table' | 'markdown'>): string {
  const summaryRows = [
    { field: 'inspected path', value: report.inspectedPath },
    { field: 'canonical project root', value: report.canonicalProjectRoot },
    { field: 'config path', value: report.configPath ?? '<default layout>' },
    { field: 'layout profile', value: report.summary.layoutProfile },
    { field: 'canonical bundle path', value: report.summary.canonicalBundlePath },
    { field: 'bundle status', value: report.summary.canonicalBundlePresent ? 'present' : 'not generated yet' },
    { field: 'bundle placement', value: `${report.summary.bundlePlacementStatus}: ${report.summary.bundlePlacementSummary}` },
    { field: 'selected stage', value: report.topology.selectedStage ?? '<unset>' },
    { field: 'active target', value: report.summary.activeTargetSummary },
  ];
  const discoveryNote = summarizeProjectDiscoveryNote(report.discovery);
  const checkRows = report.checks.map((check) => ({
    status: check.status,
    code: check.code,
    message: check.message,
    path: check.path ?? '',
  }));

  if (format === 'table') {
    return [
      renderOutput(summaryRows, 'table').trimEnd(),
      discoveryNote ? '' : undefined,
      discoveryNote ? `Discovery: ${discoveryNote}` : undefined,
      report.summary.environmentAliasProvenance ? '' : undefined,
      report.summary.environmentAliasProvenance ? `Environment alias provenance: ${report.summary.environmentAliasProvenance}` : undefined,
      '',
      'Deployment route',
      ...report.summary.deploymentRouteSteps.map((step, index) => `${index + 1}. ${step}`),
      '',
      `Bundle lifecycle: ${report.summary.bundleLifecycleSummary}`,
      '',
      'Checks',
      renderOutput(checkRows, 'table').trimEnd(),
      '',
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n');
  }

  return [
    '# Project Doctor',
    '',
    `- Inspected path: \`${report.inspectedPath}\``,
    `- Canonical project root: \`${report.canonicalProjectRoot}\``,
    `- Config path: \`${report.configPath ?? '<default layout>'}\``,
    `- Layout profile: \`${report.summary.layoutProfile}\``,
    `- Canonical bundle path: \`${report.summary.canonicalBundlePath}\``,
    `- Bundle status: \`${report.summary.canonicalBundlePresent ? 'present' : 'not generated yet'}\``,
    `- Bundle placement: \`${report.summary.bundlePlacementStatus}\``,
    `- Bundle placement summary: ${report.summary.bundlePlacementSummary}`,
    `- Selected stage: \`${report.topology.selectedStage ?? '<unset>'}\``,
    `- Active target: ${report.summary.activeTargetSummary}`,
    ...(report.summary.environmentAliasProvenance ? [`- Environment alias provenance: ${report.summary.environmentAliasProvenance}`] : []),
    `- Bundle lifecycle: ${report.summary.bundleLifecycleSummary}`,
    ...(discoveryNote ? ['', `Discovery: ${discoveryNote}`] : []),
    '',
    '## Deployment Route',
    ...report.summary.deploymentRouteSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Checks',
    ...report.checks.map((check) => `- \`${check.status}\` \`${check.code}\`: ${check.message}`),
    '',
  ].join('\n');
}

function renderProjectFeedbackOutput(report: ProjectFeedbackReport, format: Extract<OutputFormat, 'table' | 'markdown'>): string {
  const summaryRows = [
    { field: 'inspected path', value: report.inspectedPath },
    { field: 'canonical project root', value: report.canonicalProjectRoot },
    { field: 'config path', value: report.configPath ?? '<default layout>' },
    { field: 'layout profile', value: report.summary.layoutProfile },
    { field: 'canonical bundle path', value: report.summary.canonicalBundlePath },
    { field: 'bundle status', value: report.summary.canonicalBundlePresent ? 'present' : 'not generated yet' },
    { field: 'bundle placement', value: `${report.summary.bundlePlacementStatus}: ${report.summary.bundlePlacementSummary}` },
    { field: 'deployment route', value: report.summary.deploymentRouteSummary },
  ];
  const discoveryNote = summarizeProjectDiscoveryNote(report.discovery);
  const workflowWinsRows = report.workflowWins.map((item) => ({ title: item.title, detail: item.detail }));
  const frictionRows = report.frictions.map((item) => ({
    title: item.title,
    detail: item.detail,
    evidence: (item.evidence ?? []).join(', '),
  }));
  const taskRows = report.recommendedTasks.map((item) => ({
    task: item.title,
    rationale: item.rationale,
  }));

  if (format === 'table') {
    return [
      renderOutput(summaryRows, 'table').trimEnd(),
      discoveryNote ? '' : undefined,
      discoveryNote ? `Discovery: ${discoveryNote}` : undefined,
      '',
      'Deployment route',
      ...report.summary.deploymentRouteSteps.map((step, index) => `${index + 1}. ${step}`),
      '',
      'Workflow wins',
      renderOutput(workflowWinsRows, 'table').trimEnd(),
      '',
      'Frictions',
      renderOutput(frictionRows, 'table').trimEnd(),
      '',
      'Recommended tasks',
      renderOutput(taskRows, 'table').trimEnd(),
      '',
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n');
  }

  return [
    '# Project Feedback',
    '',
    `- Inspected path: \`${report.inspectedPath}\``,
    `- Canonical project root: \`${report.canonicalProjectRoot}\``,
    `- Config path: \`${report.configPath ?? '<default layout>'}\``,
    `- Layout profile: \`${report.summary.layoutProfile}\``,
    `- Canonical bundle path: \`${report.summary.canonicalBundlePath}\``,
    `- Bundle status: \`${report.summary.canonicalBundlePresent ? 'present' : 'not generated yet'}\``,
    `- Bundle placement: \`${report.summary.bundlePlacementStatus}\``,
    `- Bundle placement summary: ${report.summary.bundlePlacementSummary}`,
    `- Deployment route: ${report.summary.deploymentRouteSummary}`,
    ...(discoveryNote ? ['', `Discovery: ${discoveryNote}`] : []),
    '',
    '## Deployment Route',
    ...report.summary.deploymentRouteSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Workflow Wins',
    ...(report.workflowWins.length > 0
      ? report.workflowWins.map((item) => renderProjectObservation(item.title, item.detail, item.evidence))
      : ['- None']),
    '',
    '## Frictions',
    ...(report.frictions.length > 0
      ? report.frictions.map((item) => renderProjectObservation(item.title, item.detail, item.evidence))
      : ['- None']),
    '',
    '## Recommended Tasks',
    ...report.recommendedTasks.map((item) => `- ${item.title}: ${item.rationale}`),
    '',
  ].join('\n');
}

function summarizeProjectDiscoveryNote(
  discovery?: Pick<ProjectContext['discovery'], 'inspectedPath' | 'autoSelectedProjectRoot' | 'canonicalAnchorReason'>
): string | undefined {
  if (!discovery?.autoSelectedProjectRoot) {
    return undefined;
  }

  return discovery.canonicalAnchorReason
    ? `${discovery.canonicalAnchorReason} Inspected path: ${discovery.inspectedPath}.`
    : `Auto-selected descendant project root ${discovery.autoSelectedProjectRoot} from ${discovery.inspectedPath}.`;
}

function renderProjectObservation(title: string, detail: string, evidence: string[] | undefined): string {
  if (!evidence || evidence.length === 0) {
    return `- ${title}: ${detail}`;
  }

  return `- ${title}: ${detail} Evidence: ${evidence.map((item) => `\`${item}\``).join(', ')}`;
}

function formatProjectContractTarget(target: {
  stage?: string;
  environmentAlias?: string;
  solutionAlias?: string;
  solutionUniqueName?: string;
}): string {
  return `stage ${target.stage ?? '<unset>'} -> environment ${target.environmentAlias ?? '<unset>'} -> solution ${target.solutionUniqueName ?? target.solutionAlias ?? '<unset>'}`;
}
