import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './utils.js';
import { CopyButton } from './CopyButton.js';
import type { ToastFn } from './ui-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordDetailTarget = {
  /** Display label for the entity (e.g. "account", "role") */
  entity: string;
  /** OData entity set name (e.g. "accounts", "roles") */
  entitySetName: string;
  /** Record GUID */
  id: string;
};

// ---------------------------------------------------------------------------
// Helpers (shared with ResultView)
// ---------------------------------------------------------------------------

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUP_RE = /^_(.+)_value$/;

export function formatCellValue(value: unknown) {
  if (value === null || value === undefined) return { display: 'null', isNull: true, isGuid: false, isObject: false } as const;
  if (typeof value === 'object') return { display: JSON.stringify(value), isNull: false, isGuid: false, isObject: true } as const;
  const str = String(value);
  return { display: str, isNull: false, isGuid: GUID_RE.test(str), isObject: false } as const;
}

export function getLookupInfo(row: any, column: string) {
  if (!LOOKUP_RE.test(column)) return null;
  return {
    targetEntity: row[`${column}@Microsoft.Dynamics.CRM.lookuplogicalname`] as string | undefined,
    formattedValue: row[`${column}@OData.Community.Display.V1.FormattedValue`] as string | undefined,
  };
}

export function columnLabel(column: string): string {
  const match = LOOKUP_RE.exec(column);
  return match ? match[1] : column;
}

// ---------------------------------------------------------------------------
// Hook — simplifies usage from any component
// ---------------------------------------------------------------------------

export function useRecordDetail() {
  const [target, setTarget] = useState<RecordDetailTarget | null>(null);
  return {
    target,
    open(entity: string, entitySetName: string, id: string) { setTarget({ entity, entitySetName, id }); },
    close() { setTarget(null); },
  };
}

// ---------------------------------------------------------------------------
// RecordDetailModal
// ---------------------------------------------------------------------------

export function RecordDetailModal(props: {
  initial: RecordDetailTarget;
  environment: string;
  entityMap?: Map<string, string>;
  onClose: () => void;
  toast?: ToastFn;
}) {
  const { initial, environment, entityMap, onClose, toast } = props;
  const [stack, setStack] = useState<RecordDetailTarget[]>([initial]);
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  const current = stack[stack.length - 1];

  // Reset stack when a new initial target is provided from outside
  useEffect(() => {
    setStack([initial]);
  }, [initial.entity, initial.entitySetName, initial.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRecord(null);
    api<any>('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({
        environment,
        api: 'dv',
        method: 'GET',
        path: `/${current.entitySetName}(${current.id})`,
        headers: { Prefer: 'odata.include-annotations="*"' },
      }),
    }).then((payload) => {
      if (!cancelled) setRecord(payload.data?.response || payload.data);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [environment, current.entitySetName, current.id]);

  function navigateToLookup(targetEntity: string, id: string) {
    const esn = entityMap?.get(targetEntity);
    if (!esn) return;
    setStack((prev) => [...prev, { entity: targetEntity, entitySetName: esn, id }]);
  }

  function goBack() {
    if (stack.length > 1) setStack((prev) => prev.slice(0, -1));
  }

  const fields = useMemo(() => {
    if (!record) return [];
    return Object.entries(record).filter(([key]) => !key.includes('@'));
  }, [record]);

  return (
    <div className="rt-modal-backdrop" ref={backdropRef} onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}>
      <div className="rt-modal">
        <div className="rt-modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {stack.length > 1 && (
                <button className="btn btn-ghost" type="button" onClick={goBack} style={{ fontSize: '0.75rem', padding: '2px 8px' }} title="Go back">&larr;</button>
              )}
              <h3 className="rt-modal-title">{current.entity}</h3>
            </div>
            <span className="rt-modal-id">{current.id}</span>
          </div>
          <div className="rt-modal-actions">
            <CopyButton value={record ? JSON.stringify(record, null, 2) : current.id} label="Copy JSON" title="Copy full record as JSON" toast={toast} />
            <button className="btn btn-ghost" type="button" onClick={onClose} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>Close</button>
          </div>
        </div>
        <div className="rt-modal-body">
          {loading ? (
            <div className="rt-modal-loading">Loading record...</div>
          ) : error ? (
            <div className="rt-modal-error">{error}</div>
          ) : fields.length ? (
            <table className="rt-detail-table">
              <tbody>
                {fields.map(([key, val]) => {
                  const { display, isNull, isGuid } = formatCellValue(val);
                  const lookup = record ? getLookupInfo(record, key) : null;
                  const isClickableLookup = !!(isGuid && lookup?.targetEntity && entityMap?.has(lookup.targetEntity));
                  return (
                    <tr key={key}>
                      <td className="rt-detail-key">{columnLabel(key)}</td>
                      <td className={`rt-detail-value ${isNull ? 'rt-cell-null' : ''} ${isGuid ? 'rt-cell-guid' : ''}`}>
                        <span className="copy-inline">
                          {isClickableLookup ? (
                            <span className="record-link" onClick={() => navigateToLookup(lookup!.targetEntity!, display)}>
                              {lookup!.formattedValue || `${display.slice(0, 8)}...`}
                            </span>
                          ) : (
                            <span className="copy-inline-value">{lookup?.formattedValue ? `${lookup.formattedValue} (${display.slice(0, 8)}...)` : display}</span>
                          )}
                          {!isNull && <CopyButton value={display} label="copy" title={`Copy ${key}`} toast={toast} stopPropagation />}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="rt-modal-loading">No fields returned.</div>
          )}
        </div>
      </div>
    </div>
  );
}
