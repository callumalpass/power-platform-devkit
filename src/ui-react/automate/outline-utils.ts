import type { FlowAnalysisOutlineItem } from '../ui-types.js';

export const KIND_DOT: Record<string, string> = {
  trigger: '#3b82f6',
  action: '#22c55e',
  scope: '#eab308',
  condition: '#ef4444',
  foreach: '#8b5cf6',
  switch: '#f97316',
  branch: '#14b8a6',
  default: '#9ca3af',
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
  flowSystemMetadata: 'System metadata',
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
    typeof expression === 'string' ? shorten(expression, 80) : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function isActionLikeOutlineItem(item: FlowAnalysisOutlineItem) {
  return ['action', 'scope', 'condition', 'foreach', 'switch', 'trigger'].includes(String(item.kind || ''));
}
