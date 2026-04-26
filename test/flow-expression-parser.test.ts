import test from 'node:test';
import assert from 'node:assert/strict';
import { findDeepestFlowExpressionNodeEndingAt, flowExpressionAccessSegments, flowExpressionNodeText, parseFlowExpression } from '../src/flow-expression-parser.js';

test('flow expression parser reads function calls, escaped strings, and access chains', () => {
  const call = parseFlowExpression("body('Bob''s_action')");
  assert.equal(call?.kind, 'call');
  assert.equal(call?.kind === 'call' ? call.name : undefined, 'body');
  assert.equal(call?.kind === 'call' && call.args[0]?.kind === 'string' ? call.args[0].value : undefined, "Bob's_action");

  const access = parseFlowExpression("outputs('Get_items')?['body']?['value']");
  assert.equal(access?.kind, 'access');
  assert.deepEqual(access ? flowExpressionAccessSegments(access) : [], ['body', 'value']);

  const dotted = parseFlowExpression('workflow().run.name');
  assert.equal(dotted?.kind, 'access');
  assert.deepEqual(dotted ? flowExpressionAccessSegments(dotted) : [], ['run', 'name']);
});

test('flow expression parser can find the nested expression before an incomplete accessor', () => {
  const nested = "coalesce(body('Get_current_user')";
  const nestedRoot = parseFlowExpression(nested);
  const nestedBase = findDeepestFlowExpressionNodeEndingAt(nestedRoot, nested.length);
  assert.equal(nestedBase ? flowExpressionNodeText(nested, nestedBase) : undefined, "body('Get_current_user')");

  const lengthArg = "length(body('List_accounts')";
  const lengthRoot = parseFlowExpression(lengthArg);
  const lengthBase = findDeepestFlowExpressionNodeEndingAt(lengthRoot, lengthArg.length);
  assert.equal(lengthBase ? flowExpressionNodeText(lengthArg, lengthBase) : undefined, "body('List_accounts')");
});

test('flow expression parser keeps collection coercion calls as the accessor base', () => {
  const source = "first(body('List_accounts')?['value'])";
  const root = parseFlowExpression(source);
  const base = findDeepestFlowExpressionNodeEndingAt(root, source.length);
  assert.equal(base ? flowExpressionNodeText(source, base) : undefined, source);
  assert.equal(base?.kind, 'call');
  assert.equal(base?.kind === 'call' ? base.name : undefined, 'first');
});
