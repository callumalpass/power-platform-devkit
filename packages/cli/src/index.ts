#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { renderMarkdownPortfolioReport, renderMarkdownReport, generateContextPack, generatePortfolioReport } from '@pp/analysis';
import { readJsonFile, writeJsonFile } from '@pp/artifacts';
import {
  AuthService,
  createTokenProvider,
  resolveBrowserProfileDirectory,
  summarizeProfile,
  type AuthProfile,
} from '@pp/auth';
import { CanvasService, type CanvasBuildMode, type CanvasTemplateProvenance } from '@pp/canvas';
import {
  createMutationPreview,
  readMutationFlags,
  resolveOutputFormat,
  renderFailure,
  renderOutput,
  renderResultDiagnostics,
  type CliOutputFormat,
} from './contract';
import {
  getEnvironmentAlias,
  listEnvironments,
  removeEnvironmentAlias,
  saveEnvironmentAlias,
  type ConfigStoreOptions,
  type EnvironmentAlias,
} from '@pp/config';
import {
  parseColumnCreateSpec,
  parseColumnUpdateSpec,
  ConnectionReferenceService,
  type DataverseBatchRequest,
  type DataverseRowApplyOperation,
  EnvironmentVariableService,
  parseCustomerRelationshipCreateSpec,
  parseGlobalOptionSetCreateSpec,
  parseGlobalOptionSetUpdateSpec,
  parseMetadataApplyPlan,
  parseManyToManyRelationshipUpdateSpec,
  parseManyToManyRelationshipCreateSpec,
  parseOneToManyRelationshipUpdateSpec,
  parseOneToManyRelationshipCreateSpec,
  parseTableCreateSpec,
  parseTableUpdateSpec,
  diffDataverseMetadataSnapshots,
  normalizeAttributeDefinition,
  normalizeAttributeDefinitions,
  normalizeGlobalOptionSetDefinition,
  normalizeRelationshipDefinition,
  resolveDataverseClient,
  type MetadataApplyPlan,
  type AttributeMetadataView,
  type DataverseMetadataSnapshot,
  type RelationshipMetadataKind,
} from '@pp/dataverse';
import { fail, ok, createDiagnostic, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { FlowService, type FlowPatchDocument, type FlowWorkflowStateLabel } from '@pp/flow';
import { HttpClient } from '@pp/http';
import { ModelService, type ModelArtifactMutationKind } from '@pp/model';
import { PowerBiClient } from '@pp/powerbi';
import {
  discoverProject,
  doctorProject,
  feedbackProject,
  initProject,
  planProjectInit,
  resolvePowerBiTarget,
  resolveSharePointTarget,
  summarizeProject,
  summarizeProjectContract,
  summarizeResolvedParameter,
  type ProjectDoctorReport,
  type ProjectFeedbackReport,
  type ProjectInitPlan,
  type ProjectInitResult,
  type ProviderBindingResolverContext,
  type ProjectContext,
  type ResolvedPowerBiTarget,
  type ResolvedSharePointTarget,
} from '@pp/project';
import { SharePointClient } from '@pp/sharepoint';
import { SolutionService, type SolutionAnalysis, type SolutionPackageType } from '@pp/solution';
import { runDelegatedCanvasCreate } from './canvas-create-delegate';
import {
  CLI_PACKAGE_NAME,
  CLI_VERSION,
  collectOperabilityBundle,
  collectOperabilityDoctorReport,
  renderCompletionScript,
} from './operability';
import YAML from 'yaml';
import * as cliHelp from './help';
import {
  runAuthGroup,
  runAnalysisGroup,
  runCanvasGroup,
  runConnectionReferenceGroup,
  runDataverseGroup,
  runDeployGroup,
  runDiagnosticsGroup,
  runEnvironmentGroup,
  runEnvironmentVariableGroup,
  runFlowGroup,
  runModelGroup,
  runPowerBiGroup,
  runProjectGroup,
  runSharePointGroup,
  runSolutionGroup,
} from './command-groups';
import {
  runProjectDoctorCommand,
  runProjectFeedbackCommand,
  runProjectInitCommand,
  runProjectInspectCommand,
} from './project-commands';
import {
  runAnalysisContextCommand,
  runAnalysisDriftCommand,
  runAnalysisPolicyCommand,
  runAnalysisPortfolioCommand,
  runAnalysisReportCommand,
  runAnalysisUsageCommand,
} from './analysis-commands';
import {
  runSolutionAnalyzeCommand,
  runSolutionComponentsCommand,
  runSolutionCompareCommand,
  runSolutionCreateCommand,
  runSolutionDeleteCommand,
  runSolutionDependenciesCommand,
  runSolutionExportCommand,
  runSolutionImportCommand,
  runSolutionInspectCommand,
  runSolutionListCommand,
  runSolutionPackCommand,
  runSolutionSetMetadataCommand,
  runSolutionUnpackCommand,
  createLocalSolutionService,
} from './solution-commands';
import { runDeployApplyCommand, runDeployPlanCommand, runDeployReleaseCommand } from './deploy-commands';
import {
  runAuthBrowserProfileBootstrapCommand,
  runAuthBrowserProfileInspectCommand,
  runAuthBrowserProfileListCommand,
  runAuthBrowserProfileRemoveCommand,
  runAuthBrowserProfileSaveCommand,
  runAuthLoginCommand,
  runAuthProfileInspectCommand,
  runAuthProfileListCommand,
  runAuthProfileRemoveCommand,
  runAuthProfileSaveCommand,
  runAuthTokenCommand,
} from './auth-commands';
import {
  runEnvironmentAddCommand,
  runEnvironmentCleanupCommand,
  runEnvironmentCleanupPlanCommand,
  runEnvironmentInspectCommand,
  runEnvironmentListCommand,
  runEnvironmentRemoveCommand,
  runEnvironmentResetCommand,
  runEnvironmentResolveMakerIdCommand,
} from './environment-commands';
import { dispatchMainCommand } from './routing';

type OutputFormat = CliOutputFormat;
type AttributeListView = Extract<AttributeMetadataView, 'common' | 'raw'>;
interface CanvasCliContext {
  path: string;
  options: {
    root: string;
    registries: string[];
    cacheDir?: string;
    mode: CanvasBuildMode;
  };
}

const ATTRIBUTE_COMMON_SELECT_FIELDS = [
  'LogicalName',
  'SchemaName',
  'DisplayName',
  'Description',
  'EntityLogicalName',
  'MetadataId',
  'AttributeType',
  'AttributeTypeName',
  'RequiredLevel',
  'IsPrimaryId',
  'IsPrimaryName',
  'IsCustomAttribute',
  'IsManaged',
  'IsLogical',
  'IsValidForCreate',
  'IsValidForRead',
  'IsValidForUpdate',
  'IsFilterable',
  'IsSearchable',
  'IsValidForAdvancedFind',
  'IsSecured',
] as const;
const POWER_PLATFORM_ENVIRONMENTS_API_VERSION = '2020-10-01';

export async function main(argv: string[]): Promise<number> {
  return dispatchMainCommand(argv, {
    runVersion,
    runCompletion,
    runDiagnostics,
    runAuth,
    runEnvironment,
    runDataverse,
    runSolution,
    runConnectionReference,
    runEnvironmentVariable,
    runCanvas,
    runFlow,
    runModel,
    runProject,
    runSharePoint,
    runPowerBi,
    runAnalysis,
    runDeploy,
    printFailureForInvalidFormat: (result) => printFailure(result),
  });
}

async function runProject(command: string | undefined, args: string[]): Promise<number> {
  return runProjectGroup(command, args, { runProjectInit, runProjectDoctor, runProjectFeedback, runProjectInspect });
}

async function runAnalysis(command: string | undefined, args: string[]): Promise<number> {
  return runAnalysisGroup(command, args, {
    runAnalysisReport,
    runAnalysisContext,
    runAnalysisPortfolio,
    runAnalysisDrift,
    runAnalysisUsage,
    runAnalysisPolicy,
  });
}

async function runDeploy(command: string | undefined, args: string[]): Promise<number> {
  return runDeployGroup(command, args, { runDeployPlan, runDeployApply, runDeployRelease });
}

async function runDiagnostics(command: string | undefined, args: string[]): Promise<number> {
  return runDiagnosticsGroup(command, args, { runDiagnosticsDoctor, runDiagnosticsBundle });
}

async function runSharePoint(command: string | undefined, args: string[]): Promise<number> {
  return runSharePointGroup(command, args, {
    runSharePointSiteInspect,
    runSharePointListInspect,
    runSharePointFileInspect,
    runSharePointPermissionsInspect,
  });
}

async function runPowerBi(command: string | undefined, args: string[]): Promise<number> {
  return runPowerBiGroup(command, args, { runPowerBiWorkspaceInspect, runPowerBiDatasetInspect, runPowerBiReportInspect });
}

async function runVersion(args: string[]): Promise<number> {
  const format = outputFormat(args, 'json');
  const payload = {
    name: 'pp',
    packageName: CLI_PACKAGE_NAME,
    version: CLI_VERSION,
  };

  if (format === 'raw') {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  printByFormat(payload, format);
  return 0;
}

async function runCompletion(args: string[]): Promise<number> {
  const shell = positionalArgs(args)[0] as 'bash' | 'zsh' | 'fish' | undefined;

  if (!shell || args.includes('--help') || args.includes('help')) {
    cliHelp.printCompletionHelp();
    return shell ? 0 : 1;
  }

  if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish') {
    return printFailure(
      fail(
        createDiagnostic('error', 'COMPLETION_SHELL_UNSUPPORTED', `Unsupported completion shell ${shell}.`, {
          source: '@pp/cli',
          hint: 'Use one of: bash, zsh, fish.',
        }),
        {
          suggestedNextActions: ['pp completion bash', 'pp completion zsh', 'pp completion fish'],
        }
      )
    );
  }

  process.stdout.write(renderCompletionScript(shell));
  return 0;
}

async function runDiagnosticsDoctor(args: string[]): Promise<number> {
  const report = await collectOperabilityDoctorReport(positionalArgs(args)[0], readConfigOptions(args));

  if (!report.success || !report.data) {
    return printFailure(report);
  }

  const format = outputFormat(args, 'json');
  printByFormat(report.data, format);
  printResultDiagnostics(report, format);
  return report.diagnostics.length > 0 ? 1 : 0;
}

async function runDiagnosticsBundle(args: string[]): Promise<number> {
  const bundle = await collectOperabilityBundle(positionalArgs(args)[0], readConfigOptions(args));

  if (!bundle.success || !bundle.data) {
    return printFailure(bundle);
  }

  const format = outputFormat(args, 'json');
  printByFormat(bundle.data, format);
  printResultDiagnostics(bundle, format);
  return bundle.diagnostics.length > 0 ? 1 : 0;
}

async function runAuth(command: string | undefined, args: string[]): Promise<number> {
  const configOptions = readConfigOptions(args);
  const auth = new AuthService(configOptions);

  return runAuthGroup(command, args, auth, configOptions, {
    runAuthProfileList,
    runAuthProfileInspect,
    runAuthProfileSave,
    runAuthProfileRemove,
    runAuthBrowserProfileList,
    runAuthBrowserProfileInspect,
    runAuthBrowserProfileSave,
    runAuthBrowserProfileBootstrap,
    runAuthBrowserProfileRemove,
    runAuthLogin,
    runAuthToken,
  });
}

async function runEnvironment(command: string | undefined, args: string[]): Promise<number> {
  const configOptions = readConfigOptions(args);

  return runEnvironmentGroup(command, args, configOptions, {
    runEnvironmentList,
    runEnvironmentAdd,
    runEnvironmentInspect,
    runEnvironmentResolveMakerId,
    runEnvironmentCleanupPlan,
    runEnvironmentReset,
    runEnvironmentCleanup,
    runEnvironmentRemove,
  });
}

async function runDataverse(command: string | undefined, args: string[]): Promise<number> {
  return runDataverseGroup(command, args, {
    positionalArgs,
    runDataverseWhoAmI,
    runDataverseRequest,
    runDataverseAction,
    runDataverseFunction,
    runDataverseBatch,
    runDataverseRows,
    runDataverseQuery,
    runDataverseGet,
    runDataverseCreate,
    runDataverseUpdate,
    runDataverseDelete,
    runDataverseMetadata,
  });
}

async function runSolution(command: string | undefined, args: string[]): Promise<number> {
  return runSolutionGroup(command, args, {
    runSolutionCreate,
    runSolutionDelete,
    runSolutionSetMetadata,
    runSolutionList,
    runSolutionInspect,
    runSolutionComponents,
    runSolutionDependencies,
    runSolutionAnalyze,
    runSolutionCompare,
    runSolutionExport,
    runSolutionImport,
    runSolutionPack,
    runSolutionUnpack,
  });
}

async function runConnectionReference(command: string | undefined, args: string[]): Promise<number> {
  return runConnectionReferenceGroup(command, args, {
    runConnectionReferenceList,
    runConnectionReferenceInspect,
    runConnectionReferenceValidate,
  });
}

async function runEnvironmentVariable(command: string | undefined, args: string[]): Promise<number> {
  return runEnvironmentVariableGroup(command, args, {
    runEnvironmentVariableCreate,
    runEnvironmentVariableList,
    runEnvironmentVariableInspect,
    runEnvironmentVariableSet,
  });
}

async function runCanvas(command: string | undefined, args: string[]): Promise<number> {
  return runCanvasGroup(command, args, {
    runCanvasDownload,
    runCanvasUnsupportedRemoteMutation,
    runCanvasList,
    runCanvasTemplates,
    runCanvasWorkspace,
    runCanvasPatch,
    runCanvasLint,
    runCanvasValidate,
    runCanvasInspect,
    runCanvasBuild,
    runCanvasDiff,
  });
}

async function runCanvasUnsupportedRemoteMutation(command: 'create' | 'import', args: string[]): Promise<number> {
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

async function resolveCanvasMakerEnvironmentId(
  explicitMakerEnvironmentId: string | undefined,
  environment: EnvironmentAlias,
  authProfile: AuthProfile,
  configOptions: ConfigStoreOptions,
  options: {
    persistDiscovered?: boolean;
  } = {}
): Promise<string | undefined> {
  if (explicitMakerEnvironmentId) {
    return explicitMakerEnvironmentId;
  }

  if (environment.makerEnvironmentId) {
    return environment.makerEnvironmentId;
  }

  const discovered = await discoverMakerEnvironmentIdForEnvironment(environment, authProfile, configOptions);

  if (!discovered.success || !discovered.data) {
    return undefined;
  }

  if (options.persistDiscovered) {
    await saveEnvironmentAlias(
      {
        ...environment,
        makerEnvironmentId: discovered.data,
      },
      configOptions
    );
  }

  return discovered.data;
}

async function discoverMakerEnvironmentIdForEnvironment(
  environment: EnvironmentAlias,
  authProfile: AuthProfile,
  configOptions: ConfigStoreOptions
): Promise<OperationResult<string | undefined>> {
  const tokenProvider = createTokenProvider(authProfile, configOptions);

  if (!tokenProvider.success || !tokenProvider.data) {
    return tokenProvider as unknown as OperationResult<string | undefined>;
  }

  const response = await new HttpClient({
    baseUrl: 'https://api.bap.microsoft.com/',
    tokenProvider: tokenProvider.data,
  }).requestJson<PowerPlatformEnvironmentListResponse>({
    path: '/providers/Microsoft.BusinessAppPlatform/environments',
    query: {
      'api-version': POWER_PLATFORM_ENVIRONMENTS_API_VERSION,
    },
  });

  if (!response.success) {
    return response as unknown as OperationResult<string | undefined>;
  }

  const environmentUrl = normalizeEnvironmentUrl(environment.url);
  const match = (response.data?.value ?? []).find((candidate) => {
    const instanceApiUrl = normalizeEnvironmentUrl(candidate.properties?.linkedEnvironmentMetadata?.instanceApiUrl);
    const instanceUrl = normalizeEnvironmentUrl(candidate.properties?.linkedEnvironmentMetadata?.instanceUrl);
    return instanceApiUrl === environmentUrl || instanceUrl === environmentUrl;
  });

  return ok(match?.name, {
    supportTier: 'preview',
  });
}

function normalizeEnvironmentUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return value.replace(/\/+$/, '').toLowerCase();
  }
}

interface PowerPlatformEnvironmentListResponse {
  value?: PowerPlatformEnvironmentRecord[];
}

interface PowerPlatformEnvironmentRecord {
  name?: string;
  properties?: {
    linkedEnvironmentMetadata?: {
      instanceApiUrl?: string;
      instanceUrl?: string;
    };
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

async function readEnvironmentDefaultSolution(alias: string, configOptions: ConfigStoreOptions): Promise<string | undefined> {
  const environment = await getEnvironmentAlias(alias, configOptions);

  if (!environment.success) {
    return undefined;
  }

  return environment.data?.defaultSolution;
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

async function runCanvasTemplates(args: string[]): Promise<number> {
  const [command, ...rest] = args;

  switch (command) {
    case 'import':
      return runCanvasTemplateImport(rest);
    case 'inspect':
      return runCanvasTemplateInspect(rest);
    case 'diff':
      return runCanvasTemplateDiff(rest);
    case 'pin':
      return runCanvasTemplatePin(rest);
    case 'refresh':
      return runCanvasTemplateRefresh(rest);
    case 'audit':
      return runCanvasTemplateAudit(rest);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

async function runCanvasWorkspace(args: string[]): Promise<number> {
  const [command, ...rest] = args;

  switch (command) {
    case 'inspect':
      return runCanvasWorkspaceInspect(rest);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

async function runCanvasPatch(args: string[]): Promise<number> {
  const [command, ...rest] = args;

  switch (command) {
    case 'plan':
      return runCanvasPatchPlan(rest);
    case 'apply':
      return runCanvasPatchApply(rest);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

async function runFlow(command: string | undefined, args: string[]): Promise<number> {
  return runFlowGroup(command, args, {
    runFlowList,
    runFlowInspect,
    runFlowExport,
    runFlowPromote,
    runFlowUnpack,
    runFlowPack,
    runFlowDeploy,
    runFlowNormalize,
    runFlowValidate,
    runFlowGraph,
    runFlowPatch,
    runFlowRuns,
    runFlowErrors,
    runFlowConnrefs,
    runFlowDoctor,
  });
}

async function runModel(command: string | undefined, args: string[]): Promise<number> {
  return runModelGroup(command, args, {
    runModelCreate,
    runModelAttach,
    runModelList,
    runModelInspect,
    runModelComposition,
    runModelImpact,
    runModelSitemap,
    runModelForms,
    runModelViews,
    runModelDependencies,
    runModelPatch,
  });
}

async function runProjectInspect(args: string[]): Promise<number> {
  return runProjectInspectCommand(args, {
    positionalArgs,
    resolveInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    isMachineReadableOutputFormat,
    printResultDiagnostics,
    readFlag,
    readEnvironmentAlias,
    hasFlag,
  });
}

async function runProjectInit(args: string[]): Promise<number> {
  return runProjectInitCommand(args, {
    positionalArgs,
    resolveInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    isMachineReadableOutputFormat,
    printResultDiagnostics,
    readFlag,
    readEnvironmentAlias,
    hasFlag,
  });
}

async function runProjectDoctor(args: string[]): Promise<number> {
  return runProjectDoctorCommand(args, {
    positionalArgs,
    resolveInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    isMachineReadableOutputFormat,
    printResultDiagnostics,
    readFlag,
    readEnvironmentAlias,
    hasFlag,
  });
}

async function runProjectFeedback(args: string[]): Promise<number> {
  return runProjectFeedbackCommand(args, {
    positionalArgs,
    resolveInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    isMachineReadableOutputFormat,
    printResultDiagnostics,
    readFlag,
    readEnvironmentAlias,
    hasFlag,
  });
}

async function runAnalysisReport(args: string[]): Promise<number> {
  return runAnalysisReportCommand(args, {
    positionalArgs,
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    readRepeatedFlags,
    readAnalysisPortfolioProjectPaths,
  });
}

async function runAnalysisContext(args: string[]): Promise<number> {
  return runAnalysisContextCommand(args, {
    positionalArgs,
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    readRepeatedFlags,
    readAnalysisPortfolioProjectPaths,
  });
}

async function runAnalysisPortfolio(args: string[]): Promise<number> {
  return runAnalysisPortfolioCommand(args, {
    positionalArgs,
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    readRepeatedFlags,
    readAnalysisPortfolioProjectPaths,
  });
}

async function runAnalysisDrift(args: string[]): Promise<number> {
  return runAnalysisDriftCommand(args, {
    positionalArgs,
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    readRepeatedFlags,
    readAnalysisPortfolioProjectPaths,
  });
}

async function runAnalysisUsage(args: string[]): Promise<number> {
  return runAnalysisUsageCommand(args, {
    positionalArgs,
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    readRepeatedFlags,
    readAnalysisPortfolioProjectPaths,
  });
}

async function runAnalysisPolicy(args: string[]): Promise<number> {
  return runAnalysisPolicyCommand(args, {
    positionalArgs,
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    readRepeatedFlags,
    readAnalysisPortfolioProjectPaths,
  });
}

async function runDeployPlan(args: string[]): Promise<number> {
  return runDeployPlanCommand(args, {
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    positionalArgs,
    readRepeatedFlags,
    hasFlag,
    readValueFlag,
    argumentFailure,
    printHelp: cliHelp.printHelp,
  });
}

async function runDeployApply(args: string[]): Promise<number> {
  return runDeployApplyCommand(args, {
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    positionalArgs,
    readRepeatedFlags,
    hasFlag,
    readValueFlag,
    argumentFailure,
    printHelp: cliHelp.printHelp,
  });
}

async function runDeployRelease(args: string[]): Promise<number> {
  return runDeployReleaseCommand(args, {
    resolveDefaultInvocationPath,
    outputFormat,
    readProjectDiscoveryOptions,
    printFailure,
    printByFormat,
    printResultDiagnostics,
    readFlag,
    positionalArgs,
    readRepeatedFlags,
    hasFlag,
    readValueFlag,
    argumentFailure,
    printHelp: cliHelp.printHelp,
  });
}

async function runAuthProfileList(auth: AuthService, args: string[]): Promise<number> {
  return runAuthProfileListCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthProfileInspect(auth: AuthService, configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runAuthProfileInspectCommand(auth, configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthBrowserProfileList(auth: AuthService, args: string[]): Promise<number> {
  return runAuthBrowserProfileListCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthBrowserProfileInspect(auth: AuthService, args: string[]): Promise<number> {
  return runAuthBrowserProfileInspectCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthBrowserProfileSave(auth: AuthService, args: string[]): Promise<number> {
  return runAuthBrowserProfileSaveCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthBrowserProfileRemove(auth: AuthService, args: string[]): Promise<number> {
  return runAuthBrowserProfileRemoveCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthBrowserProfileBootstrap(auth: AuthService, args: string[]): Promise<number> {
  return runAuthBrowserProfileBootstrapCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthProfileSave(
  auth: AuthService,
  args: string[],
  type: AuthProfile['type']
): Promise<number> {
  return runAuthProfileSaveCommand(auth, args, type, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthLogin(auth: AuthService, args: string[]): Promise<number> {
  return runAuthLoginCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthProfileRemove(auth: AuthService, args: string[]): Promise<number> {
  return runAuthProfileRemoveCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runAuthToken(auth: AuthService, args: string[]): Promise<number> {
  return runAuthTokenCommand(auth, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    readConfigOptions,
    readFlag,
    readRepeatedFlags,
    readListFlag,
    readEnvironmentAlias,
    hasFlag,
    argumentFailure,
    promptForEnter,
  });
}

async function runEnvironmentList(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentListCommand(configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runEnvironmentAdd(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentAddCommand(configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runEnvironmentInspect(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentInspectCommand(configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runEnvironmentResolveMakerId(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentResolveMakerIdCommand(configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runEnvironmentRemove(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentRemoveCommand(configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runEnvironmentCleanupPlan(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentCleanupPlanCommand(configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runEnvironmentCleanup(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentCleanupCommand(configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runEnvironmentReset(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentResetCommand(configOptions, args, {
    positionalArgs,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runDataverseWhoAmI(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const whoAmI = await resolution.data.client.whoAmI();

  if (!whoAmI.success || !whoAmI.data) {
    return printFailure(whoAmI);
  }

  printByFormat(
    {
      environment: resolution.data.environment.alias,
      url: resolution.data.environment.url,
      authProfile: resolution.data.authProfile.name,
      ...whoAmI.data,
    },
    outputFormat(args, 'json')
  );
  return 0;
}

async function runDataverseRequest(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const path = readFlag(args, '--path');

  if (!path) {
    return printFailure(argumentFailure('DV_REQUEST_PATH_REQUIRED', '--path is required.'));
  }

  const responseType = (readFlag(args, '--response-type') ?? 'json') as 'json' | 'text' | 'void';
  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if ((readFlag(args, '--method') ?? 'GET').toUpperCase() !== 'GET') {
    const preview = maybeHandleMutationPreview(args, 'json', 'dv.request', { path, method: readFlag(args, '--method') ?? 'GET' }, body.data);

    if (preview !== undefined) {
      return preview;
    }
  }

  const response = await resolution.data.client.request<unknown>({
    path,
    method: readFlag(args, '--method') ?? 'GET',
    body: body.data,
    responseType,
    headers: readHeaderFlags(args),
  });

  if (!response.success || !response.data) {
    return printFailure(response);
  }

  printByFormat(
    {
      status: response.data.status,
      headers: response.data.headers,
      body: response.data.data,
    },
    outputFormat(args, 'json')
  );
  return 0;
}

async function runDataverseAction(args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('DV_ACTION_NAME_REQUIRED', 'Usage: dv action <name> --environment <alias> [--body JSON|--body-file FILE]'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (body.data !== undefined && (!body.data || typeof body.data !== 'object' || Array.isArray(body.data))) {
    return printFailure(argumentFailure('DV_ACTION_BODY_INVALID', '--body or --body-file must contain a JSON object when provided.'));
  }

  const parameters = (body.data ?? {}) as Record<string, unknown>;
  const preview = maybeHandleMutationPreview(args, 'json', 'dv.action', { name, boundPath: readFlag(args, '--bound-path') }, parameters);

  if (preview !== undefined) {
    return preview;
  }

  const responseType = readDataverseResponseType(args);

  if (!responseType.success || !responseType.data) {
    return printFailure(responseType);
  }

  const result = await resolution.data.client.invokeAction<Record<string, unknown> | string | void>(name, parameters, {
    boundPath: readFlag(args, '--bound-path'),
    responseType: responseType.data,
    headers: readHeaderFlags(args),
    includeAnnotations: readListFlag(args, '--annotations'),
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseFunction(args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(
      argumentFailure(
        'DV_FUNCTION_NAME_REQUIRED',
        'Usage: dv function <name> --environment <alias> [--param key=value] [--param-json key=JSON]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const parameters = readDataverseFunctionParameters(args);

  if (!parameters.success || !parameters.data) {
    return printFailure(parameters);
  }

  const responseType = readDataverseResponseType(args);

  if (!responseType.success || !responseType.data) {
    return printFailure(responseType);
  }

  const result = await resolution.data.client.invokeFunction<Record<string, unknown> | string | void>(name, parameters.data, {
    boundPath: readFlag(args, '--bound-path'),
    responseType: responseType.data,
    headers: readHeaderFlags(args),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseBatch(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const batch = await readDataverseBatchArgument(args);

  if (!batch.success || !batch.data) {
    return printFailure(batch);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'dv.batch',
    {
      requestCount: batch.data.length,
      continueOnError: hasFlag(args, '--continue-on-error'),
    },
    batch.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.executeBatch<Record<string, unknown> | string>(
    batch.data,
    {
      continueOnError: hasFlag(args, '--continue-on-error'),
      includeAnnotations: readListFlag(args, '--annotations'),
      solutionUniqueName: readFlag(args, '--solution'),
    }
  );

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runDataverseRows(args: string[]): Promise<number> {
  const [action] = positionalArgs(args);

  if (!action) {
    return printFailure(
      argumentFailure('DV_ROWS_ACTION_REQUIRED', 'Use `dv rows export <table>` or `dv rows apply --file FILE`.')
    );
  }

  if (action === 'export') {
    return runDataverseRowsExport(args);
  }

  if (action === 'apply') {
    return runDataverseRowsApply(args);
  }

  return printFailure(argumentFailure('DV_ROWS_ACTION_INVALID', `Unsupported rows action ${action}.`));
}

async function runDataverseRowsExport(args: string[]): Promise<number> {
  const table = positionalArgs(args)[1];

  if (!table) {
    return printFailure(argumentFailure('DV_ROWS_EXPORT_TABLE_REQUIRED', 'Usage: dv rows export <table> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.exportRows<Record<string, unknown>>({
    table,
    select: readListFlag(args, '--select'),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: readListFlag(args, '--expand'),
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    all: hasFlag(args, '--all'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const outPath = readFlag(args, '--out');

  if (outPath) {
    await writeStructuredArtifact(outPath, result.data);
    printByFormat(
      {
        outPath,
        table: result.data.table,
        recordCount: result.data.recordCount,
      },
      outputFormat(args, 'json')
    );
    return 0;
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseRowsApply(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const plan = await readDataverseRowsApplyArgument(args);

  if (!plan.success || !plan.data) {
    return printFailure(plan);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'dv.rows.apply',
    {
      table: plan.data.table,
      operationCount: plan.data.operations.length,
      continueOnError: plan.data.continueOnError,
    },
    plan.data.operations
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.applyRows<Record<string, unknown>>(plan.data.operations, {
    table: plan.data.table,
    continueOnError: plan.data.continueOnError,
    includeAnnotations: readListFlag(args, '--annotations'),
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(
    {
      table: plan.data.table,
      operationCount: result.data?.length ?? 0,
      operations: result.data ?? [],
    },
    outputFormat(args, 'json')
  );
  return 0;
}

async function runDataverseQuery(args: string[]): Promise<number> {
  const table = positionalArgs(args)[0];

  if (!table) {
    return printFailure(argumentFailure('DV_TABLE_REQUIRED', 'Table logical name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const queryOptions = {
    table,
    select: readListFlag(args, '--select'),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: readListFlag(args, '--expand'),
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
  };

  if (hasFlag(args, '--page-info')) {
    const page = await resolution.data.client.queryPage<Record<string, unknown>>(queryOptions);

    if (!page.success) {
      return printFailure(page);
    }

    printByFormat(page.data ?? { records: [] }, outputFormat(args, 'json'));
    return 0;
  }

  const result = hasFlag(args, '--all')
    ? await resolution.data.client.queryAll<Record<string, unknown>>(queryOptions)
    : await resolution.data.client.query<Record<string, unknown>>(queryOptions);

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runDataverseGet(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_GET_ARGS_REQUIRED', 'Usage: dv get <table> <id> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getById<Record<string, unknown>>(table, id, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseCreate(args: string[]): Promise<number> {
  const table = positionalArgs(args)[0];

  if (!table) {
    return printFailure(argumentFailure('DV_TABLE_REQUIRED', 'Table logical name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return printFailure(argumentFailure('DV_BODY_REQUIRED', '--body or --body-file must contain a JSON object.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.create', { table }, body.data as Record<string, unknown>);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.create<Record<string, unknown>, Record<string, unknown>>(table, body.data as Record<string, unknown>, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
    returnRepresentation: hasFlag(args, '--return-representation'),
    ifNoneMatch: readFlag(args, '--if-none-match'),
    ifMatch: readFlag(args, '--if-match'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseUpdate(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_UPDATE_ARGS_REQUIRED', 'Usage: dv update <table> <id> --environment <alias> --body <json>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const body = await readJsonBodyArgument(args);

  if (!body.success) {
    return printFailure(body);
  }

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return printFailure(argumentFailure('DV_BODY_REQUIRED', '--body or --body-file must contain a JSON object.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.update', { table, id }, body.data as Record<string, unknown>);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.update<Record<string, unknown>, Record<string, unknown>>(
    table,
    id,
    body.data as Record<string, unknown>,
    {
      select: readListFlag(args, '--select'),
      expand: readListFlag(args, '--expand'),
      includeAnnotations: readListFlag(args, '--annotations'),
      returnRepresentation: hasFlag(args, '--return-representation'),
      ifMatch: readFlag(args, '--if-match'),
      ifNoneMatch: readFlag(args, '--if-none-match'),
    }
  );

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseDelete(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const table = positional[0];
  const id = positional[1];

  if (!table || !id) {
    return printFailure(argumentFailure('DV_DELETE_ARGS_REQUIRED', 'Usage: dv delete <table> <id> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.delete', { table, id });

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.delete(table, id, {
    ifMatch: readFlag(args, '--if-match'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadata(args: string[]): Promise<number> {
  const [action] = positionalArgs(args);

  if (!action) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_ACTION_REQUIRED',
        'Use `dv metadata tables`, `dv metadata table <logicalName>`, `dv metadata columns <table>`, `dv metadata column <table> <column>`, `dv metadata option-set <name>`, `dv metadata relationship <schemaName>`, `dv metadata snapshot ...`, `dv metadata diff`, `dv metadata apply`, `dv metadata create-table`, `dv metadata update-table`, `dv metadata add-column`, `dv metadata update-column`, `dv metadata create-option-set`, `dv metadata update-option-set`, `dv metadata create-relationship`, `dv metadata update-relationship`, `dv metadata create-many-to-many`, or `dv metadata create-customer-relationship`.'
      )
    );
  }

  if (action === 'tables') {
    return runDataverseMetadataTables(args);
  }

  if (action === 'table') {
    return runDataverseMetadataTable(args);
  }

  if (action === 'columns') {
    return runDataverseMetadataColumns(args);
  }

  if (action === 'column') {
    return runDataverseMetadataColumn(args);
  }

  if (action === 'option-set') {
    return runDataverseMetadataOptionSet(args);
  }

  if (action === 'relationship') {
    return runDataverseMetadataRelationship(args);
  }

  if (action === 'snapshot') {
    return runDataverseMetadataSnapshot(args);
  }

  if (action === 'diff') {
    return runDataverseMetadataDiff(args);
  }

  if (action === 'apply') {
    return runDataverseMetadataApply(args);
  }

  if (action === 'create-table') {
    return runDataverseMetadataCreateTable(args);
  }

  if (action === 'update-table') {
    return runDataverseMetadataUpdateTable(args);
  }

  if (action === 'add-column') {
    return runDataverseMetadataAddColumn(args);
  }

  if (action === 'update-column') {
    return runDataverseMetadataUpdateColumn(args);
  }

  if (action === 'create-option-set') {
    return runDataverseMetadataCreateOptionSet(args);
  }

  if (action === 'update-option-set') {
    return runDataverseMetadataUpdateOptionSet(args);
  }

  if (action === 'create-relationship') {
    return runDataverseMetadataCreateRelationship(args);
  }

  if (action === 'update-relationship') {
    return runDataverseMetadataUpdateRelationship(args);
  }

  if (action === 'create-many-to-many') {
    return runDataverseMetadataCreateManyToManyRelationship(args);
  }

  if (action === 'create-customer-relationship') {
    return runDataverseMetadataCreateCustomerRelationship(args);
  }

  return printFailure(argumentFailure('DV_METADATA_ACTION_INVALID', `Unsupported metadata action ${action}.`));
}

async function runDataverseMetadataTables(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.listTables({
    select: readListFlag(args, '--select'),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: readListFlag(args, '--expand'),
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    all: hasFlag(args, '--all'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataTable(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const logicalName = positional[1];

  if (!logicalName) {
    return printFailure(argumentFailure('DV_METADATA_TABLE_REQUIRED', 'Usage: dv metadata table <logicalName> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getTable(logicalName, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataColumns(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const logicalName = positional[1];

  if (!logicalName) {
    return printFailure(argumentFailure('DV_METADATA_COLUMNS_TABLE_REQUIRED', 'Usage: dv metadata columns <tableLogicalName> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const view = readAttributeListView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const result = await resolution.data.client.listColumns(logicalName, {
    select: view.data === 'raw' ? readListFlag(args, '--select') : mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, readListFlag(args, '--select')),
    top: readNumberFlag(args, '--top'),
    filter: readFlag(args, '--filter'),
    expand: view.data === 'raw' ? readListFlag(args, '--expand') : undefined,
    orderBy: readListFlag(args, '--orderby'),
    count: hasFlag(args, '--count'),
    maxPageSize: readNumberFlag(args, '--max-page-size'),
    includeAnnotations: readListFlag(args, '--annotations'),
    all: hasFlag(args, '--all'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  const payload = view.data === 'raw' ? result.data ?? [] : normalizeAttributeDefinitions(result.data ?? [], 'common');
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataColumn(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];
  const columnLogicalName = positional[2];

  if (!tableLogicalName || !columnLogicalName) {
    return printFailure(
      argumentFailure('DV_METADATA_COLUMN_REQUIRED', 'Usage: dv metadata column <tableLogicalName> <columnLogicalName> --environment <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const view = readAttributeDetailView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const result = await resolution.data.client.getColumn(tableLogicalName, columnLogicalName, {
    select:
      view.data === 'raw'
        ? readListFlag(args, '--select')
        : view.data === 'common'
          ? mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, readListFlag(args, '--select'))
          : readListFlag(args, '--select')
            ? mergeUniqueStrings(ATTRIBUTE_COMMON_SELECT_FIELDS, readListFlag(args, '--select'))
            : undefined,
    expand: view.data === 'raw' ? readListFlag(args, '--expand') : undefined,
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  const payload = view.data === 'raw' ? result.data : normalizeAttributeDefinition(result.data, view.data);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataOptionSet(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const name = positional[1];

  if (!name) {
    return printFailure(argumentFailure('DV_METADATA_OPTION_SET_REQUIRED', 'Usage: dv metadata option-set <name> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.getGlobalOptionSet(name, {
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const view = readMetadataInspectView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const payload = view.data === 'raw' ? result.data : normalizeGlobalOptionSetDefinition(result.data);
  printWarnings(result);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataRelationship(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const schemaName = positional[1];

  if (!schemaName) {
    return printFailure(argumentFailure('DV_METADATA_RELATIONSHIP_REQUIRED', 'Usage: dv metadata relationship <schemaName> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const kind = readRelationshipKind(args);

  if (!kind.success || !kind.data) {
    return printFailure(kind);
  }

  const result = await resolution.data.client.getRelationship(schemaName, {
    kind: kind.data,
    select: readListFlag(args, '--select'),
    expand: readListFlag(args, '--expand'),
    includeAnnotations: readListFlag(args, '--annotations'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  const view = readMetadataInspectView(args);

  if (!view.success || !view.data) {
    return printFailure(view);
  }

  const payload = view.data === 'raw' ? result.data : normalizeRelationshipDefinition(result.data);
  printWarnings(result);
  printByFormat(payload, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataSnapshot(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const domain = positional[1];

  if (!domain) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_SNAPSHOT_DOMAIN_REQUIRED',
        'Usage: dv metadata snapshot <table|columns|option-set|relationship> ... --environment <alias>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  let snapshot;

  if (domain === 'table') {
    const logicalName = positional[2];

    if (!logicalName) {
      return printFailure(
        argumentFailure('DV_METADATA_SNAPSHOT_TABLE_REQUIRED', 'Usage: dv metadata snapshot table <logicalName> --environment <alias>')
      );
    }

    snapshot = await resolution.data.client.snapshotTableMetadata(logicalName);
  } else if (domain === 'columns') {
    const logicalName = positional[2];

    if (!logicalName) {
      return printFailure(
        argumentFailure(
          'DV_METADATA_SNAPSHOT_COLUMNS_REQUIRED',
          'Usage: dv metadata snapshot columns <tableLogicalName> --environment <alias>'
        )
      );
    }

    snapshot = await resolution.data.client.snapshotColumnsMetadata(logicalName);
  } else if (domain === 'option-set') {
    const name = positional[2];

    if (!name) {
      return printFailure(
        argumentFailure('DV_METADATA_SNAPSHOT_OPTION_SET_REQUIRED', 'Usage: dv metadata snapshot option-set <name> --environment <alias>')
      );
    }

    snapshot = await resolution.data.client.snapshotOptionSetMetadata(name);
  } else if (domain === 'relationship') {
    const schemaName = positional[2];

    if (!schemaName) {
      return printFailure(
        argumentFailure(
          'DV_METADATA_SNAPSHOT_RELATIONSHIP_REQUIRED',
          'Usage: dv metadata snapshot relationship <schemaName> --environment <alias>'
        )
      );
    }

    const kind = readRelationshipKind(args);

    if (!kind.success || !kind.data) {
      return printFailure(kind);
    }

    snapshot = await resolution.data.client.snapshotRelationshipMetadata(schemaName, kind.data);
  } else {
    return printFailure(
      argumentFailure(
        'DV_METADATA_SNAPSHOT_DOMAIN_INVALID',
        `Unsupported snapshot domain ${domain}. Use table, columns, option-set, or relationship.`
      )
    );
  }

  if (!snapshot.success || !snapshot.data) {
    return printFailure(snapshot);
  }

  const outPath = readFlag(args, '--out');

  if (outPath) {
    await writeJsonFile(outPath, snapshot.data as never);
  }

  printWarnings(snapshot);
  printByFormat(snapshot.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataDiff(args: string[]): Promise<number> {
  const leftPath = readFlag(args, '--left');
  const rightPath = readFlag(args, '--right');

  if (!leftPath || !rightPath) {
    return printFailure(argumentFailure('DV_METADATA_DIFF_ARGS_REQUIRED', 'Usage: dv metadata diff --left FILE --right FILE'));
  }

  const [leftSnapshot, rightSnapshot] = await Promise.all([
    readJsonFile<DataverseMetadataSnapshot>(leftPath),
    readJsonFile<DataverseMetadataSnapshot>(rightPath),
  ]);
  const result = diffDataverseMetadataSnapshots(leftSnapshot, rightSnapshot);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataApply(args: string[]): Promise<number> {
  const plan = await readMetadataApplyPlanArgument(args);

  if (!plan.success || !plan.data) {
    return printFailure(plan);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const orderedPlan = orderMetadataApplyPlanForCli(plan.data);

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.apply', { solution: writeOptions.data?.solutionUniqueName }, orderedPlan);

  if (preview !== undefined) {
    return preview;
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await resolution.data.client.applyMetadataPlan(orderedPlan, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateTable(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_TABLE_FILE_REQUIRED',
    'Usage: dv metadata create-table --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseTableCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-table', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createTable(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataUpdateTable(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];

  if (!tableLogicalName) {
    return printFailure(
      argumentFailure('DV_METADATA_UPDATE_TABLE_REQUIRED', 'Usage: dv metadata update-table <tableLogicalName> --file FILE --environment <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_TABLE_FILE_REQUIRED',
    'Usage: dv metadata update-table <tableLogicalName> --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseTableUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'dv.metadata.update-table',
    { tableLogicalName, solution: writeOptions.data?.solutionUniqueName },
    spec.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateTable(tableLogicalName, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataAddColumn(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];

  if (!tableLogicalName) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_ADD_COLUMN_TABLE_REQUIRED',
        'Usage: dv metadata add-column <tableLogicalName> --file FILE --environment <alias>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_ADD_COLUMN_FILE_REQUIRED',
    'Usage: dv metadata add-column <tableLogicalName> --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseColumnCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.add-column', { tableLogicalName, solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createColumn(tableLogicalName, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataUpdateColumn(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const tableLogicalName = positional[1];
  const columnLogicalName = positional[2];

  if (!tableLogicalName || !columnLogicalName) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_UPDATE_COLUMN_REQUIRED',
        'Usage: dv metadata update-column <tableLogicalName> <columnLogicalName> --file FILE --environment <alias>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_COLUMN_FILE_REQUIRED',
    'Usage: dv metadata update-column <tableLogicalName> <columnLogicalName> --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseColumnUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'dv.metadata.update-column',
    { tableLogicalName, columnLogicalName, solution: writeOptions.data?.solutionUniqueName },
    spec.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateColumn(tableLogicalName, columnLogicalName, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateOptionSet(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_OPTION_SET_FILE_REQUIRED',
    'Usage: dv metadata create-option-set --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseGlobalOptionSetCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-option-set', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createGlobalOptionSet(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataUpdateOptionSet(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_OPTION_SET_FILE_REQUIRED',
    'Usage: dv metadata update-option-set --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseGlobalOptionSetUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.update-option-set', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateGlobalOptionSet(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_RELATIONSHIP_FILE_REQUIRED',
    'Usage: dv metadata create-relationship --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseOneToManyRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-relationship', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createOneToManyRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataUpdateRelationship(args: string[]): Promise<number> {
  const positional = positionalArgs(args);
  const schemaName = positional[1];

  if (!schemaName) {
    return printFailure(
      argumentFailure(
        'DV_METADATA_UPDATE_RELATIONSHIP_REQUIRED',
        'Usage: dv metadata update-relationship <schemaName> --kind one-to-many|many-to-many --file FILE --environment <alias>'
      )
    );
  }

  const kind = readRelationshipKind(args);

  if (!kind.success || !kind.data) {
    return printFailure(kind);
  }

  if (kind.data === 'auto') {
    return printFailure(
      argumentFailure(
        'DV_METADATA_UPDATE_RELATIONSHIP_KIND_REQUIRED',
        'dv metadata update-relationship requires --kind one-to-many or --kind many-to-many.'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_UPDATE_RELATIONSHIP_FILE_REQUIRED',
    'Usage: dv metadata update-relationship <schemaName> --kind one-to-many|many-to-many --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec =
    kind.data === 'one-to-many' ? parseOneToManyRelationshipUpdateSpec(specInput.data) : parseManyToManyRelationshipUpdateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'dv.metadata.update-relationship',
    { schemaName, relationshipKind: kind.data, solution: writeOptions.data?.solutionUniqueName },
    spec.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.updateRelationship(schemaName, kind.data, spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateManyToManyRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_MANY_TO_MANY_FILE_REQUIRED',
    'Usage: dv metadata create-many-to-many --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseManyToManyRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-many-to-many', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createManyToManyRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runDataverseMetadataCreateCustomerRelationship(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const specInput = await readStructuredSpecArgument(
    args,
    '--file',
    'DV_METADATA_CREATE_CUSTOMER_RELATIONSHIP_FILE_REQUIRED',
    'Usage: dv metadata create-customer-relationship --file FILE --environment <alias>'
  );

  if (!specInput.success || specInput.data === undefined) {
    return printFailure(specInput);
  }

  const spec = parseCustomerRelationshipCreateSpec(specInput.data);

  if (!spec.success || !spec.data) {
    return printFailure(spec);
  }

  const writeOptions = readMetadataCreateOptions(args);

  if (!writeOptions.success || !writeOptions.data) {
    return printFailure(writeOptions);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'dv.metadata.create-customer-relationship', { solution: writeOptions.data?.solutionUniqueName }, spec.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await resolution.data.client.createCustomerRelationship(spec.data, writeOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionList(args: string[]): Promise<number> {
  return runSolutionListCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionCreate(args: string[]): Promise<number> {
  return runSolutionCreateCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionDelete(args: string[]): Promise<number> {
  return runSolutionDeleteCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionInspect(args: string[]): Promise<number> {
  return runSolutionInspectCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionSetMetadata(args: string[]): Promise<number> {
  return runSolutionSetMetadataCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionComponents(args: string[]): Promise<number> {
  return runSolutionComponentsCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionDependencies(args: string[]): Promise<number> {
  return runSolutionDependenciesCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionAnalyze(args: string[]): Promise<number> {
  return runSolutionAnalyzeCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionCompare(args: string[]): Promise<number> {
  return runSolutionCompareCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    resolveDataverseClientByFlag,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionExport(args: string[]): Promise<number> {
  return runSolutionExportCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionImport(args: string[]): Promise<number> {
  return runSolutionImportCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionPack(args: string[]): Promise<number> {
  return runSolutionPackCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runSolutionUnpack(args: string[]): Promise<number> {
  return runSolutionUnpackCommand(args, {
    positionalArgs,
    readFlag,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    maybeHandleMutationPreview,
    resolveDataverseClientForCli,
    readSolutionOutputTarget,
    readSolutionPackageTypeFlag,
    createLocalSolutionService,
    argumentFailure,
  });
}

async function runConnectionReferenceList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new ConnectionReferenceService(resolution.data.client);
  const result = await service.list({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runConnectionReferenceInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('CONNREF_IDENTIFIER_REQUIRED', 'Usage: connref inspect <logicalName|displayName|id> --environment <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new ConnectionReferenceService(resolution.data.client);
  const result = await service.inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'CONNREF_NOT_FOUND', `Connection reference ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runConnectionReferenceValidate(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new ConnectionReferenceService(resolution.data.client);
  const result = await service.validate({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentVariableList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new EnvironmentVariableService(resolution.data.client);
  const result = await service.list({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentVariableCreate(args: string[]): Promise<number> {
  const schemaName = positionalArgs(args)[0];

  if (!schemaName) {
    return printFailure(
      argumentFailure(
        'ENVVAR_SCHEMA_REQUIRED',
        'Usage: envvar create <schemaName> --environment <alias> [--display-name NAME] [--default-value VALUE] [--type string|number|boolean|json|data-source|secret]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new EnvironmentVariableService(resolution.data.client);
  const displayName = readFlag(args, '--display-name');
  const defaultValue = readFlag(args, '--default-value');
  const type = readFlag(args, '--type');
  const valueSchema = readFlag(args, '--value-schema');
  const secretStore = parseEnvironmentVariableSecretStore(readFlag(args, '--secret-store'));

  if (!secretStore.success) {
    return printFailure(secretStore.result);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'envvar.create',
    { schemaName, solution: readFlag(args, '--solution') },
    {
      displayName: displayName ?? schemaName,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(valueSchema !== undefined ? { valueSchema } : {}),
      ...(secretStore.value !== undefined ? { secretStore: secretStore.value } : {}),
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await service.createDefinition(schemaName, {
    displayName,
    defaultValue,
    type,
    valueSchema,
    secretStore: secretStore.value,
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentVariableInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('ENVVAR_IDENTIFIER_REQUIRED', 'Usage: envvar inspect <schemaName|displayName|id> --environment <alias>')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new EnvironmentVariableService(resolution.data.client);
  const result = await service.inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'ENVVAR_NOT_FOUND', `Environment variable ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

function parseEnvironmentVariableSecretStore(
  value: string | undefined
): { success: true; value: number | undefined } | { success: false; result: OperationResult<never> } {
  if (value === undefined) {
    return {
      success: true,
      value: undefined,
    };
  }

  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-');

  switch (normalized) {
    case 'dataverse':
    case '0':
      return { success: true, value: 0 };
    case 'azure-key-vault':
    case 'key-vault':
    case '1':
      return { success: true, value: 1 };
    default:
      return {
        success: false,
        result: fail(
          createDiagnostic(
            'error',
            'ENVVAR_SECRET_STORE_INVALID',
            `Unsupported secret store ${value}. Use dataverse or azure-key-vault.`,
            {
              source: '@pp/cli',
            }
          )
        ),
      };
  }
}

async function runEnvironmentVariableSet(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const value = readFlag(args, '--value');

  if (!identifier || value === undefined) {
    return printFailure(
      argumentFailure('ENVVAR_SET_ARGS_REQUIRED', 'Usage: envvar set <schemaName|displayName|id> --environment <alias> --value VALUE')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'envvar.set', { identifier, solution: readFlag(args, '--solution') }, { value });

  if (preview !== undefined) {
    return preview;
  }

  const service = new EnvironmentVariableService(resolution.data.client);
  const result = await service.setValue(identifier, value, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runCanvasValidate(args: string[]): Promise<number> {
  const canvasPath = positionalArgs(args)[0];

  if (!canvasPath) {
    return printFailure(argumentFailure('CANVAS_PATH_REQUIRED', 'Usage: canvas validate <path|workspaceApp> [--workspace FILE] [--mode strict|seeded|registry]'));
  }

  const context = await resolveCanvasCliContext(args, canvasPath);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const result = await new CanvasService().validate(context.data.path, context.data.options);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return result.data.valid ? 0 : 1;
}

async function runCanvasLint(args: string[]): Promise<number> {
  const canvasPath = positionalArgs(args)[0];

  if (!canvasPath) {
    return printFailure(argumentFailure('CANVAS_PATH_REQUIRED', 'Usage: canvas lint <path|workspaceApp> [--workspace FILE] [--mode strict|seeded|registry]'));
  }

  const context = await resolveCanvasCliContext(args, canvasPath);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const result = await new CanvasService().lint(context.data.path, context.data.options);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return result.data.valid ? 0 : 1;
}

async function runCanvasInspect(args: string[]): Promise<number> {
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

    const result = await new CanvasService(resolution.data.client).inspectRemote(identifier, {
      solutionUniqueName: readFlag(args, '--solution'),
    });

    if (!result.success) {
      return printFailure(result);
    }

    if (!result.data) {
      return printFailure(fail(createDiagnostic('error', 'CANVAS_REMOTE_NOT_FOUND', `Canvas app ${identifier} was not found.`)));
    }

    printByFormat(result.data, outputFormat(args, 'json'));
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

async function runCanvasList(args: string[]): Promise<number> {
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
  return 0;
}

async function runCanvasDownload(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure(
        'CANVAS_DOWNLOAD_ARG_REQUIRED',
        'Usage: canvas download <displayName|name|id> --environment ALIAS --solution UNIQUE_NAME [--out FILE]'
      )
    );
  }

  const solutionUniqueName = readFlag(args, '--solution');

  if (!solutionUniqueName) {
    return printFailure(argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', '--solution UNIQUE_NAME is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new CanvasService(resolution.data.client).downloadRemote(identifier, {
    solutionUniqueName,
    outPath: readFlag(args, '--out'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runCanvasBuild(args: string[]): Promise<number> {
  const canvasPath = positionalArgs(args)[0];

  if (!canvasPath) {
    return printFailure(argumentFailure('CANVAS_PATH_REQUIRED', 'Usage: canvas build <path|workspaceApp> [--workspace FILE] [--out FILE] [--mode strict|seeded|registry]'));
  }

  const context = await resolveCanvasCliContext(args, canvasPath);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  const outPath = readFlag(args, '--out');
  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'canvas.build',
    {
      path: canvasPath,
      mode: context.data.options.mode,
      outPath: outPath ?? 'auto',
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new CanvasService().build(context.data.path, {
    ...context.data.options,
    outPath,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runCanvasDiff(args: string[]): Promise<number> {
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

async function runCanvasTemplateImport(args: string[]): Promise<number> {
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

async function runCanvasTemplateInspect(args: string[]): Promise<number> {
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

async function runCanvasTemplateDiff(args: string[]): Promise<number> {
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

async function runCanvasTemplatePin(args: string[]): Promise<number> {
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

async function runCanvasTemplateRefresh(args: string[]): Promise<number> {
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

async function runCanvasTemplateAudit(args: string[]): Promise<number> {
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

async function runCanvasWorkspaceInspect(args: string[]): Promise<number> {
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

async function runCanvasPatchPlan(args: string[]): Promise<number> {
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

async function runCanvasPatchApply(args: string[]): Promise<number> {
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

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'canvas.patch',
    {
      path: context.data.path,
      patchFile,
      outPath: readFlag(args, '--out') ?? 'in-place',
    },
    patch.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new CanvasService().applyPatch(context.data.path, patch.data as never, readFlag(args, '--out'));

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runFlowList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new FlowService(resolution.data.client).list({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runFlowInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow inspect <name|id|uniqueName|path> [--environment ALIAS]'));
  }

  if (readEnvironmentAlias(args)) {
    const resolution = await resolveDataverseClientForCli(args);

    if (!resolution.success || !resolution.data) {
      return printFailure(resolution);
    }

    const result = await new FlowService(resolution.data.client).inspect(identifier, {
      solutionUniqueName: readFlag(args, '--solution'),
    });

    if (!result.success) {
      return printFailure(result);
    }

    if (!result.data) {
      return printFailure(fail(createDiagnostic('error', 'FLOW_NOT_FOUND', `Flow ${identifier} was not found.`)));
    }

    printByFormat(result.data, outputFormat(args, 'json'));
    return 0;
  }

  const result = await new FlowService().inspectArtifact(identifier);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runFlowUnpack(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];
  const outPath = readFlag(args, '--out');

  if (!inputPath || !outPath) {
    return printFailure(argumentFailure('FLOW_UNPACK_ARGS_REQUIRED', 'Usage: flow unpack <path> --out <dir>'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'flow.unpack', { inputPath, outPath });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService().unpack(inputPath, outPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runFlowExport(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const outPath = readFlag(args, '--out');

  if (!identifier || !outPath) {
    return printFailure(
      argumentFailure('FLOW_EXPORT_ARGS_REQUIRED', 'Usage: flow export <name|id|uniqueName> --environment ALIAS --out PATH [--solution UNIQUE_NAME]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'flow.export',
    {
      identifier,
      environment: resolution.data.environment.alias,
      solution: readFlag(args, '--solution'),
      outPath,
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService(resolution.data.client).exportArtifact(identifier, outPath, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runFlowPromote(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure(
        'FLOW_PROMOTE_ARGS_REQUIRED',
        'Usage: flow promote <name|id|uniqueName> --source-environment ALIAS --target-environment ALIAS [--source-solution UNIQUE_NAME] [--target-solution UNIQUE_NAME] [--target <name|id|uniqueName>] [--create-if-missing] [--workflow-state draft|activated|suspended] [--solution-package] [--managed-solution-package] [--overwrite-unmanaged-customizations] [--holding-solution] [--skip-product-update-dependencies] [--no-publish-workflows] [--import-job-id GUID]'
      )
    );
  }

  const sourceResolution = await resolveDataverseClientByFlag(args, '--source-environment');

  if (!sourceResolution.success || !sourceResolution.data) {
    return printFailure(sourceResolution);
  }

  const targetResolution = await resolveDataverseClientByFlag(args, '--target-environment');

  if (!targetResolution.success || !targetResolution.data) {
    return printFailure(targetResolution);
  }

  const workflowState = readFlowWorkflowStateFlag(args);

  if (!workflowState.success) {
    return printFailure(workflowState);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'flow.promote',
    {
      identifier,
      sourceEnvironment: sourceResolution.data.environment.alias,
      sourceSolution: readFlag(args, '--source-solution'),
      targetEnvironment: targetResolution.data.environment.alias,
      targetSolution: readFlag(args, '--target-solution'),
      target: readFlag(args, '--target') ?? 'source artifact metadata',
      createIfMissing: hasFlag(args, '--create-if-missing'),
      workflowState: workflowState.data ?? 'source artifact metadata',
      solutionPackage: hasFlag(args, '--solution-package'),
      solutionPackageManaged: hasFlag(args, '--managed-solution-package'),
      publishWorkflows: !hasFlag(args, '--no-publish-workflows'),
      overwriteUnmanagedCustomizations: hasFlag(args, '--overwrite-unmanaged-customizations'),
      holdingSolution: hasFlag(args, '--holding-solution'),
      skipProductUpdateDependencies: hasFlag(args, '--skip-product-update-dependencies'),
      importJobId: readFlag(args, '--import-job-id'),
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService(sourceResolution.data.client).promoteArtifact(identifier, {
    sourceSolutionUniqueName: readFlag(args, '--source-solution'),
    targetSolutionUniqueName: readFlag(args, '--target-solution'),
    target: readFlag(args, '--target'),
    createIfMissing: hasFlag(args, '--create-if-missing'),
    workflowState: workflowState.data,
    solutionPackage: hasFlag(args, '--solution-package'),
    solutionPackageManaged: hasFlag(args, '--managed-solution-package'),
    publishWorkflows: hasFlag(args, '--no-publish-workflows') ? false : undefined,
    overwriteUnmanagedCustomizations: hasFlag(args, '--overwrite-unmanaged-customizations') ? true : undefined,
    holdingSolution: hasFlag(args, '--holding-solution') ? true : undefined,
    skipProductUpdateDependencies: hasFlag(args, '--skip-product-update-dependencies') ? true : undefined,
    importJobId: readFlag(args, '--import-job-id'),
    targetDataverseClient: targetResolution.data.client,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runFlowPack(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];
  const outPath = readFlag(args, '--out');

  if (!inputPath || !outPath) {
    return printFailure(argumentFailure('FLOW_PACK_ARGS_REQUIRED', 'Usage: flow pack <path> --out <file.json>'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'flow.pack', { inputPath, outPath });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService().pack(inputPath, outPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runFlowDeploy(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    return printFailure(
      argumentFailure(
        'FLOW_DEPLOY_ARGS_REQUIRED',
        'Usage: flow deploy <path> --environment ALIAS [--solution UNIQUE_NAME] [--target <name|id|uniqueName>] [--create-if-missing] [--workflow-state draft|activated|suspended]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const workflowState = readFlowWorkflowStateFlag(args);

  if (!workflowState.success) {
    return printFailure(workflowState);
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'flow.deploy',
    {
      inputPath,
      environment: resolution.data.environment.alias,
      solution: readFlag(args, '--solution'),
      target: readFlag(args, '--target') ?? 'artifact metadata',
      createIfMissing: hasFlag(args, '--create-if-missing'),
      workflowState: workflowState.data ?? 'artifact metadata',
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService(resolution.data.client).deployArtifact(inputPath, {
    solutionUniqueName: readFlag(args, '--solution'),
    target: readFlag(args, '--target'),
    createIfMissing: hasFlag(args, '--create-if-missing'),
    workflowState: workflowState.data,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runFlowNormalize(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    return printFailure(argumentFailure('FLOW_NORMALIZE_PATH_REQUIRED', 'Usage: flow normalize <path> [--out PATH]'));
  }

  const outPath = readFlag(args, '--out');
  const preview = maybeHandleMutationPreview(args, 'json', 'flow.normalize', {
    inputPath,
    outPath: outPath ?? 'in-place',
  });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService().normalize(inputPath, outPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runFlowValidate(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    return printFailure(argumentFailure('FLOW_VALIDATE_PATH_REQUIRED', 'Usage: flow validate <path>'));
  }

  const result = await new FlowService().validate(inputPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return result.data.valid ? 0 : 1;
}

async function runFlowGraph(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];

  if (!inputPath) {
    return printFailure(argumentFailure('FLOW_GRAPH_PATH_REQUIRED', 'Usage: flow graph <path>'));
  }

  const result = await new FlowService().graphArtifact(inputPath);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runFlowPatch(args: string[]): Promise<number> {
  const inputPath = positionalArgs(args)[0];
  const patchFile = readFlag(args, '--file');

  if (!inputPath || !patchFile) {
    return printFailure(argumentFailure('FLOW_PATCH_ARGS_REQUIRED', 'Usage: flow patch <path> --file PATCH.json [--out PATH]'));
  }

  const patch = await readJsonFileForCli(patchFile, 'FLOW_PATCH_FILE_INVALID', '--file must point to a JSON patch document.');

  if (!patch.success || patch.data === undefined) {
    return printFailure(patch);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'flow.patch', { inputPath, patchFile, outPath: readFlag(args, '--out') ?? 'in-place' }, patch.data);

  if (preview !== undefined) {
    return preview;
  }

  const result = await new FlowService().patch(inputPath, patch.data as FlowPatchDocument, readFlag(args, '--out'));

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runFlowRuns(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow runs <name|id|uniqueName> --environment ALIAS [--status STATUS] [--since 7d]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new FlowService(resolution.data.client).runs(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    status: readFlag(args, '--status'),
    since: readFlag(args, '--since'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runFlowErrors(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure(
        'FLOW_IDENTIFIER_REQUIRED',
        'Usage: flow errors <name|id|uniqueName> --environment ALIAS [--group-by errorCode|errorMessage|connectionReference]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const groupBy = readFlag(args, '--group-by') as 'errorCode' | 'errorMessage' | 'connectionReference' | undefined;

  if (groupBy && !['errorCode', 'errorMessage', 'connectionReference'].includes(groupBy)) {
    return printFailure(argumentFailure('FLOW_GROUP_BY_INVALID', 'Use --group-by errorCode, errorMessage, or connectionReference.'));
  }

  const result = await new FlowService(resolution.data.client).errors(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    since: readFlag(args, '--since'),
    status: readFlag(args, '--status'),
    groupBy,
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runFlowConnrefs(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow connrefs <name|id|uniqueName> --environment ALIAS [--since 7d]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new FlowService(resolution.data.client).connrefs(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    since: readFlag(args, '--since'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'FLOW_NOT_FOUND', `Flow ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runFlowDoctor(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(
      argumentFailure('FLOW_IDENTIFIER_REQUIRED', 'Usage: flow doctor <name|id|uniqueName> --environment ALIAS [--since 7d]')
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new FlowService(resolution.data.client).doctor(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
    since: readFlag(args, '--since'),
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runModelList(args: string[]): Promise<number> {
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).list({
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runModelCreate(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];
  const environmentAlias = readFlag(args, '--environment');
  const configOptions = readConfigOptions(args);

  if (!uniqueName) {
    return printFailure(
      argumentFailure(
        'MODEL_UNIQUENAME_REQUIRED',
        'Usage: model create <uniqueName> --environment ALIAS [--name DISPLAY_NAME] [--solution UNIQUE_NAME]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const displayName = readFlag(args, '--name');
  const explicitSolutionUniqueName = readFlag(args, '--solution');
  const defaultSolutionUniqueName =
    !explicitSolutionUniqueName && environmentAlias ? await readEnvironmentDefaultSolution(environmentAlias, configOptions) : undefined;
  const solutionUniqueName = explicitSolutionUniqueName ?? defaultSolutionUniqueName;
  const preview = maybeHandleMutationPreview(args, 'json', 'model.create', {
    uniqueName,
    environment: resolution.data.environment.alias,
    solution: solutionUniqueName,
  }, {
    name: displayName ?? uniqueName,
  });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new ModelService(resolution.data.client).create(uniqueName, {
    name: displayName,
    solutionUniqueName: solutionUniqueName,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runModelAttach(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const environmentAlias = readFlag(args, '--environment');
  const configOptions = readConfigOptions(args);
  const explicitSolutionUniqueName = readFlag(args, '--solution');
  const defaultSolutionUniqueName =
    !explicitSolutionUniqueName && environmentAlias ? await readEnvironmentDefaultSolution(environmentAlias, configOptions) : undefined;
  const solutionUniqueName = explicitSolutionUniqueName ?? defaultSolutionUniqueName;

  if (!identifier || !solutionUniqueName) {
    return printFailure(
      argumentFailure(
        'MODEL_ATTACH_ARGS_REQUIRED',
        'Usage: model attach <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const addRequiredComponents = hasFlag(args, '--no-add-required-components') ? false : true;
  const preview = maybeHandleMutationPreview(args, 'json', 'model.attach', {
    identifier,
    environment: resolution.data.environment.alias,
    solution: solutionUniqueName,
  }, {
    addRequiredComponents,
  });

  if (preview !== undefined) {
    return preview;
  }

  const result = await new ModelService(resolution.data.client).attach(identifier, {
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

async function runModelInspect(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model inspect <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).inspect(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runModelSitemap(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model sitemap <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).sitemap(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runModelForms(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model forms <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).forms(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runModelViews(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model views <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).views(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runModelDependencies(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model dependencies <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).dependencies(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runModelComposition(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];

  if (!identifier) {
    return printFailure(argumentFailure('MODEL_IDENTIFIER_REQUIRED', 'Usage: model composition <name|id|uniqueName> --environment ALIAS'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).composition(identifier, {
    solutionUniqueName: readFlag(args, '--solution'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'MODEL_NOT_FOUND', `Model-driven app ${identifier} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runModelImpact(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const targetKind = readModelTargetKind(args);
  const targetIdentifier = readFlag(args, '--target');

  if (!identifier || !targetKind || !targetIdentifier) {
    return printFailure(
      argumentFailure(
        'MODEL_IMPACT_ARGS_REQUIRED',
        'Usage: model impact <name|id|uniqueName> --environment ALIAS --kind app|form|view|sitemap --target <name|id>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).impact(
    identifier,
    {
      kind: targetKind,
      identifier: targetIdentifier,
    },
    {
      solutionUniqueName: readFlag(args, '--solution'),
    }
  );

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(
      fail(createDiagnostic('error', 'MODEL_IMPACT_TARGET_NOT_FOUND', `Target ${targetKind}:${targetIdentifier} was not found in ${identifier}.`))
    );
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runModelPatch(args: string[]): Promise<number> {
  const [command, ...rest] = args;

  switch (command) {
    case 'plan':
      return runModelPatchPlan(rest);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

async function runModelPatchPlan(args: string[]): Promise<number> {
  const identifier = positionalArgs(args)[0];
  const targetKind = readModelTargetKind(args);
  const targetIdentifier = readFlag(args, '--target');
  const rename = readFlag(args, '--rename');

  if (!identifier || !targetKind || !targetIdentifier || !rename) {
    return printFailure(
      argumentFailure(
        'MODEL_PATCH_PLAN_ARGS_REQUIRED',
        'Usage: model patch plan <name|id|uniqueName> --environment ALIAS --kind app|form|view|sitemap --target <name|id> --rename <newName>'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const result = await new ModelService(resolution.data.client).planMutation(
    identifier,
    {
      operation: 'rename',
      target: {
        kind: targetKind,
        identifier: targetIdentifier,
      },
      value: {
        name: rename,
      },
    },
    {
      solutionUniqueName: readFlag(args, '--solution'),
    }
  );

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return result.data.valid ? 0 : 1;
}

function readModelTargetKind(args: string[]): ModelArtifactMutationKind | undefined {
  const kind = readFlag(args, '--kind');

  if (kind === 'app' || kind === 'form' || kind === 'view' || kind === 'sitemap') {
    return kind;
  }

  return undefined;
}

async function resolveDataverseClientForCli(args: string[]) {
  return resolveDataverseClientByFlag(args, '--environment');
}

async function resolveDataverseClientByFlag(args: string[], flag: string) {
  const environmentAlias = readFlag(args, flag);

  if (!environmentAlias) {
    return argumentFailure('DV_ENV_REQUIRED', `${flag} <alias> is required.`);
  }

  return resolveDataverseClient(environmentAlias, {
    ...readConfigOptions(args),
    publicClientLoginOptions: readPublicClientLoginOptions(args),
  });
}

async function resolveCanvasCliContext(args: string[], canvasTarget?: string): Promise<OperationResult<CanvasCliContext>> {
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return discoveryOptions as unknown as OperationResult<CanvasCliContext>;
  }

  const explicitProjectPath = readFlag(args, '--project');
  const workspacePath = readFlag(args, '--workspace');
  const resolvedCanvasTarget = canvasTarget ? resolvePath(canvasTarget) : undefined;
  const preferCanvasTargetProjectRoot =
    !explicitProjectPath && !workspacePath && resolvedCanvasTarget ? await pathExists(resolvedCanvasTarget) : false;
  const projectPath = explicitProjectPath ?? (preferCanvasTargetProjectRoot ? resolvedCanvasTarget! : process.cwd());
  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return project as unknown as OperationResult<CanvasCliContext>;
  }

  const mode = readCanvasBuildMode(readFlag(args, '--mode') ?? readProjectCanvasBuildMode(project.data.build) ?? 'strict');

  if (!mode) {
    return argumentFailure('CANVAS_MODE_INVALID', 'Use --mode strict, seeded, or registry.');
  }

  const registries = readRepeatedFlags(args, '--registry');
  let path = canvasTarget ? resolvePath(canvasTarget) : resolvePath(projectPath);
  let resolvedRegistries = registries.length > 0 ? registries : project.data.templateRegistries;
  let diagnostics = project.diagnostics;
  let warnings = project.warnings;

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
        root: project.data.root,
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

function readProjectCanvasBuildMode(build: Record<string, unknown>): string | undefined {
  const canvas = build.canvas;

  if (typeof canvas !== 'object' || canvas === null || Array.isArray(canvas)) {
    return undefined;
  }

  return typeof (canvas as Record<string, unknown>).mode === 'string'
    ? ((canvas as Record<string, unknown>).mode as string)
    : undefined;
}

async function runSharePointSiteInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(argumentFailure('SHAREPOINT_SITE_REQUIRED', 'Usage: sharepoint site inspect <site|binding> [--project path] [--profile name]'));
  }

  const targetResult = await resolveSharePointTargetForCli(reference, args, {
    expectedKind: 'sharepoint-site',
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createSharePointClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectSite(targetResult.data.site.value);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      site: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runSharePointListInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure('SHAREPOINT_LIST_REQUIRED', 'Usage: sharepoint list inspect <list|binding> --site <site|binding> [--project path] [--profile name]')
    );
  }

  const targetResult = await resolveSharePointTargetForCli(reference, args, {
    expectedKind: 'sharepoint-list',
    site: readFlag(args, '--site'),
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createSharePointClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectList(targetResult.data.site.value, targetResult.data.list?.value ?? reference);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      list: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runSharePointFileInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure(
        'SHAREPOINT_FILE_REQUIRED',
        'Usage: sharepoint file inspect <file|binding> --site <site|binding> [--drive name] [--project path] [--profile name]'
      )
    );
  }

  const targetResult = await resolveSharePointTargetForCli(reference, args, {
    expectedKind: 'sharepoint-file',
    site: readFlag(args, '--site'),
    drive: readFlag(args, '--drive'),
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createSharePointClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectDriveItem(targetResult.data.site.value, targetResult.data.file?.value ?? reference, {
    drive: targetResult.data.drive?.value,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      file: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runSharePointPermissionsInspect(args: string[]): Promise<number> {
  const siteReference = readFlag(args, '--site');

  if (!siteReference) {
    return printFailure(
      argumentFailure(
        'SHAREPOINT_SITE_REQUIRED',
        'Usage: sharepoint permissions inspect --site <site|binding> [--list name|binding] [--file path|binding] [--drive name]'
      )
    );
  }

  const listReference = readFlag(args, '--list');
  const fileReference = readFlag(args, '--file');
  const driveReference = readFlag(args, '--drive');
  const resolutionKind = fileReference ? 'sharepoint-file' : listReference ? 'sharepoint-list' : 'sharepoint-site';

  const targetResult =
    resolutionKind === 'sharepoint-file'
      ? await resolveSharePointTargetForCli(fileReference as string, args, {
          expectedKind: 'sharepoint-file',
          site: siteReference,
          drive: driveReference,
        })
      : resolutionKind === 'sharepoint-list'
        ? await resolveSharePointTargetForCli(listReference as string, args, {
            expectedKind: 'sharepoint-list',
            site: siteReference,
          })
        : await resolveSharePointTargetForCli(siteReference, args, {
            expectedKind: 'sharepoint-site',
          });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createSharePointClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectPermissions(targetResult.data.site.value, {
    list: targetResult.data.list?.value,
    drive: targetResult.data.drive?.value,
    item: targetResult.data.file?.value,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      permissions: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runPowerBiWorkspaceInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure('POWERBI_WORKSPACE_REQUIRED', 'Usage: powerbi workspace inspect <workspace|binding> [--project path] [--profile name]')
    );
  }

  const targetResult = await resolvePowerBiTargetForCli(reference, args, {
    expectedKind: 'powerbi-workspace',
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createPowerBiClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectWorkspace(targetResult.data.workspace.value);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      workspace: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runPowerBiDatasetInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure(
        'POWERBI_DATASET_REQUIRED',
        'Usage: powerbi dataset inspect <dataset|binding> --workspace <workspace|binding> [--project path] [--profile name]'
      )
    );
  }

  const targetResult = await resolvePowerBiTargetForCli(reference, args, {
    expectedKind: 'powerbi-dataset',
    workspace: readFlag(args, '--workspace'),
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createPowerBiClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectDataset(targetResult.data.workspace.value, targetResult.data.dataset?.value ?? reference);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      dataset: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function runPowerBiReportInspect(args: string[]): Promise<number> {
  const reference = positionalArgs(args)[0];

  if (!reference) {
    return printFailure(
      argumentFailure(
        'POWERBI_REPORT_REQUIRED',
        'Usage: powerbi report inspect <report|binding> --workspace <workspace|binding> [--project path] [--profile name]'
      )
    );
  }

  const targetResult = await resolvePowerBiTargetForCli(reference, args, {
    expectedKind: 'powerbi-report',
    workspace: readFlag(args, '--workspace'),
  });

  if (!targetResult.success || !targetResult.data) {
    return printFailure(targetResult);
  }

  const clientResult = await createPowerBiClientForCli(targetResult.data, args);

  if (!clientResult.success || !clientResult.data) {
    return printFailure(clientResult);
  }

  const result = await clientResult.data.inspectReport(targetResult.data.workspace.value, targetResult.data.report?.value ?? reference);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(
    {
      target: targetResult.data,
      report: result.data,
    },
    outputFormat(args, 'json')
  );
  printResultDiagnostics(result, outputFormat(args, 'json'));
  return 0;
}

async function resolveSharePointTargetForCli(
  reference: string,
  args: string[],
  options: {
    expectedKind: 'sharepoint-site' | 'sharepoint-list' | 'sharepoint-file';
    site?: string;
    drive?: string;
  }
): Promise<OperationResult<ResolvedSharePointTarget>> {
  const projectContext = await resolveProviderBindingContext(args);

  if (!projectContext.success || !projectContext.data) {
    return projectContext as unknown as OperationResult<ResolvedSharePointTarget>;
  }

  return resolveSharePointTarget(projectContext.data, reference, options);
}

async function resolvePowerBiTargetForCli(
  reference: string,
  args: string[],
  options: {
    expectedKind: 'powerbi-workspace' | 'powerbi-dataset' | 'powerbi-report';
    workspace?: string;
  }
): Promise<OperationResult<ResolvedPowerBiTarget>> {
  const projectContext = await resolveProviderBindingContext(args);

  if (!projectContext.success || !projectContext.data) {
    return projectContext as unknown as OperationResult<ResolvedPowerBiTarget>;
  }

  return resolvePowerBiTarget(projectContext.data, reference, options);
}

async function resolveProviderBindingContext(args: string[]): Promise<OperationResult<ProviderBindingResolverContext>> {
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return discoveryOptions as unknown as OperationResult<ProviderBindingResolverContext>;
  }

  const projectPath = readFlag(args, '--project') ?? resolveDefaultInvocationPath();
  const projectResult = await discoverProject(projectPath, discoveryOptions.data);

  if (!projectResult.success || !projectResult.data) {
    return projectResult as unknown as OperationResult<ProviderBindingResolverContext>;
  }

  return ok(
    {
      providerBindings: projectResult.data.providerBindings,
    },
    {
      supportTier: projectResult.supportTier,
      diagnostics: projectResult.diagnostics,
      warnings: projectResult.warnings,
    }
  );
}

async function createSharePointClientForCli(
  target: ResolvedSharePointTarget,
  args: string[]
): Promise<OperationResult<SharePointClient>> {
  const authProfileName = readFlag(args, '--profile') ?? target.authProfile;

  if (!authProfileName) {
    return argumentFailure(
      'AUTH_PROFILE_REQUIRED',
      'SharePoint inspection requires an auth profile. Provide `--profile NAME` or set `metadata.authProfile` on the provider binding.'
    );
  }

  const httpClientResult = await createAuthenticatedHttpClientForCli('https://graph.microsoft.com', authProfileName, args);

  if (!httpClientResult.success || !httpClientResult.data) {
    return httpClientResult as unknown as OperationResult<SharePointClient>;
  }

  return ok(new SharePointClient(httpClientResult.data), {
    supportTier: httpClientResult.supportTier,
    diagnostics: httpClientResult.diagnostics,
    warnings: httpClientResult.warnings,
  });
}

async function createPowerBiClientForCli(
  target: ResolvedPowerBiTarget,
  args: string[]
): Promise<OperationResult<PowerBiClient>> {
  const authProfileName = readFlag(args, '--profile') ?? target.authProfile;

  if (!authProfileName) {
    return argumentFailure(
      'AUTH_PROFILE_REQUIRED',
      'Power BI inspection requires an auth profile. Provide `--profile NAME` or set `metadata.authProfile` on the provider binding.'
    );
  }

  const httpClientResult = await createAuthenticatedHttpClientForCli('https://api.powerbi.com', authProfileName, args);

  if (!httpClientResult.success || !httpClientResult.data) {
    return httpClientResult as unknown as OperationResult<PowerBiClient>;
  }

  return ok(new PowerBiClient(httpClientResult.data), {
    supportTier: httpClientResult.supportTier,
    diagnostics: httpClientResult.diagnostics,
    warnings: httpClientResult.warnings,
  });
}

async function createAuthenticatedHttpClientForCli(baseUrl: string, authProfileName: string, args: string[]): Promise<OperationResult<HttpClient>> {
  const auth = new AuthService(readConfigOptions(args));
  const profileResult = await auth.getProfile(authProfileName);

  if (!profileResult.success) {
    return profileResult as unknown as OperationResult<HttpClient>;
  }

  if (!profileResult.data) {
    return fail(
      createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${authProfileName} was not found.`, {
        source: '@pp/cli',
      })
    );
  }

  const tokenProviderResult = createTokenProvider(profileResult.data, readConfigOptions(args), readPublicClientLoginOptions(args));

  if (!tokenProviderResult.success || !tokenProviderResult.data) {
    return tokenProviderResult as unknown as OperationResult<HttpClient>;
  }

  return ok(
    new HttpClient({
      baseUrl,
      tokenProvider: tokenProviderResult.data,
    }),
    {
      supportTier: tokenProviderResult.supportTier,
      diagnostics: [...profileResult.diagnostics, ...tokenProviderResult.diagnostics],
      warnings: [...(profileResult.warnings ?? []), ...(tokenProviderResult.warnings ?? [])],
    }
  );
}

function printByFormat(value: unknown, format: OutputFormat): void {
  process.stdout.write(renderOutput(value, format));
}

function isMachineReadableOutputFormat(format: OutputFormat): boolean {
  return format === 'json' || format === 'yaml' || format === 'ndjson';
}

function printFailure(result: OperationResult<unknown>): number {
  process.stderr.write(renderFailure(result, resolveProcessOutputFormat()));

  return 1;
}

function printWarnings(result: OperationResult<unknown>): void {
  if ((result.warnings?.length ?? 0) === 0) {
    return;
  }

  const warningOnly: OperationResult<unknown> = {
    ...result,
    diagnostics: [],
  };
  const rendered = renderResultDiagnostics(warningOnly, resolveProcessOutputFormat());

  if (rendered.length > 0) {
    process.stderr.write(rendered);
  }
}

function printResultDiagnostics(result: OperationResult<unknown>, format: OutputFormat): void {
  const diagnostics = renderResultDiagnostics(result, format);

  if (diagnostics.length > 0) {
    process.stderr.write(diagnostics);
  }
}

function maybeHandleMutationPreview(
  args: string[],
  fallbackFormat: OutputFormat,
  action: string,
  target: Record<string, unknown>,
  input?: unknown
): number | undefined {
  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return printFailure(mutation);
  }

  if (mutation.data.mode === 'apply') {
    return undefined;
  }

  printByFormat(createMutationPreview(action, mutation.data, target, input), outputFormat(args, fallbackFormat));
  return 0;
}

function outputFormat(args: string[], fallback: OutputFormat): OutputFormat {
  return resolveOutputFormat(args, fallback);
}

function readEnvironmentAlias(args: string[]): string | undefined {
  return readFlag(args, '--environment');
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

function resolveProcessOutputFormat(): OutputFormat {
  return outputFormat(process.argv.slice(2), 'json');
}

function readConfigOptions(args: string[]): ConfigStoreOptions {
  const configDir = readFlag(args, '--config-dir');
  return configDir ? { configDir: resolveCliConfigDir(configDir) } : {};
}

function readPublicClientLoginOptions(args: string[]): { allowInteractive?: boolean } | undefined {
  if (hasFlag(args, '--no-interactive-auth')) {
    return {
      allowInteractive: false,
    };
  }

  return undefined;
}

function resolveCliConfigDir(configDir: string): string {
  if (isAbsolute(configDir)) {
    return configDir;
  }

  return resolvePath(resolveDefaultInvocationPath(), configDir);
}

function resolveInvocationPath(path?: string): string {
  if (!path) {
    return resolveDefaultInvocationPath();
  }

  if (isAbsolute(path)) {
    return path;
  }

  return resolvePath(resolveDefaultInvocationPath(), path);
}

function resolveDefaultInvocationPath(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

function readProjectDiscoveryOptions(args: string[]): OperationResult<{ stage?: string; parameterOverrides?: Record<string, string> }> {
  const parameterOverrides = readParameterOverrides(args);

  if (!parameterOverrides.success || !parameterOverrides.data) {
    return parameterOverrides;
  }

  return ok(
    {
      stage: readFlag(args, '--stage'),
      parameterOverrides: Object.keys(parameterOverrides.data).length > 0 ? parameterOverrides.data : undefined,
    },
    {
      supportTier: 'preview',
    }
  );
}

function readFlag(args: string[], name: string): string | undefined {
  for (const candidate of flagAliases(name)) {
    const index = args.indexOf(candidate);

    if (index !== -1) {
      return args[index + 1];
    }
  }

  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return flagAliases(name).some((candidate) => args.includes(candidate));
}

async function promptForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

function readRepeatedFlags(args: string[], name: string): string[] {
  const values: string[] = [];
  const aliases = new Set(flagAliases(name));

  for (let index = 0; index < args.length; index += 1) {
    if (aliases.has(args[index] ?? '') && args[index + 1]) {
      values.push(args[index + 1] as string);
      index += 1;
    }
  }

  return values;
}

function readAnalysisPortfolioProjectPaths(args: string[]): string[] {
  const configured = [...readRepeatedFlags(args, '--project'), ...positionalArgs(args)];
  return configured.length > 0 ? configured : [resolveDefaultInvocationPath()];
}

function flagAliases(name: string): string[] {
  switch (name) {
    case '--env':
    case '--environment':
      return ['--env', '--environment'];
    default:
      return [name];
  }
}

function readParameterOverrides(args: string[]): OperationResult<Record<string, string>> {
  const overrides: Record<string, string> = {};

  for (const value of readRepeatedFlags(args, '--param')) {
    const separatorIndex = value.indexOf('=');

    if (separatorIndex <= 0) {
      return argumentFailure('PROJECT_PARAM_OVERRIDE_INVALID', 'Use `--param NAME=VALUE` for project parameter overrides.');
    }

    overrides[value.slice(0, separatorIndex)] = value.slice(separatorIndex + 1);
  }

  return ok(overrides, {
    supportTier: 'preview',
  });
}

function readListFlag(args: string[], name: string): string[] | undefined {
  const value = readFlag(args, name);
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
}

function readNumberFlag(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  return value ? Number(value) : undefined;
}

function slugifyCanvasDelegatedArtifacts(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function readValueFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];

  if (!value || value.startsWith('-')) {
    return undefined;
  }

  return value;
}

function readMetadataCreateOptions(
  args: string[]
): OperationResult<{
  solutionUniqueName?: string;
  languageCode?: number;
  publish?: boolean;
  includeAnnotations?: string[];
}> {
  const languageCode = readNumberFlag(args, '--language-code');

  if (languageCode !== undefined && (!Number.isInteger(languageCode) || languageCode <= 0)) {
    return argumentFailure('DV_METADATA_LANGUAGE_CODE_INVALID', '--language-code must be a positive integer.');
  }

  return ok(
    {
      solutionUniqueName: readFlag(args, '--solution'),
      languageCode,
      publish: hasFlag(args, '--no-publish') ? false : true,
      includeAnnotations: readListFlag(args, '--annotations'),
    },
    {
      supportTier: 'preview',
    }
  );
}

function readAttributeListView(args: string[]): OperationResult<AttributeListView> {
  const view = readFlag(args, '--view') ?? 'common';

  if (view === 'common' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_COLUMNS_VIEW_INVALID', 'Unsupported --view for `dv metadata columns`. Use `common` or `raw`.');
}

function readAttributeDetailView(args: string[]): OperationResult<AttributeMetadataView> {
  const view = readFlag(args, '--view') ?? 'detailed';

  if (view === 'common' || view === 'detailed' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_COLUMN_VIEW_INVALID', 'Unsupported --view for `dv metadata column`. Use `common`, `detailed`, or `raw`.');
}

function readMetadataInspectView(args: string[]): OperationResult<'normalized' | 'raw'> {
  const view = readFlag(args, '--view') ?? 'normalized';

  if (view === 'normalized' || view === 'raw') {
    return ok(view, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_VIEW_INVALID', 'Unsupported --view. Use `normalized` or `raw`.');
}

function readRelationshipKind(args: string[]): OperationResult<RelationshipMetadataKind> {
  const kind = readFlag(args, '--kind') ?? 'auto';

  if (kind === 'auto' || kind === 'one-to-many' || kind === 'many-to-many') {
    return ok(kind, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_METADATA_RELATIONSHIP_KIND_INVALID', 'Unsupported --kind. Use `auto`, `one-to-many`, or `many-to-many`.');
}

function orderMetadataApplyPlanForCli(plan: MetadataApplyPlan): MetadataApplyPlan {
  const precedence: Record<MetadataApplyPlan['operations'][number]['kind'], number> = {
    'create-option-set': 10,
    'update-option-set': 20,
    'create-table': 30,
    'update-table': 40,
    'add-column': 50,
    'update-column': 60,
    'create-relationship': 70,
    'update-relationship': 80,
    'create-many-to-many': 90,
    'create-customer-relationship': 100,
  };

  return {
    operations: plan.operations
      .map((operation, index) => ({ operation, index }))
      .sort((left, right) => {
        const precedenceDelta = precedence[left.operation.kind] - precedence[right.operation.kind];
        return precedenceDelta !== 0 ? precedenceDelta : left.index - right.index;
      })
      .map((entry) => entry.operation),
  };
}

function mergeUniqueStrings(base: readonly string[], extra: string[] | undefined): string[] {
  return [...new Set([...base, ...(extra ?? [])])];
}

function readDataverseResponseType(args: string[]): OperationResult<'json' | 'text' | 'void'> {
  const value = readFlag(args, '--response-type') ?? 'json';

  if (value === 'json' || value === 'text' || value === 'void') {
    return ok(value, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('DV_RESPONSE_TYPE_INVALID', 'Unsupported --response-type. Use `json`, `text`, or `void`.');
}

function readDataverseFunctionParameters(args: string[]): OperationResult<Record<string, unknown>> {
  const parameters: Record<string, unknown> = {};

  for (const entry of readRepeatedFlags(args, '--param')) {
    const separatorIndex = entry.indexOf('=');

    if (separatorIndex <= 0) {
      return argumentFailure('DV_FUNCTION_PARAM_INVALID', 'Use `--param key=value` for Dataverse function parameters.');
    }

    parameters[entry.slice(0, separatorIndex)] = entry.slice(separatorIndex + 1);
  }

  for (const entry of readRepeatedFlags(args, '--param-json')) {
    const separatorIndex = entry.indexOf('=');

    if (separatorIndex <= 0) {
      return argumentFailure('DV_FUNCTION_PARAM_JSON_INVALID', 'Use `--param-json key=JSON` for typed Dataverse function parameters.');
    }

    const key = entry.slice(0, separatorIndex);
    const rawValue = entry.slice(separatorIndex + 1);

    try {
      parameters[key] = JSON.parse(rawValue);
    } catch (error) {
      return fail(
        createDiagnostic('error', 'DV_FUNCTION_PARAM_JSON_INVALID', `Failed to parse JSON value for function parameter ${key}.`, {
          source: '@pp/cli',
          detail: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  return ok(parameters, {
    supportTier: 'preview',
  });
}

async function readJsonBodyArgument(args: string[]): Promise<OperationResult<unknown | undefined>> {
  try {
    const inlineBody = readFlag(args, '--body');

    if (inlineBody) {
      return {
        success: true,
        data: JSON.parse(inlineBody),
        diagnostics: [],
        warnings: [],
        supportTier: 'preview',
      };
    }

    const bodyFile = readFlag(args, '--body-file');

    if (!bodyFile) {
      return {
        success: true,
        data: undefined,
        diagnostics: [],
        warnings: [],
        supportTier: 'preview',
      };
    }

    const contents = await readFile(bodyFile, 'utf8');
    return {
      success: true,
      data: JSON.parse(contents),
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
    };
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_BODY_INVALID', 'Failed to parse JSON request body.', {
        source: '@pp/cli',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

async function readJsonFileForCli(
  path: string,
  code: string,
  message: string
): Promise<OperationResult<unknown>> {
  try {
    return ok(JSON.parse(await readFile(path, 'utf8')), {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', code, message, {
        source: '@pp/cli',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readStructuredSpecArgument(
  args: string[],
  flagName: string,
  missingCode: string,
  missingMessage: string
): Promise<OperationResult<unknown>> {
  const file = readFlag(args, flagName);

  if (!file) {
    return argumentFailure(missingCode, missingMessage);
  }

  return readStructuredSpecFile(file);
}

async function readDataverseBatchArgument(args: string[]): Promise<OperationResult<DataverseBatchRequest[]>> {
  const file = readFlag(args, '--file');

  if (!file) {
    return argumentFailure('DV_BATCH_FILE_REQUIRED', 'Usage: dv batch --file FILE --environment <alias>');
  }

  const document = await readStructuredSpecFile(file);

  if (!document.success || !document.data) {
    return document as unknown as OperationResult<DataverseBatchRequest[]>;
  }

  if (!isRecord(document.data)) {
    return fail(
      createDiagnostic('error', 'DV_BATCH_SPEC_INVALID', 'Dataverse batch files must parse to an object with a requests array.', {
        source: '@pp/cli',
        path: file,
      })
    );
  }

  const requests = document.data.requests;

  if (!Array.isArray(requests) || requests.length === 0) {
    return fail(
      createDiagnostic('error', 'DV_BATCH_REQUESTS_REQUIRED', 'Dataverse batch files require a non-empty requests array.', {
        source: '@pp/cli',
        path: file,
      })
    );
  }

  const normalized: DataverseBatchRequest[] = [];

  for (let index = 0; index < requests.length; index += 1) {
    const entry = requests[index];

    if (!isRecord(entry)) {
      return fail(
        createDiagnostic('error', 'DV_BATCH_REQUEST_INVALID', `Batch request ${index + 1} must be an object.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    const method = typeof entry.method === 'string' ? entry.method.toUpperCase() : undefined;
    const path = typeof entry.path === 'string' ? entry.path : undefined;

    if (!path || !method || !['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      return fail(
        createDiagnostic(
          'error',
          'DV_BATCH_REQUEST_INVALID',
          `Batch request ${index + 1} must include method GET|POST|PATCH|DELETE and path.`,
          {
            source: '@pp/cli',
            path: file,
          }
        )
      );
    }

    if (entry.headers !== undefined && !isRecord(entry.headers)) {
      return fail(
        createDiagnostic('error', 'DV_BATCH_HEADERS_INVALID', `Batch request ${index + 1} headers must be an object when provided.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    normalized.push({
      id: typeof entry.id === 'string' ? entry.id : undefined,
      method: method as DataverseBatchRequest['method'],
      path,
      headers: entry.headers as Record<string, string> | undefined,
      body: entry.body,
      atomicGroup: typeof entry.atomicGroup === 'string' ? entry.atomicGroup : undefined,
    });
  }

  return ok(normalized, {
    supportTier: 'preview',
  });
}

async function readDataverseRowsApplyArgument(
  args: string[]
): Promise<OperationResult<{ table?: string; continueOnError: boolean; operations: DataverseRowApplyOperation[] }>> {
  const file = readFlag(args, '--file');

  if (!file) {
    return argumentFailure('DV_ROWS_APPLY_FILE_REQUIRED', 'Usage: dv rows apply --file FILE --environment <alias>');
  }

  const document = await readStructuredSpecFile(file);

  if (!document.success || !document.data) {
    return document as unknown as OperationResult<{ table?: string; continueOnError: boolean; operations: DataverseRowApplyOperation[] }>;
  }

  if (!isRecord(document.data)) {
    return fail(
      createDiagnostic('error', 'DV_ROWS_APPLY_SPEC_INVALID', 'Row apply files must parse to an object.', {
        source: '@pp/cli',
        path: file,
      })
    );
  }

  const defaultTable = typeof document.data.table === 'string' ? document.data.table : undefined;
  const continueOnError = hasFlag(args, '--continue-on-error') || document.data.continueOnError === true;
  const operationsValue = document.data.operations;

  if (!Array.isArray(operationsValue) || operationsValue.length === 0) {
    return fail(
      createDiagnostic('error', 'DV_ROWS_APPLY_OPERATIONS_REQUIRED', 'Row apply files require a non-empty operations array.', {
        source: '@pp/cli',
        path: file,
      })
    );
  }

  const operations: DataverseRowApplyOperation[] = [];

  for (let index = 0; index < operationsValue.length; index += 1) {
    const entry = operationsValue[index];

    if (!isRecord(entry)) {
      return fail(
        createDiagnostic('error', 'DV_ROWS_APPLY_OPERATION_INVALID', `Row operation ${index + 1} must be an object.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    const kind = entry.kind;

    if (kind !== 'create' && kind !== 'update' && kind !== 'upsert' && kind !== 'delete') {
      return fail(
        createDiagnostic('error', 'DV_ROWS_APPLY_KIND_INVALID', `Row operation ${index + 1} has unsupported kind ${String(kind)}.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    if (entry.headers !== undefined && !isRecord(entry.headers)) {
      return fail(
        createDiagnostic('error', 'DV_ROWS_APPLY_HEADERS_INVALID', `Row operation ${index + 1} headers must be an object when provided.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    const body = entry.body;

    if (body !== undefined && !isRecord(body)) {
      return fail(
        createDiagnostic('error', 'DV_ROWS_APPLY_BODY_INVALID', `Row operation ${index + 1} body must be an object when provided.`, {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    operations.push({
      kind,
      requestId: typeof entry.requestId === 'string' ? entry.requestId : undefined,
      table: typeof entry.table === 'string' ? entry.table : undefined,
      recordId: typeof entry.recordId === 'string' ? entry.recordId : undefined,
      path: typeof entry.path === 'string' ? entry.path : undefined,
      body: body as Record<string, unknown> | undefined,
      headers: entry.headers as Record<string, string> | undefined,
      atomicGroup: typeof entry.atomicGroup === 'string' ? entry.atomicGroup : undefined,
      ifMatch: typeof entry.ifMatch === 'string' ? entry.ifMatch : undefined,
      ifNoneMatch: typeof entry.ifNoneMatch === 'string' ? entry.ifNoneMatch : undefined,
      returnRepresentation: entry.returnRepresentation === true,
      select: readStringArrayValue(entry.select),
      expand: readStringArrayValue(entry.expand),
      prefer: readStringArrayValue(entry.prefer),
    });
  }

  return ok(
    {
      table: defaultTable,
      continueOnError,
      operations,
    },
    {
      supportTier: 'preview',
    }
  );
}

async function readMetadataApplyPlanArgument(args: string[]): Promise<OperationResult<MetadataApplyPlan>> {
  const manifestPath = readFlag(args, '--file');

  if (!manifestPath) {
    return argumentFailure('DV_METADATA_APPLY_FILE_REQUIRED', 'Usage: dv metadata apply --file FILE --environment <alias>');
  }

  const manifest = await readStructuredSpecFile(manifestPath);

  if (!manifest.success || manifest.data === undefined) {
    return manifest as OperationResult<MetadataApplyPlan>;
  }

  if (!isRecord(manifest.data)) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_INVALID', 'Structured spec files must parse to an object.', {
        source: '@pp/cli',
        path: manifestPath,
      })
    );
  }

  const operationsValue = manifest.data.operations;

  if (!Array.isArray(operationsValue) || operationsValue.length === 0) {
    return fail(
      createDiagnostic('error', 'DV_METADATA_APPLY_OPERATIONS_REQUIRED', 'Metadata apply manifests require a non-empty operations array.', {
        source: '@pp/cli',
        path: manifestPath,
      })
    );
  }

  const loadedOperations: unknown[] = [];

  for (let index = 0; index < operationsValue.length; index += 1) {
    const entry = operationsValue[index];

    if (!isRecord(entry)) {
      return fail(
        createDiagnostic('error', 'DV_METADATA_APPLY_OPERATION_INVALID', `Operation ${index + 1} must be an object.`, {
          source: '@pp/cli',
          path: manifestPath,
        })
      );
    }

    const kind = typeof entry.kind === 'string' ? entry.kind : undefined;
    const specFile = typeof entry.file === 'string' ? entry.file : undefined;

    if (!kind || !specFile) {
      return fail(
        createDiagnostic(
          'error',
          'DV_METADATA_APPLY_OPERATION_INVALID',
          `Operation ${index + 1} must include string values for kind and file.`,
          {
            source: '@pp/cli',
            path: manifestPath,
          }
        )
      );
    }

    const childPath = resolvePath(dirname(manifestPath), specFile);
    const childSpec = await readStructuredSpecFile(childPath);

    if (!childSpec.success || childSpec.data === undefined) {
      return childSpec as unknown as OperationResult<MetadataApplyPlan>;
    }

    switch (kind) {
      case 'create-table': {
        const spec = parseTableCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-table': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;

        if (!tableLogicalName) {
          return fail(
            createDiagnostic(
              'error',
              'DV_METADATA_APPLY_TABLE_REQUIRED',
              `Operation ${index + 1} must include tableLogicalName for update-table.`,
              {
                source: '@pp/cli',
                path: manifestPath,
              }
            )
          );
        }

        const spec = parseTableUpdateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, tableLogicalName, spec: spec.data });
        break;
      }
      case 'add-column': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;

        if (!tableLogicalName) {
          return fail(
            createDiagnostic(
              'error',
              'DV_METADATA_APPLY_TABLE_REQUIRED',
              `Operation ${index + 1} must include tableLogicalName for add-column.`,
              {
                source: '@pp/cli',
                path: manifestPath,
              }
            )
          );
        }

        const spec = parseColumnCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, tableLogicalName, spec: spec.data });
        break;
      }
      case 'update-column': {
        const tableLogicalName = typeof entry.tableLogicalName === 'string' ? entry.tableLogicalName : undefined;
        const columnLogicalName = typeof entry.columnLogicalName === 'string' ? entry.columnLogicalName : undefined;

        if (!tableLogicalName || !columnLogicalName) {
          return fail(
            createDiagnostic(
              'error',
              'DV_METADATA_APPLY_COLUMN_REQUIRED',
              `Operation ${index + 1} must include tableLogicalName and columnLogicalName for update-column.`,
              {
                source: '@pp/cli',
                path: manifestPath,
              }
            )
          );
        }

        const spec = parseColumnUpdateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, tableLogicalName, columnLogicalName, spec: spec.data });
        break;
      }
      case 'create-option-set': {
        const spec = parseGlobalOptionSetCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-option-set': {
        const spec = parseGlobalOptionSetUpdateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'create-relationship': {
        const spec = parseOneToManyRelationshipCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'update-relationship': {
        const schemaName = typeof entry.schemaName === 'string' ? entry.schemaName : undefined;
        const relationshipKind =
          entry.relationshipKind === 'one-to-many' || entry.relationshipKind === 'many-to-many'
            ? entry.relationshipKind
            : undefined;

        if (!schemaName || !relationshipKind) {
          return fail(
            createDiagnostic(
              'error',
              'DV_METADATA_APPLY_RELATIONSHIP_REQUIRED',
              `Operation ${index + 1} must include schemaName and relationshipKind for update-relationship.`,
              {
                source: '@pp/cli',
                path: manifestPath,
              }
            )
          );
        }

        const spec =
          relationshipKind === 'one-to-many'
            ? parseOneToManyRelationshipUpdateSpec(childSpec.data)
            : parseManyToManyRelationshipUpdateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, schemaName, relationshipKind, spec: spec.data });
        break;
      }
      case 'create-many-to-many': {
        const spec = parseManyToManyRelationshipCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      case 'create-customer-relationship': {
        const spec = parseCustomerRelationshipCreateSpec(childSpec.data);

        if (!spec.success || !spec.data) {
          return spec as unknown as OperationResult<MetadataApplyPlan>;
        }

        loadedOperations.push({ kind, spec: spec.data });
        break;
      }
      default:
        return fail(
          createDiagnostic('error', 'DV_METADATA_APPLY_KIND_INVALID', `Unsupported metadata apply kind ${kind}.`, {
            source: '@pp/cli',
            path: manifestPath,
          })
        );
    }
  }

  return parseMetadataApplyPlan({ operations: loadedOperations });
}

async function readStructuredSpecFile(file: string): Promise<OperationResult<unknown>> {

  try {
    const contents = await readFile(file, 'utf8');
    const parsed = parseStructuredText(contents, file);

    if (!parsed.success || parsed.data === undefined) {
      return parsed;
    }

    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return fail(
        createDiagnostic('error', 'CLI_SPEC_INVALID', 'Structured spec files must parse to an object.', {
          source: '@pp/cli',
          path: file,
        })
      );
    }

    return parsed;
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_READ_FAILED', 'Failed to read structured spec file.', {
        source: '@pp/cli',
        path: file,
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

async function writeStructuredArtifact(path: string, value: unknown): Promise<void> {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) {
    await writeFile(path, YAML.stringify(value), 'utf8');
    return;
  }

  await writeJsonFile(path, value as never);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value.filter((entry): entry is string => typeof entry === 'string');
  return entries.length > 0 ? entries : undefined;
}

function parseStructuredText(contents: string, sourcePath: string): OperationResult<unknown> {
  try {
    const trimmed = contents.trim();
    const lowerPath = sourcePath.toLowerCase();
    const data =
      lowerPath.endsWith('.json')
        ? JSON.parse(trimmed)
        : lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')
          ? YAML.parse(contents)
          : tryParseJsonOrYaml(contents);

    return ok(data, {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CLI_SPEC_PARSE_FAILED', 'Failed to parse structured spec file as JSON or YAML.', {
        source: '@pp/cli',
        path: sourcePath,
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function tryParseJsonOrYaml(contents: string): unknown {
  const trimmed = contents.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    return YAML.parse(contents);
  }
}

function readHeaderFlags(args: string[]): Record<string, string> | undefined {
  const entries = readRepeatedFlags(args, '--header')
    .map((value) => {
      const separatorIndex = value.indexOf(':');

      if (separatorIndex === -1) {
        return undefined;
      }

      const key = value.slice(0, separatorIndex).trim();
      const headerValue = value.slice(separatorIndex + 1).trim();

      if (!key || !headerValue) {
        return undefined;
      }

      return [key, headerValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function positionalArgs(args: string[]): string[] {
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (!current) {
      continue;
    }

    if (current.startsWith('--')) {
      if (!BOOLEAN_FLAGS.has(current)) {
        index += 1;
      }
      continue;
    }

    positional.push(current);
  }

  return positional;
}

const BOOLEAN_FLAGS = new Set([
  '--all',
  '--allow-delete',
  '--count',
  '--continue-on-error',
  '--dry-run',
  '--device-code',
  '--device-code-fallback',
  '--force-prompt',
  '--holding-solution',
  '--managed',
  '--no-device-code-fallback',
  '--no-publish',
  '--no-publish-workflows',
  '--overwrite-unmanaged-customizations',
  '--page-info',
  '--plan',
  '--return-representation',
  '--skip-product-update-dependencies',
  '--yes',
]);

function argumentFailure(code: string, message: string): OperationResult<never> {
  return fail(
    createDiagnostic('error', code, message, {
      source: '@pp/cli',
    })
  );
}

function readSolutionOutputTarget(value: string | undefined): { outPath?: string; outDir?: string } {
  if (!value) {
    return {};
  }

  return extname(value).toLowerCase() === '.zip' ? { outPath: value } : { outDir: value };
}

function readSolutionPackageTypeFlag(args: string[]): OperationResult<SolutionPackageType> {
  const value = readFlag(args, '--package-type') ?? 'both';

  if (value === 'managed' || value === 'unmanaged' || value === 'both') {
    return ok(value, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('SOLUTION_PACKAGE_TYPE_INVALID', 'Use --package-type managed, unmanaged, or both.');
}

function readFlowWorkflowStateFlag(args: string[]): OperationResult<FlowWorkflowStateLabel | undefined> {
  const value = readFlag(args, '--workflow-state');

  if (!value) {
    return ok(undefined, {
      supportTier: 'preview',
    });
  }

  if (value === 'draft' || value === 'activated' || value === 'suspended') {
    return ok(value, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('FLOW_WORKFLOW_STATE_INVALID', 'Use --workflow-state draft, activated, or suspended.');
}

function isDirectExecution(metaUrl: string): boolean {
  const entryPath = process.argv[1];
  const modulePath = resolveCurrentModulePath(metaUrl);

  if (!entryPath || !modulePath) {
    return false;
  }

  try {
    return realpathSync(modulePath) === realpathSync(resolvePath(entryPath));
  } catch {
    return false;
  }
}

function resolveCurrentModulePath(metaUrl: string): string | undefined {
  if (typeof __filename === 'string') {
    return __filename;
  }

  try {
    return fileURLToPath(metaUrl);
  } catch {
    return undefined;
  }
}

if (isDirectExecution(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
