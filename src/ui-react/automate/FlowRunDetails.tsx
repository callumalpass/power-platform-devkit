import { useState } from 'react';
import { formatDate, highlightJson, prop } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import type { FlowAction, FlowAnalysisOutlineItem, FlowRun, ToastFn } from '../ui-types.js';
import { isActionLikeOutlineItem } from './outline-utils.js';

export function SummaryCard(props: { label: string; value: string }) {
  return (
    <div className="run-summary-card">
      <div className="run-summary-card-label">{props.label}</div>
      <div className="run-summary-card-value">{props.value}</div>
    </div>
  );
}

export function ActionIo(props: { detail: FlowAction | null; toast: ToastFn }) {
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

export function formatRunDuration(item: FlowRun | FlowAction) {
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
    .map((action, index) => ({ action, index }))
    .sort((a, b) => compareActionsByExecutionOrder(a.action, b.action) || a.index - b.index)
    .map(({ action }) => action);
  const runActionByName = new Map(sortedActions.map((action, index) => [action.name || `Action ${index + 1}`, { action, index }] as const));
  const matched = new Set<string>();
  const workflow = outline.find((item) => item.kind === 'workflow') || outline[0];
  const actionContainer = workflow?.children?.find((item) => item.name === 'actions' && item.children?.length);
  const sourceItems = actionContainer?.children?.length ? actionContainer.children : [];

  const decorated = sourceItems
    .map((item) => decorateDefinitionActionForRun(item, runActionByName, matched, statusFilter))
    .filter((item): item is FlowAnalysisOutlineItem => Boolean(item));
  const unmatched = sortedActions
    .filter((action, index) => !matched.has(action.name || `Action ${index + 1}`))
    .filter((action) => !statusFilter || String(prop(action, 'properties.status') || '') === statusFilter)
    .map((action, index) => runActionToOutlineItem(action, index));

  if (decorated.length) {
    if (unmatched.length) {
      decorated.push({
        kind: 'branch',
        name: 'Run-only actions',
        detail: String(unmatched.length),
        children: unmatched,
      });
    }
    return decorated;
  }
  return unmatched;
}

function decorateDefinitionActionForRun(
  item: FlowAnalysisOutlineItem,
  runActionByName: Map<string, { action: FlowAction; index: number }>,
  matched: Set<string>,
  statusFilter: string,
): FlowAnalysisOutlineItem | null {
  const runAction = item.name ? runActionByName.get(item.name) : undefined;
  if (runAction && item.name) matched.add(item.name);
  const children = (item.children || [])
    .map((child) => decorateDefinitionActionForRun(child, runActionByName, matched, statusFilter))
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
      children: children.length ? children : item.children ? [] : undefined,
    };
  }
  const runItem = runActionToOutlineItem(runAction.action, runAction.index);
  return {
    ...item,
    kind: runItem.kind,
    detail: runItem.detail,
    type: item.type || runItem.type,
    inputs: { ...(item.inputs || {}), ...(runItem.inputs || {}) },
    children: children.length ? children : item.children ? [] : undefined,
  };
}

function runActionToOutlineItem(action: FlowAction, index = 0): FlowAnalysisOutlineItem {
  const status = String(prop(action, 'properties.status') || 'Unknown');
  const type = String(prop(action, 'properties.type') || '');
  const code = String(prop(action, 'properties.code') || '');
  const retryHistory = prop(action, 'properties.retryHistory') as unknown[] | undefined;
  return {
    kind: status === 'Failed' ? 'condition' : status === 'Running' ? 'foreach' : status === 'Skipped' ? 'branch' : 'action',
    name: action.name || `Action ${index + 1}`,
    detail: status,
    type: type || code || undefined,
    inputs: {
      step: index + 1,
      status,
      ...(code && code !== status ? { code } : {}),
      duration: formatRunDuration(action),
      ...(prop(action, 'properties.repetitionCount') != null ? { repetitions: prop(action, 'properties.repetitionCount') } : {}),
      ...(retryHistory?.length ? { retries: retryHistory.length } : {}),
    },
  };
}

export function compareRunsByRecency(a: FlowRun, b: FlowRun) {
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
