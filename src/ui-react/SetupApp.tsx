import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './utils.js';
import { SetupTab } from './SetupTab.js';
import { EnvironmentPickerModal } from './EnvironmentPickerModal.js';
import { HeaderActions } from './HeaderActions.js';
import { ShortcutHelpModal } from './ShortcutHelpModal.js';
import { ConfirmDialog, useConfirm } from './setup/ConfirmDialog.js';
import { touchEnvironmentRecency } from './env-recency.js';
import { SETUP_TAB_ORDER } from './app-tabs.js';
import { ToastViewport, useToasts } from './toasts.js';
import { isMonacoKeyboardEvent } from './keyboard.js';
import type { ApiEnvelope, ShellState } from './ui-types.js';

export function SetupApp() {
  const { toasts, pushToast, dismissToast, log: toastLog, clearLog: clearToastLog } = useToasts();
  const [toastTrayOpen, setToastTrayOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('pp-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [shellData, setShellData] = useState<ShellState | null>(null);
  const [globalEnvironment, setGlobalEnvironment] = useState('');
  const [stateLoading, setStateLoading] = useState(true);
  const [envPickerOpen, setEnvPickerOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const envPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const envPickerReturnFocusRef = useRef<HTMLElement | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pp-theme', theme);
  }, [theme]);

  async function refreshState(silent = false) {
    setStateLoading(true);
    try {
      const payload = await api<ApiEnvelope<ShellState>>('/api/state');
      setShellData(payload.data);
      const environments = payload.data.environments.map((item) => item.alias);
      setGlobalEnvironment((current) => {
        if (current && environments.includes(current)) return current;
        return environments[0] || '';
      });
      if (!silent) pushToast('State refreshed');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setStateLoading(false);
    }
  }

  useEffect(() => {
    void refreshState(true);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isMonacoKeyboardEvent(event)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        envPickerReturnFocusRef.current = (document.activeElement as HTMLElement) || null;
        setEnvPickerOpen(true);
        return;
      }
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        const editable = target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        if (!editable) {
          event.preventDefault();
          setShortcutHelpOpen((current) => !current);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const currentEnvData = useMemo(() => {
    if (!globalEnvironment || !shellData?.environments) return undefined;
    return shellData.environments.find((environment) => environment.alias === globalEnvironment);
  }, [globalEnvironment, shellData]);

  return (
    <>
      <ToastViewport toasts={toasts} dismissToast={dismissToast} />

      <header className="header">
        <div className="header-inner">
          <span className="logo" aria-label="pp">
            <span className="logo-mark">pp</span>
          </span>
          <div className="header-env">
            <label htmlFor="global-environment">Environment</label>
            <button
              type="button"
              id="global-environment"
              ref={envPickerTriggerRef}
              className="env-trigger"
              onClick={() => {
                envPickerReturnFocusRef.current = envPickerTriggerRef.current;
                setEnvPickerOpen(true);
              }}
              title="Switch active environment (Ctrl+K)"
            >
              <span className="env-trigger-text">
                {globalEnvironment ? (
                  <>
                    <span className="env-trigger-alias">{globalEnvironment}</span>
                    {currentEnvData?.account ? <span className="env-trigger-account">{currentEnvData.account}</span> : null}
                  </>
                ) : (
                  <span className="env-trigger-placeholder">Select…</span>
                )}
              </span>
              <span className="env-trigger-chevron" aria-hidden="true">
                ▾
              </span>
            </button>
          </div>
          <div className="header-flex-spacer" aria-hidden="true" />
          <HeaderActions
            appName="PP Setup Manager"
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            toastLog={toastLog}
            clearToastLog={clearToastLog}
            toastTrayOpen={toastTrayOpen}
            setToastTrayOpen={setToastTrayOpen}
            headerMenuOpen={headerMenuOpen}
            setHeaderMenuOpen={setHeaderMenuOpen}
            openConfirm={confirm.open}
            openShortcutHelp={() => setShortcutHelpOpen(true)}
          />
        </div>
      </header>

      <div className="app-main">
        <div className="tab-panel stack active" id="panel-setup">
          <SetupTab active={true} shellData={shellData} globalEnvironment={globalEnvironment} refreshState={refreshState} toast={pushToast} />
        </div>
      </div>

      {stateLoading ? (
        <div className="app-loading-bar" aria-hidden="true">
          <span />
        </div>
      ) : null}

      {envPickerOpen ? (
        <EnvironmentPickerModal
          environments={shellData?.environments || []}
          accounts={shellData?.accounts || []}
          current={globalEnvironment}
          toast={pushToast}
          onSelect={(alias) => {
            setGlobalEnvironment(alias);
            touchEnvironmentRecency(alias);
          }}
          onClose={() => {
            setEnvPickerOpen(false);
            const target = envPickerReturnFocusRef.current;
            envPickerReturnFocusRef.current = null;
            if (target && typeof target.focus === 'function') {
              window.setTimeout(() => target.focus(), 0);
            }
          }}
        />
      ) : null}

      {shortcutHelpOpen ? <ShortcutHelpModal tabs={SETUP_TAB_ORDER} showConsoleShortcuts={false} onClose={() => setShortcutHelpOpen(false)} /> : null}

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </>
  );
}
