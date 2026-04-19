import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFlow, completeFlowExpression, type FlowCompletionItem } from '../src/flow-language.js';
import { findFlowExpressionCompletionContext } from '../src/flow-expression-completions.js';
import {
  buildFlowOperationSearchBody,
  normalizeFlowApiOperationSchema,
} from '../src/ui-react/automate-data.js';
import { FLOW_SNIPPETS, type FlowCodeSnippet } from '../src/ui-react/automate/flow-code-snippets.js';
import {
  buildBuiltInAction,
} from '../src/ui-react/automate/flow-built-in-templates.js';
import {
  buildFlowEditorSchemaIndex,
  collectFlowEditorSchemaTargets,
  flowEditorExpressionSchemaCompletionItems,
  flowEditorSchemaCompletionItems,
  type FlowEditorSchemaActionEntry,
} from '../src/ui-react/automate/flow-editor-schema-index.js';
import { flowEditorConnectionCompletionItems } from '../src/ui-react/automate/flow-editor-connection-completions.js';
import { fieldSchemaKey, visibleConnectorSchemaFields } from '../src/ui-react/automate/flow-dynamic-schema.js';
import { buildFlowConnectionModel, type FlowEnvironmentConnection } from '../src/ui-react/automate/flow-connections.js';
import type { FlowApiOperation, FlowApiOperationSchemaField } from '../src/ui-react/ui-types.js';

type SnippetExpectation = {
  label: string;
  defaultName: string;
  operationName: string;
  operationType: string;
};

const ACTION_SNIPPET_EXPECTATIONS: SnippetExpectation[] = [
  { label: 'pa:compose action', defaultName: 'Compose', operationName: 'Compose', operationType: 'Compose' },
  { label: 'pa:condition action', defaultName: 'Condition', operationName: 'Condition', operationType: 'Condition' },
  { label: 'pa:scope action', defaultName: 'Scope', operationName: 'Scope', operationType: 'Scope' },
  { label: 'pa:foreach action', defaultName: 'Apply_to_each', operationName: 'Foreach', operationType: 'Foreach' },
  { label: 'pa:http action', defaultName: 'HTTP', operationName: 'Http', operationType: 'Http' },
  { label: 'pa:initialize variable', defaultName: 'Initialize_variable', operationName: 'InitializeVariable', operationType: 'InitializeVariable' },
  { label: 'pa:set variable', defaultName: 'Set_variable', operationName: 'SetVariable', operationType: 'SetVariable' },
];

const RICH_COMPLETION_FLOW = JSON.stringify({
  definition: {
    parameters: {
      targetValue: { type: 'String' },
      threshold: { type: 'Int' },
    },
    triggers: {
      manual: {
        type: 'Request',
        inputs: {},
      },
      Recurrence: {
        type: 'Recurrence',
        recurrence: {
          frequency: 'Day',
          interval: 1,
        },
      },
    },
    actions: {
      InitCounter: {
        type: 'InitializeVariable',
        inputs: {
          variables: [
            {
              name: 'counter',
              type: 'integer',
              value: 0,
            },
          ],
        },
        runAfter: {},
      },
      InitText: {
        type: 'InitializeVariable',
        inputs: {
          variables: [
            {
              name: 'messageText',
              type: 'string',
              value: '',
            },
          ],
        },
        runAfter: {
          InitCounter: ['Succeeded'],
        },
      },
      PrepareValue: {
        type: 'Compose',
        inputs: 12,
        runAfter: {
          InitText: ['Succeeded'],
        },
      },
      For_each_record: {
        type: 'Foreach',
        foreach: "@triggerBody()?['records']",
        actions: {
          Compose_inside_loop: {
            type: 'Compose',
            inputs: "@items('For_each_record')",
            runAfter: {},
          },
        },
        runAfter: {
          PrepareValue: ['Succeeded'],
        },
      },
      Scope_Group: {
        type: 'Scope',
        actions: {
          ScopedCompose: {
            type: 'Compose',
            inputs: "@body('PrepareValue')",
            runAfter: {},
          },
        },
        runAfter: {
          For_each_record: ['Succeeded'],
        },
      },
      UseAction: {
        type: 'Compose',
        inputs: "@{concat(outputs('PrepareValue'), variables('counter'))}",
        runAfter: {
          Scope_Group: ['Succeeded'],
        },
      },
    },
  },
}, null, 2);

const DATAVERSE_CONNECTION: FlowEnvironmentConnection = {
  name: 'shared-commondataser-da8725a8',
  id: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps/connections/shared-commondataser-da8725a8',
  displayName: 'callum@example.test',
  apiName: 'shared_commondataserviceforapps',
  apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
  status: 'Connected',
};

function builtInOperation(name: string, operationType: string): FlowApiOperation {
  return {
    name,
    operationType,
    isBuiltIn: true,
    hasConnectorSchema: false,
  };
}

function snippetByLabel(label: string): FlowCodeSnippet {
  const snippet = FLOW_SNIPPETS.find((item) => item.label === label);
  assert.ok(snippet, `missing snippet ${label}`);
  return snippet;
}

function normalizeSnippetPlaceholders(text: string): string {
  return text
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, '');
}

function parseSnippetDefaultJson(snippet: FlowCodeSnippet): Record<string, unknown> {
  const source = `{${normalizeSnippetPlaceholders(snippet.insertText)}}`;
  return JSON.parse(source) as Record<string, unknown>;
}

function expectCompletion(items: FlowCompletionItem[], label: string, type?: FlowCompletionItem['type']): FlowCompletionItem {
  const item = items.find((candidate) => candidate.label === label && (!type || candidate.type === type));
  assert.ok(item, `expected completion ${label}${type ? ` (${type})` : ''}; got ${items.map((candidate) => candidate.label).join(', ')}`);
  return item;
}

function rejectCompletion(items: FlowCompletionItem[], label: string): void {
  assert.equal(items.some((item) => item.label === label), false, `did not expect completion ${label}`);
}

function labels(items: FlowCompletionItem[]): string[] {
  return items.map((item) => item.label);
}

function connectorFlow(parameters: Record<string, unknown>): string {
  return JSON.stringify({
    properties: {
      connectionReferences: {
        shared_sharepointonline: {
          api: {
            id: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
            name: 'shared_sharepointonline',
          },
          connection: {
            name: '/providers/Microsoft.PowerApps/apis/shared-sharepointonline-1',
          },
        },
      },
      definition: {
        triggers: {
          manual: {
            type: 'Request',
            inputs: {},
          },
        },
        actions: {
          Get_items: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: 'shared_sharepointonline',
                operationId: 'GetItems',
              },
              parameters,
            },
            runAfter: {},
          },
        },
      },
    },
  }, null, 2);
}

function liveConnectorFlow(input: {
  apiName: string;
  apiId: string;
  connectionName: string;
  operationId: string;
  parameters: Record<string, unknown>;
}): string {
  return JSON.stringify({
    properties: {
      connectionReferences: {
        [input.apiName]: {
          connectionName: input.connectionName,
          api: {
            name: input.apiName,
            id: input.apiId,
          },
          connection: {
            name: input.connectionName,
          },
        },
      },
      definition: {
        triggers: {
          manual: {
            type: 'Request',
            inputs: {},
          },
        },
        actions: {
          List_rows: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: input.apiName,
                operationId: input.operationId,
              },
              parameters: input.parameters,
            },
            runAfter: {},
          },
        },
      },
    },
  }, null, 2);
}

function schemaEntryFor(source: string, fields: FlowApiOperationSchemaField[], options: FlowEditorSchemaActionEntry['options']): FlowEditorSchemaActionEntry {
  const analysis = analyzeFlow(source, source.indexOf('Get_items'));
  const target = collectFlowEditorSchemaTargets(source, analysis)[0];
  assert.ok(target);
  return {
    ...target,
    schema: {
      apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
      apiName: 'shared_sharepointonline',
      operationId: 'GetItems',
      fields,
    },
    fields,
    options,
    status: 'ready',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function valueArray(value: unknown): unknown[] {
  return isRecord(value) && Array.isArray(value.value) ? value.value : [];
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function fieldNames(fields: FlowApiOperationSchemaField[]): Set<string> {
  return new Set(fields.map((field) => field.name));
}

function outputFieldsFromSchema(schema: unknown): FlowApiOperationSchemaField[] {
  const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
  return Object.entries(properties).flatMap(([name, property]) => {
    if (!isRecord(property)) return [];
    return [{
      name,
      location: 'output' as const,
      type: typeof property.type === 'string' ? property.type : undefined,
      title: firstString(property['x-ms-summary'], property.title),
      description: typeof property.description === 'string' ? property.description : undefined,
      schema: property,
    }];
  });
}

function normalizeDynamicInvocationDefinitionForSmoke(source: Record<string, unknown>): Record<string, unknown> {
  const operationId = firstString(source.operationId, source.operation, source.name);
  const parameters: Record<string, unknown> = {};
  if (isRecord(source.parameters)) {
    for (const [name, raw] of Object.entries(source.parameters)) {
      if (typeof raw === 'string') {
        parameters[name] = { parameterReference: raw, required: true };
        continue;
      }
      if (!isRecord(raw)) continue;
      const reference = firstString(raw.parameterReference, raw.parameter, raw.name, raw.value);
      parameters[name] = reference ? { ...raw, parameterReference: reference } : raw;
    }
  }

  const result: Record<string, unknown> = {
    ...(operationId ? { operationId } : {}),
    parameters,
  };
  const itemsPath = firstString(source.itemsPath, source['value-collection'], source.valueCollection, source.collection);
  const itemValuePath = firstString(source.itemValuePath, source['value-path'], source.valuePath, source.value);
  const itemTitlePath = firstString(source.itemTitlePath, source['value-title'], source.valueTitle, source.title);
  if (itemsPath) result.itemsPath = itemsPath;
  if (itemValuePath) result.itemValuePath = itemValuePath;
  if (itemTitlePath) result.itemTitlePath = itemTitlePath;
  return result;
}

function dynamicInvocationParametersForSmoke(definition: Record<string, unknown>, currentParameters: Record<string, unknown>): Record<string, unknown> {
  const parameterDefinitions = isRecord(definition.parameters) ? definition.parameters : {};
  const result: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(parameterDefinitions)) {
    const parameterReference = isRecord(raw) ? firstString(raw.parameterReference, raw.parameter, raw.name) : undefined;
    const sourceName = parameterReference || name;
    if (Object.prototype.hasOwnProperty.call(currentParameters, sourceName)) result[name] = currentParameters[sourceName];
  }
  return result;
}

function apiNameFromOperation(operation: unknown): string | undefined {
  const id = firstString(readPath(operation, 'id'), readPath(operation, 'properties.api.id'), readPath(operation, 'properties.api.name'));
  if (!id) return undefined;
  const match = id.match(/\/apis\/([^/]+)/i);
  return match?.[1] || id;
}

async function liveRequest<T>(
  api: 'flow' | 'powerapps' | 'powerautomate',
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const environmentAlias = process.env.PP_FLOW_COMPLETIONS_ENV || 'test-dev';
  const { executeApiRequest } = await import('../src/services/api.js');
  const result = await executeApiRequest({
    environmentAlias,
    api,
    path,
    method: options.method || 'GET',
    body: options.body,
    query: options.query,
    responseType: 'json',
    readIntent: true,
  }, {}, { allowInteractive: process.env.PP_FLOW_COMPLETIONS_NO_INTERACTIVE === '1' ? false : true });

  assert.equal(
    result.success,
    true,
    result.diagnostics.map((diagnostic) => `${diagnostic.code || diagnostic.level}: ${diagnostic.message}`).join('\n'),
  );
  assert.ok(result.data);
  return result.data.response as T;
}

test('Power Automate action snippets parse as JSON and match Add Action built-in templates', () => {
  assert.equal(new Set(FLOW_SNIPPETS.map((item) => item.label)).size, FLOW_SNIPPETS.length, 'snippet labels must be unique');

  for (const expectation of ACTION_SNIPPET_EXPECTATIONS) {
    const snippet = snippetByLabel(expectation.label);
    const parsed = parseSnippetDefaultJson(snippet);
    const builtIn = buildBuiltInAction(builtInOperation(expectation.operationName, expectation.operationType));

    assert.ok(builtIn, `${expectation.label} should map to a built-in template`);
    assert.deepEqual(parsed, {
      [expectation.defaultName]: {
        ...builtIn,
        runAfter: {},
      },
    }, `${expectation.label} should normalize to the same action draft as Add Action`);
  }
});

test('Power Automate snippets do not seed example values that differ from modal-created actions', () => {
  const compose = parseSnippetDefaultJson(snippetByLabel('pa:compose action')).Compose as Record<string, unknown>;
  assert.deepEqual(compose, { type: 'Compose', inputs: '', runAfter: {} });

  const foreach = parseSnippetDefaultJson(snippetByLabel('pa:foreach action')).Apply_to_each as Record<string, unknown>;
  assert.equal(foreach.foreach, "@triggerBody()?['value']");

  const http = parseSnippetDefaultJson(snippetByLabel('pa:http action')).HTTP as Record<string, unknown>;
  assert.deepEqual(http.inputs, { method: 'GET', uri: '' });
});

test('expression completions expose the WDL functions used by flow and modal editors', () => {
  const completions = completeFlowExpression(RICH_COMPLETION_FLOW, '');
  const expectedFunctions = [
    'triggerBody()',
    'triggerOutputs()',
    'trigger()',
    'workflow()',
    'outputs()',
    'body()',
    'actions()',
    'items()',
    'item()',
    'variables()',
    'parameters()',
    'result()',
    'triggerFormDataValue()',
    'triggerFormDataMultiValues()',
    'listCallbackUrl()',
    'concat()',
    'coalesce()',
    'empty()',
    'equals()',
    'if()',
    'contains()',
    'length()',
    'json()',
    'utcNow()',
    'formatDateTime()',
  ];

  for (const label of expectedFunctions) {
    const item = expectCompletion(completions, label, 'function');
    assert.equal(item.snippet, true, `${label} should insert as a snippet`);
    assert.ok(item.apply, `${label} should provide explicit insertion text`);
  }

  assert.match(expectCompletion(completions, 'outputs()').apply || '', /PrepareValue/);
  assert.equal(expectCompletion(completions, "outputs('PrepareValue')").apply, "outputs('PrepareValue')");
  assert.equal(expectCompletion(completions, "body('PrepareValue')").apply, "body('PrepareValue')");
  assert.equal(expectCompletion(completions, "items('For_each_record')").apply, "items('For_each_record')");
  assert.equal(expectCompletion(completions, "variables('counter')").apply, "variables('counter')");
  assert.equal(expectCompletion(completions, "parameters('targetValue')").apply, "parameters('targetValue')");
  assert.match(expectCompletion(completions, 'items()').apply || '', /For_each_record/);
  assert.doesNotMatch(expectCompletion(completions, 'items()').apply || '', /PrepareValue/);
  assert.match(expectCompletion(completions, 'variables()').apply || '', /counter/);
  assert.match(expectCompletion(completions, 'variables()').apply || '', /messageText/);
  assert.match(expectCompletion(completions, 'parameters()').apply || '', /targetValue/);
  assert.match(expectCompletion(completions, 'listCallbackUrl()').apply || '', /manual/);
});

test('expression target-name completions are context-aware by function family', () => {
  const outputTargets = completeFlowExpression(RICH_COMPLETION_FLOW, "outputs('Prep");
  expectCompletion(outputTargets, 'PrepareValue', 'action');
  rejectCompletion(outputTargets, 'counter');

  const bodyTargets = completeFlowExpression(RICH_COMPLETION_FLOW, "body('Scoped");
  expectCompletion(bodyTargets, 'ScopedCompose', 'action');
  rejectCompletion(bodyTargets, 'targetValue');

  const actionTargets = completeFlowExpression(RICH_COMPLETION_FLOW, "actions('Compose_inside");
  expectCompletion(actionTargets, 'Compose_inside_loop', 'action');
  rejectCompletion(actionTargets, 'messageText');

  const variableTargets = completeFlowExpression(RICH_COMPLETION_FLOW, "variables('cou");
  expectCompletion(variableTargets, 'counter', 'variable');
  rejectCompletion(variableTargets, 'PrepareValue');

  const parameterTargets = completeFlowExpression(RICH_COMPLETION_FLOW, "parameters('tar");
  expectCompletion(parameterTargets, 'targetValue', 'parameter');
  rejectCompletion(parameterTargets, 'counter');

  const loopTargets = completeFlowExpression(RICH_COMPLETION_FLOW, "items('For");
  expectCompletion(loopTargets, 'For_each_record', 'action');
  rejectCompletion(loopTargets, 'PrepareValue');
  rejectCompletion(loopTargets, 'Scope_Group');

  const scopeResultTargets = completeFlowExpression(RICH_COMPLETION_FLOW, "result('Scope");
  expectCompletion(scopeResultTargets, 'Scope_Group', 'action');
  rejectCompletion(scopeResultTargets, 'PrepareValue');

  const loopResultTargets = completeFlowExpression(RICH_COMPLETION_FLOW, "result('For");
  expectCompletion(loopResultTargets, 'For_each_record', 'action');
});

test('expression completion context parsing is shared across target names and accessors', () => {
  const targetSource = "@outputs('Prep";
  const targetContext = findFlowExpressionCompletionContext(targetSource, targetSource.length);
  assert.equal(targetContext?.kind, 'target-name');
  assert.equal(targetContext?.text, "outputs('Prep");
  assert.equal(targetContext?.prefix, 'Prep');
  assert.equal(targetContext?.targetName?.functionName, 'outputs');
  assert.equal(targetContext?.replaceFrom, targetSource.indexOf('Prep'));

  const escapedTargetSource = "@body('Bob''s_action";
  const escapedTargetContext = findFlowExpressionCompletionContext(escapedTargetSource, escapedTargetSource.length);
  assert.equal(escapedTargetContext?.kind, 'target-name');
  assert.equal(escapedTargetContext?.prefix, "Bob's_action");
  assert.equal(escapedTargetContext?.replaceFrom, escapedTargetSource.indexOf('Bob'));

  const nestedTargetSource = "@coalesce(body('Get";
  const nestedTargetContext = findFlowExpressionCompletionContext(nestedTargetSource, nestedTargetSource.length);
  assert.equal(nestedTargetContext?.kind, 'target-name');
  assert.equal(nestedTargetContext?.prefix, 'Get');
  assert.equal(nestedTargetContext?.targetName?.functionName, 'body');
  assert.equal(nestedTargetContext?.replaceFrom, nestedTargetSource.indexOf('Get'));

  const accessorSource = "@body('List_accounts')?['va";
  const accessorContext = findFlowExpressionCompletionContext(accessorSource, accessorSource.length);
  assert.equal(accessorContext?.kind, 'accessor');
  assert.equal(accessorContext?.prefix, 'va');
  assert.equal(accessorContext?.replaceFrom, accessorSource.indexOf('va'));
  assert.equal(accessorContext?.accessor?.baseExpression, "body('List_accounts')");
  assert.equal(accessorContext?.accessor?.optional, true);

  const nestedAccessorSource = "@outputs('Get_items')?['body']?['va";
  const nestedAccessorContext = findFlowExpressionCompletionContext(nestedAccessorSource, nestedAccessorSource.length);
  assert.equal(nestedAccessorContext?.kind, 'accessor');
  assert.equal(nestedAccessorContext?.accessor?.baseExpression, "outputs('Get_items')?['body']");
  assert.deepEqual(nestedAccessorContext?.accessor?.segments, ['body']);

  const nestedCallAccessorSource = "@coalesce(body('Get_current_user')?['disp";
  const nestedCallAccessorContext = findFlowExpressionCompletionContext(nestedCallAccessorSource, nestedCallAccessorSource.length);
  assert.equal(nestedCallAccessorContext?.kind, 'accessor');
  assert.equal(nestedCallAccessorContext?.prefix, 'disp');
  assert.equal(nestedCallAccessorContext?.accessor?.baseExpression, "body('Get_current_user')");
  assert.deepEqual(nestedCallAccessorContext?.accessor?.segments, []);

  const firstItemAccessorSource = "@first(body('List_accounts')?['value'])?['acco";
  const firstItemAccessorContext = findFlowExpressionCompletionContext(firstItemAccessorSource, firstItemAccessorSource.length);
  assert.equal(firstItemAccessorContext?.kind, 'accessor');
  assert.equal(firstItemAccessorContext?.prefix, 'acco');
  assert.equal(firstItemAccessorContext?.accessor?.baseExpression, "first(body('List_accounts')?['value'])");

  const nestedLengthAccessorSource = "@length(body('List_accounts')?['val";
  const nestedLengthAccessorContext = findFlowExpressionCompletionContext(nestedLengthAccessorSource, nestedLengthAccessorSource.length);
  assert.equal(nestedLengthAccessorContext?.kind, 'accessor');
  assert.equal(nestedLengthAccessorContext?.accessor?.baseExpression, "body('List_accounts')");

  const closedSource = "@outputs('PrepareValue')";
  assert.equal(findFlowExpressionCompletionContext(closedSource, closedSource.length), null);
});

test('expression completions filter prefixes and stay quiet inside string literals', () => {
  assert.deepEqual(labels(completeFlowExpression(RICH_COMPLETION_FLOW, 'trig')).sort(), [
    'trigger()',
    'triggerBody()',
    'triggerFormDataMultiValues()',
    'triggerFormDataValue()',
    'triggerOutputs()',
  ].sort());

  assert.deepEqual(labels(completeFlowExpression(RICH_COMPLETION_FLOW, 'utc')), ['utcNow()']);
  assert.deepEqual(completeFlowExpression(RICH_COMPLETION_FLOW, "concat('tri"), []);
  assert.deepEqual(completeFlowExpression(RICH_COMPLETION_FLOW, "outputs('PrepareValue')"), []);
  assert.deepEqual(completeFlowExpression(RICH_COMPLETION_FLOW, 'notAFunction.'), []);
});

test('flow JSON analysis completions cover root keys, action keys, runAfter targets, type values, and inline expressions', () => {
  const rootKeySource = JSON.stringify({
    trig: {},
  }, null, 2);
  const rootCompletions = analyzeFlow(rootKeySource, rootKeySource.indexOf('"trig"') + 4).completions;
  for (const label of ['actions', 'triggers', 'parameters', 'outputs']) {
    expectCompletion(rootCompletions, label, 'property');
  }

  const actionKeySource = JSON.stringify({
    definition: {
      actions: {
        Compose: {
          type: 'Compose',
          inp: '',
          runAfter: {},
        },
      },
    },
  }, null, 2);
  const actionKeyCompletions = analyzeFlow(actionKeySource, actionKeySource.indexOf('"inp"') + 3).completions;
  for (const label of ['type', 'inputs', 'runAfter', 'actions', 'else', 'expression', 'runtimeConfiguration']) {
    expectCompletion(actionKeyCompletions, label, 'property');
  }

  const runAfterSource = JSON.stringify({
    definition: {
      actions: {
        First: {
          type: 'Compose',
          inputs: '',
          runAfter: {},
        },
        Second: {
          type: 'Compose',
          inputs: '',
          runAfter: {
            '': [],
          },
        },
      },
    },
  }, null, 2);
  const runAfterCursor = runAfterSource.indexOf('"": []') + 1;
  const runAfterCompletions = analyzeFlow(runAfterSource, runAfterCursor).completions;
  expectCompletion(runAfterCompletions, 'First', 'action');
  rejectCompletion(runAfterCompletions, 'Second');
  for (const status of ['Succeeded', 'Failed', 'Skipped', 'TimedOut']) {
    expectCompletion(runAfterCompletions, status, 'value');
  }

  const runAfterStatusSource = JSON.stringify({
    definition: {
      actions: {
        First: {
          type: 'Compose',
          inputs: '',
          runAfter: {},
        },
        Second: {
          type: 'Compose',
          inputs: '',
          runAfter: {
            First: ['Suc'],
          },
        },
      },
    },
  }, null, 2);
  const runAfterStatusCompletions = analyzeFlow(runAfterStatusSource, runAfterStatusSource.indexOf('"Suc"') + 4).completions;
  expectCompletion(runAfterStatusCompletions, 'Succeeded', 'value');
  expectCompletion(runAfterStatusCompletions, 'Failed', 'value');

  const typeValueSource = JSON.stringify({
    definition: {
      actions: {
        Draft: {
          type: 'Com',
          inputs: '',
          runAfter: {},
        },
      },
    },
  }, null, 2);
  const typeValueCompletions = analyzeFlow(typeValueSource, typeValueSource.indexOf('"Com"') + 4).completions;
  for (const label of ['Compose', 'OpenApiConnection', 'ApiConnection', 'Http', 'InitializeVariable', 'SetVariable']) {
    expectCompletion(typeValueCompletions, label, 'value');
  }

  const expressionSource = RICH_COMPLETION_FLOW.replace("outputs('PrepareValue')", 'out');
  const expressionCursor = expressionSource.indexOf('@{concat(out') + '@{concat(out'.length;
  const expressionCompletions = analyzeFlow(expressionSource, expressionCursor).completions;
  expectCompletion(expressionCompletions, 'outputs()', 'function');
});

test('connector schema completions use loaded modal-style fields and dynamic options in the flow editor', () => {
  const datasetField: FlowApiOperationSchemaField = {
    name: 'dataset',
    location: 'parameter',
    path: ['inputs', 'parameters', 'dataset'],
    required: true,
    type: 'string',
    title: 'Site Address',
    description: 'SharePoint site URL.',
  };
  const tableField: FlowApiOperationSchemaField = {
    name: 'table',
    location: 'parameter',
    path: ['inputs', 'parameters', 'table'],
    required: true,
    type: 'string',
    title: 'List Name',
    enum: ['Plain', 'List "A"', 'Folder\\Archive'],
  };
  const queryField: FlowApiOperationSchemaField = {
    name: '$filter',
    location: 'parameter',
    path: ['inputs', 'parameters', '$filter'],
    type: 'string',
    title: 'Filter Query',
  };

  const source = connectorFlow({ dataset: 'https://contoso.sharepoint.com/sites/Team', tab: '' });
  const entry = schemaEntryFor(source, [datasetField, tableField, queryField], {
    [fieldSchemaKey(datasetField)]: [
      {
        value: 'https://contoso.sharepoint.com/sites/Team',
        title: 'Team Site',
      },
      {
        value: 'https://contoso.sharepoint.com/sites/"Quoted"\\Archive',
        title: 'Quoted Archive',
      },
    ],
  });
  const index = buildFlowEditorSchemaIndex([entry], false);

  const keyAnalysis = analyzeFlow(source, source.indexOf('"tab"') + 4);
  const keyCompletions = flowEditorSchemaCompletionItems(source.indexOf('"tab"') + 4, keyAnalysis, index);
  assert.ok(keyCompletions.some((item) => item.label === 'table' && item.kind === 'property'));
  assert.ok(keyCompletions.some((item) => item.label === '$filter' && item.kind === 'property'));
  assert.equal(keyCompletions.some((item) => item.label === 'dataset'), false, 'already-filled fields should not be suggested again');
  assert.equal(keyCompletions[0]?.label, 'table', 'required schema fields should rank before optional fields');

  const tableValueSource = connectorFlow({ dataset: 'https://contoso.sharepoint.com/sites/Team', table: 'Lis' });
  const tableValueAnalysis = analyzeFlow(tableValueSource, tableValueSource.indexOf('"Lis"') + 4);
  const tableValueCompletions = flowEditorSchemaCompletionItems(tableValueSource.indexOf('"Lis"') + 4, tableValueAnalysis, index);
  assert.ok(tableValueCompletions.some((item) => item.label === 'Plain' && item.insertText === 'Plain'));
  assert.ok(tableValueCompletions.some((item) => item.label === 'List "A"' && item.insertText === 'List \\"A\\"'));
  assert.ok(tableValueCompletions.some((item) => item.label === 'Folder\\Archive' && item.insertText === 'Folder\\\\Archive'));

  const datasetValueSource = connectorFlow({ dataset: 'http' });
  const datasetValueAnalysis = analyzeFlow(datasetValueSource, datasetValueSource.indexOf('"http"') + 5);
  const datasetValueCompletions = flowEditorSchemaCompletionItems(datasetValueSource.indexOf('"http"') + 5, datasetValueAnalysis, index);
  assert.ok(datasetValueCompletions.some((item) => item.label.includes('Team Site') && item.insertText.includes('contoso')));
  assert.ok(datasetValueCompletions.some((item) => item.label.includes('Quoted Archive') && item.insertText === 'https://contoso.sharepoint.com/sites/\\"Quoted\\"\\\\Archive'));
});

test('connector operation normalization preserves output response schemas for expression accessors', () => {
  const schema = normalizeFlowApiOperationSchema(
    'shared_commondataserviceforapps',
    '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
    'ListRecords',
    {
      name: 'ListRecords',
      properties: {
        summary: 'List rows',
        inputsDefinition: {
          parameters: {
            entityName: { type: 'string', required: true },
          },
        },
        responsesDefinition: {
          200: {
            type: 'object',
            properties: {
              body: {
                type: 'object',
                properties: {
                  value: {
                    type: 'array',
                    items: {
                      type: 'object',
                      'x-ms-dynamic-properties': {
                        operationId: 'GetMetadataForGetEntity',
                        parameters: {
                          entityName: { parameterReference: 'entityName', required: true },
                        },
                        itemValuePath: 'schema',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  );

  assert.ok(schema);
  assert.equal(schema.responses?.[0]?.statusCode, '200');
  assert.equal(readPath(schema.responses?.[0]?.bodySchema, 'properties.value.type'), 'array');
  assert.equal(readPath(schema.responses?.[0]?.bodySchema, 'properties.value.items.x-ms-dynamic-properties.operationId'), 'GetMetadataForGetEntity');
});

test('connection-aware completions suggest connector host keys and values from the flow connection model', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_commondataserviceforapps: {
          connectionName: DATAVERSE_CONNECTION.name,
          api: {
            name: 'shared_commondataserviceforapps',
            id: DATAVERSE_CONNECTION.apiId,
            displayName: 'Microsoft Dataverse',
          },
        },
      },
      definition: {
        actions: {
          List_rows: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: 'shared_commondataserviceforapps',
                operationId: 'ListRecords',
                con: '',
              },
              parameters: {
                entityName: 'accounts',
              },
            },
            runAfter: {},
          },
        },
      },
    },
  }, null, 2);
  const model = buildFlowConnectionModel(source, [DATAVERSE_CONNECTION]);

  const keyCursor = source.indexOf('"con"') + 4;
  const keyAnalysis = analyzeFlow(source, keyCursor);
  const keyCompletions = flowEditorConnectionCompletionItems(keyAnalysis, model);
  assert.ok(keyCompletions.some((item) => item.label === 'connectionReferenceName' && item.kind === 'property'));
  assert.ok(keyCompletions.some((item) => item.label === 'operationId' && item.kind === 'property'));

  const referenceSource = source.replace('"connectionReferenceName": "shared_commondataserviceforapps"', '"connectionReferenceName": "shared_comm"');
  const referenceCursor = referenceSource.indexOf('"shared_comm"') + 12;
  const referenceCompletions = flowEditorConnectionCompletionItems(analyzeFlow(referenceSource, referenceCursor), model);
  assert.ok(referenceCompletions.some((item) => item.label === 'shared_commondataserviceforapps' && item.insertText === 'shared_commondataserviceforapps'));

  const operationSource = source.replace('"ListRecords"', '"List"');
  const operationCursor = operationSource.indexOf('"List"') + 5;
  const operationCompletions = flowEditorConnectionCompletionItems(analyzeFlow(operationSource, operationCursor), model);
  assert.ok(operationCompletions.some((item) => item.label === 'ListRecords' && item.detail?.includes('Operation id')));
});

test('live flow API metadata drives the same completions as the editor schema index', {
  skip: process.env.PP_FLOW_COMPLETIONS_LIVE === '1'
    ? false
    : 'set PP_FLOW_COMPLETIONS_LIVE=1 to run against a configured Power Platform environment',
}, async () => {
  const composeCatalog = await liveRequest<{ value?: unknown[] }>('flow', '/operations', {
    method: 'POST',
    query: { '$top': '25' },
    body: buildFlowOperationSearchBody('Compose', 'action'),
  });
  const composeOperation = valueArray(composeCatalog).find((operation) => firstString(readPath(operation, 'name')) === 'Compose');
  assert.ok(composeOperation, 'the live operation catalog should expose the built-in Compose action');
  const composeOperationType = firstString(readPath(composeOperation, 'properties.operationType'));
  assert.ok(composeOperationType);
  assert.notEqual(composeOperationType, 'OpenApiConnection');
  assert.notEqual(composeOperationType, 'ApiConnection');
  assert.deepEqual(parseSnippetDefaultJson(snippetByLabel('pa:compose action')), {
    Compose: {
      ...buildBuiltInAction(builtInOperation('Compose', composeOperationType)),
      runAfter: {},
    },
  });

  const dataverseCatalog = await liveRequest<{ value?: unknown[] }>('flow', '/operations', {
    method: 'POST',
    query: { '$top': '25' },
    body: buildFlowOperationSearchBody('Dataverse List rows', 'action'),
  });
  const listRowsOperation = valueArray(dataverseCatalog).find((operation) => {
    return firstString(readPath(operation, 'name')) === 'ListRecords'
      && firstString(readPath(operation, 'properties.operationType')) === 'OpenApiConnection';
  });
  assert.ok(listRowsOperation, 'the live operation catalog should expose Dataverse List rows');

  const operationId = firstString(readPath(listRowsOperation, 'name'));
  const apiName = apiNameFromOperation(listRowsOperation);
  assert.equal(operationId, 'ListRecords');
  assert.ok(apiName);
  const apiId = `/providers/Microsoft.PowerApps/apis/${apiName}`;

  const rawConnector = await liveRequest<unknown>('flow', `/apis/${apiName}`);
  const schema = normalizeFlowApiOperationSchema(apiName, apiId, operationId, rawConnector);
  assert.ok(schema, 'the live connector swagger should normalize to an operation schema');
  const fields = visibleConnectorSchemaFields(schema.fields);
  const apiFieldNames = new Set(fields.map((field) => field.name));
  for (const fieldName of ['entityName', '$select', '$filter', '$top']) {
    assert.equal(apiFieldNames.has(fieldName), true, `live ListRows schema should include ${fieldName}`);
  }

  const connections = await liveRequest<{ value?: unknown[] }>('powerapps', '/connections?$filter=environment%20eq%20%27{environment}%27', {
    query: { '$top': '100' },
  });
  const matchingConnection = valueArray(connections).find((connection) => {
    const id = firstString(readPath(connection, 'id'), readPath(connection, 'properties.api.id')) || '';
    return id.includes(`/apis/${apiName}/`) || id.endsWith(`/apis/${apiName}`);
  });
  assert.ok(matchingConnection, `the live environment should have a connection for ${apiName}`);
  const connectionName = firstString(readPath(matchingConnection, 'name')) || '';
  assert.ok(connectionName);

  const source = liveConnectorFlow({
    apiName,
    apiId,
    connectionName,
    operationId,
    parameters: {
      enti: '',
      '$select': '',
    },
  });
  const cursor = source.indexOf('"enti"') + 5;
  const analysis = analyzeFlow(source, cursor);
  const target = collectFlowEditorSchemaTargets(source, analysis)[0];
  assert.ok(target);
  assert.equal(target.operationRef.apiName, apiName);
  assert.equal(target.operationRef.operationId, operationId);
  assert.equal(target.operationRef.connectionName, connectionName);

  const index = buildFlowEditorSchemaIndex([{
    ...target,
    schema,
    fields,
    options: {},
    status: 'ready',
  }], false);
  const completions = flowEditorSchemaCompletionItems(cursor, analysis, index);
  assert.ok(completions.some((item) => item.label === 'entityName' && item.kind === 'property'));
  assert.ok(completions.some((item) => item.label === '$filter' && item.kind === 'property'));
  assert.ok(completions.some((item) => item.label === '$top' && item.kind === 'property'));
  assert.equal(completions.some((item) => item.label === '$select'), false, 'existing live API fields should not be suggested again');

  const dynamicOutputSchema = firstRecord(
    readPath(schema.responses?.[0]?.schema, 'properties.body.properties.value.items.x-ms-dynamic-properties'),
    readPath(schema.responses?.[0]?.schema, 'properties.value.items.x-ms-dynamic-properties'),
  );
  const outputItemSchema = firstRecord(
    readPath(schema.responses?.[0]?.schema, 'properties.body.properties.value.items'),
    readPath(schema.responses?.[0]?.schema, 'properties.value.items'),
  );
  assert.ok(isRecord(dynamicOutputSchema), 'live ListRows response should expose dynamic row output metadata');
  assert.ok(isRecord(outputItemSchema), 'live ListRows response should expose a row item schema');
  const dynamicInvocationDefinition = normalizeDynamicInvocationDefinitionForSmoke(dynamicOutputSchema);
  const dynamicInvocationSourceParameters = {
    entityName: 'accounts',
    '$select': 'accountid,name',
  };
  const liveOutputSchema = await liveRequest<unknown>(
    'powerautomate',
    `/apis/${apiName}/connections/${encodeURIComponent(connectionName)}/listDynamicProperties`,
    {
      method: 'POST',
      body: {
        parameters: dynamicInvocationParametersForSmoke(dynamicInvocationDefinition, dynamicInvocationSourceParameters),
        contextParameterAlias: 'body/value',
        dynamicInvocationDefinition,
        location: 'output',
      },
    },
  );
  const dynamicOutputFields = outputFieldsFromSchema(liveOutputSchema);
  const dynamicOutputNames = fieldNames(dynamicOutputFields);
  assert.equal(dynamicOutputNames.has('accountid'), true, 'live dynamic ListRows output schema should include accountid');
  assert.equal(dynamicOutputNames.has('name'), true, 'live dynamic ListRows output schema should include name');

  const outputSource = liveConnectorFlow({
    apiName,
    apiId,
    connectionName,
    operationId,
    parameters: {
      entityName: 'accounts',
      '$select': 'accountid,name',
    },
  });
  const outputAnalysis = analyzeFlow(outputSource, outputSource.indexOf('"entityName"') + 5);
  const outputTarget = collectFlowEditorSchemaTargets(outputSource, outputAnalysis)[0];
  assert.ok(outputTarget);
  const outputIndex = buildFlowEditorSchemaIndex([{
    ...outputTarget,
    schema,
    fields,
    options: {},
    outputFields: {
      'body/value': dynamicOutputFields,
    },
    status: 'ready',
  }], false);
  const bodyAccessor = "@body('List_rows')?['value']?['";
  const bodyAccessorCompletions = flowEditorExpressionSchemaCompletionItems(bodyAccessor, bodyAccessor.length, outputIndex);
  assert.equal(bodyAccessorCompletions.some((item) => item.label === 'accountid'), true, 'body() accessor completions should include live dynamic accountid');
  assert.equal(bodyAccessorCompletions.some((item) => item.label === 'name'), true, 'body() accessor completions should include live dynamic name');

  const outputsAccessor = "@outputs('List_rows')?['body']?['value']?['";
  const outputsAccessorCompletions = flowEditorExpressionSchemaCompletionItems(outputsAccessor, outputsAccessor.length, outputIndex);
  assert.equal(outputsAccessorCompletions.some((item) => item.label === 'accountid'), true, 'outputs() accessor completions should include live dynamic accountid');
  assert.equal(outputsAccessorCompletions.some((item) => item.label === 'name'), true, 'outputs() accessor completions should include live dynamic name');

  const officeConnection = valueArray(connections).find((connection) => {
    const id = firstString(readPath(connection, 'id'), readPath(connection, 'properties.api.id')) || '';
    return id.includes('/apis/shared_office365users/');
  });
  if (officeConnection) {
    const officeCatalog = await liveRequest<{ value?: unknown[] }>('flow', '/operations', {
      method: 'POST',
      query: { '$top': '25' },
      body: buildFlowOperationSearchBody('Office 365 Users', 'action'),
    });
    const officeOperation = valueArray(officeCatalog).find((operation) => {
      return apiNameFromOperation(operation) === 'shared_office365users'
        && firstString(readPath(operation, 'properties.operationType')) === 'OpenApiConnection';
    });
    assert.ok(officeOperation, 'the live operation catalog should expose at least one Office 365 Users action');
    const officeOperationId = firstString(readPath(officeOperation, 'name'));
    assert.ok(officeOperationId);
    const officeRawConnector = await liveRequest<unknown>('flow', '/apis/shared_office365users');
    const officeSchema = normalizeFlowApiOperationSchema(
      'shared_office365users',
      '/providers/Microsoft.PowerApps/apis/shared_office365users',
      officeOperationId,
      officeRawConnector,
    );
    assert.ok(officeSchema, 'the Office 365 Users connector swagger should normalize to an operation schema');
    const officeFields = visibleConnectorSchemaFields(officeSchema.fields);
    assert.ok(officeFields.length > 0, 'Office 365 Users operation should expose editable schema fields');
    const firstOfficeField = officeFields[0]!;
    const officeSource = liveConnectorFlow({
      apiName: 'shared_office365users',
      apiId: '/providers/Microsoft.PowerApps/apis/shared_office365users',
      connectionName: firstString(readPath(officeConnection, 'name')) || '',
      operationId: officeOperationId,
      parameters: {
        [firstOfficeField.name.slice(0, 1) || 'x']: '',
      },
    });
    const officeCursor = officeSource.indexOf(Object.keys(JSON.parse(officeSource).properties.definition.actions.List_rows.inputs.parameters)[0]) + 2;
    const officeAnalysis = analyzeFlow(officeSource, officeCursor);
    const officeTarget = collectFlowEditorSchemaTargets(officeSource, officeAnalysis)[0];
    assert.ok(officeTarget);
    const officeIndex = buildFlowEditorSchemaIndex([{
      ...officeTarget,
      schema: officeSchema,
      fields: officeFields,
      options: {},
      status: 'ready',
    }], false);
    const officeCompletions = flowEditorSchemaCompletionItems(officeCursor, officeAnalysis, officeIndex);
    assert.ok(officeCompletions.some((item) => item.label === firstOfficeField.name && item.kind === 'property'));
  }
});
