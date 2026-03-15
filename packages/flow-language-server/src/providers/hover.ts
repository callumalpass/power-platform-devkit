import { type Hover, type Position } from 'vscode-languageserver';
import * as jsonc from 'jsonc-parser';
import { type DocumentState } from '../document-store.js';
import { getJsonPathAtOffset } from '../position-bridge.js';

export function provideHover(state: DocumentState, position: Position): Hover | null {
  if (!state.tree || !state.ir) return null;

  const offset = positionToOffset(state.text, position);
  const path = getJsonPathAtOffset(state.tree, offset);

  if (path.length === 0) return null;

  const nodeMap = new Map(state.ir.nodes.map((n) => [n.name, n]));

  // definition.actions.<name> → action/scope info
  if (path[0] === 'definition' && path[1] === 'actions' && typeof path[2] === 'string' && path.length === 3) {
    const name = path[2];
    const node = nodeMap.get(name);
    if (node) {
      const lines = [
        `**${node.name}** (${node.kind}${node.type ? `: ${node.type}` : ''})`,
        `- runAfter: ${node.runAfter.length > 0 ? node.runAfter.join(', ') : '(none)'}`,
      ];
      if (node.childIds.length > 0) {
        lines.push(`- children: ${node.childIds.length}`);
      }
      return { contents: { kind: 'markdown', value: lines.join('\n') } };
    }
  }

  // definition.triggers.<name>
  if (path[0] === 'definition' && path[1] === 'triggers' && typeof path[2] === 'string' && path.length === 3) {
    const name = path[2];
    const node = nodeMap.get(name);
    if (node) {
      return {
        contents: {
          kind: 'markdown',
          value: `**${node.name}** (trigger${node.type ? `: ${node.type}` : ''})`,
        },
      };
    }
  }

  // definition.actions.<name>.inputs.host.apiId
  if (
    path[0] === 'definition' && path[1] === 'actions' && typeof path[2] === 'string' &&
    path[3] === 'inputs' && path[4] === 'host' && path[5] === 'apiId'
  ) {
    const valueNode = jsonc.findNodeAtLocation(state.tree, path);
    if (valueNode?.value) {
      return { contents: { kind: 'markdown', value: `**Connector API**: \`${valueNode.value as string}\`` } };
    }
  }

  // definition.actions.<name>.inputs.operationId
  if (
    path[0] === 'definition' && path[1] === 'actions' && typeof path[2] === 'string' &&
    path[3] === 'inputs' && path[4] === 'operationId'
  ) {
    const valueNode = jsonc.findNodeAtLocation(state.tree, path);
    if (valueNode?.value) {
      return { contents: { kind: 'markdown', value: `**Operation**: \`${valueNode.value as string}\`` } };
    }
  }

  // metadata.connectionReferences.<idx>
  if (path[0] === 'metadata' && path[1] === 'connectionReferences' && typeof path[2] === 'number') {
    const connRef = state.artifact?.metadata.connectionReferences[path[2]];
    if (connRef) {
      const lines = [`**Connection Reference**: ${connRef.name ?? '(unnamed)'}`];
      if (connRef.apiId) lines.push(`- apiId: \`${connRef.apiId}\``);
      return { contents: { kind: 'markdown', value: lines.join('\n') } };
    }
  }

  return null;
}

function positionToOffset(text: string, position: Position): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line && i < lines.length; i++) {
    offset += (lines[i]?.length ?? 0) + 1; // +1 for '\n'
  }
  offset += position.character;
  return offset;
}
