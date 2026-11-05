const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { fileURLToPath } = require('url');

// --- Kiosk & Printer Configuration ---
const CONFIG = {
  port: 5173,
  fullscreen: true,       // Full-screen photo booth kiosk
  frame: false,           // Frameless window
  kiosk: true,            // Locks into kiosk mode
  autoHideMenuBar: true,
  printerDeviceName: ''   // Empty = Windows default printer, or specify e.g. "EPSON L3250 Series"
};

let mainWindow = null;
let serverInstance = null;

// ---- 1. Embedded HTTP Server (Serves dist + APIs) ----
async function startEmbeddedServer() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }

  // Dynamic import for ES modules
  const caricatureModule = await import('./api/caricature.js');
  const uploadModule = await import('./api/upload.js');
  const caricatureHandler = caricatureModule.default;
  const uploadHandler = uploadModule.default;

  const DIST_DIR = path.join(__dirname, 'dist');
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  async function parseBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
      });
    });
  }

  function createResponseWrapper(res) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    return res;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/api/caricature') {
      req.body = await parseBody(req);
      return caricatureHandler(req, createResponseWrapper(res));
    }

    if (pathname === '/api/upload') {
      req.body = await parseBody(req);
      return uploadHandler(req, createResponseWrapper(res));
    }

    let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(CONFIG.port, '127.0.0.1', () => {
      console.log(`[Embedded Server] Running at http://127.0.0.1:${CONFIG.port}`);
      serverInstance = server;
      resolve();
    });
  });
}

// ---- 2. Silent & Photobooth Printing ----
function executeSilentPrint(win) {
  if (!win || win.isDestroyed()) return;

  console.log('\n[Electron] 🖨️  Initiating Photobooth Print...');

  win.webContents.print(
    {
      silent: false,           // Set to true if target printer is fixed, or false to choose printer
      printBackground: true,   // Ensures background and framing are printed
      color: true,             // Color mode
      landscape: false,        // Portrait orientation for caricature photo card
      margins: { marginType: 'none' },
      deviceName: CONFIG.printerDeviceName || ''
    },
    (success, failureReason) => {
      if (!success) {
        console.error('[Electron] ❌ Print failed:', failureReason);
      } else {
        console.log('[Electron] ✅ Print job sent successfully to Windows spooler!');
      }
    }
  );
}

// ---- 3. Window Creation ----
async function createWindow() {
  await startEmbeddedServer();

  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    fullscreen: CONFIG.fullscreen,
    frame: CONFIG.frame,
    kiosk: CONFIG.kiosk,
    autoHideMenuBar: CONFIG.autoHideMenuBar,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Handle IPC silent-print request intercepted from window.print()
  ipcMain.on('silent-print', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    executeSilentPrint(win || mainWindow);
  });

  // Testing shortcuts (Same as Talabat)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Ctrl + P triggers print
    if (input.control && input.key.toLowerCase() === 'p') {
      event.preventDefault();
      executeSilentPrint(mainWindow);
    }
    // Esc toggles full-screen mode off
    if (input.key === 'Escape') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    // F12 toggles DevTools
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // List detected Windows printers once page loads
  mainWindow.webContents.on('did-finish-load', async () => {
    console.log(`[Electron] Successfully loaded photobooth kiosk.`);
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      console.log('\n================ WINDOWS PRINTERS DETECTED ================');
      if (printers.length === 0) {
        console.warn('⚠️ No printers found on this system!');
      } else {
        printers.forEach((p) => {
          const isDef = p.isDefault ? ' [DEFAULT PRINTER]' : '';
          const status = p.status ? ` (Status: ${p.status})` : '';
          console.log(`  • "${p.name}"${isDef}${status}`);
        });
      }
      console.log('===========================================================\n');
    } catch (err) {
      console.error('[Electron] Failed to enumerate printers:', err);
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${CONFIG.port}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverInstance) {
      serverInstance.close();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverInstance) serverInstance.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
