import * as jsonc from 'jsonc-parser';
import { type Position, type Range } from 'vscode-languageserver';

/** "definition.actions.MyAction.runAfter.0" → ['definition','actions','MyAction','runAfter',0] */
export function parseSemanticPath(path: string): (string | number)[] {
  return path.split('.').map((segment) => {
    const n = Number(segment);
    return Number.isInteger(n) && String(n) === segment ? n : segment;
  });
}

/** Convert a character offset + length in a text string to an LSP Range */
export function offsetsToRange(text: string, offset: number, length: number): Range {
  return {
    start: offsetToPosition(text, offset),
    end: offsetToPosition(text, offset + length),
  };
}

function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

/**
 * Find the LSP Range for a semantic dot-separated path in the document.
 * Falls back to nearest ancestor if exact node doesn't exist.
 */
export function getRangeForPath(root: jsonc.Node, path: string, text: string): Range | undefined {
  const segments = parseSemanticPath(path);

  // Try exact path first, then progressively shorter ancestors
  for (let len = segments.length; len > 0; len--) {
    const node = jsonc.findNodeAtLocation(root, segments.slice(0, len));
    if (node) {
      return offsetsToRange(text, node.offset, node.length);
    }
  }

  return undefined;
}

/**
 * Get the JSON path segments at a given text offset (for hover/completion/definition).
 */
export function getJsonPathAtOffset(root: jsonc.Node, offset: number): (string | number)[] {
  const node = jsonc.findNodeAtOffset(root, offset);
  if (!node) return [];
  return jsonc.getNodePath(node);
}
