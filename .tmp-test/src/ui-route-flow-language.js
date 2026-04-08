import { ok } from './diagnostics.js';
import { FlowLanguageService } from './flow-language-service.js';
import { readJsonBody, sendJson } from './ui-http.js';
import { readFlowLanguageRequest } from './ui-request-parsing.js';
const service = new FlowLanguageService();
export async function handleFlowLanguageAnalyze(request, response) {
    const body = await readJsonBody(request);
    if (!body.success || !body.data)
        return void sendJson(response, 400, body);
    const languageRequest = readFlowLanguageRequest(body.data);
    if (!languageRequest.success || !languageRequest.data)
        return void sendJson(response, 400, languageRequest);
    sendJson(response, 200, ok(service.analyze(languageRequest.data)));
}
