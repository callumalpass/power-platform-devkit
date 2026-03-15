import * as cliHelp from './help';
import { dispatchCommandRoute } from './command-dispatch';

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
  return dispatchCommandRoute(
    {
      help: cliHelp.printAuthHelp,
      children: [
        {
          name: 'profile',
          help: cliHelp.printAuthProfileHelp,
          children: [
            { name: 'list', help: cliHelp.printAuthProfileListHelp, run: (rest) => handlers.runAuthProfileList(auth, rest) },
            {
              name: 'inspect',
              help: cliHelp.printAuthProfileInspectHelp,
              run: (rest) => handlers.runAuthProfileInspect(auth, configOptions, rest),
            },
            { name: 'add-user', help: cliHelp.printAuthProfileAddUserHelp, run: (rest) => handlers.runAuthProfileSave(auth, rest, 'user') },
            {
              name: 'add-static',
              help: cliHelp.printAuthProfileAddStaticHelp,
              run: (rest) => handlers.runAuthProfileSave(auth, rest, 'static-token'),
            },
            {
              name: 'add-env',
              help: cliHelp.printAuthProfileAddEnvHelp,
              run: (rest) => handlers.runAuthProfileSave(auth, rest, 'environment-token'),
            },
            {
              name: 'add-client-secret',
              help: cliHelp.printAuthProfileAddClientSecretHelp,
              run: (rest) => handlers.runAuthProfileSave(auth, rest, 'client-secret'),
            },
            {
              name: 'add-device-code',
              help: cliHelp.printAuthProfileAddDeviceCodeHelp,
              run: (rest) => handlers.runAuthProfileSave(auth, rest, 'device-code'),
            },
            { name: 'remove', help: cliHelp.printAuthProfileRemoveHelp, run: (rest) => handlers.runAuthProfileRemove(auth, rest) },
          ],
        },
        {
          name: 'browser-profile',
          help: cliHelp.printAuthBrowserProfileHelp,
          children: [
            { name: 'list', help: cliHelp.printAuthBrowserProfileListHelp, run: (rest) => handlers.runAuthBrowserProfileList(auth, rest) },
            {
              name: 'inspect',
              help: cliHelp.printAuthBrowserProfileInspectHelp,
              run: (rest) => handlers.runAuthBrowserProfileInspect(auth, rest),
            },
            { name: 'add', help: cliHelp.printAuthBrowserProfileAddHelp, run: (rest) => handlers.runAuthBrowserProfileSave(auth, rest) },
            {
              name: 'bootstrap',
              help: cliHelp.printAuthBrowserProfileBootstrapHelp,
              run: (rest) => handlers.runAuthBrowserProfileBootstrap(auth, rest),
            },
            { name: 'remove', help: cliHelp.printAuthBrowserProfileRemoveHelp, run: (rest) => handlers.runAuthBrowserProfileRemove(auth, rest) },
          ],
        },
        { name: 'login', help: cliHelp.printAuthLoginHelp, run: (rest) => handlers.runAuthLogin(auth, rest) },
        { name: 'token', help: cliHelp.printAuthTokenHelp, run: (rest) => handlers.runAuthToken(auth, rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printEnvironmentHelp,
      children: [
        { name: 'list', help: cliHelp.printEnvironmentListHelp, run: (rest) => handlers.runEnvironmentList(configOptions, rest) },
        { name: 'add', help: cliHelp.printEnvironmentAddHelp, run: (rest) => handlers.runEnvironmentAdd(configOptions, rest) },
        { name: 'inspect', help: cliHelp.printEnvironmentInspectHelp, run: (rest) => handlers.runEnvironmentInspect(configOptions, rest) },
        { name: 'baseline', help: cliHelp.printEnvironmentBaselineHelp, run: (rest) => handlers.runEnvironmentBaseline(configOptions, rest) },
        {
          name: 'resolve-maker-id',
          help: cliHelp.printEnvironmentResolveMakerIdHelp,
          run: (rest) => handlers.runEnvironmentResolveMakerId(configOptions, rest),
        },
        {
          name: 'cleanup-plan',
          help: cliHelp.printEnvironmentCleanupPlanHelp,
          run: (rest) => handlers.runEnvironmentCleanupPlan(configOptions, rest),
        },
        { name: 'reset', help: cliHelp.printEnvironmentResetHelp, run: (rest) => handlers.runEnvironmentReset(configOptions, rest) },
        { name: 'cleanup', help: cliHelp.printEnvironmentCleanupHelp, run: (rest) => handlers.runEnvironmentCleanup(configOptions, rest) },
        { name: 'remove', run: (rest) => handlers.runEnvironmentRemove(configOptions, rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
}

export interface ProjectGroupHandlers {
  runProjectInit(args: string[]): Promise<number>;
  runProjectDoctor(args: string[]): Promise<number>;
  runProjectFeedback(args: string[]): Promise<number>;
  runProjectInspect(args: string[]): Promise<number>;
  runProjectSolutionPull(args: string[]): Promise<number>;
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printProjectHelp,
      unknownExitCode: 1,
      children: [
        {
          name: 'solution',
          help: cliHelp.printProjectSolutionHelp,
          children: [
            { name: 'pull', help: cliHelp.printProjectSolutionPullHelp, run: (rest) => handlers.runProjectSolutionPull(rest) },
          ],
        },
        { name: 'init', help: cliHelp.printProjectInitHelp, run: (rest) => handlers.runProjectInit(rest) },
        { name: 'doctor', help: cliHelp.printProjectDoctorHelp, run: (rest) => handlers.runProjectDoctor(rest) },
        { name: 'feedback', help: cliHelp.printProjectFeedbackHelp, run: (rest) => handlers.runProjectFeedback(rest) },
        { name: 'inspect', help: cliHelp.printProjectInspectHelp, run: (rest) => handlers.runProjectInspect(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
}

export async function runInitGroup(command: string | undefined, args: string[], handlers: InitGroupHandlers): Promise<number> {
  return dispatchCommandRoute(
    {
      help: cliHelp.printInitHelp,
      children: [
        { name: 'start', help: cliHelp.printInitHelp, run: (rest) => handlers.runInitStart(rest) },
        { name: 'status', help: cliHelp.printInitStatusHelp, run: (rest) => handlers.runInitStatus(rest) },
        { name: 'resume', help: cliHelp.printInitResumeHelp, run: (rest) => handlers.runInitResume(rest) },
        { name: 'answer', help: cliHelp.printInitAnswerHelp, run: (rest) => handlers.runInitAnswer(rest) },
        { name: 'cancel', help: cliHelp.printInitCancelHelp, run: (rest) => handlers.runInitCancel(rest) },
      ],
      defaultCommand: {
        run: (rest) => handlers.runInitStart(rest),
        help: cliHelp.printInitHelp,
      },
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printAnalysisHelp,
      children: [
        { name: 'report', help: cliHelp.printAnalysisReportHelp, run: (rest) => handlers.runAnalysisReport(rest) },
        { name: 'context', help: cliHelp.printAnalysisContextHelp, run: (rest) => handlers.runAnalysisContext(rest) },
        { name: 'portfolio', help: cliHelp.printAnalysisPortfolioHelp, run: (rest) => handlers.runAnalysisPortfolio(rest) },
        { name: 'drift', help: () => cliHelp.printAnalysisPortfolioViewHelp('drift'), run: (rest) => handlers.runAnalysisDrift(rest) },
        { name: 'usage', help: () => cliHelp.printAnalysisPortfolioViewHelp('usage'), run: (rest) => handlers.runAnalysisUsage(rest) },
        { name: 'policy', help: () => cliHelp.printAnalysisPortfolioViewHelp('policy'), run: (rest) => handlers.runAnalysisPolicy(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printDeployHelp,
      children: [
        { name: 'plan', help: cliHelp.printDeployPlanHelp, run: (rest) => handlers.runDeployPlan(rest) },
        { name: 'apply', help: cliHelp.printDeployApplyHelp, run: (rest) => handlers.runDeployApply(rest) },
        { name: 'release', help: cliHelp.printDeployReleaseHelp, run: (rest) => handlers.runDeployRelease(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printDiagnosticsHelp,
      children: [
        { name: 'doctor', help: cliHelp.printDiagnosticsDoctorHelp, run: (rest) => handlers.runDiagnosticsDoctor(rest) },
        { name: 'bundle', help: cliHelp.printDiagnosticsBundleHelp, run: (rest) => handlers.runDiagnosticsBundle(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printSharePointHelp,
      children: [
        {
          name: 'site',
          help: cliHelp.printSharePointHelp,
          children: [{ name: 'inspect', help: cliHelp.printSharePointHelp, run: (rest) => handlers.runSharePointSiteInspect(rest) }],
        },
        {
          name: 'list',
          help: cliHelp.printSharePointHelp,
          children: [{ name: 'inspect', help: cliHelp.printSharePointHelp, run: (rest) => handlers.runSharePointListInspect(rest) }],
        },
        {
          name: 'file',
          help: cliHelp.printSharePointHelp,
          children: [{ name: 'inspect', help: cliHelp.printSharePointHelp, run: (rest) => handlers.runSharePointFileInspect(rest) }],
        },
        {
          name: 'permissions',
          help: cliHelp.printSharePointHelp,
          children: [{ name: 'inspect', help: cliHelp.printSharePointHelp, run: (rest) => handlers.runSharePointPermissionsInspect(rest) }],
        },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printPowerBiHelp,
      children: [
        {
          name: 'workspace',
          help: cliHelp.printPowerBiHelp,
          children: [{ name: 'inspect', help: cliHelp.printPowerBiHelp, run: (rest) => handlers.runPowerBiWorkspaceInspect(rest) }],
        },
        {
          name: 'dataset',
          help: cliHelp.printPowerBiHelp,
          children: [{ name: 'inspect', help: cliHelp.printPowerBiHelp, run: (rest) => handlers.runPowerBiDatasetInspect(rest) }],
        },
        {
          name: 'report',
          help: cliHelp.printPowerBiHelp,
          children: [{ name: 'inspect', help: cliHelp.printPowerBiHelp, run: (rest) => handlers.runPowerBiReportInspect(rest) }],
        },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printDataverseHelp,
      unknownExitCode: 1,
      children: [
        { name: 'whoami', help: cliHelp.printDataverseWhoAmIHelp, run: (rest) => handlers.runDataverseWhoAmI(rest) },
        { name: 'request', run: (rest) => handlers.runDataverseRequest(rest) },
        { name: 'action', run: (rest) => handlers.runDataverseAction(rest) },
        { name: 'function', run: (rest) => handlers.runDataverseFunction(rest) },
        { name: 'batch', run: (rest) => handlers.runDataverseBatch(rest) },
        {
          name: 'rows',
          help: () => {
            const [action] = handlers.positionalArgs(args);
            if (action === 'export') {
              cliHelp.printDataverseRowsExportHelp();
            } else if (action === 'apply') {
              cliHelp.printDataverseRowsApplyHelp();
            } else {
              cliHelp.printDataverseRowsHelp();
            }
          },
          run: (rest) => handlers.runDataverseRows(rest),
        },
        { name: 'query', help: cliHelp.printDataverseQueryHelp, run: (rest) => handlers.runDataverseQuery(rest) },
        { name: 'get', run: (rest) => handlers.runDataverseGet(rest) },
        { name: 'create', help: cliHelp.printDataverseCreateHelp, run: (rest) => handlers.runDataverseCreate(rest) },
        { name: 'update', run: (rest) => handlers.runDataverseUpdate(rest) },
        { name: 'delete', run: (rest) => handlers.runDataverseDelete(rest) },
        { name: 'metadata', help: cliHelp.printDataverseMetadataHelp, run: (rest) => handlers.runDataverseMetadata(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printSolutionHelp,
      unknownExitCode: 1,
      children: [
        { name: 'create', help: cliHelp.printSolutionCreateHelp, run: (rest) => handlers.runSolutionCreate(rest) },
        { name: 'delete', run: (rest) => handlers.runSolutionDelete(rest) },
        { name: 'set-metadata', help: cliHelp.printSolutionSetMetadataHelp, run: (rest) => handlers.runSolutionSetMetadata(rest) },
        { name: 'publish', help: cliHelp.printSolutionPublishHelp, run: (rest) => handlers.runSolutionPublish(rest) },
        { name: 'sync-status', help: cliHelp.printSolutionSyncStatusHelp, run: (rest) => handlers.runSolutionSyncStatus(rest) },
        { name: 'checkpoint', help: cliHelp.printSolutionCheckpointHelp, run: (rest) => handlers.runSolutionCheckpoint(rest) },
        { name: 'list', help: cliHelp.printSolutionListHelp, run: (rest) => handlers.runSolutionList(rest) },
        { name: 'publishers', help: cliHelp.printSolutionPublishersHelp, run: (rest) => handlers.runSolutionPublishers(rest) },
        { name: 'inspect', help: cliHelp.printSolutionInspectHelp, run: (rest) => handlers.runSolutionInspect(rest) },
        { name: 'components', help: cliHelp.printSolutionComponentsHelp, run: (rest) => handlers.runSolutionComponents(rest) },
        { name: 'dependencies', help: cliHelp.printSolutionDependenciesHelp, run: (rest) => handlers.runSolutionDependencies(rest) },
        { name: 'analyze', run: (rest) => handlers.runSolutionAnalyze(rest) },
        { name: 'compare', help: cliHelp.printSolutionCompareHelp, run: (rest) => handlers.runSolutionCompare(rest) },
        { name: 'export', help: cliHelp.printSolutionExportHelp, run: (rest) => handlers.runSolutionExport(rest) },
        { name: 'import', help: cliHelp.printSolutionImportHelp, run: (rest) => handlers.runSolutionImport(rest) },
        { name: 'pack', run: (rest) => handlers.runSolutionPack(rest) },
        { name: 'unpack', run: (rest) => handlers.runSolutionUnpack(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printConnectionReferenceHelp,
      unknownExitCode: 1,
      children: [
        { name: 'create', help: cliHelp.printConnectionReferenceCreateHelp, run: (rest) => handlers.runConnectionReferenceCreate(rest) },
        { name: 'list', help: cliHelp.printConnectionReferenceListHelp, run: (rest) => handlers.runConnectionReferenceList(rest) },
        { name: 'inspect', help: cliHelp.printConnectionReferenceInspectHelp, run: (rest) => handlers.runConnectionReferenceInspect(rest) },
        { name: 'set', help: cliHelp.printConnectionReferenceSetHelp, run: (rest) => handlers.runConnectionReferenceSet(rest) },
        { name: 'validate', help: cliHelp.printConnectionReferenceValidateHelp, run: (rest) => handlers.runConnectionReferenceValidate(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printEnvironmentVariableHelp,
      unknownExitCode: 1,
      children: [
        { name: 'create', help: cliHelp.printEnvironmentVariableCreateHelp, run: (rest) => handlers.runEnvironmentVariableCreate(rest) },
        { name: 'list', help: cliHelp.printEnvironmentVariableListHelp, run: (rest) => handlers.runEnvironmentVariableList(rest) },
        { name: 'inspect', help: cliHelp.printEnvironmentVariableInspectHelp, run: (rest) => handlers.runEnvironmentVariableInspect(rest) },
        { name: 'set', help: cliHelp.printEnvironmentVariableSetHelp, run: (rest) => handlers.runEnvironmentVariableSet(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
}

export interface CanvasGroupHandlers {
  runCanvasAttach(args: string[]): Promise<number>;
  runCanvasDownload(args: string[]): Promise<number>;
  runCanvasImport(args: string[]): Promise<number>;
  runCanvasUnsupportedRemoteMutation(command: 'create' | 'import', args: string[]): Promise<number>;
  runCanvasList(args: string[]): Promise<number>;
  runCanvasProbe(args: string[]): Promise<number>;
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printCanvasHelp,
      unknownExitCode: 1,
      children: [
        { name: 'attach', help: cliHelp.printCanvasAttachHelp, run: (rest) => handlers.runCanvasAttach(rest) },
        { name: 'download', help: cliHelp.printCanvasDownloadHelp, run: (rest) => handlers.runCanvasDownload(rest) },
        { name: 'create', help: cliHelp.printCanvasCreateHelp, run: (rest) => handlers.runCanvasUnsupportedRemoteMutation('create', rest) },
        { name: 'import', help: cliHelp.printCanvasImportHelp, run: (rest) => handlers.runCanvasImport(rest) },
        { name: 'list', help: cliHelp.printCanvasListHelp, run: (rest) => handlers.runCanvasList(rest) },
        { name: 'probe', help: cliHelp.printCanvasProbeHelp, run: (rest) => handlers.runCanvasProbe(rest) },
        { name: 'access', help: cliHelp.printCanvasAccessHelp, run: (rest) => handlers.runCanvasAccess(rest) },
        { name: 'templates', delegate: true, run: (rest) => handlers.runCanvasTemplates(rest) },
        { name: 'workspace', delegate: true, run: (rest) => handlers.runCanvasWorkspace(rest) },
        { name: 'patch', delegate: true, run: (rest) => handlers.runCanvasPatch(rest) },
        { name: 'lint', run: (rest) => handlers.runCanvasLint(rest) },
        { name: 'validate', help: cliHelp.printCanvasValidateHelp, run: (rest) => handlers.runCanvasValidate(rest) },
        { name: 'inspect', help: cliHelp.printCanvasInspectHelp, run: (rest) => handlers.runCanvasInspect(rest) },
        { name: 'build', help: cliHelp.printCanvasBuildHelp, run: (rest) => handlers.runCanvasBuild(rest) },
        { name: 'diff', help: cliHelp.printCanvasDiffHelp, run: (rest) => handlers.runCanvasDiff(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
}

export interface FlowGroupHandlers {
  runFlowList(args: string[]): Promise<number>;
  runFlowInspect(args: string[]): Promise<number>;
  runFlowAttach(args: string[]): Promise<number>;
  runFlowExport(args: string[]): Promise<number>;
  runFlowActivate(args: string[]): Promise<number>;
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
  runFlowLsp(args: string[]): Promise<number>;
}

export async function runFlowGroup(
  command: string | undefined,
  args: string[],
  handlers: FlowGroupHandlers
): Promise<number> {
  return dispatchCommandRoute(
    {
      help: cliHelp.printFlowHelp,
      children: [
        { name: 'list', help: cliHelp.printFlowListHelp, run: (rest) => handlers.runFlowList(rest) },
        { name: 'inspect', help: cliHelp.printFlowInspectHelp, run: (rest) => handlers.runFlowInspect(rest) },
        { name: 'attach', help: cliHelp.printFlowAttachHelp, run: (rest) => handlers.runFlowAttach(rest) },
        { name: 'export', help: cliHelp.printFlowExportHelp, run: (rest) => handlers.runFlowExport(rest) },
        { name: 'activate', help: cliHelp.printFlowActivateHelp, run: (rest) => handlers.runFlowActivate(rest) },
        { name: 'promote', help: cliHelp.printFlowPromoteHelp, run: (rest) => handlers.runFlowPromote(rest) },
        { name: 'unpack', help: cliHelp.printFlowUnpackHelp, run: (rest) => handlers.runFlowUnpack(rest) },
        { name: 'pack', help: cliHelp.printFlowPackHelp, run: (rest) => handlers.runFlowPack(rest) },
        { name: 'deploy', help: cliHelp.printFlowDeployHelp, run: (rest) => handlers.runFlowDeploy(rest) },
        { name: 'normalize', help: cliHelp.printFlowNormalizeHelp, run: (rest) => handlers.runFlowNormalize(rest) },
        { name: 'validate', help: cliHelp.printFlowValidateHelp, run: (rest) => handlers.runFlowValidate(rest) },
        { name: 'graph', help: cliHelp.printFlowGraphHelp, run: (rest) => handlers.runFlowGraph(rest) },
        { name: 'patch', help: cliHelp.printFlowPatchHelp, run: (rest) => handlers.runFlowPatch(rest) },
        { name: 'runs', help: cliHelp.printFlowRunsHelp, run: (rest) => handlers.runFlowRuns(rest) },
        { name: 'monitor', help: cliHelp.printFlowMonitorHelp, run: (rest) => handlers.runFlowMonitor(rest) },
        { name: 'errors', help: cliHelp.printFlowErrorsHelp, run: (rest) => handlers.runFlowErrors(rest) },
        { name: 'connrefs', help: cliHelp.printFlowConnrefsHelp, run: (rest) => handlers.runFlowConnrefs(rest) },
        { name: 'doctor', help: cliHelp.printFlowDoctorHelp, run: (rest) => handlers.runFlowDoctor(rest) },
        { name: 'access', help: cliHelp.printFlowAccessHelp, run: (rest) => handlers.runFlowAccess(rest) },
        { name: 'lsp', help: cliHelp.printFlowLspHelp, run: (rest) => handlers.runFlowLsp(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
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
  return dispatchCommandRoute(
    {
      help: cliHelp.printModelHelp,
      unknownExitCode: 1,
      children: [
        { name: 'create', run: (rest) => handlers.runModelCreate(rest) },
        { name: 'attach', run: (rest) => handlers.runModelAttach(rest) },
        { name: 'list', run: (rest) => handlers.runModelList(rest) },
        { name: 'inspect', run: (rest) => handlers.runModelInspect(rest) },
        { name: 'access', help: cliHelp.printModelAccessHelp, run: (rest) => handlers.runModelAccess(rest) },
        { name: 'composition', run: (rest) => handlers.runModelComposition(rest) },
        { name: 'impact', run: (rest) => handlers.runModelImpact(rest) },
        { name: 'sitemap', run: (rest) => handlers.runModelSitemap(rest) },
        { name: 'forms', run: (rest) => handlers.runModelForms(rest) },
        { name: 'views', run: (rest) => handlers.runModelViews(rest) },
        { name: 'dependencies', run: (rest) => handlers.runModelDependencies(rest) },
        { name: 'patch', delegate: true, run: (rest) => handlers.runModelPatch(rest) },
      ],
    },
    [command, ...args].filter((value): value is string => value !== undefined)
  );
}
