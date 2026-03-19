import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve as resolvePath } from 'node:path';
import { readJsonFile, writeJsonFile } from '@pp/artifacts';
import { AuthService, resolveBrowserProfileDirectory, type AuthProfile } from '@pp/auth';
import { CanvasService, deriveCanvasStudioEditUrl, type CanvasBuildMode, type CanvasLocalProgressEvent, type CanvasTemplateProvenance } from '@pp/canvas';
import { loadProjectConfig, type ConfigStoreOptions } from '@pp/config';
import { CanvasAppService, DataverseClient, resolveDataverseClient } from '@pp/dataverse';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { SolutionService } from '@pp/solution';
import { launchPersistentBrowserProfileContext } from './browser-profile-playwright';
import { runDelegatedCanvasCreate } from './canvas-create-delegate';
import { createMutationPreview, createSuccessPayload, readMutationFlags } from './contract';
import { dispatchCommandRoute } from './command-dispatch';
import * as cliHelp from './help';
import { resolveCanvasMakerEnvironmentId, readEnvironmentAlias, readEnvironmentDefaultSolution, resolveDataverseClientForCli } from './cli-resolution';
import {
  argumentFailure,
  hasFlag,
  isMachineReadableOutputFormat,
  printFailureWithMachinePayload,
  pathExists,
  positionalArgs,
  printByFormat,
  printFailure,
  printResultDiagnostics,
  printWarnings,
  readConfigOptions,
  readFlag,
  readJsonFileForCli,
  readNumberFlag,
  readRepeatedFlags,
  resolveOptionalInvocationPath,
  outputFormat,
  maybeHandleMutationPreview,
} from './cli-support';

interface CanvasCliContext {
  path: string;
  options: {
    root: string;
    registries: string[];
    cacheDir?: string;
    mode: CanvasBuildMode;
  };
}
export async function runCanvasUnsupportedRemoteMutation(command: 'create' | 'import', args: string[]): Promise<number> {
  const envAlias = readEnvironmentAlias(args);
  const configOptions = readConfigOptions(args);
  const explicitSolutionUniqueName = readFlag(args, '--solution');
  const explicitMakerEnvironmentId = readFlag(args, '--maker-env-id');
  const explicitDisplayName = readFlag(args, '--name');
  const explicitBrowserProfileName = readFlag(args, '--browser-profile');
  const openMakerHandoff = hasFlag(args, '--open');
  const delegateCanvasCreate = hasFlag(args, '--delegate');
  const delegatedArtifactsDir = readFlag(args, '--artifacts-dir');
  const delegatedTimeoutMs = readNumberFlag(args, '--timeout-ms');
  const delegatedPollTimeoutMs = readNumberFlag(args, '--poll-timeout-ms');
  const delegatedSettleMs = readNumberFlag(args, '--settle-ms');
  const delegatedSlowMoMs = readNumberFlag(args, '--slow-mo-ms');
  const delegatedDebug = hasFlag(args, '--debug');
  const displayName = command === 'create' ? explicitDisplayName : undefined;
  const importPath = command === 'import' ? positionalArgs(args)[0] : undefined;
  const inferredImportDisplayName =
    command === 'import' && importPath && !explicitDisplayName ? inferCanvasImportDisplayName(importPath) : undefined;
  const defaultSolutionUniqueName =
    !explicitSolutionUniqueName && envAlias ? await readEnvironmentDefaultSolution(envAlias, configOptions) : undefined;
  const solutionUniqueName = explicitSolutionUniqueName ?? defaultSolutionUniqueName;
  const knownLimitations = [
    'Remote canvas coverage in pp is currently read-only.',
    'pp does not yet return a remote canvas app id for create/import workflows.',
  ];

  if (!envAlias) {
    return printFailure(argumentFailure('DV_ENV_REQUIRED', '--environment <alias> is required.'));
  }

  if (command === 'import' && !importPath) {
    return printFailure(
      argumentFailure('CANVAS_IMPORT_PATH_REQUIRED', 'Usage: canvas import <file.msapp> --environment <alias> [--solution UNIQUE_NAME]')
    );
  }

  if (command !== 'create' && delegateCanvasCreate) {
    return printFailure(argumentFailure('CANVAS_IMPORT_DELEGATE_UNSUPPORTED', '--delegate is currently only supported for canvas create.'));
  }

  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return printFailure(mutation);
  }

  const resolution = await resolveDataverseClient(envAlias, configOptions);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const resolvedMakerEnvironmentId = await resolveCanvasMakerEnvironmentId(
    explicitMakerEnvironmentId,
    resolution.data.environment,
    resolution.data.authProfile,
    configOptions,
    {
      persistDiscovered: mutation.data.mode === 'apply',
    }
  );

  let resolvedSolutionId: string | undefined;

  if (solutionUniqueName) {
    const solution = await new SolutionService(resolution.data.client).inspect(solutionUniqueName);

    if (!solution.success) {
      return printFailure(solution);
    }

    if (!solution.data) {
      const missingSolutionSuggestedNextActions = buildCanvasMissingSolutionSuggestions(envAlias, explicitSolutionUniqueName ?? solutionUniqueName);
      return printFailure(
        fail(
          [
            createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${solutionUniqueName} was not found.`, {
              source: '@pp/cli',
            }),
            createDiagnostic(
              'error',
              command === 'create' ? 'CANVAS_REMOTE_CREATE_NOT_IMPLEMENTED' : 'CANVAS_REMOTE_IMPORT_NOT_IMPLEMENTED',
              `Remote canvas ${command} is not implemented yet.`,
              {
                source: '@pp/cli',
                hint:
                  command === 'create'
                    ? 'Use --delegate --browser-profile NAME to drive the Maker blank-app flow inside pp, or finish blank-app creation in Maker until a first-class remote pp canvas create command exists.'
                    : 'Build or obtain an .msapp outside the remote workflow today, then use Maker or solution tooling until a first-class pp canvas import command exists.',
              }
            ),
          ],
          {
            ...buildCanvasRemoteMutationResultMetadata({
              envAlias,
              solutionUniqueName,
              makerEnvironmentId: resolvedMakerEnvironmentId,
              suggestedNextActions: missingSolutionSuggestedNextActions,
              knownLimitations,
            }),
          }
        )
      );
    }

    resolvedSolutionId = solution.data.solutionid;
  }

  const suggestedNextActions = buildCanvasRemoteMutationSuggestions(command, {
    envAlias,
    solutionUniqueName,
    solutionId: resolvedSolutionId,
    displayName: displayName ?? explicitDisplayName ?? inferredImportDisplayName,
    importPath,
    makerEnvironmentId: resolvedMakerEnvironmentId,
    derivedSolutionFromEnvironmentAlias: !explicitSolutionUniqueName && solutionUniqueName ? envAlias : undefined,
    browserProfileName: explicitBrowserProfileName ?? resolveBrowserProfileNameFromAuthProfile(resolution.data.authProfile),
  });
  const fallbackDetails = buildCanvasRemoteMutationFallbackDetails(command, {
    envAlias,
    solutionUniqueName,
    solutionId: resolvedSolutionId,
    displayName: displayName ?? explicitDisplayName ?? inferredImportDisplayName,
    importPath,
    makerEnvironmentId: resolvedMakerEnvironmentId,
    derivedSolutionFromEnvironmentAlias: !explicitSolutionUniqueName && solutionUniqueName ? envAlias : undefined,
  });
  const resultMetadata = buildCanvasRemoteMutationResultMetadata({
    envAlias,
    solutionUniqueName,
    makerEnvironmentId: resolvedMakerEnvironmentId,
    suggestedNextActions,
    knownLimitations,
  });

  if (mutation.data.mode !== 'apply') {
    printByFormat(
      createMutationPreview(
        `canvas.${command}.remote`,
        mutation.data,
        {
          envAlias,
          solutionUniqueName,
          solutionId: resolvedSolutionId,
          makerEnvironmentId: resolvedMakerEnvironmentId,
          supported: false,
        },
        {
          displayName: displayName ?? explicitDisplayName ?? inferredImportDisplayName,
          importPath,
          delegated: delegateCanvasCreate
            ? {
                requested: true,
                artifactsDir:
                  delegatedArtifactsDir ??
                  (displayName
                    ? resolvePath('.tmp', 'canvas-create', slugifyCanvasDelegatedArtifacts(displayName))
                    : undefined),
              }
            : undefined,
          fallback: fallbackDetails,
          suggestedNextActions,
          knownLimitations,
        },
        resultMetadata
      ),
      outputFormat(args, 'json')
    );
    return 0;
  }

  if (delegateCanvasCreate) {
    if (!solutionUniqueName || !resolvedSolutionId) {
      return printFailure(
        argumentFailure('CANVAS_CREATE_DELEGATE_SOLUTION_REQUIRED', '--delegate currently requires --solution UNIQUE_NAME (or an environment defaultSolution).')
      );
    }

    if (!displayName) {
      return printFailure(argumentFailure('CANVAS_CREATE_NAME_REQUIRED', '--name DISPLAY_NAME is required with --delegate.'));
    }

    const browserProfileName =
      explicitBrowserProfileName ?? resolveBrowserProfileNameFromAuthProfile(resolution.data.authProfile);

    if (!browserProfileName) {
      return printFailure(
        argumentFailure(
          'AUTH_BROWSER_PROFILE_NAME_REQUIRED',
          'Use --browser-profile NAME with --delegate, or configure browserProfile on the environment auth profile, so pp can drive the Maker handoff in a persisted browser profile.'
        )
      );
    }

    if (!fallbackDetails.handoff.recommendedUrl || !resolvedMakerEnvironmentId) {
      return printFailure(
        fail(
          createDiagnostic(
            'error',
            'CANVAS_MAKER_HANDOFF_URL_UNAVAILABLE',
            'A Maker handoff URL is not available for delegated canvas create yet.',
            {
              source: '@pp/cli',
              hint:
                'Provide --maker-env-id or configure makerEnvironmentId on the environment alias so pp can build the exact solution-scoped Maker blank-app URL.',
            }
          ),
          {
            details: fallbackDetails,
            ...resultMetadata,
          }
        )
      );
    }

    if (
      [delegatedTimeoutMs, delegatedPollTimeoutMs, delegatedSettleMs, delegatedSlowMoMs].some(
        (value) => value !== undefined && !Number.isFinite(value)
      )
    ) {
      return printFailure(
        argumentFailure(
          'CANVAS_CREATE_DELEGATE_NUMBER_REQUIRED',
          '--timeout-ms, --poll-timeout-ms, --settle-ms, and --slow-mo-ms must be numeric when provided.'
        )
      );
    }

    const auth = new AuthService(configOptions);
    const browserProfile = await auth.getBrowserProfile(browserProfileName);

    if (!browserProfile.success || !browserProfile.data) {
      return printFailure(browserProfile);
    }

    const browserProfileDir = resolveBrowserProfileDirectory(browserProfile.data, configOptions);
    const delegated = await runDelegatedCanvasCreate({
      envAlias,
      solutionUniqueName,
      solutionId: resolvedSolutionId,
      appName: displayName,
      browserProfileName,
      browserProfile: browserProfile.data,
      browserProfileDir,
      client: resolution.data.client,
      targetUrl: fallbackDetails.handoff.recommendedUrl,
      makerEnvironmentId: resolvedMakerEnvironmentId,
      outDir: delegatedArtifactsDir ?? resolvePath('.tmp', 'canvas-create', slugifyCanvasDelegatedArtifacts(displayName)),
      headless: !delegatedDebug,
      slowMoMs: delegatedSlowMoMs ?? 0,
      timeoutMs: delegatedTimeoutMs ?? 180_000,
      pollTimeoutMs: delegatedPollTimeoutMs ?? 180_000,
      settleMs: delegatedSettleMs ?? 12_000,
    });

    if (!delegated.success || !delegated.data) {
      const delegatedFailure = normalizeDelegatedCanvasCreateFailure(delegated, {
        appName: displayName,
        envAlias,
        solutionUniqueName,
        browserProfileName,
        artifactsDir: delegatedArtifactsDir ?? resolvePath('.tmp', 'canvas-create', slugifyCanvasDelegatedArtifacts(displayName)),
      });

      return printFailure({
        ...delegatedFailure,
        details: {
          handoff: fallbackDetails,
          automation: delegatedFailure.details ?? delegatedFailure.data,
        },
        suggestedNextActions: [
          ...(delegatedFailure.suggestedNextActions ?? []),
          `Inspect ${formatCliArg(
            ((delegatedFailure.details as { artifacts?: { sessionPath?: string } } | undefined)?.artifacts?.sessionPath ??
              '<session-path>')
          )} and the paired screenshot before retrying.`,
          'Retry with `--debug` to keep the delegated browser session visible if Studio readiness is timing-sensitive.',
          ...suggestedNextActions,
        ],
        knownLimitations: [
          'Remote canvas creation still depends on delegated Maker browser automation.',
          'Studio readiness and publish timing can still vary by tenant and browser session.',
        ],
        provenance: [
          ...(resultMetadata.provenance ?? []),
          {
            kind: 'inferred',
            source: '@pp/cli delegated Maker browser automation',
            detail: `pp attempted the solution-scoped blank-app flow through persisted browser profile ${browserProfileName}.`,
          },
        ],
      });
    }

    printByFormat(
      {
        action: 'canvas.create.remote.delegated',
        delegated: true,
        input: {
          displayName,
        },
        target: {
          envAlias,
          solutionUniqueName,
          solutionId: resolvedSolutionId,
          makerEnvironmentId: resolvedMakerEnvironmentId,
          supported: false,
        },
        handoff: fallbackDetails,
        automation: delegated.data,
        createdApp: delegated.data.createdApp,
        supportTier: 'preview',
        suggestedNextActions: [
          `Run \`${fallbackDetails.verification.inspectCommand}\` to confirm the delegated flow returned the same remote app id through pp.`,
          `Run \`${fallbackDetails.verification.listCommand}\` to confirm the new app remains visible in Dataverse.`,
          `Run \`${fallbackDetails.verification.solutionComponentsCommand}\` to confirm the app remains attached to the solution.`,
        ].filter((value): value is string => Boolean(value)),
        knownLimitations: [
          'Remote canvas creation still depends on delegated Maker browser automation.',
          'Studio readiness and publish timing can still vary by tenant and browser session.',
        ],
        provenance: [
          ...(resultMetadata.provenance ?? []),
          {
            kind: 'inferred',
            source: '@pp/cli delegated Maker browser automation',
            detail: `pp drove the solution-scoped blank-app flow through persisted browser profile ${browserProfileName} and waited for the Dataverse canvas app row.`,
          },
        ],
      },
      outputFormat(args, 'json')
    );
    return 0;
  }

  if (openMakerHandoff) {
    const browserProfileName =
      explicitBrowserProfileName ?? resolveBrowserProfileNameFromAuthProfile(resolution.data.authProfile);

    if (!browserProfileName) {
      return printFailure(
        argumentFailure(
          'AUTH_BROWSER_PROFILE_NAME_REQUIRED',
          'Use --browser-profile NAME with --open, or configure browserProfile on the environment auth profile, so pp can launch the Maker handoff in a persisted browser profile.'
        )
      );
    }

    if (!fallbackDetails.handoff.recommendedUrl) {
      return printFailure(
        fail(
          createDiagnostic(
            'error',
            'CANVAS_MAKER_HANDOFF_URL_UNAVAILABLE',
            'A Maker handoff URL is not available for this canvas workflow yet.',
            {
              source: '@pp/cli',
              hint:
                'Provide --maker-env-id or configure makerEnvironmentId on the environment alias so pp can build an exact Maker handoff URL.',
            }
          ),
          {
            details: fallbackDetails,
            ...resultMetadata,
          }
        )
      );
    }

    const auth = new AuthService(configOptions);
    const launched = await auth.launchBrowserProfile(browserProfileName, fallbackDetails.handoff.recommendedUrl);

    if (!launched.success || !launched.data) {
      return printFailure(launched);
    }

    printByFormat(
      {
        action: `canvas.${command}.remote.handoff`,
        delegated: true,
        launched: true,
        browserProfile: browserProfileName,
        target: {
          envAlias,
          solutionUniqueName,
          solutionId: resolvedSolutionId,
          makerEnvironmentId: resolvedMakerEnvironmentId,
          supported: false,
        },
        input: {
          displayName: displayName ?? explicitDisplayName ?? inferredImportDisplayName,
          importPath,
        },
        handoff: fallbackDetails,
        launch: launched.data,
        ...resultMetadata,
      },
      outputFormat(args, 'json')
    );
    return 0;
  }

  return printFailure(
    fail(
      createDiagnostic(
        'error',
        command === 'create' ? 'CANVAS_REMOTE_CREATE_NOT_IMPLEMENTED' : 'CANVAS_REMOTE_IMPORT_NOT_IMPLEMENTED',
        `Remote canvas ${command} is not implemented yet.`,
        {
          source: '@pp/cli',
          hint:
            command === 'create'
              ? 'Use --delegate --browser-profile NAME to drive the Maker blank-app flow inside pp, or finish blank-app creation in Maker until a first-class remote pp canvas create command exists.'
              : 'Build or obtain an .msapp outside the remote workflow today, then use Maker or solution tooling until a first-class pp canvas import command exists.',
        }
      ),
      {
        details: fallbackDetails,
        ...resultMetadata,
      }
    )
  );
}

function normalizeDelegatedCanvasCreateFailure(
  result: OperationResult<unknown>,
  context: {
    appName: string;
    envAlias: string;
    solutionUniqueName: string;
    browserProfileName: string;
    artifactsDir: string;
  }
): OperationResult<unknown> {
  const diagnostics =
    result.diagnostics.length > 0
      ? result.diagnostics
      : [
          createDiagnostic(
            'error',
            'CANVAS_CREATE_DELEGATE_EMPTY_FAILURE',
            `Delegated canvas create for ${context.appName} failed without diagnostics.`,
            {
              source: '@pp/cli',
              hint: `Inspect artifacts under ${context.artifactsDir} and retry with --debug if the Maker session did not finish loading.`,
            }
          ),
        ];

  const details =
    result.details && typeof result.details === 'object'
      ? result.details
      : {
          appName: context.appName,
          envAlias: context.envAlias,
          solutionUniqueName: context.solutionUniqueName,
          browserProfile: context.browserProfileName,
          artifacts: {
            artifactsDir: context.artifactsDir,
            screenshotPath: resolvePath(context.artifactsDir, `${slugifyCanvasDelegatedArtifacts(context.appName)}.png`),
            sessionPath: resolvePath(context.artifactsDir, `${slugifyCanvasDelegatedArtifacts(context.appName)}.session.json`),
          },
        };

  return {
    ...result,
    diagnostics,
    details,
  };
}

function buildCanvasRemoteMutationResultMetadata(context: {
  envAlias: string;
  solutionUniqueName?: string;
  makerEnvironmentId?: string;
  suggestedNextActions: string[];
  knownLimitations: string[];
}): {
  supportTier: 'preview';
  suggestedNextActions: string[];
  provenance: Array<{ kind: 'official-api' | 'inferred'; source: string; detail: string }>;
  knownLimitations: string[];
} {
  const provenance: Array<{ kind: 'official-api' | 'inferred'; source: string; detail: string }> = [
    {
      kind: 'official-api',
      source: '@pp/cli canvas remote mutation resolution',
      detail: `Environment alias ${context.envAlias} was resolved through configured Dataverse metadata${context.solutionUniqueName ? ` and solution ${context.solutionUniqueName}` : ''}.`,
    },
    {
      kind: 'inferred',
      source: '@pp/cli canvas Maker fallback guidance',
      detail: `Maker handoff URLs and verification commands were synthesized from the resolved environment${context.makerEnvironmentId ? ` (${context.makerEnvironmentId})` : ''} and command inputs.`,
    },
  ];

  return {
    supportTier: 'preview',
    suggestedNextActions: context.suggestedNextActions,
    provenance,
    knownLimitations: context.knownLimitations,
  };
}

function buildCanvasRemoteMutationSuggestions(
  command: 'create' | 'import',
  context: {
    envAlias?: string;
    solutionUniqueName?: string;
    solutionId?: string;
    displayName?: string;
    importPath?: string;
    makerEnvironmentId?: string;
    derivedSolutionFromEnvironmentAlias?: string;
    browserProfileName?: string;
  }
): string[] {
  const envAlias = context.envAlias ? formatCliArg(context.envAlias) : '<alias>';
  const solutionSuffix = context.solutionUniqueName ? ` --solution ${formatCliArg(context.solutionUniqueName)}` : '';
  const envSuffix = ` --environment ${envAlias}`;
  const browserProfile = context.browserProfileName ? formatCliArg(context.browserProfileName) : '<browser-profile>';
  const listCommand = `pp canvas list${envSuffix}${solutionSuffix}`;
  const solutionComponentsCommand = context.solutionUniqueName
    ? `pp solution components ${formatCliArg(context.solutionUniqueName)}${envSuffix} --format json`
    : undefined;
  const resolvedSolutionSuggestion = context.derivedSolutionFromEnvironmentAlias && context.solutionUniqueName
    ? `Using default solution ${formatCliArg(context.solutionUniqueName)} from environment alias ${envAlias}, keep the Maker step and verification scoped to that solution.`
    : undefined;
  const fallback = buildCanvasRemoteMutationFallbackDetails(command, context);

  if (command === 'create') {
    const suggestions = ['Use Maker blank-app creation for now when you need a new remote canvas app.'];

    if (context.displayName) {
      suggestions.unshift(
        `Use \`pp canvas create${envSuffix}${solutionSuffix} --name ${formatCliArg(context.displayName)} --delegate --browser-profile ${browserProfile}\` to let pp drive the Maker blank-app flow and wait for the created app id.`
      );
    }

    if (resolvedSolutionSuggestion) {
      suggestions.push(resolvedSolutionSuggestion);
    }

    if (fallback.handoff.recommendedUrl && fallback.handoff.kind === 'maker-blank-app') {
      suggestions.push(`Open ${fallback.handoff.recommendedUrl} to start the solution-scoped blank canvas app flow in Maker.`);
    } else if (fallback.handoff.recommendedUrl && fallback.handoff.kind === 'maker-solution-apps') {
      suggestions.push(`Open ${fallback.handoff.recommendedUrl} to continue from the solution-scoped apps view in Maker.`);
    } else if (fallback.handoff.recommendedUrl && fallback.handoff.kind === 'maker-solutions') {
      suggestions.push(`Open ${fallback.handoff.recommendedUrl} to continue from the environment's Solutions view in Maker.`);
    }

    if (fallback.verification.inspectCommand) {
      suggestions.push(`After saving in Maker, run \`${fallback.verification.inspectCommand}\` to confirm the remote app id.`);
    }

    suggestions.push(`After the Maker step, run \`${fallback.verification.listCommand ?? listCommand}\` to confirm the new app is visible in Dataverse.`);

    if (fallback.verification.solutionComponentsCommand ?? solutionComponentsCommand) {
      suggestions.push(
        `Run \`${fallback.verification.solutionComponentsCommand ?? solutionComponentsCommand}\` to verify that the app was added to the solution.`
      );
    }

    return suggestions;
  }

  const suggestions = [];

  if (context.importPath) {
    suggestions.push(`Use Maker or solution tooling to import \`${context.importPath}\` until \`pp canvas import\` exists.`);
  } else {
    suggestions.push('Use Maker or solution tooling for the remote import step until `pp canvas import` exists.');
  }

  if (resolvedSolutionSuggestion) {
    suggestions.push(resolvedSolutionSuggestion);
  }

  if (fallback.handoff.recommendedUrl && fallback.handoff.kind === 'maker-solution-apps') {
    suggestions.push(`Open ${fallback.handoff.recommendedUrl} to continue the import from the solution-scoped apps view in Maker.`);
  } else if (fallback.handoff.recommendedUrl && fallback.handoff.kind === 'maker-solutions') {
    suggestions.push(`Open ${fallback.handoff.recommendedUrl} to continue the import from the environment's Solutions view in Maker.`);
  }

  if (fallback.verification.inspectCommand) {
    suggestions.push(`After the import step, run \`${fallback.verification.inspectCommand}\` to confirm the remote app id.`);
  }

  suggestions.push(`After the import step, run \`${fallback.verification.listCommand ?? listCommand}\` to confirm the app is visible in Dataverse.`);

  if (fallback.verification.solutionComponentsCommand ?? solutionComponentsCommand) {
    suggestions.push(
      `Run \`${fallback.verification.solutionComponentsCommand ?? solutionComponentsCommand}\` to verify that the imported app was added to the solution.`
    );
  }

  suggestions.push('Use `pp canvas build <path> --out <file.msapp>` to package a local canvas source tree.');
  return suggestions;
}

function buildCanvasRemoteMutationFallbackDetails(
  command: 'create' | 'import',
  context: {
    envAlias?: string;
    solutionUniqueName?: string;
    solutionId?: string;
    displayName?: string;
    importPath?: string;
    makerEnvironmentId?: string;
    derivedSolutionFromEnvironmentAlias?: string;
  }
): {
  handoff: {
    kind: 'maker-blank-app' | 'maker-solution-apps' | 'maker-solutions' | 'manual';
    recommendedUrl?: string;
    makerUrls: {
      solutionsUrl?: string;
      solutionAppsUrl?: string;
      blankAppUrl?: string;
    };
    importPath?: string;
    displayName?: string;
    derivedSolutionFromEnvironmentAlias?: string;
  };
  verification: {
    inspectCommand?: string;
    listCommand?: string;
    solutionComponentsCommand?: string;
  };
} {
  const envAlias = context.envAlias ? formatCliArg(context.envAlias) : '<alias>';
  const solutionSuffix = context.solutionUniqueName ? ` --solution ${formatCliArg(context.solutionUniqueName)}` : '';
  const envSuffix = ` --environment ${envAlias}`;
  const makerUrls = buildMakerCanvasUrls(context);
  const inspectCommand = context.displayName
    ? `pp canvas inspect ${formatCliArg(context.displayName)}${envSuffix}${solutionSuffix}`
    : undefined;
  const listCommand = `pp canvas list${envSuffix}${solutionSuffix}`;
  const solutionComponentsCommand = context.solutionUniqueName
    ? `pp solution components ${formatCliArg(context.solutionUniqueName)}${envSuffix} --format json`
    : undefined;

  let kind: 'maker-blank-app' | 'maker-solution-apps' | 'maker-solutions' | 'manual' = 'manual';
  let recommendedUrl: string | undefined;

  if (command === 'create' && makerUrls.blankAppUrl) {
    kind = 'maker-blank-app';
    recommendedUrl = makerUrls.blankAppUrl;
  } else if (makerUrls.solutionAppsUrl) {
    kind = 'maker-solution-apps';
    recommendedUrl = makerUrls.solutionAppsUrl;
  } else if (makerUrls.solutionsUrl) {
    kind = 'maker-solutions';
    recommendedUrl = makerUrls.solutionsUrl;
  }

  return {
    handoff: {
      kind,
      recommendedUrl,
      makerUrls,
      importPath: context.importPath,
      displayName: context.displayName,
      derivedSolutionFromEnvironmentAlias: context.derivedSolutionFromEnvironmentAlias,
    },
    verification: {
      inspectCommand,
      listCommand,
      solutionComponentsCommand,
    },
  };
}

function buildMakerCanvasUrls(context: {
  makerEnvironmentId?: string;
  solutionId?: string;
  solutionUniqueName?: string;
  displayName?: string;
}): {
  solutionsUrl?: string;
  solutionAppsUrl?: string;
  blankAppUrl?: string;
} {
  if (!context.makerEnvironmentId) {
    return {};
  }

  const solutionsUrl = `https://make.powerapps.com/environments/${encodeURIComponent(context.makerEnvironmentId)}/solutions`;

  if (!context.solutionId) {
    return {
      solutionsUrl,
    };
  }

  const solutionAppsUrl = `${solutionsUrl}/${encodeURIComponent(context.solutionId)}/apps`;

  if (!context.displayName) {
    return {
      solutionsUrl,
      solutionAppsUrl,
    };
  }

  const params = new URLSearchParams({
    action: 'new-blank',
    'form-factor': 'tablet',
    name: context.displayName,
    'solution-id': context.solutionId,
  });

  return {
    solutionsUrl,
    solutionAppsUrl,
    blankAppUrl: `https://make.powerapps.com/e/${encodeURIComponent(context.makerEnvironmentId)}/canvas/?${params.toString()}`,
  };
}

function buildCanvasMissingSolutionSuggestions(envAlias: string, solutionUniqueName: string): string[] {
  const formattedEnvAlias = formatCliArg(envAlias);
  const formattedSolutionUniqueName = formatCliArg(solutionUniqueName);

  return [
    `Run \`pp solution list --environment ${formattedEnvAlias}\` to discover the available solution unique names in this environment.`,
    `Retry with a valid \`--solution\` value, or configure ${formattedEnvAlias} with \`defaultSolution\` if this workflow should stay solution-scoped by default.`,
    `Once you have the right solution, use \`pp solution inspect ${formattedSolutionUniqueName} --environment ${formattedEnvAlias}\` to confirm it resolves before retrying the canvas workflow.`,
  ];
}

function resolveBrowserProfileNameFromAuthProfile(profile: AuthProfile): string | undefined {
  if (profile.type === 'user') {
    return profile.browserProfile;
  }

  return undefined;
}

function formatCliArg(value: string): string {
  return /^[A-Za-z0-9._:/=-]+$/.test(value) ? value : JSON.stringify(value);
}

function inferCanvasImportDisplayName(importPath: string): string | undefined {
  const filename = basename(importPath);

  if (!filename) {
    return undefined;
  }

  const extension = extname(filename);
  const displayName = extension ? filename.slice(0, -extension.length) : filename;
  const normalized = displayName.trim();
  return normalized || undefined;
}

export async function runCanvasTemplates(args: string[]): Promise<number> {
  return dispatchCommandRoute(
    {
      help: cliHelp.printHelp,
      unknownExitCode: 1,
      children: [
        { name: 'import', run: (rest) => runCanvasTemplateImport(rest) },
        { name: 'inspect', run: (rest) => runCanvasTemplateInspect(rest) },
        { name: 'diff', run: (rest) => runCanvasTemplateDiff(rest) },
        { name: 'pin', run: (rest) => runCanvasTemplatePin(rest) },
        { name: 'refresh', run: (rest) => runCanvasTemplateRefresh(rest) },
        { name: 'audit', run: (rest) => runCanvasTemplateAudit(rest) },
      ],
    },
    args
  );
}

export async function runCanvasWorkspace(args: string[]): Promise<number> {
  return dispatchCommandRoute(
    {
      help: cliHelp.printHelp,
      unknownExitCode: 1,
      children: [{ name: 'inspect', run: (rest) => runCanvasWorkspaceInspect(rest) }],
    },
    args
  );
}

export async function runCanvasPatch(args: string[]): Promise<number> {
  return dispatchCommandRoute(
    {
      help: cliHelp.printHelp,
      unknownExitCode: 1,
      children: [
        { name: 'plan', run: (rest) => runCanvasPatchPlan(rest) },
        { name: 'apply', run: (rest) => runCanvasPatchApply(rest) },
      ],
    },
    args
  );
}

export async function runCanvasValidate(args: string[]): Promise<number> {
  const canvasPath = positionalArgs(args)[0];

  if (!canvasPath) {
    return printFailure(argumentFailure('CANVAS_PATH_REQUIRED', 'Usage: canvas validate <path|workspaceApp> [--workspace FILE] [--mode strict|seeded|registry]'));
  }

  const context = await resolveCanvasCliContext(args, canvasPath);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const result = await new CanvasService().validate(context.data.path, {
    ...context.data.options,
    onProgress: (event) => {
      process.stderr.write(renderCanvasLocalProgress('validate', event));
    },
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return result.data.valid ? 0 : 1;
}

export async function runCanvasLint(args: string[]): Promise<number> {
  const canvasPath = positionalArgs(args)[0];

  if (!canvasPath) {
    return printFailure(argumentFailure('CANVAS_PATH_REQUIRED', 'Usage: canvas lint <path|workspaceApp> [--workspace FILE] [--mode strict|seeded|registry]'));
  }

  const context = await resolveCanvasCliContext(args, canvasPath);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const result = await new CanvasService().lint(context.data.path, {
    ...context.data.options,
    onProgress: (event) => {
      process.stderr.write(renderCanvasLocalProgress('lint', event));
    },
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return result.data.valid ? 0 : 1;
}

export async function runCanvasInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure(
        'CANVAS_INSPECT_ARG_REQUIRED',
        'Usage: canvas inspect <path>|<workspaceApp>|<displayName|name|id> [--environment ALIAS] [--solution UNIQUE_NAME] [--workspace FILE] [--mode strict|seeded|registry]'
      )
    );
  }

  if (readEnvironmentAlias(args)) {
    const resolution = await resolveDataverseClientForCli(args);

    if (!resolution.success || !resolution.data) {
      return printFailure(resolution);
    }

    const expectations = readCanvasRemoteProofExpectations(args);

    if (!expectations.success) {
      return printFailure(expectations);
    }

    const solutionUniqueName = readFlag(args, '--solution');
    const service = new CanvasService(resolution.data.client);
    const result = await service.inspectRemote(identifier, {
      solutionUniqueName,
    });

    if (!result.success) {
      return printFailure(result);
    }

    if (!result.data) {
      return printFailure(fail(createDiagnostic('error', 'CANVAS_REMOTE_NOT_FOUND', `Canvas app ${identifier} was not found.`)));
    }

    const downloadPlan = await service.planRemoteDownload(identifier, {
      solutionUniqueName,
    });

    if (!downloadPlan.success) {
      return printFailure(downloadPlan);
    }

    const proofExpectations = expectations.data ?? [];
    const browserProfileName = resolveBrowserProfileNameFromAuthProfile(resolution.data.authProfile);

    if (proofExpectations.length > 0) {
      const proofSolutionUniqueName = downloadPlan.data?.resolution.resolvedSolutionUniqueName;

      if (!proofSolutionUniqueName) {
        return printFailure(
          argumentFailure(
            'SOLUTION_UNIQUE_NAME_REQUIRED',
            '--solution UNIQUE_NAME is required for proof mode unless pp can auto-resolve a single containing solution for the remote app.'
          )
        );
      }

      const proof = await service.proveRemote(identifier, {
        solutionUniqueName: proofSolutionUniqueName,
        expectations: proofExpectations,
      });

      if (!proof.success || !proof.data) {
        return printFailure(proof);
      }

      printByFormat(
        buildCanvasRemoteInspectPayload({
          app: result.data,
          envAlias: resolution.data.environment.alias,
          solutionUniqueName,
          downloadPlan: downloadPlan.data?.resolution,
          makerEnvironmentId: await resolveCanvasMakerEnvironmentId(
            undefined,
            resolution.data.environment,
            resolution.data.authProfile,
            readConfigOptions(args)
          ),
          browserProfileName,
          proof: proof.data,
        }),
        outputFormat(args, 'json')
      );
      printResultDiagnostics(proof, outputFormat(args, 'json'));
      return proof.data.valid ? 0 : 1;
    }

    printByFormat(
      buildCanvasRemoteInspectPayload({
        app: result.data,
        envAlias: resolution.data.environment.alias,
        solutionUniqueName,
        downloadPlan: downloadPlan.data?.resolution,
        makerEnvironmentId: await resolveCanvasMakerEnvironmentId(
          undefined,
          resolution.data.environment,
          resolution.data.authProfile,
          readConfigOptions(args)
        ),
        browserProfileName,
      }),
      outputFormat(args, 'json')
    );
    return 0;
  }

  const context = await resolveCanvasCliContext(args, identifier);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const result = await new CanvasService().inspect(context.data.path, context.data.options);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new CanvasService(resolution.data.client).listRemote({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasProbe(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('CANVAS_IDENTIFIER_REQUIRED', 'Usage: canvas probe <displayName|name|id> --environment ALIAS [--solution UNIQUE_NAME]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const solutionUniqueName = readFlag(args, '--solution');
  const service = new CanvasService(resolution.data.client);
  const result = await service.inspectRemote(identifier, {
    solutionUniqueName,
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'CANVAS_REMOTE_NOT_FOUND', `Canvas app ${identifier} was not found.`)));
  }

  if (!result.data.openUri) {
    return printFailure(
      fail(
        createDiagnostic('error', 'CANVAS_RUNTIME_URL_MISSING', `Canvas app ${identifier} does not expose an app play URL to probe.`, {
          source: '@pp/cli',
        })
      )
    );
  }

  const configOptions = readConfigOptions(args);
  const browserProfileName = readFlag(args, '--browser-profile') ?? resolveBrowserProfileNameFromAuthProfile(resolution.data.authProfile);

  if (!browserProfileName) {
    return printFailure(
      fail(
        createDiagnostic('error', 'AUTH_BROWSER_PROFILE_REQUIRED', 'Canvas runtime probing requires a persisted browser profile.', {
          source: '@pp/cli',
          hint:
            'Pass `--browser-profile <name>`, or configure the environment auth profile with `browserProfile`, then rerun `pp canvas probe`.',
        })
      )
    );
  }

  const auth = new AuthService(configOptions);
  const browserProfile = await auth.getBrowserProfile(browserProfileName);

  if (!browserProfile.success) {
    return printFailure(browserProfile);
  }

  if (!browserProfile.data) {
    return printFailure(
      fail(createDiagnostic('error', 'AUTH_BROWSER_PROFILE_NOT_FOUND', `Browser profile ${browserProfileName} was not found.`))
    );
  }

  const timeoutMs = readNumberFlag(args, '--timeout-ms');
  const settleMs = readNumberFlag(args, '--settle-ms');
  const slowMoMs = readNumberFlag(args, '--slow-mo-ms');

  if ([timeoutMs, settleMs, slowMoMs].some((value) => value !== undefined && !Number.isFinite(value))) {
    return printFailure(
      argumentFailure('CANVAS_PROBE_INVALID_NUMERIC_FLAG', '--timeout-ms, --settle-ms, and --slow-mo-ms must be numeric when provided.')
    );
  }

  const effectiveTimeoutMs = timeoutMs !== undefined ? timeoutMs : 45_000;
  const effectiveSettleMs = settleMs !== undefined ? settleMs : 5_000;
  const effectiveSlowMoMs = slowMoMs !== undefined ? slowMoMs : 0;
  const artifactsDir = resolveOptionalInvocationPath(readFlag(args, '--artifacts-dir')) ?? (await mkdtemp(join(tmpdir(), 'pp-canvas-probe-')));
  await access(artifactsDir).catch(async () => mkdir(artifactsDir, { recursive: true }));

  const downloadPlan = await service.planRemoteDownload(identifier, {
    solutionUniqueName,
  });

  if (!downloadPlan.success) {
    return printFailure(downloadPlan);
  }

  const makerEnvironmentId = await resolveCanvasMakerEnvironmentId(
    undefined,
    resolution.data.environment,
    resolution.data.authProfile,
    configOptions
  );
  const portalProvenance = buildCanvasPortalProvenance({
    appId: result.data.id,
    appOpenUri: result.data.openUri,
    makerEnvironmentId,
  });
  const runtimeHandoff = buildCanvasRuntimeHandoff({
    appId: result.data.id,
    displayName: result.data.displayName ?? result.data.name ?? result.data.id,
    appOpenUri: result.data.openUri,
    makerStudioUrl: portalProvenance?.makerStudioUrl,
    browserProfileName,
    envAlias: resolution.data.environment.alias,
    solutionUniqueName,
  });

  let launched;
  try {
    launched = await launchPersistentBrowserProfileContext(
      resolveBrowserProfileDirectory(browserProfile.data, configOptions),
      browserProfile.data,
      {
        browserProfileName,
        outDir: artifactsDir,
        headless: hasFlag(args, '--headless'),
        slowMoMs: effectiveSlowMoMs,
      }
    );
  } catch (error) {
    return printFailure(
      fail(
        createDiagnostic('error', 'CANVAS_RUNTIME_PROBE_LAUNCH_FAILED', `Failed to launch browser profile ${browserProfileName}.`, {
          source: '@pp/cli',
          detail: error instanceof Error ? error.message : String(error),
        })
      )
    );
  }

  const context = launched.context;
  const page = context.pages()[0] ?? (await context.newPage());
  let navigationError: string | undefined;

  try {
    await page.goto(result.data.openUri, { waitUntil: 'domcontentloaded', timeout: effectiveTimeoutMs });
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  await page.waitForTimeout(Math.max(effectiveSettleMs, 0)).catch(() => undefined);
  const probe = await captureCanvasRuntimeProbe(page, {
    requestedUrl: result.data.openUri,
    expectedHosts: runtimeHandoff.expectedHosts,
    outDir: artifactsDir,
    appDisplayName: result.data.displayName ?? result.data.name ?? result.data.id,
    browserLaunch: launched,
    navigationError,
  });
  await context.close().catch(() => undefined);

  printByFormat(
    {
      ...buildCanvasRemoteInspectPayload({
        app: result.data,
        envAlias: resolution.data.environment.alias,
        solutionUniqueName,
        downloadPlan: downloadPlan.data?.resolution,
        makerEnvironmentId,
        browserProfileName,
      }),
      runtimeProbe: probe,
    },
    outputFormat(args, 'json')
  );
  return 0;
}

export async function runCanvasAccess(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('CANVAS_IDENTIFIER_REQUIRED', 'Usage: canvas access <displayName|name|id> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new CanvasAppService(resolution.data.client).access(identifier);

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'CANVAS_NOT_FOUND', `Canvas app ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasAttach(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const solutionUniqueName = readFlag(args, '--solution');

  if (!identifier || !solutionUniqueName) {
    return printFailure(
      argumentFailure(
        'CANVAS_ATTACH_ARGS_REQUIRED',
        'Usage: canvas attach <displayName|name|id> --environment ALIAS --solution UNIQUE_NAME'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const addRequiredComponents = hasFlag(args, '--no-add-required-components') ? false : true;
  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return printFailure(mutation);
  }

  if (mutation.data.mode === 'dry-run') {
    printByFormat(
      createMutationPreview(
        'canvas.attach',
        mutation.data,
        {
          identifier,
          environment: resolution.data.environment.alias,
          solution: solutionUniqueName,
        },
        {
          addRequiredComponents,
        }
      ),
      outputFormat(args, 'json')
    );
    return 0;
  }

  const service = new CanvasService(resolution.data.client);

  if (mutation.data.mode === 'plan') {
    const result = await service.planRemoteAttach(identifier, {
      solutionUniqueName,
    });

    if (!result.success) {
      return printFailure(result);
    }

    if (!result.data) {
      return printFailure(fail(createDiagnostic('error', 'CANVAS_REMOTE_NOT_FOUND', `Canvas app ${identifier} was not found.`)));
    }

    printByFormat(
      createSuccessPayload(
        {
          action: 'canvas.attach',
          mode: 'plan',
          confirmed: false,
          willMutate: false,
          target: {
            identifier,
            environment: resolution.data.environment.alias,
            solution: solutionUniqueName,
          },
          input: {
            addRequiredComponents,
          },
          preview: result.data,
        },
        result
      ),
      outputFormat(args, 'json')
    );
    printResultDiagnostics(result, outputFormat(args, 'json'));
    return 0;
  }

  const result = await service.attachRemote(identifier, {
    solutionUniqueName,
    addRequiredComponents,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasDownload(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure(
        'CANVAS_DOWNLOAD_ARG_REQUIRED',
        'Usage: canvas download <displayName|name|id> --environment ALIAS [--solution UNIQUE_NAME] [--out FILE] [--extract-to-directory DIR]'
      )
    );
  }

  const solutionUniqueName = readFlag(args, '--solution');

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new CanvasService(resolution.data.client).downloadRemote(identifier, {
    solutionUniqueName,
    outPath: resolveOptionalInvocationPath(readFlag(args, '--out')),
    extractToDirectory: resolveOptionalInvocationPath(readFlag(args, '--extract-to-directory')),
    onProgress: (event) => {
      process.stderr.write(renderCanvasDownloadProgress(event));
    },
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    await buildCanvasRemoteDownloadPayload(result.data, {
      envAlias: resolution.data.environment.alias,
      solutionUniqueName: result.data.solutionUniqueName,
    }),
    outputFormat(args, 'json')
  );
  return 0;
}

export async function runCanvasImport(args: string[]): Promise<number> {
  const importPath = positionalArgs(args)[0];
  const solutionUniqueName = readFlag(args, '--solution');
  const target = readFlag(args, '--target');
  const explicitMakerEnvId = readFlag(args, '--maker-env-id');

  if (!importPath) {
    return printFailure(
      argumentFailure(
        'CANVAS_IMPORT_ARGS_REQUIRED',
        'Usage: canvas import <file.msapp> --environment ALIAS --solution UNIQUE_NAME --target <displayName|name|id> [--overwrite-unmanaged-customizations] [--no-publish-workflows]'
      )
    );
  }

  // No solution provided, or maker-env-id provided without target: use placeholder Maker guidance
  if (!solutionUniqueName || (!target && explicitMakerEnvId)) {
    return runCanvasUnsupportedRemoteMutation('import', args);
  }

  if (!target) {
    return printFailure(
      argumentFailure(
        'CANVAS_IMPORT_ARGS_REQUIRED',
        'Usage: canvas import <file.msapp> --environment ALIAS --solution UNIQUE_NAME --target <displayName|name|id> [--overwrite-unmanaged-customizations] [--no-publish-workflows]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const publishWorkflows = !hasFlag(args, '--no-publish-workflows');
  const overwriteUnmanagedCustomizations = hasFlag(args, '--overwrite-unmanaged-customizations');
  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'canvas.import',
    {
      importPath,
      target,
      environment: resolution.data.environment.alias,
      solution: solutionUniqueName,
    },
    {
      publishWorkflows,
      overwriteUnmanagedCustomizations,
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new CanvasService(resolution.data.client).importRemote(target, {
    solutionUniqueName,
    importPath: resolveOptionalInvocationPath(importPath) ?? importPath,
    publishWorkflows,
    overwriteUnmanagedCustomizations,
    onProgress: (event) => {
      process.stderr.write(renderCanvasImportProgress(event));
    },
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    buildCanvasRemoteImportPayload(result.data, {
      envAlias: resolution.data.environment.alias,
    }),
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

function renderCanvasLocalProgress(command: string, event: CanvasLocalProgressEvent): string {
  const summary =
    event.stage === 'load-source'
      ? 'loading source'
      : event.stage === 'load-registries'
        ? 'loading template registries'
        : event.stage === 'resolve-templates'
          ? 'resolving templates'
          : event.stage === 'build-powerfx-bridge'
            ? 'building Power Fx bridge'
            : event.stage === 'build-semantic-model'
              ? 'building semantic model'
              : event.stage === 'validate'
                ? 'running checks'
                : event.stage === 'build-package'
                  ? 'packaging .msapp'
                  : event.stage;
  return `[pp] canvas ${command}: ${summary}${event.detail ? ` - ${event.detail}` : ''}\n`;
}

function renderCanvasDownloadProgress(event: { stage: string; detail?: string }): string {
  const summary =
    event.stage === 'resolve-app'
      ? 'resolving remote app'
      : event.stage === 'export-solution'
        ? 'exporting solution package'
        : event.stage === 'read-solution-archive'
          ? 'reading solution archive'
          : event.stage === 'write-msapp'
            ? 'writing .msapp artifact'
            : event.stage === 'extract-source'
              ? 'extracting editable source'
              : event.stage;
  return `[pp] canvas download: ${summary}${event.detail ? ` - ${event.detail}` : ''}\n`;
}

function renderCanvasImportProgress(event: { stage: string; detail?: string }): string {
  const summary =
    event.stage === 'resolve-app'
      ? 'resolving target app'
      : event.stage === 'export-solution'
        ? 'exporting solution package'
        : event.stage === 'read-solution-archive'
          ? 'reading solution archive'
          : event.stage === 'extract-solution-archive'
            ? 'extracting solution archive'
            : event.stage === 'replace-msapp'
              ? 'replacing canvas artifact'
              : event.stage === 'rebuild-solution'
                ? 'rebuilding solution package'
                : event.stage === 'import-solution'
                  ? 'importing solution package'
                  : event.stage;
  return `[pp] canvas import: ${summary}${event.detail ? ` - ${event.detail}` : ''}\n`;
}

function buildCanvasRemoteInspectPayload(input: {
  app: Awaited<ReturnType<CanvasService['inspectRemote']>> extends OperationResult<infer T> ? NonNullable<T> : never;
  envAlias: string;
  solutionUniqueName?: string;
  downloadPlan?: Awaited<ReturnType<CanvasService['planRemoteDownload']>> extends OperationResult<infer T>
    ? T extends { resolution: infer R }
      ? R
      : never
    : never;
  makerEnvironmentId?: string;
  browserProfileName?: string;
  proof?: unknown;
}) {
  const portalProvenance = buildCanvasPortalProvenance({
    appId: input.app.id,
    appOpenUri: input.app.openUri,
    makerEnvironmentId: input.makerEnvironmentId,
  });
  const runtimeHandoff = buildCanvasRuntimeHandoff({
    appId: input.app.id,
    displayName: input.app.displayName ?? input.app.name ?? input.app.id,
    appOpenUri: input.app.openUri,
    makerStudioUrl: portalProvenance?.makerStudioUrl,
    browserProfileName: input.browserProfileName,
    envAlias: input.envAlias,
    solutionUniqueName: input.solutionUniqueName,
  });

  return compactObject({
    ...input.app,
    portalProvenance,
    handoff: {
      makerStudio: compactObject({
        recommendedUrl: portalProvenance?.makerStudioUrl,
        inspectCommand: `pp canvas inspect ${formatCliArg(input.app.displayName ?? input.app.name ?? input.app.id)} --environment ${formatCliArg(input.envAlias)}${input.solutionUniqueName ? ` --solution ${formatCliArg(input.solutionUniqueName)}` : ''}`,
      }),
      download: !input.downloadPlan
        ? undefined
        : input.downloadPlan.status === 'ready' && input.downloadPlan.resolvedSolutionUniqueName
          ? {
              solutionUniqueName: input.downloadPlan.resolvedSolutionUniqueName,
              autoResolved: input.downloadPlan.autoResolved,
              downloadCommand: `pp canvas download ${formatCliArg(input.app.displayName ?? input.app.name ?? input.app.id)} --environment ${formatCliArg(input.envAlias)} --solution ${formatCliArg(input.downloadPlan.resolvedSolutionUniqueName)}`,
            }
          : compactObject({
              status: input.downloadPlan?.status,
              candidateSolutions: input.downloadPlan?.candidateSolutions.map((candidate) => candidate.uniqueName ?? candidate.solutionId),
              hint:
                input.downloadPlan?.status === 'requires-solution-membership'
                  ? 'Attach the app to a solution before attempting remote schema harvest or download.'
                  : input.downloadPlan?.status === 'solution-ambiguous'
                    ? 'Pass --solution <unique-name> to choose the containing solution for download/proof.'
                    : undefined,
            }),
      dataverse: {
        accessCommand: `pp canvas access ${formatCliArg(input.app.displayName ?? input.app.name ?? input.app.id)} --environment ${formatCliArg(input.envAlias)} --format json`,
      },
      runtime: runtimeHandoff,
    },
    ...(input.proof ? { proof: input.proof } : {}),
  });
}

async function buildCanvasRemoteDownloadPayload(
  result: Awaited<ReturnType<CanvasService['downloadRemote']>> extends OperationResult<infer T> ? NonNullable<T> : never,
  context: {
    envAlias: string;
    solutionUniqueName: string;
  }
) {
  const dataSources = result.extractedPath ? await inspectExtractedCanvasDataSources(result.extractedPath) : [];

  return compactObject({
    ...result,
    handoff: {
      roundTrip: compactObject({
        extractedPath: result.extractedPath,
        buildCommand: result.extractedPath
          ? `pp canvas build ${formatCliArg(result.extractedPath)} --out <rebuilt-msapp>`
          : undefined,
        replaceTargetHint: `Use \`pp solution pack <unpacked-solution-dir> --rebuild-canvas-apps --out <solution.zip>\` to rebuild extracted CanvasApps/* folders back into their sibling .msapp artifacts before packing.`,
        extractSuggestion: result.extractedPath
          ? undefined
          : 'Use `--extract-to-directory <dir>` on download or `pp solution unpack <solution.zip> --extract-canvas-apps` to get editable source before rebuilding.',
        packCommand: 'pp solution pack <unpacked-solution-dir> --rebuild-canvas-apps --out <solution.zip>',
      }),
      dataSources:
        dataSources.length > 0
          ? dataSources.map((source: { name: string; datasetName?: string; entityName?: string }) =>
              compactObject({
                name: source.name,
                datasetName: source.datasetName,
                entityName: source.entityName,
                metadataCommand: source.entityName
                  ? `pp dv metadata table ${formatCliArg(source.entityName)} --environment ${formatCliArg(context.envAlias)} --format json`
                  : undefined,
              })
            )
          : undefined,
    },
  });
}

async function inspectExtractedCanvasDataSources(extractedPath: string) {
  const path = resolvePath(extractedPath, 'References', 'DataSources.json');
  const document = await readJsonFile<Record<string, unknown>>(path).catch(() => undefined);
  const entries = Array.isArray(document?.DataSources) ? document.DataSources : [];

  return entries
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) =>
      compactObject({
        name: typeof entry.Name === 'string' ? entry.Name : '<unknown>',
        datasetName: typeof entry.DatasetName === 'string' ? entry.DatasetName : undefined,
        entityName: typeof entry.EntityName === 'string' ? entry.EntityName : undefined,
      })
    );
}

function buildCanvasRemoteImportPayload(
  result: Awaited<ReturnType<CanvasService['importRemote']>> extends OperationResult<infer T> ? NonNullable<T> : never,
  context: {
    envAlias: string;
  }
) {
  const targetIdentifier = result.app.displayName ?? result.app.name ?? result.app.id;

  return compactObject({
    ...result,
    handoff: {
      verification: {
        inspectCommand: `pp canvas inspect ${formatCliArg(targetIdentifier)} --environment ${formatCliArg(context.envAlias)} --solution ${formatCliArg(result.solutionUniqueName)}`,
        downloadCommand: `pp canvas download ${formatCliArg(targetIdentifier)} --environment ${formatCliArg(context.envAlias)} --solution ${formatCliArg(result.solutionUniqueName)} --out <verified.msapp>`,
        solutionComponentsCommand: `pp solution components ${formatCliArg(result.solutionUniqueName)} --environment ${formatCliArg(context.envAlias)} --format json`,
      },
    },
  });
}

function buildCanvasPortalProvenance(input: {
  appId: string;
  appOpenUri?: string;
  makerEnvironmentId?: string;
}) {
  const canonicalOpenUri = input.appOpenUri;
  const derivedStudioUrl = canonicalOpenUri ? deriveCanvasStudioEditUrl(canonicalOpenUri) : undefined;
  const normalizedStudioUrl = normalizeExistingMakerCanvasUrl(canonicalOpenUri, input.appId);
  const makerStudioUrl = derivedStudioUrl ?? normalizedStudioUrl ?? synthesizeCanvasStudioUrl(input.appId, input.makerEnvironmentId);

  const makerStudioSource = derivedStudioUrl
    ? 'derived-from-app-open-uri'
    : normalizedStudioUrl
      ? 'normalized-from-app-open-uri'
      : makerStudioUrl
        ? 'synthesized-from-maker-environment-id'
        : undefined;

  return compactObject({
    appOpenUri: canonicalOpenUri,
    makerEnvironmentId: input.makerEnvironmentId,
    makerStudioUrl,
    sources: compactObject({
      appOpenUri: canonicalOpenUri ? 'dataverse.canvasapps.appopenuri' : undefined,
      makerStudioUrl: makerStudioSource,
    }),
  });
}

function buildCanvasRuntimeHandoff(input: {
  appId: string;
  displayName: string;
  appOpenUri?: string;
  makerStudioUrl?: string;
  browserProfileName?: string;
  envAlias?: string;
  solutionUniqueName?: string;
}) {
  const runtimeHost = readUrlHost(input.appOpenUri);
  const envSuffix = input.envAlias ? ` --environment ${formatCliArg(input.envAlias)}` : ' --environment <alias>';
  const solutionSuffix = input.solutionUniqueName ? ` --solution ${formatCliArg(input.solutionUniqueName)}` : '';

  return compactObject({
    playUrl: input.appOpenUri,
    makerStudioUrl: input.makerStudioUrl,
    browserProfile: input.browserProfileName,
    expectedHosts: compactObject({
      runtime: runtimeHost,
      authRedirect: input.appOpenUri ? 'login.microsoftonline.com' : undefined,
      makerStudio: readUrlHost(input.makerStudioUrl),
    }),
    bootstrapCommand:
      input.browserProfileName && input.appOpenUri
        ? `pp auth browser-profile bootstrap ${formatCliArg(input.browserProfileName)} --url ${formatCliArg(input.appOpenUri)} --no-wait`
        : undefined,
    inspectCommand: `pp canvas inspect ${formatCliArg(input.displayName)}${envSuffix}${solutionSuffix} --format json`,
    probeCommand:
      input.appOpenUri && input.browserProfileName
        ? `pp canvas probe ${formatCliArg(input.displayName)}${envSuffix}${solutionSuffix} --browser-profile ${formatCliArg(input.browserProfileName)} --format json`
        : undefined,
    notes: input.appOpenUri
      ? [
          'Use the play URL for runtime landing checks and compare the final browser host against the expected runtime/auth hosts here.',
          'If the handoff lands on login.microsoftonline.com instead of the Power Apps runtime host, treat that as an auth redirect rather than a missing app.',
        ]
      : undefined,
  });
}

function readUrlHost(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

async function captureCanvasRuntimeProbe(
  page: {
    url(): string;
    title(): Promise<string>;
    frames(): Array<{ name(): string; url(): string }>;
    screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  },
  input: {
    requestedUrl: string;
    expectedHosts?: {
      runtime?: string;
      authRedirect?: string;
      makerStudio?: string;
    };
    outDir: string;
    appDisplayName: string;
    browserLaunch: {
      profileName: string;
      requestedUserDataDir: string;
      effectiveUserDataDir: string;
      fallbackClone?: {
        sourceUserDataDir: string;
        clonedUserDataDir: string;
        omittedEntries: string[];
        trigger: string;
      };
    };
    navigationError?: string;
  }
) {
  const finalUrl = page.url();
  const finalHost = readUrlHost(finalUrl);
  const title = await page.title().catch(() => '');
  const frames = page.frames().map((frame) =>
    compactObject({
      name: frame.name() || undefined,
      url: frame.url() || undefined,
      host: readUrlHost(frame.url()),
    })
  );
  const slug = slugifyCanvasDelegatedArtifacts(input.appDisplayName);
  const screenshotPath = join(input.outDir, `${slug}.runtime-probe.png`);
  const sessionPath = join(input.outDir, `${slug}.runtime-probe.json`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

  const payload = compactObject({
    requestedUrl: input.requestedUrl,
    finalUrl,
    finalHost,
    title: title || undefined,
    landingKind: classifyCanvasRuntimeLanding(finalHost, input.expectedHosts),
    expectedHosts: input.expectedHosts,
    navigationError: input.navigationError,
    matchedExpectedHost:
      finalHost && input.expectedHosts
        ? [input.expectedHosts.runtime, input.expectedHosts.authRedirect, input.expectedHosts.makerStudio].includes(finalHost)
        : undefined,
    frames,
    browserLaunch: input.browserLaunch,
    artifacts: {
      screenshotPath,
      sessionPath,
    },
  });
  await writeJsonFile(sessionPath, payload as never).catch(() => undefined);
  return payload;
}

function classifyCanvasRuntimeLanding(
  host: string | undefined,
  expectedHosts:
    | {
        runtime?: string;
        authRedirect?: string;
        makerStudio?: string;
      }
    | undefined
): 'runtime' | 'auth-redirect' | 'maker-studio' | 'other' | 'unknown' {
  if (!host) {
    return 'unknown';
  }

  if (expectedHosts?.runtime && host === expectedHosts.runtime) {
    return 'runtime';
  }

  if (expectedHosts?.authRedirect && host === expectedHosts.authRedirect) {
    return 'auth-redirect';
  }

  if (expectedHosts?.makerStudio && host === expectedHosts.makerStudio) {
    return 'maker-studio';
  }

  return 'other';
}

function normalizeExistingMakerCanvasUrl(appOpenUri: string | undefined, appId: string): string | undefined {
  if (!appOpenUri) {
    return undefined;
  }

  try {
    const url = new URL(appOpenUri);

    if (url.hostname !== 'make.powerapps.com' || !url.pathname.includes('/canvas/')) {
      return undefined;
    }

    if (!url.searchParams.get('action')) {
      url.searchParams.set('action', 'edit');
    }

    if (!url.searchParams.get('app-id')) {
      url.searchParams.set('app-id', `/providers/Microsoft.PowerApps/apps/${appId}`);
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

function synthesizeCanvasStudioUrl(appId: string, makerEnvironmentId: string | undefined): string | undefined {
  if (!makerEnvironmentId) {
    return undefined;
  }

  const url = new URL(`https://make.powerapps.com/e/${encodeURIComponent(makerEnvironmentId)}/canvas/`);
  url.searchParams.set('action', 'edit');
  url.searchParams.set('app-id', `/providers/Microsoft.PowerApps/apps/${appId}`);
  return url.toString();
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export async function runCanvasBuild(args: string[]): Promise<number> {
  const canvasPath = positionalArgs(args)[0];

  if (!canvasPath) {
    return printFailure(argumentFailure('CANVAS_PATH_REQUIRED', 'Usage: canvas build <path|workspaceApp> [--workspace FILE] [--out FILE] [--mode strict|seeded|registry] [--package-only]'));
  }

  const context = await resolveCanvasCliContext(args, canvasPath);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const outPath = resolveOptionalInvocationPath(readFlag(args, '--out'));
  const packageOnly = hasFlag(args, '--package-only');
  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'canvas.build',
    {
      path: canvasPath,
      mode: context.data.options.mode,
      outPath: outPath ?? 'auto',
      packageOnly,
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const format = outputFormat(args, 'json');
  const result = await new CanvasService().build(context.data.path, {
    ...context.data.options,
    outPath,
    packageOnly,
    onProgress: (event) => {
      process.stderr.write(renderCanvasLocalProgress('build', event));
    },
  });

  if (!result.success || !result.data) {
    if (isMachineReadableOutputFormat(format) && result.details && typeof result.details === 'object') {
      printByFormat(result.details, format);
      printResultDiagnostics({ ...result, success: true as const, details: undefined }, format);
      return 1;
    }

    return printFailureWithMachinePayload(result, format);
  }

  printByFormat(result.data, format);
  printResultDiagnostics(result, format);
  return 0;
}

export async function runCanvasDiff(args: string[]): Promise<number> {
  const [leftPath, rightPath] = positionalArgs(args);

  if (!leftPath || !rightPath) {
    return printFailure(argumentFailure('CANVAS_DIFF_ARGS_REQUIRED', 'Usage: canvas diff <leftPath> <rightPath>'));
  }

  const result = await new CanvasService().diff(leftPath, rightPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasTemplateImport(args: string[]): Promise<number> {
  const sourcePath = positionalArgs(args)[0];

  if (!sourcePath) {
    return printFailure(
      argumentFailure(
        'CANVAS_TEMPLATE_IMPORT_SOURCE_REQUIRED',
        'Usage: canvas templates import <sourcePath> [--out FILE] [--kind official-api|official-artifact|harvested|inferred] [--source LABEL]'
      )
    );
  }

  const result = await new CanvasService().importRegistry({
    sourcePath,
    outPath: readFlag(args, '--out'),
    provenance: readCanvasTemplateImportProvenance(args),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasTemplateInspect(args: string[]): Promise<number> {
  const registryPath = positionalArgs(args)[0];

  if (!registryPath) {
    return printFailure(argumentFailure('CANVAS_TEMPLATE_REGISTRY_REQUIRED', 'Usage: canvas templates inspect <registryPath>'));
  }

  const result = await new CanvasService().inspectRegistry(registryPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasTemplateDiff(args: string[]): Promise<number> {
  const [leftPath, rightPath] = positionalArgs(args);

  if (!leftPath || !rightPath) {
    return printFailure(argumentFailure('CANVAS_TEMPLATE_DIFF_ARGS_REQUIRED', 'Usage: canvas templates diff <leftRegistry> <rightRegistry>'));
  }

  const result = await new CanvasService().diffRegistries(leftPath, rightPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasTemplatePin(args: string[]): Promise<number> {
  const registryPath = positionalArgs(args)[0];
  const outPath = readFlag(args, '--out');

  if (!registryPath || !outPath) {
    return printFailure(argumentFailure('CANVAS_TEMPLATE_PIN_ARGS_REQUIRED', 'Usage: canvas templates pin <registryPath> --out FILE'));
  }

  const result = await new CanvasService().pinRegistry(registryPath, outPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasTemplateRefresh(args: string[]): Promise<number> {
  const sourcePath = positionalArgs(args)[0];

  if (!sourcePath) {
    return printFailure(argumentFailure('CANVAS_TEMPLATE_REFRESH_SOURCE_REQUIRED', 'Usage: canvas templates refresh <sourcePath> --out FILE'));
  }

  const result = await new CanvasService().refreshRegistry({
    sourcePath,
    outPath: readFlag(args, '--out'),
    currentPath: readFlag(args, '--current'),
    provenance: readCanvasTemplateImportProvenance(args),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasTemplateAudit(args: string[]): Promise<number> {
  const registryPath = positionalArgs(args)[0];

  if (!registryPath) {
    return printFailure(argumentFailure('CANVAS_TEMPLATE_AUDIT_ARGS_REQUIRED', 'Usage: canvas templates audit <registryPath>'));
  }

  const result = await new CanvasService().auditRegistry(registryPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasWorkspaceInspect(args: string[]): Promise<number> {
  const workspacePath = positionalArgs(args)[0];

  if (!workspacePath) {
    return printFailure(argumentFailure('CANVAS_WORKSPACE_PATH_REQUIRED', 'Usage: canvas workspace inspect <workspacePath>'));
  }

  const result = await new CanvasService().inspectWorkspace(workspacePath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

export async function runCanvasPatchPlan(args: string[]): Promise<number> {
  const canvasPath = positionalArgs(args)[0];
  const patchFile = readFlag(args, '--file');

  if (!canvasPath || !patchFile) {
    return printFailure(argumentFailure('CANVAS_PATCH_PLAN_ARGS_REQUIRED', 'Usage: canvas patch plan <path> --file PATCH.json'));
  }

  const context = await resolveCanvasCliContext(args, canvasPath);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const patch = await readJsonFileForCli(patchFile, 'CANVAS_PATCH_FILE_INVALID', '--file must point to a JSON patch document.');

  if (!patch.success || patch.data === undefined) {
    return printFailure(patch);
  }

  const result = await new CanvasService().planPatch(context.data.path, patch.data as never);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return result.data.valid ? 0 : 1;
}

export async function runCanvasPatchApply(args: string[]): Promise<number> {
  const canvasPath = positionalArgs(args)[0];
  const patchFile = readFlag(args, '--file');

  if (!canvasPath || !patchFile) {
    return printFailure(argumentFailure('CANVAS_PATCH_APPLY_ARGS_REQUIRED', 'Usage: canvas patch apply <path> --file PATCH.json [--out PATH]'));
  }

  const context = await resolveCanvasCliContext(args, canvasPath);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const patch = await readJsonFileForCli(patchFile, 'CANVAS_PATCH_FILE_INVALID', '--file must point to a JSON patch document.');

  if (!patch.success || patch.data === undefined) {
    return printFailure(patch);
  }

  const outPath = readFlag(args, '--out');
  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'canvas.patch.apply',
    { canvasPath: context.data.path, patchFile, outPath },
    patch.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new CanvasService().applyPatch(context.data.path, patch.data as never, outPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function resolveCanvasCliContext(args: string[], canvasTarget?: string): Promise<OperationResult<CanvasCliContext>> {
  const workspacePath = readFlag(args, '--workspace');
  const resolvedCanvasTarget = canvasTarget ? resolvePath(canvasTarget) : undefined;
  const rootPath = resolvedCanvasTarget && (await pathExists(resolvedCanvasTarget)) ? resolvedCanvasTarget : process.cwd();

  const config = await loadProjectConfig(rootPath);

  const mode = readCanvasBuildMode(readFlag(args, '--mode') ?? 'strict');

  if (!mode) {
    return argumentFailure('CANVAS_MODE_INVALID', 'Use --mode strict, seeded, or registry.');
  }

  const registries = readRepeatedFlags(args, '--registry');
  let path = canvasTarget ? resolvePath(canvasTarget) : resolvePath(rootPath);
  let resolvedRegistries = registries.length > 0 ? registries : (config.data?.config.templateRegistries ?? []);
  let diagnostics = config.diagnostics;
  let warnings = config.warnings;

  if (workspacePath && canvasTarget) {
    const workspace = await new CanvasService().resolveWorkspaceTarget(canvasTarget, {
      workspacePath,
      registries,
    });

    if (!workspace.success || !workspace.data) {
      return workspace as unknown as OperationResult<CanvasCliContext>;
    }

    path = workspace.data.path;
    resolvedRegistries = workspace.data.registries;
    diagnostics = [...diagnostics, ...workspace.diagnostics];
    warnings = [...warnings, ...workspace.warnings];
  }

  return ok(
    {
      path,
      options: {
        root: rootPath,
        registries: resolvedRegistries,
        cacheDir: readFlag(args, '--cache-dir'),
        mode,
      },
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings,
    }
  );
}

function readCanvasBuildMode(value: string | undefined): CanvasBuildMode | undefined {
  return value === 'strict' || value === 'seeded' || value === 'registry' ? value : undefined;
}

function readCanvasTemplateImportProvenance(args: string[]): Partial<CanvasTemplateProvenance> | undefined {
  const provenance: Partial<CanvasTemplateProvenance> = {
    kind: readFlag(args, '--kind') as CanvasTemplateProvenance['kind'] | undefined,
    source: readFlag(args, '--source'),
    acquiredAt: readFlag(args, '--acquired-at'),
    sourceArtifact: readFlag(args, '--source-artifact'),
    sourceAppId: readFlag(args, '--source-app-id'),
    platformVersion: readFlag(args, '--platform-version'),
    appVersion: readFlag(args, '--app-version'),
  };

  return Object.values(provenance).some((value) => value !== undefined) ? provenance : undefined;
}

function readCanvasRemoteProofExpectations(args: string[]): OperationResult<Array<{ controlPath: string; property: string; expectedValue: string }>> {
  const specs = readRepeatedFlags(args, '--expect-control-property');
  const expectations: Array<{ controlPath: string; property: string; expectedValue: string }> = [];

  for (const spec of specs) {
    const parsed = parseCanvasRemoteProofExpectation(spec);

    if (!parsed.success || !parsed.data) {
      return parsed as unknown as OperationResult<Array<{ controlPath: string; property: string; expectedValue: string }>>;
    }

    expectations.push(parsed.data);
  }

  return ok(expectations, {
    supportTier: 'preview',
  });
}

function parseCanvasRemoteProofExpectation(spec: string): OperationResult<{ controlPath: string; property: string; expectedValue: string }> {
  const separator = '::';
  const first = spec.indexOf(separator);
  const second = first === -1 ? -1 : spec.indexOf(separator, first + separator.length);

  if (first <= 0 || second <= first + separator.length || second + separator.length >= spec.length) {
    return fail(
      createDiagnostic(
        'error',
        'CANVAS_REMOTE_PROOF_EXPECTATION_INVALID',
        `Invalid --expect-control-property value ${spec}.`,
        {
          source: '@pp/cli',
          hint: "Use <controlPath>::<property>::<expectedValue>, for example Screen1/Gallery1::Items::='PP Harness Projects'.",
        }
      ),
      {
        supportTier: 'preview',
      }
    );
  }

  return ok(
    {
      controlPath: spec.slice(0, first),
      property: spec.slice(first + separator.length, second),
      expectedValue: spec.slice(second + separator.length),
    },
    {
      supportTier: 'preview',
    }
  );
}

function slugifyCanvasDelegatedArtifacts(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
