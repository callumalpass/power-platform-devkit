import { useEffect, useMemo, useRef, useState } from 'react';
import { api, readRecord } from './utils.js';
import { CopyButton } from './CopyButton.js';
import { JsonViewer } from './JsonViewer.js';
import type { ApiEnvelope, ApiExecuteResponse, ToastFn } from './ui-types.js';

export type ApiPreviewSeed = {
  title: string;
  subtitle?: string;
  api: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
};

type ViewMode = 'fields' | 'json';

export function useApiPreview() {
  const [target, setTarget] = useState<ApiPreviewSeed | null>(null);
  return {
    target,
    open(seed: ApiPreviewSeed) {
      setTarget(seed);
    },
    close() {
      setTarget(null);
    }
  };
}

export function ApiResponseModal(props: {
  target: ApiPreviewSeed;
  environment: string;
  toast?: ToastFn;
  onClose: () => void;
  onOpenInConsole?: (seed: { api: string; method: string; path: string }) => void;
}) {
  const { target, environment, toast, onClose, onOpenInConsole } = props;
  const [response, setResponse] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('fields');
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const targetHeadersKey = useMemo(() => JSON.stringify(target.headers || {}), [target.headers]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResponse(null);
    api<ApiEnvelope<ApiExecuteResponse<unknown> | unknown>>('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({
        environment,
        api: target.api,
        method: target.method,
        path: target.path,
        headers: target.headers
      })
    })
      .then((payload) => {
        if (cancelled) return;
        const dataRecord = readRecord(payload.data);
        setResponse(dataRecord && 'response' in dataRecord ? dataRecord.response : payload.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [environment, target.api, target.headers, target.method, target.path, targetHeadersKey]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rawJson = useMemo(() => {
    try {
      return JSON.stringify(response, null, 2);
    } catch {
      return '{}';
    }
  }, [response]);

  const detailRows = useMemo(() => summarizeResponse(response), [response]);

  return (
    <div
      className="rt-modal-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="rt-modal size-md api-preview-modal">
        <div className="rt-modal-header">
          <div>
            <h3 className="rt-modal-title">{target.title}</h3>
            {target.subtitle ? <span className="rt-modal-id">{target.subtitle}</span> : null}
            <div className="api-preview-req">
              <span className="api-preview-method">{target.method.toUpperCase()}</span>
              <span className="api-preview-path">{target.path}</span>
            </div>
          </div>
          <div className="rt-modal-actions">
            <CopyButton value={rawJson} label="Copy JSON" title="Copy raw response" toast={toast} />
            {onOpenInConsole ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => onOpenInConsole({ api: target.api, method: target.method, path: target.path })}
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              >
                Open in Console
              </button>
            ) : null}
            <button className="btn btn-ghost" type="button" onClick={onClose} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
              Close
            </button>
          </div>
        </div>
        <div className="api-preview-tabs">
          <button type="button" className={`api-preview-tab ${mode === 'fields' ? 'active' : ''}`} onClick={() => setMode('fields')}>
            Fields
          </button>
          <button type="button" className={`api-preview-tab ${mode === 'json' ? 'active' : ''}`} onClick={() => setMode('json')}>
            JSON
          </button>
        </div>
        <div className={`rt-modal-body ${mode === 'json' ? 'body-flush' : ''}`}>
          {loading ? (
            <div className="rt-modal-loading">Loading...</div>
          ) : error ? (
            <div className="rt-modal-error">{error}</div>
          ) : mode === 'fields' ? (
            detailRows.length ? (
              <table className="rt-detail-table">
                <tbody>
                  {detailRows.map(({ label, value, isNull }) => (
                    <tr key={label}>
                      <td className="rt-detail-key">{label}</td>
                      <td className={`rt-detail-value ${isNull ? 'rt-cell-null' : ''}`}>
                        <span className="copy-inline">
                          <span className="copy-inline-value">{value}</span>
                          {!isNull ? <CopyButton value={value} label="copy" title={`Copy ${label}`} toast={toast} stopPropagation /> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="rt-modal-loading">No summary fields available. Switch to JSON view.</div>
            )
          ) : (
            <div className="api-preview-json">
              <JsonViewer value={rawJson} height="100%" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type DetailRow = { label: string; value: string; isNull: boolean };

function summarizeResponse(value: unknown): DetailRow[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const rows: DetailRow[] = [];
  const seen = new Set<string>();
  const record = value as Record<string, unknown>;
  for (const [key, val] of Object.entries(record)) {
    if (key === 'properties' || key.startsWith('@')) continue;
    const row = toDetailRow(key, val);
    if (row) {
      rows.push(row);
      seen.add(row.label);
    }
  }
  const properties = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties) ? (record.properties as Record<string, unknown>) : null;
  if (properties) {
    for (const [key, val] of Object.entries(properties)) {
      if (key.startsWith('@')) continue;
      const label = seen.has(key) ? `properties.${key}` : key;
      const row = toDetailRow(label, val);
      if (row) {
        rows.push(row);
        seen.add(row.label);
      }
    }
  }
  return rows;
}

function toDetailRow(label: string, value: unknown): DetailRow | null {
  if (value === null || value === undefined) return { label, value: 'null', isNull: true };
  if (typeof value === 'string') return { label, value, isNull: false };
  if (typeof value === 'number' || typeof value === 'boolean') return { label, value: String(value), isNull: false };
  if (Array.isArray(value)) {
    if (!value.length) return { label, value: '[]', isNull: false };
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return { label, value: value.map((item) => (item === null ? 'null' : String(item))).join(', '), isNull: false };
    }
    return { label, value: `${value.length} item${value.length === 1 ? '' : 's'}`, isNull: false };
  }
  if (typeof value === 'object') {
    const nested = value as Record<string, unknown>;
    const displayName = pickString(nested, ['displayName', 'name', 'status', 'id']);
    if (displayName) return { label, value: displayName, isNull: false };
    const keys = Object.keys(nested);
    return { label, value: keys.length ? `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''} }` : '{}', isNull: false };
  }
  return null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}
