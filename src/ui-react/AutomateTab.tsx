import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api, formatDate, formatDateShort, highlightJson, prop } from './utils.js';
import {
  analyzeFlowDocument,
  checkFlowDefinition,
  flowIdentifier,
  formatFlowDocument,
  loadFlowApiOperations,
  loadActionDetail,
  loadFlowDefinitionDocument,
  loadFlowList,
  loadFlowRuns,
  loadRunActions,
  saveFlowDefinition,
  type FlowValidationItem,
  type FlowValidationKind,
  type FlowValidationResult,
} from './automate-data.js';
import type { DiagnosticItem, FlowAction, FlowAnalysis, FlowAnalysisOutlineItem, FlowApiOperation, FlowItem, FlowRun, ToastFn } from './ui-types.js';
import { CopyButton } from './CopyButton.js';
import { RecordDetailModal, useRecordDetail } from './RecordDetailModal.js';

type AutomateSubTab = 'definition' | 'runs' | 'outline';
type FlowOperation = 'reload' | 'check-errors' | 'check-warnings' | 'save' | null;

type FlowEditorHandle = {
  format: () => string | null;
  revealRange: (from?: number, to?: number) => void;
  revealText: (needle?: string) => void;
};

type FlowProblem = {
  source: 'local' | 'service';
  level: 'error' | 'warning' | 'info';
  code?: string;
  message: string;
  from?: number;
  to?: number;
  path?: string;
  actionName?: string;
  validationItem?: FlowValidationItem;
};

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
  const [loadedFlowDocument, setLoadedFlowDocument] = useState('');
  const [analysis, setAnalysis] = useState<FlowAnalysis | null>(null);
  const [flowValidation, setFlowValidation] = useState<FlowValidationResult | null>(null);
  const [flowOperation, setFlowOperation] = useState<FlowOperation>(null);
  const [showFlowDiff, setShowFlowDiff] = useState(false);
  const [flowFullscreen, setFlowFullscreen] = useState(false);
  const [showAddAction, setShowAddAction] = useState(false);
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
  const flowEditorRef = useRef<FlowEditorHandle | null>(null);

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

  const isFlowEditable = currentFlow?.source === 'flow';
  const isFlowDirty = Boolean(currentFlow && flowDocument !== loadedFlowDocument);
  const flowBusy = flowOperation !== null;
  const flowProblems = useMemo(() => buildFlowProblems(analysis?.diagnostics || [], flowValidation), [analysis?.diagnostics, flowValidation]);
  const hasBlockingServiceErrors = Boolean(flowValidation?.kind === 'errors' && flowValidation.items.some((item) => item.level === 'error'));

  useEffect(() => {
    if (!flowFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFlowFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flowFullscreen]);

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
      setLoadedFlowDocument('');
      setAnalysis(null);
      setFlowValidation(null);
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
    setLoadedFlowDocument(document);
    setFlowValidation(null);
    setRuns(loadedRuns);
  }

  async function reloadFlowDefinition() {
    if (!currentFlow) return;
    setFlowOperation('reload');
    try {
      const document = await loadFlowDefinitionDocument(environment, currentFlow);
      setFlowDocument(document);
      setLoadedFlowDocument(document);
      setFlowValidation(null);
      toast('Flow definition reloaded');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setFlowOperation(null);
    }
  }

  function formatFlowJson() {
    try {
      const formatted = flowEditorRef.current?.format() || formatFlowDocument(flowDocument);
      setFlowDocument(formatted);
      setFlowValidation(null);
      toast('Flow definition formatted');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function updateFlowDocument(next: string) {
    setFlowDocument(next);
    if (flowValidation) setFlowValidation(null);
  }

  function addActionToDocument(actionName: string, action: Record<string, unknown>) {
    try {
      const next = addActionToFlowDocument(flowDocument, actionName, action);
      setFlowDocument(next);
      setFlowValidation(null);
      setShowAddAction(false);
      toast(`Added ${actionName}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function runFlowValidation(kind: FlowValidationKind) {
    if (!currentFlow || currentFlow.source !== 'flow') return;
    setFlowOperation(kind === 'errors' ? 'check-errors' : 'check-warnings');
    try {
      const result = await checkFlowDefinition(environment, currentFlow, flowDocument, kind);
      setFlowValidation(result);
      toast(result.items.length ? `${result.items.length} ${kind} returned` : `No ${kind} returned`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setFlowOperation(null);
    }
  }

  async function saveDefinition(skipServiceCheck = false) {
    if (!currentFlow || currentFlow.source !== 'flow') return;
    setFlowOperation('save');
    try {
      if (!skipServiceCheck) {
        const result = await checkFlowDefinition(environment, currentFlow, flowDocument, 'errors');
        setFlowValidation(result);
        if (result.items.length) {
          toast(`${result.items.length} errors returned. Save blocked.`);
          return;
        }
      }
      const updated = await saveFlowDefinition(environment, currentFlow, flowDocument);
      setLoadedFlowDocument(flowDocument);
      setCurrentFlow(updated);
      setFlows((items) => items.map((item) => flowIdentifier(item) === flowIdentifier(currentFlow) ? { ...item, ...updated } : item));
      toast(skipServiceCheck ? 'Flow definition saved without service check' : 'Flow definition checked and saved');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setFlowOperation(null);
    }
  }

  function jumpToEditorRange(from?: number, to?: number) {
    setFlowSubTab('definition');
    window.setTimeout(() => flowEditorRef.current?.revealRange(from, to), 0);
  }

  function jumpToProblem(problem: FlowProblem) {
    setFlowSubTab('definition');
    window.setTimeout(() => {
      if (problem.validationItem && (problem.validationItem.from !== undefined || problem.validationItem.to !== undefined)) {
        flowEditorRef.current?.revealRange(problem.validationItem.from, problem.validationItem.to);
      } else if (problem.from !== undefined || problem.to !== undefined) {
        flowEditorRef.current?.revealRange(problem.from, problem.to);
      } else {
        flowEditorRef.current?.revealText(problem.actionName || problem.path || problem.code);
      }
    }, 0);
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
                <div key={flowIdentifier(flow)} className={`entity-item ${flowIdentifier(currentFlow) === flowIdentifier(flow) ? 'active' : ''}`} data-flow={flowIdentifier(flow)} onClick={() => void selectFlow(flow)}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h2>Definition</h2>
                    {isFlowDirty ? <span className="entity-item-flag" style={{ color: '#d97706', borderColor: '#d97706' }}>unsaved</span> : null}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{flowOperation ? 'Working…' : analyzing ? 'Analyzing…' : analysis ? 'Analysis updated' : 'Definition not loaded'}</div>
                </div>
                <div className={`fetchxml-editor-shell ${flowFullscreen ? 'flow-editor-shell-fullscreen' : ''}`}>
                  <div className="fetchxml-editor-toolbar">
                    <div className="fetchxml-editor-toolbar-left">
                      <button className="btn btn-ghost" type="button" disabled={flowBusy} onClick={() => void reloadFlowDefinition()}>{flowOperation === 'reload' ? 'Reloading…' : 'Reload'}</button>
                      <button className="btn btn-ghost" type="button" disabled={!flowDocument.trim()} onClick={formatFlowJson}>Format JSON</button>
                      <button className="btn btn-ghost" type="button" disabled={!flowDocument.trim()} onClick={() => setShowAddAction(true)}>Add Action</button>
                      <button className="btn btn-ghost" type="button" disabled={!isFlowDirty} onClick={() => setShowFlowDiff(true)}>View Changes</button>
                      <button className="btn btn-ghost" type="button" onClick={() => setFlowFullscreen((value) => !value)}>{flowFullscreen ? 'Exit Full Screen' : 'Full Screen'}</button>
                    </div>
                    <div className="fetchxml-editor-toolbar-right">
                      <button className="btn btn-ghost" type="button" disabled={!isFlowEditable || flowBusy} onClick={() => void runFlowValidation('errors')}>{flowOperation === 'check-errors' ? 'Checking…' : 'Check Errors'}</button>
                      <button className="btn btn-ghost" type="button" disabled={!isFlowEditable || flowBusy} onClick={() => void runFlowValidation('warnings')}>{flowOperation === 'check-warnings' ? 'Checking…' : 'Check Warnings'}</button>
                      {hasBlockingServiceErrors ? (
                        <button className="btn btn-ghost" type="button" disabled={!isFlowEditable || flowBusy || !isFlowDirty} onClick={() => void saveDefinition(true)}>Save Anyway</button>
                      ) : null}
                      <button className="btn btn-primary" type="button" disabled={!isFlowEditable || flowBusy || !isFlowDirty} onClick={() => void saveDefinition()}>{flowOperation === 'save' ? 'Checking…' : 'Check & Save'}</button>
                    </div>
                  </div>
                  <div className="flow-editor-layout">
                    <div className="flow-editor-main">
                      <FlowCodeEditor
                        ref={flowEditorRef}
                        value={flowDocument}
                        onChange={updateFlowDocument}
                        diagnostics={analysis?.diagnostics || []}
                        validation={flowValidation}
                        analysis={analysis}
                        toast={toast}
                      />
                    </div>
                    <aside className="flow-outline-rail">
                      <div className="flow-rail-header">
                        <h3>Outline</h3>
                        <span>{analysis?.summary?.actionCount || 0} actions</span>
                      </div>
                      <FlowOutlineCanvas items={analysis?.outline || []} onJump={jumpToEditorRange} />
                    </aside>
                  </div>
                </div>
                <div className="flow-summary-grid" style={{ marginTop: 12 }}>
                  {[
                    ['Wrapper', analysis?.summary?.wrapperKind || 'unknown'],
                    ['Triggers', String(analysis?.summary?.triggerCount || 0)],
                    ['Actions', String(analysis?.summary?.actionCount || 0)],
                    ['Variables', String(analysis?.summary?.variableCount || 0)],
                    ['Parameters', String(analysis?.summary?.parameterCount || 0)],
                    ['Service check', flowValidation ? `${flowValidation.items.length} ${flowValidation.kind}` : 'not run'],
                  ].map(([label, value]) => (
                    <div key={label} className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>
                  ))}
                </div>
                <FlowProblemsPanel problems={flowProblems} validation={flowValidation} onJump={jumpToProblem} toast={toast} />
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
                        <div className={`run-item status-${cls} ${expanded ? 'active' : ''}`} data-flow-run={run.name || ''} onClick={() => void selectRun(run)}>
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
                                  <div key={action.name} className={`action-item ${currentAction?.name === action.name ? 'active' : ''}`} data-flow-action={action.name || ''} onClick={(event) => { event.stopPropagation(); void selectAction(action); }}>
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
                {flowSubTab === 'outline' ? <FlowOutlineCanvas items={analysis?.outline || []} onJump={jumpToEditorRange} /> : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
      {detail.target && environment && (
        <RecordDetailModal initial={detail.target} environment={environment} onClose={detail.close} toast={toast} />
      )}
      {showFlowDiff ? (
        <FlowDiffModal original={loadedFlowDocument} modified={flowDocument} onClose={() => setShowFlowDiff(false)} />
      ) : null}
      {showAddAction && currentFlow ? (
        <AddFlowActionModal
          environment={environment}
          source={flowDocument}
          analysis={analysis}
          onClose={() => setShowAddAction(false)}
          onAdd={addActionToDocument}
          toast={toast}
        />
      ) : null}
    </div>
  );
}

const FlowCodeEditor = forwardRef<FlowEditorHandle, {
  value: string;
  onChange: (value: string) => void;
  diagnostics: DiagnosticItem[];
  validation: FlowValidationResult | null;
  analysis: FlowAnalysis | null;
  toast: ToastFn;
}>((props, ref) => {
  const { value, onChange, diagnostics, validation, analysis, toast } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const diagnosticsRef = useRef(diagnostics);
  const validationRef = useRef(validation);
  const analysisRef = useRef(analysis);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { diagnosticsRef.current = diagnostics; }, [diagnostics]);
  useEffect(() => { validationRef.current = validation; }, [validation]);
  useEffect(() => { analysisRef.current = analysis; }, [analysis]);

  useEffect(() => {
    valueRef.current = value;
    const model = modelRef.current;
    if (!model) return;
    if (model.getValue() !== value) model.setValue(value);
  }, [value]);

  useEffect(() => {
    updateFlowEditorMarkers(modelRef.current, diagnostics, validation);
  }, [diagnostics, validation, value]);

  useImperativeHandle(ref, () => ({
    format: () => {
      const editor = editorRef.current;
      const model = modelRef.current;
      if (!editor || !model) return null;
      const formatted = formatFlowDocument(model.getValue());
      editor.pushUndoStop();
      editor.executeEdits('format-json', [{ range: model.getFullModelRange(), text: formatted }]);
      editor.pushUndoStop();
      return formatted;
    },
    revealRange: (from, to) => {
      const editor = editorRef.current;
      const model = modelRef.current;
      if (!editor || !model) return;
      const start = model.getPositionAt(Math.max(0, from ?? 0));
      const end = model.getPositionAt(Math.max(from ?? 0, to ?? from ?? 0));
      const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
      editor.setSelection(range);
      editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
      editor.focus();
    },
    revealText: (needle) => {
      const editor = editorRef.current;
      const model = modelRef.current;
      if (!editor || !model || !needle) return;
      const index = model.getValue().indexOf(needle);
      if (index < 0) return;
      const start = model.getPositionAt(index);
      const end = model.getPositionAt(index + needle.length);
      const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
      editor.setSelection(range);
      editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
      editor.focus();
    },
  }), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    applyMonacoAppTheme();
    const model = monaco.editor.createModel(valueRef.current || '', 'json', monaco.Uri.parse('inmemory://pp/flow-definition.json'));
    const editor = monaco.editor.create(mount, {
      model,
      automaticLayout: true,
      folding: true,
      fontFamily: 'var(--mono)',
      fontSize: 13,
      glyphMargin: true,
      lineNumbers: 'on',
      minimap: { enabled: false },
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'on',
      theme: 'pp-app',
    });
    const completionProvider = monaco.languages.registerCompletionItemProvider('json', {
      triggerCharacters: ['"', "'", '@', ':'],
      provideCompletionItems: async (completionModel, position) => {
        if (completionModel.uri.toString() !== model.uri.toString()) return { suggestions: [] };
        const source = completionModel.getValue();
        const cursor = completionModel.getOffsetAt(position);
        try {
          const currentAnalysis = await analyzeFlowDocument(source, cursor);
          analysisRef.current = currentAnalysis;
          return {
            suggestions: [
              ...flowAnalysisCompletions(completionModel, position, currentAnalysis),
              ...flowSnippetCompletions(completionModel, position),
            ],
          };
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
          return { suggestions: flowSnippetCompletions(completionModel, position) };
        }
      },
    });
    const hoverProvider = monaco.languages.registerHoverProvider('json', {
      provideHover: (hoverModel, position) => {
        if (hoverModel.uri.toString() !== model.uri.toString()) return null;
        const offset = hoverModel.getOffsetAt(position);
        const hover = flowHoverAtOffset(analysisRef.current, offset);
        if (!hover) return null;
        return { contents: [{ value: hover }] };
      },
    });
    modelRef.current = model;
    editorRef.current = editor;

    const themeObserver = new MutationObserver(() => applyMonacoAppTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const contentSubscription = editor.onDidChangeModelContent(() => {
      const next = model.getValue();
      valueRef.current = next;
      onChangeRef.current(next);
    });

    updateFlowEditorMarkers(model, diagnosticsRef.current, validationRef.current);
    return () => {
      themeObserver.disconnect();
      contentSubscription.dispose();
      completionProvider.dispose();
      hoverProvider.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  return <div ref={mountRef} className="fetchxml-editor-mount" />;
});

FlowCodeEditor.displayName = 'FlowCodeEditor';

function applyMonacoAppTheme() {
  const computed = window.getComputedStyle(document.documentElement);
  const bg = cssColor(computed, '--bg', '#f9fafb');
  const surface = cssColor(computed, '--surface', '#ffffff');
  const ink = cssColor(computed, '--ink', '#111111');
  const muted = cssColor(computed, '--muted', '#6b7280');
  const border = cssColor(computed, '--border', '#e5e7eb');
  const accent = cssColor(computed, '--accent', '#2563eb');
  const danger = cssColor(computed, '--danger', '#dc2626');
  const isDark = document.documentElement.classList.contains('dark');

  monaco.editor.defineTheme('pp-app', {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: stripHash(accent) },
      { token: 'string.value.json', foreground: stripHash(isDark ? '#a7f3d0' : '#047857') },
      { token: 'number.json', foreground: stripHash(isDark ? '#fbbf24' : '#b45309') },
      { token: 'keyword.json', foreground: stripHash(isDark ? '#c4b5fd' : '#7c3aed') },
      { token: 'delimiter.bracket.json', foreground: stripHash(muted) },
    ],
    colors: {
      'editor.background': surface,
      'editor.foreground': ink,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': ink,
      'editorCursor.foreground': ink,
      'editor.selectionBackground': rgbaHex(accent, isDark ? 0.32 : 0.18),
      'editor.inactiveSelectionBackground': rgbaHex(accent, isDark ? 0.18 : 0.10),
      'editor.lineHighlightBackground': isDark ? '#1c1c1f' : '#f3f4f6',
      'editorLineNumber.dimmedForeground': muted,
      'editorGutter.background': bg,
      'editorWidget.background': surface,
      'editorWidget.foreground': ink,
      'editorWidget.border': border,
      'input.background': bg,
      'input.foreground': ink,
      'input.border': border,
      'list.hoverBackground': rgbaHex(accent, isDark ? 0.18 : 0.10),
      'list.activeSelectionBackground': rgbaHex(accent, isDark ? 0.28 : 0.14),
      'list.activeSelectionForeground': ink,
      'list.focusBackground': rgbaHex(accent, isDark ? 0.22 : 0.12),
      'scrollbarSlider.background': rgbaHex(muted, isDark ? 0.30 : 0.20),
      'scrollbarSlider.hoverBackground': rgbaHex(muted, isDark ? 0.42 : 0.32),
      'scrollbarSlider.activeBackground': rgbaHex(muted, isDark ? 0.52 : 0.42),
      'editorError.foreground': danger,
      'editorWarning.foreground': isDark ? '#fbbf24' : '#d97706',
      'editorInfo.foreground': accent,
    },
  });
  monaco.editor.setTheme('pp-app');
}

function cssColor(computed: CSSStyleDeclaration, name: string, fallback: string) {
  return computed.getPropertyValue(name).trim() || fallback;
}

function stripHash(color: string) {
  return color.startsWith('#') ? color.slice(1) : color;
}

function rgbaHex(color: string, alpha: number) {
  if (!color.startsWith('#')) return color;
  const hex = color.length === 4
    ? color.slice(1).split('').map((value) => value + value).join('')
    : color.slice(1);
  if (hex.length !== 6) return color;
  const value = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `#${hex}${value}`;
}

function updateFlowEditorMarkers(model: monaco.editor.ITextModel | null, diagnostics: DiagnosticItem[], validation: FlowValidationResult | null) {
  if (!model) return;
  const markers: monaco.editor.IMarkerData[] = [];
  for (const item of diagnostics || []) {
    markers.push(markerFromOffsets(model, item.from ?? 0, item.to ?? item.from ?? 0, item.message, severityFromLevel(item.level), item.code));
  }
  if (validation) for (const item of validation.items) {
    const offsets = validationOffsets(model, item);
    markers.push(markerFromOffsets(model, offsets.from, offsets.to, item.message, severityFromLevel(item.level), item.code || validation.kind));
  }
  monaco.editor.setModelMarkers(model, 'pp-flow', markers);
}

function markerFromOffsets(model: monaco.editor.ITextModel, from: number, to: number, message: string, severity: monaco.MarkerSeverity, source?: string): monaco.editor.IMarkerData {
  const start = model.getPositionAt(Math.max(0, from));
  const end = model.getPositionAt(Math.max(from, to || from + 1));
  return {
    severity,
    message,
    source,
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: Math.max(end.column, start.column + 1),
  };
}

function validationOffsets(model: monaco.editor.ITextModel, item: FlowValidationItem) {
  if (item.from !== undefined || item.to !== undefined) return { from: item.from ?? 0, to: item.to ?? item.from ?? 1 };
  const text = model.getValue();
  const needle = item.operationMetadataId || item.actionName || item.path || item.code;
  if (needle) {
    const index = text.indexOf(needle);
    if (index >= 0) return { from: index, to: index + needle.length };
  }
  return { from: 0, to: 1 };
}

function severityFromLevel(level: string | undefined): monaco.MarkerSeverity {
  if (level === 'error') return monaco.MarkerSeverity.Error;
  if (level === 'warning') return monaco.MarkerSeverity.Warning;
  return monaco.MarkerSeverity.Info;
}

function flowAnalysisCompletions(model: monaco.editor.ITextModel, position: monaco.Position, analysis: FlowAnalysis): monaco.languages.CompletionItem[] {
  const range = completionRange(model, position);
  return (analysis.completions || []).map((item) => ({
    label: item.label,
    kind: completionKind(item.type),
    detail: item.detail || item.type,
    documentation: item.info,
    insertText: item.apply || item.label,
    range,
  }));
}

function flowSnippetCompletions(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.CompletionItem[] {
  const range = completionRange(model, position);
  return FLOW_SNIPPETS.map((snippet) => ({
    label: snippet.label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    detail: snippet.detail,
    documentation: snippet.documentation,
    insertText: snippet.insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
  }));
}

function completionRange(model: monaco.editor.ITextModel, position: monaco.Position): monaco.IRange {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
}

function completionKind(type: string | undefined): monaco.languages.CompletionItemKind {
  if (type === 'property') return monaco.languages.CompletionItemKind.Property;
  if (type === 'function') return monaco.languages.CompletionItemKind.Function;
  if (type === 'action') return monaco.languages.CompletionItemKind.Reference;
  if (type === 'variable') return monaco.languages.CompletionItemKind.Variable;
  if (type === 'parameter') return monaco.languages.CompletionItemKind.Value;
  if (type === 'keyword') return monaco.languages.CompletionItemKind.Keyword;
  return monaco.languages.CompletionItemKind.Value;
}

const FLOW_SNIPPETS = [
  {
    label: 'pa:compose action',
    detail: 'Compose action',
    documentation: 'Insert a Compose action body.',
    insertText: [
      '"${1:Compose}": {',
      '  "type": "Compose",',
      '  "inputs": ${2:"value"},',
      '  "runAfter": {${3}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:condition action',
    detail: 'Condition action',
    documentation: 'Insert an If action with true and false branches.',
    insertText: [
      '"${1:Condition}": {',
      '  "type": "If",',
      '  "expression": {',
      '    "equals": [',
      '      ${2:"left"},',
      '      ${3:"right"}',
      '    ]',
      '  },',
      '  "actions": {',
      '    ${4}',
      '  },',
      '  "else": {',
      '    "actions": {',
      '      ${5}',
      '    }',
      '  },',
      '  "runAfter": {${6}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:scope action',
    detail: 'Scope action',
    documentation: 'Insert a Scope action.',
    insertText: [
      '"${1:Scope}": {',
      '  "type": "Scope",',
      '  "actions": {',
      '    ${2}',
      '  },',
      '  "runAfter": {${3}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:foreach action',
    detail: 'Foreach action',
    documentation: 'Insert a Foreach loop.',
    insertText: [
      '"${1:Apply_to_each}": {',
      '  "type": "Foreach",',
      "  \"foreach\": \"${2:@outputs('Compose')}\",",
      '  "actions": {',
      '    ${3}',
      '  },',
      '  "runAfter": {${4}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:http action',
    detail: 'HTTP action',
    documentation: 'Insert an HTTP action.',
    insertText: [
      '"${1:HTTP}": {',
      '  "type": "Http",',
      '  "inputs": {',
      '    "method": "${2:GET}",',
      '    "uri": "${3:https://example.com}"',
      '  },',
      '  "runAfter": {${4}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:initialize variable',
    detail: 'Initialize variable action',
    documentation: 'Insert an InitializeVariable action.',
    insertText: [
      '"${1:Initialize_variable}": {',
      '  "type": "InitializeVariable",',
      '  "inputs": {',
      '    "variables": [',
      '      {',
      '        "name": "${2:name}",',
      '        "type": "${3:string}",',
      '        "value": ${4:""}',
      '      }',
      '    ]',
      '  },',
      '  "runAfter": {${5}}',
      '}',
    ].join('\n'),
  },
  {
    label: 'pa:set variable',
    detail: 'Set variable action',
    documentation: 'Insert a SetVariable action.',
    insertText: [
      '"${1:Set_variable}": {',
      '  "type": "SetVariable",',
      '  "inputs": {',
      '    "name": "${2:name}",',
      '    "value": ${3:"value"}',
      '  },',
      '  "runAfter": {${4}}',
      '}',
    ].join('\n'),
  },
] as const;

function flowHoverAtOffset(analysis: FlowAnalysis | null, offset: number): string | null {
  const item = findOutlineAtOffset(analysis?.outline || [], offset);
  if (!item) return null;
  const lines = [
    `**${escapeMarkdown(item.name || 'Workflow')}**`,
    item.type ? `Type: \`${escapeMarkdown(item.type)}\`` : item.detail ? `Detail: \`${escapeMarkdown(item.detail)}\`` : '',
    item.connector ? `Connector: \`${escapeMarkdown(item.connector)}\`` : '',
    item.runAfter?.length ? `Runs after: ${item.runAfter.map((value) => `\`${escapeMarkdown(value)}\``).join(', ')}` : '',
  ].filter(Boolean);
  if (item.inputs) {
    for (const [key, value] of Object.entries(item.inputs).slice(0, 6)) {
      if (value === undefined || value === null) continue;
      const display = typeof value === 'string' ? value : JSON.stringify(value);
      lines.push(`${INPUT_LABELS[key] || key}: \`${escapeMarkdown(shorten(display, 140))}\``);
    }
  }
  return lines.join('\n\n');
}

function findOutlineAtOffset(items: FlowAnalysisOutlineItem[], offset: number): FlowAnalysisOutlineItem | null {
  for (const item of items) {
    if ((item.from ?? -1) <= offset && offset <= (item.to ?? -1)) {
      return findOutlineAtOffset(item.children || [], offset) || item;
    }
  }
  return null;
}

function escapeMarkdown(value: string) {
  return value.replace(/[`\\]/g, '\\$&');
}

function shorten(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

function buildFlowProblems(diagnostics: DiagnosticItem[], validation: FlowValidationResult | null): FlowProblem[] {
  const local = diagnostics.map((item): FlowProblem => ({
    source: 'local',
    level: normalizeProblemLevel(item.level),
    code: item.code,
    message: item.message,
    from: item.from,
    to: item.to,
  }));
  const service = (validation?.items || []).map((item): FlowProblem => ({
    source: 'service',
    level: normalizeProblemLevel(item.level),
    code: item.code || validation?.kind,
    message: item.message,
    from: item.from,
    to: item.to,
    path: item.path,
    actionName: item.actionName,
    validationItem: item,
  }));
  return [...local, ...service].sort((a, b) => problemRank(a.level) - problemRank(b.level));
}

function normalizeProblemLevel(level: string | undefined): FlowProblem['level'] {
  if (level === 'error' || level === 'warning') return level;
  return 'info';
}

function problemRank(level: FlowProblem['level']) {
  if (level === 'error') return 0;
  if (level === 'warning') return 1;
  return 2;
}

function FlowProblemsPanel(props: { problems: FlowProblem[]; validation: FlowValidationResult | null; onJump: (problem: FlowProblem) => void; toast: ToastFn }) {
  const { problems, validation, onJump, toast } = props;
  const counts = {
    error: problems.filter((item) => item.level === 'error').length,
    warning: problems.filter((item) => item.level === 'warning').length,
    info: problems.filter((item) => item.level === 'info').length,
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>Problems</h3>
          <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
            {counts.error} errors · {counts.warning} warnings · {counts.info} info
            {validation ? ` · service ${validation.kind} checked ${formatDate(validation.checkedAt)}` : ''}
          </div>
        </div>
        {validation ? <CopyButton value={validation.raw} label="Copy raw" title="Copy raw validation response" toast={toast} /> : null}
      </div>
      <div className="fetchxml-diagnostics">
        {problems.length ? problems.slice(0, 80).map((item, index) => (
          <button
            key={index}
            type="button"
            className={`fetchxml-diagnostic ${item.level}`}
            style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onJump(item)}
          >
            <div className="fetchxml-diagnostic-code">
              {item.source}
              {' · '}
              {item.code || item.level.toUpperCase()}
              {item.actionName ? ` · ${item.actionName}` : ''}
              {item.path ? ` · ${item.path}` : ''}
              {item.from !== undefined ? ` @ ${item.from}` : ''}
            </div>
            <div className="fetchxml-diagnostic-message">{item.message}</div>
          </button>
        )) : <div className="empty">No problems.</div>}
      </div>
      {validation ? <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.75rem' }}>Raw response</summary>
        <pre className="viewer" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: highlightJson(validation.raw) }}></pre>
      </details> : null}
    </div>
  );
}

const BUILT_IN_ACTION_TEMPLATES = [
  { key: 'compose', label: 'Compose', name: 'Compose', action: () => ({ type: 'Compose', inputs: '' }) },
  { key: 'http', label: 'HTTP', name: 'HTTP', action: () => ({ type: 'Http', inputs: { method: 'GET', uri: '' } }) },
  { key: 'scope', label: 'Scope', name: 'Scope', action: () => ({ type: 'Scope', actions: {} }) },
  { key: 'condition', label: 'Condition', name: 'Condition', action: () => ({ type: 'If', expression: { equals: ['', ''] }, actions: {}, else: { actions: {} } }) },
] as const;

type BuiltInActionTemplate = typeof BUILT_IN_ACTION_TEMPLATES[number];

function AddFlowActionModal(props: {
  environment: string;
  source: string;
  analysis: FlowAnalysis | null;
  onClose: () => void;
  onAdd: (actionName: string, action: Record<string, unknown>) => void;
  toast: ToastFn;
}) {
  const [search, setSearch] = useState('');
  const [operations, setOperations] = useState<FlowApiOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState<FlowApiOperation | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<BuiltInActionTemplate | null>(BUILT_IN_ACTION_TEMPLATES[0]);
  const [actionName, setActionName] = useState('Compose');
  const [runAfter, setRunAfter] = useState('');
  const topLevelActions = useMemo(() => topLevelActionNames(props.analysis), [props.analysis]);

  useEffect(() => {
    if (!runAfter && topLevelActions.length) setRunAfter(topLevelActions[topLevelActions.length - 1] || '');
  }, [runAfter, topLevelActions]);

  async function searchOperations() {
    setLoading(true);
    try {
      const result = await loadFlowApiOperations(props.environment, search);
      setOperations(result);
      if (!result.length) props.toast('No operations returned');
    } catch (error) {
      props.toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
    }
  }

  function selectOperation(operation: FlowApiOperation) {
    setSelectedOperation(operation);
    setSelectedTemplate(null);
    setActionName(uniqueActionName(props.source, sanitizeActionName(operation.summary || operation.name || 'Action')));
  }

  function selectTemplate(template: BuiltInActionTemplate) {
    setSelectedTemplate(template);
    setSelectedOperation(null);
    setActionName(uniqueActionName(props.source, template.name));
  }

  function addAction() {
    const runAfterValue = buildRunAfter(runAfter);
    if (selectedOperation) {
      props.onAdd(actionName, buildApiOperationAction(props.source, selectedOperation, runAfterValue));
      return;
    }
    if (selectedTemplate) {
      props.onAdd(actionName, { ...selectedTemplate.action(), runAfter: runAfterValue });
    }
  }

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal add-action-modal">
        <div className="rt-modal-header">
          <div>
            <h2>Add Action</h2>
            <p className="desc" style={{ marginBottom: 0 }}>Insert an action into the current workflow definition.</p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={props.onClose}>Close</button>
        </div>
        <div className="rt-modal-body add-action-body">
          <div className="add-action-section">
            <h3>Built-in</h3>
            <div className="add-action-template-row">
              {BUILT_IN_ACTION_TEMPLATES.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  className={`btn ${selectedTemplate?.key === template.key ? '' : 'btn-ghost'}`}
                  onClick={() => selectTemplate(template)}
                >
                  {template.label}
                </button>
              ))}
            </div>
          </div>
          <div className="add-action-section">
            <h3>Connector Operations</h3>
            <div className="add-action-search">
              <input
                type="text"
                value={search}
                placeholder="Search apioperations..."
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void searchOperations(); }}
              />
              <button className="btn btn-ghost" type="button" disabled={loading} onClick={() => void searchOperations()}>{loading ? 'Searching...' : 'Search'}</button>
            </div>
            <div className="add-action-results">
              {operations.length ? operations.map((operation) => (
                <button
                  key={`${operation.apiId || operation.apiName}:${operation.name}`}
                  type="button"
                  className={`add-action-operation ${selectedOperation?.name === operation.name && selectedOperation?.apiId === operation.apiId ? 'active' : ''}`}
                  onClick={() => selectOperation(operation)}
                >
                  <span className="add-action-operation-title">{operation.summary || operation.name}</span>
                  <span className="add-action-operation-meta">{operation.apiDisplayName || operation.apiName || 'Connector'} · {operation.name}</span>
                  {operation.description ? <span className="add-action-operation-desc">{operation.description}</span> : null}
                </button>
              )) : <div className="empty">{loading ? 'Searching operations...' : 'Search Flow apioperations to insert a connector action.'}</div>}
            </div>
          </div>
          <div className="add-action-section add-action-form">
            <label>
              <span>Action name</span>
              <input type="text" value={actionName} onChange={(event) => setActionName(sanitizeActionName(event.target.value))} />
            </label>
            <label>
              <span>Run after</span>
              <select value={runAfter} onChange={(event) => setRunAfter(event.target.value)}>
                <option value="">none</option>
                {topLevelActions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            {selectedOperation ? (
              <div className="add-action-note">
                Connector action will use the matching connection reference when one exists, otherwise it inserts a placeholder reference for {selectedOperation.apiDisplayName || selectedOperation.apiName || 'the connector'}.
              </div>
            ) : null}
          </div>
        </div>
        <div className="rt-modal-header add-action-footer">
          <div className="desc" style={{ marginBottom: 0 }}>{selectedOperation ? selectedOperation.name : selectedTemplate?.label || 'No action selected'}</div>
          <button className="btn btn-primary" type="button" disabled={!actionName.trim() || (!selectedOperation && !selectedTemplate)} onClick={addAction}>Insert Action</button>
        </div>
      </div>
    </div>
  );
}

function addActionToFlowDocument(source: string, actionName: string, action: Record<string, unknown>): string {
  const root = JSON.parse(source) as unknown;
  if (!isObject(root)) throw new Error('Flow definition JSON must be an object.');
  const definition = findMutableWorkflowDefinition(root);
  if (!definition) throw new Error('Could not find workflow definition actions.');
  const actions = isObject(definition.actions) ? definition.actions : {};
  definition.actions = actions;
  if (Object.prototype.hasOwnProperty.call(actions, actionName)) {
    throw new Error(`${actionName} already exists.`);
  }
  actions[actionName] = action;
  return JSON.stringify(root, null, 2);
}

function findMutableWorkflowDefinition(root: Record<string, unknown>): Record<string, unknown> | null {
  if (isObject(root.actions) || isObject(root.triggers)) return root;
  if (isObject(root.definition) && (isObject(root.definition.actions) || isObject(root.definition.triggers))) return root.definition;
  if (isObject(root.properties) && isObject(root.properties.definition)) return root.properties.definition;
  return null;
}

function buildApiOperationAction(source: string, operation: FlowApiOperation, runAfter: Record<string, string[]>): Record<string, unknown> {
  const connectionReferenceName = findConnectionReferenceName(source, operation) || (operation.apiName ? `shared_${operation.apiName}` : 'shared_connector');
  const host: Record<string, unknown> = {
    connectionReferenceName,
    operationId: operation.name,
  };
  if (operation.apiId) host.apiId = operation.apiId;
  return {
    type: operation.operationType || 'OpenApiConnection',
    inputs: {
      host,
      parameters: {},
    },
    runAfter,
  };
}

function findConnectionReferenceName(source: string, operation: FlowApiOperation): string | undefined {
  try {
    const root = JSON.parse(source) as unknown;
    if (!isObject(root)) return undefined;
    const properties = isObject(root.properties) ? root.properties : root;
    const refs = isObject(properties.connectionReferences) ? properties.connectionReferences : isObject(root.connectionReferences) ? root.connectionReferences : undefined;
    if (!refs) return undefined;
    for (const [key, value] of Object.entries(refs)) {
      if (!isObject(value)) continue;
      const apiId = String(prop(value, 'api.id') || prop(value, 'apiId') || '');
      const apiName = String(prop(value, 'api.name') || prop(value, 'apiName') || '');
      if (operation.apiId && apiId && apiId.toLowerCase() === operation.apiId.toLowerCase()) return key;
      if (operation.apiName && apiName && apiName.toLowerCase().includes(operation.apiName.toLowerCase())) return key;
      if (operation.apiName && key.toLowerCase().includes(operation.apiName.toLowerCase())) return key;
    }
  } catch {}
  return undefined;
}

function buildRunAfter(actionName: string): Record<string, string[]> {
  return actionName ? { [actionName]: ['Succeeded'] } : {};
}

function topLevelActionNames(analysis: FlowAnalysis | null): string[] {
  const workflow = analysis?.outline?.find((item) => item.kind === 'workflow') || analysis?.outline?.[0];
  const actions = workflow?.children?.find((item) => item.name === 'actions' || item.kind === 'action');
  return (actions?.children || []).map((item) => item.name).filter((name): name is string => Boolean(name));
}

function uniqueActionName(source: string, preferred: string): string {
  const base = sanitizeActionName(preferred || 'Action') || 'Action';
  const existing = new Set<string>();
  try {
    const root = JSON.parse(source) as unknown;
    if (isObject(root)) {
      const definition = findMutableWorkflowDefinition(root);
      const actions = definition && isObject(definition.actions) ? definition.actions : {};
      for (const key of Object.keys(actions)) existing.add(key);
    }
  } catch {}
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1000; index++) {
    const next = `${base}_${index}`;
    if (!existing.has(next)) return next;
  }
  return `${base}_${Date.now()}`;
}

function sanitizeActionName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Action';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function FlowDiffModal(props: { original: string; modified: string; onClose: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    applyMonacoAppTheme();
    const originalModel = monaco.editor.createModel(props.original || '', 'json');
    const modifiedModel = monaco.editor.createModel(props.modified || '', 'json');
    const editor = monaco.editor.createDiffEditor(mount, {
      automaticLayout: true,
      originalEditable: false,
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      theme: 'pp-app',
    });
    editor.setModel({ original: originalModel, modified: modifiedModel });
    return () => {
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [props.original, props.modified]);

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal flow-diff-modal">
        <div className="rt-modal-header">
          <div>
            <h2>Unsaved Changes</h2>
            <p className="desc" style={{ marginBottom: 0 }}>Review the loaded definition beside the current editor content.</p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={props.onClose}>Close</button>
        </div>
        <div ref={mountRef} className="flow-diff-editor" />
      </div>
    </div>
  );
}

function FlowOutlineCanvas(props: { items: FlowAnalysisOutlineItem[]; onJump: (from?: number, to?: number) => void }) {
  const { items } = props;
  if (!items.length) return <div className="empty">Load a flow definition to see the outline.</div>;
  return (
    <div style={{ maxHeight: 500, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)' }}>
      <OutlineNodeList items={items} depth={0} onJump={props.onJump} />
    </div>
  );
}

function OutlineNodeList(props: { items: FlowAnalysisOutlineItem[]; depth: number; onJump: (from?: number, to?: number) => void }) {
  return (
    <>
      {props.items.map((item, index) => (
        <OutlineNode key={index} item={item} depth={props.depth} last={index === props.items.length - 1} onJump={props.onJump} />
      ))}
    </>
  );
}

function OutlineNode(props: { item: FlowAnalysisOutlineItem; depth: number; last: boolean; onJump: (from?: number, to?: number) => void }) {
  const { item, depth, last, onJump } = props;
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
        onClick={() => {
          onJump(item.from, item.to);
          if (expandable) setOpen(!open);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px 6px ' + indent + 'px',
          cursor: 'pointer', fontSize: '12px', lineHeight: '18px',
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
        <OutlineNodeList items={item.children!} depth={depth + 1} onJump={onJump} />
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
