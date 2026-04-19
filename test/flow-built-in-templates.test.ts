import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WDL_ACTION_TYPES,
  WDL_TRIGGER_TYPES,
  buildBuiltInAction,
  buildBuiltInTrigger,
  builtInFieldsForAction,
} from '../src/ui-react/automate/flow-built-in-templates.js';
import type { FlowApiOperation } from '../src/ui-react/ui-types.js';

function builtInOperation(name: string, operationType: string): FlowApiOperation {
  return { name, operationType, isBuiltIn: true, hasConnectorSchema: false };
}

test('built-in catalog maps catalog operations to WDL action shapes', () => {
  assert.deepEqual(
    buildBuiltInAction(builtInOperation('TableHtml', 'Table')),
    { type: 'Table', inputs: { from: '', format: 'HTML' } },
  );

  assert.deepEqual(
    buildBuiltInAction(builtInOperation('AddToTime', 'Expression')),
    { type: 'Compose', inputs: "@addToTime('', 1, 'Hour')" },
  );

  assert.deepEqual(
    buildBuiltInAction(builtInOperation('DelayUntil', 'Wait')),
    { type: 'Wait', inputs: { until: { timestamp: '' } } },
  );
});

test('built-in catalog maps trigger operations to WDL trigger shapes', () => {
  assert.deepEqual(
    buildBuiltInTrigger(builtInOperation('Recurrence', 'Recurrence')),
    { type: 'Recurrence', recurrence: { frequency: 'Day', interval: 1 } },
  );

  assert.deepEqual(
    buildBuiltInTrigger(builtInOperation('Manual', 'Request')),
    { type: 'Request', kind: 'Button', inputs: { schema: { type: 'object', properties: {}, required: [] } } },
  );
});

test('built-in field definitions cover structured edit-only action types', () => {
  assert.deepEqual(
    builtInFieldsForAction({ type: 'ParseJson', inputs: { content: '', schema: {} } }).map((field) => field.path.join('.')),
    ['inputs.content', 'inputs.schema'],
  );

  assert.deepEqual(
    builtInFieldsForAction({ type: 'Wait', inputs: { interval: { count: 1, unit: 'Minute' } } }).map((field) => field.path.join('.')),
    ['inputs.interval.count', 'inputs.interval.unit'],
  );

  assert.deepEqual(
    builtInFieldsForAction({ type: 'SetVariable', inputs: { name: '', value: '' } }).map((field) => field.path.join('.')),
    ['inputs.name', 'inputs.value'],
  );

  assert.deepEqual(
    builtInFieldsForAction({ type: 'Recurrence', recurrence: { frequency: 'Day', interval: 1 } }).map((field) => field.path.join('.')),
    ['recurrence.frequency', 'recurrence.interval', 'recurrence.startTime', 'recurrence.timeZone', 'recurrence.schedule'],
  );
});

test('WDL action type list includes known non-connector built-ins', () => {
  for (const type of ['HttpWebhook', 'Join', 'ParseJson', 'Table', 'Terminate', 'Wait', 'Workflow']) {
    assert.ok(WDL_ACTION_TYPES.includes(type as never), `${type} should be offered as an action type`);
  }
});

test('WDL trigger type list includes known trigger primitives', () => {
  for (const type of ['OpenApiConnection', 'Recurrence', 'Request']) {
    assert.ok(WDL_TRIGGER_TYPES.includes(type as never), `${type} should be offered as a trigger type`);
  }
});
