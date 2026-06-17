import type { AccountSummary, EnvironmentSummary } from './ui-types.js';
import { HEALTH_APIS, type HealthEntry, type HealthMap, type TokenEntry, type TokenStatusMap } from './setup/types.js';
import { isInteractiveAuthRequiredHealthEntry } from './setup/health.js';

export type StatusLevel = 'unknown' | 'pending' | 'ok' | 'warning' | 'error';

export type EnvironmentStatusSummary = {
  level: StatusLevel;
  label: string;
  detail: string;
  issueCount: number;
  account?: AccountSummary;
  token?: TokenEntry;
  health: Record<string, HealthEntry>;
};

export type SetupChecklistItem = {
  key: string;
  level: StatusLevel;
  title: string;
  detail: string;
  action?: 'accounts' | 'environments' | 'access' | 'tools' | 'recheck';
};

export function summarizeEnvironmentStatus(environment: EnvironmentSummary | undefined, accounts: AccountSummary[], tokenStatus: TokenStatusMap, health: HealthMap): EnvironmentStatusSummary {
  if (!environment) {
    return {
      level: 'unknown',
      label: 'No environment',
      detail: 'Select or add an environment before running environment-scoped requests.',
      issueCount: 1,
      health: {}
    };
  }

  const account = accounts.find((candidate) => candidate.name === environment.account);
  const token = environment.account ? tokenStatus[environment.account] : undefined;
  const envHealth = health[environment.alias] || {};

  if (!environment.account || !account) {
    return {
      level: 'error',
      label: 'Account missing',
      detail: `${environment.alias} is not attached to a configured account.`,
      issueCount: 1,
      account,
      token,
      health: envHealth
    };
  }

  if (token?.authenticated === false) {
    return {
      level: 'error',
      label: 'Sign in required',
      detail: `${environment.account} needs a cached token before health checks can run.`,
      issueCount: HEALTH_APIS.length,
      account,
      token,
      health: envHealth
    };
  }

  let pending = 0;
  let authRequired = 0;
  let failing = 0;
  for (const apiName of HEALTH_APIS) {
    const entry = envHealth[apiName];
    if (!entry || entry.status === 'pending') {
      pending += 1;
      continue;
    }
    if (entry.status === 'error') {
      if (isInteractiveAuthRequiredHealthEntry(entry)) authRequired += 1;
      else failing += 1;
    }
  }

  if (authRequired > 0) {
    return {
      level: 'error',
      label: 'API sign-in required',
      detail: `${authRequired} API ${authRequired === 1 ? 'check needs' : 'checks need'} interactive authentication.`,
      issueCount: authRequired,
      account,
      token,
      health: envHealth
    };
  }
  if (failing > 0) {
    return {
      level: 'error',
      label: 'API issues',
      detail: `${failing} API ${failing === 1 ? 'check is' : 'checks are'} failing for ${environment.alias}.`,
      issueCount: failing,
      account,
      token,
      health: envHealth
    };
  }
  if (pending > 0) {
    return {
      level: 'pending',
      label: 'Checking',
      detail: `${pending} API ${pending === 1 ? 'check is' : 'checks are'} still pending.`,
      issueCount: 0,
      account,
      token,
      health: envHealth
    };
  }

  return {
    level: 'ok',
    label: 'Healthy',
    detail: `${environment.alias} is reachable across configured APIs.`,
    issueCount: 0,
    account,
    token,
    health: envHealth
  };
}

export function buildSetupChecklist(accounts: AccountSummary[], environments: EnvironmentSummary[], tokenStatus: TokenStatusMap, health: HealthMap): SetupChecklistItem[] {
  const items: SetupChecklistItem[] = [];
  const anyAuthenticated = accounts.some((account) => tokenStatus[account.name]?.authenticated);

  items.push({
    key: 'accounts',
    level: accounts.length ? 'ok' : 'error',
    title: 'Accounts',
    detail: accounts.length ? `${accounts.length} configured account${accounts.length === 1 ? '' : 's'}.` : 'Add an account before configuring environments.',
    action: 'accounts'
  });

  items.push({
    key: 'tokens',
    level: !accounts.length ? 'unknown' : anyAuthenticated ? 'ok' : 'warning',
    title: 'Authentication',
    detail: !accounts.length ? 'Waiting for an account.' : anyAuthenticated ? 'At least one account has a cached token.' : 'Sign in to at least one interactive account.',
    action: 'accounts'
  });

  items.push({
    key: 'environments',
    level: environments.length ? 'ok' : accounts.length ? 'warning' : 'unknown',
    title: 'Environments',
    detail: environments.length ? `${environments.length} configured environment${environments.length === 1 ? '' : 's'}.` : 'Add or discover an environment.',
    action: 'environments'
  });

  const summaries = environments.map((environment) => summarizeEnvironmentStatus(environment, accounts, tokenStatus, health));
  const failing = summaries.filter((summary) => summary.level === 'error');
  const pending = summaries.filter((summary) => summary.level === 'pending');
  items.push({
    key: 'health',
    level: !environments.length ? 'unknown' : failing.length ? 'error' : pending.length ? 'pending' : 'ok',
    title: 'API health',
    detail: !environments.length
      ? 'Waiting for an environment.'
      : failing.length
        ? `${failing.length} environment${failing.length === 1 ? '' : 's'} need attention.`
        : pending.length
          ? `${pending.length} environment${pending.length === 1 ? '' : 's'} still checking.`
          : 'Configured environments are reachable.',
    action: failing.length || pending.length ? 'recheck' : 'environments'
  });

  return items;
}
