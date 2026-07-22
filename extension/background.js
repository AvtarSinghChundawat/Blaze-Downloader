// Default extension settings
const DEFAULT_SETTINGS = {
  enabled: true,
  fileExtensions: ['zip', 'rar', '7z', 'iso', 'exe', 'msi', 'mp4', 'mkv', 'avi', 'mov', 'mp3', 'pdf', 'apk', 'tar', 'gz', 'dmg', 'pkg', 'deb'],
  blazePort: 3055,
  interceptAll: false
};

// Initialize settings and Context Menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    chrome.storage.sync.set(settings);
  });

  chrome.contextMenus.create({
    id: 'download-with-blaze',
    title: 'Download with Blaze Downloader',
    contexts: ['link', 'image', 'video', 'audio']
  });
});

async function getCookiesForUrl(targetUrl) {
  try {
    if (!targetUrl || !targetUrl.startsWith('http')) return '';
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    return '';
  }
}

// Helper to send download link to Blaze Downloader desktop app
async function sendToBlaze(url, fileName = '', referrer = '') {
  const settings = await new Promise(resolve => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });

  let cookies = await getCookiesForUrl(url);
  if (!cookies && referrer) {
    cookies = await getCookiesForUrl(referrer);
  }

  const apiEndpoint = `http://127.0.0.1:${settings.blazePort || 3055}/api/catch-download`;

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        fileName: fileName,
        referrer: referrer,
        cookies: cookies,
        autoStart: false
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return { success: true };
  } catch (err) {
    console.warn('Blaze HTTP API unavailable (App likely closed). Triggering blaze:// protocol launch...');
    // Fallback: Launch Blaze Downloader via custom OS protocol scheme
    const protocolUrl = `blaze://add?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(fileName)}&referrer=${encodeURIComponent(referrer)}&cookies=${encodeURIComponent(cookies)}`;
    
    // Open protocol URL in temporary background tab then close it
    chrome.tabs.create({ url: protocolUrl, active: false }, (tab) => {
      setTimeout(() => {
        if (tab && tab.id) {
          chrome.tabs.remove(tab.id).catch(() => {});
        }
      }, 1500);
    });

    return { success: true, launchedViaProtocol: true };
  }
}

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'download-with-blaze') {
    const targetUrl = info.linkUrl || info.srcUrl;
    if (targetUrl) {
      let suggestedName = '';
      try {
        suggestedName = new URL(targetUrl).pathname.split('/').pop() || '';
      } catch (e) {}
      const pageReferrer = (tab && tab.url) ? tab.url : (info.pageUrl || '');
      sendToBlaze(targetUrl, suggestedName, pageReferrer);
    }
  }
});

// Intercept browser downloads
chrome.downloads.onCreated.addListener(async (item) => {
  const settings = await new Promise(resolve => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });

  if (!settings.enabled) return;

  const downloadUrl = item.finalUrl || item.url;
  
  // Skip blob URLs and data URLs
  if (downloadUrl.startsWith('blob:') || downloadUrl.startsWith('data:')) return;

  // Extract file extension
  let fileName = item.filename ? item.filename.split(/[\\/]/).pop() : '';
  if (!fileName && downloadUrl) {
    try {
      fileName = new URL(downloadUrl).pathname.split('/').pop() || '';
    } catch (e) {}
  }

  const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
  const allowedExtensions = settings.fileExtensions || [];

  const shouldIntercept = settings.interceptAll || (ext && allowedExtensions.includes(ext));

  if (shouldIntercept) {
    // Cancel the browser's native download
    chrome.downloads.cancel(item.id, () => {
      chrome.downloads.erase({ id: item.id }, () => {});
    });

    const referrer = item.referrer || item.url || '';
    // Pass the download item to Blaze Downloader
    sendToBlaze(downloadUrl, fileName, referrer);
  }
});

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sendToBlaze') {
    sendToBlaze(message.url, message.fileName).then(res => sendResponse(res));
    return true;
  }
  if (message.action === 'checkStatus') {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      fetch(`http://127.0.0.1:${settings.blazePort || 3055}/api/ping`)
        .then(res => res.json())
        .then(data => sendResponse({ online: true, data }))
        .catch(() => sendResponse({ online: false }));
    });
    return true;
  }
});
