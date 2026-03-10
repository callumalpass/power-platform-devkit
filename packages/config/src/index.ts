import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createDiagnostic, fail, ok, withWarning, type OperationResult } from '@pp/diagnostics';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export type OutputMode = 'table' | 'json' | 'yaml' | 'ndjson' | 'markdown' | 'raw';
export type ParameterType = 'string' | 'number' | 'boolean';
export type AuthProfileType = 'static-token' | 'environment-token' | 'client-secret' | 'user' | 'device-code';
export type BrowserProfileKind = 'chrome' | 'edge' | 'chromium' | 'custom';

const primitiveValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const parameterMappingSchema = z.object({
  kind: z.string(),
  target: z.string(),
  displayName: z.string().optional(),
  connectorId: z.string().optional(),
  customConnectorId: z.string().optional(),
  defaultValue: primitiveValueSchema.optional(),
  type: z.union([z.string(), z.number()]).optional(),
  valueSchema: z.string().optional(),
  secretStore: z.number().int().optional(),
});

const projectParameterSchema = z.object({
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'boolean']).optional(),
  required: z.boolean().optional(),
  value: primitiveValueSchema.optional(),
  fromEnv: z.string().optional(),
  secretRef: z.string().optional(),
  mapsTo: z.array(parameterMappingSchema).optional(),
});

const providerBindingSchema = z.object({
  kind: z.string(),
  target: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const solutionTargetSchema = z.object({
  environment: z.string().optional(),
  uniqueName: z.string(),
});

const stageParameterOverrideSchema = z.union([primitiveValueSchema, projectParameterSchema.partial()]);

const topologyStageSchema = z.object({
  description: z.string().optional(),
  environment: z.string().optional(),
  solution: z.string().optional(),
  solutions: z.record(z.string(), z.union([z.string(), solutionTargetSchema])).optional(),
  parameters: z.record(z.string(), stageParameterOverrideSchema).optional(),
});

const secretProviderSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('env'),
    prefix: z.string().optional(),
  }),
]);

const projectSecretsSchema = z.object({
  defaultProvider: z.string().optional(),
  providers: z.record(z.string(), secretProviderSchema).optional(),
});

const projectConfigSchema = z.object({
  name: z.string().optional(),
  defaults: z
    .object({
      environment: z.string().optional(),
      solution: z.string().optional(),
      stage: z.string().optional(),
    })
    .optional(),
  solutions: z.record(z.string(), solutionTargetSchema).optional(),
  assets: z.record(z.string(), z.string()).optional(),
  providerBindings: z.record(z.string(), providerBindingSchema).optional(),
  parameters: z.record(z.string(), projectParameterSchema).optional(),
  topology: z
    .object({
      defaultStage: z.string().optional(),
      stages: z.record(z.string(), topologyStageSchema),
    })
    .optional(),
  secrets: projectSecretsSchema.optional(),
  templateRegistries: z.array(z.string()).optional(),
  build: z.record(z.string(), z.unknown()).optional(),
  docs: z
    .object({
      owner: z.string().optional(),
      paths: z.array(z.string()).optional(),
    })
    .optional(),
});

const authProfileBaseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tenantId: z.string().optional(),
  clientId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  defaultResource: z.string().optional(),
});

const staticTokenProfileSchema = authProfileBaseSchema.extend({
  type: z.literal('static-token'),
  token: z.string(),
});

const environmentTokenProfileSchema = authProfileBaseSchema.extend({
  type: z.literal('environment-token'),
  environmentVariable: z.string(),
});

const clientSecretProfileSchema = authProfileBaseSchema.extend({
  type: z.literal('client-secret'),
  tenantId: z.string(),
  clientId: z.string(),
  clientSecretEnv: z.string(),
});

const publicClientProfileFields = {
  tokenCacheKey: z.string().optional(),
  loginHint: z.string().optional(),
  accountUsername: z.string().optional(),
  homeAccountId: z.string().optional(),
  localAccountId: z.string().optional(),
};

const userProfileSchema = authProfileBaseSchema.extend({
  type: z.literal('user'),
  ...publicClientProfileFields,
  prompt: z.enum(['select_account', 'login', 'consent', 'none']).optional(),
  fallbackToDeviceCode: z.boolean().optional(),
});

const deviceCodeProfileSchema = authProfileBaseSchema.extend({
  type: z.literal('device-code'),
  ...publicClientProfileFields,
});

const browserProfileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  kind: z.enum(['chrome', 'edge', 'chromium', 'custom']).default('edge'),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  directory: z.string().optional(),
  lastBootstrapUrl: z.string().url().optional(),
  lastBootstrappedAt: z.string().datetime().optional(),
});

const storedAuthProfileSchema = z.discriminatedUnion('type', [
  staticTokenProfileSchema,
  environmentTokenProfileSchema,
  clientSecretProfileSchema,
  userProfileSchema.extend({
    browserProfile: z.string().optional(),
  }),
  deviceCodeProfileSchema,
]);

const environmentAliasSchema = z.object({
  alias: z.string(),
  url: z.string().url(),
  authProfile: z.string(),
  tenantId: z.string().optional(),
  displayName: z.string().optional(),
  defaultSolution: z.string().optional(),
  apiPath: z.string().optional(),
});

const globalConfigSchema = z.object({
  defaultOutputMode: z.enum(['table', 'json', 'yaml', 'ndjson', 'markdown', 'raw']).optional(),
  authProfiles: z.record(z.string(), storedAuthProfileSchema).default({}),
  browserProfiles: z.record(z.string(), browserProfileSchema).default({}),
  environments: z.record(z.string(), environmentAliasSchema).default({}),
  preferences: z.record(z.string(), z.unknown()).default({}),
});

export type ParameterMapping = z.infer<typeof parameterMappingSchema>;
export type ProjectParameterDefinition = z.infer<typeof projectParameterSchema>;
export type ProviderBinding = z.infer<typeof providerBindingSchema>;
export type SolutionTarget = z.infer<typeof solutionTargetSchema>;
export type StageParameterOverride = z.infer<typeof stageParameterOverrideSchema>;
export type ProjectTopologyStage = z.infer<typeof topologyStageSchema>;
export type ProjectSecretProvider = z.infer<typeof secretProviderSchema>;
export type ProjectSecretsConfig = z.infer<typeof projectSecretsSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type BrowserProfile = z.infer<typeof browserProfileSchema>;
export type StoredAuthProfile = z.infer<typeof storedAuthProfileSchema>;
export type EnvironmentAlias = z.infer<typeof environmentAliasSchema>;
export type GlobalConfig = z.output<typeof globalConfigSchema>;

export interface LocatedConfig<T> {
  path: string;
  config: T;
}

export interface ConfigStoreOptions {
  configDir?: string;
}

export const PROJECT_CONFIG_FILENAMES = ['pp.config.json', 'pp.config.yaml', 'pp.config.yml'];
export const GLOBAL_CONFIG_FILENAMES = ['config.json', 'config.yaml', 'config.yml'];

export function getGlobalConfigDir(options: ConfigStoreOptions = {}): string {
  return resolve(options.configDir ?? join(homedir(), '.config', 'pp'));
}

export function getGlobalConfigFilePath(options: ConfigStoreOptions = {}): string {
  return join(getGlobalConfigDir(options), 'config.json');
}

export function getMsalCacheDir(options: ConfigStoreOptions = {}): string {
  return join(getGlobalConfigDir(options), 'msal');
}

export function createEmptyGlobalConfig(): GlobalConfig {
  return {
    authProfiles: {},
    browserProfiles: {},
    environments: {},
    preferences: {},
  };
}

export async function findNearestProjectConfig(startDir: string): Promise<string | undefined> {
  let current = resolve(startDir);

  while (true) {
    for (const filename of PROJECT_CONFIG_FILENAMES) {
      const candidate = join(current, filename);
      if (await exists(candidate)) {
        return candidate;
      }
    }

    const parent = dirname(current);

    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

export async function loadProjectConfig(startDir = process.cwd()): Promise<OperationResult<LocatedConfig<ProjectConfig> | undefined>> {
  const path = await findNearestProjectConfig(startDir);

  if (!path) {
    return withWarning(
      ok<LocatedConfig<ProjectConfig> | undefined>(undefined, {
        supportTier: 'preview',
      }),
      createDiagnostic('warning', 'PROJECT_CONFIG_NOT_FOUND', 'No project config file was found. Using defaults.', {
        source: '@pp/config',
      })
    );
  }

  return readLocatedConfig(path, projectConfigSchema, '@pp/config');
}

export async function loadGlobalConfig(
  options: ConfigStoreOptions = {}
): Promise<OperationResult<LocatedConfig<GlobalConfig> | undefined>> {
  const configDir = getGlobalConfigDir(options);

  for (const filename of GLOBAL_CONFIG_FILENAMES) {
    const candidate = join(configDir, filename);

    if (await exists(candidate)) {
      return readLocatedConfig(candidate, globalConfigSchema, '@pp/config');
    }
  }

  return ok(undefined, { supportTier: 'preview' });
}

export async function loadGlobalConfigOrDefault(
  options: ConfigStoreOptions = {}
): Promise<OperationResult<LocatedConfig<GlobalConfig>>> {
  const loaded = await loadGlobalConfig(options);

  if (!loaded.success) {
    return fail(loaded.diagnostics, {
      supportTier: loaded.supportTier,
      warnings: loaded.warnings,
      suggestedNextActions: loaded.suggestedNextActions,
      provenance: loaded.provenance,
      knownLimitations: loaded.knownLimitations,
    });
  }

  return ok(
    loaded.data ?? {
      path: getGlobalConfigFilePath(options),
      config: createEmptyGlobalConfig(),
    },
    {
      supportTier: 'preview',
      diagnostics: loaded.diagnostics,
      warnings: loaded.warnings,
      suggestedNextActions: loaded.suggestedNextActions,
      provenance: loaded.provenance,
      knownLimitations: loaded.knownLimitations,
    }
  );
}

export async function writeGlobalConfig(
  config: GlobalConfig,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<LocatedConfig<GlobalConfig>>> {
  const path = getGlobalConfigFilePath(options);
  const normalized = globalConfigSchema.parse(config);

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(normalized, null, 2) + '\n', 'utf8');

    return ok(
      {
        path,
        config: normalized,
      },
      {
        supportTier: 'preview',
      }
    );
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CONFIG_WRITE_FAILED', `Failed to write global config ${path}`, {
        source: '@pp/config',
        detail: error instanceof Error ? error.message : String(error),
        path,
      })
    );
  }
}

export async function listAuthProfiles(options: ConfigStoreOptions = {}): Promise<OperationResult<StoredAuthProfile[]>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<StoredAuthProfile[]>;
  }

  const current = config.data.config;

  return ok(Object.values(current.authProfiles), {
    supportTier: 'preview',
    diagnostics: config.diagnostics,
    warnings: config.warnings,
  });
}

export async function listBrowserProfiles(options: ConfigStoreOptions = {}): Promise<OperationResult<BrowserProfile[]>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<BrowserProfile[]>;
  }

  const current = config.data.config;

  return ok(Object.values(current.browserProfiles), {
    supportTier: 'preview',
    diagnostics: config.diagnostics,
    warnings: config.warnings,
  });
}

export async function getAuthProfile(
  name: string,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<StoredAuthProfile | undefined>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<StoredAuthProfile | undefined>;
  }

  const current = config.data.config;

  return ok(current.authProfiles[name], {
    supportTier: 'preview',
    diagnostics: config.diagnostics,
    warnings: config.warnings,
  });
}

export async function getBrowserProfile(
  name: string,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<BrowserProfile | undefined>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<BrowserProfile | undefined>;
  }

  const current = config.data.config;

  return ok(current.browserProfiles[name], {
    supportTier: 'preview',
    diagnostics: config.diagnostics,
    warnings: config.warnings,
  });
}

export async function saveAuthProfile(
  profile: StoredAuthProfile,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<StoredAuthProfile>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<StoredAuthProfile>;
  }

  const current = config.data.config;
  const nextConfig: GlobalConfig = {
    ...current,
    authProfiles: {
      ...current.authProfiles,
      [profile.name]: profile,
    },
  };

  const written = await writeGlobalConfig(nextConfig, options);

  if (!written.success) {
    return written as unknown as OperationResult<StoredAuthProfile>;
  }

  return ok(profile, {
    supportTier: 'preview',
    diagnostics: written.diagnostics,
    warnings: written.warnings,
  });
}

export async function saveBrowserProfile(
  profile: BrowserProfile,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<BrowserProfile>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<BrowserProfile>;
  }

  const current = config.data.config;
  const nextConfig: GlobalConfig = {
    ...current,
    browserProfiles: {
      ...current.browserProfiles,
      [profile.name]: profile,
    },
  };

  const written = await writeGlobalConfig(nextConfig, options);

  if (!written.success) {
    return written as unknown as OperationResult<BrowserProfile>;
  }

  return ok(profile, {
    supportTier: 'preview',
    diagnostics: written.diagnostics,
    warnings: written.warnings,
  });
}

export async function removeAuthProfile(
  name: string,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<boolean>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<boolean>;
  }

  const current = config.data.config;

  if (!current.authProfiles[name]) {
    return ok(false, {
      supportTier: 'preview',
    });
  }

  const nextProfiles = { ...current.authProfiles };
  delete nextProfiles[name];
  const nextEnvironments = Object.fromEntries(
    Object.entries(current.environments).filter(([, environment]) => environment.authProfile !== name)
  );

  const written = await writeGlobalConfig(
    {
      ...current,
      authProfiles: nextProfiles,
      environments: nextEnvironments,
    },
    options
  );

  if (!written.success) {
    return written as unknown as OperationResult<boolean>;
  }

  return ok(true, { supportTier: 'preview' });
}

export async function removeBrowserProfile(
  name: string,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<boolean>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<boolean>;
  }

  const current = config.data.config;

  if (!current.browserProfiles[name]) {
    return ok(false, {
      supportTier: 'preview',
    });
  }

  const nextBrowserProfiles = { ...current.browserProfiles };
  delete nextBrowserProfiles[name];
  const nextAuthProfiles = Object.fromEntries(
    Object.entries(current.authProfiles).map(([profileName, profile]) => {
      if (profile.type !== 'user' || profile.browserProfile !== name) {
        return [profileName, profile];
      }

      const { browserProfile, ...rest } = profile;
      return [profileName, rest];
    })
  );

  const written = await writeGlobalConfig(
    {
      ...current,
      authProfiles: nextAuthProfiles,
      browserProfiles: nextBrowserProfiles,
    },
    options
  );

  if (!written.success) {
    return written as unknown as OperationResult<boolean>;
  }

  return ok(true, { supportTier: 'preview' });
}

export async function listEnvironments(options: ConfigStoreOptions = {}): Promise<OperationResult<EnvironmentAlias[]>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<EnvironmentAlias[]>;
  }

  const current = config.data.config;

  return ok(Object.values(current.environments), {
    supportTier: 'preview',
    diagnostics: config.diagnostics,
    warnings: config.warnings,
  });
}

export async function getEnvironmentAlias(
  alias: string,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<EnvironmentAlias | undefined>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<EnvironmentAlias | undefined>;
  }

  const current = config.data.config;

  return ok(current.environments[alias], {
    supportTier: 'preview',
    diagnostics: config.diagnostics,
    warnings: config.warnings,
  });
}

export async function saveEnvironmentAlias(
  environment: EnvironmentAlias,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<EnvironmentAlias>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<EnvironmentAlias>;
  }

  const current = config.data.config;
  const nextConfig: GlobalConfig = {
    ...current,
    environments: {
      ...current.environments,
      [environment.alias]: environment,
    },
  };

  const written = await writeGlobalConfig(nextConfig, options);

  if (!written.success) {
    return written as unknown as OperationResult<EnvironmentAlias>;
  }

  return ok(environment, {
    supportTier: 'preview',
    diagnostics: written.diagnostics,
    warnings: written.warnings,
  });
}

export async function removeEnvironmentAlias(
  alias: string,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<boolean>> {
  const config = await loadGlobalConfigOrDefault(options);

  if (!config.success || !config.data) {
    return config as unknown as OperationResult<boolean>;
  }

  const current = config.data.config;

  if (!current.environments[alias]) {
    return ok(false, {
      supportTier: 'preview',
    });
  }

  const nextEnvironments = { ...current.environments };
  delete nextEnvironments[alias];
  const written = await writeGlobalConfig(
    {
      ...current,
      environments: nextEnvironments,
    },
    options
  );

  if (!written.success) {
    return written as unknown as OperationResult<boolean>;
  }

  return ok(true, { supportTier: 'preview' });
}

async function readLocatedConfig<Schema extends z.ZodTypeAny>(
  path: string,
  schema: Schema,
  source: string
): Promise<OperationResult<LocatedConfig<z.output<Schema>>>> {
  try {
    const rawText = await readFile(path, 'utf8');
    const parsed = path.endsWith('.json') ? JSON.parse(rawText) : parseYaml(rawText);
    const config = schema.parse(parsed);

    return ok({ path, config }, { supportTier: 'preview' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(
        createDiagnostic('error', 'CONFIG_INVALID', `Config validation failed for ${path}`, {
          source,
          detail: JSON.stringify(error.issues, null, 2),
          path,
        }),
        {
          supportTier: 'preview',
        }
      );
    }

    return fail(
      createDiagnostic('error', 'CONFIG_READ_FAILED', `Failed to read config ${path}`, {
        source,
        detail: error instanceof Error ? error.message : String(error),
        path,
      }),
      {
        supportTier: 'preview',
      }
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
