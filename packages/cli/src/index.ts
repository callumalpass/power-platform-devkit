#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { readJsonFile, writeJsonFile } from '@pp/artifacts';
import {
  AuthService,
  createTokenProvider,
  resolveBrowserProfileDirectory,
  summarizeProfile,
  type AuthProfile,
} from '@pp/auth';
import { CanvasService, deriveCanvasStudioEditUrl, type CanvasBuildMode, type CanvasTemplateProvenance } from '@pp/canvas';
import {
  createMutationPreview,
  createSuccessPayload,
  readMutationFlags,
} from './contract';
import { getEnvironmentAlias, listEnvironments, removeEnvironmentAlias, saveEnvironmentAlias, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import {
  CanvasAppService,
  CloudFlowService,
  buildMetadataContractSchema,
  buildMetadataScaffold,
  DataverseClient,
  listColumnCreateKinds,
  parseColumnCreateSpec,
  parseColumnUpdateSpec,
  type DataverseBatchRequest,
  type DataverseRowApplyOperation,
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
  ModelDrivenAppService,
  normalizeAttributeDefinition,
  normalizeAttributeDefinitions,
  type DataverseMetadataApplyResult,
  normalizeGlobalOptionSetDefinition,
  normalizeRelationshipDefinition,
  resolveDataverseClient,
  type DataverseResolution,
  type ColumnCreateKind,
  type MetadataApplyPlan,
  type AttributeMetadataView,
  type DataverseMetadataSnapshot,
  type RelationshipMetadataKind,
} from '@pp/dataverse';
import { fail, ok, createDiagnostic, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { FlowService, type FlowWorkflowStateLabel } from '@pp/flow';
import { HttpClient } from '@pp/http';
import { startReadFirstMcpServer } from '@pp/mcp';
import { ModelService, type ModelArtifactMutationKind, type ModelInspectResult } from '@pp/model';
import { SolutionService, type SolutionAnalysis, type SolutionPackageType } from '@pp/solution';
import { launchPersistentBrowserProfileContext } from './browser-profile-playwright';
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
  runCanvasGroup,
  runConnectionReferenceGroup,
  runDataverseGroup,
  runDiagnosticsGroup,
  runEnvironmentGroup,
  runEnvironmentVariableGroup,
  runFlowGroup,
  runModelGroup,
  runSolutionGroup,
} from './command-groups';
import { dispatchCommandRoute } from './command-dispatch';
import {
  argumentFailure,
  hasFlag,
  isMachineReadableOutputFormat,
  isRecord,
  maybeHandleMutationPreview,
  outputFormat,
  pathExists,
  positionalArgs,
  printByFormat,
  printFailure,
  printFailureWithMachinePayload,
  printResultDiagnostics,
  printWarnings,
  promptForEnter,
  promptForInput,
  readAnalysisPortfolioProjectPaths,
  readConfigOptions,
  readFlag,
  readHeaderFlags,
  readJsonBodyArgument,
  readJsonFileForCli,
  readListFlag,
  readNumberFlag,
  readProjectDiscoveryOptions,
  readPublicClientLoginOptions,
  readRepeatedFlags,
  readSolutionOutputTarget,
  readStringArrayValue,
  readStructuredSpecArgument,
  readStructuredSpecFile,
  readValueFlag,
  dedupeStrings,
  resolveDefaultInvocationPath,
  resolveInvocationPath,
  resolveOptionalInvocationPath,
  type OutputFormat,
  writeStructuredArtifact,
} from './cli-support';
import {
  discoverMakerEnvironmentIdForEnvironment,
  readEnvironmentAlias,
  readEnvironmentDefaultSolution,
  resolveCanvasMakerEnvironmentId,
  resolveDataverseClientByFlag,
  resolveDataverseClientForCli,
  resolveSolutionIdForCli,
} from './cli-resolution';
import { enforceWriteAccessForCliArgs } from './cli-access';
import { createTopLevelCommandRunners } from './top-level-command-runners';
import {
  runSolutionAnalyzeCommand,
  runSolutionComponentsCommand,
  runSolutionCompareCommand,
  runSolutionCheckpointCommand,
  runSolutionCreateCommand,
  runSolutionDeleteCommand,
  runSolutionDependenciesCommand,
  runSolutionExportCommand,
  runSolutionImportCommand,
  runSolutionInspectCommand,
  runSolutionListCommand,
  runSolutionPublishersCommand,
  runSolutionPackCommand,
  runSolutionPublishCommand,
  runSolutionSyncStatusCommand,
  runSolutionSetMetadataCommand,
  runSolutionUnpackCommand,
  createLocalSolutionService,
} from './solution-commands';
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
  buildPacEnvironmentGuidance,
  runEnvironmentAddCommand,
  runEnvironmentBaselineCommand,
  runEnvironmentInspectCommand,
  runEnvironmentListCommand,
  runEnvironmentRemoveCommand,
  runEnvironmentResolveMakerIdCommand,
} from './environment-commands';
import {
  runConnectionReferenceCreate,
  runConnectionReferenceInspect,
  runConnectionReferenceList,
  runConnectionReferenceSet,
  runConnectionReferenceValidate,
} from './connection-reference-commands';
import {
  runEnvironmentVariableCreate,
  runEnvironmentVariableInspect,
  runEnvironmentVariableList,
  runEnvironmentVariableSet,
} from './environment-variable-commands';
import {
  runDataverseAction,
  runDataverseBatch,
  runDataverseCreate,
  runDataverseDelete,
  runDataverseFunction,
  runDataverseGet,
  runDataverseMetadata,
  runDataverseQuery,
  runDataverseRequest,
  runDataverseRows,
  runDataverseUpdate,
  runDataverseWhoAmI,
} from './dataverse-commands';
import {
  runCanvasAccess,
  runCanvasAttach,
  runCanvasBuild,
  runCanvasDiff,
  runCanvasDownload,
  runCanvasImport,
  runCanvasInspect,
  runCanvasLint,
  runCanvasList,
  runCanvasPatch,
  runCanvasProbe,
  runCanvasTemplates,
  runCanvasValidate,
  runCanvasWorkspace,
} from './canvas-commands';
import {
  runFlowAccess,
  runFlowActivate,
  runFlowAttach,
  runFlowConnrefs,
  runFlowExport,
  runFlowInspect,
  runFlowList,
  runFlowLsp,
  runFlowNormalize,
  runFlowValidate,
  runModelAccess,
  runModelAttach,
  runModelComposition,
  runModelCreate,
  runModelDependencies,
  runModelForms,
  runModelImpact,
  runModelInspect,
  runModelList,
  runModelPatch,
  runModelSitemap,
  runModelViews,
} from './flow-model-commands';
import { dispatchMainCommand } from './routing';

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
const ATTRIBUTE_SELECT_TO_NORMALIZED_FIELD = new Map<string, string>([
  ['LogicalName', 'logicalName'],
  ['SchemaName', 'schemaName'],
  ['DisplayName', 'displayName'],
  ['Description', 'description'],
  ['EntityLogicalName', 'entityLogicalName'],
  ['MetadataId', 'metadataId'],
  ['AttributeType', 'attributeType'],
  ['AttributeTypeName', 'attributeTypeName'],
  ['RequiredLevel', 'requiredLevel'],
  ['IsPrimaryId', 'primaryId'],
  ['IsPrimaryName', 'primaryName'],
  ['IsCustomAttribute', 'custom'],
  ['IsManaged', 'managed'],
  ['IsLogical', 'logical'],
  ['IsValidForCreate', 'createable'],
  ['IsValidForRead', 'readable'],
  ['IsValidForUpdate', 'updateable'],
  ['IsFilterable', 'filterable'],
  ['IsSearchable', 'searchable'],
  ['IsValidForAdvancedFind', 'advancedFind'],
  ['IsSecured', 'secured'],
]);
const topLevelCommandRunners = createTopLevelCommandRunners(
  {
    outputFormat,
    positionalArgs,
    printByFormat,
    printFailure,
    renderCompletionScript,
    cliPackageName: CLI_PACKAGE_NAME,
    cliVersion: CLI_VERSION,
  },
  {
    runDiagnosticsGroup,
  }
);

export async function main(argv: string[]): Promise<number> {
  return dispatchMainCommand(argv, {
    runVersion: topLevelCommandRunners.runVersion,
    runCompletion: topLevelCommandRunners.runCompletion,
    runMcp,
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
    printFailureForInvalidFormat: (result) => printFailure(result),
  });
}

async function runMcp(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printMcpHelp();
    return 0;
  }

  if (command !== 'serve') {
    cliHelp.printMcpHelp();
    return 1;
  }

  if (args.includes('--help') || args.includes('help')) {
    cliHelp.printMcpServeHelp();
    return 0;
  }

  const { server } = await startReadFirstMcpServer({
    configDir: readConfigOptions(args).configDir,
    projectPath: resolveOptionalInvocationPath(readFlag(args, '--project')),
    allowInteractiveAuth: hasFlag(args, '--allow-interactive-auth'),
  });

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });

  return 0;
}


async function runDiagnostics(command: string | undefined, args: string[]): Promise<number> {
  return topLevelCommandRunners.runDiagnostics(command, args, { runDiagnosticsDoctor, runDiagnosticsBundle });
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
    runEnvironmentBaseline,
    runEnvironmentResolveMakerId,
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
    runSolutionPublish,
    runSolutionSyncStatus,
    runSolutionCheckpoint,
    runSolutionList,
    runSolutionPublishers,
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
    runConnectionReferenceCreate,
    runConnectionReferenceList,
    runConnectionReferenceInspect,
    runConnectionReferenceSet,
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
    runCanvasAttach,
    runCanvasDownload,
    runCanvasImport,
    runCanvasList,
    runCanvasProbe,
    runCanvasAccess,
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

async function runFlow(command: string | undefined, args: string[]): Promise<number> {
  return runFlowGroup(command, args, {
    runFlowList,
    runFlowInspect,
    runFlowAttach,
    runFlowExport,
    runFlowActivate,
    runFlowNormalize,
    runFlowValidate,
    runFlowConnrefs,
    runFlowAccess,
    runFlowLsp,
  });
}

async function runModel(command: string | undefined, args: string[]): Promise<number> {
  return runModelGroup(command, args, {
    runModelCreate,
    runModelAttach,
    runModelList,
    runModelInspect,
    runModelAccess,
    runModelComposition,
    runModelImpact,
    runModelSitemap,
    runModelForms,
    runModelViews,
    runModelDependencies,
    runModelPatch,
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
    readRepeatedFlags,
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
    readRepeatedFlags,
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
    readRepeatedFlags,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
}

async function runEnvironmentBaseline(configOptions: ConfigStoreOptions, args: string[]): Promise<number> {
  return runEnvironmentBaselineCommand(configOptions, args, {
    positionalArgs,
    readRepeatedFlags,
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
    readRepeatedFlags,
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
    readRepeatedFlags,
    outputFormat,
    printFailure,
    printByFormat,
    printWarnings,
    readFlag,
    argumentFailure,
    discoverMakerEnvironmentIdForEnvironment,
  });
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

async function runSolutionPublishers(args: string[]): Promise<number> {
  return runSolutionPublishersCommand(args, {
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
  const accessCheck = await enforceWriteAccessForCliArgs(args, 'solution.create');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

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

async function runSolutionCheckpoint(args: string[]): Promise<number> {
  return runSolutionCheckpointCommand(args, {
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

async function runSolutionDelete(args: string[]): Promise<number> {
  const accessCheck = await enforceWriteAccessForCliArgs(args, 'solution.delete');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

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
  const accessCheck = await enforceWriteAccessForCliArgs(args, 'solution.set-metadata');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

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

async function runSolutionPublish(args: string[]): Promise<number> {
  const accessCheck = await enforceWriteAccessForCliArgs(args, 'solution.publish');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

  return runSolutionPublishCommand(args, {
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

async function runSolutionSyncStatus(args: string[]): Promise<number> {
  return runSolutionSyncStatusCommand(args, {
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
  const accessCheck = await enforceWriteAccessForCliArgs(args, 'solution.import');

  if (accessCheck !== undefined) {
    return accessCheck;
  }

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


function readSolutionPackageTypeFlag(args: string[]): OperationResult<SolutionPackageType> {
  const value = readFlag(args, '--package-type') ?? 'both';

  if (value === 'managed' || value === 'unmanaged' || value === 'both') {
    return ok(value, {
      supportTier: 'preview',
    });
  }

  return argumentFailure('SOLUTION_PACKAGE_TYPE_INVALID', 'Use --package-type managed, unmanaged, or both.');
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];

  if (!entryPath) {
    return false;
  }

  try {
    const resolvedEntryPath = realpathSync(resolvePath(entryPath)).replaceAll('\\', '/');
    return (
      resolvedEntryPath.endsWith('/packages/cli/src/index.ts') ||
      resolvedEntryPath.endsWith('/packages/cli/dist/index.js') ||
      resolvedEntryPath.endsWith('/packages/cli/dist/index.cjs')
    );
  } catch {
    return false;
  }
}

function resolveCurrentModulePath(): string | undefined {
  return typeof __filename === 'string' ? __filename : undefined;
}

if (isDirectExecution()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
