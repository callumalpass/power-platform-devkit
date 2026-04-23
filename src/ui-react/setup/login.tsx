import { useEffect, useRef, useState } from 'react';
import { api } from '../utils.js';
import { CopyButton, copyTextToClipboard } from '../CopyButton.js';
import type { ToastFn } from '../ui-types.js';
import type { AuthSession, LoginTarget } from './types.js';

function loginTargetLabel(target: LoginTarget | null | undefined): string {
  return target?.label || target?.api || 'service';
}

export function useAuthSession(toast: ToastFn, refreshState: (silent?: boolean) => Promise<void>) {
  const [activeSession, setActiveSession] = useState<AuthSession | null>(null);
  const [loginTargets, setLoginTargets] = useState<LoginTarget[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const pollRunRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollRunRef.current += 1;
      activeSessionIdRef.current = null;
    };
  }, []);

  function isCurrentPoll(id: string, runId: number): boolean {
    return mountedRef.current && pollRunRef.current === runId && activeSessionIdRef.current === id;
  }

  function handleSessionUpdate(session: AuthSession, runId: number) {
    if (!isCurrentPoll(session.id, runId)) return;
    setActiveSession(session);
    setLoginTargets(session.targets || []);
    if (session.status === 'completed') {
      void refreshState(true);
      toast('Authentication complete');
    } else if (session.status === 'failed') {
      const message = session.result?.diagnostics?.[0]?.message || 'Authentication failed';
      toast(message, true);
    }
  }

  function handleLoginStarted(session: AuthSession) {
    const runId = pollRunRef.current + 1;
    pollRunRef.current = runId;
    activeSessionIdRef.current = session.id;
    setActiveSession(session);
    setLoginTargets(session.targets || []);
    void pollSession(session.id, runId);
  }

  async function pollSession(id: string, runId: number) {
    let done = false;
    while (!done) {
      if (!isCurrentPoll(id, runId)) return;
      try {
        const payload = await api<any>(`/api/auth/sessions/${encodeURIComponent(id)}`);
        if (!isCurrentPoll(id, runId)) return;
        const next = payload.data as AuthSession | undefined;
        if (next) {
          handleSessionUpdate(next, runId);
          done = next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled';
        }
      } catch {
        if (!isCurrentPoll(id, runId)) return;
        toast('Authentication status disconnected', true);
        return;
      }
      if (!done) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  async function handleCancelLogin() {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    pollRunRef.current += 1;
    activeSessionIdRef.current = null;
    try {
      await api(`/api/auth/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' });
    } catch { /* ignore */ }
    setActiveSession(null);
    setLoginTargets([]);
  }

  function clearCompletedLogin() {
    pollRunRef.current += 1;
    activeSessionIdRef.current = null;
    setActiveSession(null);
    setLoginTargets([]);
  }

  return { activeSession, loginTargets, handleLoginStarted, handleCancelLogin, clearCompletedLogin };
}

export function LoginProgress(props: {
  session: AuthSession | null;
  loginTargets: LoginTarget[];
  onCancel: () => void;
  onDismiss: () => void;
  toast: ToastFn;
}) {
  const { session, loginTargets, onCancel, onDismiss, toast } = props;

  const completedCount = loginTargets.filter((t) => t.status === 'completed').length;
  const total = loginTargets.length;
  const currentTarget = loginTargets.find((t) => t.status === 'waiting_for_user' || t.status === 'acquiring_token');
  const currentIndex = currentTarget ? loginTargets.indexOf(currentTarget) + 1 : completedCount + 1;
  const currentDeviceCode = currentTarget?.action?.kind === 'device-code' ? currentTarget.action : null;
  const terminal = session?.status === 'completed' || session?.status === 'failed' || session?.status === 'cancelled';
  const accountLabel = session?.accountName?.trim() || 'selected account';
  const activeTargetLabel = loginTargetLabel(currentTarget);
  const title = session?.status === 'failed'
    ? `Authentication needs attention for ${accountLabel}`
    : completedCount === total && total > 0
    ? `Authentication complete for ${accountLabel}`
    : currentTarget
      ? currentTarget.status === 'waiting_for_user'
        ? `Sign in as ${accountLabel} for ${activeTargetLabel} (${currentIndex} of ${total})`
        : `Connecting ${accountLabel} to ${activeTargetLabel} (${currentIndex} of ${total})`
      : `Preparing sign-in for ${accountLabel}...`;

  return (
    <div className="login-progress-panel">
      <div className="login-progress-header">
        <div className="login-progress-title">
          {title}
        </div>
        <div className="login-progress-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
            const links = loginTargets
              .filter((t) => t.action?.kind === 'browser-url')
              .map((t) => (t.action?.kind === 'browser-url' ? t.action.url : ''));
            void copyTextToClipboard(links.join('\n'))
              .then(() => toast('Copied login URLs'))
              .catch((error) => toast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, true));
          }}>Copy URLs</button>
          {terminal ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>Dismiss</button>
          ) : (
            <button type="button" className="btn btn-danger btn-sm" onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>

      {currentDeviceCode ? (
        <div className="device-code-card">
          <div className="device-code-instruction">Go to the following URL and enter the code to sign in:</div>
          <div className="device-code-url-row">
            <a href={currentDeviceCode.verificationUri} target="_blank" rel="noreferrer" className="device-code-url">{currentDeviceCode.verificationUri}</a>
            <button type="button" className="btn btn-ghost device-code-open-btn" onClick={() => window.open(currentDeviceCode.verificationUri, '_blank', 'noreferrer')}>Open</button>
            <CopyButton value={currentDeviceCode.verificationUri} label="Copy URL" title="Copy verification URL" toast={toast} />
          </div>
          <div className="device-code-box">
            <span className="device-code-label">Your code</span>
            <span className="device-code-value">{currentDeviceCode.userCode}</span>
            <CopyButton value={currentDeviceCode.userCode} label="Copy" title="Copy device code" toast={toast} className="btn btn-ghost" />
          </div>
        </div>
      ) : null}

      <div className="login-progress-steps">
        {loginTargets.map((target, index) => {
          const isDone = target.status === 'completed';
          const isFailed = target.status === 'failed';
          const isActive = target.status === 'waiting_for_user' || target.status === 'acquiring_token';
          const isPending = !isDone && !isActive && !isFailed;
          const dotClass = isDone ? 'ok' : isFailed ? 'error' : isActive ? 'pending' : 'muted';
          const browserAction = target.action?.kind === 'browser-url' ? target.action : null;
          return (
            <div key={`${target.resource || target.api || index}`} className={`login-progress-step ${isActive ? 'active' : ''}`}>
              <div className="login-progress-step-head">
                <span className={`health-dot ${dotClass}`}></span>
                <strong>{loginTargetLabel(target) || target.resource}</strong>
                <span className={`login-progress-step-badge ${isDone ? 'done' : isFailed ? 'failed' : isActive ? 'active' : 'pending'}`}>
                  {isDone ? 'connected' : isFailed ? 'failed' : isActive ? (target.status === 'waiting_for_user' ? 'action required' : 'connecting') : 'pending'}
                </span>
              </div>
              {isActive && browserAction ? (
                <a href={browserAction.url} target="_blank" rel="noreferrer" className="login-progress-step-link btn btn-primary btn-sm" style={{ marginTop: 6, display: 'inline-block' }}>
                  Open sign-in page
                </a>
              ) : isFailed ? (
                <span style={{ fontSize: '0.6875rem', color: 'var(--danger)' }}>{target.error || 'Authentication failed.'}</span>
              ) : isPending ? (
                <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Waiting...</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
