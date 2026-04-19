import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApiRequest, DesktopApiResponse } from '../desktop-api.js';

const desktopApi = {
  request(input: DesktopApiRequest): Promise<DesktopApiResponse> {
    return ipcRenderer.invoke('pp:api', input) as Promise<DesktopApiResponse>;
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('ppDesktop', desktopApi);
