#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { renderMarkdownPortfolioReport, renderMarkdownReport, generateContextPack, generatePortfolioReport } from '@pp/analysis';
import { readJsonFile, writeJsonFile } from '@pp/artifacts';
import {
  AuthService,
  DEFAULT_BROWSER_BOOTSTRAP_URL,
  createTokenProvider,
  resolveBrowserProfileDirectory,
  summarizeBrowserProfile,
  summarizeProfile,
  type AuthProfile,
  type BrowserProfile,
  type UserAuthProfile,
} from '@pp/auth';
import { CanvasService, type CanvasBuildMode, type CanvasTemplateProvenance } from '@pp/canvas';
import {
  createMutationPreview,
  readMutationFlags,
  readOutputFormat,
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
import {
  buildDeployPlan,
  executeDeploy,
  executeDeployPlan,
  executeReleaseManifest,
  type DeployPlan,
  type ReleaseManifest,
} from '@pp/deploy';
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
  summarizeResolvedParameter,
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

type OutputFormat = CliOutputFormat;
type AttributeListView = Extract<AttributeMetadataView, 'common' | 'raw'>;
type SolutionCompareInputKind = 'environment' | 'zip' | 'folder';

interface SolutionCompareInput {
  kind: SolutionCompareInputKind;
  value: string;
}

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
  const normalizedArgv = normalizeCliArgs(argv);
  const [group, command, ...rest] = normalizedArgv;

  if (!group || group === 'help' || group === '--help') {
    printHelp();
    return 0;
  }

  if (group === 'version' || group === '--version') {
    return runVersion([command, ...rest].filter((value): value is string => value !== undefined));
  }

  if (group === 'completion') {
    return runCompletion([command, ...rest].filter((value): value is string => value !== undefined));
  }

  if (group === 'diagnostics') {
    return runDiagnostics(command, rest);
  }

  const requestedFormat = readOutputFormat(normalizedArgv, 'json');

  if (!requestedFormat.success) {
    return printFailure(requestedFormat);
  }

  if (group === 'auth') {
    return runAuth(command, rest);
  }

  if (group === 'env') {
    return runEnvironment(command, rest);
  }

  if (group === 'dv') {
    return runDataverse(command, rest);
  }

  if (group === 'solution') {
    return runSolution(command, rest);
  }

  if (group === 'connref') {
    return runConnectionReference(command, rest);
  }

  if (group === 'envvar') {
    return runEnvironmentVariable(command, rest);
  }

  if (group === 'canvas') {
    return runCanvas(command, rest);
  }

  if (group === 'flow') {
    return runFlow(command, rest);
  }

  if (group === 'model') {
    return runModel(command, rest);
  }

  if (group === 'project') {
    return runProject(command, rest);
  }

  if (group === 'sharepoint') {
    return runSharePoint(command, rest);
  }

  if (group === 'powerbi') {
    return runPowerBi(command, rest);
  }

  switch (`${group} ${command ?? ''}`.trim()) {
    case 'analysis report':
      return runAnalysisReport(rest);
    case 'analysis context':
      return runAnalysisContext(rest);
    case 'analysis portfolio':
      return runAnalysisPortfolio(rest);
    case 'analysis drift':
      return runAnalysisDrift(rest);
    case 'analysis usage':
      return runAnalysisUsage(rest);
    case 'analysis policy':
      return runAnalysisPolicy(rest);
    case 'deploy plan':
      return runDeployPlan(rest);
    case 'deploy apply':
      return runDeployApply(rest);
    case 'deploy release':
      return runDeployRelease(rest);
    default:
      printHelp();
      return 1;
  }
}

function normalizeCliArgs(argv: string[]): string[] {
  if (argv[0] === '--') {
    return argv.slice(1);
  }

  return argv;
}

async function runProject(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    printProjectHelp();
    return 0;
  }

  switch (command) {
    case 'init':
      if (args.includes('--help') || args.includes('help')) {
        printProjectInitHelp();
        return 0;
      }
      return runProjectInit(args);
    case 'doctor':
      if (args.includes('--help') || args.includes('help')) {
        printProjectDoctorHelp();
        return 0;
      }
      return runProjectDoctor(args);
    case 'feedback':
      if (args.includes('--help') || args.includes('help')) {
        printProjectFeedbackHelp();
        return 0;
      }
      return runProjectFeedback(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        printProjectInspectHelp();
        return 0;
      }
      return runProjectInspect(args);
    default:
      printHelp();
      return 1;
  }
}

async function runDiagnostics(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    printDiagnosticsHelp();
    return 0;
  }

  switch (command) {
    case 'doctor':
      if (args.includes('--help') || args.includes('help')) {
        printDiagnosticsDoctorHelp();
        return 0;
      }
      return runDiagnosticsDoctor(args);
    case 'bundle':
      if (args.includes('--help') || args.includes('help')) {
        printDiagnosticsBundleHelp();
        return 0;
      }
      return runDiagnosticsBundle(args);
    default:
      printDiagnosticsHelp();
      return 1;
  }
}

async function runSharePoint(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    printSharePointHelp();
    return 0;
  }

  const [action, ...rest] = args;

  if (!action || action === 'help' || action === '--help' || rest.includes('--help') || rest.includes('help')) {
    printSharePointHelp();
    return 0;
  }

  switch (`${command} ${action}`) {
    case 'site inspect':
      return runSharePointSiteInspect(rest);
    case 'list inspect':
      return runSharePointListInspect(rest);
    case 'file inspect':
      return runSharePointFileInspect(rest);
    case 'permissions inspect':
      return runSharePointPermissionsInspect(rest);
    default:
      printSharePointHelp();
      return 1;
  }
}

async function runPowerBi(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    printPowerBiHelp();
    return 0;
  }

  const [action, ...rest] = args;

  if (!action || action === 'help' || action === '--help' || rest.includes('--help') || rest.includes('help')) {
    printPowerBiHelp();
    return 0;
  }

  switch (`${command} ${action}`) {
    case 'workspace inspect':
      return runPowerBiWorkspaceInspect(rest);
    case 'dataset inspect':
      return runPowerBiDatasetInspect(rest);
    case 'report inspect':
      return runPowerBiReportInspect(rest);
    default:
      printPowerBiHelp();
      return 1;
  }
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
    printCompletionHelp();
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

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return 0;
  }

  if (command === 'profile') {
    const [action, ...rest] = args;

    if (!action || action === 'help' || action === '--help' || rest.includes('--help') || rest.includes('help')) {
      printHelp();
      return 0;
    }

    switch (action) {
      case 'list':
        return runAuthProfileList(auth, rest);
      case 'inspect':
        return runAuthProfileInspect(auth, configOptions, rest);
      case 'add-user':
        return runAuthProfileSave(auth, rest, 'user');
      case 'add-static':
        return runAuthProfileSave(auth, rest, 'static-token');
      case 'add-env':
        return runAuthProfileSave(auth, rest, 'environment-token');
      case 'add-client-secret':
        return runAuthProfileSave(auth, rest, 'client-secret');
      case 'add-device-code':
        return runAuthProfileSave(auth, rest, 'device-code');
      case 'remove':
        return runAuthProfileRemove(auth, rest);
      default:
        printHelp();
        return 1;
    }
  }

  if (command === 'browser-profile') {
    const [action, ...rest] = args;

    if (!action || action === 'help' || action === '--help' || rest.includes('--help') || rest.includes('help')) {
      printHelp();
      return 0;
    }

    switch (action) {
      case 'list':
        return runAuthBrowserProfileList(auth, rest);
      case 'inspect':
        return runAuthBrowserProfileInspect(auth, rest);
      case 'add':
        return runAuthBrowserProfileSave(auth, rest);
      case 'bootstrap':
        return runAuthBrowserProfileBootstrap(auth, rest);
      case 'remove':
        return runAuthBrowserProfileRemove(auth, rest);
      default:
        printHelp();
        return 1;
    }
  }

  if (command === 'login') {
    if (args.includes('--help') || args.includes('help')) {
      printHelp();
      return 0;
    }
    return runAuthLogin(auth, args);
  }

  if (command === 'token') {
    if (args.includes('--help') || args.includes('help')) {
      printHelp();
      return 0;
    }
    return runAuthToken(auth, args);
  }

  printHelp();
  return 1;
}

async function runEnvironment(command: string | undefined, args: string[]): Promise<number> {
  const configOptions = readConfigOptions(args);

  if (!command || command === 'help' || command === '--help') {
    printEnvironmentHelp();
    return 0;
  }

  switch (command) {
    case 'list':
      return runEnvironmentList(configOptions, args);
    case 'add':
      return runEnvironmentAdd(configOptions, args);
    case 'inspect':
      return runEnvironmentInspect(configOptions, args);
    case 'resolve-maker-id':
      return runEnvironmentResolveMakerId(configOptions, args);
    case 'cleanup-plan':
      if (args.includes('--help') || args.includes('help')) {
        printEnvironmentCleanupPlanHelp();
        return 0;
      }
      return runEnvironmentCleanupPlan(configOptions, args);
    case 'reset':
      if (args.includes('--help') || args.includes('help')) {
        printEnvironmentResetHelp();
        return 0;
      }
      return runEnvironmentReset(configOptions, args);
    case 'cleanup':
      if (args.includes('--help') || args.includes('help')) {
        printEnvironmentCleanupHelp();
        return 0;
      }
      return runEnvironmentCleanup(configOptions, args);
    case 'remove':
      return runEnvironmentRemove(configOptions, args);
    default:
      printEnvironmentHelp();
      return 1;
  }
}

async function runDataverse(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    printDataverseHelp();
    return 0;
  }

  switch (command) {
    case 'whoami':
      if (args.includes('--help') || args.includes('help')) {
        printDataverseWhoAmIHelp();
        return 0;
      }
      return runDataverseWhoAmI(args);
    case 'request':
      return runDataverseRequest(args);
    case 'action':
      return runDataverseAction(args);
    case 'function':
      return runDataverseFunction(args);
    case 'batch':
      return runDataverseBatch(args);
    case 'rows':
      if (args.includes('--help') || args.includes('help')) {
        const [action] = positionalArgs(args);

        if (action === 'export') {
          printDataverseRowsExportHelp();
        } else if (action === 'apply') {
          printDataverseRowsApplyHelp();
        } else {
          printDataverseRowsHelp();
        }
        return 0;
      }
      return runDataverseRows(args);
    case 'query':
      return runDataverseQuery(args);
    case 'get':
      return runDataverseGet(args);
    case 'create':
      return runDataverseCreate(args);
    case 'update':
      return runDataverseUpdate(args);
    case 'delete':
      return runDataverseDelete(args);
    case 'metadata':
      return runDataverseMetadata(args);
    default:
      printHelp();
      return 1;
  }
}

async function runSolution(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    printSolutionHelp();
    return 0;
  }

  switch (command) {
    case 'create':
      return runSolutionCreate(args);
    case 'delete':
      return runSolutionDelete(args);
    case 'set-metadata':
      return runSolutionSetMetadata(args);
    case 'list':
      if (args.includes('--help') || args.includes('help')) {
        printSolutionListHelp();
        return 0;
      }
      return runSolutionList(args);
    case 'inspect':
      return runSolutionInspect(args);
    case 'components':
      return runSolutionComponents(args);
    case 'dependencies':
      return runSolutionDependencies(args);
    case 'analyze':
      return runSolutionAnalyze(args);
    case 'compare':
      return runSolutionCompare(args);
    case 'export':
      return runSolutionExport(args);
    case 'import':
      return runSolutionImport(args);
    case 'pack':
      return runSolutionPack(args);
    case 'unpack':
      return runSolutionUnpack(args);
    default:
      printHelp();
      return 1;
  }
}

async function runConnectionReference(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case 'list':
      return runConnectionReferenceList(args);
    case 'inspect':
      return runConnectionReferenceInspect(args);
    case 'validate':
      return runConnectionReferenceValidate(args);
    default:
      printHelp();
      return 1;
  }
}

async function runEnvironmentVariable(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    printEnvironmentVariableHelp();
    return 0;
  }

  switch (command) {
    case 'create':
      return runEnvironmentVariableCreate(args);
    case 'list':
      return runEnvironmentVariableList(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        printEnvironmentVariableInspectHelp();
        return 0;
      }
      return runEnvironmentVariableInspect(args);
    case 'set':
      return runEnvironmentVariableSet(args);
    default:
      printHelp();
      return 1;
  }
}

async function runCanvas(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    printCanvasHelp();
    return 0;
  }

  switch (command) {
    case 'create':
      if (args.includes('--help') || args.includes('help')) {
        printCanvasCreateHelp();
        return 0;
      }
      return runCanvasUnsupportedRemoteMutation('create', args);
    case 'import':
      if (args.includes('--help') || args.includes('help')) {
        printCanvasImportHelp();
        return 0;
      }
      return runCanvasUnsupportedRemoteMutation('import', args);
    case 'list':
      if (args.includes('--help') || args.includes('help')) {
        printCanvasListHelp();
        return 0;
      }
      return runCanvasList(args);
    case 'templates':
      return runCanvasTemplates(args);
    case 'workspace':
      return runCanvasWorkspace(args);
    case 'patch':
      return runCanvasPatch(args);
    case 'lint':
      return runCanvasLint(args);
    case 'validate':
      return runCanvasValidate(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        printCanvasInspectHelp();
        return 0;
      }
      return runCanvasInspect(args);
    case 'build':
      return runCanvasBuild(args);
    case 'diff':
      return runCanvasDiff(args);
    default:
      printHelp();
      return 1;
  }
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
      return printFailure({
        ...delegated,
        details: {
          handoff: fallbackDetails,
          automation: delegated.details ?? delegated.data,
        },
        suggestedNextActions: [
          ...(delegated.suggestedNextActions ?? []),
          `Inspect ${formatCliArg(
            ((delegated.details as { artifacts?: { sessionPath?: string } } | undefined)?.artifacts?.sessionPath ?? '<session-path>')
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
      printHelp();
      return 1;
  }
}

async function runCanvasWorkspace(args: string[]): Promise<number> {
  const [command, ...rest] = args;

  switch (command) {
    case 'inspect':
      return runCanvasWorkspaceInspect(rest);
    default:
      printHelp();
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
      printHelp();
      return 1;
  }
}

async function runFlow(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case 'list':
      return runFlowList(args);
    case 'inspect':
      return runFlowInspect(args);
    case 'export':
      return runFlowExport(args);
    case 'promote':
      return runFlowPromote(args);
    case 'unpack':
      return runFlowUnpack(args);
    case 'pack':
      return runFlowPack(args);
    case 'deploy':
      return runFlowDeploy(args);
    case 'normalize':
      return runFlowNormalize(args);
    case 'validate':
      return runFlowValidate(args);
    case 'graph':
      return runFlowGraph(args);
    case 'patch':
      return runFlowPatch(args);
    case 'runs':
      return runFlowRuns(args);
    case 'errors':
      return runFlowErrors(args);
    case 'connrefs':
      return runFlowConnrefs(args);
    case 'doctor':
      return runFlowDoctor(args);
    default:
      printHelp();
      return 1;
  }
}

async function runModel(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case 'list':
      return runModelList(args);
    case 'inspect':
      return runModelInspect(args);
    case 'composition':
      return runModelComposition(args);
    case 'impact':
      return runModelImpact(args);
    case 'sitemap':
      return runModelSitemap(args);
    case 'forms':
      return runModelForms(args);
    case 'views':
      return runModelViews(args);
    case 'dependencies':
      return runModelDependencies(args);
    case 'patch':
      return runModelPatch(args);
    default:
      printHelp();
      return 1;
  }
}

async function runProjectInspect(args: string[]): Promise<number> {
  const path = positionalArgs(args)[0] ?? process.cwd();
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const project = await discoverProject(path, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  const payload = {
    success: true,
    summary: summarizeProject(project.data),
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

  printByFormat(payload, format);
  if (!isMachineReadableOutputFormat(format)) {
    printResultDiagnostics(project, format);
  }
  return 0;
}

async function runProjectInit(args: string[]): Promise<number> {
  const root = positionalArgs(args)[0] ?? process.cwd();
  const format = outputFormat(args, 'json');
  const options = {
    name: readFlag(args, '--name'),
    environment: readEnvironmentAlias(args),
    solution: readFlag(args, '--solution'),
    stage: readFlag(args, '--stage'),
    force: hasFlag(args, '--force'),
  } as const;
  const plan = planProjectInit(root, options);
  const mutation = readMutationFlags(args);

  if (!mutation.success || !mutation.data) {
    return printFailure(mutation);
  }

  if (mutation.data.mode !== 'apply') {
    const payload = createMutationPreview('project.init', mutation.data, { root: plan.root, configPath: plan.configPath }, plan);

    if (isMachineReadableOutputFormat(format)) {
      printByFormat(payload, format);
    } else {
      process.stdout.write(renderProjectInitOutput(plan, format as Extract<OutputFormat, 'table' | 'markdown' | 'raw'>, mutation.data.mode));
    }
    return 0;
  }

  const result = await initProject(root, options);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  if (isMachineReadableOutputFormat(format)) {
    printByFormat(result.data, format);
  } else {
    process.stdout.write(renderProjectInitOutput(result.data, format as Extract<OutputFormat, 'table' | 'markdown' | 'raw'>));
  }
  printResultDiagnostics(result, format);
  return 0;
}

async function runProjectDoctor(args: string[]): Promise<number> {
  const root = positionalArgs(args)[0] ?? process.cwd();
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const result = await doctorProject(root, discoveryOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, format);
  printResultDiagnostics(result, format);
  return 0;
}

async function runProjectFeedback(args: string[]): Promise<number> {
  const root = positionalArgs(args)[0] ?? process.cwd();
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const result = await feedbackProject(root, discoveryOptions.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, format);
  if (!isMachineReadableOutputFormat(format)) {
    printResultDiagnostics(result, format);
  }
  return 0;
}

async function runAnalysisReport(args: string[]): Promise<number> {
  const path = positionalArgs(args)[0] ?? process.cwd();
  const format = outputFormat(args, 'markdown');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const project = await discoverProject(path, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  if (format === 'markdown') {
    process.stdout.write(renderMarkdownReport(project.data) + '\n');
    printResultDiagnostics(project, format);
    return 0;
  }

  const context = generateContextPack(project.data);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  printByFormat(context.data, format);
  printResultDiagnostics(project, format);
  printResultDiagnostics(context, format);
  return 0;
}

async function runAnalysisContext(args: string[]): Promise<number> {
  const projectPath = readFlag(args, '--project') ?? process.cwd();
  const asset = readFlag(args, '--asset');
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  const context = generateContextPack(project.data, asset);

  if (!context.success || !context.data) {
    return printFailure(context);
  }

  printByFormat(context.data, format);
  printResultDiagnostics(project, format);
  printResultDiagnostics(context, format);
  return 0;
}

async function runAnalysisPortfolio(args: string[]): Promise<number> {
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const projects = await discoverAnalysisPortfolioProjects(args, discoveryOptions.data);

  if (!projects.success || !projects.data) {
    return printFailure(projects);
  }

  const report = generatePortfolioReport(projects.data, {
    focusAsset: readFlag(args, '--asset'),
    allowedProviderKinds: readRepeatedFlags(args, '--allow-provider-kind'),
  });

  if (!report.success || !report.data) {
    return printFailure(report);
  }

  if (format === 'markdown') {
    process.stdout.write(renderMarkdownPortfolioReport(report.data) + '\n');
  } else {
    printByFormat(report.data, format);
  }

  printResultDiagnostics(projects, format);
  printResultDiagnostics(report, format);
  return 0;
}

async function runAnalysisDrift(args: string[]): Promise<number> {
  return runAnalysisPortfolioView(args, 'drift');
}

async function runAnalysisUsage(args: string[]): Promise<number> {
  return runAnalysisPortfolioView(args, 'usage');
}

async function runAnalysisPolicy(args: string[]): Promise<number> {
  return runAnalysisPortfolioView(args, 'policy');
}

async function runAnalysisPortfolioView(args: string[], view: 'drift' | 'usage' | 'policy'): Promise<number> {
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const projects = await discoverAnalysisPortfolioProjects(args, discoveryOptions.data);

  if (!projects.success || !projects.data) {
    return printFailure(projects);
  }

  const report = generatePortfolioReport(projects.data, {
    focusAsset: readFlag(args, '--asset'),
    allowedProviderKinds: readRepeatedFlags(args, '--allow-provider-kind'),
  });

  if (!report.success || !report.data) {
    return printFailure(report);
  }

  const payload =
    view === 'drift' ? report.data.drift : view === 'usage' ? report.data.inventories : report.data.governance;

  printByFormat(payload, format);
  printResultDiagnostics(projects, format);
  printResultDiagnostics(report, format);
  return 0;
}

async function runDeployPlan(args: string[]): Promise<number> {
  const projectPath = readFlag(args, '--project') ?? process.cwd();
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  const plan = buildDeployPlan(project.data);

  if (!plan.success || !plan.data) {
    return printFailure(plan);
  }

  printByFormat(plan.data, format);
  printResultDiagnostics(project, format);
  printResultDiagnostics(plan, format);
  return 0;
}

async function discoverAnalysisPortfolioProjects(
  args: string[],
  options: { stage?: string; parameterOverrides?: Record<string, string> }
): Promise<OperationResult<ProjectContext[]>> {
  const projectPaths = readAnalysisPortfolioProjectPaths(args);
  const projects: ProjectContext[] = [];
  const warnings: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const projectPath of projectPaths) {
    const resolvedPath = resolvePath(projectPath);

    if (seen.has(resolvedPath)) {
      warnings.push(
        createDiagnostic('warning', 'ANALYSIS_PORTFOLIO_DUPLICATE_PROJECT', `Skipping duplicate portfolio project ${resolvedPath}`, {
          source: '@pp/cli',
        })
      );
      continue;
    }

    seen.add(resolvedPath);
    const project = await discoverProject(resolvedPath, {
      ...options,
      environment: process.env,
    });

    if (!project.success || !project.data) {
      return fail([...warnings, ...project.diagnostics], {
        warnings: [...warnings, ...project.warnings],
        supportTier: project.supportTier,
        suggestedNextActions: project.suggestedNextActions,
        provenance: project.provenance,
        knownLimitations: project.knownLimitations,
      });
    }

    warnings.push(...project.warnings);
    projects.push(project.data);
  }

  return ok(projects, {
    warnings,
    supportTier: 'preview',
  });
}

async function runDeployApply(args: string[]): Promise<number> {
  const explicitProjectPath = readFlag(args, '--project');
  const projectPath = explicitProjectPath ?? process.cwd();
  const format = outputFormat(args, 'json');
  const discoveryOptions = readProjectDiscoveryOptions(args);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const mutation = readDeployApplyFlags(args);

  if (!mutation.success || !mutation.data) {
    return printFailure(mutation);
  }

  const expectedPlan = mutation.data.planPath ? await loadDeployPlanFile(mutation.data.planPath) : ok<DeployPlan | undefined>(undefined, { supportTier: 'preview' });

  if (!expectedPlan.success) {
    return printFailure(expectedPlan);
  }

  if (expectedPlan.data && !explicitProjectPath) {
    const result = await executeDeployPlan(expectedPlan.data, {
      mode: mutation.data.mode,
      confirmed: mutation.data.yes,
      parameterOverrides: discoveryOptions.data.parameterOverrides,
    });

    if (!result.data) {
      return printFailure(result);
    }

    printByFormat(result.data, format);
    printResultDiagnostics(result, format);
    return result.data.preflight.ok && result.data.apply.summary.failed === 0 ? 0 : 1;
  }

  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return printFailure(project);
  }

  const result = await executeDeploy(project.data, {
    mode: mutation.data.mode,
    confirmed: mutation.data.yes,
    expectedPlan: expectedPlan.data,
  });

  if (!result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, format);
  printResultDiagnostics(project, format);
  printResultDiagnostics(result, format);
  return result.data.preflight.ok && result.data.apply.summary.failed === 0 ? 0 : 1;
}

async function runDeployRelease(args: string[]): Promise<number> {
  const [action, ...rest] = args;

  if (!action || action === 'help' || action === '--help') {
    printHelp();
    return 0;
  }

  const format = outputFormat(rest, 'json');
  const manifestPath = readFlag(rest, '--file') ?? positionalArgs(rest)[0];

  if (!manifestPath) {
    return printFailure(argumentFailure('RELEASE_MANIFEST_REQUIRED', 'Use `deploy release <plan|apply> --file <manifest.yml>`.'));
  }

  const manifest = await loadReleaseManifestFile(manifestPath);

  if (!manifest.success || !manifest.data) {
    return printFailure(manifest);
  }

  const discoveryOptions = readProjectDiscoveryOptions(rest);

  if (!discoveryOptions.success || !discoveryOptions.data) {
    return printFailure(discoveryOptions);
  }

  const yes = hasFlag(rest, '--yes');
  const mode: 'plan' | 'dry-run' | 'apply' = action === 'plan' ? 'plan' : hasFlag(rest, '--dry-run') ? 'dry-run' : 'apply';
  const result = await executeReleaseManifest(manifest.data, {
    mode,
    confirmed: yes,
    approvedStages: readRepeatedFlags(rest, '--approve'),
    parameterOverrides: discoveryOptions.data.parameterOverrides,
  });

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, format);
  printResultDiagnostics(result, format);
  return result.data.summary.failed === 0 && result.data.summary.blocked === 0 && result.data.summary.rollbackFailed === 0 ? 0 : 1;
}

async function runAuthProfileList(auth: AuthService, args: string[]): Promise<number> {
  const format = outputFormat(args, 'json');
  const profiles = await auth.listProfiles();

  if (!profiles.success) {
    return printFailure(profiles);
  }

  printByFormat((profiles.data ?? []).map(summarizeProfile), format);
  return 0;
}

async function runAuthProfileInspect(auth: AuthService, configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const target = await resolveAuthProfileInspectTarget(configOptions, args);

  if (!target.success || !target.data) {
    return printFailure(target);
  }

  const format = outputFormat(args, 'json');
  const profile = await auth.getProfile(target.data.name);

  if (!profile.success) {
    return printFailure(profile);
  }

  if (!profile.data) {
    return printFailure(fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${target.data.name} was not found.`)));
  }

  const summary = summarizeProfile(profile.data);

  printByFormat(
    target.data.environmentAlias
      ? {
          ...summary,
          resolvedFromEnvironment: target.data.environmentAlias,
        }
      : summary,
    format
  );
  return 0;
}

async function resolveAuthProfileInspectTarget(
  configOptions: ConfigStoreOptions,
  args: string[]
): Promise<OperationResult<{ name: string; environmentAlias?: string }>> {
  const name = positionalArgs(args)[0];

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

  const environmentAlias = readEnvironmentAlias(args);

  if (!environmentAlias) {
    return argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name or --environment <alias> is required.');
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
    },
    {
      supportTier: 'preview',
      diagnostics: environment.diagnostics,
      warnings: environment.warnings,
    }
  );
}

async function runAuthBrowserProfileList(auth: AuthService, args: string[]): Promise<number> {
  const format = outputFormat(args, 'json');
  const profiles = await auth.listBrowserProfiles();

  if (!profiles.success) {
    return printFailure(profiles);
  }

  printByFormat((profiles.data ?? []).map((profile) => summarizeBrowserProfile(profile, readConfigOptions(args))), format);
  return 0;
}

async function runAuthBrowserProfileInspect(auth: AuthService, args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('AUTH_BROWSER_PROFILE_NAME_REQUIRED', 'Browser profile name is required.'));
  }

  const profile = await auth.getBrowserProfile(name);

  if (!profile.success) {
    return printFailure(profile);
  }

  if (!profile.data) {
    return printFailure(fail(createDiagnostic('error', 'AUTH_BROWSER_PROFILE_NOT_FOUND', `Browser profile ${name} was not found.`)));
  }

  printByFormat(summarizeBrowserProfile(profile.data, readConfigOptions(args)), outputFormat(args, 'json'));
  return 0;
}

async function runAuthBrowserProfileSave(auth: AuthService, args: string[]): Promise<number> {
  const name = readFlag(args, '--name');

  if (!name) {
    return printFailure(argumentFailure('AUTH_BROWSER_PROFILE_NAME_REQUIRED', '--name is required for browser profile add.'));
  }

  const kind = (readFlag(args, '--kind') ?? 'edge') as BrowserProfile['kind'];

  if (!isBrowserProfileKind(kind)) {
    return printFailure(
      argumentFailure('AUTH_BROWSER_PROFILE_KIND_INVALID', 'Unsupported browser profile kind. Use `edge`, `chrome`, `chromium`, or `custom`.')
    );
  }

  if (kind === 'custom' && !readFlag(args, '--command')) {
    return printFailure(
      argumentFailure('AUTH_BROWSER_PROFILE_COMMAND_REQUIRED', '--command is required when browser profile kind is `custom`.')
    );
  }

  const profile: BrowserProfile = {
    name,
    kind,
    description: readFlag(args, '--description'),
    command: readFlag(args, '--command'),
    args: readRepeatedFlags(args, '--arg'),
    directory: readFlag(args, '--directory'),
  };

  const preview = maybeHandleMutationPreview(args, 'json', 'auth.browser-profile.add', { name, kind }, summarizeBrowserProfile(profile, readConfigOptions(args)));

  if (preview !== undefined) {
    return preview;
  }

  const saved = await auth.saveBrowserProfile(profile);

  if (!saved.success || !saved.data) {
    return printFailure(saved);
  }

  printByFormat(summarizeBrowserProfile(saved.data, readConfigOptions(args)), outputFormat(args, 'json'));
  return 0;
}

async function runAuthBrowserProfileRemove(auth: AuthService, args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('AUTH_BROWSER_PROFILE_NAME_REQUIRED', 'Browser profile name is required.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'auth.browser-profile.remove', { name });

  if (preview !== undefined) {
    return preview;
  }

  const removed = await auth.removeBrowserProfile(name);

  if (!removed.success) {
    return printFailure(removed);
  }

  printByFormat({ removed: removed.data ?? false, name }, 'json');
  return 0;
}

async function runAuthBrowserProfileBootstrap(auth: AuthService, args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('AUTH_BROWSER_PROFILE_NAME_REQUIRED', 'Browser profile name is required.'));
  }

  const url = readFlag(args, '--url') ?? DEFAULT_BROWSER_BOOTSTRAP_URL;
  const noWait = hasFlag(args, '--no-wait');
  const format = outputFormat(args, 'json');
  const profile = await auth.getBrowserProfile(name);

  try {
    new URL(url);
  } catch {
    return printFailure(argumentFailure('AUTH_BROWSER_PROFILE_BOOTSTRAP_URL_INVALID', `Bootstrap URL must be an absolute URL. Received: ${url}`));
  }

  if (!profile.success) {
    return printFailure(profile);
  }

  if (!profile.data) {
    return printFailure(fail(createDiagnostic('error', 'AUTH_BROWSER_PROFILE_NOT_FOUND', `Browser profile ${name} was not found.`)));
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'auth.browser-profile.bootstrap',
    { name, url },
    {
      ...summarizeBrowserProfile(profile.data, readConfigOptions(args)),
      bootstrapUrl: url,
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  if (!noWait && !process.stdin.isTTY) {
    return printFailure(
      argumentFailure(
        'AUTH_BROWSER_PROFILE_BOOTSTRAP_TTY_REQUIRED',
        'Browser profile bootstrap requires an interactive terminal unless --no-wait is supplied.'
      )
    );
  }

  const launched = await auth.launchBrowserProfile(name, url);

  if (!launched.success || !launched.data) {
    return printFailure(launched);
  }

  if (noWait) {
    printByFormat(
      {
        launched: true,
        browserProfile: summarizeBrowserProfile(profile.data, readConfigOptions(args)),
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

  await promptForEnter('');

  const marked = await auth.markBrowserProfileBootstrapped(name, {
    url,
  });

  if (!marked.success || !marked.data) {
    return printFailure(marked);
  }

  printByFormat(
    {
      bootstrapped: true,
      browserProfile: summarizeBrowserProfile(marked.data, readConfigOptions(args)),
      bootstrapUrl: url,
    },
    format
  );
  return 0;
}

async function runAuthProfileSave(
  auth: AuthService,
  args: string[],
  type: AuthProfile['type']
): Promise<number> {
  const name = readFlag(args, '--name');
  const description = readFlag(args, '--description');
  const tenantId = readFlag(args, '--tenant-id');
  const clientId = readFlag(args, '--client-id');
  const defaultResource = readFlag(args, '--resource');
  const scopes = readListFlag(args, '--scope');

  if (!name) {
    return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  let profile: AuthProfile;

  switch (type) {
    case 'user': {
      profile = buildPublicClientProfile(
        {
          name,
          type,
        },
        args
      );
      break;
    }
    case 'static-token': {
      const token = readFlag(args, '--token');

      if (!token) {
        return printFailure(argumentFailure('AUTH_TOKEN_REQUIRED', '--token is required for add-static.'));
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
      const environmentVariable = readFlag(args, '--env-var');

      if (!environmentVariable) {
        return printFailure(argumentFailure('AUTH_ENV_VAR_REQUIRED', '--env-var is required for add-env.'));
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
      const clientSecretEnv = readFlag(args, '--secret-env');

      if (!tenantId || !clientId || !clientSecretEnv) {
        return printFailure(
          argumentFailure(
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
        args
      );
      break;
    }
  }

  const preview = maybeHandleMutationPreview(args, 'json', `auth.profile.${type === 'user' ? 'add-user' : `add-${type}`}`, { name }, summarizeProfile(profile));

  if (preview !== undefined) {
    return preview;
  }

  const saved = await auth.saveProfile(profile);

  if (!saved.success || !saved.data) {
    return printFailure(saved);
  }

  printByFormat(summarizeProfile(saved.data), outputFormat(args, 'json'));
  return 0;
}

async function runAuthLogin(auth: AuthService, args: string[]): Promise<number> {
  const name = readFlag(args, '--name');

  if (!name) {
    return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  const existing = await auth.getProfile(name);

  if (!existing.success) {
    return printFailure(existing);
  }

  if (existing.data && existing.data.type !== 'user' && existing.data.type !== 'device-code') {
    return printFailure(
      argumentFailure(
        'AUTH_PROFILE_TYPE_CONFLICT',
        `Auth profile ${name} already exists with type ${existing.data.type}. Use a different name for browser login.`
      )
    );
  }

  const requestedType: UserAuthProfile['type'] = hasFlag(args, '--device-code')
    ? 'device-code'
    : hasFlag(args, '--interactive')
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
    args
  );

  const resource = resolveRequestedResource(profile, readFlag(args, '--resource'));

  if (resource === undefined) {
    return printFailure(
      argumentFailure(
        'AUTH_RESOURCE_REQUIRED',
        '--resource is required unless the profile already defines a default resource or explicit scopes.'
      )
    );
  }

  const login = await auth.loginProfile(profile, resource, {
    forcePrompt: hasFlag(args, '--force-prompt'),
    preferredFlow: profile.type === 'device-code' ? 'device-code' : 'interactive',
  });

  if (!login.success || !login.data) {
    return printFailure(login);
  }

  printByFormat(
    {
      profile: summarizeProfile(login.data.profile),
      resource: resource || undefined,
      authenticated: true,
    },
    outputFormat(args, 'json')
  );
  return 0;
}

async function runAuthProfileRemove(auth: AuthService, args: string[]): Promise<number> {
  const name = positionalArgs(args)[0];

  if (!name) {
    return printFailure(argumentFailure('AUTH_PROFILE_NAME_REQUIRED', 'Auth profile name is required.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'auth.profile.remove', { name });

  if (preview !== undefined) {
    return preview;
  }

  const removed = await auth.removeProfile(name);

  if (!removed.success) {
    return printFailure(removed);
  }

  printByFormat({ removed: removed.data ?? false, name }, 'json');
  return 0;
}

async function runAuthToken(auth: AuthService, args: string[]): Promise<number> {
  const profileName = readFlag(args, '--profile');
  const format = outputFormat(args, 'raw');

  if (!profileName) {
    return printFailure(argumentFailure('AUTH_TOKEN_PROFILE_REQUIRED', '--profile is required.'));
  }

  const profile = await auth.getProfile(profileName);

  if (!profile.success) {
    return printFailure(profile);
  }

  if (!profile.data) {
    return printFailure(fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${profileName} was not found.`)));
  }

  const resource = resolveRequestedResource(profile.data, readFlag(args, '--resource'));

  if (resource === undefined) {
    return printFailure(
      argumentFailure(
        'AUTH_TOKEN_RESOURCE_REQUIRED',
        '--resource is required unless the profile already defines a default resource or explicit scopes.'
      )
    );
  }

  const token = await auth.getAccessToken(profileName, resource);

  if (!token.success || !token.data) {
    return printFailure(token);
  }

  if (format === 'raw') {
    process.stdout.write(token.data.token + '\n');
    return 0;
  }

  printByFormat(
    {
      profile: summarizeProfile(token.data.profile),
      resource: resource || undefined,
      token: token.data.token,
    },
    format
  );
  return 0;
}

async function runEnvironmentList(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const environments = await listEnvironments(configOptions);

  if (!environments.success) {
    return printFailure(environments);
  }

  printByFormat(environments.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentAdd(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = readFlag(args, '--name');
  const url = readFlag(args, '--url');
  const authProfile = readFlag(args, '--profile');

  if (!alias || !url || !authProfile) {
    return printFailure(argumentFailure('ENV_ADD_ARGS_REQUIRED', '--name, --url, and --profile are required.'));
  }

  const environment: EnvironmentAlias = {
    alias,
    url,
    authProfile,
    tenantId: readFlag(args, '--tenant-id'),
    displayName: readFlag(args, '--display-name'),
    defaultSolution: readFlag(args, '--default-solution'),
    makerEnvironmentId: readFlag(args, '--maker-env-id'),
    apiPath: readFlag(args, '--api-path'),
  };

  const preview = maybeHandleMutationPreview(args, 'json', 'env.add', { alias, url, authProfile }, environment);

  if (preview !== undefined) {
    return preview;
  }

  const saved = await saveEnvironmentAlias(environment, configOptions);

  if (!saved.success || !saved.data) {
    return printFailure(saved);
  }

  printByFormat(saved.data, outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentInspect(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = positionalArgs(args)[0];

  if (!alias) {
    return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  const environment = await getEnvironmentAlias(alias, configOptions);

  if (!environment.success) {
    return printFailure(environment);
  }

  if (!environment.data) {
    return printFailure(fail(createDiagnostic('error', 'ENV_NOT_FOUND', `Environment alias ${alias} was not found.`)));
  }

  printByFormat(environment.data, outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentResolveMakerId(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = positionalArgs(args)[0];

  if (!alias) {
    return printFailure(
      argumentFailure('ENV_ALIAS_REQUIRED', 'Usage: env resolve-maker-id <alias> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]')
    );
  }

  const environment = await getEnvironmentAlias(alias, configOptions);

  if (!environment.success) {
    return printFailure(environment);
  }

  if (!environment.data) {
    return printFailure(fail(createDiagnostic('error', 'ENV_NOT_FOUND', `Environment alias ${alias} was not found.`)));
  }

  const auth = new AuthService(configOptions);
  const profile = await auth.getProfile(environment.data.authProfile);

  if (!profile.success) {
    return printFailure(profile);
  }

  if (!profile.data) {
    return printFailure(
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
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  if (environment.data.makerEnvironmentId) {
    printByFormat(
      {
        environment: environment.data,
        resolution: {
          source: 'configured',
          persisted: false,
          api: 'power-platform-environments',
        },
      },
      outputFormat(args, 'json')
    );
    return 0;
  }

  const discovered = await discoverMakerEnvironmentIdForEnvironment(environment.data, profile.data, configOptions);

  if (!discovered.success) {
    return printFailure(discovered);
  }

  if (!discovered.data) {
    return printFailure(
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
    return printFailure(saved);
  }

  printByFormat(
    {
      environment: saved.data,
      resolution: {
        source: 'discovered',
        persisted: true,
        api: 'power-platform-environments',
      },
    },
    outputFormat(args, 'json')
  );
  return 0;
}

async function runEnvironmentRemove(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = positionalArgs(args)[0];

  if (!alias) {
    return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'env.remove', { alias });

  if (preview !== undefined) {
    return preview;
  }

  const removed = await removeEnvironmentAlias(alias, configOptions);

  if (!removed.success) {
    return printFailure(removed);
  }

  printByFormat({ removed: removed.data ?? false, alias }, 'json');
  return 0;
}

async function runEnvironmentCleanupPlan(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  const alias = positionalArgs(args)[0];
  const prefix = readFlag(args, '--prefix');

  if (!alias) {
    return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  if (!prefix) {
    return printFailure(argumentFailure('ENV_CLEANUP_PREFIX_REQUIRED', '--prefix is required.'));
  }

  const plan = await buildEnvironmentCleanupPlan(configOptions, alias, prefix);

  if (!plan.success || !plan.data) {
    return printFailure(plan);
  }

  printByFormat(plan.data, outputFormat(args, 'json'));
  return 0;
}

async function runEnvironmentCleanup(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentCleanupLike(configOptions, args, {
    actionName: 'env.cleanup',
    suggestedPlanCommand: 'pp env cleanup',
  });
}

async function runEnvironmentReset(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentCleanupLike(configOptions, args, {
    actionName: 'env.reset',
    suggestedPlanCommand: 'pp env reset',
  });
}

async function runEnvironmentCleanupLike(
  configOptions: ConfigStoreOptions,
  args: string[],
  behavior: {
    actionName: 'env.cleanup' | 'env.reset';
    suggestedPlanCommand: 'pp env cleanup' | 'pp env reset';
  }
): Promise<number> {
  const alias = positionalArgs(args)[0];
  const prefix = readFlag(args, '--prefix');

  if (!alias) {
    return printFailure(argumentFailure('ENV_ALIAS_REQUIRED', 'Environment alias is required.'));
  }

  if (!prefix) {
    return printFailure(argumentFailure('ENV_CLEANUP_PREFIX_REQUIRED', '--prefix is required.'));
  }

  const plan = await buildEnvironmentCleanupPlan(configOptions, alias, prefix);

  if (!plan.success || !plan.data) {
    return printFailure(plan);
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
    }
  );

  if (preview !== undefined) {
    return preview;
  }

  const resolution = await resolveDataverseClient(alias, configOptions);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
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
    return printFailure(
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

  printWarnings(
    ok(summary, {
      supportTier: 'preview',
      warnings,
    })
  );
  printByFormat(summary, outputFormat(args, 'json'));
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
  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.list();

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runSolutionCreate(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(
      argumentFailure(
        'SOLUTION_CREATE_ARGS_REQUIRED',
        'Usage: solution create <uniqueName> --environment <alias> [--friendly-name NAME] [--version X.Y.Z.W] [--description TEXT] (--publisher-id GUID | --publisher-unique-name NAME)'
      )
    );
  }

  const publisherId = readFlag(args, '--publisher-id');
  const publisherUniqueName = readFlag(args, '--publisher-unique-name');

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.create(uniqueName, {
    friendlyName: readFlag(args, '--friendly-name'),
    version: readFlag(args, '--version'),
    description: readFlag(args, '--description'),
    publisherId,
    publisherUniqueName,
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionDelete(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(argumentFailure('SOLUTION_DELETE_ARGS_REQUIRED', 'Usage: solution delete <uniqueName> --environment <alias>'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const solution = await service.inspect(uniqueName);

  if (!solution.success) {
    return printFailure(solution);
  }

  if (!solution.data) {
    return printFailure(fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`)));
  }

  const preview = maybeHandleMutationPreview(
    args,
    'json',
    'solution.delete',
    {
      environment: resolution.data.environment.alias,
      uniqueName,
      solutionId: solution.data.solutionid,
    },
    solution.data
  );

  if (preview !== undefined) {
    return preview;
  }

  const result = await service.delete(uniqueName);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionInspect(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.inspect(uniqueName);

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionSetMetadata(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(
      argumentFailure(
        'SOLUTION_SET_METADATA_ARGS_REQUIRED',
        'Usage: solution set-metadata <uniqueName> --environment <alias> [--version X.Y.Z.W] [--publisher-id GUID | --publisher-unique-name NAME]'
      )
    );
  }

  const version = readFlag(args, '--version');
  const publisherId = readFlag(args, '--publisher-id');
  const publisherUniqueName = readFlag(args, '--publisher-unique-name');

  if (!version && !publisherId && !publisherUniqueName) {
    return printFailure(
      argumentFailure(
        'SOLUTION_METADATA_UPDATE_REQUIRED',
        'Use --version, --publisher-id, or --publisher-unique-name when updating solution metadata.'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.setMetadata(uniqueName, {
    version,
    publisherId,
    publisherUniqueName,
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionComponents(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.components(uniqueName);

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runSolutionDependencies(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.dependencies(uniqueName);

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data ?? [], outputFormat(args, 'json'));
  return 0;
}

async function runSolutionAnalyze(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(argumentFailure('SOLUTION_UNIQUE_NAME_REQUIRED', 'Solution unique name is required.'));
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.analyze(uniqueName);

  if (!result.success) {
    return printFailure(result);
  }

  if (!result.data) {
    return printFailure(fail(createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found.`)));
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionCompare(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];
  const sourceInput = readSolutionCompareInput(args, 'source');

  if (!sourceInput.success || !sourceInput.data) {
    return printFailure(sourceInput);
  }

  const targetInput = readSolutionCompareInput(args, 'target');

  if (!targetInput.success || !targetInput.data) {
    return printFailure(targetInput);
  }

  if ((sourceInput.data.kind === 'environment' || targetInput.data.kind === 'environment') && !uniqueName) {
    return printFailure(
      argumentFailure(
        'SOLUTION_UNIQUE_NAME_REQUIRED',
        'Solution unique name is required when either compare side targets an environment.'
      )
    );
  }

  const sourceAnalysis = await resolveSolutionCompareAnalysis(args, 'source', sourceInput.data, uniqueName);

  if (!sourceAnalysis.success || !sourceAnalysis.data) {
    return printFailure(sourceAnalysis);
  }

  const targetAnalysis = await resolveSolutionCompareAnalysis(args, 'target', targetInput.data, uniqueName);

  if (!targetAnalysis.success || !targetAnalysis.data) {
    return printFailure(targetAnalysis);
  }

  const compareUniqueName =
    uniqueName ?? sourceAnalysis.data.solution.uniquename ?? targetAnalysis.data.solution.uniquename ?? 'local-solution';
  const service = createLocalSolutionService();
  const result = service.compareLocal(compareUniqueName, sourceAnalysis.data, targetAnalysis.data);

  if (!result.success || !result.data) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionExport(args: string[]): Promise<number> {
  const uniqueName = positionalArgs(args)[0];

  if (!uniqueName) {
    return printFailure(
      argumentFailure(
        'SOLUTION_EXPORT_ARGS_REQUIRED',
        'Usage: solution export <uniqueName> --environment <alias> [--out PATH] [--managed] [--manifest FILE]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const outputTarget = readSolutionOutputTarget(readFlag(args, '--out'));
  const preview = maybeHandleMutationPreview(args, 'json', 'solution.export', {
    environment: resolution.data.environment.alias,
    uniqueName,
    ...(outputTarget.outPath ? { outPath: outputTarget.outPath } : {}),
    ...(outputTarget.outDir ? { outDir: outputTarget.outDir } : {}),
    managed: args.includes('--managed'),
  });

  if (preview !== undefined) {
    return preview;
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.exportSolution(uniqueName, {
    managed: args.includes('--managed'),
    outPath: outputTarget.outPath,
    outDir: outputTarget.outDir,
    manifestPath: readFlag(args, '--manifest'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionImport(args: string[]): Promise<number> {
  const packagePath = positionalArgs(args)[0];

  if (!packagePath) {
    return printFailure(
      argumentFailure(
        'SOLUTION_IMPORT_ARGS_REQUIRED',
        'Usage: solution import <path.zip> --environment <alias> [--overwrite-unmanaged-customizations] [--holding-solution] [--skip-product-update-dependencies] [--no-publish-workflows]'
      )
    );
  }

  const resolution = await resolveDataverseClientForCli(args);

  if (!resolution.success || !resolution.data) {
    return printFailure(resolution);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'solution.import', {
    environment: resolution.data.environment.alias,
    packagePath,
  });

  if (preview !== undefined) {
    return preview;
  }

  const service = new SolutionService(resolution.data.client);
  const result = await service.importSolution(packagePath, {
    publishWorkflows: !args.includes('--no-publish-workflows'),
    overwriteUnmanagedCustomizations: args.includes('--overwrite-unmanaged-customizations'),
    holdingSolution: args.includes('--holding-solution'),
    skipProductUpdateDependencies: args.includes('--skip-product-update-dependencies'),
    importJobId: readFlag(args, '--import-job-id'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionPack(args: string[]): Promise<number> {
  const sourceFolder = positionalArgs(args)[0];

  if (!sourceFolder) {
    return printFailure(argumentFailure('SOLUTION_PACK_ARGS_REQUIRED', 'Usage: solution pack <folder> --out <file.zip> [--package-type managed|unmanaged|both] [--pac PATH]'));
  }

  const outPath = readFlag(args, '--out');

  if (!outPath) {
    return printFailure(argumentFailure('SOLUTION_PACK_OUT_REQUIRED', '--out <file.zip> is required.'));
  }

  const packageType = readSolutionPackageTypeFlag(args);

  if (!packageType.success || !packageType.data) {
    return printFailure(packageType);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'solution.pack', {
    sourceFolder,
    outPath,
    packageType: packageType.data,
  });

  if (preview !== undefined) {
    return preview;
  }

  const service = createLocalSolutionService();
  const result = await service.pack(sourceFolder, {
    outPath,
    packageType: packageType.data,
    pacExecutable: readFlag(args, '--pac'),
    mapFile: readFlag(args, '--map'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

async function runSolutionUnpack(args: string[]): Promise<number> {
  const packagePath = positionalArgs(args)[0];

  if (!packagePath) {
    return printFailure(
      argumentFailure(
        'SOLUTION_UNPACK_ARGS_REQUIRED',
        'Usage: solution unpack <path.zip> --out <dir> [--package-type managed|unmanaged|both] [--allow-delete] [--pac PATH]'
      )
    );
  }

  const outDir = readFlag(args, '--out');

  if (!outDir) {
    return printFailure(argumentFailure('SOLUTION_UNPACK_OUT_REQUIRED', '--out <dir> is required.'));
  }

  const packageType = readSolutionPackageTypeFlag(args);

  if (!packageType.success || !packageType.data) {
    return printFailure(packageType);
  }

  const preview = maybeHandleMutationPreview(args, 'json', 'solution.unpack', {
    packagePath,
    outDir,
    packageType: packageType.data,
  });

  if (preview !== undefined) {
    return preview;
  }

  const service = createLocalSolutionService();
  const result = await service.unpack(packagePath, {
    outDir,
    packageType: packageType.data,
    pacExecutable: readFlag(args, '--pac'),
    allowDelete: args.includes('--allow-delete'),
    mapFile: readFlag(args, '--map'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printWarnings(result);
  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
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
      printHelp();
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

function buildPublicClientProfile(
  baseProfile: UserAuthProfile,
  args: string[]
): UserAuthProfile {
  const prompt = readFlag(args, '--prompt');
  const scopes = readListFlag(args, '--scope');
  const explicitFallback = hasFlag(args, '--no-device-code-fallback')
    ? false
    : hasFlag(args, '--device-code-fallback')
      ? true
      : undefined;

  if (baseProfile.type === 'device-code') {
    return {
      ...baseProfile,
      description: readFlag(args, '--description') ?? baseProfile.description,
      tenantId: readFlag(args, '--tenant-id') ?? baseProfile.tenantId,
      clientId: readFlag(args, '--client-id') ?? baseProfile.clientId,
      defaultResource: readFlag(args, '--resource') ?? baseProfile.defaultResource,
      scopes: scopes ?? baseProfile.scopes,
      tokenCacheKey: readFlag(args, '--cache-key') ?? baseProfile.tokenCacheKey,
      loginHint: readFlag(args, '--login-hint') ?? baseProfile.loginHint,
    };
  }

  return {
    ...baseProfile,
    description: readFlag(args, '--description') ?? baseProfile.description,
    tenantId: readFlag(args, '--tenant-id') ?? baseProfile.tenantId,
    clientId: readFlag(args, '--client-id') ?? baseProfile.clientId,
    defaultResource: readFlag(args, '--resource') ?? baseProfile.defaultResource,
    scopes: scopes ?? baseProfile.scopes,
    tokenCacheKey: readFlag(args, '--cache-key') ?? baseProfile.tokenCacheKey,
    loginHint: readFlag(args, '--login-hint') ?? baseProfile.loginHint,
    browserProfile: readFlag(args, '--browser-profile') ?? baseProfile.browserProfile,
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

  const projectPath = readFlag(args, '--project') ?? process.cwd();
  const project = await discoverProject(projectPath, discoveryOptions.data);

  if (!project.success || !project.data) {
    return project as unknown as OperationResult<CanvasCliContext>;
  }

  const mode = readCanvasBuildMode(readFlag(args, '--mode') ?? readProjectCanvasBuildMode(project.data.build) ?? 'strict');

  if (!mode) {
    return argumentFailure('CANVAS_MODE_INVALID', 'Use --mode strict, seeded, or registry.');
  }

  const registries = readRepeatedFlags(args, '--registry');
  const workspacePath = readFlag(args, '--workspace');
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

  const projectPath = readFlag(args, '--project') ?? process.cwd();
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

function formatProjectContractTarget(target: {
  stage?: string;
  environmentAlias?: string;
  solutionAlias?: string;
  solutionUniqueName?: string;
}): string {
  return `stage ${target.stage ?? '<unset>'} -> environment ${target.environmentAlias ?? '<unset>'} -> solution ${target.solutionUniqueName ?? target.solutionAlias ?? '<unset>'}`;
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

  return resolvePath(process.env.INIT_CWD ?? process.cwd(), configDir);
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
  return configured.length > 0 ? configured : [process.cwd()];
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

function readDeployApplyFlags(
  args: string[]
): OperationResult<{ mode: 'apply' | 'dry-run' | 'plan'; dryRun: boolean; plan: boolean; yes: boolean; planPath?: string }> {
  const dryRun = args.includes('--dry-run');
  const planPath = readValueFlag(args, '--plan');
  const plan = args.includes('--plan') && !planPath;
  const yes = args.includes('--yes');

  if (dryRun && (plan || planPath)) {
    return argumentFailure('CLI_MUTATION_MODE_CONFLICT', 'Use either --dry-run, --plan, or --plan <file>, not multiple preview/apply modes.');
  }

  return ok(
    {
      mode: plan ? 'plan' : dryRun ? 'dry-run' : 'apply',
      dryRun,
      plan,
      yes,
      planPath,
    },
    {
      supportTier: 'preview',
    }
  );
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

async function loadDeployPlanFile(path: string): Promise<OperationResult<DeployPlan>> {
  let raw: string;

  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    return fail(
      createDiagnostic('error', 'DEPLOY_PLAN_FILE_READ_FAILED', `Could not read deploy plan file ${path}.`, {
        source: '@pp/cli',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'DEPLOY_PLAN_FILE_INVALID_JSON', `Deploy plan file ${path} is not valid JSON.`, {
        source: '@pp/cli',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }

  if (!isDeployPlanShape(parsed)) {
    return fail(
      createDiagnostic('error', 'DEPLOY_PLAN_FILE_INVALID', `Deploy plan file ${path} does not match the expected deploy plan shape.`, {
        source: '@pp/cli',
        path,
      })
    );
  }

  return ok(parsed, {
    supportTier: 'preview',
  });
}

async function loadReleaseManifestFile(path: string): Promise<OperationResult<ReleaseManifest>> {
  let raw: string;

  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    return fail(
      createDiagnostic('error', 'RELEASE_MANIFEST_READ_FAILED', `Could not read release manifest ${path}.`, {
        source: '@pp/cli',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }

  let parsed: unknown;

  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'RELEASE_MANIFEST_INVALID', `Release manifest ${path} is not valid YAML or JSON.`, {
        source: '@pp/cli',
        path,
        hint: error instanceof Error ? error.message : undefined,
      })
    );
  }

  if (!isReleaseManifestShape(parsed)) {
    return fail(
      createDiagnostic('error', 'RELEASE_MANIFEST_SHAPE_INVALID', `Release manifest ${path} does not match the expected release manifest shape.`, {
        source: '@pp/cli',
        path,
      })
    );
  }

  return ok(resolveReleaseManifestPaths(parsed, path), {
    supportTier: 'preview',
  });
}

function isDeployPlanShape(value: unknown): value is DeployPlan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<DeployPlan>;
  return typeof candidate.generatedAt === 'string' && typeof candidate.projectRoot === 'string' && Array.isArray(candidate.operations);
}

function isReleaseManifestShape(value: unknown): value is ReleaseManifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ReleaseManifest>;
  return candidate.schemaVersion === 1 && candidate.kind === 'pp.release' && typeof candidate.name === 'string' && Array.isArray(candidate.stages);
}

function resolveReleaseManifestPaths(manifest: ReleaseManifest, manifestPath: string): ReleaseManifest {
  const manifestDir = dirname(resolvePath(manifestPath));
  return {
    ...manifest,
    projectRoot: manifest.projectRoot
      ? isAbsolute(manifest.projectRoot)
        ? manifest.projectRoot
        : resolvePath(manifestDir, manifest.projectRoot)
      : manifest.projectRoot,
    bundle: manifest.bundle
      ? {
          ...manifest.bundle,
          manifestPath: resolvePath(manifestPath),
        }
      : {
          manifestPath: resolvePath(manifestPath),
        },
    stages: manifest.stages.map((stage) => ({
      ...stage,
      projectPath: stage.projectPath
        ? isAbsolute(stage.projectPath)
          ? stage.projectPath
          : resolvePath(manifestDir, stage.projectPath)
        : stage.projectPath,
      planPath: stage.planPath
        ? isAbsolute(stage.planPath)
          ? stage.planPath
          : resolvePath(manifestDir, stage.planPath)
        : stage.planPath,
    })),
  };
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

function isPromptValue(value: string | undefined): value is Extract<UserAuthProfile, { type: 'user' }>['prompt'] {
  return value === 'select_account' || value === 'login' || value === 'consent' || value === 'none';
}

function isBrowserProfileKind(value: string): value is BrowserProfile['kind'] {
  return value === 'edge' || value === 'chrome' || value === 'chromium' || value === 'custom';
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

function readSolutionCompareInput(args: string[], side: 'source' | 'target'): OperationResult<SolutionCompareInput> {
  const options = [
    {
      kind: 'environment' as const,
      value: readFlag(args, `--${side}-env`),
    },
    {
      kind: 'zip' as const,
      value: readFlag(args, `--${side}-zip`),
    },
    {
      kind: 'folder' as const,
      value: readFlag(args, `--${side}-folder`),
    },
  ].filter((option): option is SolutionCompareInput => Boolean(option.value));

  if (options.length !== 1) {
    return argumentFailure(
      'SOLUTION_COMPARE_INPUT_INVALID',
      `Provide exactly one of --${side}-env, --${side}-zip, or --${side}-folder.`
    );
  }

  return ok(options[0]!, {
    supportTier: 'preview',
  });
}

async function resolveSolutionCompareAnalysis(
  args: string[],
  side: 'source' | 'target',
  input: SolutionCompareInput,
  uniqueName: string | undefined
): Promise<OperationResult<SolutionAnalysis>> {
  if (input.kind === 'environment') {
    if (!uniqueName) {
      return argumentFailure(
        'SOLUTION_UNIQUE_NAME_REQUIRED',
        'Solution unique name is required when comparing against an environment.'
      ) as OperationResult<SolutionAnalysis>;
    }

    const resolution = await resolveDataverseClientByFlag(args, `--${side}-env`);

    if (!resolution.success || !resolution.data) {
      return resolution as unknown as OperationResult<SolutionAnalysis>;
    }

    const analysis = await new SolutionService(resolution.data.client).analyze(uniqueName);

    if (!analysis.success) {
      return analysis as OperationResult<SolutionAnalysis>;
    }

    if (!analysis.data) {
      return fail(
        [
          ...analysis.diagnostics,
          createDiagnostic('error', 'SOLUTION_NOT_FOUND', `Solution ${uniqueName} was not found in environment ${input.value}.`, {
            source: '@pp/cli',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: analysis.warnings,
        }
      ) as OperationResult<SolutionAnalysis>;
    }

    return ok(analysis.data, {
      supportTier: 'preview',
      diagnostics: analysis.diagnostics,
      warnings: analysis.warnings,
    });
  }

  const service = createLocalSolutionService();
  return input.kind === 'zip'
    ? service.analyzeArtifact({
        packagePath: input.value,
        pacExecutable: readFlag(args, '--pac'),
      })
    : service.analyzeArtifact({
        unpackedPath: input.value,
      });
}

function createLocalSolutionService(): SolutionService {
  return new SolutionService(new NullDataverseClient() as never);
}

class NullDataverseClient {
  query(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse reads.');
  }

  queryAll(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse reads.');
  }

  invokeAction(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse writes.');
  }

  invokeFunction(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse reads.');
  }

  executeBatch(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse writes.');
  }

  request(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse requests.');
  }

  requestJson(): never {
    throw new Error('NullDataverseClient should not be used for Dataverse requests.');
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      'pp',
      '',
      'Product commands:',
      '  version',
      '  completion <bash|zsh|fish>',
      '  diagnostics <doctor|bundle> [path] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Commands:',
      '  auth profile list [--config-dir path]',
      '  auth profile inspect <name> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  auth profile inspect --environment ALIAS [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]  # --env also works',
      '  auth profile add-user --name NAME [--resource URL] [--login-hint user@contoso.com] [--browser-profile NAME] [--config-dir path]',
      '  auth profile add-static --name NAME --token TOKEN [--resource URL]',
      '  auth profile add-env --name NAME --env-var ENV_VAR [--resource URL]',
      '  auth profile add-client-secret --name NAME --tenant-id TENANT --client-id CLIENT --secret-env ENV_VAR [--resource URL] [--scope s1,s2]',
      '  auth profile add-device-code --name NAME [--resource URL] [--login-hint user@contoso.com] [--config-dir path]',
      '  auth profile remove <name> [--config-dir path]',
      '  auth browser-profile list [--config-dir path]',
      '  auth browser-profile inspect <name> [--config-dir path]',
      '  auth browser-profile add --name NAME [--kind edge|chrome|chromium|custom] [--command PATH] [--arg ARG] [--directory PATH] [--config-dir path]',
      '  auth browser-profile bootstrap <name> [--url URL] [--no-wait] [--config-dir path]',
      '  auth browser-profile remove <name> [--config-dir path]',
      '  auth login --name NAME --resource URL [--login-hint user@contoso.com] [--browser-profile NAME] [--force-prompt] [--device-code] [--config-dir path]',
      '  auth token --profile NAME [--resource URL] [--format raw|json]',
      '  Remote Dataverse-backed commands accept [--no-interactive-auth] to fail fast with structured diagnostics instead of opening browser auth.',
      '',
      '  env list [--config-dir path]',
      '  env add --name ALIAS --url URL --profile PROFILE [--default-solution NAME] [--maker-env-id GUID] [--config-dir path]',
      '  env inspect <alias> [--config-dir path]',
      '  env resolve-maker-id <alias> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  env cleanup-plan <alias> --prefix PREFIX [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  env cleanup <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  env remove <alias> [--config-dir path]',
      '',
      '  dv whoami --environment ALIAS [--no-interactive-auth] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  dv request --environment ALIAS --path PATH [--method GET] [--body JSON|--body-file FILE] [--response-type json|text|void] [--header "Name: value"] [--config-dir path]',
      '  dv action <name> --environment ALIAS [--body JSON|--body-file FILE] [--bound-path PATH] [--response-type json|text|void] [--solution UNIQUE_NAME] [--header "Name: value"] [--config-dir path]',
      '  dv function <name> --environment ALIAS [--param key=value] [--param-json key=JSON] [--bound-path PATH] [--response-type json|text|void] [--header "Name: value"] [--config-dir path]',
      '  dv batch --environment ALIAS --file FILE [--continue-on-error] [--solution UNIQUE_NAME] [--config-dir path]',
      '  dv rows export <table> --environment ALIAS [--select a,b] [--expand x,y] [--orderby expr] [--top N] [--filter expr] [--count] [--all] [--out FILE] [--config-dir path]',
      '  dv rows apply --environment ALIAS --file FILE [--continue-on-error] [--solution UNIQUE_NAME] [--config-dir path]',
      '  dv query <table> --environment ALIAS [--select a,b] [--expand x,y] [--orderby expr] [--top N] [--filter expr] [--count] [--all|--page-info] [--config-dir path]',
      '  dv get <table> <id> --environment ALIAS [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv create <table> --environment ALIAS --body JSON|--body-file FILE [--return-representation] [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv update <table> <id> --environment ALIAS --body JSON|--body-file FILE [--return-representation] [--if-match etag] [--config-dir path]',
      '  dv delete <table> <id> --environment ALIAS [--if-match etag] [--config-dir path]',
      '  dv metadata tables --environment ALIAS [--select a,b] [--filter expr] [--top N] [--all] [--config-dir path]',
      '  dv metadata table <logicalName> --environment ALIAS [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv metadata columns <tableLogicalName> --environment ALIAS [--view common|raw] [--select a,b] [--filter expr] [--top N] [--all] [--config-dir path]',
      '  dv metadata column <tableLogicalName> <columnLogicalName> --environment ALIAS [--view common|detailed|raw] [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv metadata option-set <name> --environment ALIAS [--view normalized|raw] [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv metadata relationship <schemaName> --environment ALIAS [--kind auto|one-to-many|many-to-many] [--view normalized|raw] [--select a,b] [--expand x,y] [--config-dir path]',
      '  dv metadata snapshot <table|columns|option-set|relationship> ... --environment ALIAS [--kind auto|one-to-many|many-to-many] [--out FILE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  dv metadata diff --left FILE --right FILE [--format table|json|yaml|ndjson|markdown|raw]',
      '  dv metadata apply --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-table --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata update-table <tableLogicalName> --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata add-column <tableLogicalName> --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata update-column <tableLogicalName> <columnLogicalName> --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-option-set --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata update-option-set --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-relationship --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata update-relationship <schemaName> --environment ALIAS --kind one-to-many|many-to-many --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-many-to-many --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '  dv metadata create-customer-relationship --environment ALIAS --file FILE [--solution UNIQUE_NAME] [--language-code 1033] [--no-publish] [--config-dir path]',
      '',
      '  solution create <uniqueName> --environment ALIAS [--friendly-name NAME] [--version X.Y.Z.W] [--description TEXT] (--publisher-id GUID | --publisher-unique-name NAME)',
      '  solution delete <uniqueName> --environment ALIAS [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution set-metadata <uniqueName> --environment ALIAS [--version X.Y.Z.W] [--publisher-id GUID | --publisher-unique-name NAME]',
      '  solution list --environment ALIAS [--no-interactive-auth] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution inspect <uniqueName> --environment ALIAS [--config-dir path]',
      '  solution components <uniqueName> --environment ALIAS [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution dependencies <uniqueName> --environment ALIAS [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution analyze <uniqueName> --environment ALIAS [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution compare [uniqueName] (--source-env ALIAS|--source-zip FILE.zip|--source-folder DIR) (--target-env ALIAS|--target-zip FILE.zip|--target-folder DIR) [--pac PATH] [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution export <uniqueName> --environment ALIAS [--out PATH] [--managed] [--manifest FILE] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution import <path.zip> --environment ALIAS [--overwrite-unmanaged-customizations] [--holding-solution] [--skip-product-update-dependencies] [--no-publish-workflows] [--import-job-id GUID] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution pack <folder> --out FILE.zip [--package-type managed|unmanaged|both] [--map FILE] [--pac PATH] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  solution unpack <path.zip> --out DIR [--package-type managed|unmanaged|both] [--allow-delete] [--map FILE] [--pac PATH] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  connref list --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  connref inspect <logicalName|displayName|id> --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  connref validate --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  envvar create <schemaName> --environment ALIAS [--display-name NAME] [--default-value VALUE] [--type string|number|boolean|json|data-source|secret] [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  envvar list --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  envvar inspect <schemaName|displayName|id> --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  envvar set <schemaName|displayName|id> --environment ALIAS --value VALUE [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas list --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas create --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [--delegate] [preview handoff or delegated Maker automation]',
      '  canvas import <file.msapp> --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [preview: returns not-implemented diagnostics]',
      '  canvas validate <path> [--project path] [--mode strict|seeded|registry] [--registry FILE] [--cache-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas lint <path> [--project path] [--mode strict|seeded|registry] [--registry FILE] [--cache-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas inspect <path|workspaceApp|displayName|name|id> [--environment ALIAS] [--solution UNIQUE_NAME] [--project path] [--workspace FILE] [--mode strict|seeded|registry] [--registry FILE] [--cache-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas build <path|workspaceApp> [--project path] [--workspace FILE] [--out FILE] [--mode strict|seeded|registry] [--registry FILE] [--cache-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas diff <leftPath> <rightPath> [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas workspace inspect <workspacePath> [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas templates import <sourcePath> [--out FILE] [--kind official-api|official-artifact|harvested|inferred] [--source LABEL] [--acquired-at ISO] [--source-artifact PATH] [--source-app-id ID] [--platform-version VERSION] [--app-version VERSION] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas templates inspect <registryPath> [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas templates diff <leftRegistry> <rightRegistry> [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas templates pin <registryPath> --out FILE [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas templates refresh <sourcePath> [--current FILE] [--out FILE] [--kind official-api|official-artifact|harvested|inferred] [--source LABEL] [--acquired-at ISO] [--source-artifact PATH] [--source-app-id ID] [--platform-version VERSION] [--app-version VERSION] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas templates audit <registryPath> [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas patch plan <path|workspaceApp> --file PATCH.json [--workspace FILE] [--project path] [--format table|json|yaml|ndjson|markdown|raw]',
      '  canvas patch apply <path|workspaceApp> --file PATCH.json [--workspace FILE] [--project path] [--out PATH] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow list --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow inspect <name|id|uniqueName|path> [--environment ALIAS] [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow export <name|id|uniqueName> --environment ALIAS --out PATH [--solution UNIQUE_NAME] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow promote <name|id|uniqueName> --source-environment ALIAS --target-environment ALIAS [--source-solution UNIQUE_NAME] [--target-solution UNIQUE_NAME] [--target <name|id|uniqueName>] [--create-if-missing] [--workflow-state draft|activated|suspended] [--solution-package] [--managed-solution-package] [--overwrite-unmanaged-customizations] [--holding-solution] [--skip-product-update-dependencies] [--no-publish-workflows] [--import-job-id GUID] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow unpack <path> --out DIR [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow pack <path> --out FILE.json [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow deploy <path> --environment ALIAS [--solution UNIQUE_NAME] [--target <name|id|uniqueName>] [--create-if-missing] [--workflow-state draft|activated|suspended] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow normalize <path> [--out PATH] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow validate <path> [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow graph <path> [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow patch <path> --file PATCH.json [--out PATH] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow runs <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--status STATUS] [--since 7d] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow errors <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--status STATUS] [--since 7d] [--group-by errorCode|errorMessage|connectionReference] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow connrefs <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--since 7d] [--format table|json|yaml|ndjson|markdown|raw]',
      '  flow doctor <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--since 7d] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model list --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model inspect <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model composition <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model impact <name|id|uniqueName> --environment ALIAS --kind app|form|view|sitemap --target <name|id> [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model sitemap <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model forms <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model views <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model dependencies <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  model patch plan <name|id|uniqueName> --environment ALIAS --kind app|form|view|sitemap --target <name|id> --rename <newName> [--solution UNIQUE_NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  sharepoint site inspect <site|binding> [--project path] [--profile NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  sharepoint list inspect <list|binding> --site <site|binding> [--project path] [--profile NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  sharepoint file inspect <file|binding> --site <site|binding> [--drive name] [--project path] [--profile NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  sharepoint permissions inspect --site <site|binding> [--list name|binding] [--file path|binding] [--drive name] [--project path] [--profile NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  powerbi workspace inspect <workspace|binding> [--project path] [--profile NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  powerbi dataset inspect <dataset|binding> --workspace <workspace|binding> [--project path] [--profile NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '  powerbi report inspect <report|binding> --workspace <workspace|binding> [--project path] [--profile NAME] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      '  project init [path] [--name NAME] [--environment ALIAS] [--solution UNIQUE_NAME] [--stage STAGE] [--force] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '  project doctor [path] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  project feedback [path] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  project inspect [path] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  analysis report [path] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  analysis context [--project path] [--asset assetRef] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  analysis portfolio [path ...] [--project path] [--allow-provider-kind KIND] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  analysis drift [path ...] [--project path] [--allow-provider-kind KIND] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  analysis usage [path ...] [--project path] [--allow-provider-kind KIND] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  analysis policy [path ...] [--project path] [--allow-provider-kind KIND] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  deploy plan [--project path] [--stage STAGE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  deploy apply [--project path] [--stage STAGE] [--param NAME=VALUE] [--dry-run|--plan|--plan FILE] [--yes] [--format table|json|yaml|ndjson|markdown|raw]',
      '  deploy release plan --file MANIFEST.yml [--approve GATE] [--param NAME=VALUE] [--format table|json|yaml|ndjson|markdown|raw]',
      '  deploy release apply --file MANIFEST.yml [--approve GATE] [--param NAME=VALUE] [--dry-run] [--yes] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
      '',
      'Mutation command options:',
      '  --dry-run  render a mutation preview without side effects',
      '  --plan     render a mutation plan without side effects',
      '  --yes      record non-interactive confirmation for guarded workflows',
    ].join('\n') + '\n'
  );
}

function printCanvasHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas <command> [options]',
      '',
      'Remote canvas commands:',
      '  list                         list remote canvas apps through Dataverse',
      '  inspect <displayName|name|id> inspect a remote canvas app when used with --environment',
      '  create                       preview handoff today; `--delegate` can drive the Maker blank-app flow through a browser profile',
      '  import <file.msapp>          reserved for future remote import; currently returns diagnostics',
      '',
      'Local canvas commands:',
      '  validate <path>              validate a local canvas source tree',
      '  lint <path>                  emit metadata-aware lint diagnostics for a local canvas source tree',
      '  inspect <path>               inspect a local canvas source tree',
      '  build <path>                 package a local canvas source tree into an .msapp',
      '  diff <leftPath> <rightPath>  diff two local canvas source trees',
      '  workspace inspect <path>     inspect a versioned canvas workspace manifest',
      '  patch plan <path> --file ... preview a bounded canvas patch against json-manifest apps',
      '  patch apply <path> --file ... apply a bounded canvas patch in place or into --out',
      '',
      'Template registry commands:',
      '  templates import <sourcePath> import harvested or official template metadata',
      '  templates inspect <registry> summarize a pinned registry snapshot',
      '  templates diff <left> <right> compare two registry snapshots',
      '  templates pin <registry> --out FILE normalize and write a pinned registry file',
      '  templates refresh <source>   re-import a source catalog and optionally diff against --current',
      '  templates audit <registry>   summarize provenance coverage and version metadata',
      '',
      'Examples:',
      '  pp canvas list --environment dev --solution Core',
      '  pp canvas inspect "Harness Canvas" --environment dev --solution Core',
      '  pp canvas inspect ./apps/MyCanvas --project . --mode strict',
      '  pp canvas build ./apps/MyCanvas --project . --out ./dist/MyCanvas.msapp',
      '',
      'Notes:',
      '  - Remote canvas coverage today is read-only: list and inspect.',
      '  - Remote create/import still use preview flows rather than first-class server-side APIs.',
      '  - `canvas create --delegate` can drive the Maker blank-app flow and wait for the created app id through Dataverse.',
      '  - Attempted remote create/import calls return machine-readable diagnostics with next steps.',
      '  - Use --environment to switch canvas inspect from local-path mode to remote lookup mode.',
      '  - Use --workspace to resolve a workspace app name plus shared registry catalogs.',
      '  - Canvas patching currently targets the supported json-manifest source slice only.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printDataverseHelp(): void {
  process.stdout.write(
    [
      'Usage: dv <command> [options]',
      '',
      'Commands:',
      '  whoami                      resolve the current caller and target environment',
      '  request                     issue a raw Dataverse Web API request',
      '  action <name>               invoke a Dataverse action with typed parameters',
      '  function <name>             invoke a Dataverse function with typed parameters',
      '  batch                       execute a Dataverse $batch manifest',
      '  rows ...                    export row sets or apply typed row manifests',
      '  query <table>               query table rows through Dataverse',
      '  get <table> <id>            fetch one Dataverse row by id',
      '  create <table>              create one Dataverse row',
      '  update <table> <id>         update one Dataverse row',
      '  delete <table> <id>         delete one Dataverse row',
      '  metadata ...                inspect or mutate Dataverse metadata',
      '',
      'Examples:',
      '  pp dv whoami --environment dev --format json',
      '  pp dv query solutions --environment dev --select solutionid,uniquename --top 5',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printDataverseWhoAmIHelp(): void {
  process.stdout.write(
    [
      'Usage: dv whoami --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Resolves the target environment alias and auth profile.',
      '  - Returns the current Dataverse caller and business unit ids with environment context.',
      '',
      'Examples:',
      '  pp dv whoami --environment dev',
      '  pp dv whoami --environment dev --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printDataverseRowsHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows <command> [options]',
      '',
      'Commands:',
      '  export <table>              export a Dataverse row set with query metadata',
      '  apply                       apply a typed row-mutation manifest through Dataverse batch',
      '',
      'Examples:',
      '  pp dv rows export accounts --environment dev --select accountid,name --all --out ./accounts.json',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml --solution Core',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printDataverseRowsExportHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows export <table> --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Queries Dataverse rows and packages them into a stable row-set artifact.',
      '  - Includes query metadata so the exported file records how the slice was collected.',
      '  - Writes JSON or YAML when `--out` is provided; otherwise prints the artifact to stdout.',
      '',
      'Examples:',
      '  pp dv rows export accounts --environment dev --select accountid,name --top 100',
      '  pp dv rows export accounts --environment dev --filter "statecode eq 0" --all --out ./accounts.yaml',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printDataverseRowsApplyHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows apply --file FILE --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Reads a typed row-mutation manifest instead of raw HTTP batch parts.',
      '  - Supports `create`, `update`, `upsert`, and `delete` operations.',
      '  - Uses Dataverse batch under the hood while preserving row-level paths and results.',
      '',
      'Examples:',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml --continue-on-error --solution Core',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printSolutionHelp(): void {
  process.stdout.write(
    [
      'Usage: solution <command> [options]',
      '',
      'Remote commands:',
      '  create <uniqueName>         create a solution shell in an environment',
      '  delete <uniqueName>         delete one solution from an environment',
      '  set-metadata <uniqueName>   update solution publisher or version metadata',
      '  list                        list solutions in an environment',
      '  inspect <uniqueName>        inspect one solution',
      '  components <uniqueName>     list solution components',
      '  dependencies <uniqueName>   list solution dependencies',
      '  analyze <uniqueName>        render a normalized analysis view',
      '  compare [uniqueName]        compare source and target solution states',
      '  export <uniqueName>         export a solution package',
      '  import <path.zip>           import a solution package',
      '',
      'Local package commands:',
      '  pack <folder>               pack a local solution folder into a zip',
      '  unpack <path.zip>           unpack a solution zip into a folder',
      '',
      'Examples:',
      '  pp solution list --environment dev --format json',
      '  pp solution inspect Core --environment dev',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printSolutionListHelp(): void {
  process.stdout.write(
    [
      'Usage: solution list --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Lists installed solutions in the target environment.',
      '  - Returns structured records with solution ids, unique names, friendly names, versions, and managed state.',
      '',
      'Examples:',
      '  pp solution list --environment dev',
      '  pp solution list --environment dev --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printEnvironmentHelp(): void {
  process.stdout.write(
    [
      'Usage: env <command> [options]',
      '',
      'Commands:',
      '  list                         list saved environment aliases',
      '  add --name ALIAS             add or update one environment alias',
      '  inspect <alias>              inspect one saved alias',
      '  resolve-maker-id <alias>     discover and persist the Maker environment id for an alias',
      '  cleanup-plan <alias>         list disposable solutions matching a run prefix before bootstrap reset',
      '  reset <alias>                delete disposable solutions matching a run prefix for bootstrap reset',
      '  cleanup <alias>              delete disposable solutions matching a run prefix',
      '  remove <alias>               remove one saved alias from local config',
      '',
      'Examples:',
      '  pp env list',
      '  pp env inspect dev',
      '  pp env cleanup-plan test --prefix ppHarness20260310T013401820Z --format json',
      '  pp env reset test --prefix ppHarness20260310T013401820Z --dry-run --format json',
      '  pp env cleanup test --prefix ppHarness20260310T013401820Z --dry-run --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printEnvironmentCleanupPlanHelp(): void {
  process.stdout.write(
    [
      'Usage: env cleanup-plan <alias> --prefix PREFIX [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Lists remote solutions whose unique name or friendly name starts with PREFIX, case-insensitively.',
      '  - Intended for harness bootstrap or disposable-environment reset flows where stale disposable harness assets should be removed before reuse.',
      '  - Returns candidate solutions together with next-step guidance for `pp env reset`.',
      '  - Follow with `pp env reset <alias> --prefix PREFIX [--dry-run|--plan]` when you are ready to delete the matches.',
      '  - Related commands: env reset <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw], env cleanup <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Examples:',
      '  pp env cleanup-plan test --prefix ppHarness20260310T013401820Z',
      '  pp env cleanup-plan test --prefix ppHarness20260310T013401820Z --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printEnvironmentResetHelp(): void {
  process.stdout.write(
    [
      'Usage: env reset <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Deletes remote solutions whose unique name or friendly name starts with PREFIX, case-insensitively.',
      '  - Intended as the first-class bootstrap reset command for clearing stale disposable harness assets before environment reuse.',
      '  - Use `--dry-run` or `--plan` first to preview the matching solutions without mutating the environment.',
      '  - Equivalent remote deletion behavior to `pp env cleanup`, but named for bootstrap/reset workflows.',
      '',
      'Examples:',
      '  pp env reset test --prefix ppHarness20260310T013401820Z --dry-run --format json',
      '  pp env reset test --prefix ppHarness20260310T013401820Z --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printEnvironmentCleanupHelp(): void {
  process.stdout.write(
    [
      'Usage: env cleanup <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Behavior:',
      '  - Deletes remote solutions whose unique name or friendly name starts with PREFIX, case-insensitively.',
      '  - Use `--dry-run` or `--plan` first to preview the matching solutions without mutating the environment.',
      '  - Intended for clearing stale disposable harness assets before bootstrap reuses an environment.',
      '',
      'Examples:',
      '  pp env cleanup test --prefix ppHarness20260310T013401820Z --dry-run --format json',
      '  pp env cleanup test --prefix ppHarness20260310T013401820Z --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printEnvironmentVariableHelp(): void {
  process.stdout.write(
    [
      'Usage: envvar <command> [options]',
      '',
      'Commands:',
      '  create <schemaName>         create an environment variable definition',
      '  list                        list environment variable definitions and values',
      '  inspect <identifier>        inspect one environment variable by schema name, display name, or id',
      '  set <identifier>            set the current value for one environment variable',
      '',
      'Examples:',
      '  pp envvar list --environment dev --solution Core --format json',
      '  pp envvar inspect pp_ApiUrl --environment dev',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printEnvironmentVariableInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: envvar inspect <schemaName|displayName|id> --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Behavior:',
      '  - Resolves one environment variable definition and its current value when present.',
      '  - Returns a stable ENVVAR_NOT_FOUND diagnostic when the identifier does not match a definition in the target scope.',
      '',
      'Examples:',
      '  pp envvar inspect pp_ApiUrl --environment dev',
      '  pp envvar inspect pp_ApiUrl --environment dev --solution Core --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printCanvasCreateHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas create --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [options]',
      '',
      'Status:',
      '  Preview handoff by default. `--delegate` can drive the Maker blank-app flow through a persisted browser profile.',
      '',
      'Options:',
      '  --maker-env-id ID          Optional Maker environment id override for deep-link guidance',
      '  --delegate                 Drive the solution-scoped Maker blank-app flow and wait for the created app id',
      '  --open                     Launch the resolved Maker handoff URL instead of only printing it',
      '  --browser-profile NAME     Optional override for the browser profile used with --open',
      '  --artifacts-dir DIR        Persist delegated screenshots/session metadata under DIR',
      '  --timeout-ms N             Delegated Studio readiness timeout in milliseconds',
      '  --poll-timeout-ms N        Delegated Dataverse polling timeout in milliseconds',
      '  --settle-ms N              Delegated post-save and post-publish settle delay in milliseconds',
      '  --slow-mo-ms N             Delegated browser slow motion delay in milliseconds',
      '  --debug                    Keep the delegated browser visible instead of running headless',
      '',
      'What works today:',
      '  - Use `pp canvas list --environment <alias> --solution <solution>` to inspect existing remote canvas apps.',
      '  - Use `pp canvas inspect <displayName|name|id> --environment <alias> --solution <solution>` to inspect a specific remote app.',
      '  - Use `--delegate --browser-profile <name> --solution <solution> --name <display-name>` to let pp drive the Maker blank-app flow and return the created app id when Studio save/publish succeeds.',
      '  - Use `--open` to launch the resolved Maker handoff when the environment auth profile already names a browser profile.',
      '  - Use `--open --browser-profile <name>` to override that browser profile for a one-off handoff.',
      '',
      'Next steps for new apps today:',
      '  - Prefer `--delegate` when you want pp to wait for the created app id through Dataverse.',
      '  - Finish blank-app creation in Maker when you need a new remote canvas app but do not want delegated browser automation.',
      '  - Use `pp canvas build <path> --out <file.msapp>` if you are packaging a local canvas source tree.',
      '',
      'Known limitations:',
      '  - Delegated create still depends on Maker browser automation rather than a first-class remote API.',
      '  - Studio readiness and publish timing can still vary by tenant and browser session.',
      '',
      'Preview options:',
      '  --dry-run                     Resolve env/solution context and print a structured no-op preview',
      '  --plan                        Resolve env/solution context and print a structured fallback plan',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printCanvasListHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas list --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Status:',
      '  Lists remote canvas apps through Dataverse.',
      '',
      'Behavior:',
      '  - Requires `--environment` to resolve the target environment alias.',
      '  - When `--solution` is provided, filters the result to canvas apps that are solution components.',
      '  - Returns remote app ids and any Maker open URIs currently available from Dataverse.',
      '',
      'Examples:',
      '  pp canvas list --environment dev',
      '  pp canvas list --environment dev --solution Core',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printCanvasImportHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas import <file.msapp> --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [options]',
      '',
      'Status:',
      '  Preview placeholder. Remote canvas import is not implemented yet.',
      '',
      'Options:',
      '  --name DISPLAY_NAME        Expected remote display name for post-import verification guidance',
      '  --maker-env-id ID          Optional Maker environment id override for deep-link guidance',
      '  --open                     Launch the resolved Maker handoff URL instead of only printing it',
      '  --browser-profile NAME     Optional override for the browser profile used with --open',
      '',
      'What works today:',
      '  - Use `pp canvas build <path> --out <file.msapp>` to package a local canvas source tree.',
      '  - Use `pp canvas list --environment <alias> --solution <solution>` to inspect existing remote canvas apps.',
      '  - Use `--open` to launch the resolved Maker handoff when the environment auth profile already names a browser profile.',
      '  - Use `--open --browser-profile <name>` to override that browser profile for a one-off handoff.',
      '',
      'Next steps for remote import today:',
      '  - Use Maker or solution tooling for the remote import step until `pp canvas import` exists.',
      '',
      'Known limitations:',
      '  - Remote canvas coverage in pp is currently read-only.',
      '  - pp does not yet return a remote canvas app id for create/import workflows.',
      '',
      'Preview options:',
      '  --dry-run                     Resolve env/solution context and print a structured no-op preview',
      '  --plan                        Resolve env/solution context and print a structured fallback plan',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printCanvasInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: canvas inspect <path|displayName|name|id> [--environment ALIAS] [--solution UNIQUE_NAME] [options]',
      '',
      'Modes:',
      '  - Without `--environment`, inspects a local canvas source tree.',
      '  - With `--environment`, inspects a remote canvas app by display name, logical name, or id.',
      '',
      'Remote behavior:',
      '  - Requires the positional identifier plus `--environment`.',
      '  - Accepts optional `--solution` to scope remote lookup to a solution.',
      '',
      'Local behavior:',
      '  - Accepts a local canvas path plus `--project`, repeated `--registry`, `--cache-dir`, and `--mode` options.',
      '',
      'Examples:',
      '  pp canvas inspect "Harness Canvas" --environment dev --solution Core',
      '  pp canvas inspect ./apps/MyCanvas --project . --mode strict',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printSharePointHelp(): void {
  process.stdout.write(
    [
      'Usage: sharepoint <command> <action> [options]',
      '',
      'Commands:',
      '  site inspect <site|binding>              inspect a SharePoint site by URL, site id, or project binding',
      '  list inspect <list|binding> --site ...   inspect a SharePoint list by title, id, or project binding',
      '  file inspect <file|binding> --site ...   inspect a drive item by path, id, or project binding',
      '  permissions inspect --site ...           inspect site, list, or drive item permissions',
      '',
      'Binding notes:',
      '  - SharePoint bindings support `sharepoint-site`, `sharepoint-list`, and `sharepoint-file` kinds.',
      '  - `sharepoint-list` and `sharepoint-file` bindings should declare `metadata.site`; file bindings can also declare `metadata.drive`.',
      '  - Bindings can declare `metadata.authProfile` so commands do not need `--profile`.',
      '',
      'Examples:',
      '  pp sharepoint site inspect financeSite --project .',
      '  pp sharepoint list inspect Campaigns --site financeSite --profile graph-user',
      '  pp sharepoint file inspect financeBudget --project .',
      '  pp sharepoint permissions inspect --site financeSite --file /Shared Documents/Budget.xlsx --drive Documents --profile graph-user',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printPowerBiHelp(): void {
  process.stdout.write(
    [
      'Usage: powerbi <command> <action> [options]',
      '',
      'Commands:',
      '  workspace inspect <workspace|binding>                    inspect a Power BI workspace by name, id, or project binding',
      '  dataset inspect <dataset|binding> --workspace ...        inspect a dataset plus datasource and refresh metadata',
      '  report inspect <report|binding> --workspace ...          inspect a report and its workspace linkage',
      '',
      'Binding notes:',
      '  - Power BI bindings support `powerbi` or `powerbi-workspace`, plus `powerbi-dataset` and `powerbi-report`.',
      '  - Dataset and report bindings should declare `metadata.workspace` to point at a workspace binding or raw workspace name/id.',
      '  - Bindings can declare `metadata.authProfile` so commands do not need `--profile`.',
      '',
      'Examples:',
      '  pp powerbi workspace inspect financeWorkspace --project .',
      '  pp powerbi dataset inspect financeDataset --project .',
      '  pp powerbi report inspect "Executive Overview" --workspace Finance --profile powerbi-user',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printProjectHelp(): void {
  process.stdout.write(
    [
      'Usage: project <command> [options]',
      '',
      'Commands:',
      '  init [path]                 scaffold a minimal local pp project layout',
      '  doctor [path]               validate project config, assets, and required inputs',
      '  feedback [path]             capture conceptual project feedback and derive follow-up tasks',
      '  inspect [path]              inspect resolved project topology and asset roots',
      '',
      'Examples:',
      '  pp project init ./demo --name Demo --environment dev --solution Core',
      '  pp project doctor ./demo --stage prod --format json',
      '  pp project feedback ./demo --stage prod --format markdown',
      '  pp project inspect ./demo --stage prod --param releaseName=2026.03.10 --format json',
      '',
      'Notes:',
      '  - Use `pp project init --plan` or `--dry-run` to preview scaffold changes without writing files.',
      '  - `pp project doctor`, `pp project feedback`, and `pp project inspect` are read-only local-structure workflows.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printProjectInitHelp(): void {
  process.stdout.write(
    [
      'Usage: project init [path] [--name NAME] [--environment ALIAS] [--solution UNIQUE_NAME] [--stage STAGE] [options]',
      '',
      'Status:',
      '  Scaffolds a minimal local pp project layout.',
      '',
      'Behavior:',
      '  - Writes `pp.config.yaml` unless a project config already exists and `--force` is not set.',
      '  - Creates `apps/`, `flows/`, `solutions/`, `docs/`, and `artifacts/solutions/` when they do not already exist.',
      '  - Seeds one default stage, one solution alias, and one primary Dataverse provider binding.',
      '  - The scaffold is source-first: reserve `solutions/` for editable solution source and place packaged exports under `artifacts/solutions/<Solution>.zip` when the repo tracks both.',
      '',
      'Safety:',
      '  - `--help` only prints this text and never inspects or mutates the target path.',
      '  - Use `--plan` or `--dry-run` for a structured no-op preview before applying the scaffold.',
      '',
      'Options:',
      '  --name NAME                Project name to store in `pp.config.yaml`',
      '  --environment ALIAS        Default Dataverse environment alias',
      '  --solution UNIQUE_NAME     Default solution alias and unique name seed',
      '  --stage STAGE              Default topology stage name',
      '  --force                    Replace an existing project config file',
      '  --dry-run                  Render a mutation preview without side effects',
      '  --plan                     Render a mutation plan without side effects',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printProjectDoctorHelp(): void {
  process.stdout.write(
    [
      'Usage: project doctor [path] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Validates a local pp project layout.',
      '',
      'Behavior:',
      '  - Reports config presence, asset-path checks, provider bindings, topology, registries, and unresolved required parameters.',
      '  - Reads project context without mutating the filesystem.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printProjectFeedbackHelp(): void {
  process.stdout.write(
    [
      'Usage: project feedback [path] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Captures retrospective conceptual feedback for a local pp project.',
      '',
      'Behavior:',
      '  - Reuses the discovered project model to summarize workflow wins, current frictions, and concrete follow-up tasks.',
      '  - Renders the canonical bundle path and stage mappings so retrospectives can stay inside `pp`.',
      '  - Reads project context without mutating the filesystem.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printProjectInspectHelp(): void {
  process.stdout.write(
    [
      'Usage: project inspect [path] [--stage STAGE] [--param NAME=VALUE] [options]',
      '',
      'Status:',
      '  Inspects resolved local project topology and asset roots.',
      '',
      'Behavior:',
      '  - Returns project summary, resolved topology, parameters, provider bindings, asset inventory, registries, build metadata, and docs metadata.',
      '  - Reads project context without mutating the filesystem.',
      '  - Auto-selects the lone descendant `pp.config.*` under the inspected path and reports discovery details when the current path is not itself a pp project.',
      '  - Pair with `pp project doctor` for layout validation and `pp project init` to scaffold a canonical `apps/`, `flows/`, `solutions/`, and `docs/` workspace.',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

function printCompletionHelp(): void {
  process.stdout.write(
    [
      'Usage: completion <bash|zsh|fish>',
      '',
      'Status:',
      '  Emits a shell completion script for `pp`.',
      '',
      'Examples:',
      '  pp completion zsh > ~/.zfunc/_pp',
      '  autoload -U compinit && compinit',
      '  pp completion fish > ~/.config/fish/completions/pp.fish',
      '',
      'Notes:',
      '  - Completion covers top-level commands plus the next subcommand layer.',
      '  - Redirect the output into your shell completion directory; `pp` does not edit shell startup files for you.',
      '',
    ].join('\n') + '\n'
  );
}

function printDiagnosticsHelp(): void {
  process.stdout.write(
    [
      'Usage: diagnostics <doctor|bundle> [path] [options]',
      '',
      'Commands:',
      '  doctor [path]              summarize install, config, and project operability findings',
      '  bundle [path]              emit a structured debug bundle for support or CI artifacts',
      '',
      'Examples:',
      '  pp diagnostics doctor',
      '  pp diagnostics doctor ./repo --format table',
      '  pp diagnostics bundle ./repo --format json > pp-diagnostics.json',
      '',
      'Common options:',
      '  --config-dir path',
      '  --format table|json|yaml|ndjson|markdown|raw',
      '',
    ].join('\n') + '\n'
  );
}

function printDiagnosticsDoctorHelp(): void {
  process.stdout.write(
    [
      'Usage: diagnostics doctor [path] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Status:',
      '  Summarizes install, config, and local project operability findings for `pp` itself.',
      '',
      'Behavior:',
      '  - Checks whether the diagnostics target exists.',
      '  - Reports global config and MSAL cache paths plus whether they already exist.',
      '  - Tries to discover a local `pp.config.*` project and surfaces unresolved project diagnostics when one is found.',
      '',
    ].join('\n') + '\n'
  );
}

function printDiagnosticsBundleHelp(): void {
  process.stdout.write(
    [
      'Usage: diagnostics bundle [path] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]',
      '',
      'Status:',
      '  Emits a structured debug bundle for `pp` install, runtime, config, and project context.',
      '',
      'Behavior:',
      '  - Includes CLI version, runtime metadata, config roots, and project-discovery state.',
      '  - Intended for CI artifacts, support triage, or before/after troubleshooting snapshots.',
      '',
    ].join('\n') + '\n'
  );
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
