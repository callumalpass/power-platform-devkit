import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRunActionOutlineItems,
  findOutlineKeyByRunActionRef,
  findRunActionForOutlineItem,
  runActionRef,
} from '../src/ui-react/automate/flow-run-outline.js';
import { outlineKey } from '../src/ui-react/automate/outline-utils.js';
import type { FlowAction, FlowAnalysisOutlineItem } from '../src/ui-react/ui-types.js';

test('run action outline preserves repeated action names as distinct selectable nodes', () => {
  const outline: FlowAnalysisOutlineItem[] = [{
    kind: 'workflow',
    name: 'workflow',
    children: [{
      kind: 'action',
      name: 'actions',
      children: [{
        kind: 'condition',
        name: 'Check_status',
        from: 10,
        to: 90,
        children: [{
          kind: 'branch',
          name: 'If: true',
          from: 40,
          to: 80,
          children: [{
            kind: 'action',
            name: 'Notify',
            from: 50,
            to: 70,
          }],
        }],
      }],
    }],
  }];
  const runActions: FlowAction[] = [
    action('Check_status', 'Succeeded', '2026-01-01T00:00:01Z', 'check'),
    action('Notify', 'Skipped', '2026-01-01T00:00:02Z', 'notify-skipped'),
    action('Notify', 'Succeeded', '2026-01-01T00:00:03Z', 'notify-succeeded'),
  ];

  const items = buildRunActionOutlineItems(outline, runActions, '');
  const condition = items.find((item) => item.name === 'Check_status');
  const branch = condition?.children?.find((item) => item.name === 'If: true');
  const decoratedNotify = branch?.children?.find((item) => item.name === 'Notify');
  const runOnly = items.find((item) => item.name === 'Run-only actions');
  const repeatedNotify = runOnly?.children?.find((item) => item.name === 'Notify');

  assert.equal(decoratedNotify?.runActionRef, runActionRef(runActions[1]!, 1));
  assert.equal(repeatedNotify?.runActionRef, runActionRef(runActions[2]!, 2));
  assert.equal(findRunActionForOutlineItem(repeatedNotify!, runActions), runActions[2]);
  assert.equal(findOutlineKeyByRunActionRef(items, runActionRef(runActions[2]!, 2)), outlineKey(repeatedNotify!));
});

test('run action outline does not make unrun duplicate-name nodes selectable by fallback', () => {
  const outline: FlowAnalysisOutlineItem[] = [{
    kind: 'workflow',
    name: 'workflow',
    children: [{
      kind: 'action',
      name: 'actions',
      children: [
        {
          kind: 'action',
          name: 'Notify',
          from: 10,
          to: 20,
        },
        {
          kind: 'action',
          name: 'Notify',
          from: 30,
          to: 40,
        },
      ],
    }],
  }];
  const runActions: FlowAction[] = [
    action('Notify', 'Succeeded', '2026-01-01T00:00:01Z', 'notify-succeeded'),
  ];

  const items = buildRunActionOutlineItems(outline, runActions, '');
  const notifyItems = items.filter((item) => item.name === 'Notify');

  assert.equal(findRunActionForOutlineItem(notifyItems[0]!, runActions), runActions[0]);
  assert.equal(findRunActionForOutlineItem(notifyItems[1]!, runActions), undefined);
});

function action(name: string, status: string, startTime: string, trackingId: string): FlowAction {
  return {
    name,
    properties: {
      status,
      type: 'Compose',
      startTime,
      endTime: startTime,
      correlation: { actionTrackingId: trackingId },
    },
  };
}
