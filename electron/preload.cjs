const { contextBridge, ipcRenderer, webFrame } = require('electron');

// 1. Expose a secure print trigger to the renderer context
contextBridge.exposeInMainWorld('electronAPI', {
  silentPrint: () => ipcRenderer.send('silent-print')
});

// 2. Override window.print in the webpage's main world context & inject portrait photobooth print styles
webFrame.executeJavaScript(`
  (function() {
    // Intercept window.print
    window.print = function() {
      console.log('[Electron Preload] Intercepted window.print() -> routing to photobooth printing');
      if (window.electronAPI && window.electronAPI.silentPrint) {
        window.electronAPI.silentPrint();
      }
    };

    function injectPrintFix() {
      if (!document.head && !document.documentElement) {
        window.addEventListener('DOMContentLoaded', injectPrintFix, { once: true });
        return;
      }
      if (document.getElementById('electron-kiosk-print-fix')) return;

      const style = document.createElement('style');
      style.id = 'electron-kiosk-print-fix';
      style.textContent = \`
        @media print {
          @page {
            size: auto !important;
            margin: 0mm !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            width: 100vw !important;
            height: 100vh !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: #ffffff !important;
          }
          #kiosk-stage, .screen {
            display: none !important;
          }
          #print-area {
            display: flex !important;
            position: fixed !important;
            inset: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            align-items: center !important;
            justify-content: center !important;
            background: #ffffff !important;
            z-index: 9999999 !important;
          }
          #print-area img {
            display: block !important;
            width: 100vw !important;
            height: 100vh !important;
            object-fit: contain !important;
          }
        }
      \`;
      (document.head || document.documentElement).appendChild(style);
      console.log('[Electron Preload] Injected photobooth print handler & CSS');
    }

    injectPrintFix();
  })();
`);
