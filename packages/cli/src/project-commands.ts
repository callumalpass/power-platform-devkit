import {
  compareProjectRuntimeTarget,
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
  type ProjectDoctorCheck,
  type ProjectFeedbackReport,
  type ProjectInitPlan,
  type ProjectInitResult,
  type ProjectRuntimeTargetComparison,
} from '@pp/project';
import { createDiagnostic, fail, type OperationResult } from '@pp/diagnostics';
import type { ConfigStoreOptions } from '@pp/config';
import { createMutationPreview, readMutationFlags, renderOutput, type CliOutputFormat } from './contract';
import { buildProjectRelationshipSummary } from './relationship-context';

type OutputFormat = CliOutputFormat;

interface ProjectDiscoveryInput {
  stage?: string;
  parameterOverrides?: Record<string, string>;
}

type ProjectTargetComparison = ProjectRuntimeTargetComparison | undefined;

interface ProjectCommandDependencies {
  positionalArgs(args: string[]): string[];
  resolveInvocationPath(path?: string): string;
  outputFormat(args: string[], fallback: OutputFormat): OutputFormat;
  readProjectDiscoveryOptions(args: string[]): OperationResult<ProjectDiscoveryInput>;
  readConfigOptions(args: string[]): ConfigStoreOptions;
  printFailure(result: OperationResult<unknown>): number;
  printFailureWithMachinePayload(result: OperationResult<unknown>, format: OutputFormat): number;
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

  const configOptions = deps.readConfigOptions(args);
  const relationships = await buildProjectRelationshipSummary(project.data, configOptions);
  const targetComparison = await resolveProjectTargetComparison(project.data, deps.readEnvironmentAlias(args), configOptions);
  const requestedStage = discoveryOptions.data.stage;
  const stageNotFound = project.diagnostics.find((diagnostic) => diagnostic.code === 'PROJECT_STAGE_NOT_FOUND');

  if (requestedStage && stageNotFound) {
    const failure = fail(
      createDiagnostic('error', 'PROJECT_STAGE_NOT_FOUND', `Requested stage ${requestedStage} is not defined in project topology`, {
        source: '@pp/project',
      }),
      {
        supportTier: project.supportTier,
        details: {
          requestedStage,
          projectRoot: project.data.root,
          defaultStage: project.data.topology.defaultStage,
          activeEnvironment: project.data.topology.activeEnvironment,
          activeSolution: project.data.topology.activeSolution?.uniqueName,
          availableStages: Object.keys(project.data.topology.stages).sort((left, right) => left.localeCompare(right)),
        },
    suggestedNextActions: buildProjectInspectSuggestedNextActions(relationships, requestedStage, targetComparison),
      }
    );

    return deps.printFailureWithMachinePayload(failure, format);
  }

  const suggestedNextActions = buildProjectInspectSuggestedNextActions(relationships, undefined, targetComparison);
  const payload = {
    success: true,
    canonicalProjectRoot: project.data.root,
    summary: summarizeProject(project.data),
    contract: summarizeProjectContract(project.data),
    relationships,
    discovery:
      project.data.discovery.usedDefaultLayout || project.data.discovery.autoSelectedProjectRoot ? project.data.discovery : undefined,
    topology: project.data.topology,
    providerBindings: project.data.providerBindings,
    targetComparison,
    parameters: Object.fromEntries(
      Object.values(project.data.parameters).map((parameter) => [parameter.name, summarizeResolvedParameter(parameter)])
    ),
    assets: project.data.assets,
    templateRegistries: project.data.templateRegistries,
    build: project.data.build,
    docs: project.data.docs,
    diagnostics: project.diagnostics,
    warnings: project.warnings,
    suggestedNextActions,
    supportTier: project.supportTier,
    provenance: project.provenance,
    knownLimitations: project.knownLimitations,
  };

  if (format === 'table' || format === 'markdown') {
    process.stdout.write(renderProjectInspectOutput(project.data, relationships, targetComparison, format));
  } else {
    deps.printByFormat(payload, format);
  }
  if (!deps.isMachineReadableOutputFormat(format)) {
    deps.printResultDiagnostics(project, format);
  }
  return 0;
}

function buildProjectInspectSuggestedNextActions(
  relationships: Awaited<ReturnType<typeof buildProjectRelationshipSummary>>,
  requestedStage?: string,
  targetComparison?: ProjectTargetComparison
): string[] {
  const actions: string[] = [];
  const activeRelationship = relationships.stageRelationships.find((stage) => stage.stage === relationships.selectedStage) ?? relationships.stageRelationships[0];
  const environmentAlias = activeRelationship?.environmentAlias;
  const configuredStages = relationships.stageRelationships.map((stage) => stage.stage).filter((stage) => stage && stage !== '<unset>');

  if (requestedStage) {
    actions.push(`Choose one of the configured project stages instead: ${configuredStages.join(', ') || '<none>'}.`);
    actions.push('Re-run `pp project inspect --format json` without `--stage` to inspect the default project target.');
  }

  if (!requestedStage && configuredStages.length > 1) {
    const explicitStages = configuredStages.filter((stage) => stage !== relationships.selectedStage);
    actions.push(
      `Project topology exposes multiple stages (${configuredStages.join(', ')}); re-run \`pp project inspect --stage <stage> --format json\` before mutating a non-default environment target.`
    );
    for (const stage of explicitStages) {
      actions.push(`Run \`pp project inspect --stage ${stage} --format json\` to inspect that stage's environment and solution mapping explicitly.`);
    }
  }

  if (environmentAlias && (activeRelationship?.environmentStatus !== 'configured' || activeRelationship?.authProfileStatus !== 'configured')) {
    actions.push(`Run \`pp env inspect ${environmentAlias} --format json\` to inspect the external environment registry entry for alias ${environmentAlias}.`);
  }

  if (activeRelationship?.authProfile && activeRelationship.authProfileStatus === 'missing') {
    actions.push(
      `Run \`pp auth profile inspect ${activeRelationship.authProfile} --format json\` to verify the auth profile bound to environment alias ${environmentAlias ?? '<alias>'}.`
    );
  }

  if (
    environmentAlias &&
    activeRelationship?.environmentDefaultSolution &&
    activeRelationship.solutionUniqueName &&
    activeRelationship.solutionAlignment === 'mismatch'
  ) {
    actions.push(
      `Environment alias ${environmentAlias} defaults to solution ${activeRelationship.environmentDefaultSolution}, but the selected project stage targets ${activeRelationship.solutionUniqueName}; re-run \`pp project inspect --stage <stage> --format json\` or update \`pp.config.yaml\` if this workflow should follow the registry default.`
    );
  }

  for (const guidance of targetComparison?.guidance ?? []) {
    actions.push(guidance);
  }

  return [...new Set(actions)];
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
  const project = await discoverProject(root, discoveryOptions.data);
  const configOptions = deps.readConfigOptions(args);
  const relationships = project.success && project.data ? await buildProjectRelationshipSummary(project.data, configOptions) : undefined;
  const targetComparison =
    project.success && project.data ? await resolveProjectTargetComparison(project.data, deps.readEnvironmentAlias(args), configOptions) : undefined;
  const enrichedReport = enrichProjectDoctorReport(result.data, relationships, targetComparison);

  if (format === 'table' || format === 'markdown') {
    process.stdout.write(renderProjectDoctorOutput(enrichedReport, format));
  } else {
    deps.printByFormat(
      {
        success: true,
        ...enrichedReport,
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

  const project = await discoverProject(root, discoveryOptions.data);
  const targetComparison =
    project.success && project.data
      ? await resolveProjectTargetComparison(project.data, deps.readEnvironmentAlias(args), deps.readConfigOptions(args))
      : undefined;

  if (format === 'table' || format === 'markdown') {
    process.stdout.write(renderProjectFeedbackOutput(result.data, targetComparison, format));
  } else {
    deps.printByFormat({ ...result.data, targetComparison }, format);
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

function renderProjectInspectOutput(
  project: ProjectContext,
  relationships: Awaited<ReturnType<typeof buildProjectRelationshipSummary>>,
  targetComparison: ProjectTargetComparison,
  format: Extract<OutputFormat, 'table' | 'markdown'>
): string {
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
  const placementRows = contract.assetPlacementGuidance.map((entry) => ({
    asset: entry.asset,
    root: entry.root,
    expectation: entry.expectation,
  }));

  if (format === 'table') {
    return [
      renderOutput(summaryRows, 'table').trimEnd(),
      discoveryNote ? '' : undefined,
      discoveryNote ? `Discovery: ${discoveryNote}` : undefined,
      '',
      `Layout contract: editable assets belong under ${contract.editableAssetRoots.join(', ') || '<none>'}; keep unpacked solution source in ${contract.solutionSourceRoot}; write generated solution zips to ${contract.canonicalBundlePath}.`,
      `Deployment route: ${contract.deploymentRouteSummary}`,
      `Resolved relationship: ${relationships.activeRelationshipSummary}`,
      ...(targetComparison ? [`Runtime target comparison: ${targetComparison.summary}`] : []),
      `Project auth usage: ${relationships.authProfileUsageSummary}`,
      '',
      'Assets',
      renderOutput(assetRows, 'table').trimEnd(),
      '',
      'Placement guidance',
      renderOutput(placementRows, 'table').trimEnd(),
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
    `Resolved relationship: ${relationships.activeRelationshipSummary}`,
    ...(targetComparison ? [`Runtime target comparison: ${targetComparison.summary}`] : []),
    `Project auth usage: ${relationships.authProfileUsageSummary}`,
    '',
    '## Assets',
    ...assetRows.map((row) => `- \`${row.asset}\` (${row.kind}, exists=${row.exists}): \`${row.path}\``),
    '',
    '## Placement Guidance',
    ...placementRows.map((row) => `- \`${row.asset}\` -> \`${row.root}\`: ${row.expectation}`),
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

function renderProjectDoctorOutput(
  report: ProjectDoctorReport & {
    relationships?: Awaited<ReturnType<typeof buildProjectRelationshipSummary>>;
    targetComparison?: ProjectTargetComparison;
  },
  format: Extract<OutputFormat, 'table' | 'markdown'>
): string {
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
  const checkGroups = report.checkGroups ?? categorizeProjectDoctorChecks(report.checks);
  const checkRows = report.checks.map((check) => ({
    status: check.status,
    code: check.code,
    message: check.message,
    path: check.path ?? '',
  }));
  const localCheckRows = checkGroups.localLayout.map((check) => ({
    status: check.status,
    code: check.code,
    message: check.message,
    path: check.path ?? '',
  }));
  const externalCheckRows = checkGroups.externalTargeting.map((check) => ({
    status: check.status,
    code: check.code,
    message: check.message,
    path: check.path ?? '',
  }));
  const placementRows = report.contract.assetPlacementGuidance.map((entry) => ({
    asset: entry.asset,
    root: entry.root,
    expectation: entry.expectation,
  }));

  if (format === 'table') {
    return [
      renderOutput(summaryRows, 'table').trimEnd(),
      discoveryNote ? '' : undefined,
      discoveryNote ? `Discovery: ${discoveryNote}` : undefined,
      report.summary.environmentAliasProvenance ? '' : undefined,
      report.summary.environmentAliasProvenance ? `Environment alias provenance: ${report.summary.environmentAliasProvenance}` : undefined,
      report.relationships ? `Resolved relationship: ${report.relationships.activeRelationshipSummary}` : undefined,
      report.targetComparison ? `Runtime target comparison: ${report.targetComparison.summary}` : undefined,
      report.relationships ? `Project auth usage: ${report.relationships.authProfileUsageSummary}` : undefined,
      '',
      'Deployment route',
      ...report.summary.deploymentRouteSteps.map((step, index) => `${index + 1}. ${step}`),
      '',
      'Placement guidance',
      renderOutput(placementRows, 'table').trimEnd(),
      '',
      'Local layout checks',
      renderOutput(localCheckRows, 'table').trimEnd(),
      ...(externalCheckRows.length > 0 ? ['', 'External target checks', renderOutput(externalCheckRows, 'table').trimEnd()] : []),
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
    ...(report.relationships ? [`- Resolved relationship: ${report.relationships.activeRelationshipSummary}`] : []),
    ...(report.targetComparison ? [`- Runtime target comparison: ${report.targetComparison.summary}`] : []),
    ...(report.relationships ? [`- Project auth usage: ${report.relationships.authProfileUsageSummary}`] : []),
    `- Bundle lifecycle: ${report.summary.bundleLifecycleSummary}`,
    ...(discoveryNote ? ['', `Discovery: ${discoveryNote}`] : []),
    '',
    '## Deployment Route',
    ...report.summary.deploymentRouteSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Placement Guidance',
    ...placementRows.map((row) => `- \`${row.asset}\` -> \`${row.root}\`: ${row.expectation}`),
    '',
    '## Local Layout Checks',
    ...checkGroups.localLayout.map((check) => `- \`${check.status}\` \`${check.code}\`: ${check.message}`),
    ...(checkGroups.externalTargeting.length > 0
      ? ['', '## External Target Checks', ...checkGroups.externalTargeting.map((check) => `- \`${check.status}\` \`${check.code}\`: ${check.message}`)]
      : []),
    '',
    '## Checks',
    ...report.checks.map((check) => `- \`${check.status}\` \`${check.code}\`: ${check.message}`),
    '',
  ].join('\n');
}

function enrichProjectDoctorReport(
  report: ProjectDoctorReport,
  relationships: Awaited<ReturnType<typeof buildProjectRelationshipSummary>> | undefined,
  targetComparison: ProjectTargetComparison
): ProjectDoctorReport & { relationships?: Awaited<ReturnType<typeof buildProjectRelationshipSummary>>; targetComparison?: ProjectTargetComparison } {
  const relationshipChecks = (relationships?.stageRelationships ?? []).flatMap((stage) => {
    const checks = [];

    if (stage.environmentStatus === 'missing') {
      checks.push({
        status: 'warn' as const,
        code: 'PROJECT_DOCTOR_ENV_ALIAS_UNRESOLVED',
        message: `Stage ${stage.stage} points to environment alias ${stage.environmentAlias}, but that alias is not configured in the active pp environment registry.`,
        hint: `Add the alias with \`pp env add ${stage.environmentAlias} --url <dataverse-url> --profile <auth-profile>\`.`,
      });
    }

    if (stage.authProfileStatus === 'missing') {
      checks.push({
        status: 'warn' as const,
        code: 'PROJECT_DOCTOR_AUTH_PROFILE_UNRESOLVED',
        message: `Stage ${stage.stage} resolves environment alias ${stage.environmentAlias}, but its auth profile ${stage.authProfile} is missing from the active pp auth registry.`,
        hint: `Create or restore auth profile ${stage.authProfile} before relying on that stage target.`,
      });
    }

    checks.push({
      status: 'info' as const,
      code: 'PROJECT_DOCTOR_RELATIONSHIP_CHAIN',
      message: stage.summary,
    });

    return checks;
  });

  const authUsageCheck = relationships
    ? {
        status: relationships.authProfileNames.length <= 1 ? ('info' as const) : ('warn' as const),
        code: 'PROJECT_DOCTOR_AUTH_PROFILE_USAGE',
        message: relationships.authProfileUsageSummary,
      }
    : undefined;

  const targetComparisonCheck = targetComparison
    ? {
        status:
          targetComparison.relationship === 'aligned' ? ('pass' as const) : targetComparison.relationship === 'alternate-stage' ? ('warn' as const) : ('warn' as const),
        code: 'PROJECT_DOCTOR_RUNTIME_TARGET_COMPARISON',
        message: targetComparison.summary,
        hint: targetComparison.guidance[0],
      }
    : undefined;

  return {
    ...report,
    checks: [...report.checks, ...relationshipChecks, ...(authUsageCheck ? [authUsageCheck] : []), ...(targetComparisonCheck ? [targetComparisonCheck] : [])],
    checkGroups: categorizeProjectDoctorChecks([
      ...report.checks,
      ...relationshipChecks,
      ...(authUsageCheck ? [authUsageCheck] : []),
      ...(targetComparisonCheck ? [targetComparisonCheck] : []),
    ]),
    relationships,
    targetComparison,
  };
}

function categorizeProjectDoctorChecks(checks: ProjectDoctorCheck[]): {
  localLayout: ProjectDoctorCheck[];
  externalTargeting: ProjectDoctorCheck[];
} {
  const externalCodes = new Set([
    'PROJECT_DOCTOR_ENV_ALIAS_UNRESOLVED',
    'PROJECT_DOCTOR_AUTH_PROFILE_UNRESOLVED',
    'PROJECT_DOCTOR_RELATIONSHIP_CHAIN',
    'PROJECT_DOCTOR_AUTH_PROFILE_USAGE',
    'PROJECT_DOCTOR_RUNTIME_TARGET_COMPARISON',
  ]);

  return {
    localLayout: checks.filter((check) => !externalCodes.has(check.code)),
    externalTargeting: checks.filter((check) => externalCodes.has(check.code)),
  };
}

function renderProjectFeedbackOutput(
  report: ProjectFeedbackReport,
  targetComparison: ProjectTargetComparison,
  format: Extract<OutputFormat, 'table' | 'markdown'>
): string {
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
      targetComparison ? '' : undefined,
      targetComparison ? `Runtime target comparison: ${targetComparison.summary}` : undefined,
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
    ...(targetComparison ? [`- Runtime target comparison: ${targetComparison.summary}`] : []),
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

async function resolveProjectTargetComparison(
  project: ProjectContext,
  requestedEnvironmentAlias: string | undefined,
  configOptions: ConfigStoreOptions
): Promise<ProjectTargetComparison> {
  if (!requestedEnvironmentAlias) {
    return undefined;
  }

  return compareProjectRuntimeTarget(project, requestedEnvironmentAlias, configOptions);
}
