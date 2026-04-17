import { useState } from 'react';
import { formatTimeRemaining } from '../utils.js';
import { HEALTH_APIS, type HealthEntry } from './types.js';

type Issue = { kind: 'account' | 'env'; alias?: string; message: string };

export function StatusStrip(props: {
  accounts: any[];
  environments: any[];
  tokenStatus: Record<string, any>;
  health: Record<string, Record<string, HealthEntry>>;
  onRecheck: () => void;
  onRefresh: () => void;
  onJumpToAccounts: () => void;
  onJumpToEnvironments: () => void;
}) {
  const { accounts, environments, tokenStatus, health, onRecheck, onRefresh, onJumpToAccounts, onJumpToEnvironments } = props;
  const [expanded, setExpanded] = useState(false);

  const issues: Issue[] = [];
  for (const account of accounts) {
    const token = tokenStatus[account.name];
    if (token && !token.authenticated) {
      issues.push({ kind: 'account', message: `Account "${account.name}" is not authenticated` });
    } else if (token?.authenticated) {
      const expiry = formatTimeRemaining(token.expiresAt);
      if (expiry?.cls === 'expired') {
        issues.push({ kind: 'account', message: `Token for "${account.name}" has expired` });
      }
    }
  }
  for (const env of environments) {
    const envHealth = health[env.alias] || {};
    for (const apiName of HEALTH_APIS) {
      const state = envHealth[apiName];
      if (state?.status === 'error') {
        issues.push({ kind: 'env', alias: env.alias, message: `${env.alias} · ${apiName}: ${state.summary}` });
      }
    }
  }

  return (
    <>
      <div className="setup-status-strip">
        <span className="setup-status-strip-item">
          <strong>{accounts.length}</strong> account{accounts.length === 1 ? '' : 's'}
        </span>
        <span className="setup-status-strip-item">
          <strong>{environments.length}</strong> environment{environments.length === 1 ? '' : 's'}
        </span>
        {issues.length > 0 ? (
          <button
            type="button"
            className="setup-status-strip-item issues"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span className="health-dot error"></span>
            {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
          </button>
        ) : (
          <span className="setup-status-strip-item">
            <span className="health-dot ok"></span>
            Healthy
          </span>
        )}
        <span className="setup-status-strip-spacer"></span>
        <span className="setup-status-strip-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRecheck}>Re-check</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>Refresh</button>
        </span>
      </div>
      {expanded && issues.length > 0 ? (
        <div className="setup-status-issues" role="region" aria-label="Active issues">
          {issues.map((issue, i) => (
            <div key={i} className="status-issue">
              <span className="health-dot error"></span>
              <span>{issue.message}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={issue.kind === 'account' ? onJumpToAccounts : onJumpToEnvironments}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
