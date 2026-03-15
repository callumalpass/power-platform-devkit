import { CompletionItemKind, type CompletionItem, type Position } from 'vscode-languageserver';
import * as jsonc from 'jsonc-parser';
import { type DocumentState } from '../document-store.js';
import { getJsonPathAtOffset } from '../position-bridge.js';

export function provideCompletions(state: DocumentState, position: Position): CompletionItem[] {
  if (!state.tree || !state.ir) return [];

  const offset = positionToOffset(state.text, position);
  const path = getJsonPathAtOffset(state.tree, offset);

  // definition.actions.*.runAfter (key) → names of all other actions/triggers
  if (
    path[0] === 'definition' && path[1] === 'actions' && typeof path[2] === 'string' &&
    path[3] === 'runAfter'
  ) {
    const currentName = path[2];
    return state.ir.nodes
      .filter((n) => n.name !== currentName)
      .map((n) => ({
        label: n.name,
        kind: n.kind === 'trigger' ? CompletionItemKind.Event : CompletionItemKind.Function,
        documentation: `Kind: ${n.kind}${n.type ? `, type: ${n.type}` : ''}`,
      }));
  }

  // definition.actions.*.inputs.host.apiId → connector api IDs from IR
  if (
    path[0] === 'definition' && path[1] === 'actions' && typeof path[2] === 'string' &&
    path[3] === 'inputs' && path[4] === 'host' && path[5] === 'apiId'
  ) {
    const apiIds = new Set<string>();
    for (const node of state.ir.nodes) {
      const actionNode = jsonc.findNodeAtLocation(state.tree, ['definition', 'actions', node.name, 'inputs', 'host', 'apiId']);
      if (actionNode?.value && typeof actionNode.value === 'string') {
        apiIds.add(actionNode.value);
      }
    }
    return [...apiIds].map((id) => ({
      label: id,
      kind: CompletionItemKind.Value,
      documentation: `Connector API ID`,
    }));
  }

  // definition.parameters.$connections.value (key) → names from metadata.connectionReferences
  if (
    path[0] === 'definition' && path[1] === 'parameters' && path[2] === '$connections' &&
    path[3] === 'value'
  ) {
    return (state.artifact?.metadata.connectionReferences ?? [])
      .filter((r) => r.name)
      .map((r) => ({
        label: r.name ?? '',
        kind: CompletionItemKind.Reference,
        documentation: r.apiId ? `apiId: ${r.apiId}` : undefined,
      }));
  }

  return [];
}

function positionToOffset(text: string, position: Position): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line && i < lines.length; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  offset += position.character;
  return offset;
}
