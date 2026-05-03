import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';

export interface CanvasAuthoringClusterInfo {
  geoName?: string;
  clusterNumber?: string | number;
  environment?: string;
  clusterCategory?: string;
  [key: string]: unknown;
}

export interface CanvasAuthoringUrlSession {
  authoringBaseUrl: string;
  webAuthoringVersion: string;
  sessionId: string;
  sessionState: string;
}

export function normalizeCanvasAppId(value: string): string {
  const decoded = decodeURIComponent(value);
  const match = /\/apps\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(decoded) ?? /^([0-9a-f-]{36})$/i.exec(decoded);
  return match?.[1] ?? decoded;
}

export function buildCanvasAuthoringBaseUrl(cluster: CanvasAuthoringClusterInfo, clusterCategoryOverride?: string): OperationResult<string> {
  const geoName = typeof cluster.geoName === 'string' ? cluster.geoName.toLowerCase() : undefined;
  const clusterNumber = cluster.clusterNumber === undefined ? undefined : String(cluster.clusterNumber);
  if (!geoName || !clusterNumber) {
    return fail(
      createDiagnostic('error', 'CANVAS_AUTHORING_CLUSTER_INCOMPLETE', 'Canvas authoring cluster discovery did not return geoName and clusterNumber.', {
        source: 'pp/canvas-authoring',
        detail: JSON.stringify(cluster)
      })
    );
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

export function buildCanvasAuthoringInvokeUrl(session: Pick<CanvasAuthoringUrlSession, 'authoringBaseUrl' | 'webAuthoringVersion'>): string {
  return new URL(`/${session.webAuthoringVersion.replace(/^\/+/, '')}/api/v2/invoke`, session.authoringBaseUrl).toString();
}

export function buildVersionedCanvasAuthoringUrl(session: Pick<CanvasAuthoringUrlSession, 'authoringBaseUrl' | 'webAuthoringVersion'>, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith(`/${session.webAuthoringVersion}/`) || normalizedPath === `/${session.webAuthoringVersion}`) {
    return new URL(normalizedPath, session.authoringBaseUrl).toString();
  }
  return new URL(`/${session.webAuthoringVersion.replace(/^\/+/, '')}${normalizedPath}`, session.authoringBaseUrl).toString();
}

export function buildCanvasAuthoringSignalRWebsocketUrl(
  session: CanvasAuthoringUrlSession,
  negotiate: { url?: string; accessToken?: string; connectionToken?: string; connectionId?: string },
  accessToken: string
): string {
  const url = negotiate.url ? new URL(negotiate.url) : new URL(`/${session.webAuthoringVersion.replace(/^\/+/, '')}/api/signalr/diagnosticshub`, session.authoringBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('x-ms-client-session-id', session.sessionId);
  url.searchParams.set('x-ms-session-state', session.sessionState);
  const connectionToken = negotiate.connectionToken ?? negotiate.connectionId;
  if (connectionToken && !url.searchParams.has('id')) url.searchParams.set('id', connectionToken);
  url.searchParams.set('access_token', negotiate.accessToken ?? accessToken);
  return url.toString();
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
