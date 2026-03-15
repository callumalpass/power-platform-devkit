import * as jsonc from 'jsonc-parser';
import { buildFlowIR, validateFlowArtifactContent, type FlowArtifact, type FlowIntermediateRepresentation, type FlowValidationReport } from '@pp/flow';
import { type OperationResult } from '@pp/diagnostics';

export interface DocumentState {
  text: string;
  tree: jsonc.Node | undefined;
  artifact: FlowArtifact | undefined;
  validation: OperationResult<FlowValidationReport> | undefined;
  ir: FlowIntermediateRepresentation | undefined;
}

const cache = new Map<string, DocumentState>();

export function analyze(uri: string, text: string): DocumentState {
  const tree = jsonc.parseTree(text);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }

  const isFlowArtifact =
    typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>)['kind'] === 'pp.flow.artifact';

  if (!isFlowArtifact) {
    const state: DocumentState = { text, tree, artifact: undefined, validation: undefined, ir: undefined };
    cache.set(uri, state);
    return state;
  }

  const validation = validateFlowArtifactContent(uri, raw);
  const artifact = isFlowArtifact ? (raw as FlowArtifact) : undefined;

  let ir: FlowIntermediateRepresentation | undefined;
  if (artifact) {
    try {
      ir = buildFlowIR(artifact);
    } catch {
      ir = undefined;
    }
  }

  const state: DocumentState = { text, tree, artifact, validation, ir };
  cache.set(uri, state);
  return state;
}

export function get(uri: string): DocumentState | undefined {
  return cache.get(uri);
}

export function remove(uri: string): void {
  cache.delete(uri);
}
