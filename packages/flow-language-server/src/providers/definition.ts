import { type Definition, type Position } from 'vscode-languageserver';
import * as jsonc from 'jsonc-parser';
import { type DocumentState } from '../document-store.js';
import { getJsonPathAtOffset, getRangeForPath } from '../position-bridge.js';

const EXPRESSION_ACTIONS_RE = /@\{?actions\(['"]([^'"]+)['"]\)/g;
const EXPRESSION_VARIABLES_RE = /@\{?variables\(['"]([^'"]+)['"]\)/g;
const EXPRESSION_PARAMETERS_RE = /@\{?parameters\(['"]([^'"]+)['"]\)/g;

export function provideDefinition(state: DocumentState, uri: string, position: Position): Definition | null {
  if (!state.tree || !state.ir) return null;

  const offset = positionToOffset(state.text, position);
  const path = getJsonPathAtOffset(state.tree, offset);

  if (path.length === 0) return null;

  // runAfter key → jump to the referenced action/trigger
  if (
    path[0] === 'definition' && path[1] === 'actions' && typeof path[2] === 'string' &&
    path[3] === 'runAfter' && typeof path[4] === 'string'
  ) {
    return resolveToNode(state, uri, path[4]);
  }

  // Check if cursor is inside a string value — look for expression patterns
  const node = jsonc.findNodeAtOffset(state.tree, offset);
  if (node?.type === 'string' && typeof node.value === 'string') {
    const value = node.value as string;

    // @{actions('X')} or @actions('X')
    for (const match of value.matchAll(EXPRESSION_ACTIONS_RE)) {
      const name = match[1];
      if (name) return resolveToNode(state, uri, name);
    }

    // @{variables('X')} → find InitializeVariable action for X
    for (const match of value.matchAll(EXPRESSION_VARIABLES_RE)) {
      const varName = match[1];
      if (varName) {
        const initNode = state.ir.nodes.find(
          (n) => n.kind === 'action' && n.variableUsage.initializes.includes(varName)
        );
        if (initNode && state.tree) {
          const range = getRangeForPath(state.tree, initNode.path, state.text);
          if (range) return { uri, range };
        }
      }
    }

    // @{parameters('X')} → jump to metadata.parameters.X
    for (const match of value.matchAll(EXPRESSION_PARAMETERS_RE)) {
      const paramName = match[1];
      if (paramName && state.tree) {
        const range = getRangeForPath(state.tree, `metadata.parameters.${paramName}`, state.text);
        if (range) return { uri, range };
      }
    }
  }

  return null;
}

function resolveToNode(state: DocumentState, uri: string, name: string): Definition | null {
  if (!state.tree) return null;
  const node = state.ir?.nodes.find((n) => n.name === name);
  if (!node) return null;
  const range = getRangeForPath(state.tree, node.path, state.text);
  if (!range) return null;
  return { uri, range };
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
