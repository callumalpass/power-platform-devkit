import { useEffect, useMemo, useState } from 'react';
import { api, formatDate, formatDateShort, highlightJson, prop } from './utils.js';

type FlowItem = any;
type RunItem = any;
type ActionItem = any;

export function AutomateTab(props: {
  active: boolean;
  environment: string;
  openConsole: (seed: { api: string; method: string; path: string }) => void;
  toast: (message: string, isError?: boolean) => void;
}) {
  const { active, environment, openConsole, toast } = props;
  const [flows, setFlows] = useState<FlowItem[]>([]);
  const [flowSource, setFlowSource] = useState<'flow' | 'dv'>('flow');
  const [loadedEnvironment, setLoadedEnvironment] = useState('');
  const [filter, setFilter] = useState('');
  const [currentFlow, setCurrentFlow] = useState<FlowItem | null>(null);
  const [flowDocument, setFlowDocument] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [runFilter, setRunFilter] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState('');
  const [currentRun, setCurrentRun] = useState<RunItem | null>(null);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [actionStatusFilter, setActionStatusFilter] = useState('');
  const [currentAction, setCurrentAction] = useState<ActionItem | null>(null);
  const [actionDetail, setActionDetail] = useState<any>(null);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!active || !environment) return;
    if (environment === loadedEnvironment && flows.length) return;
    void loadFlows(false);
  }, [active, environment, flows.length, loadedEnvironment]);

  useEffect(() => {
    if (!flowDocument.trim()) {
      setAnalysis(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setAnalyzing(true);
      void api<any>('/api/flow/language/analyze', {
        method: 'POST',
        body: JSON.stringify({ source: flowDocument, cursor: flowDocument.length }),
      })
        .then((payload) => setAnalysis(payload.data))
        .catch((error) => toast(error instanceof Error ? error.message : String(error), true))
        .finally(() => setAnalyzing(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [flowDocument, toast]);

  const filteredFlows = useMemo(() => {
    if (!filter) return flows;
    return flows.filter((flow) => {
      const name = prop(flow, 'properties.displayName') || flow.name || '';
      return String(name).toLowerCase().includes(filter.toLowerCase());
    });
  }, [filter, flows]);

  const filteredRuns = useMemo(() => {
    return runs
      .filter((run) => {
        const status = prop(run, 'properties.status') || '';
        const trigger = prop(run, 'properties.trigger.name') || '';
        const haystack = [run.name || '', status, trigger].join(' ').toLowerCase();
        return (!runStatusFilter || status === runStatusFilter) && (!runFilter || haystack.includes(runFilter.toLowerCase()));
      })
      .sort((a, b) => statusRank(prop(a, 'properties.status')) - statusRank(prop(b, 'properties.status')));
  }, [runFilter, runStatusFilter, runs]);

  const filteredActions = useMemo(() => {
    return actions
      .filter((action) => {
        const status = prop(action, 'properties.status') || '';
        const type = prop(action, 'properties.type') || '';
        const code = prop(action, 'properties.code') || '';
        const haystack = [action.name || '', status, type, code].join(' ').toLowerCase();
        return (!actionStatusFilter || status === actionStatusFilter) && (!actionFilter || haystack.includes(actionFilter.toLowerCase()));
      })
      .sort((a, b) => statusRank(prop(a, 'properties.status')) - statusRank(prop(b, 'properties.status')));
  }, [actionFilter, actionStatusFilter, actions]);

  async function loadFlows(force: boolean) {
    if (!environment) return;
    if (!force && environment === loadedEnvironment && flows.length) return;
    setLoadingFlows(true);
    try {
      try {
        const result = await api<any>('/api/request/execute', {
          method: 'POST',
          body: JSON.stringify({ environment, api: 'flow', method: 'GET', path: '/flows', allowInteractive: false }),
        });
        setFlows(((result.data?.response?.value) || []).map(normalizeFlowApiItem));
        setFlowSource('flow');
      } catch (error) {
        const result = await api<any>('/api/request/execute', {
          method: 'POST',
          body: JSON.stringify({
            environment,
            api: 'dv',
            method: 'GET',
            path: "/workflows?$filter=category eq 5&$select=name,workflowid,createdon,modifiedon,statecode,statuscode,_ownerid_value,description,clientdata&$orderby=modifiedon desc&$top=200",
            allowInteractive: false,
          }),
        });
        setFlows(((result.data?.response?.value) || []).map(normalizeDataverseFlow));
        setFlowSource('dv');
        if ((result.data?.response?.value || []).length) {
          toast('Flow list API failed for this environment. Showing Dataverse workflow fallback instead.', true);
        } else {
          throw error;
        }
      }
      setLoadedEnvironment(environment);
      setCurrentFlow(null);
      setRuns([]);
      setCurrentRun(null);
      setActions([]);
      setCurrentAction(null);
      setActionDetail(null);
      setFlowDocument('');
      setAnalysis(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      setFlows([]);
      setLoadedEnvironment(environment);
    } finally {
      setLoadingFlows(false);
    }
  }

  async function selectFlow(flow: FlowItem) {
    setCurrentFlow(flow);
    setCurrentRun(null);
    setCurrentAction(null);
    setActionDetail(null);
    setActions([]);
    setRuns([]);
    await Promise.all([loadFlowDefinition(flow), loadFlowRuns(flow)]);
  }

  async function loadFlowDefinition(flow: FlowItem) {
    let detail = flow;
    if (flow.source !== 'dv') {
      try {
        const result = await api<any>('/api/request/execute', {
          method: 'POST',
          body: JSON.stringify({ environment, api: 'flow', method: 'GET', path: `/flows/${flowIdentifier(flow)}`, allowInteractive: false }),
        });
        detail = result.data?.response || flow;
      } catch {
        detail = flow;
      }
    }
    setFlowDocument(buildFlowDocument(detail));
  }

  async function loadFlowRuns(flow: FlowItem) {
    try {
      const result = await api<any>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({ environment, api: 'flow', method: 'GET', path: `/flows/${flowIdentifier(flow)}/runs?$top=20` }),
      });
      setRuns(result.data?.response?.value || []);
    } catch {
      setRuns([]);
    }
  }

  async function selectRun(run: RunItem) {
    setCurrentRun(run);
    setCurrentAction(null);
    setActionDetail(null);
    try {
      const result = await api<any>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({ environment, api: 'flow', method: 'GET', path: `/flows/${flowIdentifier(currentFlow)}/runs/${run.name}/actions` }),
      });
      setActions(result.data?.response?.value || []);
    } catch {
      setActions([]);
    }
  }

  async function selectAction(action: ActionItem) {
    setCurrentAction(action);
    try {
      const result = await api<any>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({ environment, api: 'flow', method: 'GET', path: `/flows/${flowIdentifier(currentFlow)}/runs/${currentRun?.name}/actions/${action.name}` }),
      });
      setActionDetail(result.data?.response || action);
    } catch {
      setActionDetail(action);
    }
  }

  const actionCounts = summarizeCounts(actions);

  return (
    <div className={`tab-panel ${active ? 'active' : ''}`} id="panel-automate" style={active ? undefined : { display: 'none' }}>
      <div className="inventory-sidebar">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2>Flows</h2>
            <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void loadFlows(true)}>{loadingFlows ? 'Refreshing…' : 'Refresh'}</button>
          </div>
          <input type="text" className="entity-filter" placeholder="Filter flows…" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <div className="entity-count">{flows.length ? `${flows.length} flows${flowSource === 'dv' ? ' via Dataverse fallback' : ''}` : ''}</div>
          <div className="entity-list">
            {filteredFlows.length ? filteredFlows.map((flow) => {
              const state = String(prop(flow, 'properties.state') || '');
              const cls = state === 'Started' ? 'ok' : state === 'Stopped' ? 'error' : 'pending';
              return (
                <div key={flowIdentifier(flow)} className={`entity-item ${flowIdentifier(currentFlow) === flowIdentifier(flow) ? 'active' : ''}`} onClick={() => void selectFlow(flow)}>
                  <div className="entity-item-name"><span className={`health-dot ${cls}`} style={{ marginRight: 6 }}></span>{prop(flow, 'properties.displayName') || flow.name || 'Unnamed'}</div>
                  <div className="entity-item-logical">{prop(flow, 'properties.definitionSummary.triggers.0.type') || '-'} · {formatDateShort(prop(flow, 'properties.lastModifiedTime'))}</div>
                  {state ? <div className="entity-item-badges"><span className="entity-item-flag">{state.toLowerCase()}</span></div> : null}
                </div>
              );
            }) : <div className="entity-loading">{loadingFlows ? 'Loading flows…' : 'Select an environment to load flows.'}</div>}
          </div>
        </div>
      </div>
      <div className="detail-area">
        <div className="panel">
          {!currentFlow ? (
            <>
              <h2>Flow Detail</h2>
              <p className="desc">Select a flow to inspect its definition, runs, and action I/O.</p>
              <div className="empty">No flow selected.</div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h2>{prop(currentFlow, 'properties.displayName') || currentFlow.name}</h2>
                  <p className="desc" style={{ marginBottom: 0 }}>{prop(currentFlow, 'properties.description') || flowIdentifier(currentFlow)}</p>
                </div>
                <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem' }} onClick={() => openConsole(currentFlow.source === 'dv'
                  ? { api: 'dv', method: 'GET', path: `/workflows(${flowIdentifier(currentFlow)})` }
                  : { api: 'flow', method: 'GET', path: `/flows/${flowIdentifier(currentFlow)}` })}>Open in Console</button>
              </div>
              <div className="metrics">
                <div className="metric"><div className="metric-label">Created</div><div className="metric-value">{formatDate(prop(currentFlow, 'properties.createdTime'))}</div></div>
                <div className="metric"><div className="metric-label">Modified</div><div className="metric-value">{formatDate(prop(currentFlow, 'properties.lastModifiedTime'))}</div></div>
                <div className="metric"><div className="metric-label">Trigger</div><div className="metric-value">{prop(currentFlow, 'properties.definitionSummary.triggers.0.type') || '-'}</div></div>
                <div className="metric"><div className="metric-label">Actions</div><div className="metric-value">{String((prop(currentFlow, 'properties.definitionSummary.actions') || []).length || 0)}</div></div>
                <div className="metric"><div className="metric-label">Source</div><div className="metric-value">{currentFlow.source === 'dv' ? 'Dataverse fallback' : 'Flow API'}</div></div>
              </div>
            </>
          )}
        </div>

        {currentFlow ? (
          <>
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h2>Definition</h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{analyzing ? 'Analyzing…' : analysis ? 'Analysis updated' : 'Definition not loaded'}</div>
              </div>
              <textarea className="xml-editor" style={{ display: 'block', minHeight: 280 }} value={flowDocument} onChange={(event) => setFlowDocument(event.target.value)} />
              <div className="flow-summary-grid" style={{ marginTop: 12 }}>
                {[
                  ['Wrapper', analysis?.summary?.wrapperKind || 'unknown'],
                  ['Triggers', String(analysis?.summary?.triggerCount || 0)],
                  ['Actions', String(analysis?.summary?.actionCount || 0)],
                  ['Variables', String(analysis?.summary?.variableCount || 0)],
                  ['Parameters', String(analysis?.summary?.parameterCount || 0)],
                  ['Unresolved refs', String((analysis?.references || []).filter((item: any) => item.resolved === false).length)],
                ].map(([label, value]) => (
                  <div key={label} className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>
                ))}
              </div>
              <div className="fetchxml-diagnostics" style={{ marginTop: 12 }}>
                {(analysis?.diagnostics || []).length ? (analysis.diagnostics || []).slice(0, 30).map((item: any, index: number) => (
                  <div key={index} className={`fetchxml-diagnostic ${item.level || 'info'}`}>
                    <div className="fetchxml-diagnostic-code">{item.code || 'INFO'} @ {item.from ?? 0}</div>
                    <div className="fetchxml-diagnostic-message">{item.message}</div>
                  </div>
                )) : <div className="empty">No diagnostics.</div>}
              </div>
              <div style={{ marginTop: 12 }}>
                <h3 style={{ marginBottom: 8 }}>Outline</h3>
                {analysis?.outline?.length ? <FlowOutline items={analysis.outline} /> : <div className="empty">No outline yet.</div>}
              </div>
            </div>

            <div className="panel">
              <div className="run-toolbar">
                <input type="text" placeholder="Filter runs…" value={runFilter} onChange={(event) => setRunFilter(event.target.value)} />
                <select value={runStatusFilter} onChange={(event) => setRunStatusFilter(event.target.value)}>
                  <option value="">all statuses</option>
                  <option value="Succeeded">Succeeded</option>
                  <option value="Failed">Failed</option>
                  <option value="Running">Running</option>
                  <option value="Skipped">Skipped</option>
                </select>
              </div>
              <div className="card-list">
                {filteredRuns.length ? filteredRuns.map((run) => {
                  const status = prop(run, 'properties.status') || 'Unknown';
                  const cls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : 'pending';
                  return (
                    <div key={run.name} className={`run-item status-${cls} ${currentRun?.name === run.name ? 'active' : ''}`} onClick={() => void selectRun(run)}>
                      <div className="run-main">
                        <span className={`health-dot ${cls}`}></span>
                        <div className="run-text">
                          <div className="run-status">{status}</div>
                          <div className="run-sub">
                            <span className="action-item-type">{prop(run, 'properties.trigger.name') || '-'}</span>
                            <span className="run-duration">{formatRunDuration(run)}</span>
                            <span className="action-item-type">{shortId(run.name)}</span>
                          </div>
                        </div>
                      </div>
                      <span className="run-time">{formatDate(prop(run, 'properties.startTime'))}</span>
                    </div>
                  );
                }) : <div className="empty">No recent runs.</div>}
              </div>
            </div>

            {currentRun ? (
              <div className="panel">
                <div className="run-summary-grid">
                  <SummaryCard label="Status" value={String(prop(currentRun, 'properties.status') || '-')} />
                  <SummaryCard label="Trigger" value={String(prop(currentRun, 'properties.trigger.name') || '-')} />
                  <SummaryCard label="Started" value={formatDate(prop(currentRun, 'properties.startTime'))} />
                  <SummaryCard label="Duration" value={formatRunDuration(currentRun)} />
                </div>
                <div className="action-toolbar">
                  <input type="text" placeholder="Filter actions by name, type, or code…" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} />
                  <select value={actionStatusFilter} onChange={(event) => setActionStatusFilter(event.target.value)}>
                    <option value="">all statuses</option>
                    <option value="Succeeded">Succeeded</option>
                    <option value="Failed">Failed</option>
                    <option value="Running">Running</option>
                    <option value="Skipped">Skipped</option>
                  </select>
                </div>
                <div className="run-summary-grid" style={{ marginBottom: 12 }}>
                  <SummaryCard label="Actions" value={String(actions.length)} />
                  <SummaryCard label="Failed" value={String(actionCounts.Failed || 0)} />
                  <SummaryCard label="Running" value={String(actionCounts.Running || 0)} />
                  <SummaryCard label="Succeeded" value={String(actionCounts.Succeeded || 0)} />
                </div>
                <div className="card-list" style={{ marginBottom: 12 }}>
                  {filteredActions.length ? filteredActions.map((action) => {
                    const status = prop(action, 'properties.status') || 'Unknown';
                    const cls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : 'pending';
                    return (
                      <div key={action.name} className={`action-item ${currentAction?.name === action.name ? 'active' : ''}`} onClick={() => void selectAction(action)}>
                        <span className={`health-dot ${cls}`}></span>
                        <span className="action-item-name" title={action.name}>{action.name || 'Unknown'}</span>
                        <div className="action-item-meta">
                          <span className="action-item-type">{status}</span>
                          {prop(action, 'properties.type') ? <span className="action-item-type">{String(prop(action, 'properties.type'))}</span> : null}
                          {prop(action, 'properties.code') && prop(action, 'properties.code') !== status ? <span className="action-item-type">{String(prop(action, 'properties.code'))}</span> : null}
                          <span className="run-duration">{formatRunDuration(action)}</span>
                        </div>
                      </div>
                    );
                  }) : <div className="empty">No actions in this run.</div>}
                </div>
                {currentAction ? (
                  <>
                    <h2 style={{ marginBottom: 12 }}>{currentAction.name || 'Action Detail'}</h2>
                    <div className="metrics" style={{ marginBottom: 12 }}>
                      <div className="metric"><div className="metric-label">Status</div><div className="metric-value">{String(prop(currentAction, 'properties.status') || '-')}</div></div>
                      <div className="metric"><div className="metric-label">Type</div><div className="metric-value">{String(prop(currentAction, 'properties.type') || '-')}</div></div>
                      <div className="metric"><div className="metric-label">Code</div><div className="metric-value">{String(prop(currentAction, 'properties.code') || '-')}</div></div>
                      <div className="metric"><div className="metric-label">Started</div><div className="metric-value">{formatDate(prop(currentAction, 'properties.startTime'))}</div></div>
                      <div className="metric"><div className="metric-label">Duration</div><div className="metric-value">{formatRunDuration(currentAction)}</div></div>
                    </div>
                    <ActionIo detail={actionDetail} toast={toast} />
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function FlowOutline(props: { items: any[] }) {
  const { items } = props;
  return (
    <div className="card-list">
      {items.map((item, index) => (
        <div key={`${item.name}-${index}`} className="card-item" style={{ padding: '10px 12px' }}>
          <div className="card-item-info">
            <div className="card-item-title">{item.name}</div>
            <div className="card-item-sub">{String(item.kind || 'node')}{item.detail ? ` · ${item.detail}` : ''}</div>
          </div>
          {item.children?.length ? <div style={{ marginTop: 10, width: '100%' }}><FlowOutline items={item.children} /></div> : null}
        </div>
      ))}
    </div>
  );
}

function SummaryCard(props: { label: string; value: string }) {
  return (
    <div className="run-summary-card">
      <div className="run-summary-card-label">{props.label}</div>
      <div className="run-summary-card-value">{props.value}</div>
    </div>
  );
}

function ActionIo(props: { detail: any; toast: (message: string, isError?: boolean) => void }) {
  const { detail, toast } = props;
  const [remoteInputs, setRemoteInputs] = useState<any>(undefined);
  const [remoteOutputs, setRemoteOutputs] = useState<any>(undefined);

  async function fetchRemote(kind: 'input' | 'output', uri: string) {
    try {
      const response = await fetch(uri);
      const text = await response.text();
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      if (kind === 'input') setRemoteInputs(parsed);
      else setRemoteOutputs(parsed);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  const error = prop(detail, 'properties.error');
  const inlineInputs = prop(detail, 'properties.inputs');
  const inlineOutputs = prop(detail, 'properties.outputs');
  const inputsLink = prop(detail, 'properties.inputsLink.uri');
  const outputsLink = prop(detail, 'properties.outputsLink.uri');

  return (
    <>
      {error ? <div className="action-io-section"><h3>Error</h3><pre className="viewer" style={{ borderLeft: '3px solid var(--danger)' }} dangerouslySetInnerHTML={{ __html: highlightJson(error) }}></pre></div> : null}
      {inlineInputs !== undefined ? <div className="action-io-section"><h3>Inputs</h3><pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(inlineInputs) }}></pre></div> : inputsLink ? (
        <div className="action-io-section">
          <h3>Inputs</h3>
          <button className="btn btn-secondary" type="button" style={{ fontSize: '0.75rem', padding: '5px 12px', marginBottom: 8 }} onClick={() => void fetchRemote('input', inputsLink)}>Fetch inputs</button>
          {remoteInputs !== undefined ? <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(remoteInputs) }}></pre> : null}
        </div>
      ) : null}
      {inlineOutputs !== undefined ? <div className="action-io-section"><h3>Outputs</h3><pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(inlineOutputs) }}></pre></div> : outputsLink ? (
        <div className="action-io-section">
          <h3>Outputs</h3>
          <button className="btn btn-secondary" type="button" style={{ fontSize: '0.75rem', padding: '5px 12px', marginBottom: 8 }} onClick={() => void fetchRemote('output', outputsLink)}>Fetch outputs</button>
          {remoteOutputs !== undefined ? <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(remoteOutputs) }}></pre> : null}
        </div>
      ) : null}
      {!error && inlineInputs === undefined && inlineOutputs === undefined && !inputsLink && !outputsLink ? (
        <div className="action-io-section">
          <h3>Properties</h3>
          <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(prop(detail, 'properties') || detail) }}></pre>
        </div>
      ) : null}
    </>
  );
}

function flowIdentifier(flow: any) {
  return flow && (flow.workflowid || flow.name);
}

function buildFlowDocument(detail: any) {
  const definition = prop(detail, 'properties.definition') || detail.definition || detail;
  const connectionReferences = prop(detail, 'properties.connectionReferences');
  if (definition && typeof definition === 'object') {
    return JSON.stringify({
      name: detail.name,
      id: detail.id || detail.workflowid,
      type: detail.type,
      properties: {
        displayName: prop(detail, 'properties.displayName'),
        state: prop(detail, 'properties.state'),
        connectionReferences,
        definition,
      },
    }, null, 2);
  }
  if (typeof definition === 'string') return definition;
  return JSON.stringify(detail || {}, null, 2);
}

function normalizeFlowApiItem(flow: any) {
  return {
    ...flow,
    source: 'flow',
    workflowid: flow.workflowid || flow.name,
    properties: {
      ...(flow.properties || {}),
      displayName: prop(flow, 'properties.displayName') || flow.name || 'Unnamed',
      definition: prop(flow, 'properties.definition'),
      connectionReferences: prop(flow, 'properties.connectionReferences'),
    },
  };
}

function normalizeDataverseFlow(flow: any) {
  const definition = parseJsonMaybe(flow.clientdata)?.properties?.definition || parseJsonMaybe(flow.clientdata)?.definition || parseJsonMaybe(flow.clientdata) || {};
  const triggerEntries = Object.entries((definition && definition.triggers) || {});
  const actionEntries = Object.entries((definition && definition.actions) || {});
  return {
    source: 'dv',
    name: flow.name,
    workflowid: flow.workflowid,
    properties: {
      displayName: flow.name || flow.workflowid || 'Unnamed',
      description: flow.description || '',
      state: flow.statecode === 0 ? 'Started' : flow.statecode === 1 ? 'Stopped' : 'Unknown',
      createdTime: flow.createdon,
      lastModifiedTime: flow.modifiedon,
      creator: { objectId: flow._ownerid_value || '' },
      definition,
      connectionReferences: parseJsonMaybe(flow.clientdata)?.properties?.connectionReferences || {},
      definitionSummary: {
        triggers: triggerEntries.map(([name, value]: [string, any]) => ({ name, type: value?.type || '-' })),
        actions: actionEntries.map(([name, value]: [string, any]) => ({ name, type: value?.type || '-' })),
      },
    },
  };
}

function parseJsonMaybe(value: unknown) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatRunDuration(item: any) {
  const startTime = prop(item, 'properties.startTime');
  const endTime = prop(item, 'properties.endTime');
  if (!startTime || !endTime) return '-';
  const diff = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '-';
  if (diff < 1000) return `${diff}ms`;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function shortId(value: string) {
  return value?.length > 12 ? value.slice(0, 6) + '…' + value.slice(-4) : value;
}

function summarizeCounts(items: any[]) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = String(prop(item, 'properties.status') || 'Unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function statusRank(status: string) {
  switch (status) {
    case 'Failed':
      return 0;
    case 'Running':
      return 1;
    case 'Succeeded':
      return 2;
    case 'Skipped':
      return 3;
    default:
      return 4;
  }
}
