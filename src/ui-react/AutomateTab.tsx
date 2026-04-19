import { useEffect, useMemo, useRef, useState } from 'react';
import { api, prop } from './utils.js';
import {
  analyzeFlowDocument,
  buildFlowDocument,
  checkFlowDefinition,
  flowIdentifier,
  flowRuntimeId,
  flowRunTriggerNames,
  sameFlowIdentity,
  flowValidationFromError,
  formatFlowDocument,
  loadActionDetail,
  loadFlowCallbackUrl,
  loadFlowApiConnections,
  loadFlowDefinitionDocument,
  loadFlowList,
  loadFlowRuns,
  loadRunActions,
  loadRunDetail,
  setFlowActivationState,
  saveFlowDefinition,
  type FlowValidationKind,
  type FlowValidationResult,
} from './automate-data.js';
import type { FlowAction, FlowAnalysis, FlowAnalysisOutlineItem, FlowItem, FlowRun, ToastFn } from './ui-types.js';
import { RecordDetailModal, useRecordDetail } from './RecordDetailModal.js';
import { useMonacoVimPreference } from './monaco-support.js';
import { AddFlowActionModal, EditFlowActionModal, FlowDiffModal, addActionToFlowDocument, findSiblingActionNames, readOutlineEditTarget, removeActionFromFlowDocument, reorderActionInFlowDocument, replaceOutlineItemInFlowDocument } from './automate/FlowDefinitionModals.js';
import { ConfirmDialog, useConfirm } from './setup/ConfirmDialog.js';
import { FlowDefinitionPanel } from './automate/FlowDefinitionPanel.js';
import { FlowConnectionsPanel, type FlowConnectionInspectSeed } from './automate/FlowConnectionsPanel.js';
import { ApiResponseModal, useApiPreview } from './ApiResponseModal.js';
import { FlowDetailHeader } from './automate/FlowDetailHeader.js';
import { FlowInventorySidebar } from './automate/FlowInventorySidebar.js';
import { FlowOutlinePanel } from './automate/FlowOutlinePanel.js';
import { FlowRunsPanel } from './automate/FlowRunsPanel.js';
import { runActionRef, runActionRefForAction } from './automate/flow-run-outline.js';
import { buildFlowProblems } from './automate/FlowProblemsPanel.js';
import { buildFlowConnectionModel, removeFlowConnectionReference, setFlowConnectionReference, type FlowConnectionReference, type FlowEnvironmentConnection } from './automate/flow-connections.js';
import { buildOutlinePathTo, findOutlineContainerTarget, isActionLikeOutlineItem, outlineKey, type OutlineContainerTarget } from './automate/outline-utils.js';
import type { AutomateSubTab, FlowActionEditTarget, FlowEditorHandle, FlowOperation, FlowProblem } from './automate/types.js';

type FlowCallbackUrlState = {
  flowId: string;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  value: string;
  kind: 'signed' | 'authenticated';
  error: string;
  visible: boolean;
};

const EMPTY_CALLBACK_URL_STATE: FlowCallbackUrlState = {
  flowId: '',
  status: 'idle',
  value: '',
  kind: 'authenticated',
  error: '',
  visible: false,
};

export function AutomateTab(props: {
  active: boolean;
  environment: string;
  openConsole: (seed: { api: string; method: string; path: string }) => void;
  toast: ToastFn;
}) {
  const { active, environment, openConsole, toast } = props;
  const detail = useRecordDetail();
  const confirm = useConfirm();
  const apiPreview = useApiPreview();
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
  const [flowCallbackUrl, setFlowCallbackUrl] = useState<FlowCallbackUrlState>(EMPTY_CALLBACK_URL_STATE);
  const [environmentConnections, setEnvironmentConnections] = useState<FlowEnvironmentConnection[]>([]);
  const [connectionsEnvironment, setConnectionsEnvironment] = useState('');
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [vimEnabled, setVimEnabled] = useMonacoVimPreference();
  const [flowVimMode, setFlowVimMode] = useState('off');
  const [flowOutlineActiveKey, setFlowOutlineActiveKey] = useState('');
  const [flowOutlineActivePath, setFlowOutlineActivePath] = useState<string[]>([]);
  const [showAddAction, setShowAddAction] = useState(false);
  const [addActionRunAfter, setAddActionRunAfter] = useState<string | undefined>(undefined);
  const [addActionContainer, setAddActionContainer] = useState<OutlineContainerTarget | null>(null);
  const [editingAction, setEditingAction] = useState<FlowActionEditTarget | null>(null);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [runFilter, setRunFilter] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState('');
  const [currentRun, setCurrentRun] = useState<FlowRun | null>(null);
  const [actions, setActions] = useState<FlowAction[]>([]);
  const [runAnalysis, setRunAnalysis] = useState<FlowAnalysis | null>(null);
  const [actionStatusFilter, setActionStatusFilter] = useState('');
  const [currentAction, setCurrentAction] = useState<FlowAction | null>(null);
  const [actionDetail, setActionDetail] = useState<FlowAction | null>(null);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [loadingActions, setLoadingActions] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const selectedRunRef = useRef<string | undefined>(undefined);
  const selectedActionRequestRef = useRef(0);
  const callbackUrlRequestRef = useRef(0);
  const flowEditorRef = useRef<FlowEditorHandle | null>(null);

  useEffect(() => {
    if (!active || !environment) return;
    if (environment === loadedEnvironment && flows.length) return;
    void loadFlows(false);
  }, [active, environment, flows.length, loadedEnvironment]);

  useEffect(() => {
    if (!active || !environment) return;
    if (connectionsEnvironment === environment) return;
    void loadEnvironmentConnections(false);
  }, [active, connectionsEnvironment, environment]);

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


  const isFlowEditable = currentFlow?.source === 'flow';
  const isFlowDirty = Boolean(currentFlow && flowDocument !== loadedFlowDocument);
  const flowBusy = flowOperation !== null;
  const connectionModel = useMemo(
    () => buildFlowConnectionModel(flowDocument, environmentConnections),
    [environmentConnections, flowDocument],
  );
  const flowProblems = useMemo(
    () => buildFlowProblems(analysis?.diagnostics || [], flowValidation, currentFlow ? connectionModel.issues : []),
    [analysis?.diagnostics, connectionModel.issues, currentFlow, flowValidation],
  );
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
      resetFlowCallbackUrl(null);
      setRuns([]);
      setCurrentRun(null);
      setActions([]);
      selectedActionRequestRef.current += 1;
      setCurrentAction(null);
      setActionDetail(null);
      setLoadingActions(false);
      setLoadingRuns(false);
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

  async function loadEnvironmentConnections(force: boolean) {
    if (!environment) return;
    if (!force && connectionsEnvironment === environment) return;
    setLoadingConnections(true);
    try {
      const connections = await loadFlowApiConnections(environment);
      setEnvironmentConnections(connections);
      setConnectionsEnvironment(environment);
    } catch (error) {
      setEnvironmentConnections([]);
      setConnectionsEnvironment(environment);
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoadingConnections(false);
    }
  }

  async function selectFlow(flow: FlowItem) {
    setCurrentFlow(flow);
    resetFlowCallbackUrl(flow);
    setCurrentRun(null);
    selectedActionRequestRef.current += 1;
    setCurrentAction(null);
    setActionDetail(null);
    setLoadingActions(false);
    selectedRunRef.current = undefined;
    setActions([]);
    setRuns([]);
    setLoadingRuns(true);
    try {
      const [document, loadedRuns] = await Promise.all([
        loadFlowDefinitionDocument(environment, flow),
        loadFlowRuns(environment, flow).catch(() => []),
      ]);
      setFlowDocument(document);
      setLoadedFlowDocument(document);
      setFlowValidation(null);
      setRuns(loadedRuns);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoadingRuns(false);
    }
  }

  function resetFlowCallbackUrl(flow: FlowItem | null) {
    callbackUrlRequestRef.current += 1;
    setFlowCallbackUrl({
      ...EMPTY_CALLBACK_URL_STATE,
      flowId: flowIdentifier(flow),
    });
  }

  async function revealFlowCallbackUrl() {
    if (!currentFlow) return;
    if (currentFlow.source !== 'flow') {
      toast('Trigger URL is only available for Flow API flows.', true);
      return;
    }
    const flowId = flowIdentifier(currentFlow);
    if (flowCallbackUrl.flowId === flowId && flowCallbackUrl.status === 'loaded' && flowCallbackUrl.value) {
      setFlowCallbackUrl((state) => ({ ...state, visible: true }));
      return;
    }
    const requestId = callbackUrlRequestRef.current + 1;
    callbackUrlRequestRef.current = requestId;
    setFlowCallbackUrl({ flowId, status: 'loading', value: '', kind: 'authenticated', error: '', visible: false });
    try {
      const result = await loadFlowCallbackUrl(environment, currentFlow, flowDocument);
      if (callbackUrlRequestRef.current === requestId) {
        setFlowCallbackUrl({ flowId, status: 'loaded', value: result.value, kind: result.kind, error: '', visible: true });
      }
    } catch (error) {
      if (callbackUrlRequestRef.current === requestId) {
        setFlowCallbackUrl({
          flowId,
          status: 'error',
          value: '',
          kind: 'authenticated',
          error: error instanceof Error ? error.message : String(error),
          visible: false,
        });
      }
    }
  }

  function hideFlowCallbackUrl() {
    setFlowCallbackUrl((state) => ({ ...state, visible: false }));
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

  function bindConnectionReference(referenceName: string, connection: FlowEnvironmentConnection) {
    try {
      updateFlowDocument(setFlowConnectionReference(flowDocument, referenceName, connection));
      toast(`Bound ${referenceName} to ${connection.displayName || connection.name}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function removeConnectionReference(reference: FlowConnectionReference) {
    if (reference.usages.length) {
      toast('Only unused connection references can be removed here.', true);
      return;
    }
    confirm.open({
      title: `Remove ${reference.name}?`,
      destructive: true,
      confirmLabel: 'Remove reference',
      body: <>This removes the unused connection reference from the editor. The flow is not saved until you use Check &amp; Save.</>,
      onConfirm: () => {
        try {
          updateFlowDocument(removeFlowConnectionReference(flowDocument, reference.name));
          toast(`Removed ${reference.name}`);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
        }
      },
    });
  }

  function addActionToDocument(actionName: string, action: Record<string, unknown>) {
    try {
      const next = addActionToFlowDocument(flowDocument, actionName, action, addActionRunAfter, addActionContainer ?? undefined);
      setFlowDocument(next);
      setFlowValidation(null);
      setShowAddAction(false);
      setAddActionContainer(null);
      setAddActionRunAfter(undefined);
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
      setFlows((items) => items.map((item) => sameFlowIdentity(item, currentFlow) ? { ...item, ...updated } : item));
      toast(skipServiceCheck ? 'Flow definition saved without service check' : 'Flow definition checked and saved');
    } catch (error) {
      setFlowValidation(flowValidationFromError('errors', error));
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setFlowOperation(null);
    }
  }

  function selectOutlineItem(item: FlowAnalysisOutlineItem) {
    const key = outlineKey(item);
    const path = buildOutlinePathTo(analysis?.outline || [], key);
    setFlowOutlineActiveKey(key);
    setFlowOutlineActivePath(path);
  }

  function openActionEditor(item: FlowAnalysisOutlineItem) {
    try {
      setEditingAction(readOutlineEditTarget(flowDocument, item));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function applyActionEdit(target: FlowActionEditTarget, actionName: string, value: Record<string, unknown>) {
    try {
      updateFlowDocument(replaceOutlineItemInFlowDocument(flowDocument, target, actionName, value));
      setEditingAction(null);
      toast(`Updated ${actionName}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function handleAddActionAfter(item: FlowAnalysisOutlineItem) {
    if (item.name === 'actions' && item.kind === 'action' && item.children?.length) {
      const last = item.children.filter((c) => isActionLikeOutlineItem(c)).pop();
      setAddActionRunAfter(last?.name || undefined);
    } else {
      setAddActionRunAfter(item.name || undefined);
    }
    setAddActionContainer(null);
    setShowAddAction(true);
  }

  function countDescendantActions(item: FlowAnalysisOutlineItem): number {
    let count = 0;
    for (const child of item.children || []) {
      if (isActionLikeOutlineItem(child) && child.name && child.name !== 'actions') count += 1;
      count += countDescendantActions(child);
    }
    return count;
  }

  function handleRemoveAction(item: FlowAnalysisOutlineItem) {
    const name = item.name;
    if (!name) {
      toast('This outline node has no name to remove.', true);
      return;
    }
    const childCount = countDescendantActions(item);
    confirm.open({
      title: `Remove ${name}?`,
      destructive: true,
      confirmLabel: 'Remove action',
      body: childCount > 0 ? (
        <>Removing this action also deletes {childCount} nested action{childCount === 1 ? '' : 's'}. Any other actions whose <code>runAfter</code> references <strong>{name}</strong> will lose that dependency.</>
      ) : (
        <>Any other actions whose <code>runAfter</code> references <strong>{name}</strong> will lose that dependency.</>
      ),
      onConfirm: () => {
        try {
          const next = removeActionFromFlowDocument(flowDocument, name);
          updateFlowDocument(next);
          if (flowOutlineActiveKey === outlineKey(item)) {
            setFlowOutlineActiveKey('');
            setFlowOutlineActivePath([]);
          }
          toast(`Removed ${name}`);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
        }
      },
    });
  }

  function handleHighlightJson(item: FlowAnalysisOutlineItem) {
    if (item.from === undefined || item.to === undefined) {
      toast('This outline node has no JSON range to highlight.', true);
      return;
    }
    setFlowSubTab('definition');
    const from = item.from;
    const to = item.to;
    window.setTimeout(() => flowEditorRef.current?.revealRange(from, to), 0);
  }

  function handleAddActionInside(item: FlowAnalysisOutlineItem) {
    const container = findOutlineContainerTarget(analysis?.outline || [], item);
    if (!container) {
      toast('Could not determine where to insert the action.', true);
      return;
    }
    const existing = (item.children || []).filter((c) => isActionLikeOutlineItem(c) && c.name);
    const lastExisting = existing[existing.length - 1]?.name;
    setAddActionContainer(container);
    setAddActionRunAfter(lastExisting);
    setShowAddAction(true);
  }

  function handleReorderAction(actionName: string, targetName: string, position: 'before' | 'after') {
    try {
      const siblings = findSiblingActionNames(analysis?.outline || [], actionName);
      if (!siblings) throw new Error('Could not determine action siblings.');
      const next = reorderActionInFlowDocument(flowDocument, actionName, targetName, position, siblings);
      updateFlowDocument(next);
      toast(`Moved ${actionName}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function jumpToProblem(problem: FlowProblem) {
    if (problem.source === 'connections' && problem.from === undefined && problem.to === undefined && !problem.actionName) {
      setFlowSubTab('connections');
      return;
    }
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
    if (!currentFlow) return;
    const labels = { run: 'Running', start: 'Turning on', stop: 'Turning off' };
    toast(labels[action] + '...');
    try {
      if (action === 'run') {
        const flowApiId = flowRuntimeId(currentFlow);
        if (!flowApiId) throw new Error('This flow does not expose a runtime id yet. Turn it on and refresh before running it.');
        const runTriggerName = flowRunTriggerNames(currentFlow, flowDocument)[0] || 'manual';
        await api<any>('/api/request/execute', {
          method: 'POST',
          body: JSON.stringify({ environment, api: 'flow', method: 'POST', path: `/flows/${flowApiId}/triggers/${encodeURIComponent(runTriggerName)}/run`, responseType: 'void' }),
        });
      } else {
        await setFlowActivationState(environment, currentFlow, action === 'start');
      }
      const messages = { run: 'Flow triggered', start: 'Flow turned on', stop: 'Flow turned off' };
      toast(messages[action]);
      // For state changes, poll until the API reflects the new state
      if (action === 'start' || action === 'stop') {
        const expectedState = action === 'start' ? 'Started' : 'Stopped';
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise((r) => setTimeout(r, 800));
          const refreshed = await loadFlowList(environment);
          const updated = refreshed.flows.find((flow: FlowItem) => sameFlowIdentity(flow, currentFlow));
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
      const updated = refreshed.flows.find((flow: FlowItem) => sameFlowIdentity(flow, currentFlow));
      if (updated) setCurrentFlow(updated);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function selectRun(run: FlowRun) {
    if (currentRun?.name === run.name) {
      setCurrentRun(null);
      selectedActionRequestRef.current += 1;
      setCurrentAction(null);
      setActionDetail(null);
      setActions([]);
      setRunAnalysis(null);
      setLoadingActions(false);
      selectedRunRef.current = undefined;
      return;
    }
    setCurrentRun(run);
    selectedActionRequestRef.current += 1;
    setCurrentAction(null);
    setActionDetail(null);
    await loadActionsForRun(run, { clearBeforeLoad: true });
  }

  async function refreshRuns() {
    if (!currentFlow) return;
    const selectedRunName = currentRun?.name;
    const selectedActionRef = currentAction ? runActionRefForAction(currentAction, actions) : '';
    setLoadingRuns(true);
    try {
      const loadedRuns = await loadFlowRuns(environment, currentFlow);
      setRuns(loadedRuns);
      const updatedRun = selectedRunName ? loadedRuns.find((run) => run.name === selectedRunName) || null : null;
      if (selectedRunName && !updatedRun) {
        setCurrentRun(null);
        selectedActionRequestRef.current += 1;
        setCurrentAction(null);
        setActionDetail(null);
        setActions([]);
        setRunAnalysis(null);
        setLoadingActions(false);
        selectedRunRef.current = undefined;
      } else if (updatedRun) {
        setCurrentRun(updatedRun);
        await loadActionsForRun(updatedRun, { clearBeforeLoad: false, preserveActionRef: selectedActionRef });
      }
      toast(loadedRuns.length ? `Loaded ${loadedRuns.length} recent runs` : 'No recent runs');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadActionsForRun(run: FlowRun, options: { clearBeforeLoad: boolean; preserveActionRef?: string }) {
    if (options.clearBeforeLoad) {
      setActions([]);
      setRunAnalysis(null);
    }
    setLoadingActions(true);
    selectedRunRef.current = run.name;
    try {
      let loadedActions: FlowAction[] = [];
      let loadedRunAnalysis: FlowAnalysis | null = null;
      if (currentFlow) {
        [loadedActions, loadedRunAnalysis] = await Promise.all([
          loadRunActions(environment, currentFlow, run).catch(() => []),
          loadRunDefinitionAnalysis(environment, currentFlow, run).catch(() => null),
        ]);
      }
      if (selectedRunRef.current === run.name) {
        setActions(loadedActions);
        setRunAnalysis(loadedRunAnalysis);
        if (options.preserveActionRef !== undefined) {
          const refreshedAction = options.preserveActionRef
            ? loadedActions.find((action, index) => runActionRef(action, index) === options.preserveActionRef) || null
            : null;
          selectedActionRequestRef.current += 1;
          setCurrentAction(refreshedAction);
          setActionDetail(refreshedAction);
        }
      }
    } catch {
      if (selectedRunRef.current === run.name) {
        setActions([]);
        setRunAnalysis(null);
      }
    } finally {
      if (selectedRunRef.current === run.name) setLoadingActions(false);
    }
  }

  async function selectAction(action: FlowAction) {
    const requestId = selectedActionRequestRef.current + 1;
    selectedActionRequestRef.current = requestId;
    const runName = currentRun?.name;
    const hasDuplicateActionName = Boolean(action.name && actions.filter((candidate) => candidate.name === action.name).length > 1);
    setCurrentAction(action);
    setActionDetail(action);
    try {
      const detail = currentFlow && currentRun && !hasDuplicateActionName ? await loadActionDetail(environment, currentFlow, currentRun, action) : action;
      if (selectedActionRequestRef.current === requestId && selectedRunRef.current === runName) {
        setActionDetail(detail);
      }
    } catch {
      if (selectedActionRequestRef.current === requestId && selectedRunRef.current === runName) {
        setActionDetail(action);
      }
    }
  }

  async function loadRunDefinitionAnalysis(environmentName: string, flow: FlowItem, run: FlowRun): Promise<FlowAnalysis | null> {
    const detail = await loadRunDetail(environmentName, flow, run);
    const runFlow = prop(detail, 'properties.flow');
    if (!runFlow || typeof runFlow !== 'object') return null;
    return analyzeFlowDocument(buildFlowDocument(runFlow as FlowItem));
  }

  return (
    <div className={`tab-panel ${active ? 'active' : ''}`} id="panel-automate" style={active ? undefined : { display: 'none' }}>
      <FlowInventorySidebar
        flows={flows}
        filteredFlows={filteredFlows}
        flowSource={flowSource}
        filter={filter}
        loading={loadingFlows}
        currentFlow={currentFlow}
        onFilterChange={setFilter}
        onRefresh={() => { void loadFlows(true); }}
        onSelect={(flow) => { void selectFlow(flow); }}
      />
      <div className="detail-area">
        <FlowDetailHeader
          currentFlow={currentFlow}
          callbackUrl={flowCallbackUrl.flowId === flowIdentifier(currentFlow) ? flowCallbackUrl : EMPTY_CALLBACK_URL_STATE}
          toast={toast}
          onOpenRecord={detail.open}
          onOpenConsole={openConsole}
          onFlowAction={(action) => { void flowAction(action); }}
          onRevealCallbackUrl={() => { void revealFlowCallbackUrl(); }}
          onHideCallbackUrl={hideFlowCallbackUrl}
        />

        {currentFlow ? (
          <>
            <div className="dv-sub-nav">
              {(['definition', 'runs', 'outline', 'connections'] as AutomateSubTab[]).map((tabName) => (
                <button
                  key={tabName}
                  className={`sub-tab ${flowSubTab === tabName ? 'active' : ''}`}
                  type="button"
                  onClick={() => setFlowSubTab(tabName)}
                >
                  {tabName === 'definition' ? 'Definition' : tabName === 'runs' ? 'Runs' : tabName === 'outline' ? 'Outline' : 'Connections'}
                </button>
              ))}
            </div>

            <FlowDefinitionPanel
              active={flowSubTab === 'definition'}
              analysis={analysis}
              analyzing={analyzing}
              environment={environment}
              flowBusy={flowBusy}
              flowDocument={flowDocument}
              flowEditorRef={flowEditorRef}
              flowFullscreen={flowFullscreen}
              flowOperation={flowOperation}
              flowOutlineActiveKey={flowOutlineActiveKey}
              flowOutlineActivePath={flowOutlineActivePath}
              flowProblems={flowProblems}
              flowValidation={flowValidation}
              hasBlockingServiceErrors={hasBlockingServiceErrors}
              isFlowDirty={isFlowDirty}
              isFlowEditable={Boolean(isFlowEditable)}
              toast={toast}
              vimEnabled={vimEnabled}
              flowVimMode={flowVimMode}
              onAddAction={() => { setAddActionRunAfter(undefined); setAddActionContainer(null); setShowAddAction(true); }}
              onAddAfter={handleAddActionAfter}
              onAddInside={handleAddActionInside}
              onHighlightJson={handleHighlightJson}
              onRemoveAction={handleRemoveAction}
              onCheckErrors={() => { void runFlowValidation('errors'); }}
              onCheckWarnings={() => { void runFlowValidation('warnings'); }}
              onDocumentChange={updateFlowDocument}
              onEditAction={openActionEditor}
              onFormat={formatFlowJson}
              onJumpProblem={jumpToProblem}
              onReload={() => { void reloadFlowDefinition(); }}
              onReorderAction={handleReorderAction}
              onSave={() => { void saveDefinition(); }}
              onSaveAnyway={() => { void saveDefinition(true); }}
              onSelectOutline={selectOutlineItem}
              onShowDiff={() => setShowFlowDiff(true)}
              onToggleFullscreen={() => setFlowFullscreen((value) => !value)}
              onVimMode={setFlowVimMode}
              onVimToggle={setVimEnabled}
            />

            <FlowRunsPanel
              active={flowSubTab === 'runs'}
              actions={actions}
              actionDetail={actionDetail}
              actionStatusFilter={actionStatusFilter}
              analysis={analysis}
              connectionModel={connectionModel}
              currentAction={currentAction}
              currentRun={currentRun}
              loadingActions={loadingActions}
              loadingRuns={loadingRuns}
              runAnalysis={runAnalysis}
              runFilter={runFilter}
              runs={runs}
              runStatusFilter={runStatusFilter}
              toast={toast}
              onActionStatusFilterChange={setActionStatusFilter}
              onRunFilterChange={setRunFilter}
              onRunStatusFilterChange={setRunStatusFilter}
              onRefreshRuns={() => { void refreshRuns(); }}
              onSelectAction={(action) => { void selectAction(action); }}
              onSelectRun={(run) => { void selectRun(run); }}
            />

            <FlowOutlinePanel
              active={flowSubTab === 'outline'}
              analysis={analysis}
              flowProblems={flowProblems}
              flowOutlineActiveKey={flowOutlineActiveKey}
              flowOutlineActivePath={flowOutlineActivePath}
              onAddAfter={handleAddActionAfter}
              onAddInside={handleAddActionInside}
              onHighlightJson={handleHighlightJson}
              onRemoveAction={handleRemoveAction}
              onEditAction={openActionEditor}
              onReorderAction={handleReorderAction}
              onSelectOutline={selectOutlineItem}
            />

            <FlowConnectionsPanel
              active={flowSubTab === 'connections'}
              source={flowDocument}
              model={connectionModel}
              loading={loadingConnections}
              toast={toast}
              onBindReference={bindConnectionReference}
              onRemoveReference={removeConnectionReference}
              onRefreshConnections={() => { void loadEnvironmentConnections(true); }}
              onInspect={(seed: FlowConnectionInspectSeed) => apiPreview.open(seed)}
            />
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
          connectionModel={connectionModel}
          initialRunAfter={addActionRunAfter}
          containerTarget={addActionContainer}
          onClose={() => { setShowAddAction(false); setAddActionRunAfter(undefined); setAddActionContainer(null); }}
          onAdd={addActionToDocument}
          toast={toast}
        />
      ) : null}
      {editingAction ? (
        <EditFlowActionModal
          environment={environment}
          source={flowDocument}
          connectionModel={connectionModel}
          target={editingAction}
          onApply={applyActionEdit}
          onClose={() => setEditingAction(null)}
          toast={toast}
        />
      ) : null}
      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
      {apiPreview.target && environment ? (
        <ApiResponseModal
          target={apiPreview.target}
          environment={environment}
          toast={toast}
          onClose={apiPreview.close}
          onOpenInConsole={(seed) => { apiPreview.close(); openConsole(seed); }}
        />
      ) : null}
    </div>
  );
}
