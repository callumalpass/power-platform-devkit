import test from 'node:test';
import assert from 'node:assert/strict';
import { flowValidationFromError } from '../src/ui-react/automate-data.js';
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

