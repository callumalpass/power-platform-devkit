import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { createDesktopApiContext, handleDesktopApiRequest, type DesktopApiRequest } from '../desktop-api.js';

let mainWindow: BrowserWindow | undefined;
const e2eWindowMode = process.env.PP_DESKTOP_E2E_WINDOW_MODE;
const keepWindowHiddenForE2E = e2eWindowMode === 'hidden';
const useBackgroundWindowForE2E = e2eWindowMode === 'background';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!keepWindowHiddenForE2E && !useBackgroundWindowForE2E) mainWindow.focus();
  });
}

app.setName('PP Desktop');
Menu.setApplicationMenu(null);
if (process.platform === 'win32') {
  app.setAppUserModelId('com.pp.desktop');
}

const apiContext = createDesktopApiContext({
  allowInteractiveAuth: true,
  quit: () => app.quit(),
});

ipcMain.handle('pp:api', async (_event, request: DesktopApiRequest) => {
  return handleDesktopApiRequest(apiContext, request);
});

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    x: useBackgroundWindowForE2E ? -32000 : undefined,
    y: useBackgroundWindowForE2E ? -32000 : undefined,
    title: 'PP Desktop',
    backgroundColor: '#f6f6f5',
    show: false,
    skipTaskbar: useBackgroundWindowForE2E,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (keepWindowHiddenForE2E) return;
    if (useBackgroundWindowForE2E) {
      mainWindow?.showInactive();
      return;
    }
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  void createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
