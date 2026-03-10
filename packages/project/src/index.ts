import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  createDiagnostic,
  fail,
  mergeDiagnostics,
  ok,
  type Diagnostic,
  type OperationResult,
} from '@pp/diagnostics';
import {
  findDescendantProjectConfigs,
  loadProjectConfig,
  type ParameterType,
  type ProjectConfig,
  type ProjectParameterDefinition,
  type ProjectSecretsConfig,
  type ProjectTopologyStage,
  type ProviderBinding,
  type SolutionTarget,
  type StageParameterOverride,
} from '@pp/config';

type PrimitiveValue = string | number | boolean;

export interface ProjectAsset {
  name: string;
  path: string;
  exists: boolean;
  kind: 'directory' | 'file' | 'missing';
}

export interface ProjectDiscoveryOptions {
  stage?: string;
  parameterOverrides?: Record<string, PrimitiveValue>;
  environment?: NodeJS.ProcessEnv;
}

export interface ResolvedProjectParameter {
  name: string;
  type: ParameterType;
  source: 'value' | 'environment' | 'secret' | 'missing';
  value?: PrimitiveValue;
  definition: ProjectParameterDefinition;
  sensitive: boolean;
  hasValue: boolean;
  reference?: string;
  resolvedBy?: string;
}

export interface ProjectParameterSummary {
  name: string;
  type: ParameterType;
  source: ResolvedProjectParameter['source'];
  hasValue: boolean;
  sensitive: boolean;
  value?: PrimitiveValue | string;
  reference?: string;
  resolvedBy?: string;
  mappings: Array<{ kind: string; target: string }>;
}

export interface ResolvedSolutionTarget {
  alias: string;
  environment?: string;
  uniqueName: string;
  source: 'project' | 'stage' | 'default';
  stage?: string;
}

export interface ResolvedProjectStage {
  name: string;
  environment?: string;
  defaultSolution?: ResolvedSolutionTarget;
  solutions: Record<string, ResolvedSolutionTarget>;
  parameterOverrides: string[];
}

export interface ResolvedProjectTopology {
  defaultStage?: string;
  selectedStage?: string;
  activeEnvironment?: string;
  activeSolution?: ResolvedSolutionTarget;
  stages: Record<string, ResolvedProjectStage>;
}

export interface ProjectDiscoveryDetails {
  inspectedPath: string;
  resolvedRoot: string;
  configFound: boolean;
  usedDefaultLayout: boolean;
  descendantProjectConfigs: string[];
  descendantProjectRoots: string[];
  nearestProjectRoot?: string;
}

export interface ProjectContext {
  root: string;
  configPath?: string;
  discovery: ProjectDiscoveryDetails;
  config: ProjectConfig;
  providerBindings: Record<string, ProviderBinding>;
  parameters: Record<string, ResolvedProjectParameter>;
  assets: ProjectAsset[];
  topology: ResolvedProjectTopology;
  templateRegistries: string[];
  build: Record<string, unknown>;
  docs?: ProjectConfig['docs'];
  diagnostics: Diagnostic[];
}

export interface ProjectSummary {
  root: string;
  configPath?: string;
  defaultEnvironment?: string;
  defaultSolution?: string;
  selectedStage?: string;
  activeEnvironment?: string;
  activeSolution?: string;
  topologyStageCount: number;
  assetCount: number;
  providerBindingCount: number;
  parameterCount: number;
  missingRequiredParameters: string[];
}

export interface ProjectInitOptions {
  name?: string;
  environment?: string;
  solution?: string;
  stage?: string;
  configFilename?: 'pp.config.yaml' | 'pp.config.yml' | 'pp.config.json';
  force?: boolean;
}

export interface ProjectInitAction {
  kind: 'config' | 'directory';
  path: string;
  action: 'create' | 'overwrite' | 'exists';
}

export interface ProjectInitPlan {
  root: string;
  configPath: string;
  configExists: boolean;
  actions: ProjectInitAction[];
  config: ProjectConfig;
}

export interface ProjectInitResult extends ProjectInitPlan {
  created: string[];
  overwritten: string[];
  untouched: string[];
}

export interface ProjectDoctorCheck {
  status: 'pass' | 'warn' | 'fail' | 'info';
  code: string;
  message: string;
  path?: string;
  hint?: string;
}

export interface ProjectDoctorSummary {
  hasConfig: boolean;
  configuredAssetCount: number;
  existingAssetCount: number;
  missingAssetCount: number;
  hasTopology: boolean;
  hasProviderBindings: boolean;
  hasTemplateRegistries: boolean;
  requiredParameterCount: number;
  unresolvedRequiredParameterCount: number;
}

export interface ProjectDoctorReport {
  root: string;
  configPath?: string;
  discovery?: ProjectDiscoveryDetails;
  summary: ProjectDoctorSummary;
  assets: ProjectAsset[];
  checks: ProjectDoctorCheck[];
}

interface SecretResolution {
  found: boolean;
  value?: string;
  provider?: string;
  reference: string;
  diagnostics: Diagnostic[];
}

interface ProjectTopologyResolution {
  topology: ResolvedProjectTopology;
  activeStageConfig?: ProjectTopologyStage;
  diagnostics: Diagnostic[];
}

const DEFAULT_ASSET_PATHS = ['apps', 'flows', 'solutions', 'docs'];

export function planProjectInit(root = process.cwd(), options: ProjectInitOptions = {}): ProjectInitPlan {
  const resolvedRoot = resolve(root);
  const configFilename = options.configFilename ?? 'pp.config.yaml';
  const configPath = join(resolvedRoot, configFilename);
  const stage = options.stage ?? 'dev';
  const environment = options.environment ?? 'dev';
  const solution = options.solution ?? 'Core';
  const projectName = options.name ?? basename(resolvedRoot);
  const configExists = false;
  const config = buildProjectInitConfig({
    name: projectName,
    environment,
    solution,
    stage,
  });

  return {
    root: resolvedRoot,
    configPath,
    configExists,
    actions: [
      {
        kind: 'config',
        path: configPath,
        action: options.force ? 'overwrite' : 'create',
      },
      ...DEFAULT_ASSET_PATHS.map((assetPath) => ({
        kind: 'directory' as const,
        path: join(resolvedRoot, assetPath),
        action: 'create' as const,
      })),
    ],
    config,
  };
}

export async function initProject(root = process.cwd(), options: ProjectInitOptions = {}): Promise<OperationResult<ProjectInitResult>> {
  const plan = planProjectInit(root, options);
  const configExists = await pathExists(plan.configPath);

  if (configExists && !options.force) {
    return fail(
      createDiagnostic('error', 'PROJECT_INIT_CONFIG_EXISTS', `Project config already exists at ${plan.configPath}`, {
        source: '@pp/project',
        path: plan.configPath,
        hint: 'Use project doctor to inspect the existing layout or re-run with --force to overwrite the config file.',
      }),
      {
        supportTier: 'preview',
      }
    );
  }

  const actions: ProjectInitAction[] = [];
  const created: string[] = [];
  const overwritten: string[] = [];
  const untouched: string[] = [];

  for (const assetPath of DEFAULT_ASSET_PATHS) {
    const fullPath = join(plan.root, assetPath);
    const exists = await pathExists(fullPath);

    if (exists) {
      actions.push({ kind: 'directory', path: fullPath, action: 'exists' });
      untouched.push(fullPath);
      continue;
    }

    await mkdir(fullPath, { recursive: true });
    actions.push({ kind: 'directory', path: fullPath, action: 'create' });
    created.push(fullPath);
  }

  await writeFile(plan.configPath, renderProjectConfig(plan.config, plan.configPath), 'utf8');
  actions.unshift({
    kind: 'config',
    path: plan.configPath,
    action: configExists ? 'overwrite' : 'create',
  });

  if (configExists) {
    overwritten.push(plan.configPath);
  } else {
    created.push(plan.configPath);
  }

  return ok(
    {
      ...plan,
      configExists,
      actions,
      created,
      overwritten,
      untouched,
    },
    {
      supportTier: 'preview',
      suggestedNextActions: [
        'Run `pp project doctor` to inspect the scaffolded layout and any missing inputs.',
        'Update provider bindings, parameters, and topology in the generated config to match your environment aliases and solution names.',
      ],
    }
  );
}

export async function doctorProject(root = process.cwd(), options: ProjectDiscoveryOptions = {}): Promise<OperationResult<ProjectDoctorReport>> {
  const resolvedRoot = resolve(root);
  const discovery = await discoverProject(resolvedRoot, options);

  if (!discovery.success) {
    return fail(discovery.diagnostics, {
      supportTier: discovery.supportTier,
      warnings: discovery.warnings,
      suggestedNextActions: discovery.suggestedNextActions,
      provenance: discovery.provenance,
      knownLimitations: discovery.knownLimitations,
    });
  }

  const project = discovery.data;
  const checks: ProjectDoctorCheck[] = [];
  const diagnostics = mergeDiagnostics(discovery.diagnostics, discovery.warnings);

  if (project?.configPath) {
    checks.push({
      status: 'pass',
      code: 'PROJECT_DOCTOR_CONFIG_PRESENT',
      message: `Project config found at ${project.configPath}`,
      path: project.configPath,
    });
  } else {
    checks.push({
      status: 'warn',
      code: 'PROJECT_DOCTOR_CONFIG_MISSING',
      message: 'No `pp.config.*` file was found. `pp` can inspect defaults, but the local project model is only inferred.',
      path: join(resolvedRoot, 'pp.config.yaml'),
      hint: 'Run `pp project init` to scaffold a minimal config, then tune it for your environment aliases, solution names, and parameter sources.',
    });

    if (project && project.discovery.descendantProjectRoots.length > 0) {
      checks.push({
        status: 'info',
        code: 'PROJECT_DOCTOR_DESCENDANT_PROJECT_FOUND',
        message:
          project.discovery.descendantProjectRoots.length === 1
            ? `Found descendant pp project root at ${project.discovery.descendantProjectRoots[0]}.`
            : `Found ${project.discovery.descendantProjectRoots.length} descendant pp project roots under the inspected path.`,
        path: join(resolvedRoot, project.discovery.nearestProjectRoot ?? project.discovery.descendantProjectRoots[0]!),
        hint:
          project.discovery.descendantProjectRoots.length === 1
            ? `Re-run with ${project.discovery.descendantProjectRoots[0]} or --project ${project.discovery.descendantProjectRoots[0]}.`
            : `Re-run with one of: ${project.discovery.descendantProjectRoots.join(', ')}.`,
      });
    }
  }

  const assets = project?.assets ?? (await inspectAssets(resolvedRoot, {}));

  for (const asset of assets) {
    checks.push({
      status: asset.exists ? 'pass' : 'warn',
      code: asset.exists ? 'PROJECT_DOCTOR_ASSET_PRESENT' : 'PROJECT_DOCTOR_ASSET_MISSING',
      message: asset.exists
        ? `Asset path ${relative(resolvedRoot, asset.path) || '.'} is present for ${asset.name}`
        : `Expected asset path ${relative(resolvedRoot, asset.path) || '.'} is missing for ${asset.name}`,
      path: asset.path,
      hint: asset.exists ? undefined : `Create ${relative(resolvedRoot, asset.path)} or update the project assets map if this repo uses a different layout.`,
    });
  }

  if (project?.configPath) {
    if (Object.keys(project.providerBindings).length > 0) {
      checks.push({
        status: 'pass',
        code: 'PROJECT_DOCTOR_PROVIDER_BINDINGS_PRESENT',
        message: `Project defines ${Object.keys(project.providerBindings).length} provider binding(s).`,
      });
    } else {
      checks.push({
        status: 'info',
        code: 'PROJECT_DOCTOR_PROVIDER_BINDINGS_MISSING',
        message: 'Project config does not define provider bindings yet.',
        hint: 'Add providerBindings when you want stable local names for Dataverse, SharePoint, Power BI, or other target systems.',
      });
    }

    if (Object.keys(project.topology.stages).length > 0) {
      checks.push({
        status: 'pass',
        code: 'PROJECT_DOCTOR_TOPOLOGY_PRESENT',
        message: `Project topology defines ${Object.keys(project.topology.stages).length} stage(s).`,
      });
    } else {
      checks.push({
        status: 'info',
        code: 'PROJECT_DOCTOR_TOPOLOGY_MISSING',
        message: 'Project config does not define stage topology.',
        hint: 'Add topology when the repo needs stage-aware environment, solution, or parameter overrides.',
      });
    }
  }

  for (const diagnostic of diagnostics) {
    checks.push({
      status: diagnostic.level === 'error' ? 'fail' : diagnostic.level === 'warning' ? 'warn' : 'info',
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.path,
      hint: diagnostic.hint,
    });
  }

  const requiredParameters = Object.values(project?.parameters ?? {}).filter((parameter) => parameter.definition.required);
  const unresolvedRequiredParameters = requiredParameters.filter((parameter) => !parameter.hasValue);

  return ok(
    {
      root: resolvedRoot,
      configPath: project?.configPath,
      discovery: project?.discovery.usedDefaultLayout ? project.discovery : undefined,
      summary: {
        hasConfig: project?.configPath !== undefined,
        configuredAssetCount: assets.length,
        existingAssetCount: assets.filter((asset) => asset.exists).length,
        missingAssetCount: assets.filter((asset) => !asset.exists).length,
        hasTopology: Object.keys(project?.topology.stages ?? {}).length > 0,
        hasProviderBindings: Object.keys(project?.providerBindings ?? {}).length > 0,
        hasTemplateRegistries: (project?.templateRegistries ?? []).length > 0,
        requiredParameterCount: requiredParameters.length,
        unresolvedRequiredParameterCount: unresolvedRequiredParameters.length,
      },
      assets,
      checks,
    },
    {
      supportTier: 'preview',
      diagnostics: diagnostics.filter((diagnostic) => diagnostic.level === 'error'),
      warnings: diagnostics.filter((diagnostic) => diagnostic.level === 'warning'),
      suggestedNextActions: buildDoctorSuggestedNextActions(project?.configPath !== undefined, assets, unresolvedRequiredParameters.map((parameter) => parameter.name)),
    }
  );
}

export async function discoverProject(
  startDir = process.cwd(),
  options: ProjectDiscoveryOptions = {}
): Promise<OperationResult<ProjectContext>> {
  const resolvedStartDir = resolve(startDir);
  const configResult = await loadProjectConfig(resolvedStartDir);

  if (!configResult.success) {
    return fail(configResult.diagnostics, {
      supportTier: configResult.supportTier,
      warnings: configResult.warnings,
      suggestedNextActions: configResult.suggestedNextActions,
      provenance: configResult.provenance,
      knownLimitations: configResult.knownLimitations,
    });
  }

  const configPath = configResult.data?.path;
  const root = configPath ? dirname(configPath) : resolvedStartDir;
  const config = configResult.data?.config ?? {};
  const environment = options.environment ?? process.env;
  const discovery = await summarizeProjectDiscovery(resolvedStartDir, root, configPath);
  const topologyResolution = resolveProjectTopology(config, options.stage);
  const mergedDefinitions = applyParameterOverrides(
    config.parameters ?? {},
    topologyResolution.activeStageConfig?.parameters ?? {},
    options.parameterOverrides ?? {}
  );
  const parameterResolution = resolveProjectParameters(mergedDefinitions, environment, config.secrets);
  const assets = await inspectAssets(root, config.assets ?? {});
  const diagnostics = mergeDiagnostics(
    configResult.diagnostics,
    configResult.warnings,
    topologyResolution.diagnostics,
    parameterResolution.diagnostics
  );

  return ok(
    {
      root,
      configPath,
      discovery,
      config,
      providerBindings: config.providerBindings ?? {},
      parameters: parameterResolution.parameters,
      assets,
      topology: topologyResolution.topology,
      templateRegistries: config.templateRegistries ?? [],
      build: config.build ?? {},
      docs: config.docs,
      diagnostics,
    },
    {
      supportTier: 'preview',
      warnings: diagnostics.filter((item) => item.level === 'warning'),
      diagnostics: diagnostics.filter((item) => item.level === 'error'),
    }
  );
}

export function resolveProjectParameters(
  definitions: Record<string, ProjectParameterDefinition>,
  environment: NodeJS.ProcessEnv,
  secrets?: ProjectSecretsConfig
): { parameters: Record<string, ResolvedProjectParameter>; diagnostics: Diagnostic[] } {
  const parameters: Record<string, ResolvedProjectParameter> = {};
  const diagnostics: Diagnostic[] = [];
  const secretResolver = createSecretResolver(secrets, environment);

  for (const [name, definition] of Object.entries(definitions)) {
    const type = definition.type ?? inferType(definition.value);
    let source: ResolvedProjectParameter['source'] = 'missing';
    let value: ResolvedProjectParameter['value'];
    let resolvedBy: string | undefined;
    const sensitive = definition.secretRef !== undefined;

    if (definition.value !== undefined) {
      source = 'value';
      value = normalizeProvidedValue(definition.value, type);
    } else if (definition.fromEnv) {
      const rawValue = environment[definition.fromEnv];

      if (rawValue !== undefined) {
        source = 'environment';
        value = coerceValue(rawValue, type);
      }
    } else if (definition.secretRef) {
      const secret = secretResolver(definition.secretRef);
      diagnostics.push(...secret.diagnostics);

      if (secret.found && secret.value !== undefined) {
        source = 'secret';
        value = coerceValue(secret.value, type);
        resolvedBy = secret.provider;
      }
    }

    if (definition.required && value === undefined) {
      diagnostics.push(
        createDiagnostic(
          'error',
          definition.secretRef ? 'PROJECT_PARAMETER_SECRET_MISSING' : 'PROJECT_PARAMETER_MISSING',
          definition.secretRef
            ? `Required secret-backed project parameter ${name} is not resolved`
            : `Required project parameter ${name} is not resolved`,
          {
            source: '@pp/project',
            hint: definition.secretRef
              ? `Resolve secret ref ${definition.secretRef} or provide an explicit value override.`
              : definition.fromEnv
                ? `Set ${definition.fromEnv} or provide an explicit value in the project config.`
                : 'Provide a value in the project config or a supported mapping.',
          }
        )
      );
    } else if (definition.secretRef && value === undefined) {
      diagnostics.push(
        createDiagnostic('warning', 'PROJECT_PARAMETER_SECRET_UNRESOLVED', `Project parameter ${name} references ${definition.secretRef} but no value was resolved`, {
          source: '@pp/project',
        })
      );
    }

    parameters[name] = {
      name,
      type,
      source,
      value,
      definition,
      sensitive,
      hasValue: value !== undefined,
      reference: definition.secretRef,
      resolvedBy,
    };
  }

  return { parameters, diagnostics };
}

export function summarizeResolvedParameter(
  parameter: ResolvedProjectParameter,
  options: { includeSensitiveValues?: boolean } = {}
): ProjectParameterSummary {
  const includeSensitiveValues = options.includeSensitiveValues ?? false;

  return {
    name: parameter.name,
    type: parameter.type,
    source: parameter.source,
    hasValue: parameter.hasValue,
    sensitive: parameter.sensitive,
    value:
      parameter.value === undefined
        ? undefined
        : parameter.sensitive && !includeSensitiveValues
          ? '<redacted>'
          : parameter.value,
    reference: parameter.reference,
    resolvedBy: parameter.resolvedBy,
    mappings: parameter.definition.mapsTo ?? [],
  };
}

export function summarizeProject(context: ProjectContext): ProjectSummary {
  const missingRequiredParameters = Object.values(context.parameters)
    .filter((parameter) => parameter.definition.required && !parameter.hasValue)
    .map((parameter) => parameter.name);

  return {
    root: context.root,
    configPath: context.configPath,
    defaultEnvironment: context.config.defaults?.environment,
    defaultSolution: context.config.defaults?.solution,
    selectedStage: context.topology.selectedStage,
    activeEnvironment: context.topology.activeEnvironment,
    activeSolution: context.topology.activeSolution?.uniqueName,
    topologyStageCount: Object.keys(context.topology.stages).length,
    assetCount: context.assets.length,
    providerBindingCount: Object.keys(context.providerBindings).length,
    parameterCount: Object.keys(context.parameters).length,
    missingRequiredParameters,
  };
}

function resolveProjectTopology(config: ProjectConfig, requestedStage?: string): ProjectTopologyResolution {
  const diagnostics: Diagnostic[] = [];
  const baseEnvironment = config.defaults?.environment;
  const baseSolutions = resolveBaseSolutionTargets(config.solutions ?? {}, baseEnvironment, diagnostics);
  const configuredDefaultStage = config.topology?.defaultStage ?? config.defaults?.stage;
  const selectedStage = requestedStage ?? configuredDefaultStage;

  if (requestedStage && !config.topology?.stages?.[requestedStage]) {
    diagnostics.push(
      createDiagnostic('error', 'PROJECT_STAGE_NOT_FOUND', `Requested stage ${requestedStage} is not defined in project topology`, {
        source: '@pp/project',
      })
    );
  } else if (configuredDefaultStage && !config.topology?.stages?.[configuredDefaultStage]) {
    diagnostics.push(
      createDiagnostic('warning', 'PROJECT_DEFAULT_STAGE_NOT_FOUND', `Configured default stage ${configuredDefaultStage} is not defined in project topology`, {
        source: '@pp/project',
      })
    );
  }

  const stages: Record<string, ResolvedProjectStage> = {};

  for (const [stageName, stage] of Object.entries(config.topology?.stages ?? {})) {
    const environment = stage.environment ?? baseEnvironment;
    const solutions = resolveStageSolutionTargets(baseSolutions, stage.solutions ?? {}, environment, stageName, diagnostics);
    const defaultSolution = resolveNamedSolution(stage.solution ?? config.defaults?.solution, solutions, environment, stageName);

    stages[stageName] = {
      name: stageName,
      environment,
      defaultSolution,
      solutions,
      parameterOverrides: Object.keys(stage.parameters ?? {}),
    };
  }

  const activeStageConfig = selectedStage ? config.topology?.stages?.[selectedStage] : undefined;
  const activeStage = selectedStage ? stages[selectedStage] : undefined;
  const activeEnvironment = activeStage?.environment ?? baseEnvironment;
  const activeSolution =
    activeStage?.defaultSolution ?? resolveNamedSolution(config.defaults?.solution, baseSolutions, activeEnvironment);

  return {
    topology: {
      defaultStage: configuredDefaultStage,
      selectedStage: activeStage ? selectedStage : undefined,
      activeEnvironment,
      activeSolution,
      stages,
    },
    activeStageConfig,
    diagnostics,
  };
}

function resolveBaseSolutionTargets(
  solutions: Record<string, SolutionTarget>,
  defaultEnvironment: string | undefined,
  diagnostics: Diagnostic[]
): Record<string, ResolvedSolutionTarget> {
  return Object.fromEntries(
    Object.entries(solutions).map(([alias, target]) => {
      const resolved = normalizeSolutionTarget(alias, target, defaultEnvironment, 'project');
      warnIfSolutionEnvironmentMissing(resolved, diagnostics);
      return [alias, resolved];
    })
  );
}

function resolveStageSolutionTargets(
  baseSolutions: Record<string, ResolvedSolutionTarget>,
  stageSolutions: Record<string, string | SolutionTarget>,
  stageEnvironment: string | undefined,
  stage: string,
  diagnostics: Diagnostic[]
): Record<string, ResolvedSolutionTarget> {
  const merged: Record<string, ResolvedSolutionTarget> = { ...baseSolutions };

  for (const [alias, target] of Object.entries(stageSolutions)) {
    const resolved = normalizeSolutionTarget(alias, target, stageEnvironment, 'stage', stage);
    warnIfSolutionEnvironmentMissing(resolved, diagnostics);
    merged[alias] = resolved;
  }

  return merged;
}

function normalizeSolutionTarget(
  alias: string,
  target: string | SolutionTarget,
  fallbackEnvironment: string | undefined,
  source: ResolvedSolutionTarget['source'],
  stage?: string
): ResolvedSolutionTarget {
  if (typeof target === 'string') {
    return {
      alias,
      environment: fallbackEnvironment,
      uniqueName: target,
      source,
      stage,
    };
  }

  return {
    alias,
    environment: target.environment ?? fallbackEnvironment,
    uniqueName: target.uniqueName,
    source,
    stage,
  };
}

function resolveNamedSolution(
  name: string | undefined,
  knownSolutions: Record<string, ResolvedSolutionTarget>,
  fallbackEnvironment: string | undefined,
  stage?: string
): ResolvedSolutionTarget | undefined {
  if (!name) {
    return undefined;
  }

  const known = knownSolutions[name];

  if (known) {
    return known.environment ? known : { ...known, environment: fallbackEnvironment ?? known.environment };
  }

  return {
    alias: name,
    environment: fallbackEnvironment,
    uniqueName: name,
    source: 'default',
    stage,
  };
}

function warnIfSolutionEnvironmentMissing(solution: ResolvedSolutionTarget, diagnostics: Diagnostic[]): void {
  if (!solution.environment) {
    diagnostics.push(
      createDiagnostic('warning', 'PROJECT_SOLUTION_ENVIRONMENT_UNRESOLVED', `Solution alias ${solution.alias} does not resolve to an environment`, {
        source: '@pp/project',
      })
    );
  }
}

async function summarizeProjectDiscovery(
  inspectedPath: string,
  resolvedRoot: string,
  configPath?: string
): Promise<ProjectDiscoveryDetails> {
  if (configPath) {
    return {
      inspectedPath,
      resolvedRoot,
      configFound: true,
      usedDefaultLayout: false,
      descendantProjectConfigs: [],
      descendantProjectRoots: [],
    };
  }

  const descendantProjectConfigs = (await findDescendantProjectConfigs(inspectedPath)).map((candidate) => relative(inspectedPath, candidate) || '.');
  const descendantProjectRoots = descendantProjectConfigs.map((candidate) => dirname(candidate)).map((candidate) => (candidate === '.' ? '.' : candidate));

  return {
    inspectedPath,
    resolvedRoot,
    configFound: false,
    usedDefaultLayout: true,
    descendantProjectConfigs,
    descendantProjectRoots,
    nearestProjectRoot: descendantProjectRoots[0],
  };
}

function applyParameterOverrides(
  baseDefinitions: Record<string, ProjectParameterDefinition>,
  stageOverrides: Record<string, StageParameterOverride>,
  cliOverrides: Record<string, PrimitiveValue>
): Record<string, ProjectParameterDefinition> {
  const names = new Set([...Object.keys(baseDefinitions), ...Object.keys(stageOverrides), ...Object.keys(cliOverrides)]);
  const definitions: Record<string, ProjectParameterDefinition> = {};

  for (const name of names) {
    let definition: ProjectParameterDefinition = { ...(baseDefinitions[name] ?? {}) };
    const stageOverride = stageOverrides[name];

    if (stageOverride !== undefined) {
      definition = mergeParameterDefinition(definition, stageOverride);
    }

    if (cliOverrides[name] !== undefined) {
      definition = {
        ...definition,
        value: cliOverrides[name],
      };
    }

    definitions[name] = definition;
  }

  return definitions;
}

function mergeParameterDefinition(
  baseDefinition: ProjectParameterDefinition,
  override: StageParameterOverride
): ProjectParameterDefinition {
  if (typeof override === 'string' || typeof override === 'number' || typeof override === 'boolean') {
    return {
      ...baseDefinition,
      value: override,
      type: baseDefinition.type ?? inferType(override),
    };
  }

  return {
    ...baseDefinition,
    ...override,
  };
}

function createSecretResolver(secrets: ProjectSecretsConfig | undefined, environment: NodeJS.ProcessEnv) {
  return (reference: string): SecretResolution => {
    if (reference.startsWith('env:')) {
      const variableName = reference.slice(4);
      return resolveEnvironmentSecret(reference, variableName, environment, 'env');
    }

    const separatorIndex = reference.indexOf(':');

    if (separatorIndex !== -1) {
      const providerName = reference.slice(0, separatorIndex);
      const key = reference.slice(separatorIndex + 1);
      const provider = secrets?.providers?.[providerName];

      if (!provider) {
        return {
          found: false,
          reference,
          diagnostics: [
            createDiagnostic('warning', 'PROJECT_SECRET_PROVIDER_UNKNOWN', `Secret ref ${reference} uses unknown provider ${providerName}`, {
              source: '@pp/project',
            }),
          ],
        };
      }

      if (!key) {
        return {
          found: false,
          reference,
          diagnostics: [
            createDiagnostic('warning', 'PROJECT_SECRET_REFERENCE_INVALID', `Secret ref ${reference} is missing a provider key`, {
              source: '@pp/project',
            }),
          ],
        };
      }

      return resolveEnvironmentSecret(reference, `${provider.prefix ?? ''}${key}`, environment, providerName);
    }

    if (secrets?.defaultProvider) {
      const provider = secrets.providers?.[secrets.defaultProvider];

      if (!provider) {
        return {
          found: false,
          reference,
          diagnostics: [
            createDiagnostic('warning', 'PROJECT_SECRET_PROVIDER_UNKNOWN', `Default secret provider ${secrets.defaultProvider} is not configured`, {
              source: '@pp/project',
            }),
          ],
        };
      }

      return resolveEnvironmentSecret(reference, `${provider.prefix ?? ''}${reference}`, environment, secrets.defaultProvider);
    }

    return {
      found: false,
      reference,
      diagnostics: [
        createDiagnostic('warning', 'PROJECT_SECRET_PROVIDER_UNSET', `Secret ref ${reference} has no configured provider`, {
          source: '@pp/project',
        }),
      ],
    };
  };
}

function resolveEnvironmentSecret(
  reference: string,
  variableName: string,
  environment: NodeJS.ProcessEnv,
  provider: string
): SecretResolution {
  const value = environment[variableName];

  return {
    found: value !== undefined,
    value,
    provider,
    reference,
    diagnostics: value === undefined
      ? [
          createDiagnostic('info', 'PROJECT_SECRET_LOOKUP_MISS', `Secret ref ${reference} did not resolve from ${provider}`, {
            source: '@pp/project',
          }),
        ]
      : [],
  };
}

async function inspectAssets(root: string, configuredAssets: Record<string, string>): Promise<ProjectAsset[]> {
  const assetEntries =
    Object.entries(configuredAssets).length > 0
      ? Object.entries(configuredAssets)
      : DEFAULT_ASSET_PATHS.map((path) => [path, path] as const);

  const assets: ProjectAsset[] = [];

  for (const [name, configuredPath] of assetEntries) {
    const assetPath = resolve(root, configuredPath);

    try {
      const metadata = await stat(assetPath);
      assets.push({
        name,
        path: assetPath,
        exists: true,
        kind: metadata.isDirectory() ? 'directory' : 'file',
      });
    } catch {
      assets.push({
        name,
        path: assetPath,
        exists: false,
        kind: 'missing',
      });
    }
  }

  return assets;
}

function buildProjectInitConfig(input: { name: string; environment: string; solution: string; stage: string }): ProjectConfig {
  return {
    name: input.name,
    defaults: {
      stage: input.stage,
      environment: input.environment,
      solution: input.solution,
    },
    solutions: {
      [input.solution]: {
        environment: input.environment,
        uniqueName: input.solution,
      },
    },
    assets: {
      apps: 'apps',
      flows: 'flows',
      solutions: 'solutions',
      docs: 'docs',
    },
    providerBindings: {
      primaryDataverse: {
        kind: 'dataverse',
        target: input.environment,
        description: 'Primary Dataverse environment alias for this project',
      },
    },
    topology: {
      defaultStage: input.stage,
      stages: {
        [input.stage]: {
          environment: input.environment,
          solution: input.solution,
        },
      },
    },
    docs: {
      paths: ['docs'],
    },
  };
}

function renderProjectConfig(config: ProjectConfig, configPath: string): string {
  if (configPath.endsWith('.json')) {
    return JSON.stringify(config, null, 2) + '\n';
  }

  const defaults = config.defaults ?? {};
  const solutionName = defaults.solution ?? 'Core';
  const solutionConfig = config.solutions?.[solutionName];
  const stageName = config.topology?.defaultStage ?? defaults.stage ?? 'dev';
  const stageConfig = config.topology?.stages?.[stageName];
  const binding = config.providerBindings?.primaryDataverse;

  return [
    `name: ${config.name ?? 'demo'}`,
    'defaults:',
    `  stage: ${stageName}`,
    `  environment: ${defaults.environment ?? 'dev'}`,
    `  solution: ${solutionName}`,
    'solutions:',
    `  ${solutionName}:`,
    `    environment: ${solutionConfig?.environment ?? defaults.environment ?? 'dev'}`,
    `    uniqueName: ${solutionConfig?.uniqueName ?? solutionName}`,
    'assets:',
    '  apps: apps',
    '  flows: flows',
    '  solutions: solutions',
    '  docs: docs',
    'providerBindings:',
    '  primaryDataverse:',
    `    kind: ${binding?.kind ?? 'dataverse'}`,
    `    target: ${binding?.target ?? defaults.environment ?? 'dev'}`,
    `    description: ${binding?.description ?? 'Primary Dataverse environment alias for this project'}`,
    'topology:',
    `  defaultStage: ${stageName}`,
    '  stages:',
    `    ${stageName}:`,
    `      environment: ${stageConfig?.environment ?? defaults.environment ?? 'dev'}`,
    `      solution: ${stageConfig?.solution ?? solutionName}`,
    'docs:',
    '  paths:',
    '    - docs',
    '',
  ].join('\n');
}

function buildDoctorSuggestedNextActions(hasConfig: boolean, assets: ProjectAsset[], unresolvedParameters: string[]): string[] {
  const actions: string[] = [];

  if (!hasConfig) {
    actions.push('Run `pp project init` to scaffold a minimal local project config and default asset directories.');
  }

  if (assets.some((asset) => !asset.exists)) {
    actions.push('Create the missing asset directories or update `assets` in `pp.config.*` so the local repo model matches reality.');
  }

  if (unresolvedParameters.length > 0) {
    actions.push(`Resolve required project parameters: ${unresolvedParameters.join(', ')}.`);
  }

  if (actions.length === 0) {
    actions.push('Project layout looks coherent. Keep `pp.config.*` aligned with real environment aliases, solution names, and parameter sources as the repo evolves.');
  }

  return actions;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function inferType(value: ProjectParameterDefinition['value'] | PrimitiveValue | undefined): ParameterType {
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    default:
      return 'string';
  }
}

function normalizeProvidedValue(value: PrimitiveValue, type: ParameterType): PrimitiveValue {
  if (typeof value === 'string') {
    return coerceValue(value, type);
  }

  return value;
}

function coerceValue(rawValue: string, type: ParameterType): PrimitiveValue {
  if (type === 'number') {
    return Number(rawValue);
  }

  if (type === 'boolean') {
    return rawValue.toLowerCase() === 'true';
  }

  return rawValue;
}
