import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  esc,
  formatBytes,
  formatDate,
  formatDateShort,
  getDefaultSelectedColumns,
  getSelectableAttributes,
  highlightJson,
  prop,
  summarizeError,
} from './utils.js';
import { FetchXmlTab, RelationshipsTab } from './DataversePanels.js';
import { AutomateTab } from './AutomateTab.js';
import { SetupTab } from './SetupTab.js';
import { ResultView } from './ResultView.js';
import { CopyButton } from './CopyButton.js';
import { RecordDetailModal, useRecordDetail } from './RecordDetailModal.js';
import { EnvironmentPickerModal } from './EnvironmentPickerModal.js';
import { HeaderActions } from './HeaderActions.js';
import { EmptyState } from './EmptyState.js';
import { InventorySidebar } from './InventorySidebar.js';
import { JsonViewer } from './JsonViewer.js';
import { Icon } from './Icon.js';
import { ShortcutHelpModal } from './ShortcutHelpModal.js';
import { ConfirmDialog, useConfirm } from './setup/ConfirmDialog.js';
import { touchEnvironmentRecency } from './env-recency.js';

type TabName = 'setup' | 'console' | 'dataverse' | 'automate' | 'apps' | 'canvas' | 'platform';
type DataverseSubTab = 'dv-explorer' | 'dv-query' | 'dv-fetchxml' | 'dv-relationships';
type ExplorerSubTab = 'metadata' | 'records';

type ToastItem = { id: number; message: string; isError: boolean; timestamp: number };
type ToastLogItem = ToastItem;

const APIS = [
  {
    key: 'dv', label: 'Dataverse', scope: 'environment',
    defaultPath: '/WhoAmI',
    presets: [
      { label: 'WhoAmI', method: 'GET', path: '/WhoAmI', description: 'Current user identity' },
      { label: 'List Accounts', method: 'GET', path: '/accounts?$top=10&$select=name,accountid', description: 'Account records' },
      { label: 'Entity Metadata', method: 'GET', path: '/EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName&LabelLanguages=1033', description: 'Entity definitions' },
      { label: 'Global Option Sets', method: 'GET', path: '/GlobalOptionSetDefinitions?$top=10', description: 'Global option set metadata' },
    ],
  },
  {
    key: 'flow', label: 'Power Automate', scope: 'environment',
    defaultPath: '/flows',
    presets: [
      { label: 'List Flows', method: 'GET', path: '/flows', description: 'All flows in environment' },
      { label: 'List Flow Runs', method: 'GET', path: '/flows/{flowId}/runs', description: 'Runs for a specific flow' },
    ],
  },
  {
    key: 'powerapps', label: 'Power Apps', scope: 'environment',
    defaultPath: '/apps',
    presets: [{ label: 'List Apps', method: 'GET', path: '/apps', description: 'All apps in environment' }],
  },
  {
    key: 'bap', label: 'Platform (BAP)', scope: 'environment',
    defaultPath: '/environments',
    presets: [
      { label: 'List Environments', method: 'GET', path: '/environments', description: 'All accessible environments' },
      { label: 'Connectors', method: 'GET', path: '/connectors', description: 'Available connectors' },
    ],
  },
  {
    key: 'graph', label: 'Microsoft Graph', scope: 'account',
    defaultPath: '/me',
    presets: [
      { label: 'My Profile', method: 'GET', path: '/me', description: 'Current user profile' },
      { label: 'Organization', method: 'GET', path: '/organization', description: 'Tenant info' },
      { label: 'Users (top 10)', method: 'GET', path: '/users?$top=10', description: 'Directory users' },
      { label: 'Groups (top 10)', method: 'GET', path: '/groups?$top=10', description: 'Directory groups' },
    ],
  },
  {
    key: 'sharepoint', label: 'SharePoint REST', scope: 'account',
    defaultPath: 'https://contoso.sharepoint.com/sites/site/_api/web',
    presets: [
      { label: 'Web', method: 'GET', path: 'https://contoso.sharepoint.com/sites/site/_api/web', description: 'Current site web' },
      { label: 'Current User', method: 'GET', path: 'https://contoso.sharepoint.com/sites/site/_api/web/currentuser', description: 'Current SharePoint user' },
      { label: 'Lists', method: 'GET', path: 'https://contoso.sharepoint.com/sites/site/_api/web/lists', description: 'Site lists' },
    ],
  },
] as const;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--ok)',
  POST: 'var(--accent)',
  PUT: '#d97706',
  PATCH: '#d97706',
  DELETE: 'var(--danger)',
};

function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [log, setLog] = useState<ToastLogItem[]>([]);
  const timersRef = useRef<Map<number, number>>(new Map());

  function dismissToast(id: number) {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }

  function pushToast(message: string, isError = false) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const item: ToastItem = { id, message, isError, timestamp: Date.now() };
    setToasts((current) => [...current, item]);
    setLog((current) => [item, ...current].slice(0, 50));
    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, isError ? 5000 : 2500);
    timersRef.current.set(id, timer);
  }

  function clearLog() {
    setLog([]);
  }

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  return { toasts, pushToast, dismissToast, log, clearLog };
}

function currentTabFromHash(): TabName {
  const hash = window.location.hash.slice(1);
  if (hash === 'setup' || hash === 'console' || hash === 'dataverse' || hash === 'automate' || hash === 'apps' || hash === 'canvas' || hash === 'platform') {
    return hash;
  }
  return 'dataverse';
}

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

  const [dataverse, setDataverse] = useState({
    entitiesEnvironment: '',
    entities: [] as any[],
    entitiesLoadError: '',
    currentEntity: null as any,
    currentEntityDetail: null as any,
    currentEntityDiagnostics: [] as any[],
    selectedColumns: [] as string[],
    recordPreview: null as any,
    entityFilter: '',
    attrFilter: '',
    explorerSubTab: 'metadata' as ExplorerSubTab,
    dvSubTab: 'dv-explorer' as DataverseSubTab,
    queryPreview: 'Preview a Dataverse path here.',
    queryResult: null as any,
  });

  const [appsState, setAppsState] = useState({
    loadedEnvironment: '',
    items: [] as any[],
    current: null as any,
    filter: '',
  });

  const [canvasState, setCanvasState] = useState({
    sessions: [] as any[],
    sessionStarting: false,
  });

  const [platformState, setPlatformState] = useState({
    loadedEnvironment: '',
    items: [] as any[],
    current: null as any,
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
      <div className="toast-container" id="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.isError ? 'error' : 'ok'}`}>
            <span className="toast-message">{toast.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              x
            </button>
          </div>
        ))}
      </div>

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

      <nav className="tabs">
        <div className="tabs-inner">
          {(['setup', 'console', 'dataverse', 'automate', 'apps', 'canvas', 'platform'] as TabName[]).map((tabName, index) => (
            <FragmentTab
              key={tabName}
              index={index}
              tabName={tabName}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          ))}
        </div>
      </nav>

      <div className="main">
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


const TAB_LABELS: Record<TabName, string> = {
  setup: 'setup',
  console: 'console',
  dataverse: 'dataverse',
  automate: 'automate',
  apps: 'apps',
  canvas: 'canvas',
  platform: 'platform',
};

const TAB_ORDER: TabName[] = ['setup', 'console', 'dataverse', 'automate', 'apps', 'canvas', 'platform'];

function tabNumber(tabName: TabName): string {
  const n = TAB_ORDER.indexOf(tabName) + 1;
  return n.toString().padStart(2, '0');
}

function FragmentTab(props: { index: number; tabName: TabName; activeTab: TabName; setActiveTab: (tab: TabName) => void }) {
  const { index, tabName, activeTab, setActiveTab } = props;
  const needsSep = index === 2;
  const number = tabNumber(tabName);
  return (
    <>
      {needsSep ? <div className="tab-sep"></div> : null}
      <button
        className={`tab ${activeTab === tabName ? 'active' : ''}`}
        data-tab={tabName}
        onClick={() => setActiveTab(tabName)}
        title={`${TAB_LABELS[tabName]} (Alt+${TAB_ORDER.indexOf(tabName) + 1})`}
      >
        <span className="tab-num" aria-hidden="true">{number}</span>
        <span className="tab-label">{TAB_LABELS[tabName]}</span>
      </button>
    </>
  );
}

type ConsoleRequestTab = 'query' | 'headers' | 'body';
type ConsoleRailTab = 'history' | 'saved';
type ConsoleHistoryEntry = { api: string; method: string; path: string; status: number; elapsed: number };
type ConsoleSavedEntry = { api: string; method: string; path: string; name?: string };
type ConsoleResponsePreview = {
  text: string;
  truncated: boolean;
  originalBytes: number;
  shownBytes: number;
  omittedBytes: number;
};
type ConsoleResponseState = {
  status: number | 'ERR' | '';
  elapsed: string;
  body: string;
  headers: string;
  size: string;
  ok: boolean;
  truncated?: boolean;
  originalSize?: string;
};

const CONSOLE_RESPONSE_PREVIEW_BYTES = 512 * 1024;

function readConsoleHistory(): ConsoleHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('pp-console-history') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeHistoryEntry).filter((entry): entry is ConsoleHistoryEntry => Boolean(entry)).slice(0, 50);
  } catch {
    return [];
  }
}

function readConsoleSaved(): ConsoleSavedEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('pp-console-saved') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSavedEntry).filter((entry): entry is ConsoleSavedEntry => Boolean(entry)).slice(0, 30);
  } catch {
    return [];
  }
}

function persistConsoleItems(key: string, items: Array<ConsoleHistoryEntry | ConsoleSavedEntry>, limit: number) {
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, limit)));
  } catch {
    // Large legacy history entries can exceed the browser quota. Dropping persistence
    // is better than letting a storage exception blank the app.
  }
}

function sanitizeHistoryEntry(value: any): ConsoleHistoryEntry | undefined {
  const saved = sanitizeSavedEntry(value);
  if (!saved) return undefined;
  return {
    ...saved,
    status: Number.isFinite(Number(value.status)) ? Number(value.status) : 0,
    elapsed: Number.isFinite(Number(value.elapsed)) ? Number(value.elapsed) : 0,
  };
}

function sanitizeSavedEntry(value: any): ConsoleSavedEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const api = typeof value.api === 'string' ? value.api : '';
  const method = typeof value.method === 'string' ? value.method : '';
  const path = typeof value.path === 'string' ? value.path : '';
  if (!api || !method || !path) return undefined;
  const entry: ConsoleSavedEntry = { api, method, path };
  if (typeof value.name === 'string' && value.name.trim()) entry.name = value.name.trim().slice(0, 120);
  return entry;
}

function consoleResponseText(value: unknown, preview?: ConsoleResponsePreview): { body: string; bytes: number; truncated: boolean; originalBytes: number } {
  if (preview && typeof preview.text === 'string') {
    const notice = preview.truncated
      ? `\n\n/* pp preview: response truncated to ${formatBytes(preview.shownBytes)} of ${formatBytes(preview.originalBytes)}. Use “Load full response” to fetch everything, or narrow with $top/$select. */`
      : '';
    return {
      body: `${preview.text}${notice}`,
      bytes: preview.shownBytes,
      truncated: preview.truncated,
      originalBytes: preview.originalBytes,
    };
  }

  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return truncateConsoleText(text || '');
}

function truncateConsoleText(text: string): { body: string; bytes: number; truncated: boolean; originalBytes: number } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= CONSOLE_RESPONSE_PREVIEW_BYTES) {
    return { body: text, bytes: bytes.byteLength, truncated: false, originalBytes: bytes.byteLength };
  }
  const shownBytes = bytes.slice(0, CONSOLE_RESPONSE_PREVIEW_BYTES);
  const preview = new TextDecoder().decode(shownBytes);
  const notice = `\n\n/* pp preview: response truncated to ${formatBytes(shownBytes.byteLength)} of ${formatBytes(bytes.byteLength)}. Use “Load full response” to fetch everything, or narrow with $top/$select. */`;
  return { body: `${preview}${notice}`, bytes: shownBytes.byteLength, truncated: true, originalBytes: bytes.byteLength };
}

function filterResponseBody(body: string, query: string): { text: string; matches: number } {
  if (!query) return { text: body, matches: 0 };
  const lines = body.split('\n');
  const needle = query.toLowerCase();
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) matches.push(i);
  }
  if (!matches.length) return { text: '', matches: 0 };
  const contextRange = 2;
  const keep = new Set<number>();
  for (const idx of matches) {
    for (let offset = -contextRange; offset <= contextRange; offset++) {
      const target = idx + offset;
      if (target >= 0 && target < lines.length) keep.add(target);
    }
  }
  const sorted = Array.from(keep).sort((a, b) => a - b);
  const output: string[] = [];
  let prev = -1;
  for (const idx of sorted) {
    if (prev >= 0 && idx !== prev + 1) output.push('…');
    output.push(lines[idx]);
    prev = idx;
  }
  return { text: output.join('\n'), matches: matches.length };
}

function ConsoleTab(props: { active: boolean; environment: string; seed: any; clearSeed: () => void; toast: (message: string, isError?: boolean) => void }) {
  const { active, environment, seed, clearSeed, toast } = props;
  const [apiKey, setApiKey] = useState('dv');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/WhoAmI');
  const [queryRows, setQueryRows] = useState([{ key: '', value: '' }]);
  const [headerRows, setHeaderRows] = useState([{ key: '', value: '' }]);
  const [body, setBody] = useState('');
  const [requestTab, setRequestTab] = useState<ConsoleRequestTab>('query');
  const [railTab, setRailTab] = useState<ConsoleRailTab>('history');
  const [responseHeadersOpen, setResponseHeadersOpen] = useState(false);
  const [history, setHistory] = useState<ConsoleHistoryEntry[]>(readConsoleHistory);
  const [saved, setSaved] = useState<ConsoleSavedEntry[]>(readConsoleSaved);
  const [renameIndex, setRenameIndex] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [responseFilter, setResponseFilter] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingFull, setLoadingFull] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [response, setResponse] = useState<ConsoleResponseState>({
    status: '',
    elapsed: '',
    body: 'Send a request to see the response.',
    headers: '',
    size: '',
    ok: false,
  });

  const currentApi = APIS.find((item) => item.key === apiKey) || APIS[0];
  const supportsBody = method !== 'GET' && method !== 'DELETE';

  const bodyParseError = useMemo(() => {
    if (!body.trim() || !supportsBody) return null;
    try {
      JSON.parse(body);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [body, supportsBody]);

  function findDuplicateKeys(rows: Array<{ key: string; value: string }>): string[] {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const row of rows) {
      const key = row.key.trim();
      if (!key) continue;
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      if (count === 2) dupes.push(key);
    }
    return dupes;
  }

  const queryDupes = useMemo(() => findDuplicateKeys(queryRows), [queryRows]);
  const headerDupes = useMemo(() => findDuplicateKeys(headerRows), [headerRows]);

  useEffect(() => {
    persistConsoleItems('pp-console-history', history, 50);
  }, [history]);
  useEffect(() => {
    persistConsoleItems('pp-console-saved', saved, 30);
  }, [saved]);

  useEffect(() => {
    if (!seed || !active) return;
    if (seed.api) setApiKey(seed.api);
    if (seed.method) setMethod(seed.method);
    if (seed.path) setPath(seed.path);
    clearSeed();
  }, [active, clearSeed, seed]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function cancelInFlight() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  async function sendRequest(options?: { fullResponse?: boolean }) {
    if (sending) {
      cancelInFlight();
      return;
    }
    if (!environment) {
      toast('Select an environment first.', true);
      return;
    }
    if (!path.trim()) {
      toast('Enter a request path.', true);
      return;
    }
    if (bodyParseError) {
      toast(`Request body is not valid JSON: ${bodyParseError}`, true);
      return;
    }
    const query = Object.fromEntries(queryRows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
    const headers = Object.fromEntries(headerRows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
    const parsedBody = body.trim() && supportsBody ? JSON.parse(body) : undefined;
    const controller = new AbortController();
    abortRef.current = controller;
    const fullResponse = !!options?.fullResponse;
    setSending(true);
    if (fullResponse) setLoadingFull(true);
    const started = performance.now();
    try {
      const payload = await api<any>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({
          environment,
          api: apiKey,
          method,
          path: path.trim(),
          query: Object.keys(query).length ? query : undefined,
          headers: Object.keys(headers).length ? headers : undefined,
          body: parsedBody,
          maxResponseBytes: fullResponse ? 0 : CONSOLE_RESPONSE_PREVIEW_BYTES,
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const elapsed = Math.round(performance.now() - started);
      const bodyValue = payload.data?.response;
      const preview = payload.data?.responsePreview as ConsoleResponsePreview | undefined;
      const bodyResult = consoleResponseText(bodyValue, preview);
      setResponse({
        status: payload.data?.status || 200,
        elapsed: `${elapsed}ms`,
        body: bodyResult.body,
        headers: payload.data?.headers ? Object.entries(payload.data.headers).map(([key, value]) => `${key}: ${value}`).join('\n') : '',
        size: bodyResult.truncated
          ? `${formatBytes(bodyResult.bytes)} shown`
          : formatBytes(bodyResult.bytes),
        ok: (payload.data?.status || 200) >= 200 && (payload.data?.status || 200) < 300,
        truncated: bodyResult.truncated,
        originalSize: bodyResult.truncated ? formatBytes(bodyResult.originalBytes) : undefined,
      });
      setHistory((current) => [{ api: apiKey, method, path, status: payload.data?.status || 200, elapsed }, ...current].slice(0, 50));
      if (bodyResult.truncated) toast(`Large response previewed: ${formatBytes(bodyResult.bytes)} shown of ${formatBytes(bodyResult.originalBytes)}.`, false);
      else if (fullResponse) toast(`Loaded full response (${formatBytes(bodyResult.bytes)}).`, false);
    } catch (error) {
      if (controller.signal.aborted) {
        toast('Request cancelled.', false);
        return;
      }
      const elapsed = Math.round(performance.now() - started);
      const message = error instanceof Error ? error.message : String(error);
      setResponse({
        status: 'ERR',
        elapsed: `${elapsed}ms`,
        body: JSON.stringify({ error: message }, null, 2),
        headers: '',
        size: formatBytes(new Blob([message]).size),
        ok: false,
      });
      setHistory((current) => [{ api: apiKey, method, path, status: 0, elapsed }, ...current].slice(0, 50));
      toast(message, true);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
      setLoadingFull(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && sending) {
        event.preventDefault();
        cancelInFlight();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        const target = event.target as HTMLElement | null;
        const panel = target?.closest?.('.console-main');
        if (panel) {
          event.preventDefault();
          void sendRequest();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, sending, environment, apiKey, method, path, body, queryRows, headerRows, bodyParseError]);

  function togglePinHistory(entry: ConsoleHistoryEntry) {
    setSaved((current) => {
      const existingIndex = current.findIndex((item) => item.api === entry.api && item.method === entry.method && item.path === entry.path);
      if (existingIndex >= 0) return current.filter((_, itemIndex) => itemIndex !== existingIndex);
      return [{ api: entry.api, method: entry.method, path: entry.path }, ...current];
    });
  }

  function commitRename(index: number) {
    const trimmed = renameDraft.trim();
    setSaved((current) => current.map((item, i) => i === index ? { ...item, name: trimmed || undefined } : item));
    setRenameIndex(null);
    setRenameDraft('');
  }

  const filteredResponseBody = useMemo(() => {
    if (!responseFilter.trim()) return { text: response.body, matches: 0 };
    return filterResponseBody(response.body, responseFilter.trim());
  }, [response.body, responseFilter]);

  const effectiveRequestTab: ConsoleRequestTab = !supportsBody && requestTab === 'body' ? 'query' : requestTab;

  return (
    <div className="console-layout">
      <div className="console-main">
        <div className="panel">
          <div className="console-toolbar-row">
            <h2>API Console</h2>
            <select className="console-preset-select" onChange={(event) => {
              const preset = currentApi.presets.find((item) => item.label === event.target.value);
              if (!preset) return;
              setMethod(preset.method);
              setPath(preset.path);
              setBody('body' in preset ? String((preset as any).body || '') : '');
              event.target.value = '';
            }}>
              <option value="">Presets…</option>
              {currentApi.presets.map((preset) => <option key={preset.label} value={preset.label}>{preset.label} — {preset.description}</option>)}
            </select>
          </div>
          <div className={`console-scope-banner ${currentApi.scope}`}>
            {currentApi.scope === 'account' ? (
              <>
                <span className="console-scope-badge account">account-scoped</span>
                <span className="console-scope-description">Uses the environment’s account for auth; requests go directly to {currentApi.label}. The environment selector isn’t used as a routing prefix.</span>
              </>
            ) : (
              <>
                <span className="console-scope-badge env">environment-scoped</span>
                <span className="console-scope-description">Requests go through <strong>{environment || 'the selected environment'}</strong>.</span>
              </>
            )}
          </div>
          <div className="console-bar">
            <label htmlFor="console-api" className="sr-only">API</label>
            <select id="console-api" value={apiKey} onChange={(event) => {
              const nextApi = APIS.find((item) => item.key === event.target.value) || APIS[0];
              setApiKey(nextApi.key);
              setPath(nextApi.defaultPath);
            }}>
              {APIS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            <label htmlFor="console-method" className="sr-only">HTTP method</label>
            <select id="console-method" value={method} onChange={(event) => setMethod(event.target.value)} style={{ color: METHOD_COLORS[method] || 'var(--ink)' }}>
              {METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <label htmlFor="console-path" className="sr-only">Request path</label>
            <input type="text" id="console-path" aria-label="Request path" placeholder="/WhoAmI" value={path} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void sendRequest(); } }} />
            <CopyButton value={`${method} ${path}`} label="Copy" title="Copy request line" toast={toast} />
            {sending ? (
              <button className="btn btn-danger" id="console-send" type="button" onClick={cancelInFlight}>Cancel</button>
            ) : (
              <button className="btn btn-primary" id="console-send" type="button" onClick={() => void sendRequest()}>Send</button>
            )}
          </div>
          <div className="console-bar-hint">
            <kbd>⏎</kbd> send · <kbd>Ctrl</kbd>+<kbd>⏎</kbd> send from any field · <kbd>Esc</kbd> cancel while sending · <kbd>?</kbd> all shortcuts
          </div>
          <div className="console-request-tabs">
            <button type="button" className={`console-request-tab ${effectiveRequestTab === 'query' ? 'active' : ''} ${queryDupes.length ? 'has-warning' : ''}`} onClick={() => setRequestTab('query')}>
              Query{queryRows.filter((row) => row.key.trim()).length ? <span className="console-request-tab-count">{queryRows.filter((row) => row.key.trim()).length}</span> : null}
              {queryDupes.length ? <span className="console-request-tab-warn" aria-label="Duplicate keys">!</span> : null}
            </button>
            <button type="button" className={`console-request-tab ${effectiveRequestTab === 'headers' ? 'active' : ''} ${headerDupes.length ? 'has-warning' : ''}`} onClick={() => setRequestTab('headers')}>
              Headers{headerRows.filter((row) => row.key.trim()).length ? <span className="console-request-tab-count">{headerRows.filter((row) => row.key.trim()).length}</span> : null}
              {headerDupes.length ? <span className="console-request-tab-warn" aria-label="Duplicate keys">!</span> : null}
            </button>
            <button
              type="button"
              className={`console-request-tab ${effectiveRequestTab === 'body' ? 'active' : ''} ${bodyParseError ? 'has-warning' : ''}`}
              disabled={!supportsBody}
              onClick={() => supportsBody && setRequestTab('body')}
              title={supportsBody ? '' : `${method} requests do not include a body.`}
            >
              Body{body.trim() && supportsBody ? <span className="console-request-tab-dot" aria-hidden="true" /> : null}
              {bodyParseError ? <span className="console-request-tab-warn" aria-label="Invalid JSON">!</span> : null}
            </button>
          </div>
          <div className="console-request-panel">
            {effectiveRequestTab === 'query' ? (
              <div className="kv-list">
                {queryDupes.length ? (
                  <div className="console-field-warning">Duplicate parameter {queryDupes.length === 1 ? 'key' : 'keys'}: <code>{queryDupes.join(', ')}</code>. Only the last value per key is sent.</div>
                ) : null}
                {queryRows.map((row, index) => {
                  const trimmed = row.key.trim();
                  const isDupe = trimmed && queryDupes.includes(trimmed);
                  return (
                    <div key={index} className={`kv-row ${isDupe ? 'kv-row-dupe' : ''}`}>
                      <input aria-label={`Query key ${index + 1}`} placeholder="key" value={row.key} onChange={(event) => setQueryRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} />
                      <input aria-label={`Query value ${index + 1}`} placeholder="value" value={row.value} onChange={(event) => setQueryRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
                      <button type="button" aria-label="Remove row" className="condition-remove" onClick={() => setQueryRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                    </div>
                  );
                })}
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setQueryRows((current) => [...current, { key: '', value: '' }])}>+ Add parameter</button>
              </div>
            ) : effectiveRequestTab === 'headers' ? (
              <div className="kv-list">
                {headerDupes.length ? (
                  <div className="console-field-warning">Duplicate header {headerDupes.length === 1 ? 'name' : 'names'}: <code>{headerDupes.join(', ')}</code>. Only the last value per name is sent.</div>
                ) : null}
                {headerRows.map((row, index) => {
                  const trimmed = row.key.trim();
                  const isDupe = trimmed && headerDupes.includes(trimmed);
                  return (
                    <div key={index} className={`kv-row ${isDupe ? 'kv-row-dupe' : ''}`}>
                      <input aria-label={`Header name ${index + 1}`} placeholder="key" value={row.key} onChange={(event) => setHeaderRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} />
                      <input aria-label={`Header value ${index + 1}`} placeholder="value" value={row.value} onChange={(event) => setHeaderRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
                      <button type="button" aria-label="Remove row" className="condition-remove" onClick={() => setHeaderRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                    </div>
                  );
                })}
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setHeaderRows((current) => [...current, { key: '', value: '' }])}>+ Add header</button>
              </div>
            ) : (
              <div className="console-body-editor">
                <textarea aria-label="Request body (JSON)" rows={8} placeholder='{ "key": "value" }' value={body} onChange={(event) => setBody(event.target.value)} />
                {bodyParseError ? (
                  <div className="console-field-error">Invalid JSON: {bodyParseError}</div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="panel console-response-panel">
          <div className="console-response-header">
            <h2>Response <span className={`console-status-badge ${response.ok ? 'success' : response.status === 'ERR' ? 'error' : ''}`}>{response.status || '—'}</span></h2>
            <div className="console-response-meta">
              {response.elapsed ? <span className="response-size">{response.elapsed}</span> : null}
              {response.size ? <span className="response-size">{response.size}</span> : null}
              {response.body ? <CopyButton value={response.body} label="Copy" title="Copy response body" toast={toast} /> : null}
            </div>
          </div>
          {response.headers ? (
            <div className="console-response-headers">
              <button type="button" className="console-response-headers-toggle" onClick={() => setResponseHeadersOpen((current) => !current)}>
                <span aria-hidden="true">{responseHeadersOpen ? '▾' : '▸'}</span> Response headers
              </button>
              {responseHeadersOpen ? (
                <div className="console-response-headers-body">
                  <div className="console-response-headers-toolbar">
                    <CopyButton value={response.headers} label="Copy headers" title="Copy response headers" toast={toast} />
                  </div>
                  <pre className="viewer">{response.headers}</pre>
                </div>
              ) : null}
            </div>
          ) : null}
          {response.truncated ? (
            <div className="console-response-warning">
              <span className="console-response-warning-text">Response preview truncated. Showing {response.size}{response.originalSize ? ` of ${response.originalSize}` : ''}.</span>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={loadingFull || sending}
                onClick={() => void sendRequest({ fullResponse: true })}
              >
                {loadingFull ? 'Loading…' : 'Load full response'}
              </button>
            </div>
          ) : null}
          {response.body && response.body !== 'Send a request to see the response.' ? (
            <div className="console-response-filter">
              <input
                type="text"
                aria-label="Filter response body"
                placeholder="Filter response (substring across lines, shows context)…"
                value={responseFilter}
                onChange={(event) => setResponseFilter(event.target.value)}
              />
              {responseFilter ? (
                <>
                  <span className="console-response-filter-count">
                    {filteredResponseBody.matches} match{filteredResponseBody.matches === 1 ? '' : 'es'}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResponseFilter('')}>Clear</button>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="console-response-viewer">
            {response.body && response.body !== 'Send a request to see the response.' ? (
              <JsonViewer value={filteredResponseBody.text || (responseFilter ? `/* No matches for "${responseFilter}". */` : response.body)} />
            ) : (
              <EmptyState icon={<Icon name="refresh" size={18} />} title="No response yet" description="Pick an API, method and path above, then Send." compact />
            )}
          </div>
        </div>
      </div>

      <aside className="console-rail">
        <div className="panel console-rail-panel">
          <div className="console-rail-tabs">
            <button type="button" className={`console-rail-tab ${railTab === 'history' ? 'active' : ''}`} onClick={() => setRailTab('history')}>
              History{history.length ? <span className="console-rail-tab-count">{Math.min(history.length, 50)}</span> : null}
            </button>
            <button type="button" className={`console-rail-tab ${railTab === 'saved' ? 'active' : ''}`} onClick={() => setRailTab('saved')}>
              Saved{saved.length ? <span className="console-rail-tab-count">{saved.length}</span> : null}
            </button>
          </div>
          <div className="console-rail-list">
            {railTab === 'history' ? (
              history.length ? history.slice(0, 20).map((entry, index) => {
                const pinned = saved.some((item) => item.api === entry.api && item.method === entry.method && item.path === entry.path);
                return (
                  <div key={index} className="history-item">
                    <button
                      type="button"
                      className="history-item-trigger"
                      onClick={() => { setApiKey(entry.api); setMethod(entry.method); setPath(entry.path); }}
                      title={`Load ${entry.method} ${entry.path}`}
                    >
                      <div className="history-item-main">
                        <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                        <span className="history-path">{entry.path}</span>
                      </div>
                      <div className="history-item-meta">
                        <span className={`console-status-badge small ${entry.status >= 200 && entry.status < 300 ? 'success' : entry.status >= 400 ? 'error' : ''}`}>{entry.status || 'ERR'}</span>
                        <span className="history-time">{entry.elapsed}ms</span>
                      </div>
                    </button>
                    <div className="history-item-actions">
                      <button
                        type="button"
                        className={`pin-btn ${pinned ? 'pinned' : ''}`}
                        title={pinned ? 'Unpin' : 'Pin to saved'}
                        aria-label={pinned ? 'Unpin request' : 'Pin request'}
                        onClick={() => togglePinHistory(entry)}
                      >
                        <Icon name={pinned ? 'star-filled' : 'star'} size={14} />
                      </button>
                      <button
                        type="button"
                        className="pin-btn"
                        title="Remove from history"
                        aria-label="Remove from history"
                        onClick={() => setHistory((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >×</button>
                    </div>
                  </div>
                );
              }) : <EmptyState icon={<Icon name="reply" size={18} />} title="No requests yet" description="Send a request to see history." compact />
            ) : (
              saved.length ? saved.map((entry, index) => {
                const isRenaming = renameIndex === index;
                return (
                  <div key={index} className="saved-item">
                    {isRenaming ? (
                      <div className="saved-item-main saved-item-rename">
                        <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                        <input
                          autoFocus
                          className="saved-item-rename-input"
                          aria-label="Rename saved request"
                          value={renameDraft}
                          placeholder={entry.path}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); commitRename(index); }
                            else if (event.key === 'Escape') { event.preventDefault(); setRenameIndex(null); setRenameDraft(''); }
                          }}
                          onBlur={() => commitRename(index)}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="history-item-trigger saved-item-main"
                        onClick={() => { setApiKey(entry.api); setMethod(entry.method); setPath(entry.path); }}
                        title={`Load ${entry.method} ${entry.path}`}
                      >
                        <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                        <span className="saved-item-name">{entry.name || entry.path}</span>
                        {entry.name ? <span className="saved-item-path-hint">{entry.path}</span> : null}
                      </button>
                    )}
                    <div className="history-item-actions">
                      <button
                        type="button"
                        className="pin-btn"
                        title={entry.name ? 'Rename' : 'Name this request'}
                        aria-label="Rename saved request"
                        onClick={() => { setRenameIndex(index); setRenameDraft(entry.name || ''); }}
                      >
                        <Icon name="pencil" size={13} />
                      </button>
                      <button
                        type="button"
                        className="pin-btn pinned"
                        title="Unpin"
                        aria-label="Unpin saved request"
                        onClick={() => setSaved((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >✖</button>
                    </div>
                  </div>
                );
              }) : <EmptyState icon={<Icon name="star" size={18} />} title="No saved requests" description="Pin requests from history to keep them here." compact />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function CreateRecordModal(props: {
  entityDetail: any;
  environment: string;
  entityMap: Map<string, string>;
  metadataWarnings?: string[];
  onClose: () => void;
  onCreated: (created: any) => void;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { entityDetail, environment, entityMap, metadataWarnings = [], onClose, onCreated, toast } = props;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [fieldFilter, setFieldFilter] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState('{}');
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [lookupSearches, setLookupSearches] = useState<Record<string, any>>({});
  const [lookupDetails, setLookupDetails] = useState<Record<string, any>>({});
  const backdropRef = useRef<HTMLDivElement | null>(null);

  const creatableAttributes = useMemo(() => {
    return (entityDetail.attributes || []).filter((attr: any) => {
      if (!attr.logicalName || !attr.isValidForCreate) return false;
      if (attr.isPrimaryId) return false;
      if (attr.attributeOf) return false;
      const typeName = String(attr.attributeTypeName || attr.attributeType || '').toLowerCase();
      if (['partylisttype', 'virtualtype', 'entitynametype', 'managedpropertytype', 'image', 'filetype'].includes(typeName)) return false;
      return true;
    }).sort((a: any, b: any) => {
      if (a.isPrimaryName && !b.isPrimaryName) return -1;
      if (!a.isPrimaryName && b.isPrimaryName) return 1;
      return (a.displayName || a.logicalName).localeCompare(b.displayName || b.logicalName);
    });
  }, [entityDetail]);

  const filteredCreatableAttributes = useMemo(() => {
    const filter = fieldFilter.trim().toLowerCase();
    return creatableAttributes.filter((attr: any) => {
      const key = payloadKeyForAttribute(attr);
      if (changedOnly && !(key in values)) return false;
      if (!filter) return true;
      return [attr.logicalName, attr.displayName, attr.description, attr.attributeTypeName, attr.attributeType]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filter));
    });
  }, [changedOnly, creatableAttributes, fieldFilter, values]);

  const groupedAttributes = useMemo(() => {
    const required: any[] = [];
    const common: any[] = [];
    const other: any[] = [];
    for (const attr of filteredCreatableAttributes) {
      if (isRequiredAttribute(attr)) required.push(attr);
      else if (attr.isPrimaryName || isLookupAttribute(attr) || attr.optionValues?.length) common.push(attr);
      else other.push(attr);
    }
    return [
      { label: 'Required', items: required },
      { label: 'Common', items: common },
      { label: 'All Fields', items: other },
    ].filter((group) => group.items.length);
  }, [filteredCreatableAttributes]);

  useEffect(() => {
    if (!advanced) setJsonText(JSON.stringify(values, null, 2));
  }, [advanced, values]);

  function updateValue(key: string, value: unknown) {
    setValues((prev) => {
      const next = { ...prev };
      if (value === '' || value === null || value === undefined) { delete next[key]; } else { next[key] = value; }
      return next;
    });
  }

  function updateLookup(attr: any, targetLogicalName: string, id: string) {
    const key = payloadKeyForAttribute(attr);
    const entitySetName = entityMap.get(targetLogicalName) || targetLogicalName;
    const cleanId = id.trim().replace(/[{}]/g, '');
    updateValue(key, cleanId ? `/${entitySetName}(${cleanId})` : null);
  }

  function updateLookupSearch(key: string, patch: Record<string, unknown>) {
    setLookupSearches((current) => ({ ...current, [key]: { ...(current[key] || {}), ...patch } }));
  }

  async function searchLookup(attr: any, targetLogicalName: string) {
    const key = payloadKeyForAttribute(attr);
    const state = lookupSearches[key] || {};
    updateLookupSearch(key, { loading: true, error: null, target: targetLogicalName });
    try {
      const detail = await loadLookupDetail(targetLogicalName);
      const primaryId = detail.primaryIdAttribute;
      const primaryName = detail.primaryNameAttribute;
      const select = [primaryId, primaryName].filter(Boolean);
      const query = String(state.query || '').trim();
      const filter = query && primaryName ? `contains(${primaryName},'${escapeODataString(query)}')` : undefined;
      const resultPayload = await api<any>('/api/dv/query/execute', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          entitySetName: detail.entitySetName || entityMap.get(targetLogicalName),
          select,
          filter,
          top: 10,
        }),
      });
      updateLookupSearch(key, {
        loading: false,
        error: null,
        target: targetLogicalName,
        primaryId,
        primaryName,
        results: resultPayload.data?.records || [],
      });
    } catch (err) {
      updateLookupSearch(key, { loading: false, error: err instanceof Error ? err.message : String(err), results: [] });
    }
  }

  async function loadLookupDetail(targetLogicalName: string) {
    const cached = lookupDetails[targetLogicalName];
    if (cached) return cached;
    const detailPayload = await api<any>(`/api/dv/entities/${encodeURIComponent(targetLogicalName)}?environment=${encodeURIComponent(environment)}`);
    const detail = detailPayload.data;
    setLookupDetails((current) => ({ ...current, [targetLogicalName]: detail }));
    return detail;
  }

  function inputForAttribute(attr: any) {
    const typeName = String(attr.attributeTypeName || attr.attributeType || '').toLowerCase();
    const key = payloadKeyForAttribute(attr);
    const val = values[key];
    const commonProps = {
      'aria-label': attr.displayName || attr.logicalName,
    };
    if (isLookupAttribute(attr)) {
      const targets = Array.isArray(attr.targets) && attr.targets.length ? attr.targets : [];
      const currentTarget = targets[0] || '';
      const bind = typeof val === 'string' ? val : '';
      const idMatch = /\(([0-9a-f-]{0,36})\)/i.exec(bind);
      const id = idMatch?.[1] || '';
      const targetMatch = /^\/([^()]+)\(/.exec(bind);
      const selectedTarget = targets.find((target: string) => entityMap.get(target) === targetMatch?.[1]) || currentTarget;
      const lookupState = lookupSearches[key] || {};
      return (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: targets.length > 1 ? 'minmax(120px, 0.8fr) minmax(160px, 1.2fr)' : '1fr', gap: 6 }}>
            {targets.length > 1 ? (
              <select className="rt-edit-input" value={selectedTarget} onChange={(e) => { updateLookup(attr, e.target.value, id); updateLookupSearch(key, { target: e.target.value, results: [] }); }} {...commonProps}>
                {targets.map((target: string) => <option key={target} value={target}>{target}</option>)}
              </select>
            ) : null}
            <input
              className="rt-edit-input"
              type="text"
              value={id}
              onChange={(e) => updateLookup(attr, selectedTarget, e.target.value)}
              placeholder={targets.length ? `${selectedTarget || targets[0]} GUID` : 'Related record GUID'}
              {...commonProps}
            />
          </div>
          {selectedTarget ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) auto', gap: 6 }}>
              <input className="rt-edit-input" type="text" value={lookupState.query || ''} onChange={(e) => updateLookupSearch(key, { query: e.target.value, target: selectedTarget })} placeholder="Search by primary name" />
              <button className="btn btn-secondary" type="button" onClick={() => void searchLookup(attr, selectedTarget)} disabled={lookupState.loading}>
                {lookupState.loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          ) : null}
          {lookupState.error ? <div className="create-record-help" style={{ color: 'var(--danger)' }}>{lookupState.error}</div> : null}
          {Array.isArray(lookupState.results) && lookupState.results.length ? (
            <div className="create-record-lookup-results">
              {lookupState.results.map((row: any, index: number) => {
                const rowId = row[lookupState.primaryId] || row[Object.keys(row).find((rowKey) => rowKey.endsWith('id')) || ''];
                const label = row[lookupState.primaryName] || row[`${lookupState.primaryId}@OData.Community.Display.V1.FormattedValue`] || rowId;
                if (typeof rowId !== 'string') return null;
                return (
                  <button key={`${rowId}-${index}`} className="create-record-lookup-result" type="button" onClick={() => updateLookup(attr, selectedTarget, rowId)}>
                    <span>{String(label)}</span>
                    <code>{rowId.slice(0, 8)}...</code>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    }
    if (Array.isArray(attr.optionValues) && attr.optionValues.length) {
      return (
        <select className="rt-edit-input" value={val === undefined ? '' : String(val)} onChange={(e) => updateValue(key, e.target.value === '' ? null : Number(e.target.value))} {...commonProps}>
          <option value="">Select value...</option>
          {attr.optionValues.map((option: any) => (
            <option key={option.value} value={option.value}>{option.label ? `${option.label} (${option.value})` : option.value}</option>
          ))}
        </select>
      );
    }
    if (typeName === 'booleantype' || typeName === 'boolean') {
      return (
        <select className="rt-edit-input" value={val === undefined ? '' : String(val)} onChange={(e) => updateValue(key, e.target.value === '' ? null : e.target.value === 'true')} {...commonProps}>
          <option value="">Use default</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    if (typeName.includes('integer') || typeName.includes('decimal') || typeName.includes('double') || typeName.includes('money') || typeName.includes('bigint')) {
      const step = attr.precision != null && attr.precision > 0 ? `0.${'0'.repeat(Math.max(0, attr.precision - 1))}1` : '1';
      return <input className="rt-edit-input" type="number" min={attr.minValue ?? undefined} max={attr.maxValue ?? undefined} step={step} value={val === undefined ? '' : String(val)} onChange={(e) => updateValue(key, e.target.value === '' ? null : Number(e.target.value))} {...commonProps} />;
    }
    if (typeName.includes('memo')) {
      return <textarea className="rt-edit-input" rows={3} maxLength={attr.maxLength ?? undefined} value={val === undefined ? '' : String(val)} onChange={(e) => updateValue(key, e.target.value || null)} {...commonProps} />;
    }
    if (typeName.includes('datetime')) {
      return <input className="rt-edit-input" type="datetime-local" value={dateInputValue(val)} onChange={(e) => updateValue(key, e.target.value ? new Date(e.target.value).toISOString() : null)} {...commonProps} />;
    }
    return <input className="rt-edit-input" type="text" maxLength={attr.maxLength ?? undefined} value={val === undefined ? '' : String(val)} onChange={(e) => updateValue(key, e.target.value || null)} placeholder={isRequiredAttribute(attr) || attr.isPrimaryName ? 'Required' : ''} {...commonProps} />;
  }

  function readSubmitBody(): Record<string, unknown> | null {
    if (!advanced) return values;
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setFormErrors(['Advanced JSON must be an object.']);
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      setFormErrors([err instanceof Error ? err.message : String(err)]);
      return null;
    }
  }

  async function handleSubmit() {
    const body = readSubmitBody();
    if (!body) return;
    const errors = validateCreateBody(body, creatableAttributes);
    setFormErrors(errors);
    if (errors.length) { toast(errors[0], true); return; }
    setSaving(true);
    try {
      const payload = await api<any>('/api/dv/records/create', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          entitySetName: entityDetail.entitySetName,
          logicalName: entityDetail.logicalName,
          primaryIdAttribute: entityDetail.primaryIdAttribute,
          body,
        }),
      });
      const created = payload.data;
      toast(created?.id ? 'Record created and opened.' : 'Record created. Dataverse did not return the new row ID.');
      onCreated(payload.data);
    } catch (err) {
      toast(formatCreateError(err), true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rt-modal-backdrop" ref={backdropRef} onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}>
      <div className="rt-modal">
        <div className="rt-modal-header">
          <div>
            <h3 className="rt-modal-title">New {entityDetail.displayName || entityDetail.logicalName}</h3>
            <span className="rt-modal-id">{environment} / {entityDetail.entitySetName}</span>
          </div>
          <div className="rt-modal-actions">
            <CopyButton value={advanced ? jsonText : JSON.stringify(values, null, 2)} label="Copy request" title="Copy create request body" toast={toast} />
            <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
        <div className="rt-modal-body">
          <div className="create-record-toolbar">
            <input className="rt-edit-input" type="text" placeholder="Filter fields..." value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)} />
            <label className="rt-edit-check"><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Changed only</label>
            <label className="rt-edit-check"><input type="checkbox" checked={advanced} onChange={(e) => { setAdvanced(e.target.checked); if (e.target.checked) setJsonText(JSON.stringify(values, null, 2)); }} /> Advanced JSON</label>
          </div>
          <div className="create-record-warning">
            Creates a Dataverse row in <strong>{environment}</strong>. Review required fields and lookup binds before submitting.
          </div>
          {metadataWarnings.length ? (
            <div className="create-record-metadata-warning">
              {metadataWarnings.slice(0, 3).map((warning) => <div key={warning}>{warning}</div>)}
              {metadataWarnings.length > 3 ? <div>{metadataWarnings.length - 3} more metadata warnings. Advanced JSON is still available.</div> : null}
            </div>
          ) : null}
          {formErrors.length ? (
            <div className="rt-modal-error">
              {formErrors.map((error) => <div key={error}>{error}</div>)}
            </div>
          ) : null}
          {advanced ? (
            <textarea className="rt-edit-input create-record-json" value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} />
          ) : groupedAttributes.length ? (
            groupedAttributes.map((group) => (
              <div key={group.label}>
                <div className="create-record-section">{group.label}</div>
                <table className="rt-detail-table">
                  <tbody>
                    {group.items.map((attr: any) => {
                      const key = payloadKeyForAttribute(attr);
                      return (
                        <tr key={attr.logicalName} className={key in values ? 'rt-detail-edited' : ''}>
                          <td className="rt-detail-key">
                            {attr.displayName || attr.logicalName}
                            {isRequiredAttribute(attr) ? <span className="create-record-required">required</span> : null}
                            <div style={{ fontSize: '0.5625rem', color: 'var(--border)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{key}</div>
                          </td>
                          <td className="rt-detail-value">
                            {inputForAttribute(attr)}
                            <div className="create-record-help">
                              {[attr.description, fieldConstraintLabel(attr)].filter(Boolean).join(' ')}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          ) : (
            <div className="rt-modal-loading">No creatable fields match the current filter.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function payloadKeyForAttribute(attr: any): string {
  return isLookupAttribute(attr) ? `${attr.logicalName}@odata.bind` : attr.logicalName;
}

function isLookupAttribute(attr: any): boolean {
  const typeName = String(attr.attributeTypeName || attr.attributeType || '').toLowerCase();
  return typeName.includes('lookup') || typeName.includes('customer') || typeName.includes('owner');
}

function isRequiredAttribute(attr: any): boolean {
  return /required/i.test(String(attr.requiredLevel || ''));
}

function fieldConstraintLabel(attr: any): string {
  const parts = [];
  if (attr.maxLength != null) parts.push(`Max ${attr.maxLength} chars.`);
  if (attr.minValue != null || attr.maxValue != null) parts.push(`Range ${attr.minValue ?? '-inf'} to ${attr.maxValue ?? 'inf'}.`);
  if (Array.isArray(attr.targets) && attr.targets.length) parts.push(`Targets: ${attr.targets.join(', ')}.`);
  return parts.join(' ');
}

function dateInputValue(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function formatCreateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/DV_RECORD_BODY_REQUIRED/i.test(message) || /at least one field/i.test(message)) return 'Add at least one field before creating the record.';
  if (/ENVIRONMENT_WRITE_BLOCKED/i.test(message) || /read-only/i.test(message)) return 'This environment is read-only. Choose a writable environment before creating records.';
  if (/HTTP_REQUEST_FAILED/i.test(message)) return 'Dataverse rejected the create request. Review required fields, lookup binds, and field values.';
  if (/0x800402|required|Business Process Error|validation/i.test(message)) return `Dataverse rejected the record: ${message}`;
  return message;
}

function validateCreateBody(body: Record<string, unknown>, attributes: any[]): string[] {
  const errors: string[] = [];
  if (!Object.keys(body).length) errors.push('Enter at least one field value.');
  const attributesByPayloadKey = new Map(attributes.map((attr: any) => [payloadKeyForAttribute(attr), attr]));
  for (const attr of attributes) {
    const key = payloadKeyForAttribute(attr);
    if (isRequiredAttribute(attr) && !(key in body)) errors.push(`${attr.displayName || attr.logicalName} is required.`);
  }
  for (const [key, value] of Object.entries(body)) {
    const attr = attributesByPayloadKey.get(key);
    if (!attr) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) errors.push(`${key} must be a valid number.`);
      if (attr.minValue != null && value < attr.minValue) errors.push(`${key} must be at least ${attr.minValue}.`);
      if (attr.maxValue != null && value > attr.maxValue) errors.push(`${key} must be no more than ${attr.maxValue}.`);
    }
    if (typeof value === 'string' && attr.maxLength != null && value.length > attr.maxLength) {
      errors.push(`${key} must be ${attr.maxLength} characters or fewer.`);
    }
    if (key.endsWith('@odata.bind') && typeof value === 'string' && !/^\/[^()]+\([0-9a-f-]{36}\)$/i.test(value)) {
      errors.push(`${key} must look like /entityset(00000000-0000-0000-0000-000000000000).`);
    }
  }
  return errors;
}

function DataverseTab(props: {
  dataverse: any;
  setDataverse: React.Dispatch<React.SetStateAction<any>>;
  environment: string;
  environmentUrl: string;
  loadEntities: () => Promise<void>;
  loadEntityDetail: (logicalName: string) => Promise<void>;
  loadRecordPreview: () => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { dataverse, setDataverse, environment, environmentUrl, loadEntities, loadEntityDetail, loadRecordPreview, toast } = props;
  const [showCreateRecord, setShowCreateRecord] = useState(false);
  const [createdRecordId, setCreatedRecordId] = useState<string | null>(null);
  const detail = useRecordDetail();
  const [queryForm, setQueryForm] = useState({
    entitySetName: '',
    top: '10',
    selectCsv: '',
    filter: '',
    orderByCsv: '',
    expandCsv: '',
    rawPath: '',
    includeCount: false,
  });
  const filteredEntities = dataverse.entityFilter
    ? dataverse.entities.filter((item: any) => item.logicalName.includes(dataverse.entityFilter.toLowerCase()) || (item.displayName || '').toLowerCase().includes(dataverse.entityFilter.toLowerCase()) || (item.entitySetName || '').toLowerCase().includes(dataverse.entityFilter.toLowerCase()))
    : dataverse.entities;

  const entityMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of dataverse.entities) {
      if (entity.logicalName && entity.entitySetName) map.set(entity.logicalName, entity.entitySetName);
    }
    return map;
  }, [dataverse.entities]);

  useEffect(() => {
    setQueryForm({
      entitySetName: '',
      top: '10',
      selectCsv: '',
      filter: '',
      orderByCsv: '',
      expandCsv: '',
      rawPath: '',
      includeCount: false,
    });
    setCreatedRecordId(null);
  }, [environment]);

  const filteredAttributes = dataverse.currentEntityDetail
    ? (dataverse.currentEntityDetail.attributes || []).filter((attribute: any) => {
        if (!dataverse.attrFilter) return true;
        const filter = dataverse.attrFilter.toLowerCase();
        return attribute.logicalName.includes(filter) || (attribute.displayName || '').toLowerCase().includes(filter);
      })
    : [];

  useEffect(() => {
    if (!dataverse.currentEntityDetail) return;
    setQueryForm((current) => ({
      ...current,
      entitySetName: dataverse.currentEntityDetail.entitySetName || '',
      selectCsv: (dataverse.selectedColumns.length
        ? dataverse.selectedColumns
        : getDefaultSelectedColumns(dataverse.currentEntityDetail, 0)).join(','),
      orderByCsv: orderByDefault(dataverse.currentEntityDetail),
    }));
    setCreatedRecordId(null);
  }, [dataverse.currentEntityDetail, dataverse.selectedColumns]);

  function readQueryForm(event: FormEvent<HTMLFormElement> | ReactMouseEvent<HTMLButtonElement>) {
    const target = event.currentTarget;
    const form = target instanceof HTMLFormElement ? target : target.form;
    if (!form) return queryForm;
    const data = new FormData(form);
    return {
      entitySetName: String(data.get('entitySetName') || ''),
      top: String(data.get('top') || ''),
      selectCsv: String(data.get('selectCsv') || ''),
      filter: String(data.get('filter') || ''),
      orderByCsv: String(data.get('orderByCsv') || ''),
      expandCsv: String(data.get('expandCsv') || ''),
      rawPath: String(data.get('rawPath') || ''),
      includeCount: data.get('includeCount') === 'on',
    };
  }

  async function runQuery(event: FormEvent<HTMLFormElement> | ReactMouseEvent<HTMLButtonElement>, previewOnly = false) {
    event.preventDefault();
    const submitted = readQueryForm(event);
    try {
      const payload = await api<any>(previewOnly ? '/api/dv/query/preview' : '/api/dv/query/execute', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          entitySetName: submitted.entitySetName,
          top: submitted.top,
          selectCsv: submitted.selectCsv,
          filter: submitted.filter,
          orderByCsv: submitted.orderByCsv,
          expandCsv: submitted.expandCsv,
          rawPath: submitted.rawPath,
          includeCount: submitted.includeCount,
        }),
      });
      if (previewOnly) {
        setDataverse((current: any) => ({ ...current, queryPreview: payload.data.path || '' }));
      } else {
        setDataverse((current: any) => ({
          ...current,
          queryPreview: payload.data?.path || current.queryPreview,
          queryResult: payload.data,
        }));
        toast('Query executed');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <>
      <div className="entity-sidebar">
        <div className="panel">
          <h2>Entities</h2>
          <input type="text" id="entity-filter" className="entity-filter" placeholder="Filter entities…" value={dataverse.entityFilter} onChange={(event) => setDataverse((current: any) => ({ ...current, entityFilter: event.target.value }))} />
          <div id="entity-count" className="entity-count">{dataverse.entities.length ? `${dataverse.entities.length} entities` : ''}</div>
          <div id="entity-list" className="entity-list">
            {dataverse.entities.length ? filteredEntities.map((entity: any) => {
              const flags = [];
              if (entity.isCustomEntity) flags.push(<span key="custom" className="entity-item-flag">custom</span>);
              if (entity.isActivity) flags.push(<span key="activity" className="entity-item-flag">activity</span>);
              const isActive = dataverse.currentEntity?.logicalName === entity.logicalName;
              return (
                <button
                  type="button"
                  key={entity.logicalName}
                  className={`entity-item ${isActive ? 'active' : ''}`}
                  data-entity={entity.logicalName}
                  aria-pressed={isActive}
                  onClick={() => void loadEntityDetail(entity.logicalName)}
                >
                  <div className="entity-item-name">{entity.displayName || entity.logicalName}</div>
                  <div className="entity-item-logical">{entity.logicalName}</div>
                  <div className="entity-item-badges">
                    {entity.entitySetName ? <span className="entity-item-set">{entity.entitySetName}</span> : null}
                    {flags}
                  </div>
                </button>
              );
            }) : (
              dataverse.entitiesLoadError ? (
                <div className="error-banner" role="alert">
                  <div className="error-banner-header">
                    <Icon name="circle" size={14} />
                    <span>Could not load entities</span>
                  </div>
                  <div className="error-banner-body">{dataverse.entitiesLoadError}</div>
                  <div className="error-banner-actions">
                    <button className="btn btn-sm btn-secondary" type="button" onClick={() => void loadEntities()}>Retry</button>
                    <CopyButton value={dataverse.entitiesLoadError} label="Copy error" title="Copy error message" toast={toast} />
                  </div>
                </div>
              ) : (
                <div className="entity-loading">Select an environment to load entities.</div>
              )
            )}
          </div>
        </div>
      </div>
      <div className="detail-area" id="dv-workspace-area">
        <div className="dv-sub-nav">
          {(['dv-explorer', 'dv-query', 'dv-fetchxml', 'dv-relationships'] as DataverseSubTab[]).map((tabName) => (
            <button key={tabName} className={`sub-tab ${dataverse.dvSubTab === tabName ? 'active' : ''}`} data-dvtab={tabName} onClick={() => setDataverse((current: any) => ({ ...current, dvSubTab: tabName }))}>
              {tabName === 'dv-explorer' ? 'Explorer' : tabName === 'dv-query' ? 'Query' : tabName === 'dv-fetchxml' ? 'FetchXML' : 'Relationships'}
            </button>
          ))}
        </div>

        <div className={`dv-subpanel ${dataverse.dvSubTab === 'dv-explorer' ? 'active' : ''}`} id="dv-subpanel-dv-explorer">
          <div className="panel" id="entity-detail-panel">
            {!dataverse.currentEntityDetail ? (
              <div id="entity-detail-empty">
                <EmptyState icon={<Icon name="circle-dashed" size={18} />} title="Entity Detail" description="Select an entity from the list to inspect its metadata and preview records." />
              </div>
            ) : (
              <div id="entity-detail">
                <div className="sub-tabs">
                  <button className={`sub-tab ${dataverse.explorerSubTab === 'metadata' ? 'active' : ''}`} data-subtab="metadata" onClick={() => setDataverse((current: any) => ({ ...current, explorerSubTab: 'metadata' }))}>Metadata</button>
                  <button className={`sub-tab ${dataverse.explorerSubTab === 'records' ? 'active' : ''}`} data-subtab="records" onClick={() => setDataverse((current: any) => ({ ...current, explorerSubTab: 'records' }))}>Records</button>
                </div>

                <div className={`sub-panel ${dataverse.explorerSubTab === 'metadata' ? 'active' : ''}`} id="subpanel-metadata">
                  <h2 id="entity-title">{dataverse.currentEntityDetail.displayName || dataverse.currentEntityDetail.logicalName}</h2>
                  <p className="desc" id="entity-subtitle">{dataverse.currentEntityDetail.description || dataverse.currentEntityDetail.logicalName}</p>
                  <div id="entity-metrics" className="metrics">
                    {[
                      ['Logical Name', dataverse.currentEntityDetail.logicalName],
                      ['Entity Set', dataverse.currentEntityDetail.entitySetName],
                      ['Primary ID', dataverse.currentEntityDetail.primaryIdAttribute],
                      ['Primary Name', dataverse.currentEntityDetail.primaryNameAttribute],
                      ['Ownership', dataverse.currentEntityDetail.ownershipType],
                      ['Attributes', (dataverse.currentEntityDetail.attributes || []).length],
                      ['Custom', dataverse.currentEntityDetail.isCustomEntity],
                      ['Change Tracking', dataverse.currentEntityDetail.changeTrackingEnabled],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="metric">
                        <div className="metric-label">{label}</div>
                        <div className="metric-value copy-inline">
                          <span className="copy-inline-value">{String(value ?? '-')}</span>
                          <CopyButton value={value ?? ''} label="copy" title={`Copy ${String(label)}`} toast={toast} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="btn-group" style={{ marginBottom: 12 }}>
                    <button className="btn btn-primary btn-sm" id="entity-to-query" type="button" onClick={() => setDataverse((current: any) => ({ ...current, dvSubTab: 'dv-query' }))}>Use in Query</button>
                    <button className="btn btn-primary btn-sm" id="entity-to-fetchxml" type="button" onClick={() => setDataverse((current: any) => ({ ...current, dvSubTab: 'dv-fetchxml' }))}>Use in FetchXML</button>
                  </div>
                  <div className="selected-cols" id="selected-cols">
                    <span className="selected-cols-label">Selected:</span>
                    {dataverse.selectedColumns.length ? dataverse.selectedColumns.map((column: string) => (
                      <span key={column} className="col-chip" data-remove-col={column} onClick={() => setDataverse((current: any) => ({ ...current, selectedColumns: current.selectedColumns.filter((item: string) => item !== column) }))}>{column} <span className="x">×</span></span>
                    )) : <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Click attributes below to select columns</span>}
                    {dataverse.selectedColumns.length ? <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '0.6875rem' }} onClick={() => setDataverse((current: any) => ({ ...current, selectedColumns: [] }))}>Clear all</button> : null}
                  </div>
                  <input type="text" id="attr-filter" className="attr-filter" placeholder="Filter attributes…" value={dataverse.attrFilter} onChange={(event) => setDataverse((current: any) => ({ ...current, attrFilter: event.target.value }))} />
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th></th><th>Column</th><th>Type</th><th>Flags</th></tr></thead>
                      <tbody id="attribute-table">
                        {filteredAttributes.map((attribute: any) => {
                          const selected = dataverse.selectedColumns.includes(attribute.logicalName);
                          const flags = [
                            attribute.isPrimaryId ? 'PK' : '',
                            attribute.isPrimaryName ? 'name' : '',
                            attribute.isValidForRead ? 'R' : '',
                            attribute.isValidForCreate ? 'C' : '',
                            attribute.isValidForUpdate ? 'U' : '',
                          ].filter(Boolean).join(' ');
                          return (
                            <tr key={attribute.logicalName} className={`attr-row ${selected ? 'selected' : ''}`} data-col={attribute.logicalName} onClick={() => setDataverse((current: any) => ({
                              ...current,
                              selectedColumns: current.selectedColumns.includes(attribute.logicalName)
                                ? current.selectedColumns.filter((item: string) => item !== attribute.logicalName)
                                : [...current.selectedColumns, attribute.logicalName],
                            }))}>
                              <td style={{ width: 24, textAlign: 'center' }}>{selected ? '✓' : ''}</td>
                              <td><strong>{attribute.displayName || attribute.logicalName}</strong><br /><code>{attribute.logicalName}</code></td>
                              <td><code>{attribute.attributeTypeName || attribute.attributeType || ''}</code></td>
                              <td><code>{flags}</code></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={`sub-panel ${dataverse.explorerSubTab === 'records' ? 'active' : ''}`} id="subpanel-records">
                  <div className="toolbar-row">
                    <h2>Record Preview</h2>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowCreateRecord(true)}>Add Record</button>
                      <button className="btn btn-secondary" id="entity-refresh-records" type="button" onClick={() => void loadRecordPreview()}>Refresh</button>
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 8 }} className="copy-inline">
                    <span className="copy-inline-value">{dataverse.recordPreview?.path || ''}</span>
                    {dataverse.recordPreview?.path ? <CopyButton value={dataverse.recordPreview.path} label="copy" title="Copy record preview path" toast={toast} /> : null}
                  </div>
                  <ResultView result={dataverse.recordPreview} entityLogicalName={dataverse.currentEntityDetail?.logicalName} entitySetName={dataverse.currentEntityDetail?.entitySetName} primaryIdAttribute={dataverse.currentEntityDetail?.primaryIdAttribute} environment={environment} environmentUrl={environmentUrl} entityMap={entityMap} highlightedRecordId={createdRecordId ?? undefined} placeholder="Select an entity to preview records." toast={toast} />
                  {showCreateRecord && dataverse.currentEntityDetail && (
                    <CreateRecordModal
                      entityDetail={dataverse.currentEntityDetail}
                      environment={environment}
                      entityMap={entityMap}
                      metadataWarnings={(dataverse.currentEntityDiagnostics || [])
                        .filter((diagnostic: any) => diagnostic?.level === 'warning')
                        .map((diagnostic: any) => diagnostic.message || diagnostic.code || 'Some field metadata could not be loaded.')}
                      onClose={() => setShowCreateRecord(false)}
                      onCreated={(created) => {
                        setShowCreateRecord(false);
                        const id = created?.id || created?.record?.[dataverse.currentEntityDetail?.primaryIdAttribute || ''];
                        setCreatedRecordId(typeof id === 'string' ? id : null);
                        void loadRecordPreview();
                        if (typeof id === 'string') {
                          detail.open(dataverse.currentEntityDetail.logicalName, dataverse.currentEntityDetail.entitySetName, id);
                        }
                      }}
                      toast={toast}
                    />
                  )}
                  {detail.target && environment && (
                    <RecordDetailModal
                      initial={detail.target}
                      environment={environment}
                      environmentUrl={environmentUrl}
                      entityMap={entityMap}
                      onClose={detail.close}
                      toast={toast}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={`dv-subpanel ${dataverse.dvSubTab === 'dv-query' ? 'active' : ''}`} id="dv-subpanel-dv-query">
          <div className="panel">
            <h2>Web API Query</h2>
            <div className="entity-context" id="query-entity-context">
              {dataverse.currentEntityDetail ? (
                <>
                  <span className="entity-context-name">{dataverse.currentEntityDetail.displayName || dataverse.currentEntityDetail.logicalName}</span>
                  {dataverse.currentEntityDetail.entitySetName ? <span className="entity-context-set">{dataverse.currentEntityDetail.entitySetName}</span> : null}
                </>
              ) : <span className="entity-context-empty">No entity selected — pick one in Explorer or type an entity set below</span>}
            </div>
            <form id="query-form" onSubmit={(event) => void runQuery(event, false)}>
              <div className="form-row">
                <div className="field">
                  <span className="field-label">Entity Set</span>
                  <input name="entitySetName" id="query-entity-set" placeholder="accounts" value={queryForm.entitySetName} onChange={(event) => setQueryForm((current) => ({ ...current, entitySetName: event.target.value }))} />
                </div>
                <div className="field">
                  <span className="field-label">Top</span>
                  <input name="top" type="number" min="1" step="1" value={queryForm.top} onChange={(event) => setQueryForm((current) => ({ ...current, top: event.target.value }))} />
                </div>
              </div>
              <div className="field">
                <span className="field-label">Select Columns (CSV)</span>
                <input name="selectCsv" id="query-select" placeholder="accountid,name,accountnumber" value={queryForm.selectCsv} onChange={(event) => setQueryForm((current) => ({ ...current, selectCsv: event.target.value }))} />
              </div>
              <div className="field">
                <span className="field-label">Filter</span>
                <input name="filter" id="query-filter" placeholder="contains(name,'Contoso')" value={queryForm.filter} onChange={(event) => setQueryForm((current) => ({ ...current, filter: event.target.value }))} />
              </div>
              <div className="form-row">
                <div className="field">
                  <span className="field-label">Order By (CSV)</span>
                  <input name="orderByCsv" id="query-order" placeholder="name asc,createdon desc" value={queryForm.orderByCsv} onChange={(event) => setQueryForm((current) => ({ ...current, orderByCsv: event.target.value }))} />
                </div>
                <div className="field">
                  <span className="field-label">Expand (CSV)</span>
                  <input name="expandCsv" id="query-expand" placeholder="primarycontactid($select=fullname)" value={queryForm.expandCsv} onChange={(event) => setQueryForm((current) => ({ ...current, expandCsv: event.target.value }))} />
                </div>
              </div>
              <div className="field">
                <span className="field-label">Raw Path Override</span>
                <input name="rawPath" id="query-raw-path" placeholder="/api/data/v9.2/accounts?$select=name" value={queryForm.rawPath} onChange={(event) => setQueryForm((current) => ({ ...current, rawPath: event.target.value }))} />
              </div>
              <div className="check-row"><input type="checkbox" name="includeCount" id="query-count" checked={queryForm.includeCount} onChange={(event) => setQueryForm((current) => ({ ...current, includeCount: event.target.checked }))} /><label htmlFor="query-count">Include count</label></div>
              <div className="btn-group">
                <button className="btn btn-secondary" id="query-preview-btn" type="button" onClick={(event) => void runQuery(event, true)}>Preview Path</button>
                <button className="btn btn-primary" id="query-run-btn" type="submit">Run Query</button>
              </div>
            </form>
          </div>
          <div className="panel">
            <div className="toolbar-row tight">
              <h2>Generated Path</h2>
              <CopyButton value={dataverse.queryPreview} label="Copy path" title="Copy generated Dataverse path" toast={toast} />
            </div>
            <pre className="viewer" id="query-preview">{dataverse.queryPreview}</pre>
          </div>
          <div className="panel">
            <h2>Query Result</h2>
            <ResultView result={dataverse.queryResult} entityLogicalName={dataverse.queryResult?.logicalName} entitySetName={dataverse.queryResult?.entitySetName} primaryIdAttribute={dataverse.currentEntityDetail?.primaryIdAttribute} environment={environment} environmentUrl={environmentUrl} entityMap={entityMap} placeholder="Run a query to see the response." toast={toast} />
          </div>
        </div>

        <div id="dv-subpanel-dv-fetchxml" className={`dv-subpanel ${dataverse.dvSubTab === 'dv-fetchxml' ? 'active' : ''}`} style={{ display: dataverse.dvSubTab === 'dv-fetchxml' ? undefined : 'none' }}>
          <FetchXmlTab dataverse={dataverse} environment={environment} environmentUrl={environmentUrl} toast={toast} />
        </div>
        <div id="dv-subpanel-dv-relationships" className={`dv-subpanel ${dataverse.dvSubTab === 'dv-relationships' ? 'active' : ''}`} style={{ display: dataverse.dvSubTab === 'dv-relationships' ? undefined : 'none' }}>
          <RelationshipsTab dataverse={dataverse} environment={environment} loadEntityDetail={loadEntityDetail} toast={toast} />
        </div>
      </div>
    </>
  );
}

function orderByDefault(detail: any) {
  const cols = getDefaultSelectedColumns(detail, 0);
  const orderColumn = cols.find((name) => name !== detail?.primaryIdAttribute) || cols[0] || '';
  return orderColumn ? `${orderColumn} asc` : '';
}

function AppsTab(props: { state: any; setState: React.Dispatch<React.SetStateAction<any>>; environment: string; reload: () => Promise<void>; openConsole: (path: string) => void; toast: (message: string, isError?: boolean) => void }) {
  const { state, setState, environment, reload, openConsole, toast } = props;
  const detail = useRecordDetail();

  return (
    <>
      <InventorySidebar
        title="Apps"
        countLabel="apps"
        filterPlaceholder="Filter apps…"
        items={state.items}
        filter={state.filter}
        onFilterChange={(next) => setState((current: any) => ({ ...current, filter: next }))}
        matchItem={(item: any, query) => {
          const name = String(prop(item, 'properties.displayName') || item.name || '').toLowerCase();
          return name.includes(query);
        }}
        isSelected={(item: any) => state.current?.name === item.name}
        itemKey={(item: any) => item.name}
        onSelect={(item: any) => setState((current: any) => ({ ...current, current: item }))}
        onRefresh={() => void reload().then(() => toast('Apps refreshed')).catch((error) => toast(error instanceof Error ? error.message : String(error), true))}
        emptyHint="Select an environment to load apps."
        renderItem={(item: any) => (
          <>
            <div className="entity-item-name">{prop(item, 'properties.displayName') || item.name || 'Unnamed'}</div>
            <div className="entity-item-logical">{item.name}</div>
            {prop(item, 'properties.appType') ? <div className="entity-item-badges"><span className="entity-item-flag">{String(prop(item, 'properties.appType')).replace(/([a-z])([A-Z])/g, '$1 $2')}</span></div> : null}
          </>
        )}
      />
      <div className="detail-area">
        <div className="panel">
          {!state.current ? (
            <div id="app-detail-empty">
              <EmptyState icon={<Icon name="grid" size={18} />} title="App Detail" description="Select an app from the list to inspect its metadata and connections." />
            </div>
          ) : (
            <div id="app-detail">
              <div className="toolbar-row">
                <div>
                  <h2 id="app-title">{prop(state.current, 'properties.displayName') || state.current.name}</h2>
                  <p className="desc no-mb" id="app-subtitle">{prop(state.current, 'properties.description') || state.current.name}</p>
                </div>
                <button className="btn btn-ghost" id="app-open-console" type="button" style={{ fontSize: '0.75rem' }} onClick={() => openConsole(`/apps/${state.current.name}`)}>Open in Console</button>
              </div>
              <div id="app-metrics" className="metrics">
                {[
                  ['App Type', prop(state.current, 'properties.appType') || '-'],
                  ['Created', formatDate(prop(state.current, 'properties.createdTime'))],
                  ['Modified', formatDate(prop(state.current, 'properties.lastModifiedTime'))],
                  ['Published', formatDate(prop(state.current, 'properties.lastPublishTime'))],
                  ['App ID', state.current.name],
                ].map(([label, value]) => (
                  <div key={String(label)} className="metric">
                    <div className="metric-label">{label}</div>
                    <div className="metric-value copy-inline">
                      {label === 'App ID' ? (
                        <span className="record-link" onClick={() => detail.open('canvasapp', 'canvasapps', String(value))}>{String(value).slice(0, 8)}...</span>
                      ) : (
                        <span className="copy-inline-value">{String(value)}</span>
                      )}
                      <CopyButton value={value} label="copy" title={`Copy ${String(label)}`} toast={toast} />
                    </div>
                  </div>
                ))}
              </div>
              <div id="app-connections">
                {Object.entries(prop(state.current, 'properties.connectionReferences') || {}).map(([key, value]: [string, any]) => (
                  <div key={key} className="card-item" style={{ padding: '8px 10px' }}>
                    <div className="card-item-info">
                      <div className="card-item-title">{value.displayName || key}</div>
                      <div className="card-item-sub copy-inline">
                        <span className="copy-inline-value">{value.id || ''}</span>
                        {value.id ? <CopyButton value={value.id} label="copy" title="Copy connection ID" toast={toast} /> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {detail.target && environment && (
        <RecordDetailModal initial={detail.target} environment={environment} onClose={detail.close} toast={toast} />
      )}
    </>
  );
}

type CanvasSessionEntry = { id: string; status: string; appId: string; environmentAlias: string; result?: any; error?: string; createdAt: string; deviceCode?: { verificationUri: string; userCode: string; message: string } };

function CanvasResultView(props: { result: any; endpoint: string; toast: (message: string, isError?: boolean) => void }) {
  const { result, endpoint, toast } = props;
  const [view, setView] = useState<'table' | 'json'>('table');

  // Extract the main array from known canvas response shapes
  const items: any[] | null = useMemo(() => {
    if (!result || typeof result !== 'object') return null;
    if (Array.isArray(result.controls)) return result.controls;
    if (Array.isArray(result.apis)) return result.apis;
    if (Array.isArray(result.dataSources)) return result.dataSources;
    if (Array.isArray(result.files)) return result.files;
    if (Array.isArray(result.errors)) return result.errors;
    if (Array.isArray(result.value)) return result.value;
    return null;
  }, [result]);

  const columns: string[] = useMemo(() => {
    if (!items || items.length === 0) return [];
    const cols = new Set<string>();
    for (const item of items.slice(0, 50)) {
      if (item && typeof item === 'object') {
        for (const key of Object.keys(item)) {
          if (typeof item[key] !== 'object' || item[key] === null) cols.add(key);
        }
      }
    }
    return Array.from(cols);
  }, [items]);

  const hasTable = items !== null && items.length > 0 && columns.length > 0;
  const count = result?.count ?? items?.length;

  return (
    <div>
      <div className="toolbar-row tight">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasTable && (
            <div className="result-toggle">
              <button className={`result-toggle-btn ${view === 'table' ? 'active' : ''}`} type="button" onClick={() => setView('table')}>Table</button>
              <button className={`result-toggle-btn ${view === 'json' ? 'active' : ''}`} type="button" onClick={() => setView('json')}>JSON</button>
            </div>
          )}
          {count !== undefined && <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{count} items</span>}
        </div>
        <CopyButton value={result} label="Copy JSON" title="Copy result JSON" toast={toast} />
      </div>

      {view === 'table' && hasTable ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="result-table">
            <thead>
              <tr>{columns.map((col) => <th key={col}>{col}</th>)}</tr>
            </thead>
            <tbody>
              {items!.map((item: any, i: number) => (
                <tr key={i}>
                  {columns.map((col) => <td key={col}>{item?.[col] === undefined || item[col] === null ? '' : String(item[col])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(result || 'No data.') }} />
      )}
    </div>
  );
}

function CanvasTab(props: {
  state: any;
  setState: React.Dispatch<React.SetStateAction<any>>;
  environment: string;
  environmentId?: string;
  apps: any[];
  appsLoaded: boolean;
  loadApps: () => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { state, setState, environment, environmentId, apps, appsLoaded, loadApps, toast } = props;
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const [explorerResult, setExplorerResult] = useState<any>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerEndpoint, setExplorerEndpoint] = useState('controls');
  const [yamlDir, setYamlDir] = useState('./canvas-src');
  const [yamlBusy, setYamlBusy] = useState(false);

  useEffect(() => {
    if (!environment || appsLoaded) return;
    void loadApps();
  }, [environment, appsLoaded]);

  useEffect(() => { setSelectedApp(null); }, [environment]);

  const canvasApps = useMemo(() => {
    return apps.filter((item: any) => {
      const appType = prop(item, 'properties.appType');
      if (appType && appType !== 'CanvasClassicApp' && appType !== 'AppComponentLibrary') return false;
      if (environmentId) {
        const appEnvId = prop(item, 'properties.environment.name');
        if (appEnvId && appEnvId !== environmentId) return false;
      }
      return true;
    });
  }, [apps, environmentId]);

  const filtered = filter
    ? canvasApps.filter((item: any) => {
        const name = prop(item, 'properties.displayName') || item.name || '';
        return String(name).toLowerCase().includes(filter.toLowerCase());
      })
    : canvasApps;

  function sessionForApp(appId: string): CanvasSessionEntry | undefined {
    return (state.sessions as CanvasSessionEntry[]).find((s) => s.appId === appId && (s.status === 'active' || s.status === 'unknown'));
  }

  const currentSession = selectedApp ? sessionForApp(selectedApp.name) : undefined;
  const activeSession = currentSession?.status === 'active' ? currentSession : undefined;

  async function probeSession(id: string) {
    try {
      const payload = await api<any>(`/api/canvas/sessions/${encodeURIComponent(id)}/probe`, { method: 'POST' });
      const session = payload.data as CanvasSessionEntry;
      setState((c: any) => ({
        ...c,
        sessions: c.sessions.map((s: any) => s.id === id ? session : s),
      }));
      if (session.status === 'active') toast('Session is alive');
      else toast('Session has expired', true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function endSession(id: string) {
    try {
      await api<any>(`/api/canvas/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setState((c: any) => ({
        ...c,
        sessions: c.sessions.filter((s: any) => s.id !== id),
      }));
      setExplorerResult(null);
      toast('Session ended');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function startSession() {
    if (!environment || !selectedApp) return;
    setState((c: any) => ({ ...c, sessionStarting: true }));
    try {
      const payload = await api<any>('/api/canvas/sessions', {
        method: 'POST',
        body: JSON.stringify({ environment, appId: selectedApp.name }),
      });
      const session = payload.data as CanvasSessionEntry;
      setState((c: any) => ({
        ...c,
        sessions: [session, ...c.sessions],
        sessionStarting: false,
      }));
      toast('Canvas session starting…');
      void pollSession(session.id);
    } catch (error) {
      setState((c: any) => ({ ...c, sessionStarting: false }));
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function pollSession(id: string) {
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const payload = await api<any>(`/api/canvas/sessions/${encodeURIComponent(id)}`);
        const session = payload.data as CanvasSessionEntry;
        setState((c: any) => ({
          ...c,
          sessions: c.sessions.map((s: any) => s.id === id ? session : s),
        }));
        if (session.status === 'active') { toast('Canvas session active'); return; }
        if (session.status === 'failed') { toast(session.error || 'Session failed to start.', true); return; }
      } catch { /* retry */ }
    }
    toast('Session start timed out.', true);
  }

  async function callEndpoint(endpoint: string) {
    if (!activeSession) return;
    setExplorerLoading(true);
    setExplorerEndpoint(endpoint);
    try {
      const version = activeSession.result?.session?.clientConfig?.webAuthoringVersion;
      const pathPrefix = version ? `/${version}` : '';
      const payload = await api<any>('/api/canvas/request', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: activeSession.id,
          method: 'GET',
          path: `${pathPrefix}/api/yaml/${endpoint}`,
        }),
      });
      setExplorerResult(payload.data?.response ?? payload.data);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      setExplorerResult(null);
    } finally {
      setExplorerLoading(false);
    }
  }

  const endpoints = [
    { key: 'controls', label: 'Controls' },
    { key: 'apis', label: 'APIs' },
    { key: 'datasources', label: 'Data Sources' },
    { key: 'accessibility-errors', label: 'Accessibility' },
  ];

  async function fetchYaml() {
    if (!activeSession || !yamlDir.trim()) return;
    setYamlBusy(true);
    try {
      const payload = await api<any>('/api/canvas/yaml/fetch', {
        method: 'POST',
        body: JSON.stringify({ sessionId: activeSession.id, outDir: yamlDir.trim() }),
      });
      const files = payload.data?.files as string[] | undefined;
      toast(`Saved ${files?.length ?? 0} YAML files to ${yamlDir.trim()}`);
      setExplorerResult(payload.data);
      setExplorerEndpoint('yaml-fetch');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setYamlBusy(false);
    }
  }

  async function validateYaml() {
    if (!activeSession || !yamlDir.trim()) return;
    setYamlBusy(true);
    try {
      const payload = await api<any>('/api/canvas/yaml/validate', {
        method: 'POST',
        body: JSON.stringify({ sessionId: activeSession.id, dir: yamlDir.trim() }),
      });
      setExplorerResult(payload.data?.response ?? payload.data);
      setExplorerEndpoint('yaml-validate');
      toast('Validation complete');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setYamlBusy(false);
    }
  }

  const pendingSession = selectedApp
    ? (state.sessions as CanvasSessionEntry[]).find((s) => s.appId === selectedApp.name && (s.status === 'starting' || s.status === 'waiting_for_auth'))
    : undefined;

  return (
    <>
      <div className="inventory-sidebar">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2>Canvas Apps</h2>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadApps().then(() => toast('Apps refreshed')).catch((error) => toast(error instanceof Error ? error.message : String(error), true))}>Refresh</button>
          </div>
          <input type="text" className="entity-filter" placeholder="Filter canvas apps…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="entity-count">{canvasApps.length ? `${canvasApps.length} canvas apps` : ''}</div>
          <div className="entity-list">
            {canvasApps.length ? filtered.map((item: any) => {
              const session = sessionForApp(item.name);
              return (
                <div key={item.name} className={`entity-item ${selectedApp?.name === item.name ? 'active' : ''}`} onClick={() => { setSelectedApp(item); setExplorerResult(null); }}>
                  <div className="entity-item-name">
                    {session ? <span className={`health-dot ${session.status === 'active' ? 'ok' : 'pending'}`} style={{ marginRight: 6 }}></span> : null}
                    {prop(item, 'properties.displayName') || item.name || 'Unnamed'}
                  </div>
                  <div className="entity-item-logical">{item.name}</div>
                  <div className="entity-item-badges">
                    {prop(item, 'properties.appType') ? <span className="entity-item-flag">{String(prop(item, 'properties.appType')).replace(/([a-z])([A-Z])/g, '$1 $2')}</span> : null}
                    {session?.result?.session?.isCoauthoringEnabled === false ? <span className="entity-item-flag" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>No coauthoring</span> : null}
                  </div>
                </div>
              );
            }) : <div className="entity-loading">{appsLoaded ? 'No canvas apps found.' : 'Select an environment to load apps.'}</div>}
          </div>
        </div>
      </div>
      <div className="detail-area">
        <div className="panel">
          {!selectedApp ? (
            <EmptyState icon={<Icon name="pencil" size={18} />} title="Canvas Authoring" description="Select a canvas app to start an authoring session, then explore its controls, data sources, APIs, and YAML source." />
          ) : (
            <>
              <div className="toolbar-row">
                <div>
                  <h2>{prop(selectedApp, 'properties.displayName') || selectedApp.name}</h2>
                  <p className="desc no-mb">{prop(selectedApp, 'properties.description') || selectedApp.name}</p>
                </div>
                {activeSession ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="entity-item-flag" style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>Session Active</span>
                    <button className="btn btn-ghost btn-sm btn-danger-text" onClick={() => void endSession(activeSession.id)}>End</button>
                  </div>
                ) : currentSession?.status === 'unknown' ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="btn" onClick={() => void probeSession(currentSession.id)}>Check Session</button>
                    <button className="btn btn-ghost btn-sm btn-danger-text" onClick={() => void endSession(currentSession.id)}>End</button>
                  </div>
                ) : (
                  <button
                    className="btn"
                    disabled={state.sessionStarting || !!pendingSession}
                    onClick={() => void startSession()}
                  >
                    {state.sessionStarting || pendingSession ? 'Starting…' : 'Start Session'}
                  </button>
                )}
              </div>

              {pendingSession?.deviceCode && (
                <div style={{ padding: '12px 16px', marginBottom: 12, borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-soft)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Authentication required</div>
                  <div style={{ marginBottom: 8, fontSize: '0.8125rem' }}>
                    Canvas authoring uses a separate identity. Open the link below and enter the code to sign in.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <a href={pendingSession.deviceCode.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                      {pendingSession.deviceCode.verificationUri}
                    </a>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.1em' }}>
                      {pendingSession.deviceCode.userCode}
                    </span>
                    <CopyButton value={pendingSession.deviceCode.userCode} label="copy code" title="Copy device code" toast={toast} />
                  </div>
                </div>
              )}

              <div className="metrics">
                {[
                  ['App Type', prop(selectedApp, 'properties.appType') || '-'],
                  ['Created', formatDate(prop(selectedApp, 'properties.createdTime'))],
                  ['Modified', formatDate(prop(selectedApp, 'properties.lastModifiedTime'))],
                  ['Published', formatDate(prop(selectedApp, 'properties.lastPublishTime'))],
                  ['App ID', selectedApp.name],
                ].map(([label, value]) => (
                  <div key={String(label)} className="metric">
                    <div className="metric-label">{label}</div>
                    <div className="metric-value copy-inline">
                      <span className="copy-inline-value">{String(value)}</span>
                      <CopyButton value={value} label="copy" title={`Copy ${String(label)}`} toast={toast} />
                    </div>
                  </div>
                ))}
                {currentSession?.result?.cluster && (
                  <div className="metric">
                    <div className="metric-label">Cluster</div>
                    <div className="metric-value">{currentSession.result.cluster.geoName}-il{currentSession.result.cluster.clusterNumber}</div>
                  </div>
                )}
                {currentSession?.result?.session && (
                  <div className="metric">
                    <div className="metric-label">Coauthoring</div>
                    <div className="metric-value">
                      <span className={`health-dot ${currentSession.result.session.isCoauthoringEnabled ? 'ok' : 'error'}`}></span>
                      {currentSession.result.session.isCoauthoringEnabled ? 'Enabled' : 'Not enabled'}
                    </div>
                  </div>
                )}
              </div>

              {currentSession?.result?.session && !currentSession.result.session.isCoauthoringEnabled && (
                <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 6, background: 'var(--warn-soft)', fontSize: '0.8125rem' }}>
                  <strong>Coauthoring is not enabled for this app.</strong> YAML fetch and validate require coauthoring. Enable it in Power Apps Studio under Settings &gt; Upcoming features &gt; Experimental &gt; "Allow other users to co-author alongside me".
                </div>
              )}

              {activeSession && (
                <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {endpoints.map((ep) => (
                      <button
                        key={ep.key}
                        className={`btn ${explorerEndpoint === ep.key ? '' : 'btn-ghost'}`}
                        disabled={explorerLoading}
                        onClick={() => void callEndpoint(ep.key)}
                      >
                        {ep.label}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={yamlDir}
                      onChange={(e) => setYamlDir(e.target.value)}
                      placeholder="YAML directory path"
                      style={{ flex: 1, minWidth: 160, padding: '5px 8px', fontSize: '0.8125rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'inherit' }}
                    />
                    <button
                      className={`btn ${explorerEndpoint === 'yaml-fetch' ? '' : 'btn-ghost'}`}
                      disabled={yamlBusy || !yamlDir.trim()}
                      onClick={() => void fetchYaml()}
                    >
                      {yamlBusy && explorerEndpoint === 'yaml-fetch' ? 'Fetching…' : 'Fetch YAML'}
                    </button>
                    <button
                      className={`btn ${explorerEndpoint === 'yaml-validate' ? '' : 'btn-ghost'}`}
                      disabled={yamlBusy || !yamlDir.trim()}
                      onClick={() => void validateYaml()}
                    >
                      {yamlBusy && explorerEndpoint === 'yaml-validate' ? 'Validating…' : 'Validate YAML'}
                    </button>
                  </div>

                  {explorerLoading && <div className="entity-loading">Loading…</div>}
                  {!explorerLoading && explorerResult && (
                    <CanvasResultView result={explorerResult} endpoint={explorerEndpoint} toast={toast} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function PlatformTab(props: { state: any; setState: React.Dispatch<React.SetStateAction<any>>; environment: string; reload: () => Promise<void>; openConsole: (path: string) => void; toast: (message: string, isError?: boolean) => void }) {
  const { state, setState, reload, openConsole, toast } = props;

  return (
    <>
      <InventorySidebar
        title="Environments"
        countLabel="environments"
        filterPlaceholder="Filter environments…"
        items={state.items}
        filter={state.filter}
        onFilterChange={(next) => setState((current: any) => ({ ...current, filter: next }))}
        matchItem={(item: any, query) => {
          const name = String(prop(item, 'properties.displayName') || item.name || '').toLowerCase();
          const id = String(item.name || '').toLowerCase();
          return name.includes(query) || id.includes(query);
        }}
        isSelected={(item: any) => state.current?.name === item.name}
        itemKey={(item: any) => item.name}
        onSelect={(item: any) => setState((current: any) => ({ ...current, current: item }))}
        onRefresh={() => void reload().then(() => toast('Environments refreshed')).catch((error) => toast(error instanceof Error ? error.message : String(error), true))}
        emptyHint="Select an environment to discover platform environments."
        renderItem={(item: any) => (
          <>
            <div className="entity-item-name">
              <span className={`health-dot ${prop(item, 'properties.states.management.id') === 'Ready' ? 'ok' : 'pending'}`} style={{ marginRight: 6 }}></span>
              {prop(item, 'properties.displayName') || item.name || 'Unnamed'}
            </div>
            <div className="entity-item-logical">{item.name}</div>
          </>
        )}
      />
      <div className="detail-area">
        <div className="panel">
          {!state.current ? (
            <div id="plat-env-detail-empty">
              <EmptyState icon={<Icon name="circle" size={18} />} title="Environment Detail" description="Select an environment from the list to inspect its platform metadata." />
            </div>
          ) : (
            <div id="plat-env-detail">
              <div className="toolbar-row">
                <div>
                  <h2 id="plat-env-title">{prop(state.current, 'properties.displayName') || state.current.name}</h2>
                  <p className="desc no-mb" id="plat-env-subtitle">{state.current.name}</p>
                </div>
                <button className="btn btn-ghost" id="plat-env-open-console" type="button" style={{ fontSize: '0.75rem' }} onClick={() => openConsole(`/environments/${state.current.name}`)}>Open in Console</button>
              </div>
              <div id="plat-env-metrics" className="metrics">
                {[
                  ['SKU', prop(state.current, 'properties.environmentSku') || '-'],
                  ['Location', state.current.location || '-'],
                  ['State', prop(state.current, 'properties.states.management.id') || '-'],
                  ['Default', prop(state.current, 'properties.isDefault') ? 'Yes' : 'No'],
                  ['Created', formatDate(prop(state.current, 'properties.createdTime'))],
                  ['Type', prop(state.current, 'properties.environmentType') || state.current.type || '-'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="metric">
                    <div className="metric-label">{label}</div>
                    <div className="metric-value copy-inline">
                      <span className="copy-inline-value">{String(value)}</span>
                      <CopyButton value={value} label="copy" title={`Copy ${String(label)}`} toast={toast} />
                    </div>
                  </div>
                ))}
              </div>
              <div id="plat-env-linked">
                {prop(state.current, 'properties.linkedEnvironmentMetadata.instanceUrl') ? (
                  <div className="metrics">
                    <div className="metric">
                      <div className="metric-label">Instance URL</div>
                      <div className="metric-value copy-inline">
                        <span className="copy-inline-value">{prop(state.current, 'properties.linkedEnvironmentMetadata.instanceUrl')}</span>
                        <CopyButton value={prop(state.current, 'properties.linkedEnvironmentMetadata.instanceUrl')} label="copy" title="Copy instance URL" toast={toast} />
                      </div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">Domain</div>
                      <div className="metric-value copy-inline">
                        <span className="copy-inline-value">{prop(state.current, 'properties.linkedEnvironmentMetadata.domainName') || '-'}</span>
                        <CopyButton value={prop(state.current, 'properties.linkedEnvironmentMetadata.domainName') || ''} label="copy" title="Copy domain" toast={toast} />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
