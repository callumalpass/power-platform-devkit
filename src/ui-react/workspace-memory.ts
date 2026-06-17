import type { TabName } from './app-tabs.js';
import type { DataverseState } from './ui-types.js';

const WORKSPACE_MEMORY_KEY = 'pp-workspace-memory-v1';

export type WorkspaceMemory = {
  activeTab?: TabName;
  dataverseSubTab?: DataverseState['dvSubTab'];
  dataverseExplorerSubTab?: DataverseState['explorerSubTab'];
};

type WorkspaceMemoryMap = Record<string, WorkspaceMemory>;

export function readWorkspaceMemory(environmentAlias: string): WorkspaceMemory | undefined {
  if (!environmentAlias || typeof localStorage === 'undefined') return undefined;
  return readMemoryMap()[environmentAlias];
}

export function saveWorkspaceMemory(environmentAlias: string, memory: WorkspaceMemory): void {
  if (!environmentAlias || typeof localStorage === 'undefined') return;
  const current = readMemoryMap();
  current[environmentAlias] = { ...(current[environmentAlias] || {}), ...memory };
  try {
    localStorage.setItem(WORKSPACE_MEMORY_KEY, JSON.stringify(current));
  } catch {
    // Ignore quota and privacy-mode failures. Workspace memory is a convenience only.
  }
}

function readMemoryMap(): WorkspaceMemoryMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_MEMORY_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as WorkspaceMemoryMap) : {};
  } catch {
    return {};
  }
}
