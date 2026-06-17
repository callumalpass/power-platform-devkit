import { useMemo, useState } from 'react';
import type { AccountSummary, EnvironmentSummary, ShellState, ToastFn } from './ui-types.js';
import { ConfirmDialog, useConfirm } from './setup/ConfirmDialog.js';
import { useAuthSession, LoginProgress } from './setup/login.js';
import { OnboardingFlow } from './setup/OnboardingFlow.js';
import { StatusStrip } from './setup/StatusStrip.js';
import { SetupChecklist } from './setup/SetupChecklist.js';
import { AccountsPanel } from './setup/AccountsPanel.js';
import { EnvironmentsPanel } from './setup/EnvironmentsPanel.js';
import { AccessPanel } from './setup/AccessPanel.js';
import { ToolsPanel } from './setup/ToolsPanel.js';
import { SETUP_SUB_TAB_LABELS, type SetupSubTab } from './setup/types.js';
import type { DesktopHealthState } from './useDesktopHealth.js';

type SetupTabProps = {
  active: boolean;
  shellData: ShellState | null;
  globalEnvironment: string;
  desktopHealth: DesktopHealthState;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
};

export function SetupTab(props: SetupTabProps) {
  const { active, shellData, globalEnvironment, desktopHealth, refreshState, toast } = props;
  const [setupSubTab, setSetupSubTab] = useState<SetupSubTab>('accounts');
  const [selectedApis, setSelectedApis] = useState<Record<string, boolean>>({
    dv: true,
    flow: true,
    powerapps: true,
    bap: true,
    graph: false
  });

  const login = useAuthSession(toast, refreshState);
  const confirm = useConfirm();
  const accounts: AccountSummary[] = useMemo(() => shellData?.accounts || [], [shellData]);
  const environments: EnvironmentSummary[] = useMemo(() => shellData?.environments || [], [shellData]);
  const { tokenStatus, health, recheckHealth, recheckApi } = desktopHealth;

  // First-run onboarding takes over the whole panel.
  const isFirstRun = accounts.length === 0 || environments.length === 0;
  if (isFirstRun) {
    return (
      <>
        <OnboardingFlow shellData={shellData} globalEnvironment={globalEnvironment} selectedApis={selectedApis} setSelectedApis={setSelectedApis} refreshState={refreshState} toast={toast} />
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
      <SetupChecklist accounts={accounts} environments={environments} tokenStatus={tokenStatus} health={health} onJump={setSetupSubTab} onRecheck={recheckHealth} />

      {showLoginDrawer ? (
        <div className="login-drawer">
          <LoginProgress session={login.activeSession} loginTargets={login.loginTargets} onCancel={login.handleCancelLogin} onDismiss={login.clearCompletedLogin} toast={toast} />
        </div>
      ) : null}

      <div className="dv-sub-nav">
        {(['accounts', 'environments', 'access', 'tools'] as SetupSubTab[]).map((tabName) => (
          <button key={tabName} className={`sub-tab ${setupSubTab === tabName ? 'active' : ''}`} type="button" onClick={() => setSetupSubTab(tabName)}>
            {SETUP_SUB_TAB_LABELS[tabName]}
          </button>
        ))}
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'accounts' ? 'active' : ''}`}>
        <AccountsPanel
          accounts={accounts}
          environments={environments}
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
          login={login}
          recheckHealth={recheckHealth}
          recheckApi={recheckApi}
          refreshState={refreshState}
          toast={toast}
        />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'access' ? 'active' : ''}`}>
        <AccessPanel active={active && setupSubTab === 'access'} environment={globalEnvironment} toast={toast} />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'tools' ? 'active' : ''}`}>
        <ToolsPanel accounts={accounts} login={login} shellData={shellData} toast={toast} />
      </div>

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
