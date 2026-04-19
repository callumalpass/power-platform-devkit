import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './ui-http.js';
import type { UiRequestContext } from './ui-routes.js';
import { loadSavedRequests, replaceSavedRequests } from './saved-requests.js';

export async function handleSavedRequestsList(response: ServerResponse, context: UiRequestContext): Promise<void> {
  const result = await loadSavedRequests(context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handleSavedRequestsReplace(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const entries = Array.isArray((body.data as any).entries) ? (body.data as any).entries : [];
  const result = await replaceSavedRequests(entries, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}
