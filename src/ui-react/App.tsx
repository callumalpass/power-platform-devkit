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
  optionList,
  prop,
  summarizeError,
} from './utils.js';
import { FetchXmlTab, RelationshipsTab } from './DataversePanels.js';
import { AutomateTab } from './AutomateTab.js';
import { SetupTab } from './SetupTab.js';
import { ResultView } from './ResultView.js';
import { CopyButton } from './CopyButton.js';
import { RecordDetailModal, useRecordDetail } from './RecordDetailModal.js';

type TabName = 'setup' | 'console' | 'dataverse' | 'automate' | 'apps' | 'platform';
type DataverseSubTab = 'dv-explorer' | 'dv-query' | 'dv-fetchxml' | 'dv-relationships';
type ExplorerSubTab = 'metadata' | 'records';

type ToastItem = { id: number; message: string; isError: boolean };

const APIS = [
  {
    key: 'dv', label: 'Dataverse', scope: 'environment',
    defaultPath: '/WhoAmI',
    presets: [
      { label: 'WhoAmI', method: 'GET', path: '/WhoAmI', description: 'Current user identity' },
      { label: 'List Accounts', method: 'GET', path: '/accounts?$top=10&$select=name,accountid', description: 'Account records' },
      { label: 'Entity Metadata', method: 'GET', path: '/EntityDefinitions?$top=10&$select=LogicalName,DisplayName,EntitySetName', description: 'Entity definitions' },
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

  function pushToast(message: string, isError = false) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, message, isError }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, isError ? 5000 : 2500);
  }

  return { toasts, pushToast };
}

function currentTabFromHash(): TabName {
  const hash = window.location.hash.slice(1);
  if (hash === 'setup' || hash === 'console' || hash === 'dataverse' || hash === 'automate' || hash === 'apps' || hash === 'platform') {
    return hash;
  }
  return 'dataverse';
}

export function App() {
  const { toasts, pushToast } = useToasts();
  const [activeTab, setActiveTab] = useState<TabName>(currentTabFromHash());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('pp-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [shellData, setShellData] = useState<any>(null);
  const [globalEnvironment, setGlobalEnvironment] = useState('');
  const [stateLoading, setStateLoading] = useState(true);

  const [consoleSeed, setConsoleSeed] = useState<any | null>(null);

  const [dataverse, setDataverse] = useState({
    entitiesEnvironment: '',
    entities: [] as any[],
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
    setDataverse((current) => ({
      ...current,
      entitiesEnvironment: '',
      entities: [],
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
    if (dataverse.entitiesEnvironment === globalEnvironment && dataverse.entities.length) return;
    void loadEntities();
  }, [activeTab, dataverse.entities.length, dataverse.entitiesEnvironment, globalEnvironment]);

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
      const payload = await api<any>(`/api/dv/entities?environment=${encodeURIComponent(globalEnvironment)}&allowInteractive=false`);
      const entities = payload.data || [];
      setDataverse((current) => ({
        ...current,
        entitiesEnvironment: globalEnvironment,
        entities,
        currentEntity: null,
        currentEntityDetail: null,
        currentEntityDiagnostics: [],
        selectedColumns: [],
        recordPreview: null,
      }));
      pushToast(`Loaded ${entities.length} entities`);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), true);
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

  const meta = useMemo(() => {
    const accountCount = shellData?.accounts?.length || 0;
    const environmentCount = shellData?.environments?.length || 0;
    return `${accountCount} accounts · ${environmentCount} envs`;
  }, [shellData]);

  const environmentUrl = useMemo(() => {
    if (!globalEnvironment || !shellData?.environments) return '';
    const env = shellData.environments.find((e: any) => e.alias === globalEnvironment);
    return env?.url || '';
  }, [globalEnvironment, shellData]);

  return (
    <>
      <div className="toast-container" id="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.isError ? 'error' : 'ok'}`}>
            {toast.message}
          </div>
        ))}
      </div>

      <header className="header">
        <div className="header-inner">
          <span className="logo"><svg width="24" height="24" viewBox="46 43 172 174" aria-label="pp"><mask id="pp-m"><rect x="46" y="43" width="172" height="174" fill="white"/><circle cx="100" cy="88" r="18" fill="black"/><circle cx="164" cy="88" r="18" fill="black"/></mask><g fill="currentColor" mask="url(#pp-m)"><rect x="64" y="52" width="18" height="156" rx="9"/><circle cx="100" cy="88" r="36"/><rect x="128" y="52" width="18" height="156" rx="9"/><circle cx="164" cy="88" r="36"/></g></svg></span>
          <div className="header-env">
            <label>ENV</label>
            <select id="global-environment" style={{ flex: 1 }} value={globalEnvironment} onChange={(event) => setGlobalEnvironment(event.target.value)}>
              {optionList((shellData?.environments || []).map((item: any) => item.alias), 'Select environment').map((option) => (
                <option key={`${option.value}-${option.label}`} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="header-meta" id="meta">{meta}</div>
          <button
            className="theme-toggle"
            id="theme-toggle"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀' : '☽'}
          </button>
        </div>
      </header>

      <nav className="tabs">
        <div className="tabs-inner">
          {(['setup', 'console', 'dataverse', 'automate', 'apps', 'platform'] as TabName[]).map((tabName, index) => (
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

      {stateLoading ? null : null}
    </>
  );
}

function FragmentTab(props: { index: number; tabName: TabName; activeTab: TabName; setActiveTab: (tab: TabName) => void }) {
  const { index, tabName, activeTab, setActiveTab } = props;
  const labels: Record<TabName, string> = {
    setup: 'Setup',
    console: 'Console',
    dataverse: 'Dataverse',
    automate: 'Automate',
    apps: 'Apps',
    platform: 'Platform',
  };
  const needsSep = index === 2;
  return (
    <>
      {needsSep ? <div className="tab-sep"></div> : null}
      <button className={`tab ${activeTab === tabName ? 'active' : ''}`} data-tab={tabName} onClick={() => setActiveTab(tabName)}>
        {labels[tabName]}
      </button>
    </>
  );
}

function ConsoleTab(props: { active: boolean; environment: string; seed: any; clearSeed: () => void; toast: (message: string, isError?: boolean) => void }) {
  const { active, environment, seed, clearSeed, toast } = props;
  const [apiKey, setApiKey] = useState('dv');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/WhoAmI');
  const [queryRows, setQueryRows] = useState([{ key: '', value: '' }]);
  const [headerRows, setHeaderRows] = useState([{ key: '', value: '' }]);
  const [body, setBody] = useState('');
  const [history, setHistory] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('pp-console-history') || '[]'); } catch { return []; }
  });
  const [saved, setSaved] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('pp-console-saved') || '[]'); } catch { return []; }
  });
  const [response, setResponse] = useState<any>({
    status: '',
    elapsed: '',
    body: 'Send a request to see the response.',
    headers: '',
    size: '',
    ok: false,
  });

  const currentApi = APIS.find((item) => item.key === apiKey) || APIS[0];

  useEffect(() => {
    localStorage.setItem('pp-console-history', JSON.stringify(history.slice(0, 50)));
  }, [history]);
  useEffect(() => {
    localStorage.setItem('pp-console-saved', JSON.stringify(saved.slice(0, 30)));
  }, [saved]);

  useEffect(() => {
    if (!seed || !active) return;
    if (seed.api) setApiKey(seed.api);
    if (seed.method) setMethod(seed.method);
    if (seed.path) setPath(seed.path);
    clearSeed();
  }, [active, clearSeed, seed]);

  async function sendRequest() {
    if (!environment) {
      toast('Select an environment first.', true);
      return;
    }
    if (!path.trim()) {
      toast('Enter a request path.', true);
      return;
    }
    const query = Object.fromEntries(queryRows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
    const headers = Object.fromEntries(headerRows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
    let parsedBody: any = undefined;
    if (body.trim() && method !== 'GET' && method !== 'DELETE') {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = body;
      }
    }
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
        }),
      });
      const elapsed = Math.round(performance.now() - started);
      const bodyValue = payload.data?.response;
      const bodyText = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue, null, 2);
      setResponse({
        status: payload.data?.status || 200,
        elapsed: `${elapsed}ms`,
        body: bodyText,
        headers: payload.data?.headers ? Object.entries(payload.data.headers).map(([key, value]) => `${key}: ${value}`).join('\n') : '',
        size: formatBytes(new Blob([bodyText]).size),
        ok: (payload.data?.status || 200) >= 200 && (payload.data?.status || 200) < 300,
      });
      setHistory((current) => [{ api: apiKey, method, path, status: payload.data?.status || 200, elapsed, response: bodyValue }, ...current].slice(0, 50));
    } catch (error) {
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
      setHistory((current) => [{ api: apiKey, method, path, status: 0, elapsed, response: { error: message } }, ...current].slice(0, 50));
      toast(message, true);
    }
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>API Console</h2>
          <select id="console-preset" style={{ maxWidth: 260, fontSize: '0.8125rem' }} onChange={(event) => {
            const preset = currentApi.presets.find((item) => item.label === event.target.value);
            if (!preset) return;
            setMethod(preset.method);
            setPath(preset.path);
            setBody('body' in preset ? String((preset as any).body || '') : '');
          }}>
            <option value="">Presets…</option>
            {currentApi.presets.map((preset) => <option key={preset.label} value={preset.label}>{preset.label} — {preset.description}</option>)}
          </select>
        </div>
        <div className="console-bar">
          <select id="console-api" value={apiKey} onChange={(event) => {
            const nextApi = APIS.find((item) => item.key === event.target.value) || APIS[0];
            setApiKey(nextApi.key);
            setPath(nextApi.defaultPath);
          }}>
            {APIS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select id="console-method" value={method} onChange={(event) => setMethod(event.target.value)} style={{ color: METHOD_COLORS[method] || 'var(--ink)' }}>
            {METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input type="text" id="console-path" placeholder="/WhoAmI" value={path} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void sendRequest(); } }} />
          <CopyButton value={`${method} ${path}`} label="Copy" title="Copy request line" toast={toast} />
          <button className="btn btn-primary" id="console-send" onClick={() => void sendRequest()}>Send</button>
        </div>
        <div className="console-scope-hint" id="console-scope-hint">
          {currentApi.scope === 'account'
            ? <><span className="console-scope-badge account">account-scoped</span> Uses environment’s account for auth, requests go to {currentApi.label} endpoints</>
            : <><span className="console-scope-badge env">environment-scoped</span> Requests go through the selected environment</>}
        </div>
        <div className="console-sections">
          <details>
            <summary>Query Parameters</summary>
            <div className="section-body">
              <div id="console-query-params" className="kv-list">
                {queryRows.map((row, index) => (
                  <div key={index} className="kv-row">
                    <input placeholder="key" value={row.key} onChange={(event) => setQueryRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} />
                    <input placeholder="value" value={row.value} onChange={(event) => setQueryRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
                    <button type="button" className="condition-remove" onClick={() => setQueryRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                  </div>
                ))}
              </div>
              <button className="btn btn-ghost" id="console-add-query-param" type="button" style={{ marginTop: 6, padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setQueryRows((current) => [...current, { key: '', value: '' }])}>+ Add parameter</button>
            </div>
          </details>
          <details>
            <summary>Headers</summary>
            <div className="section-body">
              <div id="console-headers" className="kv-list">
                {headerRows.map((row, index) => (
                  <div key={index} className="kv-row">
                    <input placeholder="key" value={row.key} onChange={(event) => setHeaderRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} />
                    <input placeholder="value" value={row.value} onChange={(event) => setHeaderRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
                    <button type="button" className="condition-remove" onClick={() => setHeaderRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                  </div>
                ))}
              </div>
              <button className="btn btn-ghost" id="console-add-header" type="button" style={{ marginTop: 6, padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setHeaderRows((current) => [...current, { key: '', value: '' }])}>+ Add header</button>
            </div>
          </details>
          {method !== 'GET' && method !== 'DELETE' ? (
            <details id="console-body-section" open>
              <summary>Request Body</summary>
              <div className="section-body">
                <textarea id="console-body" rows={8} placeholder='{ "key": "value" }' value={body} onChange={(event) => setBody(event.target.value)}></textarea>
              </div>
            </details>
          ) : null}
        </div>
      </div>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2>Response <span id="console-response-status" className={`console-status-badge ${response.ok ? 'success' : response.status === 'ERR' ? 'error' : ''}`} style={{ marginLeft: 8 }}>{response.status}</span></h2>
          <span id="console-response-time" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{response.elapsed}</span>
        </div>
        {response.headers ? (
          <details style={{ marginBottom: 8 }} open>
            <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--muted)' }}>Response Headers</summary>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <CopyButton value={response.headers} label="Copy headers" title="Copy response headers" toast={toast} />
            </div>
            <pre className="viewer" id="console-response-headers-body" style={{ minHeight: 40, marginTop: 6 }}>{response.headers}</pre>
          </details>
        ) : null}
        <div className="response-toolbar">
          <div className="response-meta">
            <span id="console-response-size" className="response-size">{response.size}</span>
          </div>
          <CopyButton value={response.body} label="Copy response" title="Copy response body" toast={toast} className="btn btn-ghost" />
        </div>
        <pre className="viewer" id="console-response-body" dangerouslySetInnerHTML={{ __html: highlightJson(response.body) }}></pre>
      </div>
      {saved.length ? (
        <div className="panel" id="console-saved-panel">
          <h2 style={{ marginBottom: 12 }}>Saved Requests</h2>
          <div id="console-saved" className="card-list">
            {saved.map((entry, index) => (
              <div key={index} className="saved-item" onClick={() => { setApiKey(entry.api); setMethod(entry.method); setPath(entry.path); }}>
                <div className="saved-item-main">
                  <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                  <span className="saved-item-name">{entry.path}</span>
                  <CopyButton value={`${entry.method} ${entry.path}`} label="Copy" title="Copy saved request" toast={toast} stopPropagation />
                  <span className="history-api">{entry.api}</span>
                </div>
                <button className="pin-btn pinned" onClick={(event) => {
                  event.stopPropagation();
                  setSaved((current) => current.filter((_, itemIndex) => itemIndex !== index));
                }}>✖</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="panel">
        <h2 style={{ marginBottom: 12 }}>History</h2>
        <div id="console-history" className="card-list">
          {history.length ? history.slice(0, 20).map((entry, index) => {
            const pinned = saved.some((item) => item.api === entry.api && item.method === entry.method && item.path === entry.path);
            return (
              <div key={index} className="history-item" onClick={() => { setApiKey(entry.api); setMethod(entry.method); setPath(entry.path); }}>
                <div className="history-item-main">
                  <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                  <span className="history-path">{entry.path}</span>
                </div>
                <div className="history-item-meta">
                  <span className={`console-status-badge small ${entry.status >= 200 && entry.status < 300 ? 'success' : entry.status >= 400 ? 'error' : ''}`}>{entry.status || 'ERR'}</span>
                  <span className="history-time">{entry.elapsed}ms</span>
                  <span className="history-api">{entry.api}</span>
                  <button className={`pin-btn ${pinned ? 'pinned' : ''}`} onClick={(event) => {
                    event.stopPropagation();
                    setSaved((current) => {
                      const existingIndex = current.findIndex((item) => item.api === entry.api && item.method === entry.method && item.path === entry.path);
                      if (existingIndex >= 0) return current.filter((_, itemIndex) => itemIndex !== existingIndex);
                      return [{ api: entry.api, method: entry.method, path: entry.path }, ...current];
                    });
                  }}>☆</button>
                </div>
              </div>
            );
          }) : <div className="empty">No requests yet.</div>}
        </div>
      </div>
    </>
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
              <button className="btn btn-secondary" type="button" onClick={() => void searchLookup(attr, selectedTarget)} disabled={lookupState.loading} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
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
            <button className="btn btn-ghost" type="button" onClick={onClose} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => void handleSubmit()} disabled={saving} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
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
  loadEntityDetail: (logicalName: string) => Promise<void>;
  loadRecordPreview: () => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { dataverse, setDataverse, environment, environmentUrl, loadEntityDetail, loadRecordPreview, toast } = props;
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
              return (
                <div key={entity.logicalName} className={`entity-item ${dataverse.currentEntity?.logicalName === entity.logicalName ? 'active' : ''}`} data-entity={entity.logicalName} onClick={() => void loadEntityDetail(entity.logicalName)}>
                  <div className="entity-item-name">{entity.displayName || entity.logicalName}</div>
                  <div className="entity-item-logical">{entity.logicalName}</div>
                  <div className="entity-item-badges">
                    {entity.entitySetName ? <span className="entity-item-set">{entity.entitySetName}</span> : null}
                    {flags}
                  </div>
                </div>
              );
            }) : <div className="entity-loading">Select an environment to load entities.</div>}
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
                <h2>Entity Detail</h2>
                <p className="desc">Select an entity from the list to inspect its metadata and preview records.</p>
                <div className="empty">No entity selected.</div>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h2>Record Preview</h2>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => setShowCreateRecord(true)}>Add Record</button>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
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
  const filtered = state.filter
    ? state.items.filter((item: any) => {
        const name = prop(item, 'properties.displayName') || item.name || '';
        return String(name).toLowerCase().includes(state.filter.toLowerCase());
      })
    : state.items;

  return (
    <>
      <div className="inventory-sidebar">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2>Apps</h2>
            <button className="btn btn-ghost" id="app-refresh" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void reload().then(() => toast('Apps refreshed')).catch((error) => toast(error instanceof Error ? error.message : String(error), true))}>Refresh</button>
          </div>
          <input type="text" id="app-filter" className="entity-filter" placeholder="Filter apps…" value={state.filter} onChange={(event) => setState((current: any) => ({ ...current, filter: event.target.value }))} />
          <div id="app-count" className="entity-count">{state.items.length ? `${state.items.length} apps` : ''}</div>
          <div id="app-list" className="entity-list">
            {state.items.length ? filtered.map((item: any) => (
              <div key={item.name} className={`entity-item ${state.current?.name === item.name ? 'active' : ''}`} data-app={item.name} onClick={() => setState((current: any) => ({ ...current, current: item }))}>
                <div className="entity-item-name">{prop(item, 'properties.displayName') || item.name || 'Unnamed'}</div>
                <div className="entity-item-logical">{item.name}</div>
                {prop(item, 'properties.appType') ? <div className="entity-item-badges"><span className="entity-item-flag">{String(prop(item, 'properties.appType')).replace(/([a-z])([A-Z])/g, '$1 $2')}</span></div> : null}
              </div>
            )) : <div className="entity-loading">Select an environment to load apps.</div>}
          </div>
        </div>
      </div>
      <div className="detail-area">
        <div className="panel">
          {!state.current ? (
            <div id="app-detail-empty">
              <h2>App Detail</h2>
              <p className="desc">Select an app from the list to inspect its metadata and connections.</p>
              <div className="empty">No app selected.</div>
            </div>
          ) : (
            <div id="app-detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h2 id="app-title">{prop(state.current, 'properties.displayName') || state.current.name}</h2>
                  <p className="desc" id="app-subtitle" style={{ marginBottom: 0 }}>{prop(state.current, 'properties.description') || state.current.name}</p>
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

function PlatformTab(props: { state: any; setState: React.Dispatch<React.SetStateAction<any>>; environment: string; reload: () => Promise<void>; openConsole: (path: string) => void; toast: (message: string, isError?: boolean) => void }) {
  const { state, setState, reload, openConsole, toast } = props;
  const filtered = state.filter
    ? state.items.filter((item: any) => {
        const name = prop(item, 'properties.displayName') || item.name || '';
        return String(name).toLowerCase().includes(state.filter.toLowerCase()) || String(item.name || '').toLowerCase().includes(state.filter.toLowerCase());
      })
    : state.items;

  return (
    <>
      <div className="inventory-sidebar">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2>Environments</h2>
            <button className="btn btn-ghost" id="plat-env-refresh" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void reload().then(() => toast('Environments refreshed')).catch((error) => toast(error instanceof Error ? error.message : String(error), true))}>Refresh</button>
          </div>
          <input type="text" id="plat-env-filter" className="entity-filter" placeholder="Filter environments…" value={state.filter} onChange={(event) => setState((current: any) => ({ ...current, filter: event.target.value }))} />
          <div id="plat-env-count" className="entity-count">{state.items.length ? `${state.items.length} environments` : ''}</div>
          <div id="plat-env-list" className="entity-list">
            {state.items.length ? filtered.map((item: any) => (
              <div key={item.name} className={`entity-item ${state.current?.name === item.name ? 'active' : ''}`} data-plat-env={item.name} onClick={() => setState((current: any) => ({ ...current, current: item }))}>
                <div className="entity-item-name"><span className={`health-dot ${prop(item, 'properties.states.management.id') === 'Ready' ? 'ok' : 'pending'}`} style={{ marginRight: 6 }}></span>{prop(item, 'properties.displayName') || item.name || 'Unnamed'}</div>
                <div className="entity-item-logical">{item.name}</div>
              </div>
            )) : <div className="entity-loading">Select an environment to discover platform environments.</div>}
          </div>
        </div>
      </div>
      <div className="detail-area">
        <div className="panel">
          {!state.current ? (
            <div id="plat-env-detail-empty">
              <h2>Environment Detail</h2>
              <p className="desc">Select an environment from the list to inspect its platform metadata.</p>
              <div className="empty">No environment selected.</div>
            </div>
          ) : (
            <div id="plat-env-detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h2 id="plat-env-title">{prop(state.current, 'properties.displayName') || state.current.name}</h2>
                  <p className="desc" id="plat-env-subtitle" style={{ marginBottom: 0 }}>{state.current.name}</p>
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
