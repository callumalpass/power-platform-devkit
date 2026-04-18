import { useEffect, useState } from 'react';
import type { ToastFn } from './ui-types.js';
import { ConfirmDialog, useConfirm } from './setup/ConfirmDialog.js';
import { useAuthSession, LoginProgress } from './setup/login.js';
import { OnboardingFlow } from './setup/OnboardingFlow.js';
import { StatusStrip } from './setup/StatusStrip.js';
import { AccountsPanel } from './setup/AccountsPanel.js';
import { EnvironmentsPanel } from './setup/EnvironmentsPanel.js';
import { AccessPanel } from './setup/AccessPanel.js';
import { ToolsPanel } from './setup/ToolsPanel.js';
import { summarizeHealthFailure } from './setup/health.js';
import {
  HEALTH_APIS,
  SETUP_SUB_TAB_LABELS,
  type HealthEntry,
  type SetupSubTab,
} from './setup/types.js';

type SetupTabProps = {
  active: boolean;
  shellData: any;
  globalEnvironment: string;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
};

export function SetupTab(props: SetupTabProps) {
  const { active, shellData, globalEnvironment, refreshState, toast } = props;
  const [setupSubTab, setSetupSubTab] = useState<SetupSubTab>('accounts');
  const [tokenStatus, setTokenStatus] = useState<Record<string, any>>({});
  const [health, setHealth] = useState<Record<string, Record<string, HealthEntry>>>({});
  const [selectedApis, setSelectedApis] = useState<Record<string, boolean>>({
    dv: true,
    flow: true,
    powerapps: true,
    bap: true,
    graph: false,
  });

  const login = useAuthSession(toast, refreshState);
  const confirm = useConfirm();
  const accounts = shellData?.accounts || [];
  const environments = shellData?.environments || [];

  useEffect(() => {
    if (!active || !shellData) return;
    void checkTokenStatuses(accounts);
    void checkHealth(environments);
  }, [active, shellData]);

  async function checkTokenStatuses(accountList: any[]) {
    await Promise.all(accountList.map(async (account) => {
      try {
        const response = await fetch(`/api/accounts/token-status?account=${encodeURIComponent(account.name)}`, {
          headers: { 'content-type': 'application/json' },
        });
        const data = await response.json();
        setTokenStatus((current) => ({
          ...current,
          [account.name]: data.success && data.data ? data.data : { authenticated: false },
        }));
      } catch {
        setTokenStatus((current) => ({ ...current, [account.name]: { authenticated: false } }));
      }
    }));
  }

  async function checkHealth(environmentList: any[]) {
    for (const environment of environmentList) {
      for (const apiName of HEALTH_APIS) {
        setHealth((current) => ({
          ...current,
          [environment.alias]: {
            ...(current[environment.alias] || {}),
            [apiName]: { status: 'pending', summary: 'Checking...' },
          },
        }));
        try {
          const response = await fetch('/api/checks/ping', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ environment: environment.alias, api: apiName, softFail: true }),
          });
          const payload = await response.json();
          const value = payload.success !== false ? { status: 'ok', summary: 'Reachable' } : summarizeHealthFailure(payload);
          setHealth((current) => ({
            ...current,
            [environment.alias]: { ...(current[environment.alias] || {}), [apiName]: value },
          }));
        } catch {
          setHealth((current) => ({
            ...current,
            [environment.alias]: {
              ...(current[environment.alias] || {}),
              [apiName]: { status: 'error', summary: 'Request failed', detail: 'The health check request did not complete.' },
            },
          }));
        }
      }
    }
  }

  function recheckHealth() {
    void checkHealth(environments);
    void checkTokenStatuses(accounts);
    toast('Health checks started');
  }

  // First-run onboarding takes over the whole panel.
  const isFirstRun = accounts.length === 0 || environments.length === 0;
  if (isFirstRun) {
    return (
      <>
        <OnboardingFlow
          shellData={shellData}
          globalEnvironment={globalEnvironment}
          selectedApis={selectedApis}
          setSelectedApis={setSelectedApis}
          refreshState={refreshState}
          toast={toast}
        />
        <ConfirmDialog request={confirm.request} onClose={confirm.close} />
      </>
    );
  }

  const showLoginDrawer = login.activeSession || login.loginTargets.length > 0;

  return (
    <div className="setup-layout">
      <StatusStrip
        accounts={accounts}
        environments={environments}
        tokenStatus={tokenStatus}
        health={health}
        onRecheck={recheckHealth}
        onRefresh={() => void refreshState(false)}
        onJumpToAccounts={() => setSetupSubTab('accounts')}
        onJumpToEnvironments={() => setSetupSubTab('environments')}
      />

      {showLoginDrawer ? (
        <div className="login-drawer">
          <LoginProgress
            session={login.activeSession}
            loginTargets={login.loginTargets}
            onCancel={login.handleCancelLogin}
            onDismiss={login.clearCompletedLogin}
            toast={toast}
          />
        </div>
      ) : null}

      <div className="dv-sub-nav">
        {(['accounts', 'environments', 'access', 'tools'] as SetupSubTab[]).map((tabName) => (
          <button
            key={tabName}
            className={`sub-tab ${setupSubTab === tabName ? 'active' : ''}`}
            type="button"
            onClick={() => setSetupSubTab(tabName)}
          >
            {SETUP_SUB_TAB_LABELS[tabName]}
          </button>
        ))}
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'accounts' ? 'active' : ''}`}>
        <AccountsPanel
          accounts={accounts}
          tokenStatus={tokenStatus}
          selectedApis={selectedApis}
          setSelectedApis={setSelectedApis}
          globalEnvironment={globalEnvironment}
          login={login}
          confirm={confirm}
          refreshState={refreshState}
          toast={toast}
        />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'environments' ? 'active' : ''}`}>
        <EnvironmentsPanel
          accounts={accounts}
          environments={environments}
          tokenStatus={tokenStatus}
          health={health}
          confirm={confirm}
          recheckHealth={recheckHealth}
          refreshState={refreshState}
          toast={toast}
        />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'access' ? 'active' : ''}`}>
        <AccessPanel active={active && setupSubTab === 'access'} environment={globalEnvironment} toast={toast} />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'tools' ? 'active' : ''}`}>
        <ToolsPanel accounts={accounts} shellData={shellData} toast={toast} />
      </div>

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
