import { analyzeFlow, explainFlowSymbol } from './flow-language.js';
export class FlowLanguageService {
    analyze(request) {
        return analyzeFlow(request.source, request.cursor);
    }
    explain(request) {
        return explainFlowSymbol(request.source, request.symbolName);
    }
}
