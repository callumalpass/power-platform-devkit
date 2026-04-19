import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFlow } from '../src/flow-language.js';
import {
  buildFlowEditorSchemaIndex,
  collectFlowEditorSchemaTargets,
  flowEditorSchemaCompletionItems,
  type FlowEditorSchemaActionEntry,
} from '../src/ui-react/automate/flow-editor-schema-index.js';
import { dynamicApiRef, fieldSchemaKey } from '../src/ui-react/automate/flow-dynamic-schema.js';

function flowSource(parameters: Record<string, unknown>): string {
  return JSON.stringify({
    properties: {
      connectionReferences: {
        shared_sharepointonline: {
          api: {
            id: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
            name: 'shared_sharepointonline',
          },
          connection: {
            name: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline/connections/shared-sharepointonline-1',
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

test('flow editor schema index discovers connector actions from outline ranges', () => {
  const source = flowSource({ dataset: '' });
  const analysis = analyzeFlow(source, source.indexOf('dataset'));
  const targets = collectFlowEditorSchemaTargets(source, analysis);

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.name, 'Get_items');
  assert.equal(targets[0]?.operationRef.operationId, 'GetItems');
  assert.equal(targets[0]?.operationRef.apiName, 'shared_sharepointonline');
  assert.equal(targets[0]?.operationRef.connectionName, 'shared-sharepointonline-1');
});

test('flow editor schema targets prefer canonical API ids over Flow detail aliases', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_commondataserviceforapps: {
          connectionName: 'shared-commondataser-da8725a8',
          id: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
          displayName: 'Microsoft Dataverse',
          apiName: 'commondataserviceforapps',
        },
      },
      definition: {
        actions: {
          List_accounts: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: 'shared_commondataserviceforapps',
                operationId: 'ListRecords',
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
  const analysis = analyzeFlow(source, source.indexOf('entityName'));
  const target = collectFlowEditorSchemaTargets(source, analysis)[0];
  assert.ok(target);

  assert.equal(target.operationRef.apiId, '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps');
  assert.equal(target.operationRef.apiName, 'shared_commondataserviceforapps');
  assert.equal(target.operationRef.apiRef, '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps');
  assert.equal(target.operationRef.connectionName, 'shared-commondataser-da8725a8');
  assert.equal(dynamicApiRef(target.operationRef, { apiName: 'commondataserviceforapps', operationId: 'ListRecords', fields: [] }), '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps');
});

test('flow editor schema completions suggest connector parameter keys and dynamic values', () => {
  const keySource = flowSource({ dat: '' });
  const keyAnalysis = analyzeFlow(keySource, keySource.indexOf('"dat"') + 4);
  const target = collectFlowEditorSchemaTargets(keySource, keyAnalysis)[0];
  assert.ok(target);

  const datasetField = {
    name: 'dataset',
    location: 'parameter',
    path: ['inputs', 'parameters', 'dataset'],
    required: true,
    type: 'string',
    title: 'Site Address',
  };
  const tableField = {
    name: 'table',
    location: 'parameter',
    path: ['inputs', 'parameters', 'table'],
    required: true,
    type: 'string',
    title: 'List Name',
  };
  const entry: FlowEditorSchemaActionEntry = {
    ...target,
    schema: {
      apiName: 'shared_sharepointonline',
      operationId: 'GetItems',
      fields: [datasetField, tableField],
    },
    fields: [datasetField, tableField],
    options: {
      [fieldSchemaKey(datasetField)]: [
        {
          value: 'https://contoso.sharepoint.com/sites/Team',
          title: 'Team Site',
        },
      ],
    },
    status: 'ready',
  };
  const index = buildFlowEditorSchemaIndex([entry], false);

  const keyCompletions = flowEditorSchemaCompletionItems(keySource.indexOf('"dat"') + 4, keyAnalysis, index);
  assert.ok(keyCompletions.some((item) => item.label === 'dataset' && item.kind === 'property'));

  const valueSource = flowSource({ dataset: 'ht' });
  const valueAnalysis = analyzeFlow(valueSource, valueSource.indexOf('"ht"') + 3);
  const valueCompletions = flowEditorSchemaCompletionItems(valueSource.indexOf('"ht"') + 3, valueAnalysis, index);
  assert.ok(valueCompletions.some((item) => item.label.includes('Team Site') && item.insertText.includes('contoso')));
});
