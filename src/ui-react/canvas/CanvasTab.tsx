import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { api, formatDate, highlightJson, prop } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import { EmptyState } from '../EmptyState.js';
import { Icon } from '../Icon.js';
import { JsonViewer } from '../JsonViewer.js';

type CanvasSessionEntry = { id: string; status: string; appId: string; environmentAlias: string; result?: any; error?: string; createdAt: string; deviceCode?: { verificationUri: string; userCode: string; message: string } };

const DESCRIBE_ENDPOINTS = new Set(['controls', 'apis', 'datasources']);

type DescribeTarget = { sessionId: string; version: string; endpoint: string; name: string; title: string };

function CanvasResultView(props: { result: any; endpoint: string; toast: (message: string, isError?: boolean) => void; onRowClick?: (item: any) => void }) {
  const { result, endpoint, toast, onRowClick } = props;
  const [view, setView] = useState<'table' | 'json'>('table');
  const rowClickable = Boolean(onRowClick);

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
                <tr
                  key={i}
                  className={rowClickable ? 'canvas-result-row-clickable' : ''}
                  onClick={rowClickable ? () => onRowClick!(item) : undefined}
                >
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

export function CanvasTab(props: {
  state: CanvasState;
  setState: Dispatch<SetStateAction<CanvasState>>;
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
  const [describeTarget, setDescribeTarget] = useState<DescribeTarget | null>(null);

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
                    <CanvasResultView
                      result={explorerResult}
                      endpoint={explorerEndpoint}
                      toast={toast}
                      onRowClick={activeSession && DESCRIBE_ENDPOINTS.has(explorerEndpoint)
                        ? (item) => {
                            const name = typeof item?.name === 'string' && item.name ? item.name : null;
                            if (!name) { toast('This row has no name to describe.', true); return; }
                            const version = activeSession.result?.session?.clientConfig?.webAuthoringVersion;
                            setDescribeTarget({
                              sessionId: activeSession.id,
                              version: version ? `/${version}` : '',
                              endpoint: explorerEndpoint,
                              name,
                              title: item.displayName || name,
                            });
                          }
                        : undefined}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
      {describeTarget ? (
        <CanvasDescribeModal target={describeTarget} toast={toast} onClose={() => setDescribeTarget(null)} />
      ) : null}
    </>
  );
}

function CanvasDescribeModal(props: { target: DescribeTarget; toast: (message: string, isError?: boolean) => void; onClose: () => void }) {
  const { target, toast, onClose } = props;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<any>('/api/canvas/request', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: target.sessionId,
        method: 'GET',
        path: `${target.version}/api/yaml/${target.endpoint}/${encodeURIComponent(target.name)}`,
      }),
    })
      .then((payload) => { if (!cancelled) setData(payload.data?.response ?? payload.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target.endpoint, target.name, target.sessionId, target.version]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rawJson = useMemo(() => {
    try { return JSON.stringify(data, null, 2); }
    catch { return '{}'; }
  }, [data]);

  return (
    <div className="rt-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="rt-modal size-lg canvas-describe-modal">
        <div className="rt-modal-header">
          <div>
            <h3 className="rt-modal-title">{target.title}</h3>
            <span className="rt-modal-id">{target.endpoint} · {target.name}</span>
          </div>
          <div className="rt-modal-actions">
            <CopyButton value={rawJson} label="Copy JSON" title="Copy describe response" toast={toast} />
            <button className="btn btn-ghost" type="button" onClick={onClose} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>Close</button>
          </div>
        </div>
        <div className="rt-modal-body body-flush canvas-describe-body">
          {loading ? (
            <div className="rt-modal-loading">Loading {target.endpoint.slice(0, -1)} details…</div>
          ) : error ? (
            <div className="rt-modal-error">{error}</div>
          ) : (
            <JsonViewer value={rawJson} height="100%" />
          )}
        </div>
      </div>
    </div>
  );
}

export type CanvasState = { sessions: CanvasSessionEntry[]; sessionStarting: boolean };
