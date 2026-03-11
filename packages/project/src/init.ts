import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthService, createTokenProvider, type AuthProfile, type BrowserProfile } from '@pp/auth';
import {
  findNearestProjectConfig,
  getGlobalConfigDir,
  listEnvironments,
  saveEnvironmentAlias,
  type ConfigStoreOptions,
  type EnvironmentAlias,
} from '@pp/config';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import type { ProjectDoctorReport } from './index';

export type InitGoal = 'dataverse' | 'maker' | 'project' | 'full';
export type InitAuthMode = 'user' | 'device-code' | 'environment-token' | 'client-secret' | 'static-token';
export type InitSessionStatus = 'active' | 'completed' | 'cancelled';
export type InitPromptField =
  | 'goal'
  | 'authMode'
  | 'authProfileName'
  | 'loginHint'
  | 'tokenEnvVar'
  | 'tenantId'
  | 'clientId'
  | 'clientSecretEnv'
  | 'staticToken'
  | 'environmentAlias'
  | 'environmentUrl'
  | 'browserProfileName'
  | 'browserProfileKind'
  | 'browserBootstrapUrl'
  | 'projectName'
  | 'solutionName'
  | 'stageName';

export interface InitChoiceOption {
  value: string;
  label: string;
  description?: string;
}

export interface InitPrompt {
  kind: 'text' | 'choice';
  field: InitPromptField;
  label: string;
  message: string;
  defaultValue?: string;
  options?: InitChoiceOption[];
  sensitive?: boolean;
}

export interface InitExternalAction {
  kind: 'authenticate-profile' | 'bootstrap-browser-profile';
  title: string;
  message: string;
  commands: string[];
}

export interface InitArtifactSummary {
  name: string;
  status: 'created' | 'reused' | 'pending' | 'skipped';
  detail?: string;
}

export interface InitVerificationSummary {
  auth: 'pending' | 'verified';
  browserBootstrap: 'pending' | 'verified' | 'skipped';
  project: 'pending' | 'verified' | 'skipped';
}

export interface InitSessionStep {
  id: string;
  title: string;
  status: 'pending' | 'blocked' | 'completed' | 'skipped';
  detail?: string;
}

export interface InitSessionAnswers {
  goal?: InitGoal;
  authMode?: InitAuthMode;
  authProfileName?: string;
  loginHint?: string;
  tokenEnvVar?: string;
  tenantId?: string;
  clientId?: string;
  clientSecretEnv?: string;
  staticToken?: string;
  environmentAlias?: string;
  environmentUrl?: string;
  browserProfileName?: string;
  browserProfileKind?: BrowserProfile['kind'];
  browserBootstrapUrl?: string;
  projectName?: string;
  solutionName?: string;
  stageName?: string;
}

export interface InitSession {
  version: 1;
  id: string;
  status: InitSessionStatus;
  createdAt: string;
  updatedAt: string;
  root: string;
  answers: InitSessionAnswers;
  prompt?: InitPrompt;
  externalAction?: InitExternalAction;
  steps: InitSessionStep[];
  artifacts: {
    authProfile?: InitArtifactSummary;
    environment?: InitArtifactSummary;
    browserProfile?: InitArtifactSummary;
    project?: InitArtifactSummary;
  };
  verification: InitVerificationSummary;
  existing: {
    authProfiles: string[];
    environments: string[];
    browserProfiles: string[];
    hasProjectConfig: boolean;
    projectConfigPath?: string;
  };
  verificationReport?: {
    projectDoctor?: Pick<ProjectDoctorReport, 'summary' | 'checks'>;
  };
  suggestedNextActions: string[];
}

type InitExistingState = InitSession['existing'];

export interface StartInitSessionOptions extends InitSessionAnswers {
  root: string;
}

export interface ResumeInitSessionOptions {
  answers?: Partial<InitSessionAnswers>;
}

const INIT_SESSION_VERSION = 1 as const;
const DEFAULT_BROWSER_BOOTSTRAP_URL = 'https://make.powerapps.com/';

export async function startInitSession(
  input: StartInitSessionOptions,
  configOptions: ConfigStoreOptions = {}
): Promise<OperationResult<InitSession>> {
  const now = new Date().toISOString();
  const session: InitSession = {
    version: INIT_SESSION_VERSION,
    id: randomUUID(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    root: input.root,
    answers: { ...collectDefinedAnswers(input) },
    steps: [],
    artifacts: {},
    verification: {
      auth: 'pending',
      browserBootstrap: 'pending',
      project: 'pending',
    },
    existing: {
      authProfiles: [],
      environments: [],
      browserProfiles: [],
      hasProjectConfig: false,
    },
    suggestedNextActions: [],
  };

  return persistAndAdvanceSession(session, configOptions);
}

export async function resumeInitSession(
  sessionId: string,
  options: ResumeInitSessionOptions = {},
  configOptions: ConfigStoreOptions = {}
): Promise<OperationResult<InitSession>> {
  const existing = await loadInitSession(sessionId, configOptions);

  if (!existing.success || !existing.data) {
    return existing;
  }

  if (existing.data.status === 'cancelled') {
    return fail(
      createDiagnostic('error', 'INIT_SESSION_CANCELLED', `Init session ${sessionId} has already been cancelled.`, {
        source: '@pp/project',
      })
    );
  }

  const next: InitSession = {
    ...existing.data,
    answers: {
      ...existing.data.answers,
      ...(options.answers ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };

  return persistAndAdvanceSession(next, configOptions);
}

export async function getInitSession(
  sessionId: string,
  configOptions: ConfigStoreOptions = {}
): Promise<OperationResult<InitSession>> {
  return loadInitSession(sessionId, configOptions);
}

export async function cancelInitSession(
  sessionId: string,
  configOptions: ConfigStoreOptions = {}
): Promise<OperationResult<InitSession>> {
  const existing = await loadInitSession(sessionId, configOptions);

  if (!existing.success || !existing.data) {
    return existing;
  }

  const session: InitSession = {
    ...existing.data,
    status: 'cancelled',
    prompt: undefined,
    externalAction: undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeInitSession(session, configOptions);
  return ok(session, { supportTier: 'preview' });
}

async function persistAndAdvanceSession(
  session: InitSession,
  configOptions: ConfigStoreOptions
): Promise<OperationResult<InitSession>> {
  const advanced = await advanceInitSession(session, configOptions);

  if (!advanced.success || !advanced.data) {
    return advanced;
  }

  await writeInitSession(advanced.data, configOptions);
  return ok(advanced.data, { supportTier: 'preview' });
}

async function advanceInitSession(
  session: InitSession,
  configOptions: ConfigStoreOptions
): Promise<OperationResult<InitSession>> {
  const auth = new AuthService(configOptions);
  const authProfiles = await auth.listProfiles();
  const browserProfiles = await auth.listBrowserProfiles();
  const environments = await listEnvironments(configOptions);
  const projectConfigPath = await findNearestProjectConfig(session.root);

  if (!authProfiles.success) {
    return forwardFailure(authProfiles);
  }
  if (!browserProfiles.success) {
    return forwardFailure(browserProfiles);
  }
  if (!environments.success) {
    return forwardFailure(environments);
  }

  let next: InitSession = {
    ...session,
    updatedAt: new Date().toISOString(),
    prompt: undefined,
    externalAction: undefined,
    existing: {
      authProfiles: (authProfiles.data ?? []).map((profile) => profile.name),
      environments: (environments.data ?? []).map((environment) => environment.alias),
      browserProfiles: (browserProfiles.data ?? []).map((profile) => profile.name),
      hasProjectConfig: Boolean(projectConfigPath),
      projectConfigPath,
    },
  };

  const goal = next.answers.goal;
  if (!goal) {
    return ok(blockOnPrompt(next, promptForGoal()), { supportTier: 'preview' });
  }

  const requiresBrowser = goal === 'maker' || goal === 'full';
  const requiresProject = goal === 'project' || goal === 'full';
  const matchingEnvironment = (environments.data ?? []).find((environment) => environment.alias === next.answers.environmentAlias);

  if (matchingEnvironment) {
    next.answers.environmentUrl = next.answers.environmentUrl ?? matchingEnvironment.url;
    next.answers.authProfileName = next.answers.authProfileName ?? matchingEnvironment.authProfile;
  }

  const authMode = next.answers.authMode ?? (requiresBrowser ? 'user' : undefined);
  if (!authMode) {
    return ok(blockOnPrompt(next, promptForAuthMode(requiresBrowser)), { supportTier: 'preview' });
  }
  next.answers.authMode = authMode;

  const requiredAnswer = findMissingAnswer(next.answers, next.existing, { requiresBrowser, requiresProject });
  if (requiredAnswer) {
    return ok(blockOnPrompt(next, requiredAnswer), { supportTier: 'preview' });
  }

  const normalizedUrl = normalizeUrl(next.answers.environmentUrl);
  if (!normalizedUrl) {
    return fail(
      createDiagnostic('error', 'INIT_ENVIRONMENT_URL_INVALID', 'Environment URL must be an absolute URL.', {
        source: '@pp/project',
      })
    );
  }
  next.answers.environmentUrl = normalizedUrl;
  next.answers.browserBootstrapUrl = next.answers.browserBootstrapUrl ?? DEFAULT_BROWSER_BOOTSTRAP_URL;
  next.answers.browserProfileKind = next.answers.browserProfileKind ?? 'edge';
  next.answers.stageName = next.answers.stageName ?? 'dev';

  const authProfileResult = await ensureAuthProfile(next, auth, configOptions);
  if (!authProfileResult.success || !authProfileResult.data) {
    return authProfileResult;
  }
  next = authProfileResult.data;

  const environmentResult = await ensureEnvironment(next, configOptions);
  if (!environmentResult.success || !environmentResult.data) {
    return environmentResult;
  }
  next = environmentResult.data;

  if (requiresBrowser) {
    const browserProfileResult = await ensureBrowserProfile(next, auth);
    if (!browserProfileResult.success || !browserProfileResult.data) {
      return browserProfileResult;
    }
    next = browserProfileResult.data;
  } else {
    next.artifacts.browserProfile = {
      name: '(not required)',
      status: 'skipped',
      detail: 'Current goal does not require Maker browser bootstrap.',
    };
    next.verification.browserBootstrap = 'skipped';
  }

  const authVerified = await tryVerifyAuthentication(next.answers.authProfileName as string, normalizedUrl, configOptions);
  if (!authVerified.success) {
    next = blockOnExternalAction(next, {
      kind: 'authenticate-profile',
      title: 'Complete profile authentication',
      message: 'Finish the auth flow once, then rerun `pp init resume <session-id>`.',
      commands: [`pp auth login --name ${next.answers.authProfileName} --resource ${normalizedUrl}`],
    });
    next.verification.auth = 'pending';
    next.steps = buildSteps(next, requiresBrowser, requiresProject);
    next.suggestedNextActions = next.externalAction?.commands ?? [];
    return ok(next, { supportTier: 'preview' });
  }
  next.verification.auth = 'verified';

  if (requiresBrowser) {
    const browser = await auth.getBrowserProfile(next.answers.browserProfileName as string);
    if (!browser.success) {
      return forwardFailure(browser);
    }
    if (!browser.data?.lastBootstrappedAt) {
      next.verification.browserBootstrap = 'pending';
      next = blockOnExternalAction(next, {
        kind: 'bootstrap-browser-profile',
        title: 'Bootstrap the browser profile',
        message: 'Warm the managed browser profile once so Maker-authenticated flows can reuse it later.',
        commands: [
          `pp auth browser-profile bootstrap ${next.answers.browserProfileName} --url '${next.answers.browserBootstrapUrl}'`,
        ],
      });
      next.steps = buildSteps(next, requiresBrowser, requiresProject);
      next.suggestedNextActions = next.externalAction?.commands ?? [];
      return ok(next, { supportTier: 'preview' });
    }
    next.verification.browserBootstrap = 'verified';
  }

  if (requiresProject) {
    const projectResult = await ensureProjectScaffold(next);
    if (!projectResult.success || !projectResult.data) {
      return projectResult;
    }
    next = projectResult.data;
  } else {
    next.artifacts.project = {
      name: '(not required)',
      status: 'skipped',
      detail: 'Current goal does not require a project scaffold.',
    };
    next.verification.project = 'skipped';
  }

  next.status = 'completed';
  next.prompt = undefined;
  next.externalAction = undefined;
  next.steps = buildSteps(next, requiresBrowser, requiresProject);
  next.suggestedNextActions = buildSuggestedNextActions(next);
  return ok(next, { supportTier: 'preview' });
}

async function ensureAuthProfile(
  session: InitSession,
  auth: AuthService,
  configOptions: ConfigStoreOptions
): Promise<OperationResult<InitSession>> {
  const name = session.answers.authProfileName as string;
  const existing = await auth.getProfile(name);

  if (!existing.success) {
    return forwardFailure(existing);
  }

  if (existing.data) {
    const maybeUpdated =
      session.answers.authMode === 'user' &&
      session.answers.browserProfileName &&
      existing.data.type === 'user' &&
      existing.data.browserProfile !== session.answers.browserProfileName
        ? await auth.saveProfile({
            ...existing.data,
            browserProfile: session.answers.browserProfileName,
          })
        : undefined;

    if (maybeUpdated && !maybeUpdated.success) {
      return forwardFailure(maybeUpdated);
    }

    return ok(
      {
        ...session,
        artifacts: {
          ...session.artifacts,
          authProfile: {
            name,
            status: 'reused',
            detail: `Using existing ${existing.data.type} auth profile.`,
          },
        },
      },
      { supportTier: 'preview' }
    );
  }

  const profile = buildAuthProfileFromAnswers(session.answers);
  const saved = await auth.saveProfile(profile);

  if (!saved.success || !saved.data) {
    return forwardFailure(saved);
  }

  return ok(
    {
      ...session,
      artifacts: {
        ...session.artifacts,
        authProfile: {
          name,
          status: 'created',
          detail: `Created ${profile.type} auth profile.`,
        },
      },
    },
    { supportTier: 'preview' }
  );
}

async function ensureEnvironment(
  session: InitSession,
  configOptions: ConfigStoreOptions
): Promise<OperationResult<InitSession>> {
  const environment: EnvironmentAlias = {
    alias: session.answers.environmentAlias as string,
    url: session.answers.environmentUrl as string,
    authProfile: session.answers.authProfileName as string,
  };
  const existingList = await listEnvironments(configOptions);

  if (!existingList.success) {
    return forwardFailure(existingList);
  }

  const existing = (existingList.data ?? []).find((candidate) => candidate.alias === environment.alias);
  if (existing) {
    return ok(
      {
        ...session,
        artifacts: {
          ...session.artifacts,
          environment: {
            name: environment.alias,
            status: 'reused',
            detail: `Using existing environment alias ${environment.alias}.`,
          },
        },
      },
      { supportTier: 'preview' }
    );
  }

  const saved = await saveEnvironmentAlias(environment, configOptions);
  if (!saved.success || !saved.data) {
    return forwardFailure(saved);
  }

  return ok(
    {
      ...session,
      artifacts: {
        ...session.artifacts,
        environment: {
          name: environment.alias,
          status: 'created',
          detail: `Created environment alias ${environment.alias}.`,
        },
      },
    },
    { supportTier: 'preview' }
  );
}

async function ensureBrowserProfile(session: InitSession, auth: AuthService): Promise<OperationResult<InitSession>> {
  const name = session.answers.browserProfileName as string;
  const existing = await auth.getBrowserProfile(name);

  if (!existing.success) {
    return forwardFailure(existing);
  }

  if (existing.data) {
    return ok(
      {
        ...session,
        artifacts: {
          ...session.artifacts,
          browserProfile: {
            name,
            status: 'reused',
            detail: `Using existing ${existing.data.kind} browser profile.`,
          },
        },
      },
      { supportTier: 'preview' }
    );
  }

  const saved = await auth.saveBrowserProfile({
    name,
    kind: session.answers.browserProfileKind as BrowserProfile['kind'],
  });

  if (!saved.success || !saved.data) {
    return forwardFailure(saved);
  }

  return ok(
    {
      ...session,
      artifacts: {
        ...session.artifacts,
        browserProfile: {
          name,
          status: 'created',
          detail: `Created ${saved.data.kind} browser profile.`,
        },
      },
    },
    { supportTier: 'preview' }
  );
}

async function ensureProjectScaffold(session: InitSession): Promise<OperationResult<InitSession>> {
  const { doctorProject, initProject } = await import('./index');
  const configPath = await findNearestProjectConfig(session.root);

  if (configPath) {
    const doctor = await doctorProject(session.root);
    return ok(
      {
        ...session,
        artifacts: {
          ...session.artifacts,
          project: {
            name: session.answers.projectName as string,
            status: 'reused',
            detail: `Using existing project config at ${configPath}.`,
          },
        },
        verification: {
          ...session.verification,
          project: 'verified',
        },
        verificationReport: doctor.success && doctor.data ? { projectDoctor: { summary: doctor.data.summary, checks: doctor.data.checks } } : undefined,
      },
      { supportTier: 'preview' }
    );
  }

  const result = await initProject(session.root, {
    name: session.answers.projectName,
    environment: session.answers.environmentAlias,
    solution: session.answers.solutionName,
    stage: session.answers.stageName,
  });

  if (!result.success || !result.data) {
    return forwardFailure(result);
  }

  const doctor = await doctorProject(session.root);
  return ok(
    {
      ...session,
      artifacts: {
        ...session.artifacts,
        project: {
          name: session.answers.projectName as string,
          status: 'created',
          detail: `Scaffolded project config and source-first layout in ${session.root}.`,
        },
      },
      verification: {
        ...session.verification,
        project: 'verified',
      },
      verificationReport: doctor.success && doctor.data ? { projectDoctor: { summary: doctor.data.summary, checks: doctor.data.checks } } : undefined,
    },
    { supportTier: 'preview' }
  );
}

async function tryVerifyAuthentication(
  profileName: string,
  resource: string,
  configOptions: ConfigStoreOptions
): Promise<OperationResult<true>> {
  const auth = new AuthService(configOptions);
  const profile = await auth.getProfile(profileName);

  if (!profile.success) {
    return fail(
      createDiagnostic('error', 'INIT_AUTH_PROFILE_LOOKUP_FAILED', `Could not inspect auth profile ${profileName}.`, {
        source: '@pp/project',
      })
    );
  }

  if (!profile.data) {
    return fail(
      createDiagnostic('error', 'INIT_AUTH_PROFILE_NOT_FOUND', `Auth profile ${profileName} was not found.`, {
        source: '@pp/project',
      })
    );
  }

  const provider = createTokenProvider(profile.data, configOptions, { allowInteractive: false });
  if (!provider.success || !provider.data) {
    return fail(
      createDiagnostic('error', 'INIT_AUTH_PROVIDER_FAILED', `Could not initialize auth provider for ${profileName}.`, {
        source: '@pp/project',
      })
    );
  }

  try {
    await provider.data.getAccessToken(resource);
    return ok(true, { supportTier: 'preview' });
  } catch {
    return fail(
      createDiagnostic('warning', 'INIT_AUTHENTICATION_PENDING', `Authentication is not complete for profile ${profileName}.`, {
        source: '@pp/project',
      })
    );
  }
}

function buildAuthProfileFromAnswers(answers: InitSessionAnswers): AuthProfile {
  switch (answers.authMode) {
    case 'environment-token':
      return {
        name: answers.authProfileName as string,
        type: 'environment-token',
        environmentVariable: answers.tokenEnvVar as string,
        defaultResource: answers.environmentUrl,
      };
    case 'client-secret':
      return {
        name: answers.authProfileName as string,
        type: 'client-secret',
        tenantId: answers.tenantId as string,
        clientId: answers.clientId as string,
        clientSecretEnv: answers.clientSecretEnv as string,
        defaultResource: answers.environmentUrl,
      };
    case 'static-token':
      return {
        name: answers.authProfileName as string,
        type: 'static-token',
        token: answers.staticToken as string,
      };
    case 'device-code':
      return {
        name: answers.authProfileName as string,
        type: 'device-code',
        loginHint: answers.loginHint,
        defaultResource: answers.environmentUrl,
      };
    case 'user':
    default:
      return {
        name: answers.authProfileName as string,
        type: 'user',
        loginHint: answers.loginHint,
        browserProfile: answers.browserProfileName,
        defaultResource: answers.environmentUrl,
        fallbackToDeviceCode: true,
      };
  }
}

function findMissingAnswer(
  answers: InitSessionAnswers,
  existing: InitExistingState,
  requirements: { requiresBrowser: boolean; requiresProject: boolean }
): InitPrompt | undefined {
  if (!answers.authProfileName) {
    const defaultProfileName = requirements.requiresBrowser ? 'maker-user' : 'dev-user';
    const existingOptions = buildExistingOptions(existing.authProfiles, 'Reuse existing auth profile');
    return {
      kind: existingOptions.length > 0 ? 'choice' : 'text',
      field: 'authProfileName',
      label: 'Auth profile',
      message: 'Choose a stable auth profile name. pp will create it if it does not exist, or reuse it if it already does.',
      defaultValue: existing.authProfiles[0] ?? defaultProfileName,
      options:
        existingOptions.length > 0
          ? [
              ...existingOptions,
              {
                value: defaultProfileName,
                label: defaultProfileName,
                description: 'Create a new auth profile with this name instead of reusing an existing one.',
              },
            ]
          : undefined,
    };
  }
  if (!answers.environmentAlias) {
    const existingOptions = buildExistingOptions(existing.environments, 'Reuse existing environment alias');
    return {
      kind: existingOptions.length > 0 ? 'choice' : 'text',
      field: 'environmentAlias',
      label: 'Environment alias',
      message: 'Choose a short local alias for the Dataverse environment. You will use this alias in later pp commands instead of repeating the full URL.',
      defaultValue: 'dev',
      options:
        existingOptions.length > 0
          ? [
              ...existingOptions,
              {
                value: 'dev',
                label: 'dev',
                description: 'Create a new environment alias instead of reusing an existing one.',
              },
            ]
          : undefined,
    };
  }
  if (!answers.environmentUrl) {
    return {
      kind: 'text',
      field: 'environmentUrl',
      label: 'Environment URL',
      message: 'Enter the Dataverse environment URL that pp should target, for example https://contoso.crm.dynamics.com.',
    };
  }

  switch (answers.authMode) {
    case 'environment-token':
      if (!answers.tokenEnvVar) {
        return {
          kind: 'text',
          field: 'tokenEnvVar',
          label: 'Token env var',
          message: 'Which environment variable will provide the bearer token at runtime?',
          defaultValue: 'PP_TOKEN',
        };
      }
      break;
    case 'client-secret':
      if (!answers.tenantId) {
        return {
          kind: 'text',
          field: 'tenantId',
          label: 'Tenant ID',
          message: 'Enter the Entra tenant id used by the app registration for this setup.',
        };
      }
      if (!answers.clientId) {
        return {
          kind: 'text',
          field: 'clientId',
          label: 'Client ID',
          message: 'Enter the client id of the app registration pp should use.',
        };
      }
      if (!answers.clientSecretEnv) {
        return {
          kind: 'text',
          field: 'clientSecretEnv',
          label: 'Secret env var',
          message: 'Which environment variable will provide the client secret at runtime?',
          defaultValue: 'PP_CLIENT_SECRET',
        };
      }
      break;
    case 'static-token':
      if (!answers.staticToken) {
        return {
          kind: 'text',
          field: 'staticToken',
          label: 'Static token',
          message: 'Paste the bearer token to store on this profile. This is best suited to short-lived local testing.',
          sensitive: true,
        };
      }
      break;
    case 'device-code':
    case 'user':
      if (answers.loginHint === undefined) {
        return {
          kind: 'text',
          field: 'loginHint',
          label: 'Login hint',
          message: 'Optional: enter the account email to prefill sign-in. Leave blank if you want the login UI to decide.',
          defaultValue: '',
        };
      }
      break;
    default:
      break;
  }

  if (requirements.requiresBrowser && !answers.browserProfileName) {
    const defaultBrowserProfile = `${answers.authProfileName}-browser`;
    const existingOptions = buildExistingOptions(existing.browserProfiles, 'Reuse existing browser profile');
    return {
      kind: existingOptions.length > 0 ? 'choice' : 'text',
      field: 'browserProfileName',
      label: 'Browser profile',
      message: 'Name the reusable browser profile for Maker-authenticated work. pp will use it for one-time browser bootstrap and later browser-backed flows.',
      defaultValue: existing.browserProfiles[0] ?? defaultBrowserProfile,
      options:
        existingOptions.length > 0
          ? [
              ...existingOptions,
              {
                value: defaultBrowserProfile,
                label: defaultBrowserProfile,
                description: 'Create a new browser profile for this auth profile.',
              },
            ]
          : undefined,
    };
  }

  if (requirements.requiresProject && !answers.projectName) {
    return {
      kind: 'text',
      field: 'projectName',
      label: 'Project name',
      message: 'Choose the local pp project name to scaffold into this directory.',
      defaultValue: 'demo',
    };
  }
  if (requirements.requiresProject && !answers.solutionName) {
    return {
      kind: 'text',
      field: 'solutionName',
      label: 'Solution name',
      message: 'Enter the default Dataverse solution unique name that this project should target by default.',
      defaultValue: 'Core',
    };
  }
  if (requirements.requiresProject && !answers.stageName) {
    return {
      kind: 'text',
      field: 'stageName',
      label: 'Stage name',
      message: 'Choose the default topology stage name for this project, usually dev.',
      defaultValue: 'dev',
    };
  }

  return undefined;
}

function promptForGoal(): InitPrompt {
  return {
    kind: 'choice',
    field: 'goal',
    label: 'Goal',
    message: 'Choose the outcome you want from this setup run. This controls which steps pp will guide you through.',
    options: [
      {
        value: 'full',
        label: 'full',
        description: 'Best for a first-time local setup: create or reuse auth, bind an environment alias, prepare Maker browser auth, and scaffold the local project.',
      },
      {
        value: 'maker',
        label: 'maker',
        description: 'Prepare auth, environment alias, and browser bootstrap for Maker or canvas workflows, without changing the local project layout.',
      },
      {
        value: 'project',
        label: 'project',
        description: 'Prepare auth and environment alias, then scaffold the local project, without requiring Maker browser bootstrap.',
      },
      {
        value: 'dataverse',
        label: 'dataverse',
        description: 'Minimal setup for Dataverse API and solution commands: auth plus environment alias only.',
      },
    ],
    defaultValue: 'full',
  };
}

function promptForAuthMode(requiresBrowser: boolean): InitPrompt {
  const options = requiresBrowser
    ? [{ value: 'user', label: 'user', description: 'Interactive browser login with reusable browser profile support.' }]
    : [
        { value: 'user', label: 'user', description: 'Interactive browser login.' },
        { value: 'device-code', label: 'device-code', description: 'Interactive device-code login.' },
        { value: 'environment-token', label: 'environment-token', description: 'Read a bearer token from an env var.' },
        { value: 'client-secret', label: 'client-secret', description: 'Use an app registration and client secret.' },
        { value: 'static-token', label: 'static-token', description: 'Store a literal bearer token.' },
      ];
  return {
    kind: 'choice',
    field: 'authMode',
    label: 'Auth mode',
    message: requiresBrowser
      ? 'This workflow needs a user-style login because Maker browser bootstrap depends on an interactive user session.'
      : 'Choose how pp should authenticate for this setup.',
    options,
    defaultValue: 'user',
  };
}

function buildExistingOptions(values: string[], descriptionPrefix: string): InitChoiceOption[] {
  return values.map((value) => ({
    value,
    label: value,
    description: `${descriptionPrefix} \`${value}\`.`,
  }));
}

function blockOnPrompt(session: InitSession, prompt: InitPrompt): InitSession {
  const next = {
    ...session,
    prompt,
    externalAction: undefined,
  };
  next.steps = buildSteps(next, requiresBrowserForGoal(next.answers.goal), requiresProjectForGoal(next.answers.goal));
  next.suggestedNextActions = [`pp init answer ${next.id} --set ${prompt.field}=...`, `pp init resume ${next.id}`];
  return next;
}

function blockOnExternalAction(session: InitSession, externalAction: InitExternalAction): InitSession {
  return {
    ...session,
    prompt: undefined,
    externalAction,
  };
}

function buildSteps(session: InitSession, requiresBrowser: boolean, requiresProject: boolean): InitSessionStep[] {
  const currentPromptField = session.prompt?.field;
  const externalKind = session.externalAction?.kind;
  return [
    {
      id: 'goal',
      title: 'Choose init goal',
      status: session.answers.goal ? 'completed' : currentPromptField === 'goal' ? 'blocked' : 'pending',
    },
    {
      id: 'auth-profile',
      title: 'Configure auth profile',
      status: session.artifacts.authProfile ? 'completed' : currentPromptField && currentPromptField !== 'goal' ? 'blocked' : 'pending',
      detail: session.artifacts.authProfile?.detail,
    },
    {
      id: 'environment',
      title: 'Bind environment alias',
      status: session.artifacts.environment ? 'completed' : currentPromptField === 'environmentAlias' || currentPromptField === 'environmentUrl' ? 'blocked' : 'pending',
      detail: session.artifacts.environment?.detail,
    },
    {
      id: 'authenticate',
      title: 'Verify authentication',
      status:
        session.verification.auth === 'verified'
          ? 'completed'
          : externalKind === 'authenticate-profile'
            ? 'blocked'
            : 'pending',
      detail: session.verification.auth === 'verified' ? 'Authentication verified through a non-interactive token check.' : undefined,
    },
    {
      id: 'browser',
      title: 'Prepare browser profile',
      status: !requiresBrowser
        ? 'skipped'
        : session.verification.browserBootstrap === 'verified'
          ? 'completed'
          : externalKind === 'bootstrap-browser-profile' || currentPromptField === 'browserProfileName'
            ? 'blocked'
            : 'pending',
      detail: session.artifacts.browserProfile?.detail,
    },
    {
      id: 'project',
      title: 'Scaffold project',
      status: !requiresProject
        ? 'skipped'
        : session.verification.project === 'verified'
          ? 'completed'
          : currentPromptField === 'projectName' || currentPromptField === 'solutionName' || currentPromptField === 'stageName'
            ? 'blocked'
            : 'pending',
      detail: session.artifacts.project?.detail,
    },
  ];
}

function buildSuggestedNextActions(session: InitSession): string[] {
  const actions = [
    `pp env inspect ${session.answers.environmentAlias}`,
    `pp auth profile inspect ${session.answers.authProfileName}`,
  ];

  if (session.answers.goal === 'project' || session.answers.goal === 'full') {
    actions.push('pp project doctor');
  }

  return actions;
}

function collectDefinedAnswers(input: Partial<InitSessionAnswers>): InitSessionAnswers {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as InitSessionAnswers;
}

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function requiresBrowserForGoal(goal: InitGoal | undefined): boolean {
  return goal === 'maker' || goal === 'full';
}

function requiresProjectForGoal(goal: InitGoal | undefined): boolean {
  return goal === 'project' || goal === 'full';
}

async function loadInitSession(
  sessionId: string,
  configOptions: ConfigStoreOptions
): Promise<OperationResult<InitSession>> {
  const path = initSessionPath(sessionId, configOptions);

  try {
    const contents = await readFile(path, 'utf8');
    return ok(JSON.parse(contents) as InitSession, { supportTier: 'preview' });
  } catch {
    return fail(
      createDiagnostic('error', 'INIT_SESSION_NOT_FOUND', `Init session ${sessionId} was not found.`, {
        source: '@pp/project',
        hint: 'Run `pp init` to start a new setup session.',
      })
    );
  }
}

async function writeInitSession(session: InitSession, configOptions: ConfigStoreOptions): Promise<void> {
  const dir = initSessionDir(configOptions);
  await mkdir(dir, { recursive: true });
  await writeFile(initSessionPath(session.id, configOptions), `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

export async function removeInitSessionArtifacts(
  sessionId: string,
  configOptions: ConfigStoreOptions = {}
): Promise<OperationResult<boolean>> {
  try {
    await rm(initSessionPath(sessionId, configOptions), { force: true });
    return ok(true, { supportTier: 'preview' });
  } catch {
    return fail(
      createDiagnostic('error', 'INIT_SESSION_REMOVE_FAILED', `Could not remove init session ${sessionId}.`, {
        source: '@pp/project',
      })
    );
  }
}

function initSessionDir(configOptions: ConfigStoreOptions): string {
  return join(getGlobalConfigDir(configOptions), 'init-sessions');
}

function initSessionPath(sessionId: string, configOptions: ConfigStoreOptions): string {
  return join(initSessionDir(configOptions), `${sessionId}.json`);
}

function forwardFailure<T>(result: OperationResult<unknown>): OperationResult<T> {
  return result as unknown as OperationResult<T>;
}
