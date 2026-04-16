import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api, formatDate, formatDateShort, highlightJson, prop } from './utils.js';
import {
  analyzeFlowDocument,
  checkFlowDefinition,
  flowIdentifier,
  formatFlowDocument,
  loadFlowApiOperationSchema,
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
import type { DiagnosticItem, FlowAction, FlowAnalysis, FlowAnalysisOutlineItem, FlowApiOperation, FlowApiOperationSchema, FlowApiOperationSchemaField, FlowItem, FlowRun, ToastFn } from './ui-types.js';
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

type FlowActionEditTarget = {
  item: FlowAnalysisOutlineItem;
  name: string;
  action: Record<string, unknown>;
  from: number;
  to: number;
};

const KIND_DOT: Record<string, string> = {
  trigger: '#3b82f6',
  action: '#22c55e',
  scope: '#eab308',
  condition: '#ef4444',
  foreach: '#8b5cf6',
  switch: '#f97316',
  branch: '#14b8a6',
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
  const [flowOutlineActiveKey, setFlowOutlineActiveKey] = useState('');
  const [flowOutlineActivePath, setFlowOutlineActivePath] = useState<string[]>([]);
  const [showAddAction, setShowAddAction] = useState(false);
  const [editingAction, setEditingAction] = useState<FlowActionEditTarget | null>(null);
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

  function selectOutlineRange(from?: number) {
    if (from === undefined) return;
    syncOutlineToEditorOffset(from);
  }

  function syncOutlineToEditorOffset(offset: number) {
    const path = findOutlinePathAtOffset(analysis?.outline || [], offset);
    const activeKey = path[path.length - 1] || '';
    setFlowOutlineActiveKey((current) => current === activeKey ? current : activeKey);
    setFlowOutlineActivePath((current) => arraysEqual(current, path) ? current : path);
  }

  function openActionEditor(item: FlowAnalysisOutlineItem) {
    try {
      setEditingAction(readActionEditTarget(flowDocument, item));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function applyActionEdit(target: FlowActionEditTarget, actionName: string, action: Record<string, unknown>) {
    try {
      updateFlowDocument(replaceActionInFlowDocument(flowDocument, target, actionName, action));
      setEditingAction(null);
      toast(`Updated ${actionName}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
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
                        onActiveOffsetChange={syncOutlineToEditorOffset}
                        toast={toast}
                      />
                    </div>
                    <aside className="flow-outline-rail">
                      <div className="flow-rail-header">
                        <h3>Outline</h3>
                        <span>{analysis?.summary?.actionCount || 0} actions</span>
                      </div>
                      <FlowOutlineCanvas
                        items={analysis?.outline || []}
                        problems={flowProblems}
                        activeKey={flowOutlineActiveKey}
                        activePath={flowOutlineActivePath}
                        onJump={jumpToEditorRange}
                        onEditAction={openActionEditor}
                      />
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
                {flowSubTab === 'outline' ? (
                  <FlowOutlineCanvas
                    items={analysis?.outline || []}
                    problems={flowProblems}
                    activeKey={flowOutlineActiveKey}
                    activePath={flowOutlineActivePath}
                    onJump={selectOutlineRange}
                    onEditAction={openActionEditor}
                  />
                ) : null}
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
      {editingAction ? (
        <EditFlowActionModal
          environment={environment}
          target={editingAction}
          onApply={applyActionEdit}
          onClose={() => setEditingAction(null)}
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
  onActiveOffsetChange: (offset: number) => void;
  toast: ToastFn;
}>((props, ref) => {
  const { value, onChange, diagnostics, validation, analysis, onActiveOffsetChange, toast } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onActiveOffsetChangeRef = useRef(onActiveOffsetChange);
  const diagnosticsRef = useRef(diagnostics);
  const validationRef = useRef(validation);
  const analysisRef = useRef(analysis);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onActiveOffsetChangeRef.current = onActiveOffsetChange; }, [onActiveOffsetChange]);
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
      const startOffset = Math.max(0, from ?? 0);
      const endOffset = Math.max(startOffset + 1, Math.min(to ?? startOffset + 1, model.getValueLength()));
      const start = model.getPositionAt(startOffset);
      const end = model.getPositionAt(endOffset);
      const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
      editor.setSelection(range);
      editor.revealPositionNearTop(start, monaco.editor.ScrollType.Smooth);
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
      editor.revealPositionNearTop(start, monaco.editor.ScrollType.Smooth);
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
    let activeFrame: number | null = null;
    const emitActiveOffset = (preferCursor = false) => {
      activeFrame = null;
      const position = preferCursor ? editor.getPosition() : editor.getVisibleRanges()[0]?.getStartPosition() || editor.getPosition();
      if (!position) return;
      const visible = editor.getVisibleRanges()[0];
      const lineNumber = !preferCursor && visible
        ? Math.max(1, Math.floor((visible.startLineNumber + visible.endLineNumber) / 2))
        : position.lineNumber;
      onActiveOffsetChangeRef.current(model.getOffsetAt({ lineNumber, column: 1 }));
    };
    const scheduleActiveOffset = (preferCursor = false) => {
      if (activeFrame !== null) window.cancelAnimationFrame(activeFrame);
      activeFrame = window.requestAnimationFrame(() => emitActiveOffset(preferCursor));
    };
    const scrollSubscription = editor.onDidScrollChange(() => scheduleActiveOffset(false));
    const cursorSubscription = editor.onDidChangeCursorPosition(() => scheduleActiveOffset(true));
    scheduleActiveOffset(false);

    updateFlowEditorMarkers(model, diagnosticsRef.current, validationRef.current);
    return () => {
      if (activeFrame !== null) window.cancelAnimationFrame(activeFrame);
      themeObserver.disconnect();
      contentSubscription.dispose();
      scrollSubscription.dispose();
      cursorSubscription.dispose();
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
      { token: 'string.key.json', foreground: stripHash(isDark ? '#93c5fd' : '#1d4ed8'), fontStyle: 'bold' },
      { token: 'string.value.json', foreground: stripHash(isDark ? '#86efac' : '#047857') },
      { token: 'number.json', foreground: stripHash(isDark ? '#fbbf24' : '#b45309') },
      { token: 'keyword.json', foreground: stripHash(isDark ? '#c4b5fd' : '#7c3aed'), fontStyle: 'bold' },
      { token: 'delimiter.bracket.json', foreground: stripHash(isDark ? '#cbd5e1' : '#475569') },
      { token: 'delimiter.array.json', foreground: stripHash(isDark ? '#f9a8d4' : '#be185d') },
      { token: 'delimiter.colon.json', foreground: stripHash(isDark ? '#94a3b8' : '#64748b') },
      { token: 'delimiter.comma.json', foreground: stripHash(isDark ? '#64748b' : '#94a3b8') },
      { token: 'comment.line.json', foreground: stripHash(isDark ? '#94a3b8' : '#64748b'), fontStyle: 'italic' },
      { token: 'comment.block.json', foreground: stripHash(isDark ? '#94a3b8' : '#64748b'), fontStyle: 'italic' },
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
    item.dependency ? `Dependency: \`${escapeMarkdown(item.dependency)}\`` : '',
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

function findOutlinePathAtOffset(items: FlowAnalysisOutlineItem[], offset: number): string[] {
  for (const item of items) {
    if ((item.from ?? -1) <= offset && offset <= (item.to ?? -1)) {
      return [outlineKey(item), ...findOutlinePathAtOffset(item.children || [], offset)];
    }
  }
  return [];
}

function outlineKey(item: FlowAnalysisOutlineItem): string {
  return `${item.kind || 'item'}:${item.name || ''}:${item.from ?? ''}:${item.to ?? ''}`;
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
  { key: 'compose', label: 'Compose', desc: 'Transform or pass through a value', name: 'Compose', action: () => ({ type: 'Compose', inputs: '' }) },
  { key: 'http', label: 'HTTP', desc: 'Call any REST endpoint', name: 'HTTP', action: () => ({ type: 'Http', inputs: { method: 'GET', uri: '' } }) },
  { key: 'scope', label: 'Scope', desc: 'Group related actions', name: 'Scope', action: () => ({ type: 'Scope', actions: {} }) },
  { key: 'condition', label: 'Condition', desc: 'Branch with if / else', name: 'Condition', action: () => ({ type: 'If', expression: { equals: ['', ''] }, actions: {}, else: { actions: {} } }) },
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
  const [selectedTemplate, setSelectedTemplate] = useState<BuiltInActionTemplate | null>(null);
  const [actionName, setActionName] = useState('');
  const [runAfter, setRunAfter] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topLevelActions = useMemo(() => topLevelActionNames(props.analysis), [props.analysis]);
  const propsRef = useRef(props);
  propsRef.current = props;

  const doSearch = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const result = await loadFlowApiOperations(propsRef.current.environment, query);
      setOperations(result);
    } catch (error) {
      propsRef.current.toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!runAfter && topLevelActions.length) setRunAfter(topLevelActions[topLevelActions.length - 1] || '');
  }, [runAfter, topLevelActions]);

  useEffect(() => {
    searchRef.current?.focus();
    void doSearch('');
  }, [doSearch]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(value), 350);
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

  const hasSelection = Boolean(selectedOperation || selectedTemplate);

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal add-action-modal">
        <div className="rt-modal-header">
          <h2>Add Action</h2>
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
                  className={`add-action-template ${selectedTemplate?.key === template.key ? 'active' : ''}`}
                  onClick={() => selectTemplate(template)}
                >
                  <span className="add-action-template-label">{template.label}</span>
                  <span className="add-action-template-desc">{template.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="add-action-section">
            <h3>Connector Operations</h3>
            <div className="add-action-search">
              <input
                ref={searchRef}
                type="text"
                value={search}
                placeholder="Search connectors and actions…"
                onChange={(event) => onSearchChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void doSearch(search); }}
              />
              {loading ? <span className="add-action-searching">Searching…</span> : null}
            </div>
            <div className="add-action-results">
              {operations.length ? operations.map((operation) => (
                <button
                  key={`${operation.apiId || operation.apiName}:${operation.name}`}
                  type="button"
                  className={`add-action-operation ${selectedOperation?.name === operation.name && selectedOperation?.apiId === operation.apiId ? 'active' : ''}`}
                  onClick={() => selectOperation(operation)}
                >
                  {operation.iconUri ? <img className="add-action-operation-icon" src={operation.iconUri} alt="" /> : <span className="add-action-operation-icon add-action-operation-icon-placeholder" />}
                  <span className="add-action-operation-text">
                    <span className="add-action-operation-title">{operation.summary || operation.name}</span>
                    <span className="add-action-operation-meta">{operation.apiDisplayName || operation.apiName || 'Connector'} · {operation.name}</span>
                    {operation.description ? <span className="add-action-operation-desc">{operation.description}</span> : null}
                  </span>
                </button>
              )) : <div className="empty">{loading ? 'Loading operations…' : 'No operations found.'}</div>}
            </div>
          </div>
          {hasSelection ? (
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
                  Will use the matching connection reference when one exists, otherwise inserts a placeholder for {selectedOperation.apiDisplayName || selectedOperation.apiName || 'the connector'}.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="rt-modal-header add-action-footer">
          <div className="add-action-footer-summary">
            {selectedOperation?.iconUri ? <img className="add-action-footer-icon" src={selectedOperation.iconUri} alt="" /> : null}
            <span className="desc" style={{ marginBottom: 0 }}>
              {selectedOperation
                ? `${selectedOperation.summary || selectedOperation.name} · ${selectedOperation.apiDisplayName || selectedOperation.apiName || 'Connector'}`
                : selectedTemplate?.label || 'Select an action above'}
            </span>
          </div>
          <button className="btn btn-primary" type="button" disabled={!actionName.trim() || !hasSelection} onClick={addAction}>Insert Action</button>
        </div>
      </div>
    </div>
  );
}

function EditFlowActionModal(props: {
  environment: string;
  target: FlowActionEditTarget;
  onApply: (target: FlowActionEditTarget, actionName: string, action: Record<string, unknown>) => void;
  onClose: () => void;
  toast: ToastFn;
}) {
  const [actionName, setActionName] = useState(props.target.name);
  const [draft, setDraft] = useState<Record<string, unknown>>(props.target.action);
  const [rawText, setRawText] = useState(() => JSON.stringify(props.target.action, null, 2));
  const [schema, setSchema] = useState<FlowApiOperationSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const operationRef = useMemo(() => readActionOperation(props.target.action), [props.target.action]);
  const rawError = useMemo(() => {
    try {
      JSON.parse(rawText);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [rawText]);

  useEffect(() => {
    setActionName(props.target.name);
    setDraft(props.target.action);
    setRawText(JSON.stringify(props.target.action, null, 2));
  }, [props.target]);

  useEffect(() => {
    let cancelled = false;
    if (!operationRef.apiId || !operationRef.operationId) {
      setSchema(null);
      return;
    }
    setSchemaLoading(true);
    void loadFlowApiOperationSchema(props.environment, operationRef.apiId, operationRef.operationId)
      .then((result) => { if (!cancelled) setSchema(result); })
      .catch((error) => props.toast(error instanceof Error ? error.message : String(error), true))
      .finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [operationRef.apiId, operationRef.operationId, props.environment, props.toast]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  function updateDraft(path: string[], value: unknown) {
    const next = setPathValue(draft, path, value);
    setDraft(next);
    setRawText(JSON.stringify(next, null, 2));
  }

  function applyRaw() {
    const parsed = JSON.parse(rawText) as unknown;
    if (!isObject(parsed)) throw new Error('Action JSON must be an object.');
    props.onApply(props.target, sanitizeActionName(actionName), parsed);
  }

  const type = String(draft.type || props.target.item.type || '');
  const connectorFields = schema?.fields || [];
  const existingParameterFields = existingConnectorParameterFields(draft, connectorFields);

  return (
    <div className="rt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rt-modal flow-action-edit-modal">
        <div className="rt-modal-header">
          <div>
            <h2>Edit Action</h2>
            <p className="desc" style={{ marginBottom: 0 }}>{type || 'Action'}{operationRef.operationId ? ` · ${operationRef.operationId}` : ''}</p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={props.onClose}>Close</button>
        </div>
        <div className="rt-modal-body flow-action-edit-body">
          <div className="flow-action-edit-section flow-action-edit-grid">
            <label>
              <span>Action name</span>
              <input type="text" value={actionName} onChange={(event) => setActionName(sanitizeActionName(event.target.value))} />
            </label>
            <label>
              <span>Type</span>
              <input type="text" value={type} onChange={(event) => updateDraft(['type'], event.target.value)} />
            </label>
          </div>

          {operationRef.operationId ? (
            <div className="flow-action-edit-section">
              <h3>Connector schema</h3>
              <div className="flow-action-edit-note">
                {schemaLoading ? 'Loading operation schema...' : schema ? `${schema.apiDisplayName || schema.apiName || 'Connector'} · ${schema.summary || schema.operationId}` : 'No operation schema was found; use common fields or raw JSON.'}
              </div>
              {schema?.description ? <p className="desc" style={{ marginBottom: 0 }}>{schema.description}</p> : null}
              {connectorFields.length ? (
                <div className="flow-action-field-list">
                  {[...connectorFields, ...existingParameterFields].map((field) => (
                    <SchemaFieldEditor
                      key={`${field.location || 'parameter'}:${field.name}`}
                      field={field}
                      value={readPathValue(draft, connectorFieldPath(field))}
                      onChange={(value) => updateDraft(connectorFieldPath(field), value)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flow-action-edit-section">
            <h3>Common fields</h3>
            <CommonActionFields action={draft} onChange={updateDraft} />
          </div>

          <div className="flow-action-edit-section">
            <h3>Raw action JSON</h3>
            <textarea className="flow-action-json-editor" value={rawText} onChange={(event) => setRawText(event.target.value)} spellCheck={false} />
            {rawError ? <div className="flow-action-edit-error">{rawError}</div> : null}
          </div>
        </div>
        <div className="rt-modal-header add-action-footer">
          <div className="desc" style={{ marginBottom: 0 }}>Changes update the editor only. Use Check & Save when ready.</div>
          <button className="btn btn-primary" type="button" disabled={!actionName.trim() || Boolean(rawError)} onClick={() => {
            try {
              applyRaw();
            } catch (error) {
              props.toast(error instanceof Error ? error.message : String(error), true);
            }
          }}>Apply Changes</button>
        </div>
      </div>
    </div>
  );
}

function CommonActionFields(props: { action: Record<string, unknown>; onChange: (path: string[], value: unknown) => void }) {
  const type = String(props.action.type || '').toLowerCase();
  const fields: Array<{ label: string; path: string[]; kind?: 'text' | 'json' | 'select'; options?: string[] }> = [];
  if (type === 'http') {
    fields.push(
      { label: 'Method', path: ['inputs', 'method'], kind: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { label: 'URI', path: ['inputs', 'uri'] },
      { label: 'Headers', path: ['inputs', 'headers'], kind: 'json' },
      { label: 'Body', path: ['inputs', 'body'], kind: 'json' },
    );
  } else if (type === 'compose') {
    fields.push({ label: 'Inputs', path: ['inputs'], kind: 'json' });
  } else if (type === 'if' || type === 'condition') {
    fields.push({ label: 'Expression', path: ['expression'], kind: 'json' });
  } else if (type === 'foreach') {
    fields.push({ label: 'Collection', path: ['foreach'] });
  } else if (type === 'until') {
    fields.push({ label: 'Expression', path: ['expression'], kind: 'json' }, { label: 'Limit', path: ['limit'], kind: 'json' });
  } else if (type.includes('variable')) {
    fields.push({ label: 'Inputs', path: ['inputs'], kind: 'json' });
  }
  fields.push({ label: 'Run after', path: ['runAfter'], kind: 'json' });
  return (
    <div className="flow-action-field-list">
      {fields.map((field) => (
        <ActionValueEditor
          key={field.path.join('.')}
          label={field.label}
          value={readPathValue(props.action, field.path)}
          kind={field.kind}
          options={field.options}
          onChange={(value) => props.onChange(field.path, value)}
        />
      ))}
    </div>
  );
}

function SchemaFieldEditor(props: { field: FlowApiOperationSchemaField; value: unknown; onChange: (value: unknown) => void }) {
  const { field } = props;
  const type = field.type || schemaTypeLabel(field.schema) || 'value';
  return (
    <div className="flow-action-schema-field">
      <div>
        <div className="flow-action-field-label">{field.title || field.name}{field.required ? ' *' : ''}</div>
        <div className="flow-action-field-meta">{field.location || 'parameter'} · {type}</div>
        {field.description ? <div className="flow-action-field-desc">{field.description}</div> : null}
      </div>
      <ActionValueEditor value={props.value} kind={field.enum?.length ? 'select' : shouldEditAsJson(field) ? 'json' : 'text'} options={field.enum} onChange={props.onChange} />
    </div>
  );
}

function ActionValueEditor(props: { label?: string; value: unknown; kind?: 'text' | 'json' | 'select'; options?: string[]; onChange: (value: unknown) => void }) {
  const kind = props.kind || (isObject(props.value) || Array.isArray(props.value) ? 'json' : 'text');
  const valueText = valueToEditText(props.value, kind);
  const content = kind === 'select' ? (
    <select value={String(props.value ?? '')} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">not set</option>
      {(props.options || []).map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  ) : kind === 'json' ? (
    <textarea
      value={valueText}
      onChange={(event) => props.onChange(parseEditableJson(event.target.value))}
      spellCheck={false}
    />
  ) : (
    <input type="text" value={valueText} onChange={(event) => props.onChange(event.target.value)} />
  );
  return props.label ? (
    <label className="flow-action-value-editor">
      <span>{props.label}</span>
      {content}
    </label>
  ) : content;
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

function readActionEditTarget(source: string, item: FlowAnalysisOutlineItem): FlowActionEditTarget {
  if (item.from === undefined || item.to === undefined || !item.name) throw new Error('Outline item does not have a source range.');
  const colon = source.indexOf(':', item.from);
  if (colon < 0 || colon > item.to) throw new Error(`Could not locate ${item.name} in the editor.`);
  const valueStart = source.indexOf('{', colon);
  if (valueStart < 0 || valueStart > item.to) throw new Error(`${item.name} is not a JSON object action.`);
  const parsed = JSON.parse(source.slice(valueStart, item.to)) as unknown;
  if (!isObject(parsed)) throw new Error(`${item.name} is not a JSON object action.`);
  return { item, name: item.name, action: parsed, from: item.from, to: item.to };
}

function replaceActionInFlowDocument(source: string, target: FlowActionEditTarget, actionName: string, action: Record<string, unknown>): string {
  const name = sanitizeActionName(actionName);
  const lineStart = source.lastIndexOf('\n', target.from - 1) + 1;
  const indent = source.slice(lineStart, target.from).match(/^\s*/)?.[0] || '';
  const body = JSON.stringify(action, null, 2).replace(/\n/g, `\n${indent}`);
  return `${source.slice(0, target.from)}"${escapeJsonString(name)}": ${body}${source.slice(target.to)}`;
}

function escapeJsonString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function readActionOperation(action: Record<string, unknown>): { apiId?: string; operationId?: string } {
  const host = prop(action, 'inputs.host');
  return {
    apiId: typeof prop(host, 'apiId') === 'string' ? String(prop(host, 'apiId')) : undefined,
    operationId: typeof prop(host, 'operationId') === 'string' ? String(prop(host, 'operationId')) : typeof prop(action, 'inputs.operationId') === 'string' ? String(prop(action, 'inputs.operationId')) : undefined,
  };
}

function connectorFieldPath(field: FlowApiOperationSchemaField): string[] {
  if (field.location === 'header') return ['inputs', 'headers', field.name];
  if (field.location === 'query') return ['inputs', 'queries', field.name];
  if (field.location === 'body') return ['inputs', 'parameters', field.name || 'body'];
  if (field.location === 'path') return ['inputs', 'parameters', field.name];
  return ['inputs', 'parameters', field.name];
}

function existingConnectorParameterFields(action: Record<string, unknown>, fields: FlowApiOperationSchemaField[]): FlowApiOperationSchemaField[] {
  const known = new Set(fields.map((field) => `${field.location || 'parameter'}:${field.name}`));
  const parameters = prop(action, 'inputs.parameters');
  if (!isObject(parameters)) return [];
  return Object.keys(parameters)
    .filter((name) => !known.has(`parameter:${name}`) && !known.has(`path:${name}`) && !known.has(`body:${name}`))
    .map((name) => ({ name, location: 'parameter', type: typeof parameters[name] }));
}

function readPathValue(source: unknown, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setPathValue(source: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const clone = structuredClone(source) as Record<string, unknown>;
  let current: Record<string, unknown> = clone;
  for (const segment of path.slice(0, -1)) {
    if (!isObject(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
  return clone;
}

function parseEditableJson(value: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function valueToEditText(value: unknown, kind: 'text' | 'json' | 'select') {
  if (value === undefined || value === null) return '';
  if (kind === 'json') return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function shouldEditAsJson(field: FlowApiOperationSchemaField) {
  const type = field.type || schemaTypeLabel(field.schema);
  return type === 'object' || type === 'array';
}

function schemaTypeLabel(schema: unknown) {
  return isObject(schema) && typeof schema.type === 'string' ? schema.type : undefined;
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

type OutlineProblemSummary = { error: number; warning: number; info: number };

function FlowOutlineCanvas(props: {
  items: FlowAnalysisOutlineItem[];
  problems?: FlowProblem[];
  activeKey?: string;
  activePath?: string[];
  onJump: (from?: number, to?: number) => void;
  onEditAction?: (item: FlowAnalysisOutlineItem) => void;
}) {
  const { items } = props;
  const [query, setQuery] = useState('');
  const filteredItems = useMemo(() => filterOutlineItems(items, query), [items, query]);
  const visibleCount = useMemo(() => countOutlineItems(filteredItems), [filteredItems]);
  if (!items.length) return <div className="empty">Load a flow definition to see the outline.</div>;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <input
          type="search"
          placeholder="Filter outline..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ minWidth: 0, flex: 1, padding: '6px 8px', fontSize: '0.75rem' }}
        />
        <span style={{ color: 'var(--muted)', fontSize: '0.6875rem', whiteSpace: 'nowrap' }}>{visibleCount} items</span>
      </div>
      <div className="flow-outline-scroll">
        {filteredItems.length ? (
          <OutlineNodeList
            items={filteredItems}
            depth={0}
            problems={props.problems || []}
            activeKey={props.activeKey || ''}
            activePath={props.activePath || []}
            onJump={props.onJump}
            onEditAction={props.onEditAction}
          />
        ) : (
          <div className="empty">No outline items match this filter.</div>
        )}
      </div>
    </>
  );
}

function OutlineNodeList(props: {
  items: FlowAnalysisOutlineItem[];
  depth: number;
  problems: FlowProblem[];
  activeKey: string;
  activePath: string[];
  onJump: (from?: number, to?: number) => void;
  onEditAction?: (item: FlowAnalysisOutlineItem) => void;
}) {
  return (
    <>
      {props.items.map((item, index) => (
        <OutlineNode
          key={outlineKey(item)}
          item={item}
          depth={props.depth}
          last={index === props.items.length - 1}
          problems={props.problems}
          activeKey={props.activeKey}
          activePath={props.activePath}
          onJump={props.onJump}
          onEditAction={props.onEditAction}
        />
      ))}
    </>
  );
}

function OutlineNode(props: {
  item: FlowAnalysisOutlineItem;
  depth: number;
  last: boolean;
  problems: FlowProblem[];
  activeKey: string;
  activePath: string[];
  onJump: (from?: number, to?: number) => void;
  onEditAction?: (item: FlowAnalysisOutlineItem) => void;
}) {
  const { item, depth, last, problems, activeKey, activePath, onJump, onEditAction } = props;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const itemKey = outlineKey(item);
  const active = activeKey === itemKey;
  const inActivePath = activePath.includes(itemKey);
  const [manuallyOpen, setManuallyOpen] = useState(depth < 2);
  const hasChildren = Boolean(item.children?.length);
  const kind = String(item.kind || '').toLowerCase();
  const dotColor = KIND_DOT[kind] || KIND_DOT.default;
  const problemSummary = summarizeOutlineProblems(item, problems);
  const hasProblem = problemSummary.error || problemSummary.warning || problemSummary.info;
  const hasDetail = Boolean(item.detail || item.type || item.connector || item.inputs || item.runAfter?.length || item.dependency);
  const expandable = hasChildren || hasDetail;
  const open = manuallyOpen || inActivePath;
  const indent = depth * 20 + (depth > 0 ? 18 : 8);
  const title = outlineTitle(item);
  const meta = outlineMeta(item);
  const editable = Boolean(onEditAction && item.name && item.type && (item.kind === 'action' || item.kind === 'scope'));

  useEffect(() => {
    if (!active) return;
    rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

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
        ref={rowRef}
        className={`flow-outline-row ${active ? 'active' : ''}`}
        onClick={() => {
          onJump(item.from, item.to);
          if (expandable) setManuallyOpen(!open);
        }}
        onDoubleClick={(event) => {
          if (!editable) return;
          event.preventDefault();
          event.stopPropagation();
          onEditAction?.(item);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px 6px ' + indent + 'px',
          cursor: 'pointer', fontSize: '12px', lineHeight: '18px',
          borderBottom: '1px solid var(--border)',
          transition: 'background 0.1s',
        }}
      >
        <span style={{ width: 12, fontSize: '10px', color: 'var(--muted)', flexShrink: 0, fontFamily: 'monospace', userSelect: 'none' }}>
          {expandable ? (open ? '\u25BE' : '\u25B8') : ''}
        </span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dotColor }} />
        <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.04em', flexShrink: 0, minWidth: 52 }}>
          {item.kind || 'action'}
        </span>
        <span style={{ minWidth: 0, flex: 1, display: 'grid', gap: 1 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          {meta ? (
            <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '10px' }}>
              {meta}
            </span>
          ) : null}
        </span>
        {item.dependency ? (
          <span title={item.runAfter?.length ? item.runAfter.join(', ') : item.dependency} style={{ fontSize: '10px', color: 'var(--muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '1px 6px', flexShrink: 0 }}>
            {shorten(item.dependency, 24)}
          </span>
        ) : null}
        {hasProblem ? (
          <span title={outlineProblemTitle(problemSummary)} style={{ fontSize: '10px', color: problemSummary.error ? 'var(--danger)' : problemSummary.warning ? '#d97706' : 'var(--accent)', background: 'var(--surface)', border: '1px solid currentColor', borderRadius: 8, padding: '1px 6px', flexShrink: 0 }}>
            {problemSummary.error ? `${problemSummary.error} error` : problemSummary.warning ? `${problemSummary.warning} warn` : `${problemSummary.info} info`}
          </span>
        ) : null}
        {hasChildren && (
          <span style={{ fontSize: '10px', color: 'var(--muted)', background: 'var(--border)', borderRadius: 8, padding: '1px 6px', flexShrink: 0 }}>
            {item.children!.length}
          </span>
        )}
      </div>
      {open && hasDetail && (
        <OutlineDetail item={item} indent={indent + 24} />
      )}
      {open && hasChildren && (
        <OutlineNodeList items={item.children!} depth={depth + 1} problems={problems} activeKey={activeKey} activePath={activePath} onJump={onJump} onEditAction={onEditAction} />
      )}
    </div>
  );
}

function filterOutlineItems(items: FlowAnalysisOutlineItem[], query: string): FlowAnalysisOutlineItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.flatMap((item) => {
    const children = filterOutlineItems(item.children || [], query);
    if (outlineSearchText(item).includes(needle) || children.length) return [{ ...item, children }];
    return [];
  });
}

function countOutlineItems(items: FlowAnalysisOutlineItem[]): number {
  return items.reduce((count, item) => count + 1 + countOutlineItems(item.children || []), 0);
}

function outlineSearchText(item: FlowAnalysisOutlineItem) {
  return [
    item.kind,
    item.name,
    item.detail,
    item.type,
    item.connector,
    item.dependency,
    ...(item.runAfter || []),
    ...Object.entries(item.inputs || {}).flatMap(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function outlineTitle(item: FlowAnalysisOutlineItem) {
  if (item.kind === 'workflow') return 'Workflow';
  if (item.kind === 'parameter' && item.children?.length) return 'Parameters';
  if (item.kind === 'trigger' && item.children?.length && item.name === 'triggers') return 'Triggers';
  if (item.kind === 'action' && item.children?.length && item.name === 'actions') return 'Actions';
  if (item.kind === 'variable' && item.children?.length) return 'Variables';
  return item.name || 'Unnamed';
}

function outlineMeta(item: FlowAnalysisOutlineItem) {
  const operation = item.inputs?.operationId;
  const expression = item.inputs?.expression;
  const parts = [
    item.type || (item.detail && !item.children?.length ? item.detail : undefined),
    item.connector,
    typeof operation === 'string' ? operation : undefined,
    typeof expression === 'string' ? shorten(expression, 80) : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

function summarizeOutlineProblems(item: FlowAnalysisOutlineItem, problems: FlowProblem[]): OutlineProblemSummary {
  const summary: OutlineProblemSummary = { error: 0, warning: 0, info: 0 };
  for (const problem of problems) {
    if (!problemMatchesOutlineItem(problem, item)) continue;
    summary[problem.level] += 1;
  }
  return summary;
}

function problemMatchesOutlineItem(problem: FlowProblem, item: FlowAnalysisOutlineItem) {
  const from = item.from ?? -1;
  const to = item.to ?? -1;
  if (problem.from !== undefined && from <= problem.from && problem.from <= to) return true;
  if (problem.actionName && item.name && problem.actionName === item.name) return true;
  if (problem.path && item.name && pathMentionsName(problem.path, item.name)) return true;
  return false;
}

function pathMentionsName(path: string, name: string) {
  const normalizedName = name.toLowerCase();
  return path
    .split(/[.[\]'"]+/)
    .filter(Boolean)
    .some((part) => part.toLowerCase() === normalizedName);
}

function outlineProblemTitle(summary: OutlineProblemSummary) {
  const parts = [
    summary.error ? `${summary.error} error${summary.error === 1 ? '' : 's'}` : '',
    summary.warning ? `${summary.warning} warning${summary.warning === 1 ? '' : 's'}` : '',
    summary.info ? `${summary.info} info` : '',
  ].filter(Boolean);
  return parts.join(', ');
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
  if (item.dependency) rows.push(['Dependency', item.dependency]);
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
