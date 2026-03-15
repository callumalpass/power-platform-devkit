import { DiagnosticSeverity, type Diagnostic as LspDiagnostic } from 'vscode-languageserver';
import { type DocumentState } from '../document-store.js';
import { getRangeForPath, offsetsToRange } from '../position-bridge.js';

const FALLBACK_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

export function convertDiagnostics(state: DocumentState): LspDiagnostic[] {
  if (!state.validation || !state.tree) return [];

  const result: LspDiagnostic[] = [];
  const allDiagnostics = [
    ...state.validation.diagnostics.map((d) => ({ ...d, severity: DiagnosticSeverity.Error })),
    ...state.validation.warnings.map((d) => ({ ...d, severity: DiagnosticSeverity.Warning })),
  ];

  for (const diag of allDiagnostics) {
    const range =
      diag.path && state.tree
        ? (getRangeForPath(state.tree, diag.path, state.text) ?? FALLBACK_RANGE)
        : FALLBACK_RANGE;

    result.push({
      range,
      severity: diag.severity,
      code: diag.code,
      source: diag.source ?? '@pp/flow',
      message: diag.message,
    });
  }

  return result;
}
