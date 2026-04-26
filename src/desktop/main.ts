import path from 'node:path';
import { watch } from 'node:fs';
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { createDesktopApiContext, handleDesktopApiRequest, type DesktopApiRequest } from '../desktop-api.js';

let mainWindow: BrowserWindow | undefined;
let devReloadWatcher: ReturnType<typeof watch> | undefined;
const isDesktopDev = process.env.PP_DESKTOP_DEV === '1';
const isDesktopE2E = process.env.PP_DESKTOP_E2E === '1';
const e2eWindowMode = process.env.PP_DESKTOP_E2E_WINDOW_MODE;
const keepWindowHiddenForE2E = e2eWindowMode === 'hidden';
const useBackgroundWindowForE2E = e2eWindowMode === 'background';
const iconPath = path.join(__dirname, process.platform === 'win32' ? 'pp-icon.ico' : 'pp-icon-256x256.png');
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

if (isDesktopDev || isDesktopE2E) {
  app.setPath('userData', path.join(app.getPath('userData'), isDesktopE2E ? 'e2e' : 'dev'));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!keepWindowHiddenForE2E && !useBackgroundWindowForE2E) mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.setIcon(iconPath);
    void createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

app.setName('PP Desktop');
Menu.setApplicationMenu(null);
if (process.platform === 'win32') {
  app.setAppUserModelId('com.pp.desktop');
}

const apiContext = createDesktopApiContext({
  allowInteractiveAuth: true,
  quit: () => app.quit()
});

ipcMain.handle('pp:api', async (_event, request: DesktopApiRequest) => {
  return handleDesktopApiRequest(apiContext, request);
});

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 640,
    minHeight: 720,
    x: useBackgroundWindowForE2E ? -32000 : undefined,
    y: useBackgroundWindowForE2E ? -32000 : undefined,
    title: 'PP Desktop',
    icon: iconPath,
    backgroundColor: '#f6f6f5',
    show: false,
    skipTaskbar: useBackgroundWindowForE2E,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
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
    void openExternalUrl(url);
    return { action: 'deny' };
  });

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
  watchDevRendererReload(mainWindow);
}

async function openExternalUrl(rawUrl: string): Promise<void> {
  try {
    const url = new URL(rawUrl);
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return;
    await shell.openExternal(url.toString());
  } catch {
    // Ignore malformed or unsupported renderer-provided URLs.
  }
}

function watchDevRendererReload(window: BrowserWindow): void {
  const reloadFile = process.env.PP_DESKTOP_DEV_RELOAD_FILE;
  if (!reloadFile) return;

  devReloadWatcher?.close();
  const reloadDir = path.dirname(reloadFile);
  const reloadName = path.basename(reloadFile);
  let reloadTimer: NodeJS.Timeout | undefined;
  devReloadWatcher = watch(reloadDir, (_event, filename) => {
    if (filename && filename.toString() !== reloadName) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (!window.isDestroyed()) window.webContents.reloadIgnoringCache();
    }, 50);
  });
  window.once('closed', () => {
    clearTimeout(reloadTimer);
    devReloadWatcher?.close();
    devReloadWatcher = undefined;
  });
}
