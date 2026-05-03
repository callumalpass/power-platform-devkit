import { ApiRequestError, prop } from '../utils.js';

export type FlowValidationKind = 'errors' | 'warnings';

export type FlowValidationItem = {
  level: 'error' | 'warning' | 'info';
  code?: string;
  message: string;
  path?: string;
  actionName?: string;
  operationMetadataId?: string;
  from?: number;
  to?: number;
  raw: unknown;
};

export type FlowValidationResult = {
  kind: FlowValidationKind;
  items: FlowValidationItem[];
  raw: unknown;
  checkedAt: string;
};

export function flowValidationFromError(kind: FlowValidationKind, error: unknown): FlowValidationResult {
  if (error instanceof ApiRequestError) {
    const result = normalizeFlowValidationResult(kind, error.data);
    if (result.items.length) return result;
    return {
      ...result,
      items: [
        {
          level: 'error',
          code: `HTTP_${error.status}`,
          message: error.message,
          raw: error.data
        }
      ]
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return normalizeFlowValidationResult(kind, {
    error: error instanceof Error ? { code: error.name, message } : { message }
  });
}

export function normalizeFlowValidationResult(kind: FlowValidationKind, raw: unknown): FlowValidationResult {
  return {
    kind,
    items: collectValidationItems(kind, raw).slice(0, 100),
    raw,
    checkedAt: new Date().toISOString()
  };
}

function collectValidationItems(kind: FlowValidationKind, raw: unknown): FlowValidationItem[] {
  const items: FlowValidationItem[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (value == null || seen.has(value)) return;
    if (typeof value !== 'object') return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    const detail = parseServiceErrorDetail(record.detail);
    const fixInstructions = isRecord(record.fixInstructions) ? record.fixInstructions : {};
    const message =
      detail?.message ||
      firstString(record.errorDescription, record.message, record.errorMessage, record.localizedMessage, record.description, record.title, fixInstructions.markdownText, fixInstructions.textTemplate);
    const code = firstString(record.code, record.ruleId, record.errorCode, record.name);
    if (message) {
      const item: FlowValidationItem = {
        level: kind === 'errors' ? 'error' : 'warning',
        message,
        raw: record
      };
      const itemCode = detail?.code || code;
      const path = detail?.path || firstString(record.path, record.jsonPath, record.location, record.target);
      const actionName = firstString(record.actionName, record.operationName, record.nodeName, record.target);
      const operationMetadataId = firstString(record.operationMetadataId, record.anchor, record.nodeId);
      if (itemCode) item.code = itemCode;
      if (path) item.path = path;
      if (actionName) item.actionName = actionName;
      if (operationMetadataId) item.operationMetadataId = operationMetadataId;
      items.push(item);
    }

    for (const key of ['diagnostics', 'errors', 'warnings', 'value', 'details', 'innerErrors', 'issues'] as const) {
      if (record[key] !== undefined) visit(record[key]);
    }
  };
  visit(raw);
  return items;
}

function parseServiceErrorDetail(value: unknown): { code?: string; message?: string; path?: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    const path = extractQuotedPath(value);
    return path ? { message: value, path } : { message: value };
  }
  const error = prop(parsed, 'error') || parsed;
  const message = firstString(prop(error, 'message'), prop(error, 'ExceptionMessage'), prop(parsed, 'message'));
  const extendedMessage = firstString(prop(error, 'extendedData.message'), prop(parsed, 'extendedData.message'));
  const detailCode = extractDetailsCode(message) || extractDetailsCode(extendedMessage);
  const detail: { code?: string; message?: string; path?: string } = {};
  const code = firstString(detailCode, prop(error, 'code'), prop(error, 'ErrorCode'), prop(error, 'extendedData.code'), prop(parsed, 'code'));
  const parsedMessage = firstString(message, extendedMessage);
  const path = message ? extractQuotedPath(message) : undefined;
  if (code) detail.code = code;
  if (parsedMessage) detail.message = parsedMessage;
  if (path) detail.path = path;
  return detail;
}

function extractQuotedPath(value: string) {
  const match = value.match(/Path '([^']+)'/);
  return match?.[1];
}

function extractDetailsCode(value: string | undefined) {
  const match = value?.match(/details\s+["']([^"']+)["']/i);
  return match?.[1];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
