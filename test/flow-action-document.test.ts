import test from 'node:test';
import assert from 'node:assert/strict';
import { addTriggerToFlowDocument, buildApiOperationTrigger, topLevelTriggerNames, uniqueTriggerName } from '../src/ui-react/automate/flow-action-document.js';
import type { FlowAnalysis, FlowApiOperation, FlowApiOperationSchema } from '../src/ui-react/ui-types.js';

const dataverseTriggerOperation: FlowApiOperation = {
  name: 'SubscribeWebhookTrigger',
  operationType: 'OpenApiConnection',
  apiName: 'shared_commondataserviceforapps',
  apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
  hasConnectorSchema: true
};

const schema: FlowApiOperationSchema = {
  apiName: 'shared_commondataserviceforapps',
  operationId: 'SubscribeWebhookTrigger',
  fields: [
    { name: 'entityName', location: 'parameter', required: true, defaultValue: 'accounts' },
    { name: 'scope', location: 'parameter', required: true, enum: ['Organization', 'User'] }
  ]
};

test('addTriggerToFlowDocument adds triggers to Power Automate wrapper definitions', () => {
  const source = JSON.stringify({
    properties: {
      definition: {
        actions: {}
      }
    }
  });

  const updated = addTriggerToFlowDocument(source, 'Recurrence', {
    type: 'Recurrence',
    recurrence: { frequency: 'Day', interval: 1 }
  });
  const parsed = JSON.parse(updated);

  assert.deepEqual(parsed.properties.definition.triggers.Recurrence, {
    type: 'Recurrence',
    recurrence: { frequency: 'Day', interval: 1 }
  });
});

test('buildApiOperationTrigger creates connector triggers without runAfter', () => {
  type ConnectorTrigger = { type?: string; runAfter?: unknown; inputs: { host: unknown; parameters: unknown } };
  const trigger = buildApiOperationTrigger(JSON.stringify({ properties: { connectionReferences: {} } }), dataverseTriggerOperation, schema, 'shared_commondataserviceforapps') as ConnectorTrigger;

  assert.equal(trigger.type, 'OpenApiConnection');
  assert.equal(trigger.runAfter, undefined);
  assert.deepEqual(trigger.inputs.host, {
    connectionReferenceName: 'shared_commondataserviceforapps',
    operationId: 'SubscribeWebhookTrigger',
    apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps'
  });
  assert.deepEqual(trigger.inputs.parameters, {
    entityName: 'accounts',
    scope: 'Organization'
  });

  const defaultReferenceTrigger = buildApiOperationTrigger(JSON.stringify({ properties: { connectionReferences: {} } }), dataverseTriggerOperation);
  assert.deepEqual((defaultReferenceTrigger as ConnectorTrigger).inputs.host, {
    connectionReferenceName: 'shared_commondataserviceforapps',
    operationId: 'SubscribeWebhookTrigger',
    apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps'
  });
});

test('topLevelTriggerNames and uniqueTriggerName read the trigger outline/document', () => {
  const analysis: FlowAnalysis = {
    outline: [
      {
        kind: 'workflow',
        name: 'workflow',
        children: [
          {
            kind: 'trigger',
            name: 'triggers',
            children: [
              { kind: 'trigger', name: 'manual' },
              { kind: 'trigger', name: 'Recurrence' }
            ]
          }
        ]
      }
    ]
  };
  const source = JSON.stringify({ triggers: { manual: {}, Recurrence: {} }, actions: {} });

  assert.deepEqual(topLevelTriggerNames(analysis), ['manual', 'Recurrence']);
  assert.equal(uniqueTriggerName(source, 'manual'), 'manual_2');
});
