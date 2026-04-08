import { readFile } from 'node:fs/promises';
import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';
import { FlowLanguageService } from '../flow-language-service.js';
import type { FlowAnalysisResult, FlowExplainResult } from '../flow-language.js';

const service = new FlowLanguageService();

export async function analyzeFlowFile(filePath: string): Promise<OperationResult<FlowAnalysisResult>> {
  try {
    const source = await readFile(filePath, 'utf8');
    return ok(service.analyze({ source, cursor: 0 }));
  } catch (error) {
    return fail(
      createDiagnostic('error', 'FLOW_FILE_READ_FAILED', `Failed to read ${filePath}.`, {
        source: 'pp/services/flow-language',
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function explainFlowFileSymbol(filePath: string, symbolName: string): Promise<OperationResult<FlowExplainResult>> {
  try {
    const source = await readFile(filePath, 'utf8');
    return ok(service.explain({ source, symbolName }));
  } catch (error) {
    return fail(
      createDiagnostic('error', 'FLOW_FILE_READ_FAILED', `Failed to read ${filePath}.`, {
        source: 'pp/services/flow-language',
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
