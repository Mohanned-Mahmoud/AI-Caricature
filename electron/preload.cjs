const { contextBridge, ipcRenderer, webFrame } = require('electron');

// 1. Expose a secure print trigger to the renderer context
contextBridge.exposeInMainWorld('electronAPI', {
  silentPrint: () => ipcRenderer.send('silent-print')
});

// 2. Intercept window.print in the webpage's main world context & route to silent printing
webFrame.executeJavaScript(`
  (function() {
    window.print = function() {
      console.log('[Electron Preload] Intercepted window.print() -> routing to silent printing');
      if (window.electronAPI && window.electronAPI.silentPrint) {
        window.electronAPI.silentPrint();
      }
    };
    console.log('[Electron Preload] Injected photobooth window.print handler');
  })();
`);
