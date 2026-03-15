import { SymbolKind, type DocumentSymbol } from 'vscode-languageserver';
import { type DocumentState } from '../document-store.js';
import { getRangeForPath } from '../position-bridge.js';
import { type FlowIntermediateNode } from '@pp/flow';

const FALLBACK_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

function nodeKindToSymbolKind(kind: FlowIntermediateNode['kind']): SymbolKind {
  switch (kind) {
    case 'trigger': return SymbolKind.Event;
    case 'scope': return SymbolKind.Module;
    case 'action': return SymbolKind.Function;
    default: return SymbolKind.Object;
  }
}

function buildSymbol(node: FlowIntermediateNode, state: DocumentState, allNodes: Map<string, FlowIntermediateNode>): DocumentSymbol {
  const range = state.tree
    ? (getRangeForPath(state.tree, node.path, state.text) ?? FALLBACK_RANGE)
    : FALLBACK_RANGE;

  const children: DocumentSymbol[] = [];
  for (const childId of node.childIds) {
    const child = allNodes.get(childId);
    if (child) {
      children.push(buildSymbol(child, state, allNodes));
    }
  }

  return {
    name: node.name,
    kind: nodeKindToSymbolKind(node.kind),
    range,
    selectionRange: range,
    children: children.length > 0 ? children : undefined,
  };
}

export function provideSymbols(state: DocumentState): DocumentSymbol[] {
  if (!state.ir) return [];

  const allNodes = new Map<string, FlowIntermediateNode>(
    state.ir.nodes.map((n) => [n.id, n])
  );

  // Root-level nodes: those with no parentId
  return state.ir.nodes
    .filter((n) => !n.parentId)
    .map((n) => buildSymbol(n, state, allNodes));
}
