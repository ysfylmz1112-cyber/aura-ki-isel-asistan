const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('auraDesktop', {
  isDesktop: true,
  call(tool, args = {}) {
    return ipcRenderer.invoke('aura:tool', {
      tool: String(tool || ''),
      args: args && typeof args === 'object' ? args : {}
    });
  },
  getInfo() {
    return ipcRenderer.invoke('aura:desktop-info');
  }
});
