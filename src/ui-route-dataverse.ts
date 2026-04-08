import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { createDiagnostic, fail, ok } from './diagnostics.js';
import { readJsonBody, sendJson } from './ui-http.js';
import { optionalBoolean, optionalInteger, optionalString, readDataverseQuerySpec, readFetchXmlLanguageRequest, readFetchXmlSpec } from './ui-request-parsing.js';
import type { UiRequestContext } from './ui-routes.js';
import { buildDataverseODataPath, buildFetchXml, executeFetchXml, getDataverseEntityDetail, listDataverseEntities, listDataverseRecords } from './services/dataverse.js';

export async function handleEntityList(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const environmentAlias = optionalString(url.searchParams.get('environment'));
  const allowInteractive = optionalBoolean(url.searchParams.get('allowInteractive')) ?? context.allowInteractiveAuth;
  if (!environmentAlias) return void sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
  const top = optionalInteger(url.searchParams.get('top'));
  const result = await listDataverseEntities({
    environmentAlias,
    accountName: optionalString(url.searchParams.get('account')),
    search: optionalString(url.searchParams.get('search')),
    top: top ?? undefined,
  }, context.configOptions, { allowInteractive });
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handleEntityDetail(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const environmentAlias = optionalString(url.searchParams.get('environment'));
  if (!environmentAlias) return void sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
  const logicalName = decodeURIComponent(url.pathname.slice('/api/dv/entities/'.length));
  const result = await getDataverseEntityDetail({ environmentAlias, logicalName, accountName: optionalString(url.searchParams.get('account')) }, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handleDataverseQueryPreview(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const spec = readDataverseQuerySpec(body.data);
  if (!spec.success || !spec.data) return void sendJson(response, 400, spec);
  sendJson(response, 200, ok({ path: buildDataverseODataPath(spec.data) }));
}

export async function handleDataverseQueryExecute(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const spec = readDataverseQuerySpec(body.data);
  if (!spec.success || !spec.data) return void sendJson(response, 400, spec);
  const result = await listDataverseRecords(spec.data, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handleFetchXmlPreview(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const spec = readFetchXmlSpec(body.data);
  if (!spec.success || !spec.data) return void sendJson(response, 400, spec);
  sendJson(response, 200, ok({ fetchXml: buildFetchXml(spec.data) }));
}

export async function handleFetchXmlExecute(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const spec = readFetchXmlSpec(body.data);
  if (!spec.success || !spec.data) return void sendJson(response, 400, spec);
  const result = await executeFetchXml(spec.data, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

export async function handleFetchXmlIntellisense(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) return void sendJson(response, 400, body);
  const languageRequest = readFetchXmlLanguageRequest(body.data);
  if (!languageRequest.success || !languageRequest.data) return void sendJson(response, 400, languageRequest);
  sendJson(response, 200, ok(await context.fetchXmlCatalog.analyze(languageRequest.data, context.configOptions)));
}
