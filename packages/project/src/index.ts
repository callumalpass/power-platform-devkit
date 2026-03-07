import { access, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
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
  type ProviderBinding,
} from '@pp/config';

export interface ProjectAsset {
  name: string;
  path: string;
  exists: boolean;
  kind: 'directory' | 'file' | 'missing';
}

export interface ResolvedProjectParameter {
  name: string;
  type: ParameterType;
  source: 'value' | 'environment' | 'secret-ref' | 'missing';
  value?: string | number | boolean;
  definition: ProjectParameterDefinition;
}

export interface ProjectContext {
  root: string;
  configPath?: string;
  config: ProjectConfig;
  providerBindings: Record<string, ProviderBinding>;
  parameters: Record<string, ResolvedProjectParameter>;
  assets: ProjectAsset[];
  diagnostics: Diagnostic[];
}

export interface ProjectSummary {
  root: string;
  configPath?: string;
  defaultEnvironment?: string;
  defaultSolution?: string;
  assetCount: number;
  providerBindingCount: number;
  parameterCount: number;
  missingRequiredParameters: string[];
}

const DEFAULT_ASSET_PATHS = ['apps', 'flows', 'solutions', 'docs'];

export async function discoverProject(startDir = process.cwd()): Promise<OperationResult<ProjectContext>> {
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
  const parameterResolution = resolveProjectParameters(config.parameters ?? {}, process.env);
  const assets = await inspectAssets(root, config.assets ?? {});

  return ok(
    {
      root,
      configPath,
      config,
      providerBindings: config.providerBindings ?? {},
      parameters: parameterResolution.parameters,
      assets,
      diagnostics: mergeDiagnostics(configResult.diagnostics, configResult.warnings, parameterResolution.diagnostics),
    },
    {
      supportTier: 'preview',
      warnings: mergeDiagnostics(configResult.warnings, parameterResolution.diagnostics.filter((item) => item.level === 'warning')),
      diagnostics: parameterResolution.diagnostics.filter((item) => item.level === 'error'),
    }
  );
}

export function resolveProjectParameters(
  definitions: Record<string, ProjectParameterDefinition>,
  environment: NodeJS.ProcessEnv
): { parameters: Record<string, ResolvedProjectParameter>; diagnostics: Diagnostic[] } {
  const parameters: Record<string, ResolvedProjectParameter> = {};
  const diagnostics: Diagnostic[] = [];

  for (const [name, definition] of Object.entries(definitions)) {
    const type = definition.type ?? inferType(definition.value);
    let source: ResolvedProjectParameter['source'] = 'missing';
    let value: ResolvedProjectParameter['value'];

    if (definition.value !== undefined) {
      source = 'value';
      value = definition.value;
    } else if (definition.fromEnv) {
      const rawValue = environment[definition.fromEnv];

      if (rawValue !== undefined) {
        source = 'environment';
        value = coerceValue(rawValue, type);
      }
    } else if (definition.secretRef) {
      source = 'secret-ref';
    }

    if (definition.required && value === undefined && source !== 'secret-ref') {
      diagnostics.push(
        createDiagnostic('error', 'PROJECT_PARAMETER_MISSING', `Required project parameter ${name} is not resolved`, {
          source: '@pp/project',
          hint: definition.fromEnv
            ? `Set ${definition.fromEnv} or provide an explicit value in the project config.`
            : 'Provide a value in the project config or a supported mapping.',
        })
      );
    } else if (source === 'secret-ref') {
      diagnostics.push(
        createDiagnostic('info', 'PROJECT_PARAMETER_SECRET_REF', `Project parameter ${name} is backed by secret ref ${definition.secretRef}`, {
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
    };
  }

  return { parameters, diagnostics };
}

export function summarizeProject(context: ProjectContext): ProjectSummary {
  const missingRequiredParameters = Object.values(context.parameters)
    .filter((parameter) => parameter.definition.required && parameter.value === undefined && parameter.source !== 'secret-ref')
    .map((parameter) => parameter.name);

  return {
    root: context.root,
    configPath: context.configPath,
    defaultEnvironment: context.config.defaults?.environment,
    defaultSolution: context.config.defaults?.solution,
    assetCount: context.assets.length,
    providerBindingCount: Object.keys(context.providerBindings).length,
    parameterCount: Object.keys(context.parameters).length,
    missingRequiredParameters,
  };
}

async function inspectAssets(root: string, configuredAssets: Record<string, string>): Promise<ProjectAsset[]> {
  const assetEntries = Object.entries(configuredAssets).length > 0
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

function inferType(value: ProjectParameterDefinition['value']): ParameterType {
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    default:
      return 'string';
  }
}

function coerceValue(rawValue: string, type: ParameterType): string | number | boolean {
  if (type === 'number') {
    return Number(rawValue);
  }

  if (type === 'boolean') {
    return rawValue.toLowerCase() === 'true';
  }

  return rawValue;
}
