import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createDiagnostic,
  fail,
  mergeDiagnostics,
  ok,
  type Diagnostic,
  type OperationResult,
} from '@pp/diagnostics';
import {
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

export interface ProjectContext {
  root: string;
  configPath?: string;
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

export async function discoverProject(
  startDir = process.cwd(),
  options: ProjectDiscoveryOptions = {}
): Promise<OperationResult<ProjectContext>> {
  const configResult = await loadProjectConfig(startDir);

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
  const root = configPath ? dirname(configPath) : resolve(startDir);
  const config = configResult.data?.config ?? {};
  const environment = options.environment ?? process.env;
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
