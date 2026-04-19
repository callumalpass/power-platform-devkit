import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFlow } from '../src/flow-language.js';
import {
  buildFlowEditorSchemaIndex,
  collectFlowEditorSchemaTargets,
  flowEditorExpressionSchemaCompletionItems,
  flowEditorSchemaCompletionItems,
  type FlowEditorSchemaActionEntry,
} from '../src/ui-react/automate/flow-editor-schema-index.js';
import { dynamicApiRef, fieldSchemaKey } from '../src/ui-react/automate/flow-dynamic-schema.js';
import type { FlowApiOperationSchemaField } from '../src/ui-react/ui-types.js';

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

function currentUserEntry(): FlowEditorSchemaActionEntry {
  return {
    name: 'Get_current_user',
    from: 0,
    to: 0,
    action: {},
    operationRef: {
      apiRef: '/providers/Microsoft.PowerApps/apis/shared_office365users',
      apiName: 'shared_office365users',
      operationId: 'MyProfile_V2',
    },
    schema: {
      apiName: 'shared_office365users',
      operationId: 'MyProfile_V2',
      fields: [],
      responses: [{
        statusCode: '200',
        schema: {
          type: 'object',
          properties: {
            body: {
              type: 'object',
              properties: {
                displayName: {
                  type: 'string',
                  title: 'Display name',
                },
                userPrincipalName: {
                  type: 'string',
                  title: 'User Principal Name',
                },
              },
            },
          },
        },
        bodySchema: {
          type: 'object',
          properties: {
            displayName: {
              type: 'string',
              title: 'Display name',
            },
            userPrincipalName: {
              type: 'string',
              title: 'User Principal Name',
            },
          },
        },
      }],
    },
    fields: [],
    options: {},
    status: 'ready',
  };
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

test('flow editor expression schema completions suggest static and dynamic output accessors', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_commondataserviceforapps: {
          connectionName: 'shared-commondataser-da8725a8',
          api: {
            id: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
            name: 'shared_commondataserviceforapps',
          },
          connection: {
            name: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps/connections/shared-commondataser-da8725a8',
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
          List_accounts: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: 'shared_commondataserviceforapps',
                operationId: 'ListRecords',
              },
              parameters: {
                entityName: 'accounts',
                '$select': 'name,accountid',
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

  const accountIdField: FlowApiOperationSchemaField = {
    name: 'accountid',
    location: 'output',
    path: ['body', 'value', 'accountid'],
    type: 'string',
    title: 'Account',
    description: 'Unique identifier of the account.',
    visibility: 'advanced',
  };
  const quotedField: FlowApiOperationSchemaField = {
    name: "Bob's Field",
    location: 'output',
    path: ['body', 'value', "Bob's Field"],
    type: 'string',
    title: "Bob's Field",
  };
  const entry: FlowEditorSchemaActionEntry = {
    ...target,
    schema: {
      apiName: 'shared_commondataserviceforapps',
      operationId: 'ListRecords',
      fields: [],
      responses: [{
        statusCode: '200',
        schema: {
          type: 'object',
          properties: {
            body: {
              type: 'object',
              properties: {
                value: {
                  type: 'array',
                  description: 'List of Items',
                  items: {
                    type: 'object',
                    'x-ms-dynamic-properties': {
                      operationId: 'GetMetadataForGetEntity',
                      parameters: {
                        entityName: { parameterReference: 'entityName', required: true },
                        selectedEntityAttributes: { parameterReference: '$select', required: false },
                      },
                      itemValuePath: 'schema',
                    },
                  },
                  'x-ms-property-name-alias': 'body/value',
                },
                '@odata.nextLink': {
                  type: 'string',
                  title: 'Next link',
                  'x-ms-visibility': 'advanced',
                },
              },
            },
          },
        },
        bodySchema: {
          type: 'object',
          properties: {
            value: {
              type: 'array',
              description: 'List of Items',
              items: {
                type: 'object',
                'x-ms-dynamic-properties': {
                  operationId: 'GetMetadataForGetEntity',
                  parameters: {
                    entityName: { parameterReference: 'entityName', required: true },
                    selectedEntityAttributes: { parameterReference: '$select', required: false },
                  },
                  itemValuePath: 'schema',
                },
              },
              'x-ms-property-name-alias': 'body/value',
            },
            '@odata.nextLink': {
              type: 'string',
              title: 'Next link',
              'x-ms-visibility': 'advanced',
            },
          },
        },
      }],
    },
    fields: [],
    options: {},
    outputFields: {
      'body/value': [accountIdField, quotedField],
    },
    status: 'ready',
  };
  const index = buildFlowEditorSchemaIndex([entry, currentUserEntry()], false);

  const bodyRoot = "@body('List_accounts')?['";
  const bodyRootCompletions = flowEditorExpressionSchemaCompletionItems(bodyRoot, bodyRoot.length, index);
  assert.ok(bodyRootCompletions.some((item) => item.label === 'value' && item.insertText === 'value'));
  assert.ok(bodyRootCompletions.some((item) => item.label === '@odata.nextLink'));

  const bodyItem = "@body('List_accounts')?['value']?['acco";
  const bodyItemCompletions = flowEditorExpressionSchemaCompletionItems(bodyItem, bodyItem.length, index);
  assert.deepEqual(bodyItemCompletions.map((item) => item.label), ['accountid']);
  assert.equal(bodyItemCompletions[0]?.detail, 'Dynamic output · Account · string');

  const outputItem = "@outputs('List_accounts')?['body']?['value']?['Bob";
  const outputItemCompletions = flowEditorExpressionSchemaCompletionItems(outputItem, outputItem.length, index);
  assert.equal(outputItemCompletions[0]?.label, "Bob's Field");
  assert.equal(outputItemCompletions[0]?.insertText, "Bob''s Field");

  const nestedLength = "@length(body('List_accounts')?['val";
  const nestedLengthCompletions = flowEditorExpressionSchemaCompletionItems(nestedLength, nestedLength.length, index);
  assert.deepEqual(nestedLengthCompletions.map((item) => item.label), ['value']);

  const coalescedUser = "@coalesce(body('Get_current_user')?['disp";
  const coalescedUserCompletions = flowEditorExpressionSchemaCompletionItems(coalescedUser, coalescedUser.length, index);
  assert.deepEqual(coalescedUserCompletions.map((item) => item.label), ['displayName']);
  assert.equal(coalescedUserCompletions[0]?.detail, 'Output · Display name · string');

  const firstAccount = "@first(body('List_accounts')?['value'])?['acco";
  const firstAccountCompletions = flowEditorExpressionSchemaCompletionItems(firstAccount, firstAccount.length, index);
  assert.deepEqual(firstAccountCompletions.map((item) => item.label), ['accountid']);
});

test('flow editor expression schema completions walk static array item response schemas', () => {
  const source = JSON.stringify({
    properties: {
      connectionReferences: {
        shared_office365users: {
          connectionName: 'office-connection',
          api: {
            id: '/providers/Microsoft.PowerApps/apis/shared_office365users',
            name: 'shared_office365users',
          },
          connection: {
            name: '/providers/Microsoft.PowerApps/apis/shared_office365users/connections/office-connection',
          },
        },
      },
      definition: {
        actions: {
          Search_users: {
            type: 'OpenApiConnection',
            inputs: {
              host: {
                connectionReferenceName: 'shared_office365users',
                operationId: 'SearchUserV2',
              },
              parameters: {
                searchTerm: 'callum',
              },
            },
            runAfter: {},
          },
        },
      },
    },
  }, null, 2);
  const analysis = analyzeFlow(source, source.indexOf('searchTerm'));
  const target = collectFlowEditorSchemaTargets(source, analysis)[0];
  assert.ok(target);

  const entry: FlowEditorSchemaActionEntry = {
    ...target,
    schema: {
      apiName: 'shared_office365users',
      operationId: 'SearchUserV2',
      fields: [],
      responses: [{
        statusCode: '200',
        schema: {
          type: 'object',
          properties: {
            body: {
              type: 'object',
              properties: {
                value: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      DisplayName: {
                        type: 'string',
                        title: 'Display name',
                        description: 'The name displayed in the address book.',
                      },
                      UserPrincipalName: {
                        type: 'string',
                        title: 'User Principal Name (UPN)',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        bodySchema: {
          type: 'object',
          properties: {
            value: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  DisplayName: {
                    type: 'string',
                    title: 'Display name',
                    description: 'The name displayed in the address book.',
                  },
                  UserPrincipalName: {
                    type: 'string',
                    title: 'User Principal Name (UPN)',
                  },
                },
              },
            },
          },
        },
      }],
    },
    fields: [],
    options: {},
    status: 'ready',
  };
  const index = buildFlowEditorSchemaIndex([entry], false);

  const sourceText = "@body('Search_users')?['value']?['Display";
  const completions = flowEditorExpressionSchemaCompletionItems(sourceText, sourceText.length, index);
  assert.deepEqual(completions.map((item) => item.label), ['DisplayName']);
  assert.equal(completions[0]?.detail, 'Output · Display name · string');
});
