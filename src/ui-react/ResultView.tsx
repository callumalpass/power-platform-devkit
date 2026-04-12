import { useCallback, useMemo, useRef, useState } from 'react';
import { highlightJson } from './utils.js';
import { CopyButton } from './CopyButton.js';
import { RecordDetailModal, formatCellValue, getLookupInfo, columnLabel, type RecordDetailTarget } from './RecordDetailModal.js';
import type { ToastFn } from './ui-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortState = { column: string; direction: 'asc' | 'desc' } | null;

export type ResultViewProps = {
  result: any;
  entityLogicalName?: string;
  entitySetName?: string;
  primaryIdAttribute?: string;
  environment?: string;
  entityMap?: Map<string, string>;
  placeholder?: string;
  toast?: ToastFn;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractColumns(records: any[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of records) {
    for (const key of Object.keys(row)) {
      if (key.includes('@')) continue;
      if (!seen.has(key)) { seen.add(key); columns.push(key); }
    }
  }
  return columns;
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

// ---------------------------------------------------------------------------
// Cell
// ---------------------------------------------------------------------------

function Cell(props: {
  value: unknown;
  column: string;
  isPrimaryId?: boolean;
  isLookup?: boolean;
  lookupEntity?: string;
  lookupLabel?: string;
  onRecordClick?: (entity: string, id: string) => void;
  toast?: ToastFn;
}) {
  const { value, isPrimaryId, isLookup, lookupEntity, lookupLabel, onRecordClick, toast } = props;
  const { display, isNull, isGuid, isObject } = formatCellValue(value);
  const [expanded, setExpanded] = useState(false);

  if (isNull) {
    return <td className="rt-cell rt-cell-null">null</td>;
  }

  if (isGuid) {
    const short = display.slice(0, 8);
    const target = isPrimaryId ? '__self__' : isLookup ? lookupEntity : undefined;
    const clickable = !!(target && onRecordClick);

    return (
      <td className="rt-cell rt-cell-guid" title={display}>
        <span className="copy-inline">
          {clickable ? (
            <span className="record-link" onClick={(e) => { e.stopPropagation(); onRecordClick!(target!, display); }}>
              {lookupLabel || `${short}...`}
            </span>
          ) : (
            <span className="rt-guid-value">
              {lookupLabel ? <>{lookupLabel} <span style={{ color: 'var(--muted)' }}>({short}...)</span></> : `${short}...`}
            </span>
          )}
          <CopyButton value={display} label="copy" title="Copy full GUID" toast={toast} stopPropagation />
        </span>
      </td>
    );
  }

  if (display.length > 80 || isObject) {
    return (
      <td className={`rt-cell rt-cell-long ${expanded ? 'rt-cell-expanded' : ''}`}>
        <span className="rt-cell-content" onClick={() => setExpanded(!expanded)}>
          {expanded ? display : `${display.slice(0, 80)}...`}
        </span>
        <CopyButton value={display} label="copy" className="rt-cell-copy" title="Copy value" toast={toast} stopPropagation />
      </td>
    );
  }

  return (
    <td className="rt-cell" title={display}>
      <span className="copy-inline">
        <span className="copy-inline-value">{display}</span>
        <CopyButton value={display} label="copy" title="Copy value" toast={toast} stopPropagation />
      </span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// ResultTable
// ---------------------------------------------------------------------------

function ResultTable(props: {
  records: any[];
  primaryIdColumn?: string;
  totalCount?: number;
  onRecordClick?: (entity: string, id: string) => void;
  toast?: ToastFn;
}) {
  const { records, primaryIdColumn, totalCount, onRecordClick, toast } = props;
  const [sort, setSort] = useState<SortState>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const columns = useMemo(() => extractColumns(records), [records]);

  const sortedRecords = useMemo(() => {
    if (!sort) return records;
    const { column, direction } = sort;
    const sorted = [...records].sort((a, b) => compareValues(a[column], b[column]));
    return direction === 'desc' ? sorted.reverse() : sorted;
  }, [records, sort]);

  function handleHeaderClick(column: string) {
    if (resizeRef.current) return;
    setSort((cur) => {
      if (cur?.column === column) return cur.direction === 'asc' ? { column, direction: 'desc' } : null;
      return { column, direction: 'asc' };
    });
  }

  const handleResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest('th');
    if (!th) return;
    resizeRef.current = { col, startX: e.clientX, startW: th.offsetWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      setColWidths((prev) => ({ ...prev, [resizeRef.current!.col]: Math.max(40, resizeRef.current!.startW + ev.clientX - resizeRef.current!.startX) }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { resizeRef.current = null; }, 0);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  if (!columns.length) return null;

  const countLabel = totalCount != null && totalCount !== records.length
    ? `${records.length} of ${totalCount.toLocaleString()} records`
    : `${records.length} record${records.length === 1 ? '' : 's'}`;

  return (
    <div className="rt-wrap">
      <div className="rt-scroll">
        <table className="rt-table" style={{ tableLayout: Object.keys(colWidths).length ? 'fixed' : undefined }}>
          <thead>
            <tr>
              {columns.map((col) => {
                const isSorted = sort?.column === col;
                const arrow = isSorted ? (sort!.direction === 'asc' ? ' \u2191' : ' \u2193') : '';
                const width = colWidths[col];
                return (
                  <th key={col} className={`rt-th ${isSorted ? 'rt-th-sorted' : ''}`} style={width ? { width } : undefined} onClick={() => handleHeaderClick(col)} title={`Sort by ${col}`}>
                    <span className="rt-th-label">{columnLabel(col)}{arrow}</span>
                    <span className="rt-resize-handle" onMouseDown={(ev) => handleResizeStart(col, ev)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRecords.map((row, i) => {
              const rowId = primaryIdColumn ? row[primaryIdColumn] : undefined;
              const rowClickable = !!(rowId && typeof rowId === 'string' && onRecordClick);
              return (
              <tr key={i} className={rowClickable ? 'rt-row-clickable' : ''} onClick={rowClickable ? () => onRecordClick!('__self__', rowId as string) : undefined}>
                {columns.map((col) => {
                  const lookup = getLookupInfo(row, col);
                  return (
                    <Cell
                      key={col}
                      column={col}
                      value={row[col]}
                      isPrimaryId={col === primaryIdColumn}
                      isLookup={!!lookup}
                      lookupEntity={lookup?.targetEntity}
                      lookupLabel={lookup?.formattedValue}
                      onRecordClick={onRecordClick}
                      toast={toast}
                    />
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rt-footer">{countLabel}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResultView
// ---------------------------------------------------------------------------

export function ResultView(props: ResultViewProps) {
  const { result, entityLogicalName, entitySetName, primaryIdAttribute, environment, entityMap, placeholder, toast } = props;
  const [view, setView] = useState<'table' | 'json'>('table');
  const [detailTarget, setDetailTarget] = useState<RecordDetailTarget | null>(null);

  const records: any[] = result?.records || [];
  const hasRecords = records.length > 0;
  const totalCount = result?.count;
  const resolvedEntitySetName = entitySetName || result?.entitySetName;

  function handleRecordClick(entity: string, id: string) {
    if (!environment) return;
    let esn: string | undefined;
    let label = entity;
    if (entity === '__self__') {
      esn = resolvedEntitySetName;
      label = entityLogicalName || resolvedEntitySetName || '';
    } else {
      esn = entityMap?.get(entity);
    }
    if (!esn) return;
    setDetailTarget({ entity: label, entitySetName: esn, id });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="result-toggle">
          <button className={`result-toggle-btn ${view === 'table' ? 'active' : ''}`} type="button" onClick={() => setView('table')}>Table</button>
          <button className={`result-toggle-btn ${view === 'json' ? 'active' : ''}`} type="button" onClick={() => setView('json')}>JSON</button>
        </div>
        <CopyButton value={result || placeholder || 'No data.'} label="Copy JSON" title="Copy result JSON" toast={toast} />
      </div>

      {view === 'table' && hasRecords ? (
        <ResultTable
          records={records}
          primaryIdColumn={primaryIdAttribute}
          totalCount={totalCount}
          onRecordClick={environment ? handleRecordClick : undefined}
          toast={toast}
        />
      ) : (
        <pre className="viewer" dangerouslySetInnerHTML={{ __html: highlightJson(result || placeholder || 'No data.') }} />
      )}

      {detailTarget && environment && (
        <RecordDetailModal
          initial={detailTarget}
          environment={environment}
          entityMap={entityMap}
          onClose={() => setDetailTarget(null)}
          toast={toast}
        />
      )}
    </div>
  );
}
