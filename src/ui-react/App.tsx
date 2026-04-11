import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  esc,
  formDataObject,
  formatBytes,
  formatDate,
  formatDateShort,
  formatTimeRemaining,
  getDefaultSelectedColumns,
  getSelectableAttributes,
  highlightJson,
  optionList,
  prop,
  renderResultTable,
  summarizeError,
} from './utils.js';
import { FetchXmlTab, RelationshipsTab } from './DataversePanels.js';
import { AutomateTab } from './AutomateTab.js';

type TabName = 'setup' | 'console' | 'dataverse' | 'automate' | 'apps' | 'platform';
type DataverseSubTab = 'dv-explorer' | 'dv-query' | 'dv-fetchxml' | 'dv-relationships';
type ExplorerSubTab = 'metadata' | 'records';

type ToastItem = { id: number; message: string; isError: boolean };

const HEALTH_APIS = ['dv', 'flow', 'graph', 'bap', 'powerapps'] as const;

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
    selectedColumns: [] as string[],
    recordPreview: null as any,
    entityFilter: '',
    attrFilter: '',
    explorerSubTab: 'metadata' as ExplorerSubTab,
    dvSubTab: 'dv-explorer' as DataverseSubTab,
    queryPreview: 'Preview a Dataverse path here.',
    queryResult: null as any,
    queryResultView: 'table' as 'table' | 'json',
    recordPreviewView: 'table' as 'table' | 'json',
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
        body: JSON.stringify({ environment: globalEnvironment, api: 'powerapps', method: 'GET', path: '/apps', allowInteractive: false }),
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
        body: JSON.stringify({ environment: globalEnvironment, api: 'bap', method: 'GET', path: '/environments', allowInteractive: false }),
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
          <span className="logo">pp</span>
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

function SetupTab(props: { shellData: any; globalEnvironment: string; refreshState: (silent?: boolean) => Promise<void>; toast: (message: string, isError?: boolean) => void }) {
  const { shellData, globalEnvironment, refreshState, toast } = props;
  const [accountKind, setAccountKind] = useState('user');
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<Record<string, any>>({});
  const [health, setHealth] = useState<Record<string, Record<string, any>>>({});
  const [discoveries, setDiscoveries] = useState<any[]>([]);
  const [loginTargets, setLoginTargets] = useState<any[]>([]);
  const [deviceCode, setDeviceCode] = useState<any>(null);
  const [activeLoginJobId, setActiveLoginJobId] = useState<string | null>(null);
  const [selectedApis, setSelectedApis] = useState<Record<string, boolean>>({
    dv: true,
    flow: true,
    powerapps: true,
    graph: false,
  });
  const [environmentDraft, setEnvironmentDraft] = useState({
    alias: '',
    account: '',
    url: '',
    displayName: '',
    accessMode: '',
  });

  const accountFormRef = useRef<HTMLFormElement | null>(null);
  const environmentFormRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!shellData) return;
    const accounts = shellData.accounts || [];
    const environments = shellData.environments || [];
    if (!environmentDraft.account && accounts[0]?.name) {
      setEnvironmentDraft((current) => ({ ...current, account: accounts[0].name }));
    }
    void checkTokenStatuses(accounts);
    void checkHealth(environments);
  }, [shellData]);

  async function checkTokenStatuses(accounts: any[]) {
    await Promise.all(accounts.map(async (account) => {
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

  async function checkHealth(environments: any[]) {
    for (const environment of environments) {
      for (const apiName of HEALTH_APIS) {
        setHealth((current) => ({
          ...current,
          [environment.alias]: {
            ...(current[environment.alias] || {}),
            [apiName]: { status: 'pending', summary: 'Checking…' },
          },
        }));
        try {
          const response = await fetch('/api/checks/ping', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ environment: environment.alias, api: apiName }),
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

  async function waitForLoginJob(jobId: string) {
    let parseFailures = 0;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        headers: { 'content-type': 'application/json' },
      });
      const text = await response.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        parseFailures += 1;
        const snippet = text.length > 240 ? `${text.slice(0, 240)}…` : text;
        if (parseFailures >= 2) {
          throw new Error(`Invalid JSON while polling login job (${response.status}): ${(error as Error).message}${snippet ? `. Response starts with: ${snippet}` : ''}`);
        }
        continue;
      }
      parseFailures = 0;
      const job = payload.data;
      if (job?.metadata?.loginTargets && Array.isArray(job.metadata.loginTargets)) {
        setLoginTargets(job.metadata.loginTargets);
      }
      if (job?.metadata?.deviceCode && typeof job.metadata.deviceCode === 'object') {
        setDeviceCode(job.metadata.deviceCode);
      }
      if (!job || job.status === 'pending') continue;
      if (job.status === 'cancelled') throw new Error('Login cancelled.');
      if (job.result?.success === false) throw new Error(summarizeError(job.result));
      return job.result;
    }
  }

  async function handleAddAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const interactive = accountKind === 'user' || accountKind === 'device-code';
    try {
      const started = await api<any>('/api/jobs/account-login', {
        method: 'POST',
        body: JSON.stringify({
          ...formDataObject(form),
          environmentAlias: globalEnvironment || undefined,
          excludeApis: ['dv', 'flow', 'powerapps', 'graph'].filter((name) => !selectedApis[name]),
        }),
      });
      setActiveLoginJobId(started.data.id);
      setLoginTargets(started.data.metadata?.loginTargets || []);
      const result = await waitForLoginJob(started.data.id);
      form.reset();
      setAccountKind('user');
      if (result?.data?.expiresAt) toast('Account saved and authenticated');
      else toast('Account saved but login may not have completed', true);
      await refreshState(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setActiveLoginJobId(null);
      setLoginTargets([]);
      setDeviceCode(null);
    }
  }

  async function handleCancelLogin() {
    if (!activeLoginJobId) return;
    await fetch(`/api/jobs/${encodeURIComponent(activeLoginJobId)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    });
    setActiveLoginJobId(null);
    setLoginTargets([]);
    setDeviceCode(null);
    toast('Pending login cancelled', true);
  }

  async function handleEnvironmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api('/api/environments', {
        method: 'POST',
        body: JSON.stringify(environmentDraft),
      });
      setEnvironmentDraft({ alias: '', account: shellData?.accounts?.[0]?.name || '', url: '', displayName: '', accessMode: '' });
      setDiscoveries([]);
      toast('Environment added');
      await refreshState(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function handleDiscover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const payload = await api<any>('/api/environments/discover', {
        method: 'POST',
        body: JSON.stringify(formDataObject(form)),
      });
      setDiscoveries(payload.data || []);
      toast(`${(payload.data || []).length} environment${(payload.data || []).length === 1 ? '' : 's'} found`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  const accounts = shellData?.accounts || [];
  const environments = shellData?.environments || [];

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>Accounts</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" id="refresh-state" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void refreshState(false)}>Refresh</button>
          </div>
        </div>
        <div className="card-list" id="accounts-list">
          {accounts.length ? accounts.map((account: any) => {
            const interactive = account.kind === 'user' || account.kind === 'device-code';
            const token = tokenStatus[account.name];
            const tokenClass = token === undefined ? 'pending' : token?.authenticated ? 'ok' : 'error';
            const expiry = token?.authenticated ? formatTimeRemaining(token.expiresAt) : null;
            return (
              <div key={account.name} className={`account-card ${expandedAccount === account.name ? 'expanded' : ''}`} data-account-card={account.name}>
                <div className="account-card-head" data-toggle-account={account.name} onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  setExpandedAccount((current) => current === account.name ? null : account.name);
                }}>
                  <div className="account-card-identity">
                    <span id={`token-dot-${account.name}`}><span className={`health-dot ${tokenClass}`}></span></span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="account-card-name">{account.name}</span>
                        <span className="badge">{account.kind}</span>
                      </div>
                      {account.accountUsername || account.loginHint ? (
                        <div className="account-card-email">{account.accountUsername || account.loginHint}</div>
                      ) : null}
                      <div id={`token-expiry-${account.name}`}>{expiry ? <span className={`token-expiry ${expiry.cls || ''}`}>{expiry.text}</span> : null}</div>
                    </div>
                  </div>
                  <div className="account-card-actions">
                    {interactive ? (
                      <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={async () => {
                        try {
                          const started = await api<any>('/api/jobs/account-login', {
                            method: 'POST',
                            body: JSON.stringify({
                              name: account.name,
                              kind: 'user',
                              environmentAlias: globalEnvironment || undefined,
                              excludeApis: ['dv', 'flow', 'powerapps', 'graph'].filter((name) => !selectedApis[name]),
                            }),
                          });
                          setActiveLoginJobId(started.data.id);
                          setLoginTargets(started.data.metadata?.loginTargets || []);
                          await waitForLoginJob(started.data.id);
                          await refreshState(true);
                          toast(`${account.name} authenticated`);
                        } catch (error) {
                          toast(error instanceof Error ? error.message : String(error), true);
                        } finally {
                          setActiveLoginJobId(null);
                          setLoginTargets([]);
                          setDeviceCode(null);
                        }
                      }}>Login</button>
                    ) : null}
                    <button className="btn btn-danger" type="button" onClick={async () => {
                      if (!confirm(`Remove account "${account.name}"?`)) return;
                      try {
                        await api(`/api/accounts/${encodeURIComponent(account.name)}`, { method: 'DELETE' });
                        toast('Account removed');
                        await refreshState(true);
                      } catch (error) {
                        toast(error instanceof Error ? error.message : String(error), true);
                      }
                    }}>Remove</button>
                  </div>
                </div>
                <div className="account-card-body">
                  <form data-edit-account={account.name} onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                      await api(`/api/accounts/${encodeURIComponent(account.name)}`, {
                        method: 'PUT',
                        body: JSON.stringify(formDataObject(event.currentTarget)),
                      });
                      toast('Account updated');
                      await refreshState(true);
                    } catch (error) {
                      toast(error instanceof Error ? error.message : String(error), true);
                    }
                  }}>
                    <input type="hidden" name="name" defaultValue={account.name} />
                    <input type="hidden" name="kind" defaultValue={account.kind} />
                    <div className="form-row">
                      <div className="field"><span className="field-label">Description</span><input name="description" defaultValue={account.description || ''} placeholder="Optional" /></div>
                      <div className="field"><span className="field-label">Login Hint</span><input name="loginHint" defaultValue={account.loginHint || ''} placeholder="user@example.com" /></div>
                    </div>
                    <div className="form-row">
                      <div className="field"><span className="field-label">Tenant ID</span><input name="tenantId" defaultValue={account.tenantId || ''} /></div>
                      <div className="field"><span className="field-label">Client ID</span><input name="clientId" defaultValue={account.clientId || ''} /></div>
                    </div>
                    <div className="btn-group"><button type="submit" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 12px' }}>Save Changes</button></div>
                  </form>
                </div>
              </div>
            );
          }) : <div className="empty">No accounts configured.</div>}
        </div>

        {(activeLoginJobId || loginTargets.length || deviceCode) ? (
          <div id="login-link-panel" className="login-link-panel" style={{ marginTop: 14 }}>
            <div className="login-link-head">
              <span className="field-label">Authentication Links</span>
              <button type="button" className="btn btn-ghost" id="login-link-copy" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => {
                const links = loginTargets.filter((target) => target.url).map((target) => `${target.label || target.api || target.resource}: ${target.url}`);
                void navigator.clipboard.writeText(links.join('\n')).then(() => toast('Copied login URLs'));
              }}>Copy URLs</button>
            </div>
            <div id="login-link-status" className="login-link-status">
              {loginTargets.find((target) => target.status === 'running')
                ? 'Follow the current link, then continue through the remaining API logins below.'
                : loginTargets.filter((target) => target.url).length
                  ? 'Authentication links captured for this login session.'
                  : 'Waiting for the identity provider to return sign-in links…'}
            </div>
            {deviceCode ? (
              <div id="device-code-panel">
                <div className="device-code-card">
                  <div className="device-code-instruction">Go to the following URL and enter the code to sign in:</div>
                  <div className="device-code-url-row">
                    <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer" className="device-code-url">{deviceCode.verificationUri}</a>
                    <button type="button" className="btn btn-ghost device-code-open-btn" onClick={() => window.open(deviceCode.verificationUri, '_blank', 'noreferrer')}>Open</button>
                  </div>
                  <div className="device-code-box">
                    <span className="device-code-label">Your code</span>
                    <span className="device-code-value" id="device-code-value">{deviceCode.userCode}</span>
                    <button type="button" className="btn btn-ghost" id="device-code-copy" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void navigator.clipboard.writeText(deviceCode.userCode).then(() => toast('Code copied'))}>Copy</button>
                  </div>
                </div>
              </div>
            ) : null}
            <div id="login-link-targets" style={{ display: 'grid', gap: 8 }}>
              {loginTargets.map((target, index) => {
                const tone = target.status === 'completed' ? 'ok' : target.status === 'running' ? 'pending' : 'error';
                const statusLabel = target.status === 'completed' ? 'completed' : target.status === 'running' ? (target.url ? 'action required' : 'waiting') : 'pending';
                return (
                  <div key={`${target.resource || target.api || index}`} className={`login-target ${target.status === 'running' && target.url ? 'active' : ''}`}>
                    <div className="login-target-head">
                      <div className="login-target-head-left">
                        <span className={`health-dot ${tone}`}></span>
                        <strong>{target.label || target.api || target.resource}</strong>
                      </div>
                      <span className={`login-target-status ${target.status === 'completed' ? 'completed' : target.status === 'running' ? 'running' : 'pending'}`}>{statusLabel}</span>
                    </div>
                    {target.url ? <a href={target.url} target="_blank" rel="noreferrer" className="login-target-url">{target.url}</a> : <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Waiting…</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <details className="setup-add-section" id="add-account-section">
          <summary className="setup-add-trigger">+ Add account</summary>
          <div className="setup-add-body">
            <form id="account-form" ref={accountFormRef} onSubmit={handleAddAccount}>
              <div className="form-row">
                <div className="field"><span className="field-label">Name</span><input name="name" required placeholder="my-work-account" /></div>
                <div className="field"><span className="field-label">Kind</span>
                  <select name="kind" id="account-kind" value={accountKind} onChange={(event) => setAccountKind(event.target.value)}>
                    <option value="user">user</option>
                    <option value="device-code">device-code</option>
                    <option value="client-secret">client-secret</option>
                    <option value="environment-token">environment-token</option>
                    <option value="static-token">static-token</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="field"><span className="field-label">Description</span><input name="description" placeholder="Optional" /></div>
                {(accountKind === 'user' || accountKind === 'device-code') ? (
                  <div className="field"><span className="field-label">Preferred Flow</span><select name="preferredFlow"><option value="interactive">interactive</option><option value="device-code">device-code</option></select></div>
                ) : <div className="field"></div>}
              </div>
              {(accountKind === 'user' || accountKind === 'device-code' || accountKind === 'client-secret') ? (
                <div className="form-row">
                  <div className="field"><span className="field-label">Tenant ID</span><input name="tenantId" placeholder="defaults to common" /></div>
                  <div className="field"><span className="field-label">Client ID</span><input name="clientId" placeholder="defaults to built-in app" /></div>
                </div>
              ) : null}
              {(accountKind === 'user' || accountKind === 'device-code') ? (
                <>
                  <div className="form-row">
                    <div className="field"><span className="field-label">Login Hint</span><input name="loginHint" placeholder="user@example.com" /></div>
                    <div className="field"><span className="field-label">Prompt</span><select name="prompt"><option value="">default</option><option value="select_account">select_account</option><option value="login">login</option><option value="consent">consent</option><option value="none">none</option></select></div>
                  </div>
                  <div className="check-row"><input type="checkbox" name="forcePrompt" id="forcePrompt" /><label htmlFor="forcePrompt">Force prompt on next login</label></div>
                  {accountKind === 'user' ? <div className="check-row"><input type="checkbox" name="fallbackToDeviceCode" id="fallbackToDeviceCode" /><label htmlFor="fallbackToDeviceCode">Allow fallback to device code</label></div> : null}
                </>
              ) : null}
              {accountKind === 'client-secret' ? <div className="field"><span className="field-label">Client Secret Env Var</span><input name="clientSecretEnv" placeholder="MY_CLIENT_SECRET" /></div> : null}
              {accountKind === 'environment-token' ? <div className="field"><span className="field-label">Token Env Var</span><input name="environmentVariable" placeholder="MY_TOKEN_VAR" /></div> : null}
              {accountKind === 'static-token' ? <div className="field"><span className="field-label">Static Token</span><textarea name="token" placeholder="Paste token"></textarea></div> : null}
              {(accountKind === 'user' || accountKind === 'device-code') ? (
                <div className="field">
                  <span className="field-label">API Scopes to Authenticate</span>
                  <div className="api-scope-checks" id="api-scope-checks">
                    {(['dv', 'flow', 'powerapps', 'graph'] as const).map((scope) => (
                      <label key={scope} className="api-scope-check">
                        <input
                          type="checkbox"
                          value={scope}
                          checked={selectedApis[scope]}
                          onChange={(event) => setSelectedApis((current) => ({ ...current, [scope]: event.target.checked }))}
                        />
                        {scope === 'powerapps' ? 'Power Apps & BAP' : scope === 'dv' ? 'Dataverse' : scope === 'flow' ? 'Flow' : 'Graph'}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="btn-group">
                <button type="submit" className="btn btn-primary" id="account-submit">Save & Login</button>
                <button type="button" className={`btn btn-danger ${activeLoginJobId ? '' : 'hidden'}`} id="account-cancel" onClick={() => void handleCancelLogin()}>Cancel Pending Login</button>
              </div>
            </form>
          </div>
        </details>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>Environments</h2>
          <button className="btn btn-ghost" id="recheck-health" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => {
            void checkHealth(environments);
            void checkTokenStatuses(accounts);
            toast('Health checks started');
          }}>Re-check health</button>
        </div>
        <div className="card-list" id="environments-list">
          {environments.length ? environments.map((environment: any) => {
            const envHealth = health[environment.alias] || {};
            const accountInfo = tokenStatus[environment.account];
            const accountClass = accountInfo === undefined ? 'pending' : accountInfo?.authenticated ? 'ok' : 'error';
            const accountExpiry = accountInfo?.authenticated ? formatTimeRemaining(accountInfo.expiresAt) : null;
            return (
              <div key={environment.alias} className="env-card">
                <div className="env-card-head">
                  <div>
                    <div className="env-card-title">{environment.alias}{environment.displayName && environment.displayName !== environment.alias ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> {environment.displayName}</span> : null}</div>
                    <div className="env-card-url">{environment.url || ''}</div>
                    <div className="env-card-account"><span className={`health-dot ${accountClass}`}></span> {environment.account}{accountExpiry ? <span className={`token-expiry ${accountExpiry.cls || ''}`}> {accountExpiry.text}</span> : null}</div>
                  </div>
                  <button className="btn btn-danger" type="button" onClick={async () => {
                    if (!confirm(`Remove environment "${environment.alias}"?`)) return;
                    try {
                      await api(`/api/environments/${encodeURIComponent(environment.alias)}`, { method: 'DELETE' });
                      toast('Environment removed');
                      await refreshState(true);
                    } catch (error) {
                      toast(error instanceof Error ? error.message : String(error), true);
                    }
                  }}>Remove</button>
                </div>
                <div className="health-row" id={`health-${environment.alias}`}>
                  {HEALTH_APIS.map((apiName) => {
                    const state = envHealth[apiName];
                    const cls = !state || state.status === 'pending' ? 'pending' : state.status === 'ok' ? 'ok' : 'error';
                    return (
                      <button key={apiName} className="health-item health-item-btn" type="button" title={`${apiName}: ${state?.summary || 'Checking…'}`}>
                        <span className={`health-dot ${cls}`}></span>{apiName}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }) : <div className="empty">No environments configured.</div>}
        </div>
        <details className="setup-add-section">
          <summary className="setup-add-trigger">+ Add environment</summary>
          <div className="setup-add-body">
            <form id="discover-form" style={{ marginBottom: 16 }} onSubmit={handleDiscover}>
              <div className="form-row">
                <div className="field"><span className="field-label">Account</span><select name="account" id="discover-account">{optionList(accounts.map((account: any) => account.name), 'select account').map((option) => <option key={`${option.value}-${option.label}`} value={option.value}>{option.label}</option>)}</select></div>
                <div className="field" style={{ alignSelf: 'end' }}><button type="submit" className="btn btn-secondary" id="discover-submit">Discover</button></div>
              </div>
            </form>
            <div className="card-list" id="discovered-list" style={{ marginBottom: 16 }}>
              {discoveries.length ? discoveries.map((item, index) => (
                <div key={index} className="card-item">
                  <div className="card-item-info"><div className="card-item-title">{item.displayName || item.makerEnvironmentId || 'environment'}</div><div className="card-item-sub">{item.environmentApiUrl || item.environmentUrl || ''}</div></div>
                  <button className="btn btn-ghost" type="button" onClick={() => {
                    setEnvironmentDraft({
                      alias: item.displayName ? item.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : item.makerEnvironmentId || '',
                      account: item.accountName || '',
                      url: item.environmentApiUrl || item.environmentUrl || '',
                      displayName: item.displayName || '',
                      accessMode: '',
                    });
                  }}>Use</button>
                </div>
              )) : null}
            </div>
            <form id="environment-form" ref={environmentFormRef} onSubmit={handleEnvironmentSubmit}>
              <div className="form-row">
                <div className="field"><span className="field-label">Alias</span><input name="alias" required placeholder="dev, prod" value={environmentDraft.alias} onChange={(event) => setEnvironmentDraft((current) => ({ ...current, alias: event.target.value }))} /></div>
                <div className="field"><span className="field-label">Account</span><select name="account" id="environment-account" value={environmentDraft.account} onChange={(event) => setEnvironmentDraft((current) => ({ ...current, account: event.target.value }))}>{accounts.map((account: any) => <option key={account.name} value={account.name}>{account.name}</option>)}</select></div>
              </div>
              <div className="form-row">
                <div className="field"><span className="field-label">URL</span><input name="url" required placeholder="https://org.crm.dynamics.com" value={environmentDraft.url} onChange={(event) => setEnvironmentDraft((current) => ({ ...current, url: event.target.value }))} /></div>
                <div className="field"><span className="field-label">Display Name</span><input name="displayName" placeholder="Optional" value={environmentDraft.displayName} onChange={(event) => setEnvironmentDraft((current) => ({ ...current, displayName: event.target.value }))} /></div>
              </div>
              <div className="field"><span className="field-label">Access</span><select name="accessMode" value={environmentDraft.accessMode} onChange={(event) => setEnvironmentDraft((current) => ({ ...current, accessMode: event.target.value }))}><option value="">read-write (default)</option><option value="read-write">read-write</option><option value="read-only">read-only</option></select></div>
              <div className="btn-group"><button type="submit" className="btn btn-primary" id="env-submit">Discover & Save</button></div>
            </form>
          </div>
        </details>
      </div>

      <details className="setup-add-section" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', padding: 0 }}>
        <summary className="setup-add-trigger" style={{ padding: '16px 20px' }}>MCP Server</summary>
        <div style={{ padding: '0 20px 20px' }}>
          <p className="desc">The MCP server uses stdio transport. Launch it from your MCP client.</p>
          {shellData?.mcp ? (
            <div id="mcp-content">
              <div style={{ marginBottom: 12 }}><span className="field-label">Launch Command</span></div>
              <div className="mcp-cmd-wrap"><div className="mcp-cmd" id="mcp-cmd">{shellData.mcp.launchCommand}</div><button className="mcp-copy" id="mcp-copy-btn" onClick={() => void navigator.clipboard.writeText(shellData.mcp.launchCommand).then(() => toast('Copied to clipboard'))}>Copy</button></div>
              <div style={{ marginBottom: 8 }}><span className="field-label">Available Tools ({shellData.mcp.tools.length})</span></div>
              <div className="tool-grid">{shellData.mcp.tools.map((tool: string) => <code key={tool}>{tool}</code>)}</div>
            </div>
          ) : null}
        </div>
      </details>
    </>
  );
}

function summarizeHealthFailure(payload: any) {
  const diagnostic = Array.isArray(payload?.diagnostics) ? payload.diagnostics[0] : null;
  const message = diagnostic?.message || 'Health check failed';
  const detail = diagnostic?.detail || '';
  const summary = /Interactive authentication is disabled/i.test(message)
    ? 'Needs login for this API'
    : /returned 401/i.test(message) || /returned 403/i.test(message)
      ? 'Permission or consent required'
      : /returned 404/i.test(message)
        ? 'API endpoint unavailable'
        : message;
  return { status: 'error', summary, message, detail, code: diagnostic?.code || '' };
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
            <pre className="viewer" id="console-response-headers-body" style={{ minHeight: 40, marginTop: 6 }}>{response.headers}</pre>
          </details>
        ) : null}
        <div className="response-toolbar">
          <div className="response-meta">
            <span id="console-response-size" className="response-size">{response.size}</span>
          </div>
          <button className="btn btn-ghost" id="console-copy-response" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void navigator.clipboard.writeText(response.body).then(() => toast('Response copied'))}>Copy</button>
        </div>
        <pre className="viewer" id="console-response-body" dangerouslySetInnerHTML={{ __html: highlightJson(response.body) }}></pre>
      </div>
      {saved.length ? (
        <div className="panel" id="console-saved-panel">
          <h2 style={{ marginBottom: 12 }}>Saved Requests</h2>
          <div id="console-saved" className="card-list">
            {saved.map((entry, index) => (
              <div key={index} className="saved-item">
                <div className="saved-item-main" onClick={() => { setApiKey(entry.api); setMethod(entry.method); setPath(entry.path); }}>
                  <span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
                  <span className="saved-item-name">{entry.path}</span>
                  <span className="history-api">{entry.api}</span>
                </div>
                <button className="pin-btn pinned" onClick={() => setSaved((current) => current.filter((_, itemIndex) => itemIndex !== index))}>✖</button>
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

function DataverseTab(props: {
  dataverse: any;
  setDataverse: React.Dispatch<React.SetStateAction<any>>;
  environment: string;
  loadEntityDetail: (logicalName: string) => Promise<void>;
  loadRecordPreview: () => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { dataverse, setDataverse, environment, loadEntityDetail, loadRecordPreview, toast } = props;
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

  const filteredAttributes = dataverse.currentEntityDetail
    ? (dataverse.currentEntityDetail.attributes || []).filter((attribute: any) => {
        if (!dataverse.attrFilter) return true;
        const filter = dataverse.attrFilter.toLowerCase();
        return attribute.logicalName.includes(filter) || (attribute.displayName || '').toLowerCase().includes(filter);
      })
    : [];

  useEffect(() => {
    setQueryForm((current) => ({
      ...current,
      entitySetName: dataverse.currentEntityDetail?.entitySetName || '',
      selectCsv: (dataverse.selectedColumns.length
        ? dataverse.selectedColumns
        : getDefaultSelectedColumns(dataverse.currentEntityDetail, 0)).join(','),
      orderByCsv: orderByDefault(dataverse.currentEntityDetail),
    }));
  }, [dataverse.currentEntityDetail, dataverse.selectedColumns]);

  async function runQuery(event: FormEvent<HTMLFormElement>, previewOnly = false) {
    event.preventDefault();
    try {
      const payload = await api<any>(previewOnly ? '/api/dv/query/preview' : '/api/dv/query/execute', {
        method: 'POST',
        body: JSON.stringify({
          environmentAlias: environment,
          entitySetName: queryForm.entitySetName,
          top: queryForm.top,
          selectCsv: queryForm.selectCsv,
          filter: queryForm.filter,
          orderByCsv: queryForm.orderByCsv,
          expandCsv: queryForm.expandCsv,
          rawPath: queryForm.rawPath,
          includeCount: queryForm.includeCount,
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
                      <div key={String(label)} className="metric"><div className="metric-label">{label}</div><div className="metric-value">{String(value ?? '-')}</div></div>
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
                    <button className="btn btn-secondary" id="entity-refresh-records" type="button" onClick={() => void loadRecordPreview()}>Refresh</button>
                  </div>
                  <div id="record-preview-path" style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 8 }}>{dataverse.recordPreview?.path || ''}</div>
                  <div className="result-toggle" id="record-preview-toggle" style={{ marginTop: 8 }}>
                    <button className={`result-toggle-btn ${dataverse.recordPreviewView === 'table' ? 'active' : ''}`} data-view="table" onClick={() => setDataverse((current: any) => ({ ...current, recordPreviewView: 'table' }))}>Table</button>
                    <button className={`result-toggle-btn ${dataverse.recordPreviewView === 'json' ? 'active' : ''}`} data-view="json" onClick={() => setDataverse((current: any) => ({ ...current, recordPreviewView: 'json' }))}>JSON</button>
                  </div>
                  {dataverse.recordPreview && dataverse.recordPreviewView === 'table' && dataverse.recordPreview.records?.length ? (
                    <div id="record-preview-table" dangerouslySetInnerHTML={{ __html: renderResultTable(dataverse.recordPreview.records, dataverse.recordPreview.logicalName) }}></div>
                  ) : null}
                  <pre className="viewer" id="record-preview-json" style={{ display: dataverse.recordPreview && dataverse.recordPreviewView === 'table' && dataverse.recordPreview.records?.length ? 'none' : '' }} dangerouslySetInnerHTML={{ __html: highlightJson(dataverse.recordPreview?.records || 'Select an entity to preview records.') }}></pre>
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
                <button className="btn btn-secondary" id="query-preview-btn" type="button" onClick={(event) => void runQuery(event as any, true)}>Preview Path</button>
                <button className="btn btn-primary" id="query-run-btn" type="submit">Run Query</button>
              </div>
            </form>
          </div>
          <div className="panel">
            <h2>Generated Path</h2>
            <pre className="viewer" id="query-preview">{dataverse.queryPreview}</pre>
          </div>
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2>Query Result</h2>
              <div className="result-toggle" id="query-result-toggle">
                <button className={`result-toggle-btn ${dataverse.queryResultView === 'table' ? 'active' : ''}`} data-view="table" onClick={() => setDataverse((current: any) => ({ ...current, queryResultView: 'table' }))}>Table</button>
                <button className={`result-toggle-btn ${dataverse.queryResultView === 'json' ? 'active' : ''}`} data-view="json" onClick={() => setDataverse((current: any) => ({ ...current, queryResultView: 'json' }))}>JSON</button>
              </div>
            </div>
            {dataverse.queryResult && dataverse.queryResultView === 'table' && dataverse.queryResult.records?.length ? (
              <div id="query-result-table" dangerouslySetInnerHTML={{ __html: renderResultTable(dataverse.queryResult.records, dataverse.queryResult.logicalName) }}></div>
            ) : <div id="query-result-table"></div>}
            <pre className="viewer" id="query-result" style={{ display: dataverse.queryResult && dataverse.queryResultView === 'table' && dataverse.queryResult.records?.length ? 'none' : '' }} dangerouslySetInnerHTML={{ __html: highlightJson(dataverse.queryResult || 'Run a query to see the response.') }}></pre>
          </div>
        </div>

        <div style={{ display: dataverse.dvSubTab === 'dv-fetchxml' ? undefined : 'none' }}>
          <FetchXmlTab dataverse={dataverse} environment={environment} toast={toast} />
        </div>
        <div style={{ display: dataverse.dvSubTab === 'dv-relationships' ? undefined : 'none' }}>
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
  const { state, setState, reload, openConsole, toast } = props;
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
                ].map(([label, value]) => <div key={String(label)} className="metric"><div className="metric-label">{label}</div><div className="metric-value">{String(value)}</div></div>)}
              </div>
              <div id="app-connections">
                {Object.entries(prop(state.current, 'properties.connectionReferences') || {}).map(([key, value]: [string, any]) => (
                  <div key={key} className="card-item" style={{ padding: '8px 10px' }}>
                    <div className="card-item-info">
                      <div className="card-item-title">{value.displayName || key}</div>
                      <div className="card-item-sub">{value.id || ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
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
                ].map(([label, value]) => <div key={String(label)} className="metric"><div className="metric-label">{label}</div><div className="metric-value">{String(value)}</div></div>)}
              </div>
              <div id="plat-env-linked">
                {prop(state.current, 'properties.linkedEnvironmentMetadata.instanceUrl') ? (
                  <div className="metrics">
                    <div className="metric"><div className="metric-label">Instance URL</div><div className="metric-value">{prop(state.current, 'properties.linkedEnvironmentMetadata.instanceUrl')}</div></div>
                    <div className="metric"><div className="metric-label">Domain</div><div className="metric-value">{prop(state.current, 'properties.linkedEnvironmentMetadata.domainName') || '-'}</div></div>
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
