import * as cliHelp from './help';

export interface AuthGroupHandlers<TAuth, TConfigOptions> {
  runAuthProfileList(auth: TAuth, args: string[]): Promise<number>;
  runAuthProfileInspect(auth: TAuth, configOptions: TConfigOptions, args: string[]): Promise<number>;
  runAuthProfileSave(auth: TAuth, args: string[], kind: 'user' | 'static-token' | 'environment-token' | 'client-secret' | 'device-code'): Promise<number>;
  runAuthProfileRemove(auth: TAuth, args: string[]): Promise<number>;
  runAuthBrowserProfileList(auth: TAuth, args: string[]): Promise<number>;
  runAuthBrowserProfileInspect(auth: TAuth, args: string[]): Promise<number>;
  runAuthBrowserProfileSave(auth: TAuth, args: string[]): Promise<number>;
  runAuthBrowserProfileBootstrap(auth: TAuth, args: string[]): Promise<number>;
  runAuthBrowserProfileRemove(auth: TAuth, args: string[]): Promise<number>;
  runAuthLogin(auth: TAuth, args: string[]): Promise<number>;
  runAuthToken(auth: TAuth, args: string[]): Promise<number>;
}

export async function runAuthGroup<TAuth, TConfigOptions>(
  command: string | undefined,
  args: string[],
  auth: TAuth,
  configOptions: TConfigOptions,
  handlers: AuthGroupHandlers<TAuth, TConfigOptions>
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printAuthHelp();
    return 0;
  }

  if (command === 'profile') {
    const [action, ...rest] = args;

    if (!action || action === 'help' || action === '--help') {
      cliHelp.printAuthProfileHelp();
      return 0;
    }

    switch (action) {
      case 'list':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthProfileListHelp();
          return 0;
        }
        return handlers.runAuthProfileList(auth, rest);
      case 'inspect':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthProfileInspectHelp();
          return 0;
        }
        return handlers.runAuthProfileInspect(auth, configOptions, rest);
      case 'add-user':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthProfileAddUserHelp();
          return 0;
        }
        return handlers.runAuthProfileSave(auth, rest, 'user');
      case 'add-static':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthProfileAddStaticHelp();
          return 0;
        }
        return handlers.runAuthProfileSave(auth, rest, 'static-token');
      case 'add-env':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthProfileAddEnvHelp();
          return 0;
        }
        return handlers.runAuthProfileSave(auth, rest, 'environment-token');
      case 'add-client-secret':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthProfileAddClientSecretHelp();
          return 0;
        }
        return handlers.runAuthProfileSave(auth, rest, 'client-secret');
      case 'add-device-code':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthProfileAddDeviceCodeHelp();
          return 0;
        }
        return handlers.runAuthProfileSave(auth, rest, 'device-code');
      case 'remove':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthProfileRemoveHelp();
          return 0;
        }
        return handlers.runAuthProfileRemove(auth, rest);
      default:
        cliHelp.printAuthProfileHelp();
        return 1;
    }
  }

  if (command === 'browser-profile') {
    const [action, ...rest] = args;

    if (!action || action === 'help' || action === '--help') {
      cliHelp.printAuthBrowserProfileHelp();
      return 0;
    }

    switch (action) {
      case 'list':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthBrowserProfileListHelp();
          return 0;
        }
        return handlers.runAuthBrowserProfileList(auth, rest);
      case 'inspect':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthBrowserProfileInspectHelp();
          return 0;
        }
        return handlers.runAuthBrowserProfileInspect(auth, rest);
      case 'add':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthBrowserProfileAddHelp();
          return 0;
        }
        return handlers.runAuthBrowserProfileSave(auth, rest);
      case 'bootstrap':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthBrowserProfileBootstrapHelp();
          return 0;
        }
        return handlers.runAuthBrowserProfileBootstrap(auth, rest);
      case 'remove':
        if (rest.includes('--help') || rest.includes('help')) {
          cliHelp.printAuthBrowserProfileRemoveHelp();
          return 0;
        }
        return handlers.runAuthBrowserProfileRemove(auth, rest);
      default:
        cliHelp.printAuthBrowserProfileHelp();
        return 1;
    }
  }

  if (command === 'login') {
    if (args.includes('--help') || args.includes('help')) {
      cliHelp.printAuthLoginHelp();
      return 0;
    }
    return handlers.runAuthLogin(auth, args);
  }

  if (command === 'token') {
    if (args.includes('--help') || args.includes('help')) {
      cliHelp.printAuthTokenHelp();
      return 0;
    }
    return handlers.runAuthToken(auth, args);
  }

  cliHelp.printAuthHelp();
  return 1;
}

export interface EnvironmentGroupHandlers<TConfigOptions> {
  runEnvironmentList(configOptions: TConfigOptions, args: string[]): Promise<number>;
  runEnvironmentAdd(configOptions: TConfigOptions, args: string[]): Promise<number>;
  runEnvironmentInspect(configOptions: TConfigOptions, args: string[]): Promise<number>;
  runEnvironmentBaseline(configOptions: TConfigOptions, args: string[]): Promise<number>;
  runEnvironmentResolveMakerId(configOptions: TConfigOptions, args: string[]): Promise<number>;
  runEnvironmentCleanupPlan(configOptions: TConfigOptions, args: string[]): Promise<number>;
  runEnvironmentReset(configOptions: TConfigOptions, args: string[]): Promise<number>;
  runEnvironmentCleanup(configOptions: TConfigOptions, args: string[]): Promise<number>;
  runEnvironmentRemove(configOptions: TConfigOptions, args: string[]): Promise<number>;
}

export async function runEnvironmentGroup<TConfigOptions>(
  command: string | undefined,
  args: string[],
  configOptions: TConfigOptions,
  handlers: EnvironmentGroupHandlers<TConfigOptions>
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printEnvironmentHelp();
    return 0;
  }

  switch (command) {
    case 'list':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentListHelp();
        return 0;
      }
      return handlers.runEnvironmentList(configOptions, args);
    case 'add':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentAddHelp();
        return 0;
      }
      return handlers.runEnvironmentAdd(configOptions, args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentInspectHelp();
        return 0;
      }
      return handlers.runEnvironmentInspect(configOptions, args);
    case 'baseline':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentBaselineHelp();
        return 0;
      }
      return handlers.runEnvironmentBaseline(configOptions, args);
    case 'resolve-maker-id':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentResolveMakerIdHelp();
        return 0;
      }
      return handlers.runEnvironmentResolveMakerId(configOptions, args);
    case 'cleanup-plan':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentCleanupPlanHelp();
        return 0;
      }
      return handlers.runEnvironmentCleanupPlan(configOptions, args);
    case 'reset':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentResetHelp();
        return 0;
      }
      return handlers.runEnvironmentReset(configOptions, args);
    case 'cleanup':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentCleanupHelp();
        return 0;
      }
      return handlers.runEnvironmentCleanup(configOptions, args);
    case 'remove':
      return handlers.runEnvironmentRemove(configOptions, args);
    default:
      cliHelp.printEnvironmentHelp();
      return 1;
  }
}

export interface ProjectGroupHandlers {
  runProjectInit(args: string[]): Promise<number>;
  runProjectDoctor(args: string[]): Promise<number>;
  runProjectFeedback(args: string[]): Promise<number>;
  runProjectInspect(args: string[]): Promise<number>;
}

export interface InitGroupHandlers {
  runInitStart(args: string[]): Promise<number>;
  runInitStatus(args: string[]): Promise<number>;
  runInitResume(args: string[]): Promise<number>;
  runInitAnswer(args: string[]): Promise<number>;
  runInitCancel(args: string[]): Promise<number>;
}

export async function runProjectGroup(
  command: string | undefined,
  args: string[],
  handlers: ProjectGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printProjectHelp();
    return 0;
  }

  switch (command) {
    case 'init':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printProjectInitHelp();
        return 0;
      }
      return handlers.runProjectInit(args);
    case 'doctor':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printProjectDoctorHelp();
        return 0;
      }
      return handlers.runProjectDoctor(args);
    case 'feedback':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printProjectFeedbackHelp();
        return 0;
      }
      return handlers.runProjectFeedback(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printProjectInspectHelp();
        return 0;
      }
      return handlers.runProjectInspect(args);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

export async function runInitGroup(command: string | undefined, args: string[], handlers: InitGroupHandlers): Promise<number> {
  const knownSubcommands = new Set(['start', 'status', 'resume', 'answer', 'cancel', 'help', '--help']);

  if (!command || !knownSubcommands.has(command) || command === 'start') {
    const startArgs = !command || command === 'start' ? args : [command, ...args];
    if (startArgs.includes('--help') || startArgs.includes('help')) {
      cliHelp.printInitHelp();
      return 0;
    }
    return handlers.runInitStart(startArgs);
  }

  switch (command) {
    case 'help':
    case '--help':
      cliHelp.printInitHelp();
      return 0;
    case 'status':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printInitStatusHelp();
        return 0;
      }
      return handlers.runInitStatus(args);
    case 'resume':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printInitResumeHelp();
        return 0;
      }
      return handlers.runInitResume(args);
    case 'answer':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printInitAnswerHelp();
        return 0;
      }
      return handlers.runInitAnswer(args);
    case 'cancel':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printInitCancelHelp();
        return 0;
      }
      return handlers.runInitCancel(args);
    default:
      cliHelp.printInitHelp();
      return 1;
  }
}

export interface AnalysisGroupHandlers {
  runAnalysisReport(args: string[]): Promise<number>;
  runAnalysisContext(args: string[]): Promise<number>;
  runAnalysisPortfolio(args: string[]): Promise<number>;
  runAnalysisDrift(args: string[]): Promise<number>;
  runAnalysisUsage(args: string[]): Promise<number>;
  runAnalysisPolicy(args: string[]): Promise<number>;
}

export async function runAnalysisGroup(
  command: string | undefined,
  args: string[],
  handlers: AnalysisGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printAnalysisHelp();
    return 0;
  }

  switch (command) {
    case 'report':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printAnalysisReportHelp();
        return 0;
      }
      return handlers.runAnalysisReport(args);
    case 'context':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printAnalysisContextHelp();
        return 0;
      }
      return handlers.runAnalysisContext(args);
    case 'portfolio':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printAnalysisPortfolioHelp();
        return 0;
      }
      return handlers.runAnalysisPortfolio(args);
    case 'drift':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printAnalysisPortfolioViewHelp('drift');
        return 0;
      }
      return handlers.runAnalysisDrift(args);
    case 'usage':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printAnalysisPortfolioViewHelp('usage');
        return 0;
      }
      return handlers.runAnalysisUsage(args);
    case 'policy':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printAnalysisPortfolioViewHelp('policy');
        return 0;
      }
      return handlers.runAnalysisPolicy(args);
    default:
      cliHelp.printAnalysisHelp();
      return 1;
  }
}

export interface DeployGroupHandlers {
  runDeployPlan(args: string[]): Promise<number>;
  runDeployApply(args: string[]): Promise<number>;
  runDeployRelease(args: string[]): Promise<number>;
}

export async function runDeployGroup(
  command: string | undefined,
  args: string[],
  handlers: DeployGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printDeployHelp();
    return 0;
  }

  switch (command) {
    case 'plan':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printDeployPlanHelp();
        return 0;
      }
      return handlers.runDeployPlan(args);
    case 'apply':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printDeployApplyHelp();
        return 0;
      }
      return handlers.runDeployApply(args);
    case 'release':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printDeployReleaseHelp();
        return 0;
      }
      return handlers.runDeployRelease(args);
    default:
      cliHelp.printDeployHelp();
      return 1;
  }
}

export interface DiagnosticsGroupHandlers {
  runDiagnosticsDoctor(args: string[]): Promise<number>;
  runDiagnosticsBundle(args: string[]): Promise<number>;
}

export async function runDiagnosticsGroup(
  command: string | undefined,
  args: string[],
  handlers: DiagnosticsGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printDiagnosticsHelp();
    return 0;
  }

  switch (command) {
    case 'doctor':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printDiagnosticsDoctorHelp();
        return 0;
      }
      return handlers.runDiagnosticsDoctor(args);
    case 'bundle':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printDiagnosticsBundleHelp();
        return 0;
      }
      return handlers.runDiagnosticsBundle(args);
    default:
      cliHelp.printDiagnosticsHelp();
      return 1;
  }
}

export interface SharePointGroupHandlers {
  runSharePointSiteInspect(args: string[]): Promise<number>;
  runSharePointListInspect(args: string[]): Promise<number>;
  runSharePointFileInspect(args: string[]): Promise<number>;
  runSharePointPermissionsInspect(args: string[]): Promise<number>;
}

export async function runSharePointGroup(
  command: string | undefined,
  args: string[],
  handlers: SharePointGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printSharePointHelp();
    return 0;
  }

  const [action, ...rest] = args;

  if (!action || action === 'help' || action === '--help' || rest.includes('--help') || rest.includes('help')) {
    cliHelp.printSharePointHelp();
    return 0;
  }

  switch (`${command} ${action}`) {
    case 'site inspect':
      return handlers.runSharePointSiteInspect(rest);
    case 'list inspect':
      return handlers.runSharePointListInspect(rest);
    case 'file inspect':
      return handlers.runSharePointFileInspect(rest);
    case 'permissions inspect':
      return handlers.runSharePointPermissionsInspect(rest);
    default:
      cliHelp.printSharePointHelp();
      return 1;
  }
}

export interface PowerBiGroupHandlers {
  runPowerBiWorkspaceInspect(args: string[]): Promise<number>;
  runPowerBiDatasetInspect(args: string[]): Promise<number>;
  runPowerBiReportInspect(args: string[]): Promise<number>;
}

export async function runPowerBiGroup(
  command: string | undefined,
  args: string[],
  handlers: PowerBiGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printPowerBiHelp();
    return 0;
  }

  const [action, ...rest] = args;

  if (!action || action === 'help' || action === '--help' || rest.includes('--help') || rest.includes('help')) {
    cliHelp.printPowerBiHelp();
    return 0;
  }

  switch (`${command} ${action}`) {
    case 'workspace inspect':
      return handlers.runPowerBiWorkspaceInspect(rest);
    case 'dataset inspect':
      return handlers.runPowerBiDatasetInspect(rest);
    case 'report inspect':
      return handlers.runPowerBiReportInspect(rest);
    default:
      cliHelp.printPowerBiHelp();
      return 1;
  }
}

export interface DataverseGroupHandlers {
  positionalArgs(args: string[]): string[];
  runDataverseWhoAmI(args: string[]): Promise<number>;
  runDataverseRequest(args: string[]): Promise<number>;
  runDataverseAction(args: string[]): Promise<number>;
  runDataverseFunction(args: string[]): Promise<number>;
  runDataverseBatch(args: string[]): Promise<number>;
  runDataverseRows(args: string[]): Promise<number>;
  runDataverseQuery(args: string[]): Promise<number>;
  runDataverseGet(args: string[]): Promise<number>;
  runDataverseCreate(args: string[]): Promise<number>;
  runDataverseUpdate(args: string[]): Promise<number>;
  runDataverseDelete(args: string[]): Promise<number>;
  runDataverseMetadata(args: string[]): Promise<number>;
}

export async function runDataverseGroup(
  command: string | undefined,
  args: string[],
  handlers: DataverseGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printDataverseHelp();
    return 0;
  }

  switch (command) {
    case 'whoami':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printDataverseWhoAmIHelp();
        return 0;
      }
      return handlers.runDataverseWhoAmI(args);
    case 'request':
      return handlers.runDataverseRequest(args);
    case 'action':
      return handlers.runDataverseAction(args);
    case 'function':
      return handlers.runDataverseFunction(args);
    case 'batch':
      return handlers.runDataverseBatch(args);
    case 'rows':
      if (args.includes('--help') || args.includes('help')) {
        const [action] = handlers.positionalArgs(args);

        if (action === 'export') {
          cliHelp.printDataverseRowsExportHelp();
        } else if (action === 'apply') {
          cliHelp.printDataverseRowsApplyHelp();
        } else {
          cliHelp.printDataverseRowsHelp();
        }
        return 0;
      }
      return handlers.runDataverseRows(args);
    case 'query':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printDataverseQueryHelp();
        return 0;
      }
      return handlers.runDataverseQuery(args);
    case 'get':
      return handlers.runDataverseGet(args);
    case 'create':
      return handlers.runDataverseCreate(args);
    case 'update':
      return handlers.runDataverseUpdate(args);
    case 'delete':
      return handlers.runDataverseDelete(args);
    case 'metadata':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printDataverseMetadataHelp();
        return 0;
      }
      return handlers.runDataverseMetadata(args);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

export interface SolutionGroupHandlers {
  runSolutionCreate(args: string[]): Promise<number>;
  runSolutionDelete(args: string[]): Promise<number>;
  runSolutionSetMetadata(args: string[]): Promise<number>;
  runSolutionPublish(args: string[]): Promise<number>;
  runSolutionSyncStatus(args: string[]): Promise<number>;
  runSolutionCheckpoint(args: string[]): Promise<number>;
  runSolutionList(args: string[]): Promise<number>;
  runSolutionPublishers(args: string[]): Promise<number>;
  runSolutionInspect(args: string[]): Promise<number>;
  runSolutionComponents(args: string[]): Promise<number>;
  runSolutionDependencies(args: string[]): Promise<number>;
  runSolutionAnalyze(args: string[]): Promise<number>;
  runSolutionCompare(args: string[]): Promise<number>;
  runSolutionExport(args: string[]): Promise<number>;
  runSolutionImport(args: string[]): Promise<number>;
  runSolutionPack(args: string[]): Promise<number>;
  runSolutionUnpack(args: string[]): Promise<number>;
}

export async function runSolutionGroup(
  command: string | undefined,
  args: string[],
  handlers: SolutionGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printSolutionHelp();
    return 0;
  }

  switch (command) {
    case 'create':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionCreateHelp();
        return 0;
      }
      return handlers.runSolutionCreate(args);
    case 'delete':
      return handlers.runSolutionDelete(args);
    case 'set-metadata':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionSetMetadataHelp();
        return 0;
      }
      return handlers.runSolutionSetMetadata(args);
    case 'publish':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionPublishHelp();
        return 0;
      }
      return handlers.runSolutionPublish(args);
    case 'sync-status':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionSyncStatusHelp();
        return 0;
      }
      return handlers.runSolutionSyncStatus(args);
    case 'checkpoint':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionCheckpointHelp();
        return 0;
      }
      return handlers.runSolutionCheckpoint(args);
    case 'list':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionListHelp();
        return 0;
      }
      return handlers.runSolutionList(args);
    case 'publishers':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionPublishersHelp();
        return 0;
      }
      return handlers.runSolutionPublishers(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionInspectHelp();
        return 0;
      }
      return handlers.runSolutionInspect(args);
    case 'components':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionComponentsHelp();
        return 0;
      }
      return handlers.runSolutionComponents(args);
    case 'dependencies':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionDependenciesHelp();
        return 0;
      }
      return handlers.runSolutionDependencies(args);
    case 'analyze':
      return handlers.runSolutionAnalyze(args);
    case 'compare':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionCompareHelp();
        return 0;
      }
      return handlers.runSolutionCompare(args);
    case 'export':
      return handlers.runSolutionExport(args);
    case 'import':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printSolutionImportHelp();
        return 0;
      }
      return handlers.runSolutionImport(args);
    case 'pack':
      return handlers.runSolutionPack(args);
    case 'unpack':
      return handlers.runSolutionUnpack(args);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

export interface ConnectionReferenceGroupHandlers {
  runConnectionReferenceCreate(args: string[]): Promise<number>;
  runConnectionReferenceList(args: string[]): Promise<number>;
  runConnectionReferenceInspect(args: string[]): Promise<number>;
  runConnectionReferenceSet(args: string[]): Promise<number>;
  runConnectionReferenceValidate(args: string[]): Promise<number>;
}

export async function runConnectionReferenceGroup(
  command: string | undefined,
  args: string[],
  handlers: ConnectionReferenceGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printConnectionReferenceHelp();
    return 0;
  }

  switch (command) {
    case 'create':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printConnectionReferenceCreateHelp();
        return 0;
      }
      return handlers.runConnectionReferenceCreate(args);
    case 'list':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printConnectionReferenceListHelp();
        return 0;
      }
      return handlers.runConnectionReferenceList(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printConnectionReferenceInspectHelp();
        return 0;
      }
      return handlers.runConnectionReferenceInspect(args);
    case 'set':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printConnectionReferenceSetHelp();
        return 0;
      }
      return handlers.runConnectionReferenceSet(args);
    case 'validate':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printConnectionReferenceValidateHelp();
        return 0;
      }
      return handlers.runConnectionReferenceValidate(args);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

export interface EnvironmentVariableGroupHandlers {
  runEnvironmentVariableCreate(args: string[]): Promise<number>;
  runEnvironmentVariableList(args: string[]): Promise<number>;
  runEnvironmentVariableInspect(args: string[]): Promise<number>;
  runEnvironmentVariableSet(args: string[]): Promise<number>;
}

export async function runEnvironmentVariableGroup(
  command: string | undefined,
  args: string[],
  handlers: EnvironmentVariableGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printEnvironmentVariableHelp();
    return 0;
  }

  switch (command) {
    case 'create':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentVariableCreateHelp();
        return 0;
      }
      return handlers.runEnvironmentVariableCreate(args);
    case 'list':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentVariableListHelp();
        return 0;
      }
      return handlers.runEnvironmentVariableList(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentVariableInspectHelp();
        return 0;
      }
      return handlers.runEnvironmentVariableInspect(args);
    case 'set':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printEnvironmentVariableSetHelp();
        return 0;
      }
      return handlers.runEnvironmentVariableSet(args);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

export interface CanvasGroupHandlers {
  runCanvasAttach(args: string[]): Promise<number>;
  runCanvasDownload(args: string[]): Promise<number>;
  runCanvasImport(args: string[]): Promise<number>;
  runCanvasUnsupportedRemoteMutation(command: 'create' | 'import', args: string[]): Promise<number>;
  runCanvasList(args: string[]): Promise<number>;
  runCanvasAccess(args: string[]): Promise<number>;
  runCanvasTemplates(args: string[]): Promise<number>;
  runCanvasWorkspace(args: string[]): Promise<number>;
  runCanvasPatch(args: string[]): Promise<number>;
  runCanvasLint(args: string[]): Promise<number>;
  runCanvasValidate(args: string[]): Promise<number>;
  runCanvasInspect(args: string[]): Promise<number>;
  runCanvasBuild(args: string[]): Promise<number>;
  runCanvasDiff(args: string[]): Promise<number>;
}

export async function runCanvasGroup(
  command: string | undefined,
  args: string[],
  handlers: CanvasGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printCanvasHelp();
    return 0;
  }

  switch (command) {
    case 'attach':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printCanvasAttachHelp();
        return 0;
      }
      return handlers.runCanvasAttach(args);
    case 'download':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printCanvasDownloadHelp();
        return 0;
      }
      return handlers.runCanvasDownload(args);
    case 'create':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printCanvasCreateHelp();
        return 0;
      }
      return handlers.runCanvasUnsupportedRemoteMutation('create', args);
    case 'import':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printCanvasImportHelp();
        return 0;
      }
      return handlers.runCanvasImport(args);
    case 'list':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printCanvasListHelp();
        return 0;
      }
      return handlers.runCanvasList(args);
    case 'access':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printCanvasAccessHelp();
        return 0;
      }
      return handlers.runCanvasAccess(args);
    case 'templates':
      return handlers.runCanvasTemplates(args);
    case 'workspace':
      return handlers.runCanvasWorkspace(args);
    case 'patch':
      return handlers.runCanvasPatch(args);
    case 'lint':
      return handlers.runCanvasLint(args);
    case 'validate':
      return handlers.runCanvasValidate(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printCanvasInspectHelp();
        return 0;
      }
      return handlers.runCanvasInspect(args);
    case 'build':
      return handlers.runCanvasBuild(args);
    case 'diff':
      return handlers.runCanvasDiff(args);
    default:
      cliHelp.printHelp();
      return 1;
  }
}

export interface FlowGroupHandlers {
  runFlowList(args: string[]): Promise<number>;
  runFlowInspect(args: string[]): Promise<number>;
  runFlowExport(args: string[]): Promise<number>;
  runFlowPromote(args: string[]): Promise<number>;
  runFlowUnpack(args: string[]): Promise<number>;
  runFlowPack(args: string[]): Promise<number>;
  runFlowDeploy(args: string[]): Promise<number>;
  runFlowNormalize(args: string[]): Promise<number>;
  runFlowValidate(args: string[]): Promise<number>;
  runFlowGraph(args: string[]): Promise<number>;
  runFlowPatch(args: string[]): Promise<number>;
  runFlowRuns(args: string[]): Promise<number>;
  runFlowMonitor(args: string[]): Promise<number>;
  runFlowErrors(args: string[]): Promise<number>;
  runFlowConnrefs(args: string[]): Promise<number>;
  runFlowDoctor(args: string[]): Promise<number>;
  runFlowAccess(args: string[]): Promise<number>;
}

export async function runFlowGroup(
  command: string | undefined,
  args: string[],
  handlers: FlowGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printFlowHelp();
    return 0;
  }

  switch (command) {
    case 'list':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowListHelp();
        return 0;
      }
      return handlers.runFlowList(args);
    case 'inspect':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowInspectHelp();
        return 0;
      }
      return handlers.runFlowInspect(args);
    case 'export':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowExportHelp();
        return 0;
      }
      return handlers.runFlowExport(args);
    case 'promote':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowPromoteHelp();
        return 0;
      }
      return handlers.runFlowPromote(args);
    case 'unpack':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowUnpackHelp();
        return 0;
      }
      return handlers.runFlowUnpack(args);
    case 'pack':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowPackHelp();
        return 0;
      }
      return handlers.runFlowPack(args);
    case 'deploy':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowDeployHelp();
        return 0;
      }
      return handlers.runFlowDeploy(args);
    case 'normalize':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowNormalizeHelp();
        return 0;
      }
      return handlers.runFlowNormalize(args);
    case 'validate':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowValidateHelp();
        return 0;
      }
      return handlers.runFlowValidate(args);
    case 'graph':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowGraphHelp();
        return 0;
      }
      return handlers.runFlowGraph(args);
    case 'patch':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowPatchHelp();
        return 0;
      }
      return handlers.runFlowPatch(args);
    case 'runs':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowRunsHelp();
        return 0;
      }
      return handlers.runFlowRuns(args);
    case 'monitor':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowMonitorHelp();
        return 0;
      }
      return handlers.runFlowMonitor(args);
    case 'errors':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowErrorsHelp();
        return 0;
      }
      return handlers.runFlowErrors(args);
    case 'connrefs':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowConnrefsHelp();
        return 0;
      }
      return handlers.runFlowConnrefs(args);
    case 'doctor':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowDoctorHelp();
        return 0;
      }
      return handlers.runFlowDoctor(args);
    case 'access':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printFlowAccessHelp();
        return 0;
      }
      return handlers.runFlowAccess(args);
    default:
      cliHelp.printFlowHelp();
      return 1;
  }
}

export interface ModelGroupHandlers {
  runModelCreate(args: string[]): Promise<number>;
  runModelAttach(args: string[]): Promise<number>;
  runModelList(args: string[]): Promise<number>;
  runModelInspect(args: string[]): Promise<number>;
  runModelAccess(args: string[]): Promise<number>;
  runModelComposition(args: string[]): Promise<number>;
  runModelImpact(args: string[]): Promise<number>;
  runModelSitemap(args: string[]): Promise<number>;
  runModelForms(args: string[]): Promise<number>;
  runModelViews(args: string[]): Promise<number>;
  runModelDependencies(args: string[]): Promise<number>;
  runModelPatch(args: string[]): Promise<number>;
}

export async function runModelGroup(
  command: string | undefined,
  args: string[],
  handlers: ModelGroupHandlers
): Promise<number> {
  if (!command || command === 'help' || command === '--help') {
    cliHelp.printModelHelp();
    return 0;
  }

  switch (command) {
    case 'create':
      return handlers.runModelCreate(args);
    case 'attach':
      return handlers.runModelAttach(args);
    case 'list':
      return handlers.runModelList(args);
    case 'inspect':
      return handlers.runModelInspect(args);
    case 'access':
      if (args.includes('--help') || args.includes('help')) {
        cliHelp.printModelAccessHelp();
        return 0;
      }
      return handlers.runModelAccess(args);
    case 'composition':
      return handlers.runModelComposition(args);
    case 'impact':
      return handlers.runModelImpact(args);
    case 'sitemap':
      return handlers.runModelSitemap(args);
    case 'forms':
      return handlers.runModelForms(args);
    case 'views':
      return handlers.runModelViews(args);
    case 'dependencies':
      return handlers.runModelDependencies(args);
    case 'patch':
      return handlers.runModelPatch(args);
    default:
      cliHelp.printHelp();
      return 1;
  }
}
