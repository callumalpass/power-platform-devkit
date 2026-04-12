import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { searchKeymap } from '@codemirror/search';
import { EditorState, Prec } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDate, formatDateShort, highlightJson, prop } from './utils.js';
import {
  analyzeFlowDocument,
  flowIdentifier,
  loadActionDetail,
  loadFlowDefinitionDocument,
  loadFlowList,
  loadFlowRuns,
  loadRunActions,
} from './automate-data.js';
import type { FlowAction, FlowAnalysis, FlowAnalysisOutlineItem, FlowItem, FlowRun, ToastFn } from './ui-types.js';
import { CopyButton } from './CopyButton.js';
import { RecordDetailModal, useRecordDetail } from './RecordDetailModal.js';

type AutomateSubTab = 'definition' | 'runs' | 'outline';

const automateEditorTheme = EditorView.theme({
  '&': { fontSize: '13px' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(37,99,235,0.18)' },
  '.cm-activeLine': { backgroundColor: 'rgba(37,99,235,0.06)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', borderRight: '1px solid var(--border)', color: 'var(--muted)' },
});

const KIND_DOT: Record<string, string> = {
  trigger: '#3b82f6',
  action: '#22c55e',
  scope: '#eab308',
  condition: '#ef4444',
  foreach: '#8b5cf6',
  switch: '#f97316',
  default: '#9ca3af',
};

export function AutomateTab(props: {
  active: boolean;
  environment: string;
  openConsole: (seed: { api: string; method: string; path: string }) => void;
  toast: ToastFn;
}) {
  const { active, environment, openConsole, toast } = props;
  const detail = useRecordDetail();
  const [flows, setFlows] = useState<FlowItem[]>([]);
  const [flowSource, setFlowSource] = useState<'flow' | 'dv'>('flow');
  const [loadedEnvironment, setLoadedEnvironment] = useState('');
  const [filter, setFilter] = useState('');
  const [currentFlow, setCurrentFlow] = useState<FlowItem | null>(null);
  const [flowSubTab, setFlowSubTab] = useState<AutomateSubTab>('definition');
  const [flowDocument, setFlowDocument] = useState('');
  const [analysis, setAnalysis] = useState<FlowAnalysis | null>(null);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [runFilter, setRunFilter] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState('');
  const [currentRun, setCurrentRun] = useState<FlowRun | null>(null);
  const [actions, setActions] = useState<FlowAction[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [actionStatusFilter, setActionStatusFilter] = useState('');
  const [currentAction, setCurrentAction] = useState<FlowAction | null>(null);
  const [actionDetail, setActionDetail] = useState<FlowAction | null>(null);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [loadingActions, setLoadingActions] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const selectedRunRef = useRef<string | undefined>(undefined);

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
      void analyzeFlowDocument(flowDocument)
        .then(setAnalysis)
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
      .map((run, index) => ({ run, index }))
      .filter(({ run }) => {
        const status = String(prop(run, 'properties.status') || '');
        const trigger = String(prop(run, 'properties.trigger.name') || '');
        const haystack = [run.name || '', status, trigger].join(' ').toLowerCase();
        return (!runStatusFilter || status === runStatusFilter) && (!runFilter || haystack.includes(runFilter.toLowerCase()));
      })
      .sort((a, b) => compareRunsByRecency(a.run, b.run) || a.index - b.index)
      .map(({ run }) => run);
  }, [runFilter, runStatusFilter, runs]);

  const filteredActions = useMemo(() => {
    return actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => {
        const status = String(prop(action, 'properties.status') || '');
        const type = String(prop(action, 'properties.type') || '');
        const code = String(prop(action, 'properties.code') || '');
        const haystack = [action.name || '', status, type, code].join(' ').toLowerCase();
        return (!actionStatusFilter || status === actionStatusFilter) && (!actionFilter || haystack.includes(actionFilter.toLowerCase()));
      })
      .sort((a, b) => compareActionsByExecutionOrder(a.action, b.action) || a.index - b.index)
      .map(({ action }) => action);
  }, [actionFilter, actionStatusFilter, actions]);

  async function loadFlows(force: boolean) {
    if (!environment) return;
    if (!force && environment === loadedEnvironment && flows.length) return;
    setLoadingFlows(true);
    try {
      const result = await loadFlowList(environment);
      setFlows(result.flows);
      setFlowSource(result.source);
      if (result.usedFallback) toast('Flow list API failed for this environment. Showing Dataverse workflow fallback instead.', true);
      setLoadedEnvironment(environment);
      setCurrentFlow(null);
      setRuns([]);
      setCurrentRun(null);
      setActions([]);
      setCurrentAction(null);
      setActionDetail(null);
      setLoadingActions(false);
      setFlowDocument('');
      setAnalysis(null);
      setFlowSubTab('definition');
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
    setLoadingActions(false);
    selectedRunRef.current = undefined;
    setActions([]);
    setRuns([]);
    const [document, loadedRuns] = await Promise.all([
      loadFlowDefinitionDocument(environment, flow),
      loadFlowRuns(environment, flow).catch(() => []),
    ]);
    setFlowDocument(document);
    setRuns(loadedRuns);
  }

  async function flowAction(action: 'run' | 'start' | 'stop') {
    if (!currentFlow || currentFlow.source !== 'flow') return;
    const flowApiId = currentFlow.name;
    if (!flowApiId) return;
    const labels = { run: 'Running', start: 'Turning on', stop: 'Turning off' };
    toast(labels[action] + '...');
    try {
      const paths: Record<string, string> = {
        run: `/flows/${flowApiId}/triggers/manual/run`,
        start: `/flows/${flowApiId}/start`,
        stop: `/flows/${flowApiId}/stop`,
      };
      await api<any>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({ environment, api: 'flow', method: 'POST', path: paths[action] }),
      });
      const messages = { run: 'Flow triggered', start: 'Flow turned on', stop: 'Flow turned off' };
      toast(messages[action]);
      // For state changes, poll until the API reflects the new state
      if (action === 'start' || action === 'stop') {
        const expectedState = action === 'start' ? 'Started' : 'Stopped';
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise((r) => setTimeout(r, 800));
          const refreshed = await loadFlowList(environment);
          const updated = refreshed.flows.find((f: FlowItem) => f.name === flowApiId);
          if (updated && String(prop(updated, 'properties.state')) === expectedState) {
            setFlows(refreshed.flows);
            setCurrentFlow(updated);
            return;
          }
        }
      }
      // Fallback / run action: just refresh once
      const refreshed = await loadFlowList(environment);
      setFlows(refreshed.flows);
      const updated = refreshed.flows.find((f: FlowItem) => f.name === flowApiId);
      if (updated) setCurrentFlow(updated);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function selectRun(run: FlowRun) {
    if (currentRun?.name === run.name) {
      setCurrentRun(null);
      setCurrentAction(null);
      setActionDetail(null);
      setActions([]);
      setLoadingActions(false);
      selectedRunRef.current = undefined;
      return;
    }
    setCurrentRun(run);
    setCurrentAction(null);
    setActionDetail(null);
    setActions([]);
    setLoadingActions(true);
    selectedRunRef.current = run.name;
    try {
      const loadedActions = currentFlow ? await loadRunActions(environment, currentFlow, run) : [];
      if (selectedRunRef.current === run.name) setActions(loadedActions);
    } catch {
      if (selectedRunRef.current === run.name) setActions([]);
    } finally {
      if (selectedRunRef.current === run.name) setLoadingActions(false);
    }
  }

  async function selectAction(action: FlowAction) {
    setCurrentAction(action);
    try {
      setActionDetail(currentFlow && currentRun ? await loadActionDetail(environment, currentFlow, currentRun, action) : action);
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
                  <p className="desc copy-inline" style={{ marginBottom: 0 }}>
                    <span className="record-link" onClick={() => detail.open('workflow', 'workflows', flowIdentifier(currentFlow))}>{prop(currentFlow, 'properties.description') || flowIdentifier(currentFlow)}</span>
                    <CopyButton value={flowIdentifier(currentFlow)} label="copy id" title="Copy flow ID" toast={toast} />
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {currentFlow.source === 'flow' ? (
                    String(prop(currentFlow, 'properties.state')) === 'Started' ? (
                      <>
                        <button className="btn btn-primary" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void flowAction('run')}>Run Now</button>
                        <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void flowAction('stop')}>Turn Off</button>
                      </>
                    ) : (
                      <button className="btn btn-primary" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void flowAction('start')}>Turn On</button>
                    )
                  ) : null}
                  <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem' }} onClick={() => openConsole(currentFlow.source === 'dv'
                    ? { api: 'dv', method: 'GET', path: `/workflows(${flowIdentifier(currentFlow)})` }
                    : { api: 'flow', method: 'GET', path: `/flows/${flowIdentifier(currentFlow)}` })}>Open in Console</button>
                </div>
              </div>
              <div className="metrics">
                <div className="metric"><div className="metric-label">State</div><div className="metric-value"><span className={`health-dot ${String(prop(currentFlow, 'properties.state')) === 'Started' ? 'ok' : 'error'}`} style={{ marginRight: 4 }}></span>{String(prop(currentFlow, 'properties.state') || '-')}</div></div>
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
            <div className="dv-sub-nav">
              {(['definition', 'runs', 'outline'] as AutomateSubTab[]).map((tabName) => (
                <button
                  key={tabName}
                  className={`sub-tab ${flowSubTab === tabName ? 'active' : ''}`}
                  type="button"
                  onClick={() => setFlowSubTab(tabName)}
                >
                  {tabName === 'definition' ? 'Definition' : tabName === 'runs' ? 'Runs' : 'Outline'}
                </button>
              ))}
            </div>

            <div className={`dv-subpanel ${flowSubTab === 'definition' ? 'active' : ''}`}>
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h2>Definition</h2>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{analyzing ? 'Analyzing…' : analysis ? 'Analysis updated' : 'Definition not loaded'}</div>
                </div>
                <div className="fetchxml-editor-shell">
                  <FlowCodeEditor
                    value={flowDocument}
                    onChange={setFlowDocument}
                    onAnalysis={setAnalysis}
                    onAnalyzeStart={() => setAnalyzing(true)}
                    onAnalyzeEnd={() => setAnalyzing(false)}
                    toast={toast}
                  />
                </div>
                <div className="flow-summary-grid" style={{ marginTop: 12 }}>
                  {[
                    ['Wrapper', analysis?.summary?.wrapperKind || 'unknown'],
                    ['Triggers', String(analysis?.summary?.triggerCount || 0)],
                    ['Actions', String(analysis?.summary?.actionCount || 0)],
                    ['Variables', String(analysis?.summary?.variableCount || 0)],
                    ['Parameters', String(analysis?.summary?.parameterCount || 0)],
                    ['Unresolved refs', String((analysis?.references || []).filter((item) => item.resolved === false).length)],
                  ].map(([label, value]) => (
                    <div key={label} className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>
                  ))}
                </div>
                <div className="fetchxml-diagnostics" style={{ marginTop: 12 }}>
                  {analysis?.diagnostics?.length ? analysis.diagnostics.slice(0, 30).map((item, index) => (
                    <div key={index} className={`fetchxml-diagnostic ${item.level || 'info'}`}>
                      <div className="fetchxml-diagnostic-code">{item.code || 'INFO'} @ {item.from ?? 0}</div>
                      <div className="fetchxml-diagnostic-message">{item.message}</div>
                    </div>
                  )) : <div className="empty">No diagnostics.</div>}
                </div>
              </div>
            </div>

            <div className={`dv-subpanel ${flowSubTab === 'runs' ? 'active' : ''}`}>
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h2>Runs</h2>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Newest first</div>
                </div>
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
                    const expanded = currentRun?.name === run.name;
                    return (
                      <div key={run.name} className={`run-card ${expanded ? 'active' : ''}`}>
                        <div className={`run-item status-${cls} ${expanded ? 'active' : ''}`} onClick={() => void selectRun(run)}>
                          <div className="run-main">
                            <span className={`health-dot ${cls}`}></span>
                            <div className="run-text">
                              <div className="run-status">{status}</div>
                              <div className="run-sub">
                                <span className="action-item-type">{prop(run, 'properties.trigger.name') || '-'}</span>
                                <span className="run-duration">{formatRunDuration(run)}</span>
                                <span className="action-item-type" title={run.name || ''}>{shortId(run.name || '')}</span>
                                {run.name ? (
                                  <CopyButton value={run.name} label="Copy ID" title="Copy full run ID" toast={toast} className="run-id-copy" stopPropagation />
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <span className="run-time">{formatDate(prop(run, 'properties.startTime'))}</span>
                          <span className="action-item-type">{expanded ? 'Collapse' : 'Expand'}</span>
                        </div>
                        {expanded ? (
                          <div className="run-expanded" onClick={(event) => event.stopPropagation()}>
                            <div className="run-summary-grid">
                              <SummaryCard label="Status" value={String(prop(run, 'properties.status') || '-')} />
                              <SummaryCard label="Trigger" value={String(prop(run, 'properties.trigger.name') || '-')} />
                              <SummaryCard label="Started" value={formatDate(prop(run, 'properties.startTime'))} />
                              <SummaryCard label="Duration" value={formatRunDuration(run)} />
                              {prop(run, 'properties.code') ? <SummaryCard label="Code" value={String(prop(run, 'properties.code'))} /> : null}
                              {prop(run, 'properties.correlation.clientTrackingId') ? <SummaryCard label="Tracking ID" value={String(prop(run, 'properties.correlation.clientTrackingId'))} /> : null}
                              {prop(run, 'properties.trigger.status') ? <SummaryCard label="Trigger status" value={String(prop(run, 'properties.trigger.status'))} /> : null}
                            </div>
                            {prop(run, 'properties.error') ? (
                              <div className="action-io-section" style={{ marginBottom: 8 }}>
                                <h3>Run Error</h3>
                                <pre className="viewer" style={{ borderLeft: '3px solid var(--danger)' }} dangerouslySetInnerHTML={{ __html: highlightJson(prop(run, 'properties.error')) }}></pre>
                              </div>
                            ) : null}
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
                              <SummaryCard label="Actions" value={loadingActions ? 'Loading…' : String(actions.length)} />
                              <SummaryCard label="Failed" value={String(actionCounts.Failed || 0)} />
                              <SummaryCard label="Running" value={String(actionCounts.Running || 0)} />
                              <SummaryCard label="Succeeded" value={String(actionCounts.Succeeded || 0)} />
                            </div>
                            <div className="card-list" style={{ marginBottom: 12 }}>
                              {loadingActions ? <div className="empty">Loading actions…</div> : filteredActions.length ? filteredActions.map((action, index) => {
                                const actionStatus = prop(action, 'properties.status') || 'Unknown';
                                const actionCls = actionStatus === 'Succeeded' ? 'ok' : actionStatus === 'Failed' ? 'error' : 'pending';
                                return (
                                  <div key={action.name} className={`action-item ${currentAction?.name === action.name ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); void selectAction(action); }}>
                                    <span className={`health-dot ${actionCls}`}></span>
                                    <span className="action-item-name" title={action.name}>{action.name || 'Unknown'}</span>
                                    <div className="action-item-meta">
                                      <span className="action-item-type">Step {index + 1}</span>
                                      <span className="action-item-type">{actionStatus}</span>
                                      {prop(action, 'properties.type') ? <span className="action-item-type">{String(prop(action, 'properties.type'))}</span> : null}
                                      {prop(action, 'properties.code') && prop(action, 'properties.code') !== actionStatus ? <span className="action-item-type">{String(prop(action, 'properties.code'))}</span> : null}
                                      {prop(action, 'properties.repetitionCount') != null ? <span className="action-item-type">{String(prop(action, 'properties.repetitionCount'))}x</span> : null}
                                      {prop(action, 'properties.retryHistory') ? <span className="action-item-type">{(prop(action, 'properties.retryHistory') as unknown[]).length} retries</span> : null}
                                      <span className="run-duration">{formatRunDuration(action)}</span>
                                    </div>
                                  </div>
                                );
                              }) : <div className="empty">No actions in this run.</div>}
                            </div>
                            {currentAction ? (
                              <div className="run-action-detail">
                                <h2 style={{ marginBottom: 12 }}>{currentAction.name || 'Action Detail'}</h2>
                                <div className="metrics" style={{ marginBottom: 12 }}>
                                  {[
                                    ['Status', String(prop(currentAction, 'properties.status') || '-')],
                                    ['Type', String(prop(currentAction, 'properties.type') || '-')],
                                    ['Code', String(prop(currentAction, 'properties.code') || '-')],
                                    ['Started', formatDate(prop(currentAction, 'properties.startTime'))],
                                    ['Duration', formatRunDuration(currentAction)],
                                    ...(prop(currentAction, 'properties.repetitionCount') != null ? [['Repetitions', String(prop(currentAction, 'properties.repetitionCount'))]] : []),
                                    ...(prop(currentAction, 'properties.correlation.actionTrackingId') ? [['Tracking ID', String(prop(currentAction, 'properties.correlation.actionTrackingId'))]] : []),
                                    ...(prop(currentAction, 'properties.canResubmit') === true ? [['Resubmit', 'Yes']] : []),
                                  ].map(([label, value]) => (
                                    <div className="metric" key={label}>
                                      <div className="metric-label">{label}</div>
                                      <div className="metric-value copy-inline">
                                        <span className="copy-inline-value">{value}</span>
                                        <CopyButton value={value} label="copy" title={`Copy ${label}`} toast={toast} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <ActionIo detail={actionDetail} toast={toast} />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : <div className="empty">No recent runs.</div>}
                </div>
              </div>
            </div>

            <div className={`dv-subpanel ${flowSubTab === 'outline' ? 'active' : ''}`}>
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h2>Outline</h2>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    {analysis?.outline?.length ? `${analysis.outline.length} top-level items` : 'No outline yet'}
                  </div>
                </div>
                {flowSubTab === 'outline' ? <FlowOutlineCanvas items={analysis?.outline || []} /> : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
      {detail.target && environment && (
        <RecordDetailModal initial={detail.target} environment={environment} onClose={detail.close} toast={toast} />
      )}
    </div>
  );
}

function FlowCodeEditor(props: {
  value: string;
  onChange: (value: string) => void;
  onAnalysis: (analysis: FlowAnalysis) => void;
  onAnalyzeStart: () => void;
  onAnalyzeEnd: () => void;
  toast: ToastFn;
}) {
  const { value, onChange, onAnalysis, onAnalyzeStart, onAnalyzeEnd, toast } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const requestRef = useRef(new Map<string, Promise<FlowAnalysis>>());
  const onChangeRef = useRef(onChange);
  const onAnalysisRef = useRef(onAnalysis);
  const onAnalyzeStartRef = useRef(onAnalyzeStart);
  const onAnalyzeEndRef = useRef(onAnalyzeEnd);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onAnalysisRef.current = onAnalysis; }, [onAnalysis]);
  useEffect(() => { onAnalyzeStartRef.current = onAnalyzeStart; }, [onAnalyzeStart]);
  useEffect(() => { onAnalyzeEndRef.current = onAnalyzeEnd; }, [onAnalyzeEnd]);

  useEffect(() => {
    valueRef.current = value;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const analyze = (source: string, cursor: number) => {
      const key = JSON.stringify({ source, cursor });
      const cached = requestRef.current.get(key);
      if (cached) return cached;
      onAnalyzeStartRef.current();
      const request = analyzeFlowDocument(source, cursor).finally(() => {
        requestRef.current.delete(key);
        onAnalyzeEndRef.current();
      });
      requestRef.current.set(key, request);
      return request;
    };
    const acceptCompletionIfOpen = (view: EditorView) => completionStatus(view.state) === 'active' ? acceptCompletion(view) : false;
    const completionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const analysis = await analyze(context.state.doc.toString(), context.pos);
      onAnalysisRef.current(analysis);
      if (!analysis.completions?.length) return null;
      return {
        from: analysis.context?.from ?? context.pos,
        to: analysis.context?.to ?? context.pos,
        options: analysis.completions.map((item) => ({
          label: item.label,
          type: item.type,
          detail: item.detail,
          info: item.info,
          apply: item.apply,
        })),
      };
    };
    const diagnosticSource = async (view: EditorView) => {
      const analysis = await analyze(view.state.doc.toString(), view.state.selection.main.head);
      onAnalysisRef.current(analysis);
      return (analysis.diagnostics || []).map((item) => ({
        from: item.from ?? 0,
        to: item.to ?? item.from ?? 0,
        severity: item.level === 'error' ? 'error' as const : item.level === 'warning' ? 'warning' as const : 'info' as const,
        message: item.message,
        source: item.code,
      }));
    };
    const view = new EditorView({
      parent: mount,
      state: EditorState.create({
        doc: valueRef.current || '',
        extensions: [
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          history(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ override: [completionSource] }),
          linter(diagnosticSource),
          EditorView.lineWrapping,
          Prec.high(keymap.of([
            { key: 'Tab', run: acceptCompletionIfOpen },
            { key: 'Ctrl-Space', run: startCompletion },
            { key: 'Mod-Space', run: startCompletion },
            indentWithTab,
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ])),
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (!update.docChanged && !update.selectionSet) return;
            if (update.docChanged) {
              const next = update.state.doc.toString();
              valueRef.current = next;
              onChangeRef.current(next);
            }
            window.setTimeout(() => {
              void analyze(update.state.doc.toString(), update.state.selection.main.head)
                .then(onAnalysisRef.current)
                .catch((error) => toast(error instanceof Error ? error.message : String(error), true));
            }, 0);
          }),
          automateEditorTheme,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [toast]);

  return <div ref={mountRef} className="fetchxml-editor-mount" />;
}

function FlowOutlineCanvas(props: { items: FlowAnalysisOutlineItem[] }) {
  const { items } = props;
  if (!items.length) return <div className="empty">Load a flow definition to see the outline.</div>;
  return (
    <div style={{ maxHeight: 500, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)' }}>
      <OutlineNodeList items={items} depth={0} />
    </div>
  );
}

function OutlineNodeList(props: { items: FlowAnalysisOutlineItem[]; depth: number }) {
  return (
    <>
      {props.items.map((item, index) => (
        <OutlineNode key={index} item={item} depth={props.depth} last={index === props.items.length - 1} />
      ))}
    </>
  );
}

function OutlineNode(props: { item: FlowAnalysisOutlineItem; depth: number; last: boolean }) {
  const { item, depth, last } = props;
  const [open, setOpen] = useState(false);
  const hasChildren = Boolean(item.children?.length);
  const kind = String(item.kind || '').toLowerCase();
  const dotColor = KIND_DOT[kind] || KIND_DOT.default;
  const hasDetail = Boolean(item.detail || item.type || item.connector || item.inputs || item.runAfter?.length);
  const expandable = hasChildren || hasDetail;
  const indent = depth * 20 + (depth > 0 ? 18 : 8);

  return (
    <div style={{ position: 'relative' }}>
      {depth > 0 && (
        <div style={{
          position: 'absolute', left: depth * 20 + 3, top: 0, bottom: last ? '50%' : 0,
          width: 1, background: 'var(--border)',
        }} />
      )}
      {depth > 0 && (
        <div style={{
          position: 'absolute', left: depth * 20 + 3, top: '50%',
          width: 10, height: 1, background: 'var(--border)',
          transform: 'translateY(-50%)',
        }} />
      )}
      <div
        onClick={() => expandable && setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px 6px ' + indent + 'px',
          cursor: expandable ? 'pointer' : 'default', fontSize: '12px', lineHeight: '18px',
          borderBottom: '1px solid var(--border)',
          background: open ? 'color-mix(in srgb, var(--ink) 4%, transparent)' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(event) => { if (expandable) (event.currentTarget as HTMLElement).style.background = 'color-mix(in srgb, var(--ink) 6%, transparent)'; }}
        onMouseLeave={(event) => { (event.currentTarget as HTMLElement).style.background = open ? 'color-mix(in srgb, var(--ink) 4%, transparent)' : 'transparent'; }}
      >
        <span style={{ width: 12, fontSize: '10px', color: 'var(--muted)', flexShrink: 0, fontFamily: 'monospace', userSelect: 'none' }}>
          {expandable ? (open ? '\u25BE' : '\u25B8') : ''}
        </span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dotColor }} />
        <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.04em', flexShrink: 0, minWidth: 52 }}>
          {item.kind || 'action'}
        </span>
        <span style={{ fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.name || 'Unnamed'}
        </span>
        {hasChildren && (
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--muted)', background: 'var(--border)', borderRadius: 8, padding: '1px 6px', flexShrink: 0 }}>
            {item.children!.length}
          </span>
        )}
      </div>
      {open && hasDetail && (
        <OutlineDetail item={item} indent={indent + 24} />
      )}
      {open && hasChildren && (
        <OutlineNodeList items={item.children!} depth={depth + 1} />
      )}
    </div>
  );
}

const INPUT_LABELS: Record<string, string> = {
  operationId: 'Operation',
  method: 'Method',
  uri: 'URI',
  path: 'Path',
  body: 'Body',
  queries: 'Query params',
  headers: 'Headers',
  variable: 'Variable',
  expression: 'Expression',
  foreach: 'Collection',
  description: 'Description',
  retryPolicy: 'Retry policy',
  concurrency: 'Concurrency',
  staticResult: 'Static result',
  operationOptions: 'Options',
  limitCount: 'Loop limit',
  limitTimeout: 'Loop timeout',
  operationMetadataId: 'Metadata ID',
  flowSystemMetadata: 'System metadata',
};

function OutlineDetail(props: { item: FlowAnalysisOutlineItem; indent: number }) {
  const { item, indent } = props;
  const rows: [string, string][] = [];
  if (item.type) rows.push(['Type', item.type]);
  if (item.detail && item.detail !== item.type) rows.push(['Detail', item.detail]);
  if (item.connector) rows.push(['Connector', item.connector]);
  if (item.runAfter?.length) rows.push(['Run after', item.runAfter.join(', ')]);
  if (item.inputs) {
    for (const [key, value] of Object.entries(item.inputs)) {
      if (value === undefined || value === null) continue;
      const display = typeof value === 'string' ? value
        : typeof value === 'number' ? String(value)
        : JSON.stringify(value, null, 2);
      rows.push([INPUT_LABELS[key] || key, display]);
    }
  }
  if (!rows.length) return null;
  return (
    <div style={{
      paddingLeft: indent, paddingRight: 12, paddingTop: 4, paddingBottom: 6,
      fontSize: '11px', lineHeight: '18px',
      borderBottom: '1px solid var(--border)',
      background: 'color-mix(in srgb, var(--ink) 2%, transparent)',
    }}>
      {rows.map(([label, value]) => {
        const isBlock = value.includes('\n');
        return (
          <div key={label} style={{ display: isBlock ? 'block' : 'flex', gap: 8, marginBottom: isBlock ? 4 : 0 }}>
            <span style={{ color: 'var(--muted)', flexShrink: 0, minWidth: 80 }}>{label}</span>
            {isBlock
              ? <pre style={{ color: 'var(--ink)', margin: '2px 0 0', fontSize: '10px', lineHeight: '15px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{value}</pre>
              : <span style={{ color: 'var(--ink)', wordBreak: 'break-all' }}>{value}</span>
            }
          </div>
        );
      })}
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

function ActionIo(props: { detail: FlowAction | null; toast: ToastFn }) {
  const { detail, toast } = props;
  const [remoteInputs, setRemoteInputs] = useState<unknown>(undefined);
  const [remoteOutputs, setRemoteOutputs] = useState<unknown>(undefined);

  async function fetchRemote(kind: 'input' | 'output', uri: string) {
    try {
      const response = await fetch(uri);
      const text = await response.text();
      let parsed: unknown = text;
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
      {error ? <div className="action-io-section"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3>Error</h3><CopyButton value={error} label="copy" title="Copy error" toast={toast} /></div><pre className="viewer" style={{ borderLeft: '3px solid var(--danger)' }} dangerouslySetInnerHTML={{ __html: highlightJson(error) }}></pre></div> : null}
      {inlineInputs !== undefined ? <div className="action-io-section"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3>Inputs</h3><CopyButton value={inlineInputs} label="copy" title="Copy inputs" toast={toast} /></div><pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(inlineInputs) }}></pre></div> : inputsLink ? (
        <div className="action-io-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Inputs</h3>
            <CopyButton value={inputsLink} label="copy link" title="Copy inputs link" toast={toast} />
          </div>
          <button className="btn btn-secondary" type="button" style={{ fontSize: '0.75rem', padding: '5px 12px', marginBottom: 8 }} onClick={() => void fetchRemote('input', inputsLink)}>Fetch inputs</button>
          {remoteInputs !== undefined ? <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(remoteInputs) }}></pre> : null}
        </div>
      ) : null}
      {inlineOutputs !== undefined ? <div className="action-io-section"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3>Outputs</h3><CopyButton value={inlineOutputs} label="copy" title="Copy outputs" toast={toast} /></div><pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(inlineOutputs) }}></pre></div> : outputsLink ? (
        <div className="action-io-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Outputs</h3>
            <CopyButton value={outputsLink} label="copy link" title="Copy outputs link" toast={toast} />
          </div>
          <button className="btn btn-secondary" type="button" style={{ fontSize: '0.75rem', padding: '5px 12px', marginBottom: 8 }} onClick={() => void fetchRemote('output', outputsLink)}>Fetch outputs</button>
          {remoteOutputs !== undefined ? <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(remoteOutputs) }}></pre> : null}
        </div>
      ) : null}
      {!error && inlineInputs === undefined && inlineOutputs === undefined && !inputsLink && !outputsLink ? (
        <div className="action-io-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3>Properties</h3><CopyButton value={prop(detail, 'properties') || detail} label="copy" title="Copy properties" toast={toast} /></div>
          <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(prop(detail, 'properties') || detail) }}></pre>
        </div>
      ) : null}
      {prop(detail, 'properties.trackedProperties') ? (
        <div className="action-io-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3>Tracked Properties</h3><CopyButton value={prop(detail, 'properties.trackedProperties')} label="copy" title="Copy tracked properties" toast={toast} /></div>
          <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(prop(detail, 'properties.trackedProperties')) }}></pre>
        </div>
      ) : null}
      <RetryHistory retries={detail?.properties?.retryHistory} />
    </>
  );
}

function RetryHistory(props: { retries?: Array<{ startTime?: string; endTime?: string; code?: string; error?: unknown }> }) {
  const { retries } = props;
  if (!retries?.length) return null;
  return (
    <div className="action-io-section">
      <h3>Retry History ({retries.length} {retries.length === 1 ? 'retry' : 'retries'})</h3>
      {retries.map((retry, index) => {
        const start = retry.startTime ? formatDate(retry.startTime) : '-';
        const code = retry.code || '-';
        return (
          <div key={index} style={{ marginBottom: 8, padding: '6px 8px', background: 'color-mix(in srgb, var(--ink) 3%, transparent)', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: retry.error ? 4 : 0 }}>
              <span style={{ color: 'var(--muted)' }}>Attempt {index + 1}</span>
              <span>Code: {code}</span>
              <span style={{ color: 'var(--muted)' }}>{start}</span>
            </div>
            {retry.error ? <pre className="viewer" style={{ borderLeft: '3px solid var(--danger)', margin: '4px 0 0', fontSize: '11px' }} dangerouslySetInnerHTML={{ __html: highlightJson(retry.error) }}></pre> : null}
          </div>
        );
      })}
    </div>
  );
}

function formatRunDuration(item: FlowRun | FlowAction) {
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

function summarizeCounts(items: FlowAction[]) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = String(prop(item, 'properties.status') || 'Unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compareRunsByRecency(a: FlowRun, b: FlowRun) {
  const aStart = timestampValue(prop(a, 'properties.startTime'));
  const bStart = timestampValue(prop(b, 'properties.startTime'));
  return compareNullableDescending(aStart, bStart);
}

function compareActionsByExecutionOrder(a: FlowAction, b: FlowAction) {
  const aStart = timestampValue(prop(a, 'properties.startTime'));
  const bStart = timestampValue(prop(b, 'properties.startTime'));
  const aEnd = timestampValue(prop(a, 'properties.endTime'));
  const bEnd = timestampValue(prop(b, 'properties.endTime'));
  return compareNullableAscending(aStart, bStart)
    || compareNullableAscending(aEnd, bEnd);
}

function timestampValue(value: unknown) {
  if (!value) return null;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

function compareNullableAscending(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareNullableDescending(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
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
