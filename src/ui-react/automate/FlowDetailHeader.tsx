import { flowIdentifier } from '../automate-data.js';
import { CopyButton } from '../CopyButton.js';
import { formatDate, prop } from '../utils.js';
import type { FlowItem, ToastFn } from '../ui-types.js';

export function FlowDetailHeader(props: {
  currentFlow: FlowItem | null;
  toast: ToastFn;
  onOpenRecord: (logicalName: string, entitySetName: string, id: string) => void;
  onOpenConsole: (seed: { api: string; method: string; path: string }) => void;
  onFlowAction: (action: 'run' | 'start' | 'stop') => void;
}) {
  const { currentFlow, toast, onOpenRecord, onOpenConsole, onFlowAction } = props;

  return (
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
                <span className="record-link" onClick={() => onOpenRecord('workflow', 'workflows', flowIdentifier(currentFlow))}>
                  {prop(currentFlow, 'properties.description') || flowIdentifier(currentFlow)}
                </span>
                <CopyButton value={flowIdentifier(currentFlow)} label="copy id" title="Copy flow ID" toast={toast} />
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {currentFlow.source === 'flow' ? (
                String(prop(currentFlow, 'properties.state')) === 'Started' ? (
                  <>
                    <button className="btn btn-primary" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => onFlowAction('run')}>Run Now</button>
                    <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => onFlowAction('stop')}>Turn Off</button>
                  </>
                ) : (
                  <button className="btn btn-primary" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => onFlowAction('start')}>Turn On</button>
                )
              ) : null}
              <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem' }} onClick={() => onOpenConsole(currentFlow.source === 'dv'
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
  );
}
