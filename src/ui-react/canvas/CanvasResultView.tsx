import { useMemo, useState } from 'react';
import { CopyButton } from '../CopyButton.js';
import { highlightJson, readRecord } from '../utils.js';
import type { UnknownRecord } from '../ui-types.js';

function canvasResultRows(result: unknown): UnknownRecord[] | null {
  const record = readRecord(result);
  if (!record) return null;
  for (const key of ['controls', 'apis', 'dataSources', 'files', 'errors', 'value']) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((item): item is UnknownRecord => readRecord(item) !== undefined);
  }
  return null;
}

export function renderScalar(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function CanvasResultView(props: { result: unknown; toast: (message: string, isError?: boolean) => void; onRowClick?: (item: UnknownRecord) => void }) {
  const { result, toast, onRowClick } = props;
  const [view, setView] = useState<'table' | 'json'>('table');
  const rowClickable = Boolean(onRowClick);

  const items = useMemo(() => canvasResultRows(result), [result]);

  const columns: string[] = useMemo(() => {
    if (!items || items.length === 0) return [];
    const cols = new Set<string>();
    for (const item of items.slice(0, 50)) {
      for (const key of Object.keys(item)) {
        const value = item[key];
        if (typeof value !== 'object' || value === null) {
          cols.add(key);
        }
      }
    }
    return Array.from(cols);
  }, [items]);

  const hasTable = items !== null && items.length > 0 && columns.length > 0;
  const count = renderScalar(readRecord(result)?.count ?? items?.length);

  return (
    <div>
      <div className="toolbar-row tight">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasTable && (
            <div className="result-toggle">
              <button className={`result-toggle-btn ${view === 'table' ? 'active' : ''}`} type="button" onClick={() => setView('table')}>
                Table
              </button>
              <button className={`result-toggle-btn ${view === 'json' ? 'active' : ''}`} type="button" onClick={() => setView('json')}>
                JSON
              </button>
            </div>
          )}
          {count !== null && <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{count} items</span>}
        </div>
        <CopyButton value={result} label="Copy JSON" title="Copy result JSON" toast={toast} />
      </div>

      {view === 'table' && hasTable ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="result-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items!.map((item, i) => (
                <tr key={i} className={rowClickable ? 'canvas-result-row-clickable' : ''} onClick={rowClickable ? () => onRowClick!(item) : undefined}>
                  {columns.map((col) => (
                    <td key={col}>{item?.[col] === undefined || item[col] === null ? '' : String(item[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(result || 'No data.') }} />
      )}
    </div>
  );
}
