import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApiRequest, DesktopApiResponse } from '../desktop-api.js';

const desktopApi = {
  request(input: DesktopApiRequest): Promise<DesktopApiResponse> {
    return ipcRenderer.invoke('pp:api', readDesktopApiRequest(input)) as Promise<DesktopApiResponse>;
  },
  platform: process.platform
};

contextBridge.exposeInMainWorld('ppDesktop', desktopApi);

function readDesktopApiRequest(input: unknown): DesktopApiRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Desktop API request must be an object.');
  }
  const record = input as Record<string, unknown>;
  if (typeof record.path !== 'string' || !record.path.startsWith('/')) {
    throw new TypeError('Desktop API request path must be an app-local path.');
  }
  if (record.path.length > 4096) {
    throw new TypeError('Desktop API request path is too long.');
  }
  const method = typeof record.method === 'string' ? record.method.toUpperCase() : undefined;
  if (method !== undefined && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].includes(method)) {
    throw new TypeError('Desktop API request method is invalid.');
  }
  return {
    path: record.path,
    method,
    body: record.body
  };
}
