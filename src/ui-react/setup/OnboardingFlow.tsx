import { useEffect, useState } from 'react';
import type { ApiEnvelope, ShellState, ToastFn } from '../ui-types.js';
import { api } from '../utils.js';
import { AddAccountForm } from './AccountsPanel.js';
import { AddEnvironmentForm } from './EnvironmentsPanel.js';
import { LoginProgress, useAuthSession } from './login.js';
import type { AuthSession, SetupAccount } from './types.js';

type OnboardingStep = 'account' | 'environment' | 'done';

export function getOnboardingStep(accounts: readonly unknown[], environments: readonly unknown[]): OnboardingStep {
  if (accounts.length === 0) return 'account';
  if (environments.length === 0) return 'environment';
  return 'done';
}

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
  const [showAdditionalAccountForm, setShowAdditionalAccountForm] = useState(false);

  const hasAccounts = accounts.length > 0;
  const hasEnvironments = environments.length > 0;
  const step = getOnboardingStep(accounts, environments);
  const showLoginProgress = login.activeSession || login.loginTargets.length > 0;

  useEffect(() => {
    if (!hasAccounts) setShowAdditionalAccountForm(false);
  }, [hasAccounts]);

  async function handleBapLogin(account: SetupAccount) {
    try {
      const started = await api<ApiEnvelope<AuthSession>>('/api/auth/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: account.name,
          kind: account.kind === 'device-code' ? 'device-code' : 'user',
          loginHint: account.loginHint || account.accountUsername,
          tenantId: account.tenantId,
          clientId: account.clientId,
          excludeApis: ['dv', 'flow', 'powerapps', 'graph']
        })
      });
      login.handleLoginStarted(started.data);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

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
            {showLoginProgress ? (
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
            <div className="onboarding-section-header">
              <div>
                <h2>Add an environment</h2>
                <p className="desc">Discover the Power Platform environments available to your account, or enter one manually.</p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowAdditionalAccountForm((current) => !current)}>
                {showAdditionalAccountForm ? 'Hide account form' : 'Add another account'}
              </button>
            </div>
            {showLoginProgress ? (
              <LoginProgress session={login.activeSession} loginTargets={login.loginTargets} onCancel={login.handleCancelLogin} onDismiss={login.clearCompletedLogin} toast={toast} />
            ) : showAdditionalAccountForm ? (
              <section className="onboarding-inline-section">
                <h3>Add account</h3>
                <AddAccountForm
                  accounts={accounts}
                  selectedApis={selectedApis}
                  setSelectedApis={setSelectedApis}
                  globalEnvironment={globalEnvironment}
                  onLoginStarted={login.handleLoginStarted}
                  refreshState={refreshState}
                  toast={toast}
                  onSaved={() => setShowAdditionalAccountForm(false)}
                />
              </section>
            ) : null}
            <AddEnvironmentForm accounts={accounts} refreshState={refreshState} toast={toast} startBapLogin={handleBapLogin} />
          </>
        ) : null}
      </div>
    </div>
  );
}
