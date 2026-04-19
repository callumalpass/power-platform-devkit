import type { FlowApiOperation } from '../ui-types.js';

export type BuiltInActionCategory = 'control' | 'data' | 'variable' | 'http' | 'schedule' | 'response' | 'flow' | 'expression';

export type BuiltInActionField = {
  label: string;
  path: string[];
  kind?: 'text' | 'json' | 'select';
  options?: string[];
};

export type BuiltInActionTemplate = {
  key: string;
  category: BuiltInActionCategory;
  label: string;
  desc: string;
  name: string;
  operationName?: string;
  operationType?: string;
  action: () => Record<string, unknown>;
};

export const BUILT_IN_CATEGORIES: Array<{ key: BuiltInActionCategory; label: string; hint: string }> = [
  { key: 'control', label: 'Control flow', hint: 'Branch and loop without a connector' },
  { key: 'data', label: 'Data operations', hint: 'Shape arrays, objects, and JSON' },
  { key: 'variable', label: 'Variables', hint: 'Read and update flow state' },
  { key: 'http', label: 'HTTP', hint: 'Call or subscribe to REST endpoints' },
  { key: 'schedule', label: 'Schedule', hint: 'Wait before continuing' },
  { key: 'response', label: 'Responses', hint: 'Return data to the caller' },
  { key: 'flow', label: 'Flows', hint: 'Run another cloud flow' },
  { key: 'expression', label: 'Expression helpers', hint: 'Insert common expression actions' },
];

/**
 * JSON shapes for the Microsoft Power Automate built-in actions. Microsoft's own designer
 * hardcodes these because the corresponding operationGroups (Control, DataOperation,
 * Variable, Http, Request, Schedule, Datetime, NumberFunctions, TextFunctions, FlowsBuiltIn,
 * PowerApps, PowerPages, VirtualAgent, Skills) don't expose a swagger via /apis/{group}.
 *
 * Keyed primarily by operation name (distinguishes TableCsv vs TableHtml, Delay vs DelayUntil).
 * BUILT_IN_BY_TYPE is a fallback by operationType for anything we haven't enumerated.
 */
export const BUILT_IN_ACTION_TEMPLATES: BuiltInActionTemplate[] = [
  // Control flow
  { key: 'condition', category: 'control', label: 'Condition', desc: 'Branch with if / else', name: 'Condition', operationName: 'Condition', operationType: 'Condition', action: () => ({ type: 'If', expression: { equals: ['', ''] }, actions: {}, else: { actions: {} } }) },
  { key: 'apply-to-each', category: 'control', label: 'Apply to each', desc: 'Loop over items in an array', name: 'Apply_to_each', operationName: 'Foreach', operationType: 'Foreach', action: () => ({ type: 'Foreach', foreach: "@triggerBody()?['value']", actions: {} }) },
  { key: 'switch', category: 'control', label: 'Switch', desc: 'Branch on multiple values', name: 'Switch', operationName: 'Switch', operationType: 'Switch', action: () => ({ type: 'Switch', expression: '', cases: {}, default: { actions: {} } }) },
  { key: 'do-until', category: 'control', label: 'Do until', desc: 'Loop until a condition is true', name: 'Do_until', operationName: 'Until', operationType: 'Until', action: () => ({ type: 'Until', expression: '@false', limit: { count: 60, timeout: 'PT1H' }, actions: {} }) },
  { key: 'scope', category: 'control', label: 'Scope', desc: 'Group related actions', name: 'Scope', operationName: 'Scope', operationType: 'Scope', action: () => ({ type: 'Scope', actions: {} }) },
  { key: 'terminate', category: 'control', label: 'Terminate', desc: 'Stop the run with a status', name: 'Terminate', operationName: 'Terminate', operationType: 'Terminate', action: () => ({ type: 'Terminate', inputs: { runStatus: 'Cancelled' } }) },

  // Data operations
  { key: 'compose', category: 'data', label: 'Compose', desc: 'Transform or pass through a value', name: 'Compose', operationName: 'Compose', operationType: 'Compose', action: () => ({ type: 'Compose', inputs: '' }) },
  { key: 'parse-json', category: 'data', label: 'Parse JSON', desc: 'Validate and extract fields from a JSON string', name: 'Parse_JSON', operationName: 'ParseJson', operationType: 'ParseJson', action: () => ({ type: 'ParseJson', inputs: { content: '', schema: {} } }) },
  { key: 'filter-array', category: 'data', label: 'Filter array', desc: 'Keep array items matching a condition', name: 'Filter_array', operationName: 'Query', operationType: 'Query', action: () => ({ type: 'Query', inputs: { from: '', where: '@true' } }) },
  { key: 'select', category: 'data', label: 'Select', desc: 'Map each item to a new shape', name: 'Select', operationName: 'Select', operationType: 'Select', action: () => ({ type: 'Select', inputs: { from: '', select: {} } }) },
  { key: 'join', category: 'data', label: 'Join', desc: 'Join array values into text', name: 'Join', operationName: 'Join', operationType: 'Join', action: () => ({ type: 'Join', inputs: { from: '', joinWith: ',' } }) },
  { key: 'csv-table', category: 'data', label: 'Create CSV table', desc: 'Turn an array into CSV text', name: 'Create_CSV_table', operationName: 'TableCsv', operationType: 'Table', action: () => ({ type: 'Table', inputs: { from: '', format: 'CSV' } }) },
  { key: 'html-table', category: 'data', label: 'Create HTML table', desc: 'Turn an array into an HTML table', name: 'Create_HTML_table', operationName: 'TableHtml', operationType: 'Table', action: () => ({ type: 'Table', inputs: { from: '', format: 'HTML' } }) },

  // Variables
  { key: 'init-variable', category: 'variable', label: 'Initialize variable', desc: 'Declare a named variable', name: 'Initialize_variable', operationName: 'InitializeVariable', operationType: 'InitializeVariable', action: () => ({ type: 'InitializeVariable', inputs: { variables: [{ name: '', type: 'string', value: '' }] } }) },
  { key: 'set-variable', category: 'variable', label: 'Set variable', desc: 'Update a variable value', name: 'Set_variable', operationName: 'SetVariable', operationType: 'SetVariable', action: () => ({ type: 'SetVariable', inputs: { name: '', value: '' } }) },
  { key: 'increment-variable', category: 'variable', label: 'Increment variable', desc: 'Add to a numeric variable', name: 'Increment_variable', operationName: 'IncrementVariable', operationType: 'IncrementVariable', action: () => ({ type: 'IncrementVariable', inputs: { name: '', value: 1 } }) },
  { key: 'decrement-variable', category: 'variable', label: 'Decrement variable', desc: 'Subtract from a numeric variable', name: 'Decrement_variable', operationName: 'DecrementVariable', operationType: 'DecrementVariable', action: () => ({ type: 'DecrementVariable', inputs: { name: '', value: 1 } }) },
  { key: 'append-array-variable', category: 'variable', label: 'Append to array variable', desc: 'Add one item to an array variable', name: 'Append_to_array_variable', operationName: 'AppendToArrayVariable', operationType: 'AppendToArrayVariable', action: () => ({ type: 'AppendToArrayVariable', inputs: { name: '', value: '' } }) },
  { key: 'append-string-variable', category: 'variable', label: 'Append to string variable', desc: 'Add text to a string variable', name: 'Append_to_string_variable', operationName: 'AppendToStringVariable', operationType: 'AppendToStringVariable', action: () => ({ type: 'AppendToStringVariable', inputs: { name: '', value: '' } }) },

  // HTTP
  { key: 'http', category: 'http', label: 'HTTP', desc: 'Call any REST endpoint', name: 'HTTP', operationName: 'Http', operationType: 'Http', action: () => ({ type: 'Http', inputs: { method: 'GET', uri: '' } }) },
  { key: 'http-swagger', category: 'http', label: 'HTTP + Swagger', desc: 'Call a Swagger operation', name: 'HTTP_Swagger', operationName: 'HttpSwagger', operationType: 'HttpSwagger', action: () => ({ type: 'HttpSwagger', inputs: { method: 'GET', uri: '', operationId: '' } }) },
  { key: 'http-webhook', category: 'http', label: 'HTTP Webhook', desc: 'Subscribe and unsubscribe with HTTP', name: 'HTTP_Webhook', operationName: 'HttpWebhook', operationType: 'HttpWebhook', action: () => ({ type: 'HttpWebhook', inputs: { subscribe: { method: 'GET', uri: '' }, unsubscribe: { method: 'GET', uri: '' } } }) },

  // Response variants share operationType='Response' but differ by kind.
  { key: 'response', category: 'response', label: 'Response', desc: 'Return an HTTP response to the caller', name: 'Response', operationName: 'Response', operationType: 'Response', action: () => ({ type: 'Response', kind: 'http', inputs: { statusCode: 200 } }) },
  { key: 'powerapps-response', category: 'response', label: 'Power Apps response', desc: 'Return values to Power Apps or another flow', name: 'Respond_to_a_Power_App_or_flow', operationName: 'PowerAppsResponse', operationType: 'Response', action: () => ({ type: 'Response', kind: 'PowerApp', inputs: {} }) },
  { key: 'powerpages-response', category: 'response', label: 'Power Pages response', desc: 'Return values to Power Pages', name: 'Return_values_to_Power_Pages', operationName: 'PowerPagesResponse', operationType: 'Response', action: () => ({ type: 'Response', kind: 'PowerPages', inputs: {} }) },
  { key: 'virtual-agent-response', category: 'response', label: 'Virtual Agent response', desc: 'Return values to Power Virtual Agents', name: 'Return_values_to_Power_Virtual_Agents', operationName: 'VirtualAgentResponse', operationType: 'Response', action: () => ({ type: 'Response', kind: 'VirtualAgent', inputs: {} }) },
  { key: 'skills-response', category: 'response', label: 'Skills response', desc: 'Return values to the agent', name: 'Respond_to_the_agent', operationName: 'SkillsResponse', operationType: 'Response', action: () => ({ type: 'Response', kind: 'Skills', inputs: {} }) },

  // Schedule
  { key: 'delay', category: 'schedule', label: 'Delay', desc: 'Wait for a duration', name: 'Delay', operationName: 'Delay', operationType: 'Wait', action: () => ({ type: 'Wait', inputs: { interval: { count: 1, unit: 'Minute' } } }) },
  { key: 'delay-until', category: 'schedule', label: 'Delay until', desc: 'Wait until a timestamp', name: 'Delay_until', operationName: 'DelayUntil', operationType: 'Wait', action: () => ({ type: 'Wait', inputs: { until: { timestamp: '' } } }) },

  // Child flow
  { key: 'run-child-flow', category: 'flow', label: 'Run child flow', desc: 'Call another flow in the solution', name: 'Run_child_flow', operationName: 'RunChildFlow', operationType: 'Workflow', action: () => ({ type: 'Workflow', inputs: { host: { workflowReferenceName: '' }, body: {} } }) },

  // Datetime / number / text expressions — these surface as Compose actions with a prefilled
  // expression matching what the Microsoft designer emits.
  { key: 'add-to-time', category: 'expression', label: 'Add to time', desc: 'Add a duration to a timestamp', name: 'Add_to_time', operationName: 'AddToTime', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: "@addToTime('', 1, 'Hour')" }) },
  { key: 'convert-time-zone', category: 'expression', label: 'Convert time zone', desc: 'Convert a timestamp between time zones', name: 'Convert_time_zone', operationName: 'ConvertTimeZone', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: "@convertTimeZone('', 'UTC', 'Pacific Standard Time')" }) },
  { key: 'current-time', category: 'expression', label: 'Current time', desc: 'Use the current UTC timestamp', name: 'Current_time', operationName: 'CurrentTime', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: '@utcNow()' }) },
  { key: 'future-time', category: 'expression', label: 'Future time', desc: 'Calculate a future timestamp', name: 'Get_future_time', operationName: 'GetFutureTime', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: "@getFutureTime(1, 'Hour')" }) },
  { key: 'past-time', category: 'expression', label: 'Past time', desc: 'Calculate a past timestamp', name: 'Get_past_time', operationName: 'GetPastTime', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: "@getPastTime(1, 'Hour')" }) },
  { key: 'subtract-from-time', category: 'expression', label: 'Subtract from time', desc: 'Subtract a duration from a timestamp', name: 'Subtract_from_time', operationName: 'SubtractFromTime', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: "@subtractFromTime('', 1, 'Hour')" }) },
  { key: 'format-number', category: 'expression', label: 'Format number', desc: 'Format a number as text', name: 'Format_number', operationName: 'FormatNumber', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: "@formatNumber(0, '0.00')" }) },
  { key: 'index-of', category: 'expression', label: 'Find text position', desc: 'Find text inside text', name: 'Find_text_position', operationName: 'IndexOf', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: "@indexOf('', '')" }) },
  { key: 'substring', category: 'expression', label: 'Substring', desc: 'Extract part of text', name: 'Substring', operationName: 'Substring', operationType: 'Expression', action: () => ({ type: 'Compose', inputs: "@substring('', 0, 1)" }) },
];

const BUILT_IN_BY_NAME = Object.fromEntries(
  BUILT_IN_ACTION_TEMPLATES
    .filter((template) => template.operationName)
    .map((template) => [template.operationName, template.action]),
) as Record<string, () => Record<string, unknown>>;

const BUILT_IN_BY_TYPE: Record<string, () => Record<string, unknown>> = {
  If: BUILT_IN_BY_NAME.Condition!,
  Foreach: BUILT_IN_BY_NAME.Foreach!,
  Switch: BUILT_IN_BY_NAME.Switch!,
  Until: BUILT_IN_BY_NAME.Until!,
  Scope: BUILT_IN_BY_NAME.Scope!,
  Terminate: BUILT_IN_BY_NAME.Terminate!,
  Compose: BUILT_IN_BY_NAME.Compose!,
  ParseJson: BUILT_IN_BY_NAME.ParseJson!,
  Query: BUILT_IN_BY_NAME.Query!,
  Select: BUILT_IN_BY_NAME.Select!,
  Join: BUILT_IN_BY_NAME.Join!,
  Table: BUILT_IN_BY_NAME.TableCsv!,
  Http: BUILT_IN_BY_NAME.Http!,
  HttpSwagger: BUILT_IN_BY_NAME.HttpSwagger!,
  HttpWebhook: BUILT_IN_BY_NAME.HttpWebhook!,
  Response: BUILT_IN_BY_NAME.Response!,
  Wait: BUILT_IN_BY_NAME.Delay!,
  Workflow: BUILT_IN_BY_NAME.RunChildFlow!,
  InitializeVariable: BUILT_IN_BY_NAME.InitializeVariable!,
  SetVariable: BUILT_IN_BY_NAME.SetVariable!,
  IncrementVariable: BUILT_IN_BY_NAME.IncrementVariable!,
  DecrementVariable: BUILT_IN_BY_NAME.DecrementVariable!,
  AppendToArrayVariable: BUILT_IN_BY_NAME.AppendToArrayVariable!,
  AppendToStringVariable: BUILT_IN_BY_NAME.AppendToStringVariable!,
  Expression: BUILT_IN_BY_NAME.Compose!,
};

export const WDL_ACTION_TYPES = [
  'ApiConnection',
  'AppendToArrayVariable',
  'AppendToStringVariable',
  'Compose',
  'DecrementVariable',
  'Foreach',
  'Http',
  'HttpSwagger',
  'HttpWebhook',
  'If',
  'IncrementVariable',
  'InitializeVariable',
  'Join',
  'OpenApiConnection',
  'ParseJson',
  'Query',
  'Response',
  'Scope',
  'Select',
  'ServiceProvider',
  'SetVariable',
  'Switch',
  'Table',
  'Terminate',
  'Until',
  'Wait',
  'Workflow',
] as const;

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

export function builtInFieldsForAction(action: Record<string, unknown>): BuiltInActionField[] {
  const type = String(action.type || '').toLowerCase();
  if (type === 'http') return httpFields();
  if (type === 'httpswagger') return httpSwaggerFields();
  if (type === 'httpwebhook') return httpWebhookFields();
  if (type === 'compose') return [{ label: 'Inputs', path: ['inputs'], kind: 'json' }];
  if (type === 'parsejson') return parseJsonFields();
  if (type === 'query') return queryFields();
  if (type === 'select') return selectFields();
  if (type === 'join') return joinFields();
  if (type === 'table') return tableFields();
  if (type === 'scope') return [{ label: 'Actions', path: ['actions'], kind: 'json' }];
  if (type === 'if' || type === 'condition') return conditionFields();
  if (type === 'foreach') return foreachFields();
  if (type === 'until') return untilFields();
  if (type === 'switch') return switchFields();
  if (type === 'response') return responseFields();
  if (type === 'request') return [{ label: 'Inputs', path: ['inputs'], kind: 'json' }];
  if (type === 'wait') return waitFields(action);
  if (type === 'terminate') return terminateFields();
  if (type === 'workflow') return workflowFields();
  if (type === 'initializevariable') return [{ label: 'Variables', path: ['inputs', 'variables'], kind: 'json' }];
  if (type === 'setvariable' || type === 'incrementvariable' || type === 'decrementvariable' || type === 'appendtoarrayvariable' || type === 'appendtostringvariable') {
    return variableMutationFields(type);
  }
  return [];
}

function httpFields(): BuiltInActionField[] {
  return [
    { label: 'Method', path: ['inputs', 'method'], kind: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    { label: 'URI', path: ['inputs', 'uri'] },
    { label: 'Headers', path: ['inputs', 'headers'], kind: 'json' },
    { label: 'Queries', path: ['inputs', 'queries'], kind: 'json' },
    { label: 'Body', path: ['inputs', 'body'], kind: 'json' },
    { label: 'Authentication', path: ['inputs', 'authentication'], kind: 'json' },
  ];
}

function httpSwaggerFields(): BuiltInActionField[] {
  return [
    { label: 'Method', path: ['inputs', 'method'], kind: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    { label: 'URI', path: ['inputs', 'uri'] },
    { label: 'Operation ID', path: ['inputs', 'operationId'] },
    { label: 'Headers', path: ['inputs', 'headers'], kind: 'json' },
    { label: 'Body', path: ['inputs', 'body'], kind: 'json' },
  ];
}

function httpWebhookFields(): BuiltInActionField[] {
  return [
    { label: 'Subscribe method', path: ['inputs', 'subscribe', 'method'], kind: 'select', options: ['GET', 'POST', 'PUT', 'PATCH'] },
    { label: 'Subscribe URI', path: ['inputs', 'subscribe', 'uri'] },
    { label: 'Subscribe headers', path: ['inputs', 'subscribe', 'headers'], kind: 'json' },
    { label: 'Subscribe body', path: ['inputs', 'subscribe', 'body'], kind: 'json' },
    { label: 'Unsubscribe method', path: ['inputs', 'unsubscribe', 'method'], kind: 'select', options: ['GET', 'POST', 'DELETE'] },
    { label: 'Unsubscribe URI', path: ['inputs', 'unsubscribe', 'uri'] },
  ];
}

function parseJsonFields(): BuiltInActionField[] {
  return [
    { label: 'Content', path: ['inputs', 'content'], kind: 'json' },
    { label: 'Schema', path: ['inputs', 'schema'], kind: 'json' },
  ];
}

function queryFields(): BuiltInActionField[] {
  return [
    { label: 'From', path: ['inputs', 'from'], kind: 'json' },
    { label: 'Where', path: ['inputs', 'where'], kind: 'json' },
  ];
}

function selectFields(): BuiltInActionField[] {
  return [
    { label: 'From', path: ['inputs', 'from'], kind: 'json' },
    { label: 'Map', path: ['inputs', 'select'], kind: 'json' },
  ];
}

function joinFields(): BuiltInActionField[] {
  return [
    { label: 'From', path: ['inputs', 'from'], kind: 'json' },
    { label: 'Join with', path: ['inputs', 'joinWith'] },
  ];
}

function tableFields(): BuiltInActionField[] {
  return [
    { label: 'From', path: ['inputs', 'from'], kind: 'json' },
    { label: 'Format', path: ['inputs', 'format'], kind: 'select', options: ['CSV', 'HTML'] },
    { label: 'Columns', path: ['inputs', 'columns'], kind: 'json' },
  ];
}

function conditionFields(): BuiltInActionField[] {
  return [
    { label: 'Expression', path: ['expression'], kind: 'json' },
    { label: 'True actions', path: ['actions'], kind: 'json' },
    { label: 'False branch', path: ['else'], kind: 'json' },
  ];
}

function foreachFields(): BuiltInActionField[] {
  return [
    { label: 'Collection', path: ['foreach'], kind: 'json' },
    { label: 'Actions', path: ['actions'], kind: 'json' },
    { label: 'Runtime configuration', path: ['runtimeConfiguration'], kind: 'json' },
  ];
}

function untilFields(): BuiltInActionField[] {
  return [
    { label: 'Expression', path: ['expression'], kind: 'json' },
    { label: 'Actions', path: ['actions'], kind: 'json' },
    { label: 'Limit', path: ['limit'], kind: 'json' },
  ];
}

function switchFields(): BuiltInActionField[] {
  return [
    { label: 'Expression', path: ['expression'], kind: 'json' },
    { label: 'Cases', path: ['cases'], kind: 'json' },
    { label: 'Default', path: ['default'], kind: 'json' },
  ];
}

function responseFields(): BuiltInActionField[] {
  return [
    { label: 'Kind', path: ['kind'], kind: 'select', options: ['http', 'PowerApp', 'PowerPages', 'VirtualAgent', 'Skills'] },
    { label: 'Status code', path: ['inputs', 'statusCode'], kind: 'json' },
    { label: 'Headers', path: ['inputs', 'headers'], kind: 'json' },
    { label: 'Body', path: ['inputs', 'body'], kind: 'json' },
    { label: 'Schema', path: ['inputs', 'schema'], kind: 'json' },
  ];
}

function waitFields(action: Record<string, unknown>): BuiltInActionField[] {
  const inputs = isRecord(action.inputs) ? action.inputs : {};
  if (isRecord(inputs.until)) return [{ label: 'Timestamp', path: ['inputs', 'until', 'timestamp'] }];
  return [
    { label: 'Count', path: ['inputs', 'interval', 'count'], kind: 'json' },
    { label: 'Unit', path: ['inputs', 'interval', 'unit'], kind: 'select', options: ['Second', 'Minute', 'Hour', 'Day', 'Week', 'Month'] },
  ];
}

function terminateFields(): BuiltInActionField[] {
  return [
    { label: 'Run status', path: ['inputs', 'runStatus'], kind: 'select', options: ['Succeeded', 'Failed', 'Cancelled'] },
    { label: 'Run error', path: ['inputs', 'runError'], kind: 'json' },
  ];
}

function workflowFields(): BuiltInActionField[] {
  return [
    { label: 'Workflow reference name', path: ['inputs', 'host', 'workflowReferenceName'] },
    { label: 'Body', path: ['inputs', 'body'], kind: 'json' },
  ];
}

function variableMutationFields(type: string): BuiltInActionField[] {
  return [
    { label: 'Name', path: ['inputs', 'name'] },
    { label: type === 'incrementvariable' || type === 'decrementvariable' ? 'Amount' : 'Value', path: ['inputs', 'value'], kind: 'json' },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
