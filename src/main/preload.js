// Exposes a minimal, safe hosting API to the renderer.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cryptHost', {
  start: opts => ipcRenderer.invoke('host:start', opts),
  stop: () => ipcRenderer.invoke('host:stop'),
});
