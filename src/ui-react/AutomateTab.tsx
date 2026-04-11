import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { searchKeymap } from '@codemirror/search';
import { EditorState, Prec } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, formatDateShort, highlightJson, prop } from './utils.js';
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

type FlowCanvasNode = {
  type: 'scope' | 'node';
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: string;
  detail?: string;
  depth: number;
  colors: { bg: string; border: string; text: string };
};

type FlowCanvasView = { x: number; y: number; scale: number };

const automateEditorTheme = EditorView.theme({
  '&': { fontSize: '13px' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(37,99,235,0.18)' },
  '.cm-activeLine': { backgroundColor: 'rgba(37,99,235,0.06)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', borderRight: '1px solid var(--border)', color: 'var(--muted)' },
});

const NODE_GAP_Y = 14;
const NODE_MIN_W = 180;
const NODE_H = 46;
const SCOPE_PAD = 12;
const CONNECTOR_R = 3;
const KIND_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  trigger: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  action: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
  scope: { bg: '#fefce8', border: '#eab308', text: '#854d0e' },
  condition: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
  foreach: { bg: '#f5f3ff', border: '#8b5cf6', text: '#5b21b6' },
  switch: { bg: '#fff7ed', border: '#f97316', text: '#9a3412' },
  default: { bg: '#f9fafb', border: '#9ca3af', text: '#374151' },
};

export function AutomateTab(props: {
  active: boolean;
  environment: string;
  openConsole: (seed: { api: string; method: string; path: string }) => void;
  toast: ToastFn;
}) {
  const { active, environment, openConsole, toast } = props;
  const [flows, setFlows] = useState<FlowItem[]>([]);
  const [flowSource, setFlowSource] = useState<'flow' | 'dv'>('flow');
  const [loadedEnvironment, setLoadedEnvironment] = useState('');
  const [filter, setFilter] = useState('');
  const [currentFlow, setCurrentFlow] = useState<FlowItem | null>(null);
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
    const [document, loadedRuns] = await Promise.all([
      loadFlowDefinitionDocument(environment, flow),
      loadFlowRuns(environment, flow).catch(() => []),
    ]);
    setFlowDocument(document);
    setRuns(loadedRuns);
  }

  async function selectRun(run: FlowRun) {
    setCurrentRun(run);
    setCurrentAction(null);
    setActionDetail(null);
    try {
      setActions(currentFlow ? await loadRunActions(environment, currentFlow, run) : []);
    } catch {
      setActions([]);
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
              <div style={{ marginTop: 12 }}>
                <h3 style={{ marginBottom: 8 }}>Outline</h3>
                <FlowOutlineCanvas items={analysis?.outline || []} />
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
                            <span className="action-item-type">{shortId(run.name || '')}</span>
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<FlowCanvasNode[]>([]);
  const viewRef = useRef<FlowCanvasView>({ x: 0, y: 0, scale: 1 });
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  function draw() {
    drawOutlineCanvas(canvasRef.current, containerRef.current, nodesRef.current, viewRef.current);
  }

  function fit() {
    fitCanvas(nodesRef.current, containerRef.current, viewRef.current);
    draw();
  }

  useEffect(() => {
    nodesRef.current = layoutOutlineCanvasNodes(items);
    fit();
  }, [items]);

  useEffect(() => {
    const handler = () => draw();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 8 }}>
        <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={fit}>Fit</button>
        <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => { viewRef.current.scale = Math.min(3, viewRef.current.scale * 1.3); draw(); }}>Zoom in</button>
        <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => { viewRef.current.scale = Math.max(0.2, viewRef.current.scale / 1.3); draw(); }}>Zoom out</button>
      </div>
      <div
        ref={containerRef}
        className="flow-canvas-container"
        style={{ height: 500, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', overflow: 'hidden', cursor: panRef.current ? 'grabbing' : 'grab' }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={(event) => { panRef.current = { x: event.clientX, y: event.clientY, vx: viewRef.current.x, vy: viewRef.current.y }; }}
          onMouseMove={(event) => {
            const pan = panRef.current;
            if (!pan) return;
            viewRef.current.x = pan.vx + (event.clientX - pan.x) / viewRef.current.scale;
            viewRef.current.y = pan.vy + (event.clientY - pan.y) / viewRef.current.scale;
            draw();
          }}
          onMouseUp={() => { panRef.current = null; }}
          onMouseLeave={() => { panRef.current = null; }}
          onWheel={(event) => {
            event.preventDefault();
            const factor = event.deltaY > 0 ? 0.9 : 1.1;
            viewRef.current.scale = Math.max(0.2, Math.min(3, viewRef.current.scale * factor));
            draw();
          }}
        />
      </div>
    </div>
  );
}

function layoutOutlineCanvasNodes(items: FlowAnalysisOutlineItem[]) {
  const nodes: FlowCanvasNode[] = [];
  layoutOutlineNodes(items, 0, 0, 0, nodes);
  return nodes;
}

function layoutOutlineNodes(items: FlowAnalysisOutlineItem[], depth: number, startX: number, startY: number, nodes: FlowCanvasNode[]) {
  let cursorY = startY;
  for (const item of items) {
    const kind = String(item.kind || '').toLowerCase();
    const hasChildren = Boolean(item.children?.length);
    const colors = KIND_COLORS[kind] || KIND_COLORS.default;
    if (hasChildren) {
      const headerH = NODE_H;
      const childStartY = cursorY + headerH + NODE_GAP_Y;
      const childStartX = startX + SCOPE_PAD;
      const childBottom = layoutOutlineNodes(item.children || [], depth + 1, childStartX, childStartY, nodes);
      const scopeW = Math.max(NODE_MIN_W + SCOPE_PAD * 2, getSubtreeWidth(item.children || []) + SCOPE_PAD * 2);
      const scopeH = childBottom - cursorY + SCOPE_PAD;
      nodes.push({ type: 'scope', x: startX, y: cursorY, w: scopeW, h: scopeH, label: item.name || '', kind: item.kind || kind, detail: item.detail, colors, depth });
      nodes.push({ type: 'node', x: startX + SCOPE_PAD, y: cursorY + 6, w: NODE_MIN_W, h: NODE_H - 12, label: item.name || '', kind: item.kind || kind, detail: item.detail, colors, depth: depth + 1 });
      cursorY += scopeH + NODE_GAP_Y;
    } else {
      nodes.push({ type: 'node', x: startX, y: cursorY, w: NODE_MIN_W, h: NODE_H, label: item.name || '', kind: item.kind || kind, detail: item.detail, colors, depth });
      cursorY += NODE_H + NODE_GAP_Y;
    }
  }
  return cursorY;
}

function getSubtreeWidth(items: FlowAnalysisOutlineItem[]) {
  let maxW = NODE_MIN_W;
  for (const item of items) {
    if (item.children?.length) maxW = Math.max(maxW, getSubtreeWidth(item.children) + SCOPE_PAD * 2);
  }
  return maxW;
}

function fitCanvas(nodes: FlowCanvasNode[], container: HTMLDivElement | null, view: FlowCanvasView) {
  if (!nodes.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
  }
  const cw = container?.clientWidth || 600;
  const ch = container?.clientHeight || 400;
  view.scale = Math.min(1.5, Math.min((cw - 40) / (maxX - minX + 60), (ch - 40) / (maxY - minY + 60)));
  view.x = -(minX + maxX) / 2;
  view.y = -minY + 10;
}

function drawOutlineCanvas(canvas: HTMLCanvasElement | null, container: HTMLDivElement | null, nodes: FlowCanvasNode[], view: FlowCanvasView) {
  if (!canvas || !container) return;
  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth || 600;
  const h = container.clientHeight || 500;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!nodes.length) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6b7280';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Load a flow definition to see the outline', w / 2, h / 2);
    return;
  }
  ctx.save();
  ctx.translate(w / 2, 20);
  ctx.scale(view.scale, view.scale);
  ctx.translate(view.x, view.y);
  const isDark = document.documentElement.classList.contains('dark');
  const borderColor = isDark ? '#27272a' : '#e5e7eb';
  const textColor = isDark ? '#e4e4e7' : '#111111';
  const mutedColor = isDark ? '#71717a' : '#6b7280';

  for (const node of nodes) {
    if (node.type !== 'scope') continue;
    ctx.fillStyle = isDark ? adjustAlpha(node.colors.bg, 0.15) : node.colors.bg;
    ctx.strokeStyle = node.colors.border;
    ctx.lineWidth = 1.5;
    roundRect(ctx, node.x, node.y, node.w, node.h, 10);
    ctx.fill();
    ctx.stroke();
  }

  const regularNodes = nodes.filter((node) => node.type === 'node');
  for (let index = 0; index < regularNodes.length - 1; index++) {
    const a = regularNodes[index];
    const b = regularNodes[index + 1];
    if (a.depth !== b.depth) continue;
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h;
    const bx = b.x + b.w / 2;
    const by = b.y;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax, ay + NODE_GAP_Y / 2);
    if (Math.abs(ax - bx) > 1) ctx.lineTo(bx, ay + NODE_GAP_Y / 2);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = borderColor;
    ctx.beginPath();
    ctx.arc(bx, by, CONNECTOR_R, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const node of nodes) {
    if (node.type !== 'node') continue;
    ctx.fillStyle = isDark ? adjustAlpha(node.colors.bg, 0.25) : node.colors.bg;
    ctx.strokeStyle = node.colors.border;
    ctx.lineWidth = 1.5;
    roundRect(ctx, node.x, node.y, node.w, node.h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = node.colors.text;
    ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText((node.kind || '').toUpperCase(), node.x + 10, node.y + 14);
    ctx.fillStyle = textColor;
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(ellipsize(ctx, node.label || '', node.w - 20), node.x + 10, node.y + 30);
    if (node.detail) {
      ctx.fillStyle = mutedColor;
      ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(ellipsize(ctx, node.detail, node.w - 20), node.x + 10, node.y + 42);
    }
  }
  ctx.restore();
}

function ellipsize(ctx: CanvasRenderingContext2D, value: string, maxWidth: number) {
  let text = value;
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 3 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return `${text}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function adjustAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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
