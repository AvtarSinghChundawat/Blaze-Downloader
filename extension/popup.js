document.addEventListener('DOMContentLoaded', () => {
  const enableToggle = document.getElementById('enableToggle');
  const interceptAllCheck = document.getElementById('interceptAllCheck');
  const extInput = document.getElementById('extInput');
  const extGroup = document.getElementById('extGroup');
  const urlInput = document.getElementById('urlInput');
  const sendBtn = document.getElementById('sendBtn');
  const testBtn = document.getElementById('testBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const feedbackMsg = document.getElementById('feedbackMsg');

  const DEFAULT_SETTINGS = {
    enabled: true,
    fileExtensions: ['zip', 'rar', '7z', 'iso', 'exe', 'msi', 'mp4', 'mkv', 'avi', 'mov', 'mp3', 'pdf', 'apk', 'tar', 'gz', 'dmg', 'pkg', 'deb'],
    blazePort: 3055,
    interceptAll: false
  };

  // Load saved settings
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    enableToggle.checked = !!settings.enabled;
    interceptAllCheck.checked = !!settings.interceptAll;
    extInput.value = (settings.fileExtensions || []).join(', ');
    
    if (settings.interceptAll) {
      extGroup.style.opacity = '0.5';
    }
  });

  // Save settings on changes
  enableToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: enableToggle.checked });
  });

  interceptAllCheck.addEventListener('change', () => {
    const isChecked = interceptAllCheck.checked;
    chrome.storage.sync.set({ interceptAll: isChecked });
    extGroup.style.opacity = isChecked ? '0.5' : '1.0';
  });

  extInput.addEventListener('blur', () => {
    const exts = extInput.value
      .split(',')
      .map(s => s.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean);
    chrome.storage.sync.set({ fileExtensions: exts });
  });

  // Status Check
  function checkAppStatus() {
    statusText.textContent = 'Checking...';
    statusBadge.className = 'status-badge';
    
    chrome.runtime.sendMessage({ action: 'checkStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        statusBadge.className = 'status-badge offline';
        statusText.textContent = 'Extension Active';
        return;
      }
      if (response && response.online) {
        statusBadge.className = 'status-badge online';
        statusText.textContent = 'Blaze Connected';
      } else {
        statusBadge.className = 'status-badge offline';
        statusText.textContent = 'App Closed (Auto-launch ready)';
      }
    });
  }

  checkAppStatus();
  testBtn.addEventListener('click', checkAppStatus);

  // Send URL manually
  sendBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) {
      showFeedback('Please enter a valid URL', false);
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    let suggestedName = '';
    try {
      suggestedName = new URL(url).pathname.split('/').pop() || '';
    } catch (e) {}

    chrome.runtime.sendMessage({ action: 'sendToBlaze', url, fileName: suggestedName }, (response) => {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
      if (response && response.success) {
        showFeedback(response.launchedViaProtocol ? 'Blaze app launched!' : 'Sent to Blaze Downloader!', true);
        urlInput.value = '';
        checkAppStatus();
      } else {
        showFeedback('Failed to send link', false);
      }
    });
  });

  function showFeedback(msg, isSuccess) {
    feedbackMsg.textContent = msg;
    feedbackMsg.className = `feedback ${isSuccess ? 'success' : 'error'}`;
    setTimeout(() => {
      feedbackMsg.textContent = '';
      feedbackMsg.className = 'feedback';
    }, 4000);
  }
});
