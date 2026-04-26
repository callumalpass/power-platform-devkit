import type { ShellState, ToastFn } from '../ui-types.js';
import { AddAccountForm } from './AccountsPanel.js';
import { AddEnvironmentForm } from './EnvironmentsPanel.js';
import { LoginProgress, useAuthSession } from './login.js';

export function OnboardingFlow(props: {
  shellData: ShellState | null;
  globalEnvironment: string;
  selectedApis: Record<string, boolean>;
  setSelectedApis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { shellData, globalEnvironment, selectedApis, setSelectedApis, refreshState, toast } = props;
  const accounts = shellData?.accounts || [];
  const environments = shellData?.environments || [];
  const login = useAuthSession(toast, refreshState);

  const hasAccounts = accounts.length > 0;
  const hasEnvironments = environments.length > 0;
  const step = hasEnvironments ? 'done' : hasAccounts ? 'environment' : 'account';

  if (step === 'done') return null;

  return (
    <div className="onboarding">
      <div className="onboarding-card panel">
        <div className="onboarding-steps">
          <div className={`onboarding-step-indicator ${step === 'account' ? 'active' : 'done'}`}>
            <span className={`health-dot ${hasAccounts ? 'ok' : 'pending'}`}></span>
            <span>1. Connect account</span>
          </div>
          <div className="onboarding-step-divider"></div>
          <div className={`onboarding-step-indicator ${step === 'environment' ? 'active' : hasEnvironments ? 'done' : ''}`}>
            <span className={`health-dot ${hasEnvironments ? 'ok' : step === 'environment' ? 'pending' : 'muted'}`}></span>
            <span>2. Add environment</span>
          </div>
        </div>

        {step === 'account' ? (
          <>
            <h2>Connect your first account</h2>
            <p className="desc">Add a Microsoft account to start working with Power Platform. You'll sign in through your browser.</p>
            {login.activeSession || login.loginTargets.length > 0 ? (
              <LoginProgress session={login.activeSession} loginTargets={login.loginTargets} onCancel={login.handleCancelLogin} onDismiss={login.clearCompletedLogin} toast={toast} />
            ) : (
              <AddAccountForm
                accounts={accounts}
                selectedApis={selectedApis}
                setSelectedApis={setSelectedApis}
                globalEnvironment={globalEnvironment}
                onLoginStarted={login.handleLoginStarted}
                refreshState={refreshState}
                toast={toast}
              />
            )}
          </>
        ) : step === 'environment' ? (
          <>
            <h2>Add an environment</h2>
            <p className="desc">Discover the Power Platform environments available to your account, or enter one manually.</p>
            <AddEnvironmentForm accounts={accounts} refreshState={refreshState} toast={toast} />
          </>
        ) : null}
      </div>
    </div>
  );
}
