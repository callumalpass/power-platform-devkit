import { randomUUID } from 'node:crypto';
import type { ConfigStoreOptions } from '../config.js';
import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';
import { executeApiRequest } from './api.js';

export interface StartCanvasAuthoringSessionInput {
  environmentAlias: string;
  accountName?: string;
  appId: string;
  cadence?: string;
  clusterCategory?: string;
  raw?: boolean;
  allowInteractive?: boolean;
}

export interface CanvasAuthoringClusterInfo {
  geoName?: string;
  clusterNumber?: string | number;
  environment?: string;
  clusterCategory?: string;
  [key: string]: unknown;
}

export interface StartCanvasAuthoringSessionResult {
  appId: string;
  environmentId: string;
  account: string;
  sessionId: string;
  startRequestId: string;
  cluster: CanvasAuthoringClusterInfo;
  authoringBaseUrl: string;
  startPath: string;
  startStatus: number;
  session: unknown;
}

export async function startCanvasAuthoringSession(
  input: StartCanvasAuthoringSessionInput,
  configOptions: ConfigStoreOptions = {},
): Promise<OperationResult<StartCanvasAuthoringSessionResult>> {
  const clusterResult = await executeApiRequest({
    environmentAlias: input.environmentAlias,
    accountName: input.accountName,
    api: 'canvas-authoring',
    path: '/gateway/cluster',
    method: 'GET',
    responseType: 'json',
    readIntent: true,
  }, configOptions, { allowInteractive: input.allowInteractive });
  if (!clusterResult.success || !clusterResult.data) return fail(...clusterResult.diagnostics);

  const cluster = asClusterInfo(clusterResult.data.response);
  const authoringBaseUrl = buildCanvasAuthoringBaseUrl(cluster, input.clusterCategory);
  if (!authoringBaseUrl.success || !authoringBaseUrl.data) return fail(...authoringBaseUrl.diagnostics);

  const appId = normalizeCanvasAppId(input.appId);
  const environmentId = clusterResult.data.request.environment.makerEnvironmentId;
  const startPath = buildCanvasAuthoringSessionStartUrl(authoringBaseUrl.data, environmentId, input.cadence);
  const sessionId = randomUUID();
  const startRequestId = randomUUID();
  const startResult = await executeApiRequest({
    environmentAlias: input.environmentAlias,
    accountName: input.accountName,
    api: 'canvas-authoring',
    path: startPath,
    method: 'POST',
    headers: {
      'x-ms-client-session-id': sessionId,
      'x-ms-client-request-id': startRequestId,
      'x-ms-environment-name': environmentId,
      'x-ms-environment-update-cadence': input.cadence ?? 'Frequent',
      'x-ms-app-name': `/providers/Microsoft.PowerApps/apps/${appId}`,
    },
    responseType: 'json',
    readIntent: true,
  }, configOptions, { allowInteractive: input.allowInteractive });
  if (!startResult.success || !startResult.data) return fail(...startResult.diagnostics);

  return ok({
    appId,
    environmentId,
    account: startResult.data.request.accountName,
    sessionId,
    startRequestId,
    cluster,
    authoringBaseUrl: authoringBaseUrl.data,
    startPath: new URL(startPath).pathname,
    startStatus: startResult.data.status,
    session: input.raw ? startResult.data.response : redactCanvasAuthoringSession(startResult.data.response),
  }, [...clusterResult.diagnostics, ...startResult.diagnostics]);
}

export function normalizeCanvasAppId(value: string): string {
  const decoded = decodeURIComponent(value);
  const match = /\/apps\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(decoded) ?? /^([0-9a-f-]{36})$/i.exec(decoded);
  return match?.[1] ?? decoded;
}

export function buildCanvasAuthoringBaseUrl(
  cluster: CanvasAuthoringClusterInfo,
  clusterCategoryOverride?: string,
): OperationResult<string> {
  const geoName = typeof cluster.geoName === 'string' ? cluster.geoName.toLowerCase() : undefined;
  const clusterNumber = cluster.clusterNumber === undefined ? undefined : String(cluster.clusterNumber);
  if (!geoName || !clusterNumber) {
    return fail(createDiagnostic('error', 'CANVAS_AUTHORING_CLUSTER_INCOMPLETE', 'Canvas authoring cluster discovery did not return geoName and clusterNumber.', {
      source: 'pp/canvas-authoring',
      detail: JSON.stringify(cluster),
    }));
  }
  const clusterCategory = normalizeClusterCategory(clusterCategoryOverride ?? cluster.clusterCategory ?? cluster.environment);
  const authoringGeoName = authoringGeoNameFromClusterName(cluster.clusterName, clusterNumber) ?? geoName;
  return ok(`https://authoring.${authoringGeoName}-il${clusterNumber}.gateway.${clusterCategory}.island.powerapps.com`);
}

export function buildCanvasAuthoringSessionStartUrl(baseUrl: string, environmentId: string, cadence = 'Frequent'): string {
  const url = new URL('/api/authoringsession/start', baseUrl);
  url.searchParams.set('environment-name', environmentId);
  url.searchParams.set('environment-update-cadence', cadence);
  return url.toString();
}

function asClusterInfo(value: unknown): CanvasAuthoringClusterInfo {
  return value && typeof value === 'object' ? value as CanvasAuthoringClusterInfo : {};
}

function normalizeClusterCategory(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'prod';
  return text === 'production' ? 'prod' : text;
}

function authoringGeoNameFromClusterName(value: unknown, clusterNumber: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = new RegExp(`il${clusterNumber}([a-z]+)$`, 'i').exec(value);
  return match?.[1]?.toLowerCase();
}

function redactCanvasAuthoringSession(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactCanvasAuthoringSession(item));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
    if (key === 'accessToken' || key === 'sessionState') {
      return [key, summarizeSecret(entryValue)] as const;
    }
    return [key, redactCanvasAuthoringSession(entryValue)] as const;
  });
  return Object.fromEntries(entries);
}

function summarizeSecret(value: unknown): unknown {
  if (typeof value !== 'string') return value === undefined || value === null ? value : { redacted: true };
  return { redacted: true, length: value.length };
}
