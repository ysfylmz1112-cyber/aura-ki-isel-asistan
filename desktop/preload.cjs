const { contextBridge, ipcRenderer } = require('electron');

const TOOL_NAME = /^[a-z0-9_:-]{1,120}$/i;

contextBridge.exposeInMainWorld('auraDesktop', {
  isDesktop: true,
  call(tool, args = {}) {
    const name = String(tool || '').trim();
    if (!TOOL_NAME.test(name)) {
      return Promise.resolve({ ok: false, error: 'Geçersiz araç adı.' });
    }
    const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    return ipcRenderer.invoke('aura:tool', { tool: name, args: safeArgs });
  },
  getInfo() {
    return ipcRenderer.invoke('aura:desktop-info');
  }
});
