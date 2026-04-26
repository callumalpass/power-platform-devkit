import type { FlowAction, FlowAnalysisOutlineItem, FlowRun } from '../ui-types.js';
import { prop } from '../utils.js';
import { isActionLikeOutlineItem, outlineKey } from './outline-utils.js';

type IndexedRunAction = {
  action: FlowAction;
  originalIndex: number;
  orderIndex: number;
  ref: string;
};

export function formatRunDuration(item: FlowRun | FlowAction) {
  const startTime = prop<string | number>(item, 'properties.startTime');
  const endTime = prop<string | number>(item, 'properties.endTime');
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

export function shortId(value: string) {
  return value?.length > 12 ? value.slice(0, 6) + '…' + value.slice(-4) : value;
}

export function summarizeCounts(items: FlowAction[]) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = String(prop(item, 'properties.status') || 'Unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function buildRunActionOutlineItems(outline: FlowAnalysisOutlineItem[], runActions: FlowAction[], statusFilter: string): FlowAnalysisOutlineItem[] {
  const sortedActions = runActions
    .map((action, originalIndex) => ({ action, originalIndex }))
    .sort((a, b) => compareActionsByExecutionOrder(a.action, b.action) || a.originalIndex - b.originalIndex)
    .map(
      (entry, orderIndex): IndexedRunAction => ({
        ...entry,
        orderIndex,
        ref: runActionRef(entry.action, entry.originalIndex)
      })
    );
  const runActionsByName = buildRunActionsByName(sortedActions);
  const matched = new Set<string>();
  const workflow = outline.find((item) => item.kind === 'workflow') || outline[0];
  const actionContainer = workflow?.children?.find((item) => item.name === 'actions' && item.children?.length);
  const sourceItems = actionContainer?.children?.length ? actionContainer.children : [];

  const decorated = sourceItems.map((item) => decorateDefinitionActionForRun(item, runActionsByName, matched, statusFilter)).filter((item): item is FlowAnalysisOutlineItem => Boolean(item));
  const unmatched = sortedActions
    .filter((entry) => !matched.has(entry.ref))
    .filter((entry) => !statusFilter || String(prop(entry.action, 'properties.status') || '') === statusFilter)
    .map((entry) => runActionToOutlineItem(entry));

  if (decorated.length) {
    if (unmatched.length) {
      decorated.push({
        kind: 'branch',
        name: 'Run-only actions',
        detail: String(unmatched.length),
        children: unmatched
      });
    }
    return decorated;
  }
  return unmatched;
}

export function runActionRef(action: FlowAction, originalIndex: number) {
  return [String(originalIndex), action.name || '', String(prop(action, 'properties.correlation.actionTrackingId') || ''), String(prop(action, 'properties.startTime') || '')].join(':');
}

export function findRunActionForOutlineItem(item: FlowAnalysisOutlineItem, runActions: FlowAction[]): FlowAction | undefined {
  if (item.runActionRef) {
    const match = runActions.find((action, index) => runActionRef(action, index) === item.runActionRef);
    if (match) return match;
  }
  if (outlineItemStatus(item) === 'not run') return undefined;
  return item.name ? runActions.find((candidate) => candidate.name === item.name) : undefined;
}

export function findOutlineKeyByRunActionRef(items: FlowAnalysisOutlineItem[], ref: string): string {
  for (const item of items) {
    if (item.runActionRef === ref) return outlineKey(item);
    const childKey = findOutlineKeyByRunActionRef(item.children || [], ref);
    if (childKey) return childKey;
  }
  return '';
}

export function runActionRefForAction(action: FlowAction, runActions: FlowAction[]): string {
  const index = runActions.indexOf(action);
  return index >= 0 ? runActionRef(action, index) : '';
}

export function compareRunsByRecency(a: FlowRun, b: FlowRun) {
  const aStart = timestampValue(prop(a, 'properties.startTime'));
  const bStart = timestampValue(prop(b, 'properties.startTime'));
  return compareNullableDescending(aStart, bStart);
}

function buildRunActionsByName(actions: IndexedRunAction[]) {
  const byName = new Map<string, IndexedRunAction[]>();
  for (const entry of actions) {
    const name = entry.action.name || `Action ${entry.orderIndex + 1}`;
    const existing = byName.get(name);
    if (existing) existing.push(entry);
    else byName.set(name, [entry]);
  }
  return byName;
}

function takeNextRunActionByName(runActionsByName: Map<string, IndexedRunAction[]>, name: string | undefined) {
  if (!name) return undefined;
  const matches = runActionsByName.get(name);
  return matches?.shift();
}

function decorateDefinitionActionForRun(item: FlowAnalysisOutlineItem, runActionsByName: Map<string, IndexedRunAction[]>, matched: Set<string>, statusFilter: string): FlowAnalysisOutlineItem | null {
  const runAction = takeNextRunActionByName(runActionsByName, item.name);
  if (runAction) matched.add(runAction.ref);
  const children = (item.children || [])
    .map((child) => decorateDefinitionActionForRun(child, runActionsByName, matched, statusFilter))
    .filter((child): child is FlowAnalysisOutlineItem => Boolean(child));
  if (statusFilter && !runAction && !children.length) return null;
  if (statusFilter && runAction && String(prop(runAction.action, 'properties.status') || '') !== statusFilter && !children.length) return null;
  if (!isActionLikeOutlineItem(item)) {
    return children.length ? { ...item, children } : null;
  }
  if (!runAction) {
    return {
      ...item,
      detail: item.detail ? `${item.detail} · not run` : 'not run',
      inputs: { ...(item.inputs || {}), status: 'not run' },
      children: children.length ? children : item.children ? [] : undefined
    };
  }
  const runItem = runActionToOutlineItem(runAction);
  return {
    ...item,
    kind: runItem.kind,
    detail: runItem.detail,
    type: item.type || runItem.type,
    runActionRef: runItem.runActionRef,
    inputs: { ...(item.inputs || {}), ...(runItem.inputs || {}) },
    children: children.length ? children : item.children ? [] : undefined
  };
}

function runActionToOutlineItem(entry: IndexedRunAction): FlowAnalysisOutlineItem {
  const { action, orderIndex, ref } = entry;
  const status = String(prop(action, 'properties.status') || 'Unknown');
  const type = String(prop(action, 'properties.type') || '');
  const code = String(prop(action, 'properties.code') || '');
  const retryHistory = prop(action, 'properties.retryHistory') as unknown[] | undefined;
  return {
    kind: status === 'Failed' ? 'condition' : status === 'Running' ? 'foreach' : status === 'Skipped' ? 'branch' : 'action',
    name: action.name || `Action ${orderIndex + 1}`,
    detail: status,
    type: type || code || undefined,
    runActionRef: ref,
    inputs: {
      step: orderIndex + 1,
      status,
      ...(code && code !== status ? { code } : {}),
      duration: formatRunDuration(action),
      ...(prop(action, 'properties.repetitionCount') != null ? { repetitions: prop(action, 'properties.repetitionCount') } : {}),
      ...(retryHistory?.length ? { retries: retryHistory.length } : {})
    }
  };
}

function outlineItemStatus(item: FlowAnalysisOutlineItem) {
  const status = typeof item.inputs?.status === 'string' ? item.inputs.status : '';
  return status.trim().toLowerCase();
}

function compareActionsByExecutionOrder(a: FlowAction, b: FlowAction) {
  const aStart = timestampValue(prop(a, 'properties.startTime'));
  const bStart = timestampValue(prop(b, 'properties.startTime'));
  const aEnd = timestampValue(prop(a, 'properties.endTime'));
  const bEnd = timestampValue(prop(b, 'properties.endTime'));
  return compareNullableAscending(aStart, bStart) || compareNullableAscending(aEnd, bEnd);
}

function timestampValue(value: unknown) {
  if (!value) return null;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

function compareNullableAscending(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function compareNullableDescending(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}
