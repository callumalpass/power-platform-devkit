import type { ConfigStoreOptions } from '@pp/config';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import {
  cancelInitSession,
  getInitSession,
  resumeInitSession,
  startInitSession,
  type InitPrompt,
  type InitSession,
  type InitSessionAnswers,
  type StartInitSessionOptions,
} from '@pp/project';
import type { CliOutputFormat } from './contract';

type OutputFormat = CliOutputFormat;

interface InitCommandDependencies {
  positionalArgs(args: string[]): string[];
  resolveInvocationPath(path?: string): string;
  outputFormat(args: string[], fallback: OutputFormat): OutputFormat;
  readConfigOptions(args: string[]): ConfigStoreOptions;
  readFlag(args: string[], name: string): string | undefined;
  readRepeatedFlags(args: string[], name: string): string[];
  hasFlag(args: string[], name: string): boolean;
  isMachineReadableOutputFormat(format: OutputFormat): boolean;
  printFailure(result: OperationResult<unknown>): number;
  printByFormat(value: unknown, format: OutputFormat): void;
  promptForInput(message: string): Promise<string>;
  argumentFailure(code: string, message: string): OperationResult<never>;
}

export async function runInitStartCommand(args: string[], deps: InitCommandDependencies): Promise<number> {
  const format = resolveInitOutputFormat(args, deps);
  const options = readInitOptions(args, deps);
  const result = await startInitSession(options, deps.readConfigOptions(args));

  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  const session = await maybePromptThroughSession(result.data, format, args, deps);
  return printInitSession(session, format, deps);
}

export async function runInitStatusCommand(args: string[], deps: InitCommandDependencies): Promise<number> {
  const format = resolveInitOutputFormat(args, deps);
  const sessionId = deps.positionalArgs(args)[0];

  if (!sessionId) {
    return deps.printFailure(deps.argumentFailure('INIT_SESSION_ID_REQUIRED', 'Init session id is required.'));
  }

  const result = await getInitSession(sessionId, deps.readConfigOptions(args));
  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  return printInitSession(result.data, format, deps);
}

export async function runInitResumeCommand(args: string[], deps: InitCommandDependencies): Promise<number> {
  const format = resolveInitOutputFormat(args, deps);
  const sessionId = deps.positionalArgs(args)[0];

  if (!sessionId) {
    return deps.printFailure(deps.argumentFailure('INIT_SESSION_ID_REQUIRED', 'Init session id is required.'));
  }

  const result = await resumeInitSession(sessionId, { answers: readInitAnswers(args, deps) }, deps.readConfigOptions(args));
  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  const session = await maybePromptThroughSession(result.data, format, args, deps);
  return printInitSession(session, format, deps);
}

export async function runInitAnswerCommand(args: string[], deps: InitCommandDependencies): Promise<number> {
  const format = resolveInitOutputFormat(args, deps);
  const sessionId = deps.positionalArgs(args)[0];

  if (!sessionId) {
    return deps.printFailure(deps.argumentFailure('INIT_SESSION_ID_REQUIRED', 'Init session id is required.'));
  }

  const answers = readSetFlags(args, deps);
  if (!answers.success || !answers.data) {
    return deps.printFailure(answers);
  }

  const result = await resumeInitSession(sessionId, { answers: answers.data }, deps.readConfigOptions(args));
  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  return printInitSession(result.data, format, deps);
}

export async function runInitCancelCommand(args: string[], deps: InitCommandDependencies): Promise<number> {
  const format = resolveInitOutputFormat(args, deps);
  const sessionId = deps.positionalArgs(args)[0];

  if (!sessionId) {
    return deps.printFailure(deps.argumentFailure('INIT_SESSION_ID_REQUIRED', 'Init session id is required.'));
  }

  const result = await cancelInitSession(sessionId, deps.readConfigOptions(args));
  if (!result.success || !result.data) {
    return deps.printFailure(result);
  }

  return printInitSession(result.data, format, deps);
}

async function maybePromptThroughSession(
  session: InitSession,
  format: OutputFormat,
  args: string[],
  deps: InitCommandDependencies
): Promise<InitSession> {
  if (deps.isMachineReadableOutputFormat(format) || !process.stdin.isTTY || deps.hasFlag(args, '--no-interactive')) {
    return session;
  }

  let current = session;
  let firstPrompt = true;
  while (current.status === 'active' && current.prompt) {
    process.stdout.write(renderInteractivePrompt(current, firstPrompt));
    const answer = await deps.promptForInput(renderPromptQuestion(current.prompt));
    const value = normalizePromptAnswer(current.prompt, answer);
    const resumed = await resumeInitSession(
      current.id,
      {
        answers: {
          [current.prompt.field]: value,
        },
      },
      deps.readConfigOptions(args)
    );

    if (!resumed.success || !resumed.data) {
      return current;
    }

    current = resumed.data;
    firstPrompt = false;
  }

  return current;
}

function renderPromptQuestion(prompt: InitPrompt): string {
  return `> ${prompt.label}${prompt.defaultValue !== undefined ? ` [default: ${prompt.defaultValue === '' ? 'blank' : prompt.defaultValue}]` : ''}: `;
}

function normalizePromptAnswer(prompt: InitPrompt, answer: string): string {
  const trimmed = answer.trim();
  const fallback = trimmed === '' ? (prompt.defaultValue ?? '') : trimmed;

  if (prompt.kind !== 'choice' || !prompt.options?.length) {
    return fallback;
  }

  const asIndex = Number(fallback);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= prompt.options.length) {
    return prompt.options[asIndex - 1]?.value ?? fallback;
  }

  const option = prompt.options.find((candidate) => candidate.value === fallback || candidate.label === fallback);
  return option?.value ?? fallback;
}

function readInitOptions(args: string[], deps: InitCommandDependencies): StartInitSessionOptions {
  const root = deps.resolveInvocationPath(deps.positionalArgs(args)[0]);
  return {
    root,
    ...readInitAnswers(args, deps),
  };
}

function readInitAnswers(args: string[], deps: InitCommandDependencies): Partial<InitSessionAnswers> {
  return {
    goal: deps.readFlag(args, '--goal') as InitSessionAnswers['goal'] | undefined,
    authMode: deps.readFlag(args, '--auth-mode') as InitSessionAnswers['authMode'] | undefined,
    authProfileName: deps.readFlag(args, '--profile'),
    loginHint: readOptionalFlag(args, '--login-hint', deps),
    tokenEnvVar: deps.readFlag(args, '--token-env'),
    tenantId: deps.readFlag(args, '--tenant-id'),
    clientId: deps.readFlag(args, '--client-id'),
    clientSecretEnv: deps.readFlag(args, '--client-secret-env'),
    staticToken: deps.readFlag(args, '--token'),
    environmentAlias: deps.readFlag(args, '--env'),
    environmentUrl: deps.readFlag(args, '--url'),
    browserProfileName: deps.readFlag(args, '--browser-profile'),
    browserProfileKind: deps.readFlag(args, '--browser-kind') as InitSessionAnswers['browserProfileKind'] | undefined,
    browserBootstrapUrl: deps.readFlag(args, '--browser-url'),
    projectName: deps.readFlag(args, '--name'),
    solutionName: deps.readFlag(args, '--solution'),
    stageName: deps.readFlag(args, '--stage'),
  };
}

function readOptionalFlag(args: string[], name: string, deps: InitCommandDependencies): string | undefined {
  if (!args.includes(name)) {
    return undefined;
  }

  return deps.readFlag(args, name) ?? '';
}

function readSetFlags(args: string[], deps: InitCommandDependencies): OperationResult<Partial<InitSessionAnswers>> {
  const updates: Partial<InitSessionAnswers> = {};

  for (const entry of deps.readRepeatedFlags(args, '--set')) {
    const equalsIndex = entry.indexOf('=');
    if (equalsIndex === -1) {
      return fail(createDiagnostic('error', 'INIT_SET_FLAG_INVALID', `Expected --set field=value. Received: ${entry}`, { source: '@pp/cli' }));
    }

    const field = entry.slice(0, equalsIndex) as keyof InitSessionAnswers;
    const value = entry.slice(equalsIndex + 1);
    if (!(field in ({} as InitSessionAnswers))) {
      // This runtime check is not reliable on erased types, so fall through to the allow-list below.
    }

    if (!isInitAnswerField(field)) {
      return fail(createDiagnostic('error', 'INIT_SET_FIELD_UNKNOWN', `Unknown init field ${field}.`, { source: '@pp/cli' }));
    }

    updates[field] = value as never;
  }

  return ok(updates, { supportTier: 'preview' });
}

function isInitAnswerField(field: string): field is keyof InitSessionAnswers {
  return INIT_ANSWER_FIELDS.has(field as keyof InitSessionAnswers);
}

const INIT_ANSWER_FIELDS = new Set<keyof InitSessionAnswers>([
    'goal',
    'authMode',
    'authProfileName',
    'loginHint',
    'tokenEnvVar',
    'tenantId',
    'clientId',
    'clientSecretEnv',
    'staticToken',
    'environmentAlias',
    'environmentUrl',
    'browserProfileName',
    'browserProfileKind',
    'browserBootstrapUrl',
    'projectName',
    'solutionName',
    'stageName',
  ]);

function printInitSession(session: InitSession, format: OutputFormat, deps: InitCommandDependencies): number {
  if (deps.isMachineReadableOutputFormat(format)) {
    deps.printByFormat(session, format);
    return 0;
  }

  process.stdout.write(renderInitSession(session, format as Extract<OutputFormat, 'table' | 'markdown' | 'raw'>));
  return 0;
}

function resolveInitOutputFormat(args: string[], deps: InitCommandDependencies): OutputFormat {
  if (args.includes('--format')) {
    return deps.outputFormat(args, 'json');
  }

  if (process.stdin.isTTY && process.stdout.isTTY && !deps.hasFlag(args, '--no-interactive')) {
    return deps.outputFormat(args, 'table');
  }

  return deps.outputFormat(args, 'json');
}

function renderInitSession(session: InitSession, format: Extract<OutputFormat, 'table' | 'markdown' | 'raw'>): string {
  const lines = [
    format === 'markdown' ? `# Init Session ${session.id}` : 'pp init',
    '',
    `Session: ${session.id}`,
    `Status: ${session.status}`,
    `Root: ${session.root}`,
    `Goal: ${session.answers.goal ?? '<pending>'}`,
  ];

  const planSoFar = renderPlanSoFar(session);
  if (planSoFar.length > 0) {
    lines.push('', 'Current plan:');
    lines.push(...planSoFar.map((line) => `- ${line}`));
  }

  lines.push('', 'Steps:');
  lines.push(...session.steps.map((step) => `- [${step.status}] ${step.title}${step.detail ? `: ${step.detail}` : ''}`));

  const finalSummary = renderFinalSummary(session);
  if (finalSummary.length > 0) {
    lines.push('', 'Setup summary:');
    lines.push(...finalSummary.map((line) => `- ${line}`));
  }

  if (session.prompt) {
    lines.push('', `Blocked on input: ${session.prompt.label}`, session.prompt.message, 'Use `pp init resume <session-id>` to continue interactively.');
  }

  if (session.externalAction) {
    lines.push('', session.externalAction.title, session.externalAction.message, '', 'Checklist:');
    lines.push('- Run the command below in another terminal if needed:');
    lines.push(...session.externalAction.commands.map((command) => `  ${command}`));
    lines.push('- Complete the browser or login step if a window opens.');
    lines.push(`- Return here and run: pp init resume ${session.id}`);
  }

  if (session.suggestedNextActions.length > 0) {
    lines.push('', 'Next:', ...session.suggestedNextActions.map((action) => `- ${action}`));
  }

  return `${lines.join('\n')}\n`;
}

function renderInteractivePrompt(session: InitSession, firstPrompt: boolean): string {
  const prompt = session.prompt;
  if (!prompt) {
    return '';
  }

  const lines: string[] = [];

  if (firstPrompt) {
    lines.push('pp init');
    lines.push('');
    lines.push('This workflow sets up the local pp relationship chain: auth profile -> environment alias -> optional browser bootstrap -> optional project scaffold.');
    lines.push(`Working directory: ${session.root}`);
    lines.push(...renderDetectedState(session));
    lines.push('');
  } else {
    lines.push('');
    lines.push(`Continuing init session ${session.id}`);
    lines.push('');
  }

  lines.push(`Step: ${prompt.label}`);
  lines.push(prompt.message);
  const planSoFar = renderPlanSoFar(session);
  if (planSoFar.length > 0) {
    lines.push('');
    lines.push('Plan so far:');
    lines.push(...planSoFar.map((line) => `  ${line}`));
  }

  if (prompt.kind === 'choice' && prompt.options?.length) {
    lines.push('');
    lines.push('Options:');
    for (const [index, option] of prompt.options.entries()) {
      const defaultMarker = option.value === prompt.defaultValue ? ' (default)' : '';
      lines.push(`  ${index + 1}. ${option.label}${defaultMarker}`);
      if (option.description) {
        lines.push(`     ${option.description}`);
      }
    }
    lines.push('');
    lines.push('Enter the number or the option name.');
  } else {
    if (prompt.defaultValue !== undefined) {
      lines.push('');
      lines.push(`Default: ${prompt.defaultValue === '' ? '(blank)' : prompt.defaultValue}`);
    }
    lines.push('');
    lines.push('Press Enter to accept the default if it already looks right.');
  }

  return `${lines.join('\n')}\n`;
}

function renderDetectedState(session: InitSession): string[] {
  const lines = ['Detected existing state:'];
  lines.push(
    `  auth profiles: ${session.existing.authProfiles.length > 0 ? session.existing.authProfiles.join(', ') : '(none)'}`
  );
  lines.push(
    `  environment aliases: ${session.existing.environments.length > 0 ? session.existing.environments.join(', ') : '(none)'}`
  );
  lines.push(
    `  browser profiles: ${session.existing.browserProfiles.length > 0 ? session.existing.browserProfiles.join(', ') : '(none)'}`
  );
  lines.push(
    `  local project config: ${
      session.existing.hasProjectConfig ? session.existing.projectConfigPath ?? 'present' : '(none)'
    }`
  );
  return lines;
}

function renderPlanSoFar(session: InitSession): string[] {
  const lines: string[] = [];

  if (session.answers.goal) {
    lines.push(`goal: ${session.answers.goal}`);
  }
  if (session.answers.authMode) {
    lines.push(`auth mode: ${session.answers.authMode}`);
  }
  if (session.answers.authProfileName) {
    lines.push(`auth profile: ${session.answers.authProfileName}`);
  }
  if (session.answers.environmentAlias) {
    lines.push(`environment alias: ${session.answers.environmentAlias}`);
  }
  if (session.answers.environmentUrl) {
    lines.push(`environment URL: ${session.answers.environmentUrl}`);
  }
  if (session.answers.browserProfileName) {
    lines.push(`browser profile: ${session.answers.browserProfileName}`);
  }
  if (session.answers.projectName) {
    lines.push(`project name: ${session.answers.projectName}`);
  }
  if (session.answers.solutionName) {
    lines.push(`default solution: ${session.answers.solutionName}`);
  }
  if (session.answers.stageName) {
    lines.push(`default stage: ${session.answers.stageName}`);
  }

  return lines;
}

function renderFinalSummary(session: InitSession): string[] {
  const lines: string[] = [];
  const artifactEntries = [
    session.artifacts.authProfile,
    session.artifacts.environment,
    session.artifacts.browserProfile,
    session.artifacts.project,
  ].filter((entry): entry is NonNullable<(typeof session.artifacts)[keyof typeof session.artifacts]> => Boolean(entry));

  for (const artifact of artifactEntries) {
    lines.push(`${artifact.name}: ${artifact.status}${artifact.detail ? ` (${artifact.detail})` : ''}`);
  }

  if (session.verification.auth !== 'pending') {
    lines.push(`authentication: ${session.verification.auth}`);
  }
  if (session.verification.browserBootstrap !== 'pending') {
    lines.push(`browser bootstrap: ${session.verification.browserBootstrap}`);
  }
  if (session.verification.project !== 'pending') {
    lines.push(`project scaffold: ${session.verification.project}`);
  }

  return lines;
}
