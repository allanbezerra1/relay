const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callToast', {
  onData: (cb) => ipcRenderer.on('toast:data', (_e, d) => cb(d)),
  onEnd: (cb) => ipcRenderer.on('toast:end', () => cb()),
  ready: () => ipcRenderer.send('toast:ready'),
  answer: () => ipcRenderer.send('toast:answer'),
  decline: () => ipcRenderer.send('toast:decline'),
});
