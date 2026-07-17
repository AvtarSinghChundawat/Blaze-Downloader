const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const SegmentDownloader = require('./downloader');

let mainWindow;
const activeDownloads = new Map(); // id -> SegmentDownloader
let downloadsRegistry = []; // List of all registered downloads

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

ipcMain.handle('add-download', async (event, { url, fileName, customDir }) => {
  const id = Date.now().toString();
  const dir = customDir || appSettings.downloadDir;
  
  // Make temporary probe to get actual filename if not provided
  let finalFileName = fileName;
  let size = 0;
  let rangesSupported = false;
  
  try {
    const tempDownloader = new SegmentDownloader(url, path.join(dir, fileName || 'temp_probe'));
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
    speed: 0
  };

  downloadsRegistry.push(downloadItem);
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
    connections: appSettings.connections
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
