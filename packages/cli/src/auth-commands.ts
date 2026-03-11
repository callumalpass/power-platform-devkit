import {
  AuthService,
  DEFAULT_BROWSER_BOOTSTRAP_URL,
  summarizeBrowserProfile,
  summarizeProfile,
  type AuthProfile,
  type BrowserProfile,
  type UserAuthProfile,
} from '@pp/auth';
import { getEnvironmentAlias, type ConfigStoreOptions } from '@pp/config';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { createMutationPreview, readMutationFlags, type CliOutputFormat } from './contract';
import { buildAuthProfileUsageSummary } from './relationship-context';

type OutputFormat = CliOutputFormat;

interface AuthCommandDependencies {
  positionalArgs(args: string[]): string[];
  outputFormat(args: string[], fallback: OutputFormat): OutputFormat;
  printFailure(result: OperationResult<unknown>): number;
  printByFormat(value: unknown, format: OutputFormat): void;
  readConfigOptions(args: string[]): ConfigStoreOptions;
  readFlag(args: string[], name: string): string | undefined;
  readRepeatedFlags(args: string[], name: string): string[];
  readListFlag(args: string[], name: string): string[] | undefined;
  readEnvironmentAlias(args: string[]): string | undefined;
  hasFlag(args: string[], name: string): boolean;
  argumentFailure(code: string, message: string): OperationResult<never>;
  promptForEnter(message: string): Promise<void>;
}

export async function runAuthProfileListCommand(
  auth: AuthService,
  args: string[],
  deps: AuthCommandDependencies
): Promise<number> {
  const format = deps.outputFormat(args, 'json');
  const profiles = await auth.listProfiles();

  if (!profiles.success) {
    return deps.printFailure(profiles);
  }

  deps.printByFormat((profiles.data ?? []).map(summarizeProfile), format);
  return 0;
}

export async function runAuthProfileInspectCommand(
  auth: AuthService,
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: AuthCommandDependencies
): Promise<number> {
  const target = await resolveAuthProfileInspectTarget(configOptions, args, deps);

  if (!target.success || !target.data) {
    return deps.printFailure(target);
  }

  const format = deps.outputFormat(args, 'json');
  const profile = await auth.getProfile(target.data.name);

  if (!profile.success) {
    return deps.printFailure(profile);
  }

  if (!profile.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${target.data.name} was not found.`)));
  }

  const summary = summarizeProfile(profile.data);
  const usage = await buildAuthProfileUsageSummary(target.data.name, configOptions);

  deps.printByFormat(
    {
      ...(target.data.environmentAlias
        ? {
            ...omitAuthProfileInspectDefaultResource(summary),
            resolvedFromEnvironment: target.data.environmentAlias,
            resolvedEnvironmentUrl: target.data.environmentUrl,
            targetResource: target.data.environmentUrl,
            profileDefaultResource: summary.defaultResource,
            defaultResourceMatchesResolvedEnvironment:
              typeof summary.defaultResource === 'string' && typeof target.data.environmentUrl === 'string'
                ? normalizeAuthProfileInspectResource(summary.defaultResource) ===
                  normalizeAuthProfileInspectResource(target.data.environmentUrl)
                : undefined,
          }
        : summary),
      relationships: {
        environmentAliases: usage.environmentAliases,
        environmentCount: usage.environmentCount,
        currentProject: usage.currentProject,
      },
    },
    format
  );
  return 0;
}

export async function runAuthBrowserProfileListCommand(
  auth: AuthService,
  args: string[],
  deps: AuthCommandDependencies
): Promise<number> {
  const format = deps.outputFormat(args, 'json');
  const profiles = await auth.listBrowserProfiles();

  if (!profiles.success) {
    return deps.printFailure(profiles);
  }

  deps.printByFormat(
    (profiles.data ?? []).map((profile) => summarizeBrowserProfile(profile, deps.readConfigOptions(args))),
    format
  );
  return 0;
}

export async function runAuthBrowserProfileInspectCommand(
  auth: AuthService,
  args: string[],
  deps: AuthCommandDependencies
): Promise<number> {
  const name = deps.positionalArgs(args)[0];

  if (!name) {
    return deps.printFailure(deps.argumentFailure('AUTH_BROWSER_PROFILE_NAME_REQUIRED', 'Browser profile name is required.'));
  }

  const profile = await auth.getBrowserProfile(name);

  if (!profile.success) {
    return deps.printFailure(profile);
  }

  if (!profile.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'AUTH_BROWSER_PROFILE_NOT_FOUND', `Browser profile ${name} was not found.`)));
  }

  deps.printByFormat(summarizeBrowserProfile(profile.data, deps.readConfigOptions(args)), deps.outputFormat(args, 'json'));
  return 0;
}

export async function runAuthBrowserProfileSaveCommand(
  auth: AuthService,
  args: string[],
  deps: AuthCommandDependencies
): Promise<number> {
  const name = deps.readFlag(args, '--name');

  if (!name) {
    return deps.printFailure(deps.argumentFailure('AUTH_BROWSER_PROFILE_NAME_REQUIRED', '--name is required for browser profile add.'));
  }

  const kind = (deps.readFlag(args, '--kind') ?? 'edge') as BrowserProfile['kind'];

  if (!isBrowserProfileKind(kind)) {
    return deps.printFailure(
      deps.argumentFailure('AUTH_BROWSER_PROFILE_KIND_INVALID', 'Unsupported browser profile kind. Use `edge`, `chrome`, `chromium`, or `custom`.')
    );
  }

  if (kind === 'custom' && !deps.readFlag(args, '--command')) {
    return deps.printFailure(
      deps.argumentFailure('AUTH_BROWSER_PROFILE_COMMAND_REQUIRED', '--command is required when browser profile kind is `custom`.')
    );
  }

  const profile: BrowserProfile = {
    name,
    kind,
    description: deps.readFlag(args, '--description'),
    command: deps.readFlag(args, '--command'),
    args: deps.readRepeatedFlags(args, '--arg'),
    directory: deps.readFlag(args, '--directory'),
  };

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'auth.browser-profile.add',
    { name, kind },
    summarizeBrowserProfile(profile, deps.readConfigOptions(args)),
    deps
  );

  if (preview !== undefined) {
    return preview;
  }

  const saved = await auth.saveBrowserProfile(profile);

  if (!saved.success || !saved.data) {
    return deps.printFailure(saved);
  }

  deps.printByFormat(summarizeBrowserProfile(saved.data, deps.readConfigOptions(args)), deps.outputFormat(args, 'json'));
  return 0;
}

export async function runAuthBrowserProfileBootstrapCommand(
  auth: AuthService,
  args: string[],
  deps: AuthCommandDependencies
): Promise<number> {
  const name = deps.positionalArgs(args)[0];

  if (!name) {
    return deps.printFailure(deps.argumentFailure('AUTH_BROWSER_PROFILE_NAME_REQUIRED', 'Browser profile name is required.'));
  }

  const url = deps.readFlag(args, '--url') ?? DEFAULT_BROWSER_BOOTSTRAP_URL;
  const noWait = deps.hasFlag(args, '--no-wait');
  const format = deps.outputFormat(args, 'json');
  const profile = await auth.getBrowserProfile(name);

  try {
    new URL(url);
  } catch {
    return deps.printFailure(
      deps.argumentFailure('AUTH_BROWSER_PROFILE_BOOTSTRAP_URL_INVALID', `Bootstrap URL must be an absolute URL. Received: ${url}`)
    );
  }

  if (!profile.success) {
    return deps.printFailure(profile);
  }

  if (!profile.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'AUTH_BROWSER_PROFILE_NOT_FOUND', `Browser profile ${name} was not found.`)));
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'auth.browser-profile.bootstrap',
    { name, url },
    {
      ...summarizeBrowserProfile(profile.data, deps.readConfigOptions(args)),
      bootstrapUrl: url,
    },
    deps
  );

  if (preview !== undefined) {
    return preview;
  }

  if (!noWait && !process.stdin.isTTY) {
    return deps.printFailure(
      deps.argumentFailure(
        'AUTH_BROWSER_PROFILE_BOOTSTRAP_TTY_REQUIRED',
        'Browser profile bootstrap requires an interactive terminal unless --no-wait is supplied.'
      )
    );
  }

  const launched = await auth.launchBrowserProfile(name, url);

  if (!launched.success || !launched.data) {
    return deps.printFailure(launched);
  }

  if (noWait) {
    deps.printByFormat(
      {
        launched: true,
        browserProfile: summarizeBrowserProfile(profile.data, deps.readConfigOptions(args)),
        bootstrapUrl: url,
      },
      format
    );
    return 0;
  }

  process.stderr.write(
    [
      `Opened browser profile ${name}.`,
      `Target URL: ${url}`,
      'Complete the one-time Microsoft / Power Apps web sign-in in that browser.',
      'Wait until Power Apps is loaded, then close the browser window and press Enter here.',
    ].join('\n') + '\n'
  );

  await deps.promptForEnter('');

  const marked = await auth.markBrowserProfileBootstrapped(name, {
    url,
  });

  if (!marked.success || !marked.data) {
    return deps.printFailure(marked);
  }

  deps.printByFormat(
    {
      bootstrapped: true,
      browserProfile: summarizeBrowserProfile(marked.data, deps.readConfigOptions(args)),
      bootstrapUrl: url,
    },
    format
  );
  return 0;
}

export async function runAuthBrowserProfileRemoveCommand(
  auth: AuthService,
  args: string[],
  deps: AuthCommandDependencies
): Promise<number> {
  const name = deps.positionalArgs(args)[0];

  if (!name) {
    return deps.printFailure(deps.argumentFailure('AUTH_BROWSER_PROFILE_NAME_REQUIRED', 'Browser profile name is required.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'auth.browser-profile.remove', { name }, undefined, deps);

  if (preview !== undefined) {
    return preview;
  }

  const removed = await auth.removeBrowserProfile(name);

  if (!removed.success) {
    return deps.printFailure(removed);
  }

  deps.printByFormat({ removed: removed.data ?? false, name }, 'json');
  return 0;
}

export async function runAuthProfileSaveCommand(
  auth: AuthService,
  args: string[],
  type: AuthProfile['type'],
  deps: AuthCommandDependencies
): Promise<number> {
  const name = deps.readFlag(args, '--name');
  const description = deps.readFlag(args, '--description');
  const tenantId = deps.readFlag(args, '--tenant-id');
  const clientId = deps.readFlag(args, '--client-id');
  const defaultResource = deps.readFlag(args, '--resource');
  const scopes = deps.readListFlag(args, '--scope');

  if (!name) {
    return deps.printFailure(deps.argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  let profile: AuthProfile;

  switch (type) {
    case 'user': {
      profile = buildPublicClientProfile(
        {
          name,
          type,
        },
        args,
        deps
      );
      break;
    }
    case 'static-token': {
      const token = deps.readFlag(args, '--token');

      if (!token) {
        return deps.printFailure(deps.argumentFailure('AUTH_TOKEN_REQUIRED', '--token is required for add-static.'));
      }

      profile = {
        name,
        type,
        token,
        description,
        tenantId,
        clientId,
        scopes,
        defaultResource,
      };
      break;
    }
    case 'environment-token': {
      const environmentVariable = deps.readFlag(args, '--env-var');

      if (!environmentVariable) {
        return deps.printFailure(deps.argumentFailure('AUTH_ENV_VAR_REQUIRED', '--env-var is required for add-env.'));
      }

      profile = {
        name,
        type,
        environmentVariable,
        description,
        tenantId,
        clientId,
        scopes,
        defaultResource,
      };
      break;
    }
    case 'client-secret': {
      const clientSecretEnv = deps.readFlag(args, '--secret-env');

      if (!tenantId || !clientId || !clientSecretEnv) {
        return deps.printFailure(
          deps.argumentFailure(
            'AUTH_CLIENT_SECRET_FIELDS_REQUIRED',
            '--tenant-id, --client-id, and --secret-env are required for add-client-secret.'
          )
        );
      }

      profile = {
        name,
        type,
        tenantId,
        clientId,
        clientSecretEnv,
        description,
        scopes,
        defaultResource,
      };
      break;
    }
    case 'device-code': {
      profile = buildPublicClientProfile(
        {
          name,
          type,
        },
        args,
        deps
      );
      break;
    }
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    `auth.profile.${type === 'user' ? 'add-user' : `add-${type}`}`,
    { name },
    summarizeProfile(profile),
    deps
  );

  if (preview !== undefined) {
    return preview;
  }

  const saved = await auth.saveProfile(profile);

  if (!saved.success || !saved.data) {
    return deps.printFailure(saved);
  }

  deps.printByFormat(summarizeProfile(saved.data), deps.outputFormat(args, 'json'));
  return 0;
}

export async function runAuthLoginCommand(auth: AuthService, args: string[], deps: AuthCommandDependencies): Promise<number> {
  const name = deps.readFlag(args, '--name');

  if (!name) {
    return deps.printFailure(deps.argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  const existing = await auth.getProfile(name);

  if (!existing.success) {
    return deps.printFailure(existing);
  }

  if (existing.data && existing.data.type !== 'user' && existing.data.type !== 'device-code') {
    return deps.printFailure(
      deps.argumentFailure(
        'AUTH_PROFILE_TYPE_CONFLICT',
        `Auth profile ${name} already exists with type ${existing.data.type}. Use a different name for browser login.`
      )
    );
  }

  const requestedType: UserAuthProfile['type'] = deps.hasFlag(args, '--device-code')
    ? 'device-code'
    : deps.hasFlag(args, '--interactive')
      ? 'user'
      : existing.data?.type === 'device-code'
        ? 'device-code'
        : 'user';

  const baseProfile: UserAuthProfile =
    existing.data && (existing.data.type === 'user' || existing.data.type === 'device-code')
      ? existing.data
      : {
          name,
          type: requestedType,
        };

  const profile = buildPublicClientProfile(
    {
      ...baseProfile,
      name,
      type: requestedType,
    },
    args,
    deps
  );

  const resource = resolveRequestedResource(profile, deps.readFlag(args, '--resource'));

  if (resource === undefined) {
    return deps.printFailure(
      deps.argumentFailure(
        'AUTH_RESOURCE_REQUIRED',
        '--resource is required unless the profile already defines a default resource or explicit scopes.'
      )
    );
  }

  const login = await auth.loginProfile(profile, resource, {
    forcePrompt: deps.hasFlag(args, '--force-prompt'),
    preferredFlow: profile.type === 'device-code' ? 'device-code' : 'interactive',
  });

  if (!login.success || !login.data) {
    return deps.printFailure(login);
  }

  deps.printByFormat(
    {
      profile: summarizeProfile(login.data.profile),
      resource: resource || undefined,
      authenticated: true,
    },
    deps.outputFormat(args, 'json')
  );
  return 0;
}

export async function runAuthProfileRemoveCommand(
  auth: AuthService,
  args: string[],
  deps: AuthCommandDependencies
): Promise<number> {
  const name = deps.positionalArgs(args)[0];

  if (!name) {
    return deps.printFailure(deps.argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'auth.profile.remove', { name }, undefined, deps);

  if (preview !== undefined) {
    return preview;
  }

  const removed = await auth.removeProfile(name);

  if (!removed.success) {
    return deps.printFailure(removed);
  }

  deps.printByFormat({ removed: removed.data ?? false, name }, 'json');
  return 0;
}

export async function runAuthTokenCommand(auth: AuthService, args: string[], deps: AuthCommandDependencies): Promise<number> {
  const profileName = deps.readFlag(args, '--profile');
  const format = deps.outputFormat(args, 'raw');

  if (!profileName) {
    return deps.printFailure(deps.argumentFailure('AUTH_TOKEN_PROFILE_REQUIRED', '--profile is required.'));
  }

  const profile = await auth.getProfile(profileName);

  if (!profile.success) {
    return deps.printFailure(profile);
  }

  if (!profile.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${profileName} was not found.`)));
  }

  const resource = resolveRequestedResource(profile.data, deps.readFlag(args, '--resource'));

  if (resource === undefined) {
    return deps.printFailure(
      deps.argumentFailure(
        'AUTH_TOKEN_RESOURCE_REQUIRED',
        '--resource is required unless the profile already defines a default resource or explicit scopes.'
      )
    );
  }

  const token = await auth.getAccessToken(profileName, resource);

  if (!token.success || !token.data) {
    return deps.printFailure(token);
  }

  if (format === 'raw') {
    process.stdout.write(token.data.token + '\n');
    return 0;
  }

  deps.printByFormat(
    {
      profile: summarizeProfile(token.data.profile),
      resource: resource || undefined,
      token: token.data.token,
    },
    format
  );
  return 0;
}

async function resolveAuthProfileInspectTarget(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: Pick<AuthCommandDependencies, 'positionalArgs' | 'readEnvironmentAlias' | 'argumentFailure'>
): Promise<OperationResult<{ name: string; environmentAlias?: string; environmentUrl?: string }>> {
  const name = deps.positionalArgs(args)[0];

  if (name) {
    return ok(
      {
        name,
      },
      {
        supportTier: 'preview',
      }
    );
  }

  const environmentAlias = deps.readEnvironmentAlias(args);

  if (!environmentAlias) {
    return deps.argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name or --environment <alias> is required.');
  }

  const environment = await getEnvironmentAlias(environmentAlias, configOptions);

  if (!environment.success) {
    return fail(environment.diagnostics, {
      warnings: environment.warnings,
      supportTier: environment.supportTier,
      details: environment.details,
      suggestedNextActions: environment.suggestedNextActions,
      provenance: environment.provenance,
      knownLimitations: environment.knownLimitations,
    });
  }

  if (!environment.data) {
    return fail(
      createDiagnostic('error', 'ENV_NOT_FOUND', `Environment alias ${environmentAlias} was not found.`, {
        source: '@pp/cli',
      })
    );
  }

  return ok(
    {
      name: environment.data.authProfile,
      environmentAlias,
      environmentUrl: environment.data.url,
    },
    {
      supportTier: 'preview',
      diagnostics: environment.diagnostics,
      warnings: environment.warnings,
    }
  );
}

function maybeHandleMutationPreview(
  args: string[],
  fallbackFormat: OutputFormat,
  action: string,
  target: Record<string, unknown>,
  input: unknown,
  deps: Pick<AuthCommandDependencies, 'printFailure' | 'printByFormat' | 'outputFormat'>
): number | undefined {
  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return deps.printFailure(mutation);
  }

  if (mutation.data.mode === 'apply') {
    return undefined;
  }

  deps.printByFormat(createMutationPreview(action, mutation.data, target, input), deps.outputFormat(args, fallbackFormat));
  return 0;
}

function buildPublicClientProfile(
  baseProfile: UserAuthProfile,
  args: string[],
  deps: Pick<AuthCommandDependencies, 'readFlag' | 'readListFlag' | 'hasFlag'>
): UserAuthProfile {
  const prompt = deps.readFlag(args, '--prompt');
  const scopes = deps.readListFlag(args, '--scope');
  const explicitFallback = deps.hasFlag(args, '--no-device-code-fallback')
    ? false
    : deps.hasFlag(args, '--device-code-fallback')
      ? true
      : undefined;

  if (baseProfile.type === 'device-code') {
    return {
      ...baseProfile,
      description: deps.readFlag(args, '--description') ?? baseProfile.description,
      tenantId: deps.readFlag(args, '--tenant-id') ?? baseProfile.tenantId,
      clientId: deps.readFlag(args, '--client-id') ?? baseProfile.clientId,
      defaultResource: deps.readFlag(args, '--resource') ?? baseProfile.defaultResource,
      scopes: scopes ?? baseProfile.scopes,
      tokenCacheKey: deps.readFlag(args, '--cache-key') ?? baseProfile.tokenCacheKey,
      loginHint: deps.readFlag(args, '--login-hint') ?? baseProfile.loginHint,
    };
  }

  return {
    ...baseProfile,
    description: deps.readFlag(args, '--description') ?? baseProfile.description,
    tenantId: deps.readFlag(args, '--tenant-id') ?? baseProfile.tenantId,
    clientId: deps.readFlag(args, '--client-id') ?? baseProfile.clientId,
    defaultResource: deps.readFlag(args, '--resource') ?? baseProfile.defaultResource,
    scopes: scopes ?? baseProfile.scopes,
    tokenCacheKey: deps.readFlag(args, '--cache-key') ?? baseProfile.tokenCacheKey,
    loginHint: deps.readFlag(args, '--login-hint') ?? baseProfile.loginHint,
    browserProfile: deps.readFlag(args, '--browser-profile') ?? baseProfile.browserProfile,
    prompt: isPromptValue(prompt) ? prompt : baseProfile.prompt,
    fallbackToDeviceCode: explicitFallback ?? baseProfile.fallbackToDeviceCode,
  };
}

function resolveRequestedResource(profile: AuthProfile, requestedResource: string | undefined): string | undefined {
  if (requestedResource) {
    return requestedResource;
  }

  if (profile.defaultResource) {
    return profile.defaultResource;
  }

  if (profile.scopes?.length) {
    return '';
  }

  return undefined;
}

function normalizeAuthProfileInspectResource(resource: string): string {
  try {
    return new URL(resource).origin;
  } catch {
    return resource.replace(/\/+$/, '');
  }
}

function omitAuthProfileInspectDefaultResource(summary: Record<string, unknown>): Record<string, unknown> {
  const { defaultResource: _defaultResource, ...withoutDefaultResource } = summary;
  return withoutDefaultResource;
}

function isPromptValue(value: string | undefined): value is Extract<UserAuthProfile, { type: 'user' }>['prompt'] {
  return value === 'select_account' || value === 'login' || value === 'consent' || value === 'none';
}

function isBrowserProfileKind(value: string): value is BrowserProfile['kind'] {
  return value === 'edge' || value === 'chrome' || value === 'chromium' || value === 'custom';
}
