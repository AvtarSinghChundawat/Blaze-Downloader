const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const SegmentDownloader = require('./downloader');

let mainWindow;
const activeDownloads = new Map(); // id -> SegmentDownloader
let downloadsRegistry = []; // List of all registered downloads

// Protocol client registration (blaze://)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('blaze', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('blaze');
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const url = commandLine.find(arg => arg.startsWith('blaze://'));
    if (url) {
      handleProtocolUrl(url);
    }
  });
}

function bringWindowToFront() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.setAlwaysOnTop(false);
}

function handleProtocolUrl(rawUrl) {
  try {
    let downloadUrl = '';
    let fileName = '';
    let referrer = '';
    let cookies = '';
    if (rawUrl.includes('blaze://add?')) {
      const queryPart = rawUrl.split('blaze://add?')[1] || '';
      const params = new URLSearchParams(queryPart);
      downloadUrl = params.get('url') || '';
      fileName = params.get('filename') || params.get('fileName') || '';
      referrer = params.get('referrer') || '';
      cookies = params.get('cookies') || '';
    } else if (rawUrl.startsWith('blaze://')) {
      downloadUrl = rawUrl.replace('blaze://', '');
      if (downloadUrl.startsWith('http/') || downloadUrl.startsWith('https/')) {
        downloadUrl = downloadUrl.replace(/^http\//, 'http://').replace(/^https\//, 'https://');
      }
    }
    if (downloadUrl && mainWindow) {
      bringWindowToFront();
      mainWindow.webContents.send('external-download', { url: downloadUrl, fileName, referrer, cookies, autoStart: false });
    }
  } catch (err) {
    console.error('Error handling protocol URL:', err);
  }
}

function startApiServer() {
  const PORT = 3055;
  const server = http.createServer((req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0', app: 'Blaze Downloader' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/catch-download') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const { url, fileName, referrer, cookies } = data;
          if (url && mainWindow) {
            bringWindowToFront();
            mainWindow.webContents.send('external-download', { url, fileName, referrer, cookies, autoStart: false });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Download received' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Blaze API server port ${PORT} is already in use.`);
    } else {
      console.error('Blaze API server error:', err);
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Blaze Downloader HTTP API server running at http://127.0.0.1:${PORT}`);
  });
}

// Load registry on startup
const registryPath = path.join(app.getPath('userData'), 'blaze_downloads.json');
function loadRegistry() {
  if (fs.existsSync(registryPath)) {
    try {
      downloadsRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    } catch (e) {
      console.error('Failed to load downloads registry:', e);
      downloadsRegistry = [];
    }
  }
}

function saveRegistry() {
  try {
    fs.writeFileSync(registryPath, JSON.stringify(downloadsRegistry, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save downloads registry:', e);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'Blaze Downloader',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    },
    frame: true,
    backgroundColor: '#0b0f19'
  });

  // Remove default menu
  mainWindow.setMenuBarVisibility(false);

  // Prevent opening developer tools shortcuts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || 
       (input.control && input.shift && input.key.toLowerCase() === 'i') || 
       (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      event.preventDefault();
    }
  });

  // In development, load next dev server
  const isDev = !app.isPackaged;
  if (isDev) {
    const port = process.env.PORT || 3050;
    mainWindow.loadURL(`http://localhost:${port}`);
  } else {
    // Load next static export (out/index.html)
    mainWindow.loadFile(path.join(__dirname, 'out/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  loadRegistry();
  createWindow();
  startApiServer();

  // Handle initial protocol launch argument if app started via blaze:// link
  const initialUrl = process.argv.find(arg => arg.startsWith('blaze://'));
  if (initialUrl && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      handleProtocolUrl(initialUrl);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Save registry and clean up active downloads
  saveRegistry();
  activeDownloads.forEach(d => d.pause());
  if (process.platform !== 'darwin') app.quit();
});

// Settings Management
let appSettings = {
  downloadDir: app.getPath('downloads'),
  connections: 8
};
const settingsPath = path.join(app.getPath('userData'), 'blaze_settings.json');
if (fs.existsSync(settingsPath)) {
  try {
    appSettings = { ...appSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  } catch (e) {}
}

function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(appSettings, null, 2), 'utf8');
}

// IPC Handlers
ipcMain.handle('get-settings', () => {
  return appSettings;
});

ipcMain.handle('select-download-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: appSettings.downloadDir
  });
  if (!result.canceled && result.filePaths.length > 0) {
    appSettings.downloadDir = result.filePaths[0];
    saveSettings();
    return appSettings.downloadDir;
  }
  return null;
});

ipcMain.handle('save-settings', (event, settings) => {
  if (settings.connections) appSettings.connections = parseInt(settings.connections, 10);
  if (settings.downloadDir) appSettings.downloadDir = settings.downloadDir;
  saveSettings();
  return appSettings;
});

ipcMain.handle('get-downloads', () => {
  // Update running statuses from active maps
  return downloadsRegistry.map(d => {
    const active = activeDownloads.get(d.id);
    if (active) {
      return {
        ...d,
        status: active.status,
        speed: active.speed
      };
    }
    return d;
  });
});

ipcMain.handle('add-download', async (event, { url, fileName, customDir, referrer, cookies }) => {
  const id = Date.now().toString();
  const dir = customDir || appSettings.downloadDir;
  
  // Make temporary probe to get actual filename if not provided
  let finalFileName = fileName;
  let size = 0;
  let rangesSupported = false;
  
  try {
    const tempDownloader = new SegmentDownloader(url, path.join(dir, fileName || 'temp_probe'), { referrer, cookies });
    const info = await tempDownloader.getInfo();
    finalFileName = fileName || info.filename;
    size = info.totalSize;
    rangesSupported = info.acceptRanges;
  } catch (err) {
    // If probe fails, fallback to extracting from URL
    if (!finalFileName) {
      try {
        finalFileName = path.basename(new URL(url).pathname) || 'download';
      } catch (e) {
        finalFileName = 'download';
      }
    }
  }

  // Ensure unique filename in directory
  let fullPath = path.join(dir, finalFileName);
  let baseName = path.basename(fullPath, path.extname(fullPath));
  let ext = path.extname(fullPath);
  let counter = 1;
  while (fs.existsSync(fullPath)) {
    fullPath = path.join(dir, `${baseName} (${counter++})${ext}`);
  }
  finalFileName = path.basename(fullPath);

  const downloadItem = {
    id,
    url,
    filename: finalFileName,
    path: fullPath,
    totalSize: size,
    downloaded: 0,
    percent: 0,
    status: 'QUEUED',
    dateAdded: new Date().toISOString(),
    referrer: referrer || '',
    cookies: cookies || '',
    speed: 0
  };

  downloadsRegistry.unshift(downloadItem);
  saveRegistry();
  
  if (mainWindow) {
    mainWindow.webContents.send('downloads-updated', downloadsRegistry);
  }
  
  return downloadItem;
});

ipcMain.handle('start-download', (event, { id }) => {
  const itemIndex = downloadsRegistry.findIndex(d => d.id === id);
  if (itemIndex === -1) return false;

  const item = downloadsRegistry[itemIndex];
  
  // Clean up if already exists in active
  if (activeDownloads.has(id)) {
    const old = activeDownloads.get(id);
    old.pause();
    activeDownloads.delete(id);
  }

  const downloader = new SegmentDownloader(item.url, item.path, {
    connections: appSettings.connections,
    referrer: item.referrer || '',
    cookies: item.cookies || ''
  });

  activeDownloads.set(id, downloader);

  downloader.on('info', (info) => {
    item.totalSize = info.totalSize;
    saveRegistry();
    mainWindow.webContents.send('download-info', { id, info });
  });

  downloader.on('status', (status) => {
    item.status = status;
    if (status === 'COMPLETED') {
      item.downloaded = item.totalSize;
      item.percent = 100;
      activeDownloads.delete(id);
    }
    saveRegistry();
    mainWindow.webContents.send('download-status', { id, status });
  });

  downloader.on('progress', (progress) => {
    item.percent = progress.percent;
    item.downloaded = progress.downloaded;
    item.totalSize = progress.total;
    mainWindow.webContents.send('download-progress', { id, progress });
  });

  downloader.on('error', (error) => {
    item.status = 'ERROR';
    saveRegistry();
    activeDownloads.delete(id);
    mainWindow.webContents.send('download-error', { id, error });
  });

  downloader.start();
  return true;
});

ipcMain.handle('pause-download', (event, { id }) => {
  const downloader = activeDownloads.get(id);
  if (downloader) {
    downloader.pause();
    activeDownloads.delete(id);
    return true;
  }
  return false;
});

ipcMain.handle('delete-download', (event, { id, deleteFile }) => {
  const itemIndex = downloadsRegistry.findIndex(d => d.id === id);
  if (itemIndex === -1) return false;

  const item = downloadsRegistry[itemIndex];
  
  // Pause/Abort if active
  const downloader = activeDownloads.get(id);
  if (downloader) {
    downloader.pause();
    activeDownloads.delete(id);
  }

  // Delete local file and meta file if requested
  if (deleteFile) {
    try {
      if (fs.existsSync(item.path)) {
        fs.unlinkSync(item.path);
      }
      const meta = item.path + '.blaze.json';
      if (fs.existsSync(meta)) {
        fs.unlinkSync(meta);
      }
    } catch (e) {
      console.error('Error deleting file:', e);
    }
  }

  downloadsRegistry.splice(itemIndex, 1);
  saveRegistry();
  
  if (mainWindow) {
    mainWindow.webContents.send('downloads-updated', downloadsRegistry);
  }
  return true;
});

ipcMain.handle('delete-selected-downloads', (event, { ids, deleteFiles }) => {
  if (!Array.isArray(ids) || ids.length === 0) return false;

  const idSet = new Set(ids);

  ids.forEach((id) => {
    const downloader = activeDownloads.get(id);
    if (downloader) {
      try { downloader.pause(); } catch (e) {}
      activeDownloads.delete(id);
    }
  });

  if (deleteFiles) {
    downloadsRegistry.forEach((item) => {
      if (idSet.has(item.id)) {
        try {
          if (item.path && fs.existsSync(item.path)) {
            fs.unlinkSync(item.path);
          }
          const meta = item.path + '.blaze.json';
          if (fs.existsSync(meta)) {
            fs.unlinkSync(meta);
          }
        } catch (e) {}
      }
    });
  }

  downloadsRegistry = downloadsRegistry.filter(item => !idSet.has(item.id));
  saveRegistry();

  if (mainWindow) {
    mainWindow.webContents.send('downloads-updated', downloadsRegistry);
  }
  return true;
});

ipcMain.handle('clear-all-downloads', (event, { deleteFiles }) => {
  activeDownloads.forEach((downloader) => {
    try { downloader.pause(); } catch (e) {}
  });
  activeDownloads.clear();

  if (deleteFiles) {
    downloadsRegistry.forEach((item) => {
      try {
        if (item.path && fs.existsSync(item.path)) {
          fs.unlinkSync(item.path);
        }
        const meta = item.path + '.blaze.json';
        if (fs.existsSync(meta)) {
          fs.unlinkSync(meta);
        }
      } catch (e) {}
    });
  }

  downloadsRegistry = [];
  saveRegistry();

  if (mainWindow) {
    mainWindow.webContents.send('downloads-updated', downloadsRegistry);
  }
  return true;
});

ipcMain.handle('open-file', async (event, { filePath }) => {
  if (fs.existsSync(filePath)) {
    const error = await shell.openPath(filePath);
    if (error) {
      console.error('Error opening file:', error);
      return false;
    }
    return true;
  }
  return false;
});

ipcMain.handle('open-file-location', (event, { filePath }) => {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  // Try opening folder containing it
  const dir = path.dirname(filePath);
  if (fs.existsSync(dir)) {
    shell.openPath(dir);
    return true;
  }
  return false;
});
