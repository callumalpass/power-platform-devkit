import { readJsonBody, sendJson } from './ui-http.js';
import { readApiRequestInput } from './ui-request-parsing.js';
import { executeApiRequest } from './services/api.js';
export async function handleRequestExecute(request, response, context) {
    const body = await readJsonBody(request);
    if (!body.success || !body.data)
        return void sendJson(response, 400, body);
    const input = readApiRequestInput(body.data, context.allowInteractiveAuth);
    if (!input.success || !input.data)
        return void sendJson(response, 400, input);
    const result = await executeApiRequest({
        environmentAlias: input.data.environment,
        accountName: input.data.account,
        api: input.data.api,
        method: input.data.method,
        path: input.data.path,
        query: input.data.query,
        headers: input.data.headers,
        body: input.data.body,
        responseType: 'json',
        readIntent: input.data.readIntent,
    }, context.configOptions, { allowInteractive: input.data.allowInteractive });
    sendJson(response, result.success ? 200 : 400, result);
}
