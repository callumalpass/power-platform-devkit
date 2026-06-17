import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './utils.js';
import { SetupTab } from './SetupTab.js';
import { EnvironmentPickerModal } from './EnvironmentPickerModal.js';
import { HeaderActions } from './HeaderActions.js';
import { ShortcutHelpModal } from './ShortcutHelpModal.js';
import { EnvironmentStatusButton } from './EnvironmentStatus.js';
import { ConfirmDialog, useConfirm } from './setup/ConfirmDialog.js';
import { touchEnvironmentRecency } from './env-recency.js';
import { SETUP_TAB_ORDER } from './app-tabs.js';
import { ToastViewport, useToasts } from './toasts.js';
import { isMonacoKeyboardEvent } from './keyboard.js';
import { summarizeEnvironmentStatus } from './desktop-status.js';
import { useDesktopHealth } from './useDesktopHealth.js';
import type { ApiEnvelope, ShellState } from './ui-types.js';
import type { EnvironmentPickerCommand } from './EnvironmentPickerModal.js';

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
  const accounts = useMemo(() => shellData?.accounts || [], [shellData]);
  const environments = useMemo(() => shellData?.environments || [], [shellData]);
  const desktopHealth = useDesktopHealth({ active: Boolean(shellData), accounts, environments, toast: pushToast });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pp-theme', theme);
  }, [theme]);

  const refreshState = useCallback(
    async (silent = false) => {
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
    },
    [pushToast]
  );

  useEffect(() => {
    void refreshState(true);
  }, [refreshState]);

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
    if (!globalEnvironment) return undefined;
    return environments.find((environment) => environment.alias === globalEnvironment);
  }, [globalEnvironment, environments]);

  const environmentStatus = useMemo(
    () => summarizeEnvironmentStatus(currentEnvData, accounts, desktopHealth.tokenStatus, desktopHealth.health),
    [accounts, currentEnvData, desktopHealth.health, desktopHealth.tokenStatus]
  );
  const paletteCommands = useMemo<EnvironmentPickerCommand[]>(
    () => [
      {
        id: 'refresh-state',
        label: 'Refresh state',
        detail: 'Reload accounts, environments, and setup metadata.',
        keywords: ['reload', 'accounts', 'environments'],
        run: () => void refreshState(false)
      },
      {
        id: 'recheck-active-environment',
        label: 'Re-check active environment',
        detail: currentEnvData ? `Run API health checks for ${currentEnvData.alias}.` : 'Run setup health checks after adding an environment.',
        keywords: ['health', 'auth', 'token', 'ping'],
        run: () => {
          if (currentEnvData) desktopHealth.recheckApi(currentEnvData.alias);
          else desktopHealth.recheckHealth();
        }
      }
    ],
    [currentEnvData, desktopHealth, refreshState]
  );

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
          <EnvironmentStatusButton
            summary={environmentStatus}
            onOpen={() => {
              envPickerReturnFocusRef.current = envPickerTriggerRef.current;
              setEnvPickerOpen(true);
            }}
            onRecheck={() => {
              if (currentEnvData) desktopHealth.recheckApi(currentEnvData.alias);
              else desktopHealth.recheckHealth();
            }}
          />
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
          <SetupTab active={true} shellData={shellData} globalEnvironment={globalEnvironment} desktopHealth={desktopHealth} refreshState={refreshState} toast={pushToast} />
        </div>
      </div>

      {stateLoading ? (
        <div className="app-loading-bar" role="status" aria-label="Refreshing setup state">
          <span />
          <strong className="app-loading-label">Refreshing setup</strong>
        </div>
      ) : null}

      {envPickerOpen ? (
        <EnvironmentPickerModal
          environments={shellData?.environments || []}
          accounts={shellData?.accounts || []}
          current={globalEnvironment}
          commands={paletteCommands}
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
