import { useMemo } from 'react';
import { CopyButton } from '../CopyButton.js';
import { Select } from '../Select.js';
import { formatDate, highlightJson, prop } from '../utils.js';
import type { FlowAction, FlowAnalysis, FlowAnalysisOutlineItem, FlowRun, ToastFn } from '../ui-types.js';
import { FlowOutlineCanvas } from './FlowOutlineCanvas.js';
import {
  ActionIo,
  SummaryCard,
  buildRunActionOutlineItems,
  compareRunsByRecency,
  findOutlineKeyByRunActionRef,
  findRunActionForOutlineItem,
  formatRunDuration,
  runActionRefForAction,
  shortId,
  summarizeCounts,
} from './FlowRunDetails.js';
import { buildOutlinePathTo, findOutlineKeyByName } from './outline-utils.js';

export function FlowRunsPanel(props: {
  active: boolean;
  actions: FlowAction[];
  actionDetail: FlowAction | null;
  actionStatusFilter: string;
  analysis: FlowAnalysis | null;
  currentAction: FlowAction | null;
  currentRun: FlowRun | null;
  loadingActions: boolean;
  loadingRuns: boolean;
  runAnalysis: FlowAnalysis | null;
  runFilter: string;
  runs: FlowRun[];
  runStatusFilter: string;
  toast: ToastFn;
  onActionStatusFilterChange: (value: string) => void;
  onRunFilterChange: (value: string) => void;
  onRunStatusFilterChange: (value: string) => void;
  onRefreshRuns: () => void;
  onSelectAction: (action: FlowAction) => void;
  onSelectRun: (run: FlowRun) => void;
}) {
  const filteredRuns = useMemo(() => {
    return props.runs
      .map((run, index) => ({ run, index }))
      .filter(({ run }) => {
        const status = String(prop(run, 'properties.status') || '');
        const trigger = String(prop(run, 'properties.trigger.name') || '');
        const haystack = [run.name || '', status, trigger].join(' ').toLowerCase();
        return (!props.runStatusFilter || status === props.runStatusFilter) && (!props.runFilter || haystack.includes(props.runFilter.toLowerCase()));
      })
      .sort((a, b) => compareRunsByRecency(a.run, b.run) || a.index - b.index)
      .map(({ run }) => run);
  }, [props.runFilter, props.runStatusFilter, props.runs]);

  const runActionOutlineItems = useMemo(
    () => buildRunActionOutlineItems(props.runAnalysis?.outline || props.analysis?.outline || [], props.actions, props.actionStatusFilter),
    [props.runAnalysis?.outline, props.analysis?.outline, props.actions, props.actionStatusFilter],
  );
  const currentActionRef = props.currentAction ? runActionRefForAction(props.currentAction, props.actions) : '';
  const runActionActiveKey = (currentActionRef ? findOutlineKeyByRunActionRef(runActionOutlineItems, currentActionRef) : '')
    || (props.currentAction?.name ? findOutlineKeyByName(runActionOutlineItems, props.currentAction.name) : '');
  const runActionActivePath = runActionActiveKey ? buildOutlinePathTo(runActionOutlineItems, runActionActiveKey) : [];
  const actionCounts = summarizeCounts(props.actions);

  return (
    <div className={`dv-subpanel ${props.active ? 'active' : ''}`}>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2>Runs</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{props.loadingRuns ? 'Refreshing...' : 'Newest first'}</div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={props.onRefreshRuns} disabled={props.loadingRuns}>
              {props.loadingRuns ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="run-toolbar">
          <input type="text" placeholder="Filter runs…" value={props.runFilter} onChange={(event) => props.onRunFilterChange(event.target.value)} />
          <div style={{ width: 180 }}>
            <Select
              aria-label="Run status filter"
              value={props.runStatusFilter}
              onChange={props.onRunStatusFilterChange}
              options={[
                { value: '', label: 'all statuses' },
                { value: 'Succeeded', label: 'Succeeded' },
                { value: 'Failed', label: 'Failed' },
                { value: 'Running', label: 'Running' },
                { value: 'Skipped', label: 'Skipped' },
              ]}
            />
          </div>
        </div>
        <div className="card-list">
          {filteredRuns.length ? filteredRuns.map((run) => {
            const status = prop(run, 'properties.status') || 'Unknown';
            const cls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : 'pending';
            const expanded = props.currentRun?.name === run.name;
            return (
              <div key={run.name} className={`run-card ${expanded ? 'active' : ''}`}>
                <div className={`run-item status-${cls} ${expanded ? 'active' : ''}`} data-flow-run={run.name || ''} onClick={() => props.onSelectRun(run)}>
                  <div className="run-main">
                    <span className={`health-dot ${cls}`}></span>
                    <div className="run-text">
                      <div className="run-status">{status}</div>
                      <div className="run-sub">
                        <span className="action-item-type">{prop(run, 'properties.trigger.name') || '-'}</span>
                        <span className="run-duration">{formatRunDuration(run)}</span>
                        <span className="action-item-type" title={run.name || ''}>{shortId(run.name || '')}</span>
                        {run.name ? (
                          <CopyButton value={run.name} label="Copy ID" title="Copy full run ID" toast={props.toast} className="run-id-copy" stopPropagation />
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
                      <div style={{ width: 180 }}>
                        <Select
                          aria-label="Action status filter"
                          value={props.actionStatusFilter}
                          onChange={props.onActionStatusFilterChange}
                          options={[
                            { value: '', label: 'all statuses' },
                            { value: 'Succeeded', label: 'Succeeded' },
                            { value: 'Failed', label: 'Failed' },
                            { value: 'Running', label: 'Running' },
                            { value: 'Skipped', label: 'Skipped' },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="run-summary-grid" style={{ marginBottom: 12 }}>
                      <SummaryCard label="Actions" value={props.loadingActions ? 'Loading…' : String(props.actions.length)} />
                      <SummaryCard label="Failed" value={String(actionCounts.Failed || 0)} />
                      <SummaryCard label="Running" value={String(actionCounts.Running || 0)} />
                      <SummaryCard label="Succeeded" value={String(actionCounts.Succeeded || 0)} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      {props.loadingActions ? <div className="empty">Loading actions…</div> : runActionOutlineItems.length ? (
                        <FlowOutlineCanvas
                          items={runActionOutlineItems}
                          activeKey={runActionActiveKey}
                          activePath={runActionActivePath}
                          emptyMessage={props.actionStatusFilter ? 'No actions match this status.' : 'No actions in this run.'}
                          filterPlaceholder="Filter actions..."
                          canSelect={(item) => Boolean(findRunActionForOutlineItem(item, props.actions))}
                          onSelect={(item: FlowAnalysisOutlineItem) => {
                            const action = findRunActionForOutlineItem(item, props.actions);
                            if (action) props.onSelectAction(action);
                          }}
                        />
                      ) : <div className="empty">{props.actionStatusFilter ? 'No actions match this status.' : 'No actions in this run.'}</div>}
                    </div>
                    {props.currentAction ? (
                      <div className="run-action-detail">
                        <h2 style={{ marginBottom: 12 }}>{props.currentAction.name || 'Action Detail'}</h2>
                        <div className="metrics" style={{ marginBottom: 12 }}>
                          {[
                            ['Status', String(prop(props.currentAction, 'properties.status') || '-')],
                            ['Type', String(prop(props.currentAction, 'properties.type') || '-')],
                            ['Code', String(prop(props.currentAction, 'properties.code') || '-')],
                            ['Started', formatDate(prop(props.currentAction, 'properties.startTime'))],
                            ['Duration', formatRunDuration(props.currentAction)],
                            ...(prop(props.currentAction, 'properties.repetitionCount') != null ? [['Repetitions', String(prop(props.currentAction, 'properties.repetitionCount'))]] : []),
                            ...(prop(props.currentAction, 'properties.correlation.actionTrackingId') ? [['Tracking ID', String(prop(props.currentAction, 'properties.correlation.actionTrackingId'))]] : []),
                            ...(prop(props.currentAction, 'properties.canResubmit') === true ? [['Resubmit', 'Yes']] : []),
                          ].map(([label, value]) => (
                            <div className="metric" key={label}>
                              <div className="metric-label">{label}</div>
                              <div className="metric-value copy-inline">
                                <span className="copy-inline-value">{value}</span>
                                <CopyButton value={value} label="copy" title={`Copy ${label}`} toast={props.toast} />
                              </div>
                            </div>
                          ))}
                        </div>
                        <ActionIo detail={props.actionDetail} toast={props.toast} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          }) : <div className="empty">{props.loadingRuns ? 'Loading runs...' : 'No recent runs.'}</div>}
        </div>
      </div>
    </div>
  );
}
