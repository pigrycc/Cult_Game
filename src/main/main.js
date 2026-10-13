// Electron main process: window + embedded authoritative host server.
import { app, BrowserWindow, ipcMain, session, globalShortcut } from 'electron';
import path from 'node:path';
import crypto from 'node:crypto';
import { GameServer } from '../server/GameServer.js';

let win = null, server = null, token = null;

ipcMain.handle('host:start', async (_e, { port = 7777, debugAll = false } = {}) => {
  if (server) return { port: server.port, token };
  token = crypto.randomBytes(12).toString('hex');
  const s = new GameServer({ port: +port || 7777, hostToken: token, debugAll: !!debugAll });
  try { await s.start(); } catch (err) { return { error: `Could not open port ${port}: ${err.message}` }; }
  server = s;
  return { port: s.port, token };
});
ipcMain.handle('host:stop', async () => { if (server) await server.stop(); server = null; return true; });

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 640, backgroundColor: '#000000', autoHideMenuBar: true,
    title: 'Crypt of Minions',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'client', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'pointerLock', 'fullscreen'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'pointerLock', 'fullscreen'].includes(perm));
  createWindow();
});
app.on('window-all-closed', async () => { if (server) await server.stop(); app.quit(); });
