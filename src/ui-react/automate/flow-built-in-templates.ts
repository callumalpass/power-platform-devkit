import type { FlowApiOperation } from '../ui-types.js';

/**
 * JSON shapes for the Microsoft Power Automate built-in actions. Microsoft's own designer
 * hardcodes these because the corresponding operationGroups (Control, DataOperation,
 * Variable, Http, Request, Schedule, Datetime, NumberFunctions, TextFunctions, FlowsBuiltIn,
 * PowerApps, PowerPages, VirtualAgent, Skills) don't expose a swagger via /apis/{group}.
 *
 * Keyed primarily by operation name (distinguishes TableCsv vs TableHtml, Delay vs DelayUntil).
 * BUILT_IN_BY_TYPE is a fallback by operationType for anything we haven't enumerated.
 */
const BUILT_IN_BY_NAME: Record<string, () => Record<string, unknown>> = {
  // Control flow
  Condition: () => ({ type: 'If', expression: { equals: ['', ''] }, actions: {}, else: { actions: {} } }),
  Foreach: () => ({ type: 'Foreach', foreach: "@triggerBody()?['value']", actions: {} }),
  Switch: () => ({ type: 'Switch', expression: '', cases: {}, default: { actions: {} } }),
  Until: () => ({ type: 'Until', expression: '@false', limit: { count: 60, timeout: 'PT1H' }, actions: {} }),
  Scope: () => ({ type: 'Scope', actions: {} }),
  Terminate: () => ({ type: 'Terminate', inputs: { runStatus: 'Cancelled' } }),

  // Data operations
  Compose: () => ({ type: 'Compose', inputs: '' }),
  ParseJson: () => ({ type: 'ParseJson', inputs: { content: '', schema: {} } }),
  Query: () => ({ type: 'Query', inputs: { from: '', where: '@true' } }),
  Select: () => ({ type: 'Select', inputs: { from: '', select: {} } }),
  Join: () => ({ type: 'Join', inputs: { from: '', joinWith: ',' } }),
  TableCsv: () => ({ type: 'Table', inputs: { from: '', format: 'CSV' } }),
  TableHtml: () => ({ type: 'Table', inputs: { from: '', format: 'HTML' } }),

  // Variables
  InitializeVariable: () => ({ type: 'InitializeVariable', inputs: { variables: [{ name: '', type: 'string', value: '' }] } }),
  SetVariable: () => ({ type: 'SetVariable', inputs: { name: '', value: '' } }),
  IncrementVariable: () => ({ type: 'IncrementVariable', inputs: { name: '', value: 1 } }),
  DecrementVariable: () => ({ type: 'DecrementVariable', inputs: { name: '', value: 1 } }),
  AppendToArrayVariable: () => ({ type: 'AppendToArrayVariable', inputs: { name: '', value: '' } }),
  AppendToStringVariable: () => ({ type: 'AppendToStringVariable', inputs: { name: '', value: '' } }),

  // HTTP
  Http: () => ({ type: 'Http', inputs: { method: 'GET', uri: '' } }),
  HttpSwagger: () => ({ type: 'HttpSwagger', inputs: { method: 'GET', uri: '', operationId: '' } }),
  HttpWebhook: () => ({ type: 'HttpWebhook', inputs: { subscribe: { method: 'GET', uri: '' }, unsubscribe: { method: 'GET', uri: '' } } }),

  // Response variants share operationType='Response' but differ by kind.
  Response: () => ({ type: 'Response', kind: 'http', inputs: { statusCode: 200 } }),
  PowerAppsResponse: () => ({ type: 'Response', kind: 'PowerApp', inputs: {} }),
  PowerPagesResponse: () => ({ type: 'Response', kind: 'PowerPages', inputs: {} }),
  VirtualAgentResponse: () => ({ type: 'Response', kind: 'VirtualAgent', inputs: {} }),
  SkillsResponse: () => ({ type: 'Response', kind: 'Skills', inputs: {} }),

  // Schedule
  Delay: () => ({ type: 'Wait', inputs: { interval: { count: 1, unit: 'Minute' } } }),
  DelayUntil: () => ({ type: 'Wait', inputs: { until: { timestamp: '' } } }),

  // Child flow
  RunChildFlow: () => ({ type: 'Workflow', inputs: { host: { workflowReferenceName: '' }, body: {} } }),

  // Datetime / number / text expressions — these surface as Compose actions with a prefilled
  // expression matching what the Microsoft designer emits.
  AddToTime: () => ({ type: 'Compose', inputs: "@addToTime('', 1, 'Hour')" }),
  ConvertTimeZone: () => ({ type: 'Compose', inputs: "@convertTimeZone('', 'UTC', 'Pacific Standard Time')" }),
  CurrentTime: () => ({ type: 'Compose', inputs: '@utcNow()' }),
  GetFutureTime: () => ({ type: 'Compose', inputs: "@getFutureTime(1, 'Hour')" }),
  GetPastTime: () => ({ type: 'Compose', inputs: "@getPastTime(1, 'Hour')" }),
  SubtractFromTime: () => ({ type: 'Compose', inputs: "@subtractFromTime('', 1, 'Hour')" }),
  FormatNumber: () => ({ type: 'Compose', inputs: "@formatNumber(0, '0.00')" }),
  IndexOf: () => ({ type: 'Compose', inputs: "@indexOf('', '')" }),
  Substring: () => ({ type: 'Compose', inputs: "@substring('', 0, 1)" }),
};

const BUILT_IN_BY_TYPE: Record<string, () => Record<string, unknown>> = {
  If: BUILT_IN_BY_NAME.Condition,
  Foreach: BUILT_IN_BY_NAME.Foreach,
  Switch: BUILT_IN_BY_NAME.Switch,
  Until: BUILT_IN_BY_NAME.Until,
  Scope: BUILT_IN_BY_NAME.Scope,
  Terminate: BUILT_IN_BY_NAME.Terminate,
  Compose: BUILT_IN_BY_NAME.Compose,
  ParseJson: BUILT_IN_BY_NAME.ParseJson,
  Query: BUILT_IN_BY_NAME.Query,
  Select: BUILT_IN_BY_NAME.Select,
  Join: BUILT_IN_BY_NAME.Join,
  Table: BUILT_IN_BY_NAME.TableCsv,
  Http: BUILT_IN_BY_NAME.Http,
  HttpSwagger: BUILT_IN_BY_NAME.HttpSwagger,
  HttpWebhook: BUILT_IN_BY_NAME.HttpWebhook,
  Response: BUILT_IN_BY_NAME.Response,
  Wait: BUILT_IN_BY_NAME.Delay,
  Workflow: BUILT_IN_BY_NAME.RunChildFlow,
  InitializeVariable: BUILT_IN_BY_NAME.InitializeVariable,
  SetVariable: BUILT_IN_BY_NAME.SetVariable,
  IncrementVariable: BUILT_IN_BY_NAME.IncrementVariable,
  DecrementVariable: BUILT_IN_BY_NAME.DecrementVariable,
  AppendToArrayVariable: BUILT_IN_BY_NAME.AppendToArrayVariable,
  AppendToStringVariable: BUILT_IN_BY_NAME.AppendToStringVariable,
};

/**
 * Build a default WDL JSON payload for a built-in action. Returns null if the operation does
 * not appear to be a built-in. Unknown built-ins get a bare stub ({ type: operationType,
 * inputs: {} }) so the user can still insert and then customize in the JSON editor.
 */
export function buildBuiltInAction(operation: FlowApiOperation): Record<string, unknown> | null {
  if (!operation.isBuiltIn) return null;
  const byName = operation.name ? BUILT_IN_BY_NAME[operation.name] : undefined;
  if (byName) return byName();
  const byType = operation.operationType ? BUILT_IN_BY_TYPE[operation.operationType] : undefined;
  if (byType) return byType();
  if (operation.operationType) return { type: operation.operationType, inputs: {} };
  return null;
}

/** True when the operation is a built-in whose shape we have a hardcoded template for. */
export function hasKnownBuiltInTemplate(operation: FlowApiOperation): boolean {
  if (!operation.isBuiltIn) return false;
  if (operation.name && BUILT_IN_BY_NAME[operation.name]) return true;
  if (operation.operationType && BUILT_IN_BY_TYPE[operation.operationType]) return true;
  return false;
}
