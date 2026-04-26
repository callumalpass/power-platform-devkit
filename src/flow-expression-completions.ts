import { findDeepestFlowExpressionNodeEndingAt, flowExpressionAccessSegments, flowExpressionNodeText, parseFlowExpression, type FlowExpressionNode } from './flow-expression-parser.js';

export interface FlowCompletionItem {
  label: string;
  type: 'property' | 'value' | 'function' | 'action' | 'variable' | 'parameter' | 'keyword';
  detail?: string;
  info?: string;
  apply?: string;
  snippet?: boolean;
  boost?: number;
}

export interface FlowExpressionAction {
  name: string;
  type?: string;
}

export interface FlowExpressionVariable {
  name: string;
  type?: string;
  declaredBy?: string;
}

export interface FlowExpressionParameter {
  name: string;
  type?: string;
}

export interface FlowExpressionCompletionSources {
  actions: FlowExpressionAction[];
  triggers: FlowExpressionAction[];
  variables: FlowExpressionVariable[];
  parameters: FlowExpressionParameter[];
}

export type FlowExpressionCompletionContextKind = 'function' | 'target-name' | 'accessor';

export interface FlowExpressionCompletionContext {
  kind: FlowExpressionCompletionContextKind;
  text: string;
  relativeCursor: number;
  replaceFrom: number;
  expressionFrom: number;
  prefix: string;
  targetName?: {
    functionName: string;
    prefix: string;
  };
  accessor?: {
    baseExpression: string;
    expression?: FlowExpressionNode;
    prefix: string;
    segments: string[];
    optional: boolean;
  };
}

export interface FlowExpressionSegmentCompletionContext {
  kind: FlowExpressionCompletionContextKind;
  replaceFrom: number;
  prefix: string;
  targetName?: {
    functionName: string;
    prefix: string;
  };
  accessor?: {
    baseExpression: string;
    expression?: FlowExpressionNode;
    prefix: string;
    segments: string[];
    optional: boolean;
  };
}

export function completeExpression(text: string, relativeCursor: number, sources: FlowExpressionCompletionSources): FlowCompletionItem[] {
  const context = findFlowExpressionSegmentCompletionContext(text, relativeCursor);
  if (!context) return [];
  if (context.kind === 'target-name' && context.targetName) {
    return filterCompletionPrefix(targetNameCompletions(context.targetName.functionName, sources.actions, sources.variables, sources.parameters), context.targetName.prefix);
  }
  if (context.kind === 'accessor') return [];
  return filterCompletionPrefix(expressionFunctionCompletions(sources.actions, sources.triggers, sources.variables, sources.parameters), context.prefix);
}

export function findFlowExpressionCompletionContext(source: string, cursor: number, options: { windowSize?: number; stopAtDoubleQuote?: boolean } = {}): FlowExpressionCompletionContext | null {
  const safeCursor = Math.min(source.length, Math.max(0, cursor));
  const windowStart = Math.max(0, safeCursor - (options.windowSize ?? 240));
  const before = source.slice(windowStart, safeCursor);
  const expressionStart = before.lastIndexOf('@');
  if (expressionStart < 0) return null;

  const expressionOffset = before.startsWith('@{', expressionStart) ? 2 : 1;
  const expressionFrom = windowStart + expressionStart + expressionOffset;
  if (expressionFrom > safeCursor) return null;

  const expressionBefore = source.slice(expressionFrom, safeCursor);
  if (options.stopAtDoubleQuote && expressionBefore.includes('"')) return null;

  const segment = findFlowExpressionSegmentCompletionContext(expressionBefore, expressionBefore.length);
  if (!segment) return null;
  return {
    kind: segment.kind,
    text: expressionBefore,
    relativeCursor: expressionBefore.length,
    replaceFrom: expressionFrom + segment.replaceFrom,
    expressionFrom,
    prefix: segment.prefix,
    targetName: segment.targetName,
    accessor: segment.accessor
  };
}

export function findFlowExpressionSegmentCompletionContext(text: string, relativeCursor = text.length): FlowExpressionSegmentCompletionContext | null {
  const safeCursor = Math.min(text.length, Math.max(0, relativeCursor));
  const before = text.slice(0, safeCursor);
  const accessorContext = readAccessorCompletionContext(before);
  if (accessorContext) {
    return {
      kind: 'accessor',
      replaceFrom: accessorContext.quoteStart + 1,
      prefix: accessorContext.prefix,
      accessor: {
        baseExpression: accessorContext.baseExpression,
        expression: accessorContext.expression,
        prefix: accessorContext.prefix,
        segments: accessorContext.segments,
        optional: accessorContext.optional
      }
    };
  }

  const targetContext = readTargetNameCompletionContext(before);
  if (targetContext) {
    return {
      kind: 'target-name',
      replaceFrom: targetContext.quoteStart + 1,
      prefix: targetContext.prefix,
      targetName: {
        functionName: targetContext.functionName,
        prefix: targetContext.prefix
      }
    };
  }

  if (isInsideExpressionString(before)) return null;
  const functionPrefix = expressionFunctionPrefix(before);
  if (functionPrefix === undefined) return null;
  return {
    kind: 'function',
    replaceFrom: before.length - functionPrefix.length,
    prefix: functionPrefix
  };
}

function readAccessorCompletionContext(before: string):
  | {
      baseExpression: string;
      expression?: FlowExpressionNode;
      prefix: string;
      quoteStart: number;
      segments: string[];
      optional: boolean;
    }
  | undefined {
  const quoteStart = findCurrentWdlStringStart(before);
  if (quoteStart < 0) return undefined;
  const beforeQuote = before.slice(0, quoteStart);
  const bracketMatch = beforeQuote.match(/\s*(\?\s*)?\[\s*$/);
  if (!bracketMatch || bracketMatch.index === undefined) return undefined;
  const baseSource = beforeQuote.slice(0, bracketMatch.index);
  const baseEnd = trimEndIndex(baseSource);
  if (baseEnd <= 0) return undefined;
  const parsed = parseFlowExpression(baseSource.slice(0, baseEnd));
  const expression = findDeepestFlowExpressionNodeEndingAt(parsed, baseEnd);
  const baseExpression = expression ? flowExpressionNodeText(baseSource, expression) : baseSource.slice(0, baseEnd).trim();
  if (!baseExpression) return undefined;
  return {
    baseExpression,
    expression: expression ?? undefined,
    prefix: before.slice(quoteStart + 1).replace(/''/g, "'"),
    quoteStart,
    segments: expression ? flowExpressionAccessSegments(expression) : readAccessorSegments(baseExpression),
    optional: Boolean(bracketMatch[1])
  };
}

function readAccessorSegments(value: string): string[] {
  const segments: string[] = [];
  const regex = /\??\[\s*'((?:''|[^'])*)'\s*\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value))) {
    segments.push((match[1] || '').replace(/''/g, "'"));
  }
  return segments;
}

function readTargetNameCompletionContext(before: string): { functionName: string; prefix: string; quoteStart: number } | undefined {
  const quoteStart = findCurrentWdlStringStart(before);
  if (quoteStart < 0) return undefined;
  const beforeQuote = before.slice(0, quoteStart);
  const expressionEnd = trimEndIndex(beforeQuote);
  const parsed = parseFlowExpression(beforeQuote.slice(0, expressionEnd));
  const node = findDeepestFlowExpressionNodeEndingAt(parsed, expressionEnd);
  const functionName = node?.kind === 'call' && node.args.length === 0 ? node.name.toLowerCase() : undefined;
  if (!functionName || !['actions', 'body', 'outputs', 'items', 'variables', 'parameters', 'result'].includes(functionName)) return undefined;
  return {
    functionName,
    prefix: before.slice(quoteStart + 1).replace(/''/g, "'"),
    quoteStart
  };
}

function trimEndIndex(value: string): number {
  let index = value.length;
  while (index > 0 && /\s/.test(value[index - 1]!)) index -= 1;
  return index;
}

function findCurrentWdlStringStart(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== "'") continue;
    if (index > 0 && value[index - 1] === "'") {
      index -= 1;
      continue;
    }
    return index;
  }
  return -1;
}

function targetNameCompletions(functionName: string | undefined, actions: FlowExpressionAction[], variables: FlowExpressionVariable[], parameters: FlowExpressionParameter[]): FlowCompletionItem[] {
  if (functionName === 'variables') {
    return variables.map((item) => ({
      label: item.name,
      type: 'variable',
      detail: item.type,
      info: item.declaredBy ? `Declared by ${item.declaredBy}.` : undefined,
      apply: escapeWdlStringValue(item.name)
    }));
  }
  if (functionName === 'parameters') {
    return parameters.map((item) => ({
      label: item.name,
      type: 'parameter',
      detail: item.type,
      apply: escapeWdlStringValue(item.name)
    }));
  }
  if (functionName === 'items') {
    return loopActions(actions).map((item) => ({
      label: item.name,
      type: 'action',
      detail: item.type,
      info: 'Loop item source.',
      apply: escapeWdlStringValue(item.name)
    }));
  }
  if (functionName === 'result') {
    return scopedResultActions(actions).map((item) => ({
      label: item.name,
      type: 'action',
      detail: item.type,
      info: 'Scoped action result source.',
      apply: escapeWdlStringValue(item.name)
    }));
  }
  return actions.map((item) => ({
    label: item.name,
    type: 'action',
    detail: item.type,
    apply: escapeWdlStringValue(item.name)
  }));
}

function expressionFunctionCompletions(
  actions: FlowExpressionAction[],
  triggers: FlowExpressionAction[],
  variables: FlowExpressionVariable[],
  parameters: FlowExpressionParameter[]
): FlowCompletionItem[] {
  const actionChoice = expressionChoice(
    actions.map((item) => item.name),
    'Action'
  );
  const loopChoice = expressionChoice(
    loopActions(actions).map((item) => item.name),
    'Loop'
  );
  const scopedChoice = expressionChoice(
    scopedResultActions(actions).map((item) => item.name),
    'Scope'
  );
  const variableChoice = expressionChoice(
    variables.map((item) => item.name),
    'variableName'
  );
  const parameterChoice = expressionChoice(
    parameters.map((item) => item.name),
    'parameterName'
  );
  const triggerChoice = expressionChoice(
    triggers.map((item) => item.name),
    'triggerName'
  );
  return [
    ...dynamicContentCompletions(actions, variables, parameters),
    expressionSnippet('triggerBody()', 'triggerBody()', 'Trigger body', 'Return the trigger body.'),
    expressionSnippet('triggerOutputs()', 'triggerOutputs()', 'Trigger outputs', 'Return the trigger outputs.'),
    expressionSnippet('trigger()', 'trigger()', 'Trigger object', 'Return the trigger object.'),
    expressionSnippet('workflow()', 'workflow()', 'Workflow object', 'Return workflow and run metadata.'),
    expressionSnippet('outputs()', `outputs('${actionChoice}')`, 'Action outputs', 'Return an action output object.'),
    expressionSnippet('body()', `body('${actionChoice}')`, 'Action body', 'Return an action body.'),
    expressionSnippet('actions()', `actions('${actionChoice}')`, 'Action object', 'Return an action runtime object.'),
    expressionSnippet('items()', `items('${loopChoice}')`, 'Loop item', 'Return the current item for a named loop.'),
    expressionSnippet('item()', 'item()', 'Current item', 'Return the current item in the nearest repeating action.'),
    expressionSnippet('variables()', `variables('${variableChoice}')`, 'Variable value', 'Return an initialized variable value.'),
    expressionSnippet('parameters()', `parameters('${parameterChoice}')`, 'Parameter value', 'Return a workflow parameter value.'),
    expressionSnippet('result()', `result('${scopedChoice}')`, 'Scoped action result', 'Return child action results from a scope or loop.'),
    expressionSnippet('triggerFormDataValue()', "triggerFormDataValue('${1:key}')", 'Trigger form data value', 'Return one trigger form-data value.'),
    expressionSnippet('triggerFormDataMultiValues()', "triggerFormDataMultiValues('${1:key}')", 'Trigger form data values', 'Return trigger form-data values.'),
    expressionSnippet('listCallbackUrl()', `listCallbackUrl('${triggerChoice}')`, 'Callback URL', 'Return a callback URL for a trigger or action.'),
    expressionSnippet('concat()', 'concat(${1:value}, ${2:value})', 'String or array concat', 'Combine strings or arrays.'),
    expressionSnippet('coalesce()', 'coalesce(${1:value}, ${2:fallback})', 'First non-null value', 'Return the first non-null value.'),
    expressionSnippet('empty()', 'empty(${1:value})', 'Empty check', 'Check whether a value is empty.'),
    expressionSnippet('equals()', 'equals(${1:left}, ${2:right})', 'Equality check', 'Compare two values.'),
    expressionSnippet('if()', 'if(${1:condition}, ${2:trueValue}, ${3:falseValue})', 'Conditional value', 'Return one of two values.'),
    expressionSnippet('contains()', 'contains(${1:collection}, ${2:value})', 'Contains check', 'Check whether a collection contains a value.'),
    expressionSnippet('startsWith()', 'startsWith(${1:text}, ${2:prefix})', 'Starts with', 'Check whether text starts with a prefix.'),
    expressionSnippet('endsWith()', 'endsWith(${1:text}, ${2:suffix})', 'Ends with', 'Check whether text ends with a suffix.'),
    expressionSnippet('length()', 'length(${1:value})', 'Length', 'Return string or array length.'),
    expressionSnippet('first()', 'first(${1:collection})', 'First item', 'Return the first item from a string or array.'),
    expressionSnippet('last()', 'last(${1:collection})', 'Last item', 'Return the last item from a string or array.'),
    expressionSnippet('take()', 'take(${1:collection}, ${2:count})', 'Take items', 'Return the first items from a collection.'),
    expressionSnippet('skip()', 'skip(${1:collection}, ${2:count})', 'Skip items from the start of a collection.'),
    expressionSnippet('split()', 'split(${1:text}, ${2:separator})', 'Split text', 'Split text into an array.'),
    expressionSnippet('join()', 'join(${1:array}, ${2:separator})', 'Join array', 'Join array values into text.'),
    expressionSnippet('createArray()', 'createArray(${1:value})', 'Create array', 'Create an array from values.'),
    expressionSnippet('union()', 'union(${1:collection}, ${2:collection})', 'Union', 'Return unique values from collections.'),
    expressionSnippet('intersection()', 'intersection(${1:collection}, ${2:collection})', 'Intersection', 'Return shared values from collections.'),
    expressionSnippet('json()', 'json(${1:value})', 'Parse JSON', 'Return a JSON value from a string or XML.'),
    expressionSnippet('string()', 'string(${1:value})', 'String', 'Convert a value to text.'),
    expressionSnippet('int()', 'int(${1:value})', 'Integer', 'Convert a value to an integer.'),
    expressionSnippet('float()', 'float(${1:value})', 'Float', 'Convert a value to a floating-point number.'),
    expressionSnippet('bool()', 'bool(${1:value})', 'Boolean', 'Convert a value to a boolean.'),
    expressionSnippet('add()', 'add(${1:left}, ${2:right})', 'Add', 'Add two numbers.'),
    expressionSnippet('sub()', 'sub(${1:left}, ${2:right})', 'Subtract', 'Subtract two numbers.'),
    expressionSnippet('mul()', 'mul(${1:left}, ${2:right})', 'Multiply', 'Multiply two numbers.'),
    expressionSnippet('div()', 'div(${1:left}, ${2:right})', 'Divide', 'Divide two numbers.'),
    expressionSnippet('mod()', 'mod(${1:left}, ${2:right})', 'Modulo', 'Return the remainder after division.'),
    expressionSnippet('greater()', 'greater(${1:left}, ${2:right})', 'Greater than', 'Compare two values.'),
    expressionSnippet('greaterOrEquals()', 'greaterOrEquals(${1:left}, ${2:right})', 'Greater or equal', 'Compare two values.'),
    expressionSnippet('less()', 'less(${1:left}, ${2:right})', 'Less than', 'Compare two values.'),
    expressionSnippet('lessOrEquals()', 'lessOrEquals(${1:left}, ${2:right})', 'Less or equal', 'Compare two values.'),
    expressionSnippet('and()', 'and(${1:condition}, ${2:condition})', 'And', 'Return true when all conditions are true.'),
    expressionSnippet('or()', 'or(${1:condition}, ${2:condition})', 'Or', 'Return true when any condition is true.'),
    expressionSnippet('not()', 'not(${1:condition})', 'Not', 'Invert a boolean condition.'),
    expressionSnippet('utcNow()', 'utcNow()', 'Current UTC time', 'Return the current UTC timestamp.'),
    expressionSnippet('formatDateTime()', 'formatDateTime(${1:timestamp}, ${2:format})', 'Format timestamp', 'Format a timestamp.'),
    expressionSnippet('addDays()', 'addDays(${1:timestamp}, ${2:days})', 'Add days', 'Add days to a timestamp.'),
    expressionSnippet('addHours()', 'addHours(${1:timestamp}, ${2:hours})', 'Add hours', 'Add hours to a timestamp.'),
    expressionSnippet('addMinutes()', 'addMinutes(${1:timestamp}, ${2:minutes})', 'Add minutes', 'Add minutes to a timestamp.'),
    expressionSnippet('formatNumber()', 'formatNumber(${1:number}, ${2:format})', 'Format number', 'Format a number.')
  ];
}

function dynamicContentCompletions(actions: FlowExpressionAction[], variables: FlowExpressionVariable[], parameters: FlowExpressionParameter[]): FlowCompletionItem[] {
  return [
    ...actions.flatMap((action) => [
      expressionReferenceSnippet(`outputs('${action.name}')`, `outputs('${escapeWdlStringValue(action.name)}')`, 'Action outputs', action.type),
      expressionReferenceSnippet(`body('${action.name}')`, `body('${escapeWdlStringValue(action.name)}')`, 'Action body', action.type)
    ]),
    ...loopActions(actions).map((action) => expressionReferenceSnippet(`items('${action.name}')`, `items('${escapeWdlStringValue(action.name)}')`, 'Loop item', action.type)),
    ...scopedResultActions(actions).map((action) => expressionReferenceSnippet(`result('${action.name}')`, `result('${escapeWdlStringValue(action.name)}')`, 'Scoped result', action.type)),
    ...variables.map((variable) => expressionReferenceSnippet(`variables('${variable.name}')`, `variables('${escapeWdlStringValue(variable.name)}')`, 'Variable value', variable.type)),
    ...parameters.map((parameter) => expressionReferenceSnippet(`parameters('${parameter.name}')`, `parameters('${escapeWdlStringValue(parameter.name)}')`, 'Parameter value', parameter.type))
  ];
}

function expressionReferenceSnippet(label: string, apply: string, detail: string, info?: string): FlowCompletionItem {
  return {
    label,
    type: 'keyword',
    detail,
    info,
    apply,
    snippet: false,
    boost: -1
  };
}

function expressionSnippet(label: string, apply: string, detail: string, info?: string): FlowCompletionItem {
  return {
    label,
    type: 'function',
    detail,
    info,
    apply,
    snippet: true
  };
}

function expressionFunctionPrefix(before: string): string | undefined {
  const match = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  const prefix = match?.[0] ?? '';
  const prefixStart = before.length - prefix.length;
  const previous = before[prefixStart - 1];
  if (!prefix && before.length && !/[({[,\s@?:+\-*/]/.test(before[before.length - 1]!)) return undefined;
  if (previous && !/[({[,\s@?:+\-*/]/.test(previous)) return undefined;
  return prefix;
}

function isInsideExpressionString(before: string): boolean {
  let inString = false;
  for (let index = 0; index < before.length; index += 1) {
    const char = before[index];
    if (char !== "'") continue;
    if (inString && before[index + 1] === "'") {
      index += 1;
      continue;
    }
    inString = !inString;
  }
  return inString;
}

function loopActions(actions: FlowExpressionAction[]): FlowExpressionAction[] {
  return actions.filter((item) => {
    const normalized = (item.type || '').toLowerCase();
    return normalized.includes('foreach') || normalized === 'until';
  });
}

function scopedResultActions(actions: FlowExpressionAction[]): FlowExpressionAction[] {
  return actions.filter((item) => {
    const normalized = (item.type || '').toLowerCase();
    return normalized === 'scope' || normalized.includes('foreach') || normalized === 'until';
  });
}

function expressionChoice(values: string[], fallback: string): string {
  const choices = values
    .filter((item) => item.trim())
    .slice(0, 40)
    .map((item) => escapeSnippetChoiceValue(escapeWdlStringValue(item)));
  if (!choices.length) return `\${1:${fallback}}`;
  return `\${1|${choices.join(',')}|}`;
}

function escapeWdlStringValue(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeSnippetChoiceValue(value: string): string {
  return value.replace(/[\\,|}$]/g, (char) => `\\${char}`);
}

function filterCompletionPrefix<T extends FlowCompletionItem>(items: T[], prefix: string): T[] {
  const normalized = prefix.toLowerCase();
  const filtered = normalized ? items.filter((item) => item.label.toLowerCase().includes(normalized)) : items;
  return filtered.sort((a, b) => scoreCompletion(a, normalized) - scoreCompletion(b, normalized)).slice(0, 80);
}

function scoreCompletion(item: FlowCompletionItem, prefix: string): number {
  const boost = item.boost ?? 0;
  if (!prefix) return boost;
  const label = item.label.toLowerCase();
  if (label.startsWith(prefix)) return boost;
  const index = label.indexOf(prefix);
  return index >= 0 ? index + 5 + boost : 1000 + boost;
}
