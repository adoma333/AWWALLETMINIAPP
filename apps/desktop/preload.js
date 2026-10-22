// The only bridge the web app gets: open links outside the app, and the app version. No Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ZohraApp', {
  openExternal: (url) => ipcRenderer.send('open-external', String(url || '')),
  getVersionName: () => ipcRenderer.sendSync('version'),
  platform: process.platform,
  retry: () => ipcRenderer.send('retry'),
});
