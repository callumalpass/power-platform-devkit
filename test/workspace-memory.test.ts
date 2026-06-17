import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspaceMemory, saveWorkspaceMemory } from '../src/ui-react/workspace-memory.js';

test('workspace memory stores safe per-environment UI choices', () => {
  const store = new Map<string, string>();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      }
    }
  });

  try {
    saveWorkspaceMemory('dev', { activeTab: 'dataverse', dataverseSubTab: 'dv-fetchxml' });
    saveWorkspaceMemory('dev', { dataverseExplorerSubTab: 'records' });
    saveWorkspaceMemory('test', { activeTab: 'automate' });

    assert.deepEqual(readWorkspaceMemory('dev'), {
      activeTab: 'dataverse',
      dataverseSubTab: 'dv-fetchxml',
      dataverseExplorerSubTab: 'records'
    });
    assert.deepEqual(readWorkspaceMemory('test'), { activeTab: 'automate' });
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous });
  }
});
