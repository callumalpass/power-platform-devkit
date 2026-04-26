import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { DEFAULT_LOGIN_RESOURCE, type LoginAccountInput, type LoginTarget } from './auth.js';
import type { ConfigStoreOptions } from './config.js';
import { type OperationResult } from './diagnostics.js';
import { normalizeOrigin } from './request.js';
import { loginAccount } from './services/accounts.js';
import { listConfiguredEnvironments } from './services/environments.js';

export type AuthSessionStatus = 'pending' | 'waiting_for_user' | 'acquiring_token' | 'completed' | 'failed' | 'cancelled';

export type AuthTargetStatus = 'pending' | 'waiting_for_user' | 'acquiring_token' | 'completed' | 'failed' | 'skipped';

export type AuthAction = { kind: 'browser-url'; url: string } | { kind: 'device-code'; verificationUri: string; userCode: string; message: string };

export type AuthSessionTarget = LoginTarget & {
  id: string;
  status: AuthTargetStatus;
  action?: AuthAction;
  error?: string;
  lastCheckedAt?: string;
};

export interface AuthSession {
  id: string;
  accountName: string;
  status: AuthSessionStatus;
  createdAt: string;
  updatedAt: string;
  targets: AuthSessionTarget[];
  result?: OperationResult<Record<string, unknown>>;
}

export interface AuthSessionCreateInput {
  account: LoginAccountInput;
  preferredFlow?: 'interactive' | 'device-code';
  forcePrompt?: boolean;
  environmentAlias?: string;
  excludeApis?: string[];
  allowInteractiveAuth: boolean;
  configOptions?: ConfigStoreOptions;
}

type AuthSessionSubscriber = (session: AuthSession) => void;

export class AuthSessionStore {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly subscribers = new Map<string, Set<AuthSessionSubscriber>>();

  async createSession(input: AuthSessionCreateInput): Promise<AuthSession> {
    const environments = await listConfiguredEnvironments(input.configOptions);
    if (!environments.success || !environments.data) {
      return this.createFailedSession(input.account.name, [], {
        success: false,
        diagnostics: environments.diagnostics
      });
    }

    const targets = buildLoginTargets(input.account.name, environments.data, input.environmentAlias, input.excludeApis).map((target) => ({
      ...target,
      id: randomUUID(),
      status: 'pending' as const
    }));

    const now = new Date().toISOString();
    const session: AuthSession = {
      id: randomUUID(),
      accountName: input.account.name,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      targets
    };
    this.sessions.set(session.id, session);
    void this.runSession(
      session.id,
      input,
      targets.map((target) => ({ resource: target.resource, label: target.label, api: target.api }))
    );
    return cloneSession(session);
  }

  getSession(id: string): AuthSession | undefined {
    const session = this.sessions.get(id);
    return session ? cloneSession(session) : undefined;
  }

  cancelSession(id: string): AuthSession | undefined {
    const session = this.sessions.get(id);
    if (!session || session.status === 'completed' || session.status === 'failed') return session ? cloneSession(session) : undefined;
    this.updateSession(id, (draft) => {
      draft.status = 'cancelled';
      for (const target of draft.targets) {
        if (target.status === 'pending' || target.status === 'waiting_for_user' || target.status === 'acquiring_token') {
          target.status = 'skipped';
        }
      }
    });
    return this.getSession(id);
  }

  subscribe(id: string, subscriber: AuthSessionSubscriber): () => void {
    const subscribers = this.subscribers.get(id) ?? new Set<AuthSessionSubscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(id, subscribers);
    const session = this.sessions.get(id);
    if (session) subscriber(cloneSession(session));
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.subscribers.delete(id);
    };
  }

  streamSession(id: string, response: ServerResponse): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });
    const write = (session: AuthSession) => {
      response.write(`event: session\n`);
      response.write(`data: ${JSON.stringify(session)}\n\n`);
      if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
        response.end();
      }
    };
    const unsubscribe = this.subscribe(id, write);
    response.on('close', unsubscribe);
  }

  private async runSession(id: string, input: AuthSessionCreateInput, loginTargets: LoginTarget[]): Promise<void> {
    let activeTargetIndex = -1;
    try {
      const result = await loginAccount(
        input.account,
        {
          preferredFlow: input.preferredFlow ?? 'interactive',
          forcePrompt: input.forcePrompt,
          allowInteractive: input.allowInteractiveAuth,
          openInteractiveBrowser: false,
          terminalPrompts: false,
          loginTargets,
          onLoginTargetUpdate: async (progress) => {
            activeTargetIndex = progress.index;
            this.updateSession(id, (draft) => {
              const target = draft.targets[progress.index];
              if (!target) return;
              target.status = progress.url ? 'waiting_for_user' : 'acquiring_token';
              target.lastCheckedAt = new Date().toISOString();
              if (progress.url) target.action = { kind: 'browser-url', url: progress.url };
              draft.status = target.status === 'waiting_for_user' ? 'waiting_for_user' : 'acquiring_token';
            });
          },
          onDeviceCode: async (info) => {
            this.updateSession(id, (draft) => {
              const target = draft.targets[activeTargetIndex] ?? draft.targets.find((candidate) => candidate.status !== 'completed');
              if (!target) return;
              target.status = 'waiting_for_user';
              target.action = { kind: 'device-code', verificationUri: info.verificationUri, userCode: info.userCode, message: info.message };
              target.lastCheckedAt = new Date().toISOString();
              draft.status = 'waiting_for_user';
            });
          }
        },
        input.configOptions
      );

      this.updateSession(id, (draft) => {
        draft.result = result;
        if (result.success) {
          draft.status = 'completed';
          for (const target of draft.targets) {
            if (target.status !== 'failed' && target.status !== 'skipped') target.status = 'completed';
          }
        } else {
          draft.status = 'failed';
          const failedTarget = draft.targets[activeTargetIndex] ?? draft.targets.find((target) => target.status !== 'completed');
          if (failedTarget) {
            failedTarget.status = 'failed';
            failedTarget.error = result.diagnostics[0]?.message ?? 'Authentication failed.';
          }
        }
      });
    } catch (error) {
      this.updateSession(id, (draft) => {
        draft.status = 'failed';
        draft.result = {
          success: false,
          diagnostics: [
            {
              level: 'error',
              code: 'AUTH_SESSION_FAILED',
              message: error instanceof Error ? error.message : String(error),
              source: 'pp/ui-auth'
            }
          ]
        };
        const failedTarget = draft.targets[activeTargetIndex] ?? draft.targets.find((target) => target.status !== 'completed');
        if (failedTarget) {
          failedTarget.status = 'failed';
          failedTarget.error = draft.result.diagnostics[0]?.message;
        }
      });
    }
  }

  private updateSession(id: string, update: (draft: AuthSession) => void): void {
    const session = this.sessions.get(id);
    if (!session || session.status === 'cancelled') return;
    update(session);
    session.updatedAt = new Date().toISOString();
    const snapshot = cloneSession(session);
    for (const subscriber of this.subscribers.get(id) ?? []) {
      subscriber(snapshot);
    }
  }

  private createFailedSession(accountName: string, targets: AuthSessionTarget[], result: OperationResult<Record<string, unknown>>): AuthSession {
    const now = new Date().toISOString();
    const session: AuthSession = {
      id: randomUUID(),
      accountName,
      status: 'failed',
      createdAt: now,
      updatedAt: now,
      targets,
      result
    };
    this.sessions.set(session.id, session);
    return cloneSession(session);
  }
}

function buildLoginTargets(accountName: string, environments: Array<{ alias: string; account: string; url: string }>, selectedEnvironmentAlias?: string, excludeApis?: string[]): LoginTarget[] {
  const excluded = new Set(excludeApis ?? []);
  const targets: LoginTarget[] = [];
  if (!excluded.has('dv')) {
    const relevantEnvironments = [
      ...environments.filter((environment) => environment.alias === selectedEnvironmentAlias),
      ...environments.filter((environment) => environment.account === accountName && environment.alias !== selectedEnvironmentAlias)
    ];
    for (const environment of relevantEnvironments) {
      targets.push({ resource: normalizeOrigin(environment.url), label: `Dataverse (${environment.alias})`, api: 'dv' });
    }
  }
  if (!excluded.has('flow')) targets.push({ resource: 'https://service.flow.microsoft.com', label: 'Flow', api: 'flow' });
  if (!excluded.has('powerapps')) targets.push({ resource: 'https://service.powerapps.com', label: 'Power Apps', api: 'powerapps' });
  if (!excluded.has('bap')) targets.push({ resource: 'https://api.bap.microsoft.com', label: 'Platform Admin', api: 'bap' });
  if (!excluded.has('graph')) targets.push({ resource: DEFAULT_LOGIN_RESOURCE, label: 'Graph', api: 'graph' });
  return dedupeLoginTargets(targets);
}

function dedupeLoginTargets(targets: LoginTarget[]): LoginTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (!target.resource || seen.has(target.resource)) return false;
    seen.add(target.resource);
    return true;
  });
}

function cloneSession(session: AuthSession): AuthSession {
  return {
    ...session,
    targets: session.targets.map((target) => ({ ...target, action: target.action ? { ...target.action } : undefined })),
    result: session.result ? { ...session.result, diagnostics: [...session.result.diagnostics] } : undefined
  };
}
