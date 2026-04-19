import { useState } from 'react';
import { formatDate, highlightJson, prop } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import type { FlowAction, ToastFn } from '../ui-types.js';

export {
  buildRunActionOutlineItems,
  compareRunsByRecency,
  findOutlineKeyByRunActionRef,
  findRunActionForOutlineItem,
  formatRunDuration,
  runActionRef,
  runActionRefForAction,
  shortId,
  summarizeCounts,
} from './flow-run-outline.js';

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
