const { contextBridge, ipcRenderer } = require('electron');

const api = {
  ping: () => ipcRenderer.invoke('ping'),

  onControllerState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('controller:state', h);
    return () => ipcRenderer.removeListener('controller:state', h);
  },
  onLive: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('live:update', h);
    return () => ipcRenderer.removeListener('live:update', h);
  },

  getLive: () => ipcRenderer.invoke('live:get'),

  // Operators
  listOperators: () => ipcRenderer.invoke('operator:list'),
  loginOperator: (pin) => ipcRenderer.invoke('operator:login', pin),
  logoutOperator: () => ipcRenderer.invoke('operator:logout'),
  getCurrentOperator: () => ipcRenderer.invoke('operator:current'),

  getConfig: () => ipcRenderer.invoke('cfg:get'),
  setConfig: (cfg) => ipcRenderer.invoke('cfg:set', cfg),

  getStats: (fromIso, toIso) => ipcRenderer.invoke('stats:get', fromIso, toIso),
  requestCsv: (fromIso, toIso, opts) => ipcRenderer.invoke('csv:request', fromIso, toIso, opts || {}),

  clearSessions: () => ipcRenderer.invoke('sessions:clear'),
};

contextBridge.exposeInMainWorld('api', api);
