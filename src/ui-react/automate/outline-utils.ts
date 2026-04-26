import type { FlowAnalysisOutlineItem } from '../ui-types.js';

export const KIND_DOT: Record<string, string> = {
  trigger: '#3b82f6',
  action: '#22c55e',
  scope: '#eab308',
  condition: '#ef4444',
  foreach: '#8b5cf6',
  switch: '#f97316',
  branch: '#14b8a6',
  default: '#9ca3af'
};

export const INPUT_LABELS: Record<string, string> = {
  operationId: 'Operation',
  method: 'Method',
  uri: 'URI',
  path: 'Path',
  body: 'Body',
  queries: 'Query params',
  headers: 'Headers',
  variable: 'Variable',
  expression: 'Expression',
  foreach: 'Collection',
  description: 'Description',
  retryPolicy: 'Retry policy',
  concurrency: 'Concurrency',
  staticResult: 'Static result',
  operationOptions: 'Options',
  limitCount: 'Loop limit',
  limitTimeout: 'Loop timeout',
  operationMetadataId: 'Metadata ID',
  flowSystemMetadata: 'System metadata'
};

export function outlineKey(item: FlowAnalysisOutlineItem): string {
  return `${item.kind || 'item'}:${item.name || ''}:${item.from ?? ''}:${item.to ?? ''}`;
}

export function buildOutlinePathTo(items: FlowAnalysisOutlineItem[], targetKey: string): string[] {
  for (const item of items) {
    const key = outlineKey(item);
    if (key === targetKey) return [key];
    if (item.children?.length) {
      const sub = buildOutlinePathTo(item.children, targetKey);
      if (sub.length) return [key, ...sub];
    }
  }
  return [];
}

export function findOutlineKeyByName(items: FlowAnalysisOutlineItem[], name: string): string {
  for (const item of items) {
    if (item.name === name) return outlineKey(item);
    const childKey = findOutlineKeyByName(item.children || [], name);
    if (childKey) return childKey;
  }
  return '';
}

export function findOutlineAtOffset(items: FlowAnalysisOutlineItem[], offset: number): FlowAnalysisOutlineItem | null {
  for (const item of items) {
    if ((item.from ?? -1) <= offset && offset <= (item.to ?? -1)) {
      return findOutlineAtOffset(item.children || [], offset) || item;
    }
  }
  return null;
}

export function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function escapeMarkdown(value: string) {
  return value.replace(/[`\\]/g, '\\$&');
}

export function shorten(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

export function outlineTitle(item: FlowAnalysisOutlineItem) {
  if (item.kind === 'workflow') return 'Workflow';
  if (item.kind === 'parameter' && item.children?.length) return 'Parameters';
  if (item.kind === 'trigger' && item.children?.length && item.name === 'triggers') return 'Triggers';
  if (item.kind === 'action' && item.children?.length && item.name === 'actions') return 'Actions';
  if (item.kind === 'variable' && item.children?.length) return 'Variables';
  return item.name || 'Unnamed';
}

export function outlineMeta(item: FlowAnalysisOutlineItem) {
  const operation = item.inputs?.operationId;
  const expression = item.inputs?.expression;
  const parts = [
    item.type || (item.detail && !item.children?.length ? item.detail : undefined),
    item.connector,
    typeof operation === 'string' ? operation : undefined,
    typeof expression === 'string' ? shorten(expression, 80) : undefined
  ].filter(Boolean);
  return parts.join(' · ');
}

export function isActionLikeOutlineItem(item: FlowAnalysisOutlineItem) {
  return ['action', 'scope', 'condition', 'foreach', 'switch', 'trigger'].includes(String(item.kind || ''));
}

/** Kinds that host a single nested `actions` map directly (no branch ambiguity). */
export function isSingleBodyContainer(item: FlowAnalysisOutlineItem) {
  const kind = String(item.kind || '').toLowerCase();
  return kind === 'scope' || kind === 'foreach' || kind === 'until';
}

/** Branch / case / default child of a Condition or Switch. */
export function isBranchOutlineItem(item: FlowAnalysisOutlineItem) {
  const kind = String(item.kind || '').toLowerCase();
  return kind === 'branch' || kind === 'case' || kind === 'default';
}

/** Outline items that own child actions and therefore can have "Add action inside" offered. */
export function canHoldChildActions(item: FlowAnalysisOutlineItem) {
  return isSingleBodyContainer(item) || isBranchOutlineItem(item);
}

export type OutlineContainerTarget = {
  parentName: string;
  branchPath: string[];
  label: string;
  /** Action names currently inside the container — used to populate the "Run after" dropdown. */
  siblings: string[];
};

function extractContainerSiblings(item: FlowAnalysisOutlineItem): string[] {
  const children = item.children || [];
  // For container actions (Scope/Foreach/Until) the outline nests an 'actions' wrapper first;
  // for branches/cases the children are the actions directly. Accept either shape.
  const wrapper = children.find((entry) => entry.kind === 'action' && entry.name === 'actions' && (entry.children || []).length);
  const actionish = (wrapper?.children || children).filter((entry) => isActionLikeOutlineItem(entry) && entry.name);
  return actionish.map((entry) => entry.name!).filter(Boolean);
}

/**
 * Given an outline item the user wants to add actions INSIDE, build the structural reference
 * pointing at the underlying `actions` map. Walks ancestors when needed (branch nodes need the
 * enclosing Condition/Switch name). Returns null when the item isn't a container.
 */
export function outlineContainerTarget(item: FlowAnalysisOutlineItem, ancestors: FlowAnalysisOutlineItem[]): OutlineContainerTarget | null {
  const kind = String(item.kind || '').toLowerCase();
  const name = item.name || '';
  const siblings = extractContainerSiblings(item);
  if (isSingleBodyContainer(item)) {
    if (!name) return null;
    return { parentName: name, branchPath: ['actions'], label: `${name} body`, siblings };
  }
  if (isBranchOutlineItem(item)) {
    const parent = [...ancestors].reverse().find((entry) => {
      const parentKind = String(entry.kind || '').toLowerCase();
      return parentKind === 'condition' || parentKind === 'switch';
    });
    if (!parent?.name) return null;
    const parentKind = String(parent.kind || '').toLowerCase();
    if (parentKind === 'condition') {
      const siblingBranches = (parent.children || []).filter(isBranchOutlineItem);
      const index = siblingBranches.indexOf(item);
      if (index === 0) return { parentName: parent.name, branchPath: ['actions'], label: `${parent.name} → then`, siblings };
      return { parentName: parent.name, branchPath: ['else', 'actions'], label: `${parent.name} → else`, siblings };
    }
    if (parentKind === 'switch') {
      if (kind === 'default' || name.toLowerCase() === 'default') {
        return { parentName: parent.name, branchPath: ['default', 'actions'], label: `${parent.name} → default`, siblings };
      }
      const caseName = name.replace(/^case:\s*/i, '').trim() || name;
      return { parentName: parent.name, branchPath: ['cases', caseName, 'actions'], label: `${parent.name} → case "${caseName}"`, siblings };
    }
  }
  return null;
}

/**
 * Convenience for resolving a container starting from the outline root. Walks the whole tree
 * looking for `target` by reference equality and threads ancestors through.
 */
export function findOutlineContainerTarget(outline: FlowAnalysisOutlineItem[], target: FlowAnalysisOutlineItem, ancestors: FlowAnalysisOutlineItem[] = []): OutlineContainerTarget | null {
  for (const item of outline) {
    if (item === target) return outlineContainerTarget(item, ancestors);
    if (item.children?.length) {
      const found = findOutlineContainerTarget(item.children, target, [...ancestors, item]);
      if (found) return found;
    }
  }
  return null;
}
