import { AuthService, summarizeBrowserProfile, summarizeProfile, type AuthProfile } from '@pp/auth';
import type { BrowserProfile } from '@pp/config';
import {
  getEnvironmentAlias,
  listEnvironments,
  removeEnvironmentAlias,
  saveEnvironmentAlias,
  type ConfigStoreOptions,
  type EnvironmentAlias,
} from '@pp/config';
import { resolveDataverseClient } from '@pp/dataverse';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { SolutionService } from '@pp/solution';
import { createMutationPreview, createSuccessPayload, readMutationFlags, type CliOutputFormat } from './contract';
import { buildEnvironmentProjectUsageSummary } from './relationship-context';

type OutputFormat = CliOutputFormat;

interface EnvironmentCommandDependencies {
  positionalArgs(args: string[]): string[];
  readRepeatedFlags(args: string[], name: string): string[];
  outputFormat(args: string[], fallback: OutputFormat): OutputFormat;
  printFailure(result: OperationResult<unknown>): number;
  printByFormat(value: unknown, format: OutputFormat): void;
  printWarnings(result: OperationResult<unknown>): void;
  readFlag(args: string[], name: string): string | undefined;
  argumentFailure(code: string, message: string): OperationResult<never>;
  discoverMakerEnvironmentIdForEnvironment(
    environment: EnvironmentAlias,
    authProfile: AuthProfile,
    configOptions: ConfigStoreOptions
  ): Promise<OperationResult<string | undefined>>;
}

export async function runEnvironmentListCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  const environments = await listEnvironments(configOptions);

  if (!environments.success) {
    return deps.printFailure(environments);
  }

  deps.printByFormat(environments.data ?? [], deps.outputFormat(args, 'json'));
  return 0;
}

export async function runEnvironmentAddCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  const positionalAlias = deps.positionalArgs(args)[0];
  const flaggedAlias = deps.readFlag(args, '--name');
  const alias = positionalAlias ?? flaggedAlias;
  const url = deps.readFlag(args, '--url');
  const authProfile = deps.readFlag(args, '--profile');

  if (positionalAlias && flaggedAlias && positionalAlias !== flaggedAlias) {
    return deps.printFailure(
      deps.argumentFailure('ENV_ADD_ALIAS_CONFLICT', `Provide the environment alias either positionally or with --name, not both (${positionalAlias} vs ${flaggedAlias}).`)
    );
  }

  if (!alias || !url || !authProfile) {
    return deps.printFailure(
      deps.argumentFailure('ENV_ADD_ARGS_REQUIRED', 'Usage: env add <alias> --url URL --profile PROFILE [--default-solution NAME] [--maker-env-id GUID]')
    );
  }

  const environment: EnvironmentAlias = {
    alias,
    url,
    authProfile,
    tenantId: deps.readFlag(args, '--tenant-id'),
    displayName: deps.readFlag(args, '--display-name'),
    defaultSolution: deps.readFlag(args, '--default-solution'),
    makerEnvironmentId: deps.readFlag(args, '--maker-env-id'),
    apiPath: deps.readFlag(args, '--api-path'),
  };

  const preview = maybeHandleMutationPreview(args, 'json', 'env.add', { alias, url, authProfile }, environment, deps);

  if (preview !== undefined) {
    return preview;
  }

  const saved = await saveEnvironmentAlias(environment, configOptions);

  if (!saved.success || !saved.data) {
    return deps.printFailure(saved);
  }

  deps.printByFormat(saved.data, deps.outputFormat(args, 'json'));
  return 0;
}

export async function runEnvironmentInspectCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  const alias = deps.positionalArgs(args)[0];

  if (!alias) {
    return deps.printFailure(deps.argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  const environment = await getEnvironmentAlias(alias, configOptions);

  if (!environment.success) {
    return deps.printFailure(environment);
  }

  if (!environment.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'ENV_NOT_FOUND', `Environment alias ${alias} was not found.`)));
  }

  const auth = new AuthService(configOptions);
  const profile = await auth.getProfile(environment.data.authProfile);
  const browserProfile =
    profile.success && profile.data?.type === 'user' && profile.data.browserProfile
      ? await auth.getBrowserProfile(profile.data.browserProfile)
      : undefined;
  const projectUsage = await buildEnvironmentProjectUsageSummary(environment.data.alias, configOptions);

  deps.printByFormat(
    createSuccessPayload(
      buildEnvironmentInspectView(
        environment.data,
        profile.success ? profile.data ?? undefined : undefined,
        browserProfile?.success ? browserProfile.data ?? undefined : undefined,
        projectUsage
      ),
      buildEnvironmentInspectMetadata(environment.data, profile.success ? profile.data ?? undefined : undefined, projectUsage)
    ),
    deps.outputFormat(args, 'json')
  );
  return 0;
}

export async function runEnvironmentBaselineCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  const alias = deps.positionalArgs(args)[0];
  const prefix = deps.readFlag(args, '--prefix');

  if (!alias) {
    return deps.printFailure(deps.argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  if (!prefix) {
    return deps.printFailure(deps.argumentFailure('ENV_BASELINE_PREFIX_REQUIRED', '--prefix is required.'));
  }

  const environment = await getEnvironmentAlias(alias, configOptions);
  if (!environment.success) {
    return deps.printFailure(environment);
  }

  if (!environment.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'ENV_NOT_FOUND', `Environment alias ${alias} was not found.`)));
  }

  const auth = new AuthService(configOptions);
  const profile = await auth.getProfile(environment.data.authProfile);
  const browserProfile =
    profile.success && profile.data?.type === 'user' && profile.data.browserProfile
      ? await auth.getBrowserProfile(profile.data.browserProfile)
      : undefined;
  const projectUsage = await buildEnvironmentProjectUsageSummary(environment.data.alias, configOptions);
  const cleanupPlan = await buildEnvironmentCleanupPlan(configOptions, alias, prefix);

  if (!cleanupPlan.success || !cleanupPlan.data) {
    return deps.printFailure(cleanupPlan);
  }

  const resolution = await resolveDataverseClient(alias, configOptions);
  if (!resolution.success || !resolution.data) {
    return deps.printFailure(resolution);
  }

  const expectedAbsentSolutions = deps.readRepeatedFlags(args, '--expect-absent-solution');
  const solutionService = new SolutionService(resolution.data.client);
  const absenceChecks: Array<{
    uniqueName: string;
    status: 'absent' | 'present';
    solution?: { solutionid: string; uniquename: string; friendlyname?: string; version?: string; ismanaged?: boolean };
  }> = [];

  for (const uniqueName of expectedAbsentSolutions) {
    const inspection = await solutionService.inspect(uniqueName);

    if (!inspection.success) {
      return deps.printFailure(inspection);
    }

    absenceChecks.push({
      uniqueName,
      status: inspection.data ? 'present' : 'absent',
      ...(inspection.data ? { solution: inspection.data } : {}),
    });
  }

  const readyForBootstrap = cleanupPlan.data.candidateCount === 0 && absenceChecks.every((check) => check.status === 'absent');
  const suggestedNextActions = [
    ...cleanupPlan.data.suggestedNextActions,
    ...absenceChecks
      .filter((check) => check.status === 'present')
      .flatMap((check) => [
        `Solution ${check.uniqueName} is still present in ${alias}; inspect it with \`pp solution inspect ${check.uniqueName} --environment ${alias}\` before reusing the environment.`,
        `Delete ${check.uniqueName} with \`pp solution delete ${check.uniqueName} --environment ${alias}\` or clear it through the broader reset workflow before bootstrap.`,
      ]),
  ];

  deps.printByFormat(
    {
      environment: buildEnvironmentInspectView(
        environment.data,
        profile.success ? profile.data ?? undefined : undefined,
        browserProfile?.success ? browserProfile.data ?? undefined : undefined,
        projectUsage
      ),
      baseline: {
        prefix,
        remoteResetSupported: cleanupPlan.data.remoteResetSupported,
        readyForBootstrap,
        cleanupCandidates: cleanupPlan.data.cleanupCandidates,
        candidateCount: cleanupPlan.data.candidateCount,
        absenceChecks,
        suggestedNextActions: dedupeStringArray(suggestedNextActions),
        knownLimitations: cleanupPlan.data.knownLimitations,
      },
    },
    deps.outputFormat(args, 'json')
  );
  return 0;
}

export async function runEnvironmentResolveMakerIdCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  const alias = deps.positionalArgs(args)[0];

  if (!alias) {
    return deps.printFailure(
      deps.argumentFailure('ENV_ALIAS_REQUIRED', 'Usage: env resolve-maker-id <alias> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]')
    );
  }

  const environment = await getEnvironmentAlias(alias, configOptions);

  if (!environment.success) {
    return deps.printFailure(environment);
  }

  if (!environment.data) {
    return deps.printFailure(fail(createDiagnostic('error', 'ENV_NOT_FOUND', `Environment alias ${alias} was not found.`)));
  }

  const auth = new AuthService(configOptions);
  const profile = await auth.getProfile(environment.data.authProfile);

  if (!profile.success) {
    return deps.printFailure(profile);
  }

  if (!profile.data) {
    return deps.printFailure(
      fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${environment.data.authProfile} was not found.`))
    );
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'env.resolve-maker-id',
    { alias },
    {
      url: environment.data.url,
      authProfile: environment.data.authProfile,
    },
    deps
  );

  if (preview !== undefined) {
    return preview;
  }

  if (environment.data.makerEnvironmentId) {
    deps.printByFormat(
      {
        environment: environment.data,
        resolution: {
          source: 'configured',
          persisted: false,
          api: 'power-platform-environments',
        },
      },
      deps.outputFormat(args, 'json')
    );
    return 0;
  }

  const discovered = await deps.discoverMakerEnvironmentIdForEnvironment(environment.data, profile.data, configOptions);

  if (!discovered.success) {
    return deps.printFailure(discovered);
  }

  if (!discovered.data) {
    return deps.printFailure(
      fail(
        createDiagnostic(
          'error',
          'ENV_MAKER_ID_NOT_FOUND',
          `Could not discover makerEnvironmentId for environment alias ${alias}.`,
          {
            source: '@pp/cli',
            hint:
              'Confirm the alias URL matches the target Dataverse environment and that the bound auth profile can read the Power Platform environments API, or rerun `pp env add` with --maker-env-id.',
          }
        ),
        {
          supportTier: 'preview',
        }
      )
    );
  }

  const saved = await saveEnvironmentAlias(
    {
      ...environment.data,
      makerEnvironmentId: discovered.data,
    },
    configOptions
  );

  if (!saved.success || !saved.data) {
    return deps.printFailure(saved);
  }

  deps.printByFormat(
    {
      environment: saved.data,
      resolution: {
        source: 'discovered',
        persisted: true,
        api: 'power-platform-environments',
      },
    },
    deps.outputFormat(args, 'json')
  );
  return 0;
}

export async function runEnvironmentRemoveCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  const alias = deps.positionalArgs(args)[0];

  if (!alias) {
    return deps.printFailure(deps.argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'env.remove', { alias }, undefined, deps);

  if (preview !== undefined) {
    return preview;
  }

  const removed = await removeEnvironmentAlias(alias, configOptions);

  if (!removed.success) {
    return deps.printFailure(removed);
  }

  deps.printByFormat({ removed: removed.data ?? false, alias }, 'json');
  return 0;
}

export async function runEnvironmentCleanupPlanCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  const alias = deps.positionalArgs(args)[0];
  const prefix = deps.readFlag(args, '--prefix');

  if (!alias) {
    return deps.printFailure(deps.argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  if (!prefix) {
    return deps.printFailure(deps.argumentFailure('ENV_CLEANUP_PREFIX_REQUIRED', '--prefix is required.'));
  }

  const plan = await buildEnvironmentCleanupPlan(configOptions, alias, prefix);

  if (!plan.success || !plan.data) {
    return deps.printFailure(plan);
  }

  deps.printByFormat(plan.data, deps.outputFormat(args, 'json'));
  return 0;
}

export async function runEnvironmentCleanupCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  return runEnvironmentCleanupLike(configOptions, args, {
    actionName: 'env.cleanup',
    suggestedPlanCommand: 'pp env cleanup',
    deps,
  });
}

export async function runEnvironmentResetCommand(
  configOptions: ConfigStoreOptions,
  args: string[],
  deps: EnvironmentCommandDependencies
): Promise<number> {
  return runEnvironmentCleanupLike(configOptions, args, {
    actionName: 'env.reset',
    suggestedPlanCommand: 'pp env reset',
    deps,
  });
}

function buildEnvironmentInspectView(
  environment: EnvironmentAlias,
  profile: AuthProfile | undefined,
  browserProfile: BrowserProfile | undefined,
  projectUsage:
    | {
        projectRoot: string;
        selectedStage?: string;
        stages: string[];
        activeForSelectedStage: boolean;
      }
    | undefined
): Record<string, unknown> {
  return {
    ...environment,
    auth: buildEnvironmentAuthSummary(environment, profile),
    relationships: {
      currentProject: projectUsage,
      authBinding: {
        alias: environment.alias,
        authProfile: environment.authProfile,
      },
    },
    tooling: {
      pp: {
        authContextSource: 'pp-config',
        usesEnvironmentAuthProfile: true,
      },
      browser: buildEnvironmentBrowserGuidance(profile, browserProfile, environment),
      pac: buildPacEnvironmentGuidance(profile, environment),
    },
  };
}

function buildEnvironmentAuthSummary(environment: EnvironmentAlias, profile: AuthProfile | undefined): Record<string, unknown> {
  if (!profile) {
    return {
      name: environment.authProfile,
      status: 'missing',
    };
  }

  return {
    ...summarizeProfile(profile),
    status: 'configured',
  };
}

export function buildPacEnvironmentGuidance(profile: AuthProfile | undefined, environment: EnvironmentAlias): Record<string, unknown> {
  const organizationUrl = derivePacOrganizationUrl(environment.url);
  const base = {
    sharesPpAuthContext: false,
    organizationUrl,
    verificationCommand: 'pac auth list',
    nonInteractiveVerification:
      'Use `pp env inspect <alias>` and `pp dv whoami --no-interactive-auth` for agent-safe non-interactive verification. Do not assume pac supports pp-style `--no-interactive-auth` flags.',
    recommendedAction:
      `Treat pac as a separately authenticated tool. Run \`pac auth list\` and confirm the active profile targets ${organizationUrl} before using pac as a fallback.`,
  };

  if (!profile) {
    return {
      ...base,
      risk: 'unknown',
      reason: 'The bound pp auth profile could not be resolved from local config.',
    };
  }

  switch (profile.type) {
    case 'user':
      return {
        ...base,
        risk: profile.browserProfile ? 'high' : 'medium',
        reason: profile.browserProfile
          ? `This alias uses pp user auth with browser profile ${profile.browserProfile}, but pac does not read pp browser-profile bootstrap state or its auth cache.`
          : 'This alias uses pp user auth, but pac does not read pp auth profiles or their cached session state.',
      };
    case 'device-code':
      return {
        ...base,
        risk: 'medium',
        reason: 'This alias uses a pp device-code profile, but pac still requires its own auth bootstrap instead of reusing pp config.',
      };
    case 'client-secret':
      return {
        ...base,
        risk: 'low',
        reason: 'This alias uses a non-interactive pp client-secret profile, but pac still needs separate credentials or environment setup.',
      };
    case 'environment-token':
      return {
        ...base,
        risk: 'low',
        reason: 'This alias uses a pp environment-token profile, but pac still needs a separate token/bootstrap path.',
      };
    case 'static-token':
      return {
        ...base,
        risk: 'low',
        reason: 'This alias uses a pp static token, but pac still cannot consume pp config directly.',
      };
  }
}

function derivePacOrganizationUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('.api.')) {
      parsed.hostname = parsed.hostname.replace('.api.', '.');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function buildEnvironmentInspectMetadata(
  environment: EnvironmentAlias,
  profile: AuthProfile | undefined,
  projectUsage:
    | {
        projectRoot: string;
        selectedStage?: string;
        stages: string[];
        activeForSelectedStage: boolean;
      }
    | undefined
): Pick<OperationResult<unknown>, 'diagnostics' | 'warnings' | 'supportTier' | 'suggestedNextActions' | 'provenance' | 'knownLimitations'> {
  const profileResourceWarning = buildEnvironmentProfileResourceMismatchWarning(environment, profile);

  return {
    diagnostics: [],
    warnings: profileResourceWarning ? [profileResourceWarning] : [],
    supportTier: 'preview',
    suggestedNextActions: dedupeStringArray(
      [
        profile
          ? `Run \`pp auth profile inspect ${profile.name} --format json\` to confirm the auth profile bound to environment alias ${environment.alias}.`
          : `Repair the missing auth profile binding for environment alias ${environment.alias} before using remote Dataverse commands.`,
        `Run \`pp dv whoami --environment ${environment.alias} --format json\` to confirm live Dataverse access for this alias.`,
        profileResourceWarning
          ? `Update environment alias ${environment.alias} or auth profile ${profile?.name} so both point at the same Dataverse URL before relying on stored environment provenance.`
          : undefined,
        projectUsage
          ? `Run \`pp project inspect ${projectUsage.projectRoot} --format json\` to review where the current project maps environment alias ${environment.alias}.`
          : undefined,
      ].filter((value): value is string => Boolean(value))
    ),
    provenance: [
      {
        kind: 'official-api',
        source: '@pp/config environments',
      },
      {
        kind: 'inferred',
        source: '@pp/cli env inspect guidance',
        detail: 'Browser and pac guidance is inferred from the bound auth profile, local browser bootstrap metadata, and project relationship context.',
      },
    ],
    knownLimitations: [
      'Environment inspect summarizes local pp config and cached browser bootstrap state; it does not prove live Dataverse access on its own.',
    ],
  };
}

function buildEnvironmentProfileResourceMismatchWarning(
  environment: EnvironmentAlias,
  profile: AuthProfile | undefined
): Diagnostic | undefined {
  if (!profile?.defaultResource) {
    return undefined;
  }

  const environmentUrl = normalizeComparableUrl(environment.url);
  const profileResourceUrl = normalizeComparableUrl(profile.defaultResource);

  if (!environmentUrl || !profileResourceUrl || environmentUrl === profileResourceUrl) {
    return undefined;
  }

  return createDiagnostic(
    'warning',
    'ENV_AUTH_PROFILE_RESOURCE_MISMATCH',
    `Environment alias ${environment.alias} points at ${environment.url}, but bound auth profile ${profile.name} defaults to ${profile.defaultResource}.`,
    {
      source: '@pp/cli env inspect guidance',
      hint: 'Align the alias URL and auth profile defaultResource before assuming checked-in config still targets the intended Dataverse org.',
    }
  );
}

function normalizeComparableUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function buildEnvironmentBrowserGuidance(
  profile: AuthProfile | undefined,
  browserProfile: BrowserProfile | undefined,
  environment: EnvironmentAlias
): Record<string, unknown> {
  if (!profile || profile.type !== 'user' || !profile.browserProfile) {
    return {
      status: 'not-configured',
      recommendedAction: 'No persisted browser profile is bound through the environment auth profile.',
    };
  }

  if (!browserProfile) {
    return {
      status: 'missing',
      name: profile.browserProfile,
      recommendedAction:
        'Add or restore the named browser profile before relying on Maker handoff or browser-backed evidence from this environment alias.',
    };
  }

  const summary = summarizeBrowserProfile(browserProfile);
  const bootstrapUrl = deriveEnvironmentBrowserBootstrapUrl(environment, browserProfile);
  const command = `pp auth browser-profile bootstrap ${browserProfile.name} --url '${bootstrapUrl}'`;
  const targetsMakerEnvironment =
    environment.makerEnvironmentId !== undefined
      ? browserProfileTargetsMakerEnvironment(browserProfile.lastBootstrapUrl, environment.makerEnvironmentId)
      : undefined;

  if (environment.makerEnvironmentId && targetsMakerEnvironment === false) {
    return {
      ...summary,
      status: 'needs-targeted-bootstrap',
      targetsMakerEnvironment,
      targetMakerEnvironmentId: environment.makerEnvironmentId,
      bootstrapCommand: command,
      recommendedBootstrapUrl: bootstrapUrl,
      recommendedAction: `Bootstrap the browser profile against Maker environment ${environment.makerEnvironmentId} before runtime validation or Maker fallback steps for ${environment.alias}.`,
    };
  }

  return {
    status: browserProfile.lastBootstrappedAt ? 'bootstrapped' : 'needs-bootstrap',
    ...summary,
    ...(targetsMakerEnvironment !== undefined
      ? {
          targetsMakerEnvironment,
          targetMakerEnvironmentId: environment.makerEnvironmentId,
          recommendedBootstrapUrl: bootstrapUrl,
        }
      : {}),
    recommendedAction: browserProfile.lastBootstrappedAt
      ? `Refresh the browser profile before Maker-critical steps if the stored session is stale or sign-in prompts reappear for ${environment.alias}.`
      : `Bootstrap the browser profile once before Maker-critical steps for ${environment.alias}.`,
    bootstrapCommand: command,
  };
}

function deriveEnvironmentBrowserBootstrapUrl(environment: EnvironmentAlias, browserProfile: BrowserProfile): string {
  if (environment.makerEnvironmentId) {
    return `https://make.powerapps.com/e/${encodeURIComponent(environment.makerEnvironmentId)}/`;
  }

  return browserProfile.lastBootstrapUrl ?? 'https://make.powerapps.com/';
}

function browserProfileTargetsMakerEnvironment(url: string | undefined, makerEnvironmentId: string): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return path.includes(`/e/${makerEnvironmentId}`) || path.includes(`/environments/${makerEnvironmentId}`);
  } catch {
    return false;
  }
}

async function runEnvironmentCleanupLike(
  configOptions: ConfigStoreOptions,
  args: string[],
  behavior: {
    actionName: 'env.cleanup' | 'env.reset';
    suggestedPlanCommand: 'pp env cleanup' | 'pp env reset';
    deps: EnvironmentCommandDependencies;
  }
): Promise<number> {
  const alias = behavior.deps.positionalArgs(args)[0];
  const prefix = behavior.deps.readFlag(args, '--prefix');

  if (!alias) {
    return behavior.deps.printFailure(behavior.deps.argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  if (!prefix) {
    return behavior.deps.printFailure(behavior.deps.argumentFailure('ENV_CLEANUP_PREFIX_REQUIRED', '--prefix is required.'));
  }

  const plan = await buildEnvironmentCleanupPlan(configOptions, alias, prefix);

  if (!plan.success || !plan.data) {
    return behavior.deps.printFailure(plan);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    behavior.actionName,
    {
      environment: plan.data.environment,
      prefix,
      candidateCount: plan.data.candidateCount,
    },
    {
      cleanupCandidates: plan.data.cleanupCandidates,
    },
    behavior.deps
  );

  if (preview !== undefined) {
    return preview;
  }

  const resolution = await resolveDataverseClient(alias, configOptions);

  if (!resolution.success || !resolution.data) {
    return behavior.deps.printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const deleted: Array<{ removed: boolean; solution: { solutionid: string; uniquename: string; friendlyname?: string; version?: string } }> = [];
  const failures: Array<{ solution: { solutionid: string; uniquename: string; friendlyname?: string; version?: string }; diagnostics: Diagnostic[] }> = [];
  const warnings: Diagnostic[] = [];

  for (const candidate of plan.data.cleanupCandidates) {
    const result = await service.delete(candidate.uniquename);

    warnings.push(...result.warnings);

    if (!result.success || !result.data) {
      failures.push({
        solution: candidate,
        diagnostics: result.diagnostics,
      });
      continue;
    }

    deleted.push(result.data);
  }

  const summary = {
    environment: plan.data.environment,
    prefix,
    candidateCount: plan.data.candidateCount,
    deletedCount: deleted.length,
    failedCount: failures.length,
    deleted,
    failures: failures.map((failure) => ({
      solution: failure.solution,
      diagnostics: failure.diagnostics,
    })),
  };

  if (failures.length > 0) {
    return behavior.deps.printFailure(
      fail(failures.flatMap((failure) => failure.diagnostics), {
        details: summary,
        warnings,
        supportTier: 'preview',
        suggestedNextActions: [
          'Inspect the failing solution diagnostics to see whether dependencies or managed-state restrictions blocked deletion.',
          `Re-run \`pp env cleanup-plan ${alias} --prefix ${prefix}\` to confirm which disposable assets remain after \`${behavior.suggestedPlanCommand} ${alias} --prefix ${prefix}\`.`,
        ],
      })
    );
  }

  behavior.deps.printWarnings(
    ok(summary, {
      supportTier: 'preview',
      warnings,
    })
  );
  behavior.deps.printByFormat(summary, behavior.deps.outputFormat(args, 'json'));
  return 0;
}

async function buildEnvironmentCleanupPlan(
  configOptions: ConfigStoreOptions,
  alias: string,
  prefix: string
): Promise<
  OperationResult<{
    environment: {
      alias: string;
      url: string;
      authProfile: string;
      defaultSolution?: string;
      makerEnvironmentId?: string;
    };
    prefix: string;
    matchStrategy: {
      kind: string;
      fields: string[];
    };
    remoteResetSupported: boolean;
    cleanupCandidates: Array<{ solutionid: string; uniquename: string; friendlyname?: string; version?: string }>;
    candidateCount: number;
    suggestedNextActions: string[];
    knownLimitations: string[];
  }>
> {
  const resolution = await resolveDataverseClient(alias, configOptions);

  if (!resolution.success || !resolution.data) {
    return resolution as OperationResult<never>;
  }

  const solutions = await new SolutionService(resolution.data.client).list();

  if (!solutions.success) {
    return solutions as OperationResult<never>;
  }

  const normalizedPrefix = prefix.toLowerCase();
  const cleanupCandidates = (solutions.data ?? []).filter((solution) => {
    const uniqueName = solution.uniquename?.toLowerCase() ?? '';
    const friendlyName = solution.friendlyname?.toLowerCase() ?? '';
    return uniqueName.startsWith(normalizedPrefix) || friendlyName.startsWith(normalizedPrefix);
  });

  return ok(
    {
      environment: {
        alias: resolution.data.environment.alias,
        url: resolution.data.environment.url,
        authProfile: resolution.data.authProfile.name,
        defaultSolution: resolution.data.environment.defaultSolution,
        makerEnvironmentId: resolution.data.environment.makerEnvironmentId,
      },
      prefix,
      matchStrategy: {
        kind: 'case-insensitive-prefix',
        fields: ['uniquename', 'friendlyname'],
      },
      remoteResetSupported: true,
      cleanupCandidates,
      candidateCount: cleanupCandidates.length,
      suggestedNextActions:
        cleanupCandidates.length > 0
          ? [
              'Review the matching solutions before deleting anything remotely.',
              `Run \`pp env cleanup ${alias} --prefix ${prefix}\` to delete the listed disposable solutions through pp.`,
              `Re-run \`pp env cleanup-plan ${alias} --prefix ${prefix}\` to confirm the environment is clean before bootstrap.`,
            ]
          : [
              'No matching solutions were found for this prefix.',
              'Proceed with bootstrap using the same prefix or generate a new run-scoped prefix if you still want quarantine semantics.',
            ],
      knownLimitations: [],
    },
    {
      supportTier: 'preview',
      diagnostics: solutions.diagnostics,
      warnings: solutions.warnings,
    }
  );
}

function maybeHandleMutationPreview(
  args: string[],
  fallbackFormat: OutputFormat,
  action: string,
  target: Record<string, unknown>,
  input: unknown,
  deps: Pick<EnvironmentCommandDependencies, 'printFailure' | 'printByFormat' | 'outputFormat'>
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

function dedupeStringArray(values: string[]): string[] {
  return [...new Set(values)];
}
