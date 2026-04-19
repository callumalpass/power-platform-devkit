import { useMemo, useRef, useState } from 'react';
import type { FlowAnalysisOutlineItem } from '../ui-types.js';
import type { FlowProblem } from './types.js';
import { INPUT_LABELS, KIND_DOT, canHoldChildActions, isActionLikeOutlineItem, isBranchOutlineItem, isSingleBodyContainer, outlineKey, outlineTitle } from './outline-utils.js';
import { OverflowMenu, type OverflowItem } from '../setup/OverflowMenu.js';

type OutlineProblemSummary = { error: number; warning: number; info: number };

export function FlowOutlineCanvas(props: {
  items: FlowAnalysisOutlineItem[];
  problems?: FlowProblem[];
  activeKey?: string;
  activePath?: string[];
  emptyMessage?: string;
  filterPlaceholder?: string;
  onSelect?: (item: FlowAnalysisOutlineItem) => void;
  canSelect?: (item: FlowAnalysisOutlineItem) => boolean;
  onEditAction?: (item: FlowAnalysisOutlineItem) => void;
  onAddAfter?: (item: FlowAnalysisOutlineItem) => void;
  onAddInside?: (item: FlowAnalysisOutlineItem) => void;
  onHighlightJson?: (item: FlowAnalysisOutlineItem) => void;
  onReorder?: (actionName: string, targetName: string, position: 'before' | 'after') => void;
}) {
  const { items } = props;
  const [query, setQuery] = useState('');
  const filteredItems = useMemo(() => filterOutlineItems(items, query), [items, query]);
  if (!items.length) return <div className="empty">{props.emptyMessage || 'Load a flow definition to see the outline.'}</div>;
  return (
    <>
      <div className="flow-outline-filter">
        <input
          type="search"
          placeholder={props.filterPlaceholder || 'Filter...'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="flow-outline-scroll">
        {filteredItems.length ? (
          <OutlineNodeList
            items={filteredItems}
            depth={0}
            problems={props.problems || []}
            activeKey={props.activeKey || ''}
            activePath={props.activePath || []}
            onSelect={props.onSelect}
            canSelect={props.canSelect}
            onEditAction={props.onEditAction}
            onAddAfter={props.onAddAfter}
            onAddInside={props.onAddInside}
            onHighlightJson={props.onHighlightJson}
            onReorder={props.onReorder}
          />
        ) : (
          <div className="empty">No matches.</div>
        )}
      </div>
    </>
  );
}

function OutlineNodeList(props: {
  items: FlowAnalysisOutlineItem[];
  depth: number;
  problems: FlowProblem[];
  activeKey: string;
  activePath: string[];
  onSelect?: (item: FlowAnalysisOutlineItem) => void;
  canSelect?: (item: FlowAnalysisOutlineItem) => boolean;
  onEditAction?: (item: FlowAnalysisOutlineItem) => void;
  onAddAfter?: (item: FlowAnalysisOutlineItem) => void;
  onAddInside?: (item: FlowAnalysisOutlineItem) => void;
  onHighlightJson?: (item: FlowAnalysisOutlineItem) => void;
  onReorder?: (actionName: string, targetName: string, position: 'before' | 'after') => void;
}) {
  return (
    <>
      {props.items.map((item) => (
        <OutlineNode
          key={outlineKey(item)}
          item={item}
          depth={props.depth}
          problems={props.problems}
          activeKey={props.activeKey}
          activePath={props.activePath}
          onSelect={props.onSelect}
          canSelect={props.canSelect}
          onEditAction={props.onEditAction}
          onAddAfter={props.onAddAfter}
          onAddInside={props.onAddInside}
          onHighlightJson={props.onHighlightJson}
          onReorder={props.onReorder}
        />
      ))}
    </>
  );
}

// Outline node styles are defined in ui-app.ts (.flow-outline-*)

function OutlineNode(props: {
  item: FlowAnalysisOutlineItem;
  depth: number;
  problems: FlowProblem[];
  activeKey: string;
  activePath: string[];
  onSelect?: (item: FlowAnalysisOutlineItem) => void;
  canSelect?: (item: FlowAnalysisOutlineItem) => boolean;
  onEditAction?: (item: FlowAnalysisOutlineItem) => void;
  onAddAfter?: (item: FlowAnalysisOutlineItem) => void;
  onAddInside?: (item: FlowAnalysisOutlineItem) => void;
  onHighlightJson?: (item: FlowAnalysisOutlineItem) => void;
  onReorder?: (actionName: string, targetName: string, position: 'before' | 'after') => void;
}) {
  const { item, depth, problems, activeKey, activePath, onSelect, canSelect, onEditAction, onAddAfter, onAddInside, onHighlightJson, onReorder } = props;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const itemKey = outlineKey(item);
  const active = activeKey === itemKey;
  const inActivePath = activePath.includes(itemKey);
  const [manuallyOpen, setManuallyOpen] = useState(depth < 2);
  const [dragOver, setDragOver] = useState<'before' | 'after' | null>(null);
  const [dragging, setDragging] = useState(false);
  const hasChildren = Boolean(item.children?.length);
  const kind = String(item.kind || '').toLowerCase();
  const dotColor = KIND_DOT[kind] || KIND_DOT.default;
  const problemSummary = summarizeOutlineProblems(item, problems);
  const hasProblem = problemSummary.error || problemSummary.warning || problemSummary.info;
  const open = manuallyOpen || inActivePath;
  const indent = depth * 16 + 8;
  const title = outlineTitle(item);
  const statusBadge = runStatusBadge(item);
  const typeHint = [statusBadge ? undefined : item.detail, item.type]
    .filter((value): value is string => Boolean(value && value !== title))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' · ');
  const editable = Boolean(onEditAction && item.name && item.from !== undefined && item.to !== undefined && item.kind !== 'branch');
  const selectable = Boolean(onSelect && (!canSelect || canSelect(item)));
  const notSelectable = Boolean(onSelect && !selectable);
  const notRun = statusBadge?.className === 'not-run';

  const isAction = isActionLikeOutlineItem(item);
  const isActionsContainer = item.kind === 'action' && item.name === 'actions' && hasChildren;
  const canAddAfter = (isAction || isActionsContainer) && Boolean(onAddAfter) && !isBranchOutlineItem(item);
  const canAddInside = canHoldChildActions(item) && Boolean(onAddInside);
  const kindLower = String(item.kind || '').toLowerCase();
  const isMultiBranchContainer = kindLower === 'condition' || kindLower === 'switch';
  const branchChildren = isMultiBranchContainer && onAddInside
    ? (item.children || []).filter(isBranchOutlineItem)
    : [];
  const menuItems: OverflowItem[] = [];
  if (canAddAfter) {
    menuItems.push({
      label: isActionsContainer ? 'Add action' : 'Add action after',
      onClick: () => onAddAfter?.(item),
    });
  }
  if (canAddInside) {
    const label = isSingleBodyContainer(item)
      ? `Add action inside ${item.name || 'container'}`
      : 'Add action inside this branch';
    menuItems.push({ label, onClick: () => onAddInside?.(item) });
  }
  // Condition/Switch: offer one item per branch so users don't have to expand first.
  for (const branch of branchChildren) {
    const branchName = branch.name || 'branch';
    menuItems.push({
      label: `Add action to ${branchName}`,
      onClick: () => onAddInside?.(branch),
    });
  }
  if (editable) {
    menuItems.push({ label: 'Edit action', onClick: () => onEditAction?.(item) });
  }
  if (onHighlightJson && item.from !== undefined && item.to !== undefined) {
    menuItems.push({ label: 'Highlight JSON', onClick: () => onHighlightJson(item) });
  }
  const draggable = isAction && !isActionsContainer && Boolean(onReorder) && Boolean(item.name);
  const isDropTarget = isAction && !isActionsContainer && Boolean(item.name);

  const rowClasses = [
    'flow-outline-row',
    active && 'active',
    dragging && 'dragging',
    draggable && 'draggable',
    selectable && 'selectable',
    notSelectable && 'not-selectable',
    notRun && 'not-run',
    hasChildren && 'has-children',
  ].filter(Boolean).join(' ');

  return (
    <>
      {dragOver === 'before' && <div className="flow-outline-drop-line" />}
      <div
        ref={rowRef}
        className={rowClasses}
        draggable={draggable}
        onDragStart={(e) => {
          if (!draggable) return;
          e.dataTransfer.setData('application/x-outline-action', item.name || '');
          e.dataTransfer.effectAllowed = 'move';
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
        onDragOver={(e) => {
          if (!isDropTarget || !e.dataTransfer.types.includes('application/x-outline-action')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setDragOver(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
        }}
        onDragLeave={(e) => {
          if (!rowRef.current?.contains(e.relatedTarget as Node)) setDragOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const sourceName = e.dataTransfer.getData('application/x-outline-action');
          if (sourceName && sourceName !== item.name && dragOver && item.name) {
            onReorder?.(sourceName, item.name, dragOver);
          }
          setDragOver(null);
        }}
        onClick={() => {
          if (selectable) onSelect?.(item);
          if (hasChildren) setManuallyOpen(!open);
        }}
        style={{ paddingLeft: indent }}
        title={notRun ? 'This action did not run in this historical run.' : undefined}
      >
        <span className="flow-outline-toggle">
          {hasChildren ? (open ? '\u25BE' : '\u25B8') : ''}
        </span>
        <span className="flow-outline-dot" style={{ background: dotColor }} />
        {editable ? (
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEditAction?.(item); }}
            className="flow-outline-title editable"
          >
            {title}
          </a>
        ) : (
          <span className="flow-outline-title">{title}</span>
        )}
        {statusBadge ? <span className={`flow-outline-status-badge ${statusBadge.className}`}>{statusBadge.label}</span> : null}
        {typeHint ? <span className="flow-outline-type-hint">{typeHint}</span> : null}
        {hasProblem ? (
          <span
            className="flow-outline-problem-dot"
            title={outlineProblemTitle(problemSummary)}
            style={{ background: problemSummary.error ? 'var(--danger)' : problemSummary.warning ? '#d97706' : 'var(--accent)' }}
          />
        ) : null}
        {menuItems.length ? (
          <span
            className="flow-outline-menu"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <OverflowMenu items={menuItems} label="Action menu" />
          </span>
        ) : null}
      </div>
      {dragOver === 'after' && <div className="flow-outline-drop-line" />}
      {open && hasChildren && (
        <OutlineNodeList items={item.children!} depth={depth + 1} problems={problems} activeKey={activeKey} activePath={activePath} onSelect={onSelect} canSelect={canSelect} onEditAction={onEditAction} onAddAfter={onAddAfter} onAddInside={onAddInside} onHighlightJson={onHighlightJson} onReorder={onReorder} />
      )}
    </>
  );
}

function runStatusBadge(item: FlowAnalysisOutlineItem): { label: string; className: string } | null {
  const raw = typeof item.inputs?.status === 'string' ? item.inputs.status : item.detail;
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'succeeded') return { label: 'SUCCEEDED', className: 'succeeded' };
  if (normalized === 'failed') return { label: 'FAILED', className: 'failed' };
  if (normalized === 'skipped') return { label: 'SKIPPED', className: 'skipped' };
  if (normalized === 'running') return { label: 'RUNNING', className: 'running' };
  if (normalized === 'not run') return { label: 'NOT RUN', className: 'not-run' };
  return null;
}

function filterOutlineItems(items: FlowAnalysisOutlineItem[], query: string): FlowAnalysisOutlineItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.flatMap((item) => {
    const children = filterOutlineItems(item.children || [], query);
    if (outlineSearchText(item).includes(needle) || children.length) return [{ ...item, children }];
    return [];
  });
}

function countOutlineItems(items: FlowAnalysisOutlineItem[]): number {
  return items.reduce((count, item) => count + 1 + countOutlineItems(item.children || []), 0);
}

function outlineSearchText(item: FlowAnalysisOutlineItem) {
  return [
    item.kind,
    item.name,
    item.detail,
    item.type,
    item.connector,
    item.dependency,
    ...(item.runAfter || []),
    ...Object.entries(item.inputs || {}).flatMap(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function summarizeOutlineProblems(item: FlowAnalysisOutlineItem, problems: FlowProblem[]): OutlineProblemSummary {
  const summary: OutlineProblemSummary = { error: 0, warning: 0, info: 0 };
  for (const problem of problems) {
    if (!problemMatchesOutlineItem(problem, item)) continue;
    summary[problem.level] += 1;
  }
  return summary;
}

function problemMatchesOutlineItem(problem: FlowProblem, item: FlowAnalysisOutlineItem) {
  const from = item.from ?? -1;
  const to = item.to ?? -1;
  if (problem.from !== undefined && from <= problem.from && problem.from <= to) return true;
  if (problem.actionName && item.name && problem.actionName === item.name) return true;
  if (problem.path && item.name && pathMentionsName(problem.path, item.name)) return true;
  return false;
}

function pathMentionsName(path: string, name: string) {
  const normalizedName = name.toLowerCase();
  return path
    .split(/[.[\]'"]+/)
    .filter(Boolean)
    .some((part) => part.toLowerCase() === normalizedName);
}

function outlineProblemTitle(summary: OutlineProblemSummary) {
  const parts = [
    summary.error ? `${summary.error} error${summary.error === 1 ? '' : 's'}` : '',
    summary.warning ? `${summary.warning} warning${summary.warning === 1 ? '' : 's'}` : '',
    summary.info ? `${summary.info} info` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

function OutlineDetail(props: { item: FlowAnalysisOutlineItem; indent: number }) {
  const { item, indent } = props;
  const rows: [string, string][] = [];
  if (item.type) rows.push(['Type', item.type]);
  if (item.detail && item.detail !== item.type) rows.push(['Detail', item.detail]);
  if (item.connector) rows.push(['Connector', item.connector]);
  if (item.dependency) rows.push(['Dependency', item.dependency]);
  if (item.runAfter?.length) rows.push(['Run after', item.runAfter.join(', ')]);
  if (item.inputs) {
    for (const [key, value] of Object.entries(item.inputs)) {
      if (value === undefined || value === null) continue;
      const display = typeof value === 'string' ? value
        : typeof value === 'number' ? String(value)
        : JSON.stringify(value, null, 2);
      rows.push([INPUT_LABELS[key] || key, display]);
    }
  }
  if (!rows.length) return null;
  return (
    <div style={{
      paddingLeft: indent, paddingRight: 12, paddingTop: 4, paddingBottom: 6,
      fontSize: '11px', lineHeight: '18px',
      borderBottom: '1px solid var(--border)',
      background: 'color-mix(in srgb, var(--ink) 2%, transparent)',
    }}>
      {rows.map(([label, value]) => {
        const isBlock = value.includes('\n');
        return (
          <div key={label} style={{ display: isBlock ? 'block' : 'flex', gap: 8, marginBottom: isBlock ? 4 : 0 }}>
            <span style={{ color: 'var(--muted)', flexShrink: 0, minWidth: 80 }}>{label}</span>
            {isBlock
              ? <pre style={{ color: 'var(--ink)', margin: '2px 0 0', fontSize: '10px', lineHeight: '15px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{value}</pre>
              : <span style={{ color: 'var(--ink)', wordBreak: 'break-all' }}>{value}</span>
            }
          </div>
        );
      })}
    </div>
  );
}
