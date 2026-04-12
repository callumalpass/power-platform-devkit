import { createDiagnostic, type Diagnostic } from './diagnostics.js';

type JsonPrimitive = string | number | boolean | null;

interface JsonBaseNode {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  from: number;
  to: number;
  value: unknown;
  path: string[];
}

interface JsonStringNode extends JsonBaseNode {
  type: 'string';
  value: string;
  valueOffsetMap?: number[];
}

interface JsonObjectProperty {
  key: string;
  keyNode: JsonStringNode;
  valueNode: JsonNode;
  from: number;
  to: number;
}

interface JsonObjectNode extends JsonBaseNode {
  type: 'object';
  properties: JsonObjectProperty[];
  value: Record<string, unknown>;
}

interface JsonArrayNode extends JsonBaseNode {
  type: 'array';
  items: JsonNode[];
  value: unknown[];
}

interface JsonPrimitiveNode extends JsonBaseNode {
  type: 'number' | 'boolean' | 'null';
  value: JsonPrimitive;
}

type JsonNode = JsonObjectNode | JsonArrayNode | JsonStringNode | JsonPrimitiveNode;

export interface FlowRangeDiagnostic extends Diagnostic {
  from: number;
  to: number;
}

export interface FlowCompletionItem {
  label: string;
  type: 'property' | 'value' | 'function' | 'action' | 'variable' | 'parameter' | 'keyword';
  detail?: string;
  info?: string;
  apply?: string;
  boost?: number;
}

export interface FlowOutlineItem {
  kind: 'workflow' | 'trigger' | 'action' | 'scope' | 'branch' | 'parameter' | 'variable';
  name: string;
  detail?: string;
  from: number;
  to: number;
  /** Action type, e.g. "OpenApiConnection", "Http", "InitializeVariable" */
  type?: string;
  /** Connector identifier, e.g. "shared_sharepointonline" */
  connector?: string;
  /** Key input values (host, method, uri, etc.) */
  inputs?: Record<string, unknown>;
  /** Run-after dependency names */
  runAfter?: string[];
  children?: FlowOutlineItem[];
}

export interface FlowSymbolSummary {
  kind: 'trigger' | 'action' | 'parameter' | 'variable';
  name: string;
  detail?: string;
  from: number;
  to: number;
  container?: string;
}

export interface FlowReferenceSummary {
  kind: 'action' | 'variable' | 'parameter' | 'trigger' | 'loop';
  name: string;
  from: number;
  to: number;
  sourceAction?: string;
  expression?: string;
  resolved: boolean;
}

export interface FlowCursorContext {
  kind: 'expression' | 'property-key' | 'property-value' | 'value' | 'unknown';
  text: string;
  from: number;
  to: number;
  path: string[];
  nearestAction?: string;
  propertyName?: string;
}

export interface FlowKnowledgeSummary {
  level: 'structural' | 'semantic' | 'built-in';
  sources: string[];
}

export interface FlowAnalysisResult {
  context: FlowCursorContext;
  diagnostics: FlowRangeDiagnostic[];
  completions: FlowCompletionItem[];
  outline: FlowOutlineItem[];
  symbols: FlowSymbolSummary[];
  references: FlowReferenceSummary[];
  knowledge: FlowKnowledgeSummary;
  summary: {
    wrapperKind: string;
    triggerCount: number;
    actionCount: number;
    variableCount: number;
    parameterCount: number;
  };
}

export interface FlowExplainResult {
  symbol?: FlowSymbolSummary;
  inboundReferences: FlowReferenceSummary[];
  outboundReferences: FlowReferenceSummary[];
  diagnostics: FlowRangeDiagnostic[];
  summary?: Record<string, unknown>;
}

interface FlowActionNode {
  kind: 'action' | 'trigger';
  name: string;
  type: string;
  from: number;
  to: number;
  containerId: string;
  containerKind: 'workflow' | 'scope' | 'if-true' | 'if-false' | 'switch-case' | 'switch-default' | 'foreach' | 'until';
  parentAction?: string;
  siblingIndex: number;
  runAfter: string[];
  node: JsonObjectNode;
  children: FlowActionNode[];
}

interface FlowVariableNode {
  name: string;
  type?: string;
  from: number;
  to: number;
  declaredBy?: string;
}

interface FlowParameterNode {
  name: string;
  type?: string;
  from: number;
  to: number;
}

interface FlowExpressionOccurrence {
  expression: string;
  from: number;
  to: number;
  hostString: JsonStringNode;
  actionName?: string;
}

interface FlowDocumentModel {
  wrapperKind: string;
  definitionNode?: JsonObjectNode;
  actions: FlowActionNode[];
  triggers: FlowActionNode[];
  variables: FlowVariableNode[];
  parameters: FlowParameterNode[];
  expressions: FlowExpressionOccurrence[];
  diagnostics: FlowRangeDiagnostic[];
}

interface ExpressionToken {
  type: 'identifier' | 'string' | 'number' | 'boolean' | 'null' | 'paren-open' | 'paren-close' | 'comma' | 'dot' | 'bracket-open' | 'bracket-close' | 'question' | 'eof';
  value: string;
  from: number;
  to: number;
}

interface ExpressionNodeBase {
  kind: 'call' | 'identifier' | 'string' | 'number' | 'boolean' | 'null' | 'member' | 'index';
  from: number;
  to: number;
}

interface ExpressionCallNode extends ExpressionNodeBase {
  kind: 'call';
  name: string;
  args: ExpressionNode[];
}

interface ExpressionIdentifierNode extends ExpressionNodeBase {
  kind: 'identifier';
  name: string;
}

interface ExpressionLiteralNode extends ExpressionNodeBase {
  kind: 'string' | 'number' | 'boolean' | 'null';
  value: string | number | boolean | null;
}

interface ExpressionMemberNode extends ExpressionNodeBase {
  kind: 'member';
  object: ExpressionNode;
  property: string;
}

interface ExpressionIndexNode extends ExpressionNodeBase {
  kind: 'index';
  object: ExpressionNode;
  index: ExpressionNode;
}

type ExpressionNode =
  | ExpressionCallNode
  | ExpressionIdentifierNode
  | ExpressionLiteralNode
  | ExpressionMemberNode
  | ExpressionIndexNode;

interface ExpressionParseResult {
  root?: ExpressionNode;
  diagnostics: FlowRangeDiagnostic[];
}

interface FunctionSpec {
  minArgs: number;
  maxArgs?: number;
  info: string;
}

const FLOW_ROOT_PROPERTIES = ['$schema', 'contentVersion', 'parameters', 'triggers', 'actions', 'outputs', 'description', 'staticResults'];
const ACTION_PROPERTIES = ['type', 'inputs', 'runAfter', 'actions', 'else', 'expression', 'cases', 'default', 'foreach', 'limit', 'metadata', 'operationOptions', 'description', 'runtimeConfiguration'];
const RUN_AFTER_STATUSES = ['Succeeded', 'Failed', 'Skipped', 'TimedOut'];
const ACTION_TYPE_OPTIONS = [
  'ApiConnection',
  'Compose',
  'Condition',
  'Foreach',
  'If',
  'InitializeVariable',
  'AppendToArrayVariable',
  'AppendToStringVariable',
  'IncrementVariable',
  'DecrementVariable',
  'SetVariable',
  'Scope',
  'Response',
  'Http',
  'Until',
  'Switch',
  'Workflow',
  'ServiceProvider',
];

const RAW_FUNCTION_SPECS: Record<string, FunctionSpec> = {
  actions: { minArgs: 1, maxArgs: 1, info: 'Reference another action result.' },
  body: { minArgs: 1, maxArgs: 1, info: 'Reference the body of another action.' },
  outputs: { minArgs: 1, maxArgs: 1, info: 'Reference another action outputs.' },
  variables: { minArgs: 1, maxArgs: 1, info: 'Reference a workflow variable.' },
  parameters: { minArgs: 1, maxArgs: 1, info: 'Reference a workflow parameter.' },
  items: { minArgs: 1, maxArgs: 1, info: 'Reference a foreach loop item by loop name.' },
  item: { minArgs: 0, maxArgs: 0, info: 'Reference the current foreach item.' },
  trigger: { minArgs: 0, maxArgs: 0, info: 'Reference trigger metadata.' },
  triggerBody: { minArgs: 0, maxArgs: 0, info: 'Reference the trigger body.' },
  triggerOutputs: { minArgs: 0, maxArgs: 0, info: 'Reference trigger outputs.' },
  equals: { minArgs: 2, info: 'Compare two values.' },
  and: { minArgs: 2, info: 'Logical AND.' },
  or: { minArgs: 2, info: 'Logical OR.' },
  not: { minArgs: 1, maxArgs: 1, info: 'Logical NOT.' },
  contains: { minArgs: 2, maxArgs: 2, info: 'Check whether a collection or string contains a value.' },
  startsWith: { minArgs: 2, maxArgs: 2, info: 'Check whether a string starts with a value.' },
  endsWith: { minArgs: 2, maxArgs: 2, info: 'Check whether a string ends with a value.' },
  empty: { minArgs: 1, maxArgs: 1, info: 'Check whether a value is empty.' },
  length: { minArgs: 1, maxArgs: 1, info: 'Return the length of a collection or string.' },
  createArray: { minArgs: 0, info: 'Create an array value.' },
  if: { minArgs: 3, maxArgs: 3, info: 'Return one of two values based on a condition.' },
  add: { minArgs: 2, maxArgs: 2, info: 'Add numbers.' },
  addDays: { minArgs: 2, maxArgs: 2, info: 'Add days to a timestamp.' },
  addHours: { minArgs: 2, maxArgs: 2, info: 'Add hours to a timestamp.' },
  addMinutes: { minArgs: 2, maxArgs: 2, info: 'Add minutes to a timestamp.' },
  mod: { minArgs: 2, maxArgs: 2, info: 'Modulo.' },
  less: { minArgs: 2, maxArgs: 2, info: 'Less-than comparison.' },
  lessOrEquals: { minArgs: 2, maxArgs: 2, info: 'Less-than-or-equal comparison.' },
  greater: { minArgs: 2, maxArgs: 2, info: 'Greater-than comparison.' },
  greaterOrEquals: { minArgs: 2, maxArgs: 2, info: 'Greater-than-or-equal comparison.' },
  json: { minArgs: 1, maxArgs: 1, info: 'Parse JSON from a string.' },
  encodeURIComponent: { minArgs: 1, maxArgs: 1, info: 'Encode a URI component.' },
  base64ToString: { minArgs: 1, maxArgs: 1, info: 'Decode base64 text.' },
  utcNow: { minArgs: 0, maxArgs: 0, info: 'Current UTC timestamp.' },
  formatDateTime: { minArgs: 1, maxArgs: 2, info: 'Format a timestamp using an optional format string.' },
  convertToUtc: { minArgs: 2, maxArgs: 2, info: 'Convert a time to UTC.' },
  convertFromUtc: { minArgs: 2, maxArgs: 2, info: 'Convert UTC to a timezone.' },
  dayOfWeek: { minArgs: 1, maxArgs: 1, info: 'Get weekday number.' },
  startOfDay: { minArgs: 1, maxArgs: 1, info: 'Start of day.' },
  coalesce: { minArgs: 2, info: 'Return first non-null argument.' },
  concat: { minArgs: 2, info: 'Concatenate values.' },
};

const FUNCTION_SPECS: Record<string, FunctionSpec> = Object.fromEntries(
  Object.entries(RAW_FUNCTION_SPECS).map(([name, spec]) => [name.toLowerCase(), spec]),
);

const STRUCTURED_EXPRESSION_SPECS: Record<string, FunctionSpec> = {
  ...FUNCTION_SPECS,
  and: { minArgs: 1, info: 'Structured logical AND.' },
  or: { minArgs: 1, info: 'Structured logical OR.' },
};

export function analyzeFlow(source: string, cursor = 0): FlowAnalysisResult {
  const parseResult = parseJsonDocument(source);
  const fallbackContext = readFallbackContext(source, cursor);
  if (!parseResult.root) {
    return {
      context: fallbackContext,
      diagnostics: parseResult.diagnostics,
      completions: fallbackContext.kind === 'expression' ? completeExpression(fallbackContext.text, fallbackContext.to, [], [], []) : [],
      outline: [],
      symbols: [],
      references: [],
      knowledge: { level: 'structural', sources: ['strict-json-parser'] },
      summary: { wrapperKind: 'unknown', triggerCount: 0, actionCount: 0, variableCount: 0, parameterCount: 0 },
    };
  }

  const model = buildFlowModel(parseResult.root);
  const context = readCursorContext(parseResult.root, source, cursor, model) ?? fallbackContext;
  const diagnostics = [...parseResult.diagnostics, ...model.diagnostics];
  const symbols = buildSymbols(model);
  const references = analyzeReferences(model, diagnostics);
  const completions = buildCompletions(context, model, source, cursor);

  return {
    context,
    diagnostics,
    completions,
    outline: buildOutline(model),
    symbols,
    references,
    knowledge: { level: 'built-in', sources: ['workflow-graph', 'expression-engine', 'built-in-function-pack'] },
    summary: {
      wrapperKind: model.wrapperKind,
      triggerCount: model.triggers.length,
      actionCount: flattenActions(model.actions).length,
      variableCount: model.variables.length,
      parameterCount: model.parameters.length,
    },
  };
}

export function explainFlowSymbol(source: string, symbolName: string): FlowExplainResult {
  const analysis = analyzeFlow(source, 0);
  const symbol = analysis.symbols.find((item) => item.name === symbolName);
  return {
    symbol,
    inboundReferences: analysis.references.filter((item) => item.name === symbolName),
    outboundReferences: analysis.references.filter((item) => item.sourceAction === symbolName),
    diagnostics: analysis.diagnostics.filter((item) => item.message.includes(symbolName) || item.path === symbolName),
    summary: symbol ? { kind: symbol.kind, detail: symbol.detail, container: symbol.container } : undefined,
  };
}

function buildFlowModel(root: JsonObjectNode): FlowDocumentModel {
  const diagnostics: FlowRangeDiagnostic[] = [];
  const extracted = extractDefinition(root);
  if (!extracted.definitionNode) {
    diagnostics.push(rangeDiagnostic('error', 'FLOW_DEFINITION_MISSING', 'Could not find a workflow definition in this file.', root.from, root.to));
    return {
      wrapperKind: extracted.wrapperKind,
      actions: [],
      triggers: [],
      variables: [],
      parameters: [],
      expressions: [],
      diagnostics,
    };
  }

  const definitionNode = extracted.definitionNode;
  const triggersNode = objectPropertyValue(definitionNode, 'triggers');
  const actionsNode = objectPropertyValue(definitionNode, 'actions');
  const parametersNode = objectPropertyValue(definitionNode, 'parameters');
  const actions = actionsNode?.type === 'object' ? collectActions(actionsNode, diagnostics, 'workflow', 'workflow', undefined) : [];
  const triggers = triggersNode?.type === 'object' ? collectTriggerNodes(triggersNode, diagnostics) : [];
  const parameters = parametersNode?.type === 'object' ? collectParameters(parametersNode) : [];
  const variables = collectVariables(actions);
  const expressions = collectExpressions(definitionNode, actions);
  validateStructuredExpressions(definitionNode, diagnostics);

  return {
    wrapperKind: extracted.wrapperKind,
    definitionNode,
    actions,
    triggers,
    variables,
    parameters,
    expressions,
    diagnostics,
  };
}

function collectTriggerNodes(node: JsonObjectNode, diagnostics: FlowRangeDiagnostic[]): FlowActionNode[] {
  const seen = new Set<string>();
  return node.properties.flatMap((property, index) => {
    if (property.valueNode.type !== 'object') return [];
    if (seen.has(property.key)) {
      diagnostics.push(rangeDiagnostic('error', 'FLOW_TRIGGER_DUPLICATE_NAME', `Duplicate trigger ${property.key}.`, property.keyNode.from, property.keyNode.to));
    }
    seen.add(property.key);
    return [{
      kind: 'trigger',
      name: property.key,
      type: readStringProperty(property.valueNode, 'type') ?? 'Unknown',
      from: property.keyNode.from,
      to: property.valueNode.to,
      containerId: 'workflow:triggers',
      containerKind: 'workflow',
      siblingIndex: index,
      runAfter: [],
      node: property.valueNode,
      children: [],
    }];
  });
}

function collectActions(
  node: JsonObjectNode,
  diagnostics: FlowRangeDiagnostic[],
  containerId: string,
  containerKind: FlowActionNode['containerKind'],
  parentAction: string | undefined,
): FlowActionNode[] {
  const seen = new Set<string>();
  const siblings: FlowActionNode[] = [];
  for (const [index, property] of node.properties.entries()) {
    if (property.valueNode.type !== 'object') continue;
    if (seen.has(property.key)) {
      diagnostics.push(rangeDiagnostic('error', 'FLOW_ACTION_DUPLICATE_NAME', `Duplicate action ${property.key}.`, property.keyNode.from, property.keyNode.to));
    }
    seen.add(property.key);
    const actionNode = property.valueNode;
    const type = readStringProperty(actionNode, 'type') ?? 'Unknown';
    const next: FlowActionNode = {
      kind: 'action',
      name: property.key,
      type,
      from: property.keyNode.from,
      to: actionNode.to,
      containerId,
      containerKind,
      parentAction,
      siblingIndex: index,
      runAfter: readRunAfterTargets(actionNode),
      node: actionNode,
      children: [],
    };
    next.children = collectNestedActions(next, diagnostics);
    siblings.push(next);
  }
  validateRunAfterTargets(siblings, diagnostics);
  return siblings;
}

function collectNestedActions(action: FlowActionNode, diagnostics: FlowRangeDiagnostic[]): FlowActionNode[] {
  const nested: FlowActionNode[] = [];
  const actionsNode = objectPropertyValue(action.node, 'actions');
  if (actionsNode?.type === 'object') {
    nested.push(...collectActions(actionsNode, diagnostics, `${action.name}:actions`, classifyContainerKind(action.type, 'scope'), action.name));
  }
  const elseNode = objectPropertyValue(action.node, 'else');
  if (elseNode?.type === 'object') {
    const elseActions = objectPropertyValue(elseNode, 'actions');
    if (elseActions?.type === 'object') {
      nested.push(...collectActions(elseActions, diagnostics, `${action.name}:else`, 'if-false', action.name));
    }
  }
  const defaultNode = objectPropertyValue(action.node, 'default');
  if (defaultNode?.type === 'object') {
    const defaultActions = objectPropertyValue(defaultNode, 'actions');
    if (defaultActions?.type === 'object') {
      nested.push(...collectActions(defaultActions, diagnostics, `${action.name}:default`, 'switch-default', action.name));
    }
  }
  const casesNode = objectPropertyValue(action.node, 'cases');
  if (casesNode?.type === 'object') {
    for (const caseProperty of casesNode.properties) {
      if (caseProperty.valueNode.type !== 'object') continue;
      const caseActions = objectPropertyValue(caseProperty.valueNode, 'actions');
      if (caseActions?.type === 'object') {
        nested.push(...collectActions(caseActions, diagnostics, `${action.name}:case:${caseProperty.key}`, 'switch-case', action.name));
      }
    }
  }
  return nested;
}

function classifyContainerKind(type: string, fallback: FlowActionNode['containerKind']): FlowActionNode['containerKind'] {
  const normalized = type.toLowerCase();
  if (normalized.includes('foreach')) return 'foreach';
  if (normalized.includes('until')) return 'until';
  if (normalized === 'if' || normalized === 'condition') return 'if-true';
  return fallback;
}

function collectParameters(node: JsonObjectNode): FlowParameterNode[] {
  return node.properties
    .filter((property) => property.valueNode.type === 'object')
    .map((property) => ({
      name: property.key,
      type: readStringProperty(property.valueNode as JsonObjectNode, 'type'),
      from: property.keyNode.from,
      to: property.valueNode.to,
    }));
}

function collectVariables(actions: FlowActionNode[]): FlowVariableNode[] {
  const all = flattenActions(actions);
  const variables = new Map<string, FlowVariableNode>();
  for (const action of all) {
    if (action.type === 'InitializeVariable') {
      const inputs = objectPropertyValue(action.node, 'inputs');
      const variableArray = inputs?.type === 'object' ? objectPropertyValue(inputs, 'variables') : undefined;
      if (variableArray?.type === 'array') {
        for (const item of variableArray.items) {
          if (item.type !== 'object') continue;
          const nameNode = objectPropertyValue(item, 'name');
          const typeNode = objectPropertyValue(item, 'type');
          if (nameNode?.type !== 'string') continue;
          variables.set(nameNode.value, {
            name: nameNode.value,
            type: typeNode?.type === 'string' ? typeNode.value : undefined,
            from: nameNode.from,
            to: item.to,
            declaredBy: action.name,
          });
        }
      }
    }
  }
  return [...variables.values()];
}

function collectExpressions(definitionNode: JsonObjectNode, actions: FlowActionNode[]): FlowExpressionOccurrence[] {
  const actionRanges = buildActionRangeIndex(actions);
  const expressions: FlowExpressionOccurrence[] = [];
  walkJson(definitionNode, (node) => {
    if (node.type !== 'string') return;
    for (const occurrence of extractExpressionsFromString(node)) {
      occurrence.actionName = findNearestActionName(actionRanges, occurrence.from);
      expressions.push(occurrence);
    }
  });
  return expressions;
}

function validateStructuredExpressions(definitionNode: JsonObjectNode, diagnostics: FlowRangeDiagnostic[]): void {
  walkObjectProperties(definitionNode, (property) => {
    if (property.key !== 'expression') return;
    if (property.valueNode.type !== 'object' && property.valueNode.type !== 'array') return;
    validateStructuredExpressionValue(property.valueNode, diagnostics);
  });
}

function validateStructuredExpressionValue(node: JsonNode, diagnostics: FlowRangeDiagnostic[]): void {
  if (node.type === 'array') {
    node.items.forEach((item) => validateStructuredExpressionValue(item, diagnostics));
    return;
  }
  if (node.type !== 'object') return;
  if (node.properties.length !== 1) {
    diagnostics.push(rangeDiagnostic('warning', 'FLOW_STRUCTURED_EXPR_SHAPE_INVALID', 'Structured expression objects should contain one operator.', node.from, node.to));
    return;
  }
  const [property] = node.properties;
  if (!property) return;
  const lowered = property.key.toLowerCase();
  const spec = STRUCTURED_EXPRESSION_SPECS[lowered];
  if (!spec) {
    diagnostics.push(rangeDiagnostic('warning', 'FLOW_STRUCTURED_EXPR_OPERATOR_UNKNOWN', `Unknown structured expression operator ${property.key}.`, property.keyNode.from, property.keyNode.to));
  } else {
    const argCount = property.valueNode.type === 'array' ? property.valueNode.items.length : 1;
    if (argCount < spec.minArgs || (typeof spec.maxArgs === 'number' && argCount > spec.maxArgs)) {
      diagnostics.push(rangeDiagnostic('warning', 'FLOW_STRUCTURED_EXPR_ARGUMENT_INVALID', `${property.key} expects ${formatArity(spec)} structured argument(s), found ${argCount}.`, property.keyNode.from, property.valueNode.to));
    }
  }
  validateStructuredExpressionValue(property.valueNode, diagnostics);
}

function buildActionRangeIndex(actions: FlowActionNode[]): Array<{ from: number; to: number; name: string }> {
  return flattenActions(actions).map((item) => ({ from: item.from, to: item.to, name: item.name }));
}

function findNearestActionName(actions: Array<{ from: number; to: number; name: string }>, pos: number): string | undefined {
  const match = actions.find((item) => pos >= item.from && pos <= item.to);
  return match?.name;
}

function analyzeReferences(model: FlowDocumentModel, diagnostics: FlowRangeDiagnostic[]): FlowReferenceSummary[] {
  const actionMap = new Map(flattenActions(model.actions).map((item) => [item.name, item] as const));
  const variableMap = new Map(model.variables.map((item) => [item.name, item] as const));
  const parameterMap = new Map(model.parameters.map((item) => [item.name, item] as const));
  const references: FlowReferenceSummary[] = [];
  for (const occurrence of model.expressions) {
    const parsed = parseExpression(occurrence.expression, occurrence.from);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.root) continue;
    walkExpression(parsed.root, (node) => {
      if (node.kind !== 'call') return;
      const lowered = node.name.toLowerCase();
      const first = node.args[0];
      const stringArg = first?.kind === 'string' ? String(first.value) : undefined;
      const pushReference = (kind: FlowReferenceSummary['kind'], name: string | undefined, resolved: boolean) => {
        if (!name) return;
        references.push({ kind, name, from: node.from, to: node.to, sourceAction: occurrence.actionName, expression: occurrence.expression, resolved });
      };
      if (FUNCTION_SPECS[lowered]) {
        validateFunctionCall(node, diagnostics);
      } else {
        diagnostics.push(rangeDiagnostic('warning', 'FLOW_EXPR_FUNCTION_UNKNOWN', `Unknown function ${node.name}.`, node.from, node.to));
      }
      if (lowered === 'actions' || lowered === 'body' || lowered === 'outputs') {
        const target = stringArg ?? '';
        const resolved = actionMap.has(target);
        pushReference('action', target, resolved);
        if (!resolved) diagnostics.push(rangeDiagnostic('error', 'FLOW_REFERENCE_UNRESOLVED', `Expression references missing action ${target}.`, node.from, node.to));
        else validateActionReferenceAvailability(occurrence.actionName, target, actionMap, diagnostics, node.from, node.to);
      }
      if (lowered === 'variables') {
        const target = stringArg ?? '';
        const resolved = variableMap.has(target);
        pushReference('variable', target, resolved);
        if (!resolved) diagnostics.push(rangeDiagnostic('error', 'FLOW_VARIABLE_UNRESOLVED', `Expression references missing variable ${target}.`, node.from, node.to));
      }
      if (lowered === 'parameters') {
        const target = stringArg ?? '';
        const resolved = parameterMap.has(target);
        pushReference('parameter', target, resolved);
        if (!resolved) diagnostics.push(rangeDiagnostic('warning', 'FLOW_PARAMETER_UNRESOLVED', `Expression references missing parameter ${target}.`, node.from, node.to));
      }
      if (lowered === 'items') {
        const target = stringArg ?? '';
        const resolved = Boolean(target);
        pushReference('loop', target, resolved);
      }
      if (lowered === 'trigger' || lowered === 'triggerbody' || lowered === 'triggeroutputs') {
        references.push({ kind: 'trigger', name: model.triggers[0]?.name ?? 'trigger', from: node.from, to: node.to, sourceAction: occurrence.actionName, expression: occurrence.expression, resolved: model.triggers.length > 0 });
      }
    });
  }
  return references;
}

function validateActionReferenceAvailability(
  sourceActionName: string | undefined,
  targetActionName: string,
  actionMap: Map<string, FlowActionNode>,
  diagnostics: FlowRangeDiagnostic[],
  from: number,
  to: number,
): void {
  if (!sourceActionName) return;
  const source = actionMap.get(sourceActionName);
  const target = actionMap.get(targetActionName);
  if (!source || !target) return;
  if (source.containerId === target.containerId && target.siblingIndex > source.siblingIndex) {
    diagnostics.push(rangeDiagnostic('warning', 'FLOW_REFERENCE_FUTURE_ACTION', `Expression references ${targetActionName} before it appears in the same scope.`, from, to));
  }
  if (!shareScopeLineage(source, target, actionMap)) {
    diagnostics.push(rangeDiagnostic('info', 'FLOW_REFERENCE_SCOPE_AMBIGUOUS', `Expression references ${targetActionName} from a different scope.`, from, to));
  }
}

function shareScopeLineage(source: FlowActionNode, target: FlowActionNode, actionMap: Map<string, FlowActionNode>): boolean {
  if (source.containerId === target.containerId) return true;
  const sourceLineage = new Set(actionLineage(source, actionMap));
  for (const item of actionLineage(target, actionMap)) {
    if (sourceLineage.has(item)) return true;
  }
  return false;
}

function actionLineage(action: FlowActionNode, actionMap: Map<string, FlowActionNode>): string[] {
  const lineage = [action.containerId, action.name];
  let parent = action.parentAction;
  while (parent) {
    lineage.push(parent);
    parent = actionMap.get(parent)?.parentAction;
  }
  return lineage;
}

function validateFunctionCall(node: ExpressionCallNode, diagnostics: FlowRangeDiagnostic[]): void {
  const spec = FUNCTION_SPECS[node.name.toLowerCase()];
  if (!spec) return;
  if (node.args.length < spec.minArgs || (typeof spec.maxArgs === 'number' && node.args.length > spec.maxArgs)) {
    diagnostics.push(rangeDiagnostic('warning', 'FLOW_EXPR_ARGUMENT_INVALID', `${node.name} expects ${formatArity(spec)} argument(s), found ${node.args.length}.`, node.from, node.to));
  }
}

function buildSymbols(model: FlowDocumentModel): FlowSymbolSummary[] {
  return [
    ...model.parameters.map((item) => ({ kind: 'parameter' as const, name: item.name, detail: item.type, from: item.from, to: item.to })),
    ...model.variables.map((item) => ({ kind: 'variable' as const, name: item.name, detail: item.type, from: item.from, to: item.to, container: item.declaredBy })),
    ...model.triggers.map((item) => ({ kind: 'trigger' as const, name: item.name, detail: item.type, from: item.from, to: item.to })),
    ...flattenActions(model.actions).map((item) => ({ kind: 'action' as const, name: item.name, detail: item.type, from: item.from, to: item.to, container: item.parentAction })),
  ];
}

function buildOutline(model: FlowDocumentModel): FlowOutlineItem[] {
  const children: FlowOutlineItem[] = [];
  if (model.parameters.length) {
    children.push({
      kind: 'parameter',
      name: 'parameters',
      detail: `${model.parameters.length}`,
      from: model.parameters[0]!.from,
      to: model.parameters[model.parameters.length - 1]!.to,
      children: model.parameters.map((item) => ({ kind: 'parameter', name: item.name, detail: item.type, from: item.from, to: item.to })),
    });
  }
  if (model.triggers.length) {
    children.push({
      kind: 'trigger',
      name: 'triggers',
      detail: `${model.triggers.length}`,
      from: model.triggers[0]!.from,
      to: model.triggers[model.triggers.length - 1]!.to,
      children: model.triggers.map((item) => ({ kind: 'trigger', name: item.name, detail: item.type, from: item.from, to: item.to })),
    });
  }
  if (model.actions.length) {
    children.push({
      kind: 'action',
      name: 'actions',
      detail: `${model.actions.length}`,
      from: model.actions[0]!.from,
      to: model.actions[model.actions.length - 1]!.to,
      children: model.actions.map(actionOutline),
    });
  }
  if (model.variables.length) {
    children.push({
      kind: 'variable',
      name: 'variables',
      detail: `${model.variables.length}`,
      from: model.variables[0]!.from,
      to: model.variables[model.variables.length - 1]!.to,
      children: model.variables.map((item) => ({ kind: 'variable', name: item.name, detail: item.type, from: item.from, to: item.to })),
    });
  }
  return [{
    kind: 'workflow',
    name: 'workflow',
    detail: model.wrapperKind,
    from: model.definitionNode?.from ?? 0,
    to: model.definitionNode?.to ?? 0,
    children,
  }];
}

function actionOutline(action: FlowActionNode): FlowOutlineItem {
  const item: FlowOutlineItem = {
    kind: action.children.length ? 'scope' : 'action',
    name: action.name,
    detail: action.type,
    type: action.type,
    from: action.from,
    to: action.to,
    children: action.children.length ? action.children.map(actionOutline) : undefined,
  };
  if (action.runAfter.length) item.runAfter = action.runAfter;
  // extract connector and key inputs
  const inputsNode = objectPropertyValue(action.node, 'inputs');
  if (inputsNode?.type === 'object') {
    const inputs: Record<string, unknown> = {};
    const connector = readConnectorSummary(inputsNode);
    if (connector.connector) item.connector = connector.connector;
    if (connector.operationId) inputs.operationId = connector.operationId;
    if (connector.serviceProviderId) inputs.serviceProviderId = connector.serviceProviderId;
    for (const key of ['method', 'uri', 'path', 'body', 'queries', 'headers'] as const) {
      const v = objectPropertyValue(inputsNode, key);
      if (v) inputs[key] = v.type === 'string' ? v.value : v.type === 'object' || v.type === 'array' ? v.value : undefined;
    }
    // variables
    const varArray = objectPropertyValue(inputsNode, 'variables');
    if (varArray?.type === 'array' && varArray.items.length) {
      const first = varArray.items[0];
      if (first?.type === 'object') {
        const varName = readStringProperty(first, 'name');
        if (varName) inputs.variable = varName;
      }
    }
    if (Object.keys(inputs).length) item.inputs = inputs;
  }
  // expression for conditions
  const expressionNode = objectPropertyValue(action.node, 'expression');
  if (expressionNode) {
    if (expressionNode.type === 'string') item.inputs = { ...item.inputs, expression: expressionNode.value };
    else if (expressionNode.type === 'object' || expressionNode.type === 'array') item.inputs = { ...item.inputs, expression: expressionNode.value };
  }
  // foreach collection expression
  const foreachNode = objectPropertyValue(action.node, 'foreach');
  if (foreachNode?.type === 'string') item.inputs = { ...item.inputs, foreach: foreachNode.value };
  // description
  const descNode = objectPropertyValue(action.node, 'description');
  if (descNode?.type === 'string') item.inputs = { ...item.inputs, description: descNode.value };
  // metadata (flowName, designer annotations, etc.)
  const metaNode = objectPropertyValue(action.node, 'metadata');
  if (metaNode?.type === 'object') {
    const opId = readStringProperty(metaNode, 'operationMetadataId');
    if (opId) item.inputs = { ...item.inputs, operationMetadataId: opId };
    const flowName = readStringProperty(metaNode, 'flowSystemMetadata');
    if (flowName) item.inputs = { ...item.inputs, flowSystemMetadata: flowName };
  }
  // retry / concurrency from runtimeConfiguration
  const rtNode = objectPropertyValue(action.node, 'runtimeConfiguration');
  if (rtNode?.type === 'object') {
    const retryNode = objectPropertyValue(rtNode, 'staticResult');
    const policyNode = objectPropertyValue(rtNode, 'retryPolicy');
    if (policyNode?.type === 'object') {
      const policyType = readStringProperty(policyNode, 'type');
      if (policyType) item.inputs = { ...item.inputs, retryPolicy: policyType };
    }
    const concNode = objectPropertyValue(rtNode, 'concurrency');
    if (concNode?.type === 'object') {
      const reps = objectPropertyValue(concNode, 'repetitions');
      if (reps?.type === 'number') item.inputs = { ...item.inputs, concurrency: reps.value };
    }
    if (retryNode?.type === 'object') {
      const staticName = readStringProperty(retryNode, 'name');
      if (staticName) item.inputs = { ...item.inputs, staticResult: staticName };
    }
  }
  // operationOptions (e.g. "DisableAsyncPattern")
  const optsNode = objectPropertyValue(action.node, 'operationOptions');
  if (optsNode?.type === 'string') item.inputs = { ...item.inputs, operationOptions: optsNode.value };
  // limit (for Until loops)
  const limitNode = objectPropertyValue(action.node, 'limit');
  if (limitNode?.type === 'object') {
    const count = objectPropertyValue(limitNode, 'count');
    const timeout = readStringProperty(limitNode, 'timeout');
    if (count?.type === 'number') item.inputs = { ...item.inputs, limitCount: count.value };
    if (timeout) item.inputs = { ...item.inputs, limitTimeout: timeout };
  }
  return item;
}

function readConnectorSummary(inputsNode: JsonObjectNode): { connector?: string; operationId?: string; serviceProviderId?: string } {
  const serviceProviderNode = objectPropertyValue(inputsNode, 'serviceProviderConfiguration');
  const connector = readStringFromFirstObjectPath(inputsNode, [
    ['host', 'connection', 'referenceName'],
    ['host', 'connection', 'name'],
    ['host', 'connectionName'],
    ['host', 'apiId'],
    ['serviceProviderConfiguration', 'connectionName'],
    ['serviceProviderConfiguration', 'serviceProviderId'],
  ]);
  return {
    connector,
    operationId: readStringFromFirstObjectPath(inputsNode, [
      ['host', 'operationId'],
      ['operationId'],
      ['serviceProviderConfiguration', 'operationId'],
    ]),
    serviceProviderId: serviceProviderNode?.type === 'object' ? readStringProperty(serviceProviderNode, 'serviceProviderId') : undefined,
  };
}

function buildCompletions(context: FlowCursorContext, model: FlowDocumentModel, source: string, cursor: number): FlowCompletionItem[] {
  if (context.kind === 'expression') {
    return completeExpression(context.text, cursor - context.from, flattenActions(model.actions), model.variables, model.parameters);
  }
  if (context.kind === 'property-key') {
    if (context.path.length === 1) return FLOW_ROOT_PROPERTIES.map((item) => ({ label: item, type: 'property' as const, apply: `"${item}": ` }));
    if (context.path.includes('runAfter')) {
      const siblingActions = collectSiblingActionNames(model, context.nearestAction);
      return [
        ...siblingActions.map((item) => ({ label: item, type: 'action' as const, apply: `"${item}": ["Succeeded"]` })),
        ...RUN_AFTER_STATUSES.map((item) => ({ label: item, type: 'value' as const })),
      ];
    }
    return ACTION_PROPERTIES.map((item) => ({ label: item, type: 'property' as const, apply: `"${item}": ` }));
  }
  if (context.kind === 'property-value' && context.propertyName === 'type') {
    return ACTION_TYPE_OPTIONS.map((item) => ({ label: item, type: 'value' as const, apply: `"${item}"` }));
  }
  return [];
}

function collectSiblingActionNames(model: FlowDocumentModel, actionName: string | undefined): string[] {
  const all = flattenActions(model.actions);
  const current = actionName ? all.find((item) => item.name === actionName) : undefined;
  if (!current) return all.map((item) => item.name);
  return all.filter((item) => item.containerId === current.containerId && item.name !== current.name).map((item) => item.name);
}

function completeExpression(
  text: string,
  relativeCursor: number,
  actions: FlowActionNode[],
  variables: FlowVariableNode[],
  parameters: FlowParameterNode[],
): FlowCompletionItem[] {
  const before = text.slice(0, Math.max(0, relativeCursor));
  const targetNamePrefixMatch = before.match(/(?:actions|body|outputs|items|variables|parameters)\(\s*'([^']*)$/i);
  if (targetNamePrefixMatch) {
    const prefix = targetNamePrefixMatch[1] ?? '';
    const functionName = before.match(/([A-Za-z_][A-Za-z0-9_]*)\(\s*'[^']*$/)?.[1]?.toLowerCase();
    const items: FlowCompletionItem[] =
      functionName === 'variables'
        ? variables.map((item) => ({ label: item.name, type: 'variable' as const }))
        : functionName === 'parameters'
          ? parameters.map((item) => ({ label: item.name, type: 'parameter' as const }))
          : actions.map((item) => ({ label: item.name, type: 'action' as const }));
    return filterCompletionPrefix(items.map((item) => ({ ...item, apply: item.label })), prefix);
  }
  const identPrefix = before.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? '';
  const functionItems = Object.entries(FUNCTION_SPECS).map(([label, spec]) => ({
    label,
    type: 'function' as const,
    detail: formatArity(spec),
    info: spec.info,
    apply: `${label}()`,
  }));
  return filterCompletionPrefix(functionItems, identPrefix);
}

function filterCompletionPrefix<T extends FlowCompletionItem>(items: T[], prefix: string): T[] {
  const normalized = prefix.toLowerCase();
  const filtered = normalized ? items.filter((item) => item.label.toLowerCase().includes(normalized)) : items;
  return filtered.sort((a, b) => scoreCompletion(a, normalized) - scoreCompletion(b, normalized)).slice(0, 30);
}

function scoreCompletion(item: FlowCompletionItem, prefix: string): number {
  if (!prefix) return 0;
  const label = item.label.toLowerCase();
  if (label.startsWith(prefix)) return 0;
  const index = label.indexOf(prefix);
  return index >= 0 ? index + 5 : 1000;
}

function readCursorContext(root: JsonObjectNode, source: string, cursor: number, model: FlowDocumentModel): FlowCursorContext | undefined {
  const context = locateJsonContext(root, cursor);
  if (context?.kind === 'string-value') {
    const expression = findExpressionAtCursor(context.node, cursor);
    if (expression) {
      return {
        kind: 'expression',
        text: expression.expression,
        from: expression.from,
        to: expression.to,
        path: context.node.path,
        nearestAction: findNearestActionName(buildActionRangeIndex(model.actions), cursor),
      };
    }
    return {
      kind: 'property-value',
      text: context.node.value,
      from: context.node.from,
      to: context.node.to,
      path: context.node.path,
      propertyName: context.propertyName,
      nearestAction: findNearestActionName(buildActionRangeIndex(model.actions), cursor),
    };
  }
  if (context?.kind === 'property-key') {
    return {
      kind: 'property-key',
      text: context.property.key,
      from: context.property.keyNode.from,
      to: context.property.keyNode.to,
      path: context.path,
      nearestAction: findNearestActionName(buildActionRangeIndex(model.actions), cursor),
      propertyName: context.property.key,
    };
  }
  return readFallbackContext(source, cursor);
}

function readFallbackContext(source: string, cursor: number): FlowCursorContext {
  const windowStart = Math.max(0, cursor - 160);
  const windowEnd = Math.min(source.length, cursor + 40);
  const local = source.slice(windowStart, windowEnd);
  const exprStart = local.lastIndexOf('@');
  if (exprStart >= 0) {
    return {
      kind: 'expression',
      text: local.slice(exprStart).replace(/^@\{?/, '').replace(/\}?$/, ''),
      from: windowStart + exprStart,
      to: windowEnd,
      path: [],
    };
  }
  return { kind: 'unknown', text: '', from: cursor, to: cursor, path: [] };
}

function locateJsonContext(
  node: JsonNode,
  cursor: number,
): { kind: 'property-key'; property: JsonObjectProperty; path: string[] } | { kind: 'string-value'; node: JsonStringNode; propertyName?: string } | undefined {
  if (cursor < node.from || cursor > node.to) return undefined;
  if (node.type === 'object') {
    for (const property of node.properties) {
      if (cursor >= property.keyNode.from && cursor <= property.keyNode.to) {
        return { kind: 'property-key', property, path: property.valueNode.path };
      }
      const nested = locateJsonContext(property.valueNode, cursor);
      if (nested?.kind === 'string-value' && !nested.propertyName) nested.propertyName = property.key;
      if (nested) return nested;
    }
  }
  if (node.type === 'array') {
    for (const item of node.items) {
      const nested = locateJsonContext(item, cursor);
      if (nested) return nested;
    }
  }
  if (node.type === 'string') return { kind: 'string-value', node };
  return undefined;
}

function findExpressionAtCursor(node: JsonStringNode, cursor: number): FlowExpressionOccurrence | undefined {
  return extractExpressionsFromString(node).find((item) => cursor >= item.from && cursor <= item.to);
}

function extractExpressionsFromString(node: JsonStringNode): FlowExpressionOccurrence[] {
  const results: FlowExpressionOccurrence[] = [];
  const raw = node.value;
  if (!raw.includes('@')) return results;
  if (raw.startsWith('@') && !raw.startsWith('@{')) {
    results.push({ expression: raw.slice(1), from: node.from + 1, to: node.to - 1, hostString: node });
    return results;
  }
  let index = 0;
  while (index < raw.length) {
    const start = raw.indexOf('@{', index);
    if (start < 0) break;
    let depth = 1;
    let cursor = start + 2;
    while (cursor < raw.length && depth > 0) {
      const char = raw[cursor];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      cursor += 1;
    }
    const end = depth === 0 ? cursor - 1 : raw.length;
    results.push({
      expression: raw.slice(start + 2, end),
      from: node.from + 1 + start + 1,
      to: node.from + 1 + end,
      hostString: node,
    });
    index = cursor;
  }
  return results;
}

function extractDefinition(root: JsonObjectNode): { wrapperKind: string; definitionNode?: JsonObjectNode } {
  if (looksLikeWorkflowDefinition(root)) return { wrapperKind: 'raw-definition', definitionNode: root };
  const directDefinition = objectPropertyValue(root, 'definition');
  if (directDefinition?.type === 'object' && looksLikeWorkflowDefinition(directDefinition)) {
    return { wrapperKind: 'definition-wrapper', definitionNode: directDefinition };
  }
  if (directDefinition?.type === 'string') {
    const parsedDefinition = parseEmbeddedJsonObject(directDefinition);
    if (parsedDefinition && looksLikeWorkflowDefinition(parsedDefinition)) {
      return { wrapperKind: 'serialized-definition', definitionNode: parsedDefinition };
    }
  }
  const propertiesNode = objectPropertyValue(root, 'properties');
  if (propertiesNode?.type === 'object') {
    const nestedDefinition = objectPropertyValue(propertiesNode, 'definition');
    if (nestedDefinition?.type === 'object' && looksLikeWorkflowDefinition(nestedDefinition)) {
      return { wrapperKind: 'resource-properties-definition', definitionNode: nestedDefinition };
    }
    if (nestedDefinition?.type === 'string') {
      const parsedDefinition = parseEmbeddedJsonObject(nestedDefinition);
      if (parsedDefinition && looksLikeWorkflowDefinition(parsedDefinition)) {
        return { wrapperKind: 'resource-properties-serialized-definition', definitionNode: parsedDefinition };
      }
    }
  }
  const clientDataNode = objectPropertyValue(root, 'clientdata');
  if (clientDataNode?.type === 'string') {
    const clientData = parseEmbeddedJsonObject(clientDataNode);
    if (clientData) {
      const clientDataDefinition = extractDefinition(clientData);
      if (clientDataDefinition.definitionNode) {
        return { wrapperKind: `clientdata-${clientDataDefinition.wrapperKind}`, definitionNode: clientDataDefinition.definitionNode };
      }
    }
  }
  const resourcesNode = objectPropertyValue(root, 'resources');
  if (resourcesNode?.type === 'array') {
    for (const item of resourcesNode.items) {
      if (item.type !== 'object') continue;
      const resourceProperties = objectPropertyValue(item, 'properties');
      if (resourceProperties?.type !== 'object') continue;
      const resourceDefinition = objectPropertyValue(resourceProperties, 'definition');
      if (resourceDefinition?.type === 'object' && looksLikeWorkflowDefinition(resourceDefinition)) {
        return { wrapperKind: 'arm-template-resource-definition', definitionNode: resourceDefinition };
      }
    }
  }
  return { wrapperKind: 'unknown' };
}

function parseEmbeddedJsonObject(node: JsonStringNode): JsonObjectNode | undefined {
  const parsed = parseJsonDocument(node.value);
  if (!parsed.root) return undefined;
  if (node.valueOffsetMap) remapJsonNode(parsed.root, node.valueOffsetMap);
  else shiftJsonNode(parsed.root, node.from + 1);
  return parsed.root;
}

function looksLikeWorkflowDefinition(node: JsonObjectNode): boolean {
  return objectPropertyValue(node, 'actions')?.type === 'object' || objectPropertyValue(node, 'triggers')?.type === 'object';
}

function objectPropertyValue(node: JsonObjectNode, key: string): JsonNode | undefined {
  return node.properties.find((property) => property.key === key)?.valueNode;
}

function readStringProperty(node: JsonObjectNode, key: string): string | undefined {
  const valueNode = objectPropertyValue(node, key);
  return valueNode?.type === 'string' ? valueNode.value : undefined;
}

function readStringFromFirstObjectPath(node: JsonObjectNode, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = readStringFromObjectPath(node, path);
    if (value) return value;
  }
  return undefined;
}

function readStringFromObjectPath(node: JsonObjectNode, path: string[]): string | undefined {
  let current: JsonNode | undefined = node;
  for (const segment of path) {
    if (current?.type !== 'object') return undefined;
    current = objectPropertyValue(current, segment);
  }
  return current?.type === 'string' ? current.value : undefined;
}

function readRunAfterTargets(actionNode: JsonObjectNode): string[] {
  const runAfterNode = objectPropertyValue(actionNode, 'runAfter');
  if (runAfterNode?.type !== 'object') return [];
  return runAfterNode.properties.map((property) => property.key);
}

function validateRunAfterTargets(actions: FlowActionNode[], diagnostics: FlowRangeDiagnostic[]): void {
  const seen = new Set(actions.map((item) => item.name));
  for (const action of actions) {
    const runAfterNode = objectPropertyValue(action.node, 'runAfter');
    if (runAfterNode?.type === 'object') {
      for (const property of runAfterNode.properties) {
        if (!seen.has(property.key)) {
          diagnostics.push(rangeDiagnostic('error', 'FLOW_RUN_AFTER_TARGET_MISSING', `${action.name} depends on missing action ${property.key}.`, property.keyNode.from, property.keyNode.to));
        }
        const statuses = property.valueNode.type === 'array' ? property.valueNode.items.filter((item): item is JsonStringNode => item.type === 'string').map((item) => item.value) : [];
        for (const status of statuses) {
          if (!RUN_AFTER_STATUSES.includes(status)) {
            diagnostics.push(rangeDiagnostic('warning', 'FLOW_RUN_AFTER_STATUS_UNKNOWN', `${status} is not a standard runAfter status.`, property.valueNode.from, property.valueNode.to));
          }
        }
      }
    }
  }
}

function flattenActions(actions: FlowActionNode[]): FlowActionNode[] {
  return actions.flatMap((action) => [action, ...flattenActions(action.children)]);
}

function walkJson(node: JsonNode, visit: (node: JsonNode) => void): void {
  visit(node);
  if (node.type === 'object') {
    for (const property of node.properties) walkJson(property.valueNode, visit);
  }
  if (node.type === 'array') {
    for (const item of node.items) walkJson(item, visit);
  }
}

function walkObjectProperties(node: JsonNode, visit: (property: JsonObjectProperty) => void): void {
  if (node.type === 'object') {
    for (const property of node.properties) {
      visit(property);
      walkObjectProperties(property.valueNode, visit);
    }
  }
  if (node.type === 'array') {
    for (const item of node.items) walkObjectProperties(item, visit);
  }
}

function shiftJsonNode(node: JsonNode, offset: number): void {
  node.from += offset;
  node.to += offset;
  if (node.type === 'object') {
    for (const property of node.properties) {
      property.from += offset;
      property.to += offset;
      shiftJsonNode(property.keyNode, offset);
      shiftJsonNode(property.valueNode, offset);
    }
  }
  if (node.type === 'array') {
    for (const item of node.items) shiftJsonNode(item, offset);
  }
}

function remapJsonNode(node: JsonNode, offsetMap: number[]): void {
  node.from = remapJsonBoundary(node.from, offsetMap);
  node.to = remapJsonBoundary(node.to, offsetMap);
  if (node.type === 'object') {
    for (const property of node.properties) {
      property.from = remapJsonBoundary(property.from, offsetMap);
      property.to = remapJsonBoundary(property.to, offsetMap);
      remapJsonNode(property.keyNode, offsetMap);
      remapJsonNode(property.valueNode, offsetMap);
    }
  }
  if (node.type === 'array') {
    for (const item of node.items) remapJsonNode(item, offsetMap);
  }
}

function remapJsonBoundary(index: number, offsetMap: number[]): number {
  if (!offsetMap.length) return index;
  if (index <= 0) return offsetMap[0]!;
  if (index < offsetMap.length) return offsetMap[index]!;
  return offsetMap[offsetMap.length - 1]!;
}

function walkExpression(node: ExpressionNode, visit: (node: ExpressionNode) => void): void {
  visit(node);
  if (node.kind === 'call') node.args.forEach((item) => walkExpression(item, visit));
  if (node.kind === 'member') walkExpression(node.object, visit);
  if (node.kind === 'index') {
    walkExpression(node.object, visit);
    walkExpression(node.index, visit);
  }
}

function formatArity(spec: FunctionSpec): string {
  return typeof spec.maxArgs === 'number' && spec.maxArgs === spec.minArgs ? `${spec.minArgs}` : `${spec.minArgs}+`;
}

function rangeDiagnostic(level: Diagnostic['level'], code: string, message: string, from: number, to: number, extra: Partial<FlowRangeDiagnostic> = {}): FlowRangeDiagnostic {
  return { ...createDiagnostic(level, code, message, { source: 'pp/flow-language' }), from, to, ...extra };
}

function parseJsonDocument(source: string): { root?: JsonObjectNode; diagnostics: FlowRangeDiagnostic[] } {
  const parser = new JsonParser(source);
  const diagnostics: FlowRangeDiagnostic[] = [];
  try {
    const value = parser.parseValue([]);
    parser.skipWhitespace();
    if (parser.index < source.length) {
      diagnostics.push(rangeDiagnostic('error', 'FLOW_JSON_TRAILING_CONTENT', 'Unexpected content after valid JSON value.', parser.index, source.length));
    }
    if (value.type !== 'object') {
      diagnostics.push(rangeDiagnostic('error', 'FLOW_JSON_ROOT_OBJECT_REQUIRED', 'Flow file must contain a JSON object at the root.', value.from, value.to));
      return { diagnostics };
    }
    return { root: value, diagnostics };
  } catch (error) {
    const failure = error as JsonParseFailure;
    diagnostics.push(rangeDiagnostic('error', failure.code ?? 'FLOW_JSON_INVALID', failure.message, failure.from, failure.to));
    return { diagnostics };
  }
}

class JsonParseFailure extends Error {
  code?: string;
  from: number;
  to: number;

  constructor(message: string, from: number, to: number, code?: string) {
    super(message);
    this.from = from;
    this.to = to;
    this.code = code;
  }
}

class JsonParser {
  readonly source: string;
  index = 0;

  constructor(source: string) {
    this.source = source;
  }

  skipWhitespace(): void {
    while (this.index < this.source.length && /\s/.test(this.source[this.index]!)) this.index += 1;
  }

  parseValue(path: string[]): JsonNode {
    this.skipWhitespace();
    const start = this.index;
    const char = this.source[this.index];
    if (char === '{') return this.parseObject(path);
    if (char === '[') return this.parseArray(path);
    if (char === '"') return this.parseString(path);
    if (char === '-' || /\d/.test(char ?? '')) return this.parseNumber(path);
    if (this.source.startsWith('true', this.index)) return this.parseKeyword('true', true, path);
    if (this.source.startsWith('false', this.index)) return this.parseKeyword('false', false, path);
    if (this.source.startsWith('null', this.index)) return this.parseKeyword('null', null, path);
    throw new JsonParseFailure('Invalid JSON value.', start, Math.min(this.source.length, start + 1), 'FLOW_JSON_INVALID');
  }

  parseObject(path: string[]): JsonObjectNode {
    const start = this.index;
    this.index += 1;
    const properties: JsonObjectProperty[] = [];
    const value: Record<string, unknown> = {};
    this.skipWhitespace();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return { type: 'object', from: start, to: this.index, properties, value, path };
    }
    while (this.index < this.source.length) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') throw new JsonParseFailure('Expected a JSON object key.', this.index, this.index + 1, 'FLOW_JSON_OBJECT_KEY_REQUIRED');
      const keyNode = this.parseString(path.concat(['<key>']));
      this.skipWhitespace();
      if (this.source[this.index] !== ':') throw new JsonParseFailure('Expected ":" after object key.', this.index, this.index + 1, 'FLOW_JSON_COLON_REQUIRED');
      const propertyStart = keyNode.from;
      this.index += 1;
      const valueNode = this.parseValue(path.concat([keyNode.value]));
      properties.push({ key: keyNode.value, keyNode, valueNode, from: propertyStart, to: valueNode.to });
      value[keyNode.value] = valueNode.value;
      this.skipWhitespace();
      if (this.source[this.index] === '}') {
        this.index += 1;
        return { type: 'object', from: start, to: this.index, properties, value, path };
      }
      if (this.source[this.index] !== ',') throw new JsonParseFailure('Expected "," between object properties.', this.index, this.index + 1, 'FLOW_JSON_COMMA_REQUIRED');
      this.index += 1;
    }
    throw new JsonParseFailure('Unterminated JSON object.', start, this.source.length, 'FLOW_JSON_OBJECT_UNTERMINATED');
  }

  parseArray(path: string[]): JsonArrayNode {
    const start = this.index;
    this.index += 1;
    const items: JsonNode[] = [];
    const value: unknown[] = [];
    this.skipWhitespace();
    if (this.source[this.index] === ']') {
      this.index += 1;
      return { type: 'array', from: start, to: this.index, items, value, path };
    }
    let itemIndex = 0;
    while (this.index < this.source.length) {
      const item = this.parseValue(path.concat([String(itemIndex)]));
      items.push(item);
      value.push(item.value);
      itemIndex += 1;
      this.skipWhitespace();
      if (this.source[this.index] === ']') {
        this.index += 1;
        return { type: 'array', from: start, to: this.index, items, value, path };
      }
      if (this.source[this.index] !== ',') throw new JsonParseFailure('Expected "," between array items.', this.index, this.index + 1, 'FLOW_JSON_COMMA_REQUIRED');
      this.index += 1;
    }
    throw new JsonParseFailure('Unterminated JSON array.', start, this.source.length, 'FLOW_JSON_ARRAY_UNTERMINATED');
  }

  parseString(path: string[]): JsonStringNode {
    const start = this.index;
    let value = '';
    const valueOffsetMap: number[] = [];
    const appendValue = (text: string, rawStart: number, rawEnd: number) => {
      if (!valueOffsetMap.length) valueOffsetMap.push(rawStart);
      for (let i = 0; i < text.length; i += 1) {
        value += text[i]!;
        valueOffsetMap.push(i === text.length - 1 ? rawEnd : rawStart + i + 1);
      }
    };
    this.index += 1;
    while (this.index < this.source.length) {
      const char = this.source[this.index]!;
      if (char === '"') {
        this.index += 1;
        if (!valueOffsetMap.length) valueOffsetMap.push(start + 1);
        return { type: 'string', from: start, to: this.index, value, valueOffsetMap, path };
      }
      if (char === '\\') {
        const rawStart = this.index;
        const next = this.source[this.index + 1];
        if (next === '"' || next === '\\' || next === '/') appendValue(next, rawStart, rawStart + 2);
        else if (next === 'b') appendValue('\b', rawStart, rawStart + 2);
        else if (next === 'f') appendValue('\f', rawStart, rawStart + 2);
        else if (next === 'n') appendValue('\n', rawStart, rawStart + 2);
        else if (next === 'r') appendValue('\r', rawStart, rawStart + 2);
        else if (next === 't') appendValue('\t', rawStart, rawStart + 2);
        else if (next === 'u') {
          const hex = this.source.slice(this.index + 2, this.index + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JsonParseFailure('Invalid unicode escape in string.', this.index, this.index + 6, 'FLOW_JSON_STRING_ESCAPE_INVALID');
          appendValue(String.fromCharCode(Number.parseInt(hex, 16)), rawStart, rawStart + 6);
          this.index += 4;
        } else {
          throw new JsonParseFailure('Invalid string escape sequence.', this.index, this.index + 2, 'FLOW_JSON_STRING_ESCAPE_INVALID');
        }
        this.index += 2;
        continue;
      }
      appendValue(char, this.index, this.index + 1);
      this.index += 1;
    }
    throw new JsonParseFailure('Unterminated JSON string.', start, this.source.length, 'FLOW_JSON_STRING_UNTERMINATED');
  }

  parseNumber(path: string[]): JsonPrimitiveNode {
    const start = this.index;
    const match = this.source.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new JsonParseFailure('Invalid number literal.', start, start + 1, 'FLOW_JSON_NUMBER_INVALID');
    this.index += match[0].length;
    return { type: 'number', from: start, to: this.index, value: Number(match[0]), path };
  }

  parseKeyword(keyword: 'true' | 'false' | 'null', value: JsonPrimitive, path: string[]): JsonPrimitiveNode {
    const start = this.index;
    this.index += keyword.length;
    return { type: keyword === 'null' ? 'null' : 'boolean', from: start, to: this.index, value, path };
  }
}

function parseExpression(source: string, offset = 0): ExpressionParseResult {
  const tokenizer = new ExpressionTokenizer(source, offset);
  const parser = new ExpressionParser(tokenizer.tokens);
  return parser.parse();
}

class ExpressionTokenizer {
  readonly tokens: ExpressionToken[] = [];
  private readonly source: string;
  private readonly offset: number;
  private index = 0;

  constructor(source: string, offset: number) {
    this.source = source;
    this.offset = offset;
    this.tokenize();
  }

  private tokenize(): void {
    while (this.index < this.source.length) {
      const char = this.source[this.index]!;
      if (/\s/.test(char)) {
        this.index += 1;
        continue;
      }
      const from = this.offset + this.index;
      if (/[A-Za-z_]/.test(char)) {
        const match = this.source.slice(this.index).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
        const value = match[0];
        this.index += value.length;
        if (value === 'true' || value === 'false') this.tokens.push({ type: 'boolean', value, from, to: from + value.length });
        else if (value === 'null') this.tokens.push({ type: 'null', value, from, to: from + value.length });
        else this.tokens.push({ type: 'identifier', value, from, to: from + value.length });
        continue;
      }
      if (char === '\'') {
        const token = this.readString();
        this.tokens.push(token);
        continue;
      }
      if (char === '-' || /\d/.test(char)) {
        const match = this.source.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?/)!;
        const value = match[0];
        this.index += value.length;
        this.tokens.push({ type: 'number', value, from, to: from + value.length });
        continue;
      }
      if (char === '(') this.tokens.push({ type: 'paren-open', value: char, from, to: from + 1 });
      else if (char === ')') this.tokens.push({ type: 'paren-close', value: char, from, to: from + 1 });
      else if (char === ',') this.tokens.push({ type: 'comma', value: char, from, to: from + 1 });
      else if (char === '.') this.tokens.push({ type: 'dot', value: char, from, to: from + 1 });
      else if (char === '[') this.tokens.push({ type: 'bracket-open', value: char, from, to: from + 1 });
      else if (char === ']') this.tokens.push({ type: 'bracket-close', value: char, from, to: from + 1 });
      else if (char === '?') this.tokens.push({ type: 'question', value: char, from, to: from + 1 });
      this.index += 1;
    }
    this.tokens.push({ type: 'eof', value: '', from: this.offset + this.source.length, to: this.offset + this.source.length });
  }

  private readString(): ExpressionToken {
    const start = this.index;
    this.index += 1;
    let value = '';
    while (this.index < this.source.length) {
      const char = this.source[this.index]!;
      if (char === '\'') {
        if (this.source[this.index + 1] === '\'') {
          value += '\'';
          this.index += 2;
          continue;
        }
        this.index += 1;
        return { type: 'string', value, from: this.offset + start, to: this.offset + this.index };
      }
      value += char;
      this.index += 1;
    }
    return { type: 'string', value, from: this.offset + start, to: this.offset + this.index };
  }
}

class ExpressionParser {
  private readonly tokens: ExpressionToken[];
  private index = 0;

  constructor(tokens: ExpressionToken[]) {
    this.tokens = tokens;
  }

  parse(): ExpressionParseResult {
    const diagnostics: FlowRangeDiagnostic[] = [];
    try {
      const root = this.parseExpression();
      return { root, diagnostics };
    } catch (error) {
      const failure = error as JsonParseFailure;
      diagnostics.push(rangeDiagnostic('error', failure.code ?? 'FLOW_EXPR_SYNTAX_INVALID', failure.message, failure.from, failure.to));
      return { diagnostics };
    }
  }

  private parseExpression(): ExpressionNode {
    return this.parseMember();
  }

  private parseMember(): ExpressionNode {
    let node = this.parsePrimary();
    while (true) {
      const token = this.peek();
      if (token.type === 'question') {
        this.advance();
        continue;
      }
      if (token.type === 'dot') {
        this.advance();
        const property = this.expect('identifier');
        node = { kind: 'member', object: node, property: property.value, from: node.from, to: property.to };
        continue;
      }
      if (token.type === 'bracket-open') {
        const from = node.from;
        this.advance();
        const index = this.parseExpression();
        this.expect('bracket-close');
        node = { kind: 'index', object: node, index, from, to: index.to };
        continue;
      }
      break;
    }
    return node;
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();
    if (token.type === 'identifier') {
      this.advance();
      if (this.peek().type === 'paren-open') {
        this.advance();
        const args: ExpressionNode[] = [];
        if (this.peek().type !== 'paren-close') {
          while (true) {
            args.push(this.parseExpression());
            if (this.peek().type === 'comma') {
              this.advance();
              continue;
            }
            break;
          }
        }
        const close = this.expect('paren-close');
        return { kind: 'call', name: token.value, args, from: token.from, to: close.to };
      }
      return { kind: 'identifier', name: token.value, from: token.from, to: token.to };
    }
    if (token.type === 'string') {
      this.advance();
      return { kind: 'string', value: token.value, from: token.from, to: token.to };
    }
    if (token.type === 'number') {
      this.advance();
      return { kind: 'number', value: Number(token.value), from: token.from, to: token.to };
    }
    if (token.type === 'boolean') {
      this.advance();
      return { kind: 'boolean', value: token.value === 'true', from: token.from, to: token.to };
    }
    if (token.type === 'null') {
      this.advance();
      return { kind: 'null', value: null, from: token.from, to: token.to };
    }
    if (token.type === 'paren-open') {
      this.advance();
      const expression = this.parseExpression();
      this.expect('paren-close');
      return expression;
    }
    throw new JsonParseFailure('Invalid expression syntax.', token.from, token.to, 'FLOW_EXPR_SYNTAX_INVALID');
  }

  private expect(type: ExpressionToken['type']): ExpressionToken {
    const token = this.peek();
    if (token.type !== type) throw new JsonParseFailure(`Expected ${type} in expression.`, token.from, token.to, 'FLOW_EXPR_SYNTAX_INVALID');
    return this.advance();
  }

  private peek(): ExpressionToken {
    return this.tokens[this.index]!;
  }

  private advance(): ExpressionToken {
    return this.tokens[this.index++]!;
  }
}
