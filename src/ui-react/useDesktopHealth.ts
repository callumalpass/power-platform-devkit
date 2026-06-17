import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './utils.js';
import type { AccountSummary, ApiEnvelope, EnvironmentSummary, ToastFn } from './ui-types.js';
import { authRequiredHealthEntry, summarizeHealthFailure } from './setup/health.js';
import { HEALTH_APIS, type HealthMap, type TokenEntry, type TokenStatusMap } from './setup/types.js';

const HEALTH_CHECK_CONCURRENCY = 3;
const HEALTH_CHECK_TIMEOUT_MS = 12_000;

export type DesktopHealthState = {
  tokenStatus: TokenStatusMap;
  health: HealthMap;
  recheckHealth: () => void;
  recheckApi: (alias: string, apiName?: string) => void;
};

export function useDesktopHealth(props: { active: boolean; accounts: AccountSummary[]; environments: EnvironmentSummary[]; toast?: ToastFn }): DesktopHealthState {
  const { active, accounts, environments, toast } = props;
  const [tokenStatus, setTokenStatus] = useState<TokenStatusMap>({});
  const [health, setHealth] = useState<HealthMap>({});
  const tokenStatusRunRef = useRef(0);
  const healthRunRef = useRef(0);
  const lastAutoCheckKeyRef = useRef('');
  const accountsRef = useRef<AccountSummary[]>([]);
  const environmentsRef = useRef<EnvironmentSummary[]>([]);
  const autoCheckKey = useMemo(() => `${fingerprintAccounts(accounts)}|${fingerprintEnvironments(environments)}`, [accounts, environments]);

  useEffect(() => {
    accountsRef.current = accounts;
    environmentsRef.current = environments;
  }, [accounts, environments]);

  const beginTokenStatusRun = useCallback((): number => {
    tokenStatusRunRef.current += 1;
    return tokenStatusRunRef.current;
  }, []);

  const beginHealthRun = useCallback((): number => {
    healthRunRef.current += 1;
    return healthRunRef.current;
  }, []);

  const isCurrentTokenStatusRun = useCallback((runId: number): boolean => tokenStatusRunRef.current === runId, []);
  const isCurrentHealthRun = useCallback((runId: number): boolean => healthRunRef.current === runId, []);

  const checkTokenStatuses = useCallback(
    async (accountList: AccountSummary[], runId: number): Promise<TokenStatusMap> => {
      const entries = await Promise.all(
        accountList.map(async (account): Promise<[string, NonNullable<TokenEntry>]> => {
          try {
            const data = await api<ApiEnvelope<NonNullable<TokenEntry>>>(`/api/accounts/token-status?account=${encodeURIComponent(account.name)}`, { allowFailure: true });
            return [account.name, data.success && data.data ? data.data : { authenticated: false }];
          } catch {
            return [account.name, { authenticated: false }];
          }
        })
      );
      const nextStatus = Object.fromEntries(entries) as TokenStatusMap;
      if (isCurrentTokenStatusRun(runId)) {
        setTokenStatus((current) => ({ ...current, ...nextStatus }));
      }
      return nextStatus;
    },
    [isCurrentTokenStatusRun]
  );

  const pingApi = useCallback(
    async (alias: string, apiName: string, runId: number, markPending = true) => {
      if (!isCurrentHealthRun(runId)) return;
      if (markPending) {
        setHealth((current) => markHealthPending(current, [{ alias, apiName }]));
      }
      try {
        const payload = await api<ApiEnvelope<unknown>>('/api/checks/ping', {
          method: 'POST',
          body: JSON.stringify({ environment: alias, api: apiName, softFail: true, timeoutMs: HEALTH_CHECK_TIMEOUT_MS }),
          allowFailure: true
        });
        const value = payload.success !== false ? { status: 'ok', summary: 'Reachable' } : summarizeHealthFailure(payload);
        if (!isCurrentHealthRun(runId)) return;
        setHealth((current) => ({
          ...current,
          [alias]: { ...(current[alias] || {}), [apiName]: value }
        }));
      } catch {
        if (!isCurrentHealthRun(runId)) return;
        setHealth((current) => ({
          ...current,
          [alias]: {
            ...(current[alias] || {}),
            [apiName]: { status: 'error', summary: 'Request failed', detail: 'The health check request did not complete.' }
          }
        }));
      }
    },
    [isCurrentHealthRun]
  );

  const checkHealth = useCallback(
    async (environmentList: EnvironmentSummary[], runId: number, checkedTokenStatus?: TokenStatusMap) => {
      const checks: Array<{ alias: string; apiName: string }> = [];
      const skippedChecks: Array<{ alias: string; apiName: string }> = [];
      for (const environment of environmentList) {
        const target = checkedTokenStatus?.[environment.account];
        const targetChecks = HEALTH_APIS.map((apiName) => ({ alias: environment.alias, apiName }));
        if (target?.authenticated === false) skippedChecks.push(...targetChecks);
        else checks.push(...targetChecks);
      }
      if (isCurrentHealthRun(runId)) {
        setHealth((current) => markHealthAuthRequired(markHealthPending(current, checks), skippedChecks));
      }
      await runLimited(checks, HEALTH_CHECK_CONCURRENCY, (check) => pingApi(check.alias, check.apiName, runId, false));
    },
    [isCurrentHealthRun, pingApi]
  );

  useEffect(() => {
    const currentAccounts = accountsRef.current;
    const currentEnvironments = environmentsRef.current;
    if (!active || !currentAccounts.length || !currentEnvironments.length) return;
    if (lastAutoCheckKeyRef.current === autoCheckKey) return;
    lastAutoCheckKeyRef.current = autoCheckKey;
    const tokenRun = beginTokenStatusRun();
    const healthRun = beginHealthRun();
    void (async () => {
      const checkedTokenStatus = await checkTokenStatuses(currentAccounts, tokenRun);
      if (!isCurrentTokenStatusRun(tokenRun) || !isCurrentHealthRun(healthRun)) return;
      await checkHealth(currentEnvironments, healthRun, checkedTokenStatus);
    })();
    return () => {
      tokenStatusRunRef.current += 1;
      healthRunRef.current += 1;
    };
  }, [active, autoCheckKey, beginHealthRun, beginTokenStatusRun, checkHealth, checkTokenStatuses, isCurrentHealthRun, isCurrentTokenStatusRun]);

  const recheckHealth = useCallback(() => {
    const tokenRun = beginTokenStatusRun();
    const healthRun = beginHealthRun();
    void (async () => {
      const checkedTokenStatus = await checkTokenStatuses(accountsRef.current, tokenRun);
      if (!isCurrentTokenStatusRun(tokenRun) || !isCurrentHealthRun(healthRun)) return;
      await checkHealth(environmentsRef.current, healthRun, checkedTokenStatus);
    })();
    toast?.('Health checks started');
  }, [beginHealthRun, beginTokenStatusRun, checkHealth, checkTokenStatuses, isCurrentHealthRun, isCurrentTokenStatusRun, toast]);

  const recheckApi = useCallback(
    (alias: string, apiName?: string) => {
      const runId = beginHealthRun();
      if (apiName) {
        void pingApi(alias, apiName, runId);
      } else {
        const target = environmentsRef.current.find((environment) => environment.alias === alias);
        if (target) void checkHealth([target], runId);
      }
    },
    [beginHealthRun, checkHealth, pingApi]
  );

  return { tokenStatus, health, recheckHealth, recheckApi };
}

async function runLimited<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function markHealthPending(health: HealthMap, checks: Array<{ alias: string; apiName: string }>): HealthMap {
  const next: HealthMap = { ...health };
  for (const check of checks) {
    next[check.alias] = {
      ...(next[check.alias] || {}),
      [check.apiName]: { status: 'pending', summary: 'Checking...' }
    };
  }
  return next;
}

function markHealthAuthRequired(health: HealthMap, checks: Array<{ alias: string; apiName: string }>): HealthMap {
  const next: HealthMap = { ...health };
  for (const check of checks) {
    next[check.alias] = {
      ...(next[check.alias] || {}),
      [check.apiName]: authRequiredHealthEntry()
    };
  }
  return next;
}

function fingerprintAccounts(accounts: AccountSummary[]): string {
  return accounts.map((account) => [account.name, account.kind, account.tokenCacheKey, account.homeAccountId, account.localAccountId].join(':')).join('|');
}

function fingerprintEnvironments(environments: EnvironmentSummary[]): string {
  return environments.map((environment) => [environment.alias, environment.account, environment.url, environment.makerEnvironmentId].join(':')).join('|');
}
