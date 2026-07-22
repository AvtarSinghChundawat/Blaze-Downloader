const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  selectDownloadDir: () => ipcRenderer.invoke('select-download-dir'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Downloads API
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  addDownload: (data) => ipcRenderer.invoke('add-download', data),
  startDownload: (data) => ipcRenderer.invoke('start-download', data),
  pauseDownload: (data) => ipcRenderer.invoke('pause-download', data),
  deleteDownload: (data) => ipcRenderer.invoke('delete-download', data),
  deleteSelectedDownloads: (data) => ipcRenderer.invoke('delete-selected-downloads', data),
  clearAllDownloads: (data) => ipcRenderer.invoke('clear-all-downloads', data),
  openFile: (data) => ipcRenderer.invoke('open-file', data),
  openFileLocation: (data) => ipcRenderer.invoke('open-file-location', data),

  // Subscriptions (Main -> Renderer)
  onDownloadsUpdated: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('downloads-updated', subscription);
    return () => ipcRenderer.removeListener('downloads-updated', subscription);
  },
  onDownloadInfo: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('download-info', subscription);
    return () => ipcRenderer.removeListener('download-info', subscription);
  },
  onDownloadStatus: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('download-status', subscription);
    return () => ipcRenderer.removeListener('download-status', subscription);
  },
  onDownloadProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('download-progress', subscription);
    return () => ipcRenderer.removeListener('download-progress', subscription);
  },
  onDownloadError: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('download-error', subscription);
    return () => ipcRenderer.removeListener('download-error', subscription);
  },
  onExternalDownload: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('external-download', subscription);
    return () => ipcRenderer.removeListener('external-download', subscription);
  }
});
