import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export type FlowJsonValue = null | boolean | number | string | FlowJsonValue[] | { [key: string]: FlowJsonValue };

const NOISY_FLOW_KEYS = new Set([
  'createdTime',
  'lastModifiedTime',
  'changedTime',
  'lastModifiedBy',
  'creator',
  'owners',
]);

export function parseFlowPath(pathExpression: string): string[] {
  return pathExpression
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function resolveFlowOutputPath(path: string): string {
  const resolved = resolve(path);
  return resolved.endsWith('.json') ? resolved : resolve(resolved, 'flow.json');
}

export function stripNoisyFlowValue(value: FlowJsonValue): FlowJsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => stripNoisyFlowValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !NOISY_FLOW_KEYS.has(key))
        .map(([key, nested]) => [key, stripNoisyFlowValue(nested)])
    );
  }

  return value;
}

export function normalizeFlowJsonRecord(record: Record<string, unknown>): Record<string, FlowJsonValue> {
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, normalizeFlowJsonValue(nested)]));
}

export function normalizeFlowJsonValue(value: unknown): FlowJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFlowJsonValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeFlowJsonValue(nested)])
    );
  }

  return String(value);
}

export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asFlowJsonRecord(value: unknown): Record<string, FlowJsonValue> | undefined {
  return asRecord(value) as Record<string, FlowJsonValue> | undefined;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
