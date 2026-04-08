import { analyzeFlow, explainFlowSymbol, type FlowAnalysisResult, type FlowExplainResult } from './flow-language.js';

export interface FlowLanguageRequest {
  source: string;
  cursor: number;
}

export interface FlowExplainRequest {
  source: string;
  symbolName: string;
}

export class FlowLanguageService {
  analyze(request: FlowLanguageRequest): FlowAnalysisResult {
    return analyzeFlow(request.source, request.cursor);
  }

  explain(request: FlowExplainRequest): FlowExplainResult {
    return explainFlowSymbol(request.source, request.symbolName);
  }
}
