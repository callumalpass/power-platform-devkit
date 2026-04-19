import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFlowOperationSearchBody,
  extractFlowCallbackUrl,
  flowActivationRequest,
  flowCallbackTriggerNames,
  flowIdentifier,
  flowRuntimeId,
  flowRunTriggerNames,
  flowValidationFromError,
  flowWorkflowId,
  normalizeDataverseFlow,
  sameFlowIdentity,
} from '../src/ui-react/automate-data.js';
import { ApiRequestError } from '../src/ui-react/utils.js';

test('flow validation normalizes Power Automate checker descriptions', () => {
  const raw = [
    {
      errorDescription: "The input parameter(s) of operation 'TEST' contains invalid expression(s).",
      operationName: 'TEST',
      fixInstructions: {
        markdownText: "Fix invalid expression(s) for the input parameter(s) of operation 'TEST'.",
        textTemplate: "Fix invalid expression(s) for the input parameter(s) of operation '{0}'.",
        messageId: 'message2',
        messageArguments: ['TEST'],
      },
      ruleId: 'OperationExpression',
    },
  ];

  const result = flowValidationFromError('errors', new ApiRequestError('Request failed', raw, 400));

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].level, 'error');
  assert.equal(result.items[0].code, 'OperationExpression');
  assert.equal(result.items[0].actionName, 'TEST');
  assert.equal(result.items[0].message, "The input parameter(s) of operation 'TEST' contains invalid expression(s).");
});

test('flow callback URL extraction supports connector and flow property envelopes', () => {
  assert.equal(
    extractFlowCallbackUrl({ response: { value: 'https://example.test/manual?sig=secret' } }),
    'https://example.test/manual?sig=secret',
  );
  assert.equal(
    extractFlowCallbackUrl({ value: 'https://example.test/value' }),
    'https://example.test/value',
  );
  assert.equal(
    extractFlowCallbackUrl({ properties: { flowTriggerUri: 'https://example.test/from-flow' } }),
    'https://example.test/from-flow',
  );
});

test('flow callback trigger names prefer definition trigger keys with manual fallback', () => {
  const source = JSON.stringify({
    properties: {
      definition: {
        triggers: {
          When_a_HTTP_request_is_received: { type: 'Request' },
          manual: { type: 'Request' },
        },
      },
    },
  });
  const flow = {
    source: 'flow' as const,
    name: 'flow-id',
    properties: {
      definitionSummary: {
        triggers: [{ name: 'summaryTrigger', type: 'Request' }],
        actions: [],
      },
    },
  };

  assert.deepEqual(flowCallbackTriggerNames(flow, source), ['When_a_HTTP_request_is_received', 'manual', 'summaryTrigger']);
});

test('flow callback trigger names falls back to manual when no definition names are available', () => {
  assert.deepEqual(flowCallbackTriggerNames({ source: 'flow', name: 'flow-id' }, ''), ['manual']);
});

test('flow run trigger names use recurrence trigger from definition', () => {
  const source = JSON.stringify({
    properties: {
      definition: {
        triggers: {
          Recurrence: { type: 'Recurrence' },
        },
      },
    },
  });

  assert.deepEqual(flowRunTriggerNames({ source: 'flow', name: 'flow-id' }, source), ['Recurrence']);
});

test('flow run trigger names use trigger URI when definition names are unavailable', () => {
  const flow = {
    source: 'flow' as const,
    name: 'flow-id',
    properties: {
      flowTriggerUri: 'https://example.test/providers/Microsoft.ProcessSimple/environments/env/flows/runtime-id/triggers/Recurrence/run?api-version=2016-11-01',
    },
  };

  assert.deepEqual(flowRunTriggerNames(flow, ''), ['Recurrence']);
});

test('flow identity helpers separate workflow ids from runtime ids', () => {
  const flow = {
    source: 'flow' as const,
    name: 'workflow-id',
    properties: {
      workflowEntityId: 'workflow-id',
      resourceId: '/providers/Microsoft.ProcessSimple/environments/env/flows/runtime-id',
      flowTriggerUri: 'https://example.test/providers/Microsoft.ProcessSimple/environments/env/flows/runtime-id/triggers/Recurrence/run?api-version=2016-11-01',
    },
  };

  assert.equal(flowIdentifier(flow), 'workflow-id');
  assert.equal(flowWorkflowId(flow), 'workflow-id');
  assert.equal(flowRuntimeId(flow), 'runtime-id');
  assert.equal(sameFlowIdentity(flow, { source: 'flow', name: 'runtime-id' }), true);
});

test('flow activation requests prefer Dataverse workflow state when workflow id is known', () => {
  assert.deepEqual(
    flowActivationRequest({ source: 'flow', name: 'runtime-id', properties: { workflowEntityId: 'workflow-id' } }, true),
    {
      api: 'dv',
      method: 'PATCH',
      path: '/workflows(workflow-id)',
      body: { statecode: 1 },
      responseType: 'void',
    },
  );
  assert.deepEqual(
    flowActivationRequest({ source: 'flow', name: 'runtime-id' }, false),
    {
      api: 'flow',
      method: 'POST',
      path: '/flows/runtime-id/stop',
    },
  );
});

test('Dataverse flow fallback maps statecode 1 to Started and 0 to Stopped', () => {
  assert.equal(normalizeDataverseFlow({ name: 'On flow', workflowid: 'on-id', statecode: 1 }).properties?.state, 'Started');
  assert.equal(normalizeDataverseFlow({ name: 'Off flow', workflowid: 'off-id', statecode: 0 }).properties?.state, 'Stopped');
});

test('flow operation catalog search body separates actions from triggers', () => {
  assert.deepEqual(buildFlowOperationSearchBody(' rows ', 'action'), {
    searchText: 'rows',
    visibleHideKeys: [],
    allTagsToInclude: ['Action', 'Important'],
    anyTagsToExclude: ['Deprecated', 'Agentic', 'Trigger'],
  });
  assert.deepEqual(buildFlowOperationSearchBody(' event ', 'trigger'), {
    searchText: 'event',
    visibleHideKeys: [],
    allTagsToInclude: ['Trigger'],
    anyTagsToExclude: ['Deprecated', 'Agentic', 'Action'],
  });
});
