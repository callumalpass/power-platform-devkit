import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { ConfigStoreOptions } from './config.js';
import {
  disposeCanvasSession,
  loadCanvasSessions,
  probeCanvasSession,
  removeCanvasSession,
  saveCanvasSession,
  startCanvasAuthoringSession,
  type PersistedCanvasSession,
  type StartCanvasAuthoringSessionResult
} from './services/canvas-authoring.js';

export type CanvasSessionStatus = 'starting' | 'waiting_for_auth' | 'active' | 'failed' | 'unknown';

export interface CanvasSessionDeviceCode {
  verificationUri: string;
  userCode: string;
  message: string;
}

export interface CanvasSession {
  id: string;
  environmentAlias: string;
  appId: string;
  accountName?: string;
  status: CanvasSessionStatus;
  createdAt: string;
  updatedAt: string;
  result?: StartCanvasAuthoringSessionResult;
  error?: string;
  deviceCode?: CanvasSessionDeviceCode;
}

export interface CanvasSessionCreateInput {
  environmentAlias: string;
  appId: string;
  accountName?: string;
  cadence?: string;
  clusterCategory?: string;
  allowInteractive: boolean;
  configOptions?: ConfigStoreOptions;
}

type CanvasSessionSubscriber = (session: CanvasSession) => void;
type StartCanvasSession = typeof startCanvasAuthoringSession;
type SaveCanvasSession = typeof saveCanvasSession;

export class CanvasSessionStore {
  private readonly sessions = new Map<string, CanvasSession>();
  private readonly subscribers = new Map<string, Set<CanvasSessionSubscriber>>();

  constructor(
    private readonly startSession: StartCanvasSession = startCanvasAuthoringSession,
    private readonly persistSession: SaveCanvasSession = saveCanvasSession
  ) {}

  async loadPersistedSessions(configOptions: ConfigStoreOptions = {}): Promise<void> {
    const persisted = await loadCanvasSessions(configOptions);
    for (const entry of persisted) {
      if (this.sessions.has(entry.sessionId)) continue;
      const session: CanvasSession = {
        id: entry.sessionId,
        environmentAlias: entry.environmentAlias,
        appId: entry.appId,
        accountName: entry.account,
        status: 'unknown',
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
        result: {
          appId: entry.appId,
          environmentId: entry.environmentId,
          account: entry.account,
          sessionId: entry.sessionId,
          startRequestId: '',
          cluster: entry.cluster,
          authoringBaseUrl: entry.authoringBaseUrl,
          startPath: '',
          startStatus: 200,
          session: { sessionState: entry.sessionState, clientConfig: { webAuthoringVersion: entry.webAuthoringVersion } }
        }
      };
      this.sessions.set(session.id, session);
    }
  }

  async probeSession(id: string, configOptions: ConfigStoreOptions = {}): Promise<CanvasSession | undefined> {
    const session = this.sessions.get(id);
    if (!session || !session.result) return session ? cloneSession(session) : undefined;
    const persisted = toPersistedSession(session);
    if (!persisted) return cloneSession(session);
    const alive = await probeCanvasSession(persisted, configOptions);
    this.updateSession(id, (draft) => {
      draft.status = alive ? 'active' : 'failed';
      if (!alive) draft.error = 'Session is no longer active.';
    });
    return this.getSession(id);
  }

  async endSession(id: string, configOptions: ConfigStoreOptions = {}): Promise<CanvasSession | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const persisted = toPersistedSession(session);
    if (persisted) {
      await disposeCanvasSession(persisted, configOptions);
    } else {
      await removeCanvasSession(id, configOptions);
    }
    this.sessions.delete(id);
    return cloneSession({ ...session, status: 'failed', error: 'Session ended.' });
  }

  async createSession(input: CanvasSessionCreateInput): Promise<CanvasSession> {
    const now = new Date().toISOString();
    const session: CanvasSession = {
      id: randomUUID(),
      environmentAlias: input.environmentAlias,
      appId: input.appId,
      accountName: input.accountName,
      status: 'starting',
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(session.id, session);
    void this.runSession(session.id, input);
    return cloneSession(session);
  }

  getSession(id: string): CanvasSession | undefined {
    const session = this.sessions.get(id);
    return session ? cloneSession(session) : undefined;
  }

  listSessions(): CanvasSession[] {
    return [...this.sessions.values()].map(cloneSession);
  }

  subscribe(id: string, subscriber: CanvasSessionSubscriber): () => void {
    const subscribers = this.subscribers.get(id) ?? new Set<CanvasSessionSubscriber>();
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
    const write = (session: CanvasSession) => {
      response.write(`event: session\n`);
      response.write(`data: ${JSON.stringify(session)}\n\n`);
      if (session.status === 'active' || session.status === 'failed') {
        response.end();
      }
    };
    const unsubscribe = this.subscribe(id, write);
    response.on('close', unsubscribe);
  }

  private async runSession(id: string, input: CanvasSessionCreateInput): Promise<void> {
    try {
      const result = await this.startSession(
        {
          environmentAlias: input.environmentAlias,
          accountName: input.accountName,
          appId: input.appId,
          cadence: input.cadence,
          clusterCategory: input.clusterCategory,
          raw: true,
          allowInteractive: input.allowInteractive,
          onDeviceCode: (info) => {
            this.updateSession(id, (draft) => {
              draft.status = 'waiting_for_auth';
              draft.deviceCode = info;
            });
          }
        },
        input.configOptions
      );

      this.updateSession(id, (draft) => {
        if (result.success && result.data) {
          draft.status = 'active';
          draft.result = result.data;
          void this.persistSession(result.data, input.environmentAlias, input.configOptions);
        } else {
          draft.status = 'failed';
          draft.error = result.diagnostics[0]?.message ?? 'Canvas authoring session failed to start.';
        }
      });
    } catch (error) {
      this.updateSession(id, (draft) => {
        draft.status = 'failed';
        draft.error = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private updateSession(id: string, update: (draft: CanvasSession) => void): void {
    const session = this.sessions.get(id);
    if (!session) return;
    update(session);
    session.updatedAt = new Date().toISOString();
    const snapshot = cloneSession(session);
    for (const subscriber of this.subscribers.get(id) ?? []) {
      subscriber(snapshot);
    }
  }
}

function toPersistedSession(session: CanvasSession): PersistedCanvasSession | undefined {
  if (!session.result) return undefined;
  const sessionState = session.result.sessionState ?? extractStringField(session.result.session, 'sessionState');
  const webAuthoringVersion = session.result.webAuthoringVersion ?? extractStringField(extractObjectField(session.result.session, 'clientConfig'), 'webAuthoringVersion');
  if (!sessionState || !webAuthoringVersion) return undefined;
  return {
    sessionId: session.result.sessionId,
    appId: session.appId,
    environmentAlias: session.environmentAlias,
    environmentId: session.result.environmentId,
    account: session.result.account,
    authoringBaseUrl: session.result.authoringBaseUrl,
    webAuthoringVersion,
    sessionState,
    cluster: session.result.cluster,
    createdAt: session.createdAt
  };
}

function extractStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === 'string' ? entry : undefined;
}

function extractObjectField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[key];
}

function cloneSession(session: CanvasSession): CanvasSession {
  return { ...session, result: session.result ? { ...session.result } : undefined };
}
