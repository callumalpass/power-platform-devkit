import { flowIdentifier, flowRuntimeId, flowWorkflowId } from '../automate-data.js';
import { CopyButton } from '../CopyButton.js';
import { formatDate, prop } from '../utils.js';
import type { FlowItem, ToastFn } from '../ui-types.js';

type FlowCallbackUrlState = {
  flowId: string;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  value: string;
  kind: 'signed' | 'authenticated';
  error: string;
  visible: boolean;
};

export function FlowDetailHeader(props: {
  currentFlow: FlowItem | null;
  callbackUrl: FlowCallbackUrlState;
  toast: ToastFn;
  onOpenRecord: (logicalName: string, entitySetName: string, id: string) => void;
  onOpenConsole: (seed: { api: string; method: string; path: string }) => void;
  onFlowAction: (action: 'run' | 'start' | 'stop') => void;
  onRevealCallbackUrl: () => void;
  onHideCallbackUrl: () => void;
}) {
  const { currentFlow, callbackUrl, toast, onOpenRecord, onOpenConsole, onFlowAction, onRevealCallbackUrl, onHideCallbackUrl } = props;
  const workflowId = flowWorkflowId(currentFlow);
  const runtimeId = flowRuntimeId(currentFlow);
  const displayId = flowIdentifier(currentFlow);

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
                {workflowId ? (
                  <span className="record-link" onClick={() => onOpenRecord('workflow', 'workflows', workflowId)}>
                    {prop(currentFlow, 'properties.description') || workflowId}
                  </span>
                ) : (
                  <span>{prop(currentFlow, 'properties.description') || displayId}</span>
                )}
                <CopyButton value={displayId} label="copy id" title="Copy flow ID" toast={toast} />
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {String(prop(currentFlow, 'properties.state')) === 'Started' ? (
                <>
                  {runtimeId ? (
                    <button className="btn btn-primary" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => onFlowAction('run')}>
                      Run Now
                    </button>
                  ) : null}
                  <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => onFlowAction('stop')}>
                    Turn Off
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => onFlowAction('start')}>
                  Turn On
                </button>
              )}
              <button
                className="btn btn-ghost"
                type="button"
                style={{ fontSize: '0.75rem' }}
                onClick={() =>
                  onOpenConsole(
                    currentFlow.source === 'dv' ? { api: 'dv', method: 'GET', path: `/workflows(${workflowId || displayId})` } : { api: 'flow', method: 'GET', path: `/flows/${displayId}` }
                  )
                }
              >
                Open in Console
              </button>
            </div>
          </div>
          <div className="metrics">
            <div className="metric">
              <div className="metric-label">State</div>
              <div className="metric-value">
                <span className={`health-dot ${String(prop(currentFlow, 'properties.state')) === 'Started' ? 'ok' : 'error'}`} style={{ marginRight: 4 }}></span>
                {String(prop(currentFlow, 'properties.state') || '-')}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Created</div>
              <div className="metric-value">{formatDate(prop(currentFlow, 'properties.createdTime'))}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Modified</div>
              <div className="metric-value">{formatDate(prop(currentFlow, 'properties.lastModifiedTime'))}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Trigger</div>
              <div className="metric-value">{prop(currentFlow, 'properties.definitionSummary.triggers.0.type') || '-'}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Actions</div>
              <div className="metric-value">{String((prop<unknown[]>(currentFlow, 'properties.definitionSummary.actions') || []).length || 0)}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Source</div>
              <div className="metric-value">{currentFlow.source === 'dv' ? 'Dataverse fallback' : 'Flow API'}</div>
            </div>
          </div>
          {currentFlow.source === 'flow' ? (
            <div className="flow-callback-url">
              <div className="flow-callback-url-copy">
                <div className="flow-callback-url-label">Trigger URL</div>
                <div className="flow-callback-url-warning">
                  {callbackUrl.status === 'loaded'
                    ? callbackUrl.kind === 'signed'
                      ? 'Anyone with this URL can trigger the flow.'
                      : 'Requires an authenticated Flow API request.'
                    : 'Reveal the URL to check how it can be used.'}
                </div>
                {callbackUrl.status === 'error' ? <div className="flow-callback-url-error">{callbackUrl.error}</div> : null}
              </div>
              <div className="flow-callback-url-actions">
                {callbackUrl.status === 'loaded' && callbackUrl.visible ? (
                  <>
                    <code className="flow-callback-url-secret">{maskCallbackUrl(callbackUrl.value)}</code>
                    <CopyButton value={callbackUrl.value} label="copy url" title="Copy full trigger URL" toast={toast} />
                    <button className="btn btn-ghost btn-sm" type="button" onClick={onHideCallbackUrl}>
                      Hide
                    </button>
                  </>
                ) : (
                  <button className="btn btn-ghost btn-sm" type="button" disabled={callbackUrl.status === 'loading'} onClick={onRevealCallbackUrl}>
                    {callbackUrl.status === 'loading' ? 'Loading...' : callbackUrl.status === 'error' ? 'Retry' : 'Reveal trigger URL'}
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function maskCallbackUrl(value: string) {
  try {
    const url = new URL(value);
    const sig = url.searchParams.get('sig');
    return `${url.origin}${url.pathname}?...${sig ? `&sig=...${sig.slice(-4)}` : ''}`;
  } catch {
    return 'Trigger URL loaded';
  }
}
