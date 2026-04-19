import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getDefaultSelectedColumns, summarizeError } from './utils.js';
import { AutomateTab } from './AutomateTab.js';
import { SetupTab } from './SetupTab.js';
import { EnvironmentPickerModal } from './EnvironmentPickerModal.js';
import { HeaderActions } from './HeaderActions.js';
import { ShortcutHelpModal } from './ShortcutHelpModal.js';
import { ConfirmDialog, useConfirm } from './setup/ConfirmDialog.js';
import { touchEnvironmentRecency } from './env-recency.js';
import { currentTabFromHash, PrimaryTabs, TAB_ORDER, type TabName } from './app-tabs.js';
import { ToastViewport, useToasts } from './toasts.js';
import { ConsoleTab } from './console/ConsoleTab.js';
import { DataverseTab } from './dataverse/DataverseTab.js';
import { AppsTab, type AppsState } from './apps/AppsTab.js';
import { CanvasTab, type CanvasState } from './canvas/CanvasTab.js';
import { PlatformTab, type PlatformState } from './platform/PlatformTab.js';
import type { DataverseState } from './ui-types.js';

export function App() {
  const { toasts, pushToast, dismissToast, log: toastLog, clearLog: clearToastLog } = useToasts();
  const [toastTrayOpen, setToastTrayOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabName>(currentTabFromHash());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('pp-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [shellData, setShellData] = useState<any>(null);
  const [globalEnvironment, setGlobalEnvironment] = useState('');
  const [stateLoading, setStateLoading] = useState(true);
  const [envPickerOpen, setEnvPickerOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const envPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const envPickerReturnFocusRef = useRef<HTMLElement | null>(null);
  const confirm = useConfirm();

  const [consoleSeed, setConsoleSeed] = useState<any | null>(null);

  const [dataverse, setDataverse] = useState<DataverseState>({
    entitiesEnvironment: '',
    entities: [],
    entitiesLoadError: '',
    currentEntity: null,
    currentEntityDetail: null,
    currentEntityDiagnostics: [],
    selectedColumns: [] as string[],
    recordPreview: null as any,
    entityFilter: '',
    attrFilter: '',
    explorerSubTab: 'metadata',
    dvSubTab: 'dv-explorer',
    queryPreview: 'Preview a Dataverse path here.',
    queryResult: null,
  });

  const [appsState, setAppsState] = useState<AppsState>({
    loadedEnvironment: '',
    items: [],
    current: null,
    filter: '',
  });

  const [canvasState, setCanvasState] = useState<CanvasState>({
    sessions: [],
    sessionStarting: false,
  });

  const [platformState, setPlatformState] = useState<PlatformState>({
    loadedEnvironment: '',
    items: [],
    current: null,
    filter: '',
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pp-theme', theme);
  }, [theme]);

  useEffect(() => {
    const handler = (event: HashChangeEvent) => {
      setActiveTab(currentTabFromHash());
      if (event.newURL) void event.newURL;
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  async function refreshState(silent = false) {
    setStateLoading(true);
    try {
      const payload = await api<any>('/api/state');
      setShellData(payload.data);
      const environments = (payload.data.environments || []).map((item: any) => item.alias);
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        envPickerReturnFocusRef.current = (document.activeElement as HTMLElement) || null;
        setEnvPickerOpen(true);
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const digit = Number.parseInt(event.key, 10);
        if (Number.isInteger(digit) && digit >= 1 && digit <= TAB_ORDER.length) {
          event.preventDefault();
          setActiveTab(TAB_ORDER[digit - 1]);
        }
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

  useEffect(() => {
    setDataverse((current) => ({
      ...current,
      entitiesEnvironment: '',
      entities: [],
      entitiesLoadError: '',
      currentEntity: null,
      currentEntityDetail: null,
      selectedColumns: [],
      recordPreview: null,
      queryPreview: 'Preview a Dataverse path here.',
      queryResult: null,
    }));
    setAppsState({ loadedEnvironment: '', items: [], current: null, filter: '' });
    setPlatformState({ loadedEnvironment: '', items: [], current: null, filter: '' });
  }, [globalEnvironment]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setActiveTab('console');
      setConsoleSeed({
        api: detail.api,
        method: detail.method,
        path: detail.path,
      });
    };
    window.addEventListener('pp:open-console', listener as EventListener);
    return () => window.removeEventListener('pp:open-console', listener as EventListener);
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.entity) return;
      setActiveTab('dataverse');
      setDataverse((current) => ({ ...current, dvSubTab: 'dv-explorer' }));
      void loadEntityDetail(String(detail.entity));
    };
    window.addEventListener('pp:navigate-entity', listener as EventListener);
    return () => window.removeEventListener('pp:navigate-entity', listener as EventListener);
  }, [globalEnvironment, dataverse.entities]);

  useEffect(() => {
    const listener = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest('.record-link') as HTMLElement | null;
      if (!link?.dataset.entity) return;
      setActiveTab('dataverse');
      setDataverse((current) => ({ ...current, dvSubTab: 'dv-explorer' }));
      void loadEntityDetail(link.dataset.entity);
    };
    document.body.addEventListener('click', listener);
    return () => document.body.removeEventListener('click', listener);
  }, [globalEnvironment, dataverse.entities]);

  useEffect(() => {
    if (activeTab !== 'dataverse' || !globalEnvironment) return;
    if (dataverse.entitiesEnvironment === globalEnvironment) return;
    void loadEntities();
  }, [activeTab, dataverse.entitiesEnvironment, globalEnvironment]);

  useEffect(() => {
    if (activeTab !== 'apps' || !globalEnvironment) return;
    if (appsState.loadedEnvironment === globalEnvironment && appsState.items.length) return;
    void loadApps();
  }, [activeTab, appsState.items.length, appsState.loadedEnvironment, globalEnvironment]);

  useEffect(() => {
    if (activeTab !== 'platform' || !globalEnvironment) return;
    if (platformState.loadedEnvironment === globalEnvironment && platformState.items.length) return;
    void loadPlatformEnvironments();
  }, [activeTab, globalEnvironment, platformState.items.length, platformState.loadedEnvironment]);

  async function loadEntities() {
    if (!globalEnvironment) return;
    try {
      const payload = await api<any>(`/api/dv/entities?environment=${encodeURIComponent(globalEnvironment)}&allowInteractive=false&softFail=true`, { allowFailure: true });
      if (payload.success === false) {
        setDataverse((current) => ({
          ...current,
          entitiesEnvironment: globalEnvironment,
          entities: [],
          entitiesLoadError: summarizeError(payload),
          currentEntity: null,
          currentEntityDetail: null,
          currentEntityDiagnostics: payload.diagnostics || [],
          selectedColumns: [],
          recordPreview: null,
        }));
        return;
      }
      const entities = payload.data || [];
      setDataverse((current) => ({
        ...current,
        entitiesEnvironment: globalEnvironment,
        entities,
        entitiesLoadError: '',
        currentEntity: null,
        currentEntityDetail: null,
        currentEntityDiagnostics: [],
        selectedColumns: [],
        recordPreview: null,
      }));
      pushToast(`Loaded ${entities.length} entities`);
    } catch (error) {
      setDataverse((current) => ({
        ...current,
        entitiesEnvironment: globalEnvironment,
        entities: [],
        entitiesLoadError: error instanceof Error ? error.message : String(error),
        currentEntity: null,
        currentEntityDetail: null,
        currentEntityDiagnostics: [],
        selectedColumns: [],
        recordPreview: null,
      }));
    }
  }

  async function loadEntityDetail(logicalName: string) {
    if (!globalEnvironment) {
      pushToast('Select an environment first.', true);
      return;
    }
    try {
      const payload = await api<any>(`/api/dv/entities/${encodeURIComponent(logicalName)}?environment=${encodeURIComponent(globalEnvironment)}`);
      const detail = payload.data;
      const currentEntity = dataverse.entities.find((item) => item.logicalName === logicalName) || { logicalName };
      const selectedColumns = getDefaultSelectedColumns(detail, 0);
      setDataverse((current) => ({
        ...current,
        currentEntity,
        currentEntityDetail: detail,
        currentEntityDiagnostics: payload.diagnostics || [],
        selectedColumns,
        attrFilter: '',
      }));
      void loadRecordPreview(detail, selectedColumns);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function loadRecordPreview(detail = dataverse.currentEntityDetail, selectedColumns = dataverse.selectedColumns) {
    if (!detail?.entitySetName || !globalEnvironment) {
      setDataverse((current) => ({ ...current, recordPreview: null }));
      return;
    }
    const select = selectedColumns.length ? selectedColumns : getDefaultSelectedColumns(detail, 3);
    if (!select.length) {
      setDataverse((current) => ({
        ...current,
        recordPreview: { entitySetName: detail.entitySetName, logicalName: detail.logicalName, path: '', records: [] },
      }));
      return;
    }
    try {
      const payload = await api<any>('/api/dv/query/execute', {
        method: 'POST',
        body: JSON.stringify({ environmentAlias: globalEnvironment, entitySetName: detail.entitySetName, select, top: 5 }),
      });
      setDataverse((current) => ({ ...current, recordPreview: payload.data }));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function loadApps() {
    if (!globalEnvironment) return;
    try {
      const payload = await api<any>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({ environment: globalEnvironment, api: 'powerapps', method: 'GET', path: '/apps', allowInteractive: false, softFail: true }),
      });
      setAppsState((current) => ({
        ...current,
        loadedEnvironment: globalEnvironment,
        items: payload.data?.response?.value || [],
        current: null,
      }));
    } catch (error) {
      setAppsState((current) => ({ ...current, loadedEnvironment: globalEnvironment, items: [], current: null }));
      pushToast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function loadPlatformEnvironments() {
    if (!globalEnvironment) return;
    try {
      const payload = await api<any>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({ environment: globalEnvironment, api: 'bap', method: 'GET', path: '/environments', allowInteractive: false, softFail: true }),
      });
      setPlatformState((current) => ({
        ...current,
        loadedEnvironment: globalEnvironment,
        items: payload.data?.response?.value || [],
        current: null,
      }));
    } catch (error) {
      setPlatformState((current) => ({ ...current, loadedEnvironment: globalEnvironment, items: [], current: null }));
      pushToast(error instanceof Error ? error.message : String(error), true);
    }
  }

  const currentEnvData = useMemo(() => {
    if (!globalEnvironment || !shellData?.environments) return undefined;
    return shellData.environments.find((e: any) => e.alias === globalEnvironment);
  }, [globalEnvironment, shellData]);

  const environmentUrl = currentEnvData?.url || '';

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
              <span className="env-trigger-chevron" aria-hidden="true">▾</span>
            </button>
          </div>
          <div className="header-flex-spacer" aria-hidden="true" />
          <HeaderActions
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

      <PrimaryTabs activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="app-main">
        <div className={`tab-panel stack ${activeTab === 'setup' ? 'active' : ''}`} id="panel-setup">
          <SetupTab
            active={activeTab === 'setup'}
            shellData={shellData}
            globalEnvironment={globalEnvironment}
            refreshState={refreshState}
            toast={pushToast}
          />
        </div>

        <div className={`tab-panel stack ${activeTab === 'console' ? 'active' : ''}`} id="panel-console">
          <ConsoleTab
            active={activeTab === 'console'}
            environment={globalEnvironment}
            seed={consoleSeed}
            clearSeed={() => setConsoleSeed(null)}
            toast={pushToast}
          />
        </div>

        <div className={`tab-panel ${activeTab === 'dataverse' ? 'active' : ''}`} id="panel-dataverse">
          <DataverseTab
            dataverse={dataverse}
            setDataverse={setDataverse}
            environment={globalEnvironment}
            environmentUrl={environmentUrl}
            loadEntities={loadEntities}
            loadEntityDetail={loadEntityDetail}
            loadRecordPreview={loadRecordPreview}
            toast={pushToast}
          />
        </div>

        <AutomateTab
          active={activeTab === 'automate'}
          environment={globalEnvironment}
          openConsole={(seed) => {
            setConsoleSeed(seed);
            setActiveTab('console');
          }}
          toast={pushToast}
        />

        <div className={`tab-panel ${activeTab === 'apps' ? 'active' : ''}`} id="panel-apps">
          <AppsTab
            state={appsState}
            setState={setAppsState}
            environment={globalEnvironment}
            reload={loadApps}
            openConsole={(path) => {
              setConsoleSeed({ api: 'powerapps', method: 'GET', path });
              setActiveTab('console');
            }}
            toast={pushToast}
          />
        </div>

        <div className={`tab-panel ${activeTab === 'canvas' ? 'active' : ''}`} id="panel-canvas">
          <CanvasTab
            state={canvasState}
            setState={setCanvasState}
            environment={globalEnvironment}
            environmentId={currentEnvData?.makerEnvironmentId}
            apps={appsState.items}
            appsLoaded={appsState.loadedEnvironment === globalEnvironment}
            loadApps={loadApps}
            toast={pushToast}
          />
        </div>

        <div className={`tab-panel ${activeTab === 'platform' ? 'active' : ''}`} id="panel-platform">
          <PlatformTab
            state={platformState}
            setState={setPlatformState}
            environment={globalEnvironment}
            reload={loadPlatformEnvironments}
            openConsole={(path) => {
              setConsoleSeed({ api: 'bap', method: 'GET', path });
              setActiveTab('console');
            }}
            toast={pushToast}
          />
        </div>
      </div>

      {stateLoading ? <div className="app-loading-bar" aria-hidden="true"><span /></div> : null}

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

      {shortcutHelpOpen ? (
        <ShortcutHelpModal onClose={() => setShortcutHelpOpen(false)} />
      ) : null}

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </>
  );
}
