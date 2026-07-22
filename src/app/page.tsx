'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Zap, 
  List, 
  DownloadCloud, 
  PauseCircle, 
  CheckCircle2, 
  Settings, 
  Sun, 
  Moon, 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  FolderOpen, 
  ExternalLink,
  X, 
  AlertTriangle, 
  Clock, 
  FileText, 
  Folder,
  Sliders,
  Check,
  ChevronDown
} from 'lucide-react';

interface SegmentInfo {
  id: number;
  start: number;
  end: number;
  current: number;
  completed: boolean;
  downloaded: number;
  percent: number;
}

interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  path: string;
  totalSize: number;
  downloaded: number;
  percent: number;
  status: string; // QUEUED, CONNECTING, DOWNLOADING, PAUSED, COMPLETED, ERROR
  dateAdded: string;
  speed: number;
  referrer?: string;
  cookies?: string;
  segments?: SegmentInfo[];
}

interface AppSettings {
  downloadDir: string;
  connections: number;
}

declare global {
  interface Window {
    electronAPI?: {
      getSettings: () => Promise<AppSettings>;
      selectDownloadDir: () => Promise<string | null>;
      saveSettings: (settings: AppSettings) => Promise<AppSettings>;
      getDownloads: () => Promise<DownloadItem[]>;
      addDownload: (data: { url: string; fileName?: string; customDir?: string; referrer?: string; cookies?: string }) => Promise<DownloadItem>;
      startDownload: (data: { id: string }) => Promise<boolean>;
      pauseDownload: (data: { id: string }) => Promise<boolean>;
      deleteDownload: (data: { id: string; deleteFile: boolean }) => Promise<boolean>;
      deleteSelectedDownloads: (data: { ids: string[]; deleteFiles: boolean }) => Promise<boolean>;
      clearAllDownloads: (data: { deleteFiles: boolean }) => Promise<boolean>;
      openFile: (data: { filePath: string }) => Promise<boolean>;
      openFileLocation: (data: { filePath: string }) => Promise<boolean>;
      onDownloadsUpdated: (callback: (data: DownloadItem[]) => void) => () => void;
      onDownloadInfo: (callback: (data: { id: string; info: any }) => void) => () => void;
      onDownloadStatus: (callback: (data: { id: string; status: string }) => void) => () => void;
      onDownloadProgress: (callback: (data: { id: string; progress: any }) => void) => () => void;
      onDownloadError: (callback: (data: { id: string; error: string }) => void) => () => void;
      onExternalDownload: (callback: (data: { url: string; fileName?: string; referrer?: string; cookies?: string; autoStart?: boolean }) => void) => () => void;
    };
  }
}

export default function Home() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'downloading' | 'paused' | 'completed'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedDownloadId, setSelectedDownloadId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  
  // Multi-select state
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [deleteSelectedFiles, setDeleteSelectedFiles] = useState(false);

  // Form fields
  const [downloadUrl, setDownloadUrl] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [downloadReferrer, setDownloadReferrer] = useState('');
  const [downloadCookies, setDownloadCookies] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Settings fields
  const [settings, setSettings] = useState<AppSettings>({ downloadDir: '', connections: 8 });
  const [connectionsDropdownOpen, setConnectionsDropdownOpen] = useState(false);
  
  // Delete & Clear All fields
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [alsoDeleteFile, setAlsoDeleteFile] = useState(false);
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [clearAllDeleteFiles, setClearAllDeleteFiles] = useState(false);
  
  // Speed history chart refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const speedHistoryRef = useRef<{ [key: string]: number[] }>({});
  
  // Fetch downloads and settings on startup
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.getDownloads().then((data) => {
        setDownloads(data);
      });
      window.electronAPI.getSettings().then((data) => {
        setSettings(data);
      });
    }

    // Load theme
    const savedTheme = localStorage.getItem('blaze-theme') as 'dark' | 'light';
    if (savedTheme) {
      setTheme(savedTheme);
      if (savedTheme === 'light') {
        document.documentElement.classList.add('light-mode');
      } else {
        document.documentElement.classList.remove('light-mode');
      }
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('blaze-theme', nextTheme);
    if (nextTheme === 'light') {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
  };

  // Listen to IPC updates
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const unsubUpdated = window.electronAPI.onDownloadsUpdated((data) => {
        setDownloads(data);
      });

      const unsubProgress = window.electronAPI.onDownloadProgress(({ id, progress }) => {
        setDownloads((prev) =>
          prev.map((d) => {
            if (d.id === id) {
              if (!speedHistoryRef.current[id]) {
                speedHistoryRef.current[id] = [];
              }
              const hist = speedHistoryRef.current[id];
              hist.push(progress.speed);
              if (hist.length > 50) hist.shift();

              return {
                ...d,
                percent: progress.percent,
                downloaded: progress.downloaded,
                totalSize: progress.total,
                status: progress.status,
                speed: progress.speed,
                segments: progress.segments
              };
            }
            return d;
          })
        );
      });

      const unsubStatus = window.electronAPI.onDownloadStatus(({ id, status }) => {
        setDownloads((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status, speed: status === 'COMPLETED' ? 0 : d.speed } : d))
        );
      });

      const unsubError = window.electronAPI.onDownloadError(({ id, error }) => {
        setDownloads((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: 'ERROR', speed: 0 } : d))
        );
        alert(`Download failed: ${error}`);
      });

      const unsubExternal = window.electronAPI.onExternalDownload(({ url, fileName, referrer, cookies }) => {
        setDownloadUrl(url);
        if (fileName) {
          setCustomFilename(fileName);
        }
        setDownloadReferrer(referrer || '');
        setDownloadCookies(cookies || '');
        setShowAddModal(true);
        setActiveTab('downloading');
      });

      return () => {
        unsubUpdated();
        unsubProgress();
        unsubStatus();
        unsubError();
        unsubExternal();
      };
    }
  }, []);

  // Canvas Drawing for Speed Chart (Adaptive Grid & Stroke Lines)
  useEffect(() => {
    const selectedId = selectedDownloadId;
    if (!selectedId) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const history = speedHistoryRef.current[selectedId] || [];
    let animationId: number;

    const draw = () => {
      if (!ctx || !canvas) return;
      
      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);

      // Grid background (adapts to light/dark themes)
      ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
      ctx.lineWidth = 1;
      const gridRows = 4;
      const gridCols = 8;
      for (let i = 1; i < gridRows; i++) {
        const y = (height / gridRows) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      for (let i = 1; i < gridCols; i++) {
        const x = (width / gridCols) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      if (history.length < 2) {
        ctx.fillStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Awaiting speed metrics...', width / 2, height / 2);
        return;
      }

      // Draw Speed Line
      const maxSpeed = Math.max(...history, 1024 * 1024); // at least 1MB/s scale
      
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();

      history.forEach((speed, idx) => {
        const x = (width / (history.length - 1)) * idx;
        const y = height - (speed / maxSpeed) * (height - 20) - 10;
        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Shadow below path
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, theme === 'dark' ? 'rgba(6, 182, 212, 0.2)' : 'rgba(6, 182, 212, 0.15)');
      gradient.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw point on last item
      const lastIdx = history.length - 1;
      const lastX = width;
      const lastY = height - (history[lastIdx] / maxSpeed) * (height - 20) - 10;
      
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      ctx.arc(lastX - 2, lastY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Write Max Speed Text (adapts to light/dark themes)
      ctx.fillStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(15, 23, 42, 0.7)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(`${formatSpeed(maxSpeed)}`, width - 10, 8);
      ctx.fillText(`0 B/s`, width - 10, height - 15);
      
      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [selectedDownloadId, downloads, theme]);

  // Utility formatters
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number) => {
    return formatBytes(bytesPerSec) + '/s';
  };

  const getETA = (item: DownloadItem) => {
    if (item.status !== 'DOWNLOADING' || item.speed <= 0) return '--:--';
    const remainingBytes = item.totalSize - item.downloaded;
    if (remainingBytes <= 0) return 'Done';
    const seconds = Math.ceil(remainingBytes / item.speed);
    
    if (seconds >= 3600) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return `${h}h ${m}m`;
    }
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  // Actions
  const handleAddDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!downloadUrl) return;
    setIsSubmitting(true);

    try {
      if (window.electronAPI) {
        const item = await window.electronAPI.addDownload({
          url: downloadUrl,
          fileName: customFilename || undefined,
          referrer: downloadReferrer || undefined,
          cookies: downloadCookies || undefined
        });
        
        await window.electronAPI.startDownload({ id: item.id });
        
        setDownloadUrl('');
        setCustomFilename('');
        setDownloadReferrer('');
        setDownloadCookies('');
        setShowAddModal(false);
        setActiveTab('downloading');
      }
    } catch (err) {
      alert('Error adding download');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startDownload = async (id: string) => {
    if (window.electronAPI) {
      await window.electronAPI.startDownload({ id });
      setActiveTab('downloading');
    }
  };

  const pauseDownload = async (id: string) => {
    if (window.electronAPI) {
      await window.electronAPI.pauseDownload({ id });
    }
  };

  const openDeleteModal = (id: string) => {
    setDeleteItemId(id);
    setAlsoDeleteFile(false);
  };

  const confirmDelete = async () => {
    if (!deleteItemId) return;
    if (window.electronAPI) {
      await window.electronAPI.deleteDownload({ id: deleteItemId, deleteFile: alsoDeleteFile });
      if (selectedDownloadId === deleteItemId) setSelectedDownloadId(null);
      setDeleteItemId(null);
      setAlsoDeleteFile(false);
    }
  };

  const confirmClearAll = async () => {
    if (window.electronAPI) {
      await window.electronAPI.clearAllDownloads({ deleteFiles: clearAllDeleteFiles });
      setSelectedDownloadId(null);
      setSelectedCardIds([]);
      setShowClearAllModal(false);
      setClearAllDeleteFiles(false);
    }
  };

  const toggleSelectCard = (id: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedCardIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const allFilteredIds = filteredDownloads.map((d) => d.id);
    const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedCardIds.includes(id));
    if (isAllSelected) {
      setSelectedCardIds((prev) => prev.filter((id) => !allFilteredIds.includes(id)));
    } else {
      setSelectedCardIds((prev) => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  const confirmDeleteSelected = async () => {
    if (selectedCardIds.length === 0) return;
    if (window.electronAPI?.deleteSelectedDownloads) {
      await window.electronAPI.deleteSelectedDownloads({
        ids: selectedCardIds,
        deleteFiles: deleteSelectedFiles
      });
      if (selectedDownloadId && selectedCardIds.includes(selectedDownloadId)) {
        setSelectedDownloadId(null);
      }
      setSelectedCardIds([]);
      setShowDeleteSelectedModal(false);
      setDeleteSelectedFiles(false);
    } else {
      alert('Electron API update pending. Please restart or refresh the application window.');
    }
  };

  const openFileDirectly = async (filePath: string) => {
    if (window.electronAPI?.openFile) {
      const success = await window.electronAPI.openFile({ filePath });
      if (!success) alert('File not found or cannot be opened');
    }
  };

  const openFile = async (filePath: string) => {
    if (window.electronAPI?.openFileLocation) {
      const success = await window.electronAPI.openFileLocation({ filePath });
      if (!success) alert('File or folder not found');
    }
  };

  const changeDownloadDir = async () => {
    if (window.electronAPI) {
      const newDir = await window.electronAPI.selectDownloadDir();
      if (newDir) {
        setSettings((prev) => ({ ...prev, downloadDir: newDir }));
      }
    }
  };

  const saveSettings = async (connections: number) => {
    const updated = { ...settings, connections };
    setSettings(updated);
    if (window.electronAPI) {
      await window.electronAPI.saveSettings(updated);
    }
  };

  // Filtering & Sorting (Newest downloads always at the top in all tabs)
  const filteredDownloads = [...downloads]
    .sort((a, b) => {
      const timeA = a.dateAdded ? new Date(a.dateAdded).getTime() : parseInt(a.id, 10) || 0;
      const timeB = b.dateAdded ? new Date(b.dateAdded).getTime() : parseInt(b.id, 10) || 0;
      return timeB - timeA;
    })
    .filter((d) => {
      if (activeTab === 'all') return true;
      if (activeTab === 'downloading') return d.status === 'DOWNLOADING' || d.status === 'CONNECTING';
      if (activeTab === 'paused') return d.status === 'PAUSED';
      if (activeTab === 'completed') return d.status === 'COMPLETED';
      return true;
    });

  const selectedDownload = downloads.find(d => d.id === selectedDownloadId);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-app-bg text-app-text-primary font-sans transition-colors duration-300">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 glass flex flex-col justify-between p-6 border-r border-app-sidebar-border bg-app-sidebar h-full shrink-0 overflow-hidden">
        <div>
          {/* Logo */}
          <div className="flex items-center space-x-3 mb-10 px-2 select-none">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-wider text-app-text-primary glow-text">BLAZE</h1>
              <p className="text-[10px] text-cyan-500 font-mono tracking-widest uppercase font-semibold">Downloader</p>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="space-y-1.5 select-none">
            {[
              { id: 'all', label: 'All Downloads', icon: List },
              { id: 'downloading', label: 'Active', icon: DownloadCloud },
              { id: 'paused', label: 'Paused', icon: PauseCircle },
              { id: 'completed', label: 'Completed', icon: CheckCircle2 },
            ].map((tab) => {
              const IconComponent = tab.icon;
              const isActive = activeTab === tab.id;
              const count = downloads.filter(d => {
                if (tab.id === 'downloading') return d.status === 'DOWNLOADING' || d.status === 'CONNECTING';
                if (tab.id === 'paused') return d.status === 'PAUSED';
                if (tab.id === 'completed') return d.status === 'COMPLETED';
                return true;
              }).length;

              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id as any); setShowSettings(false); }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300 font-medium text-sm cursor-pointer ${
                    isActive && !showSettings
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20 glow-btn'
                      : 'text-app-text-secondary hover:text-app-text-primary hover:bg-app-hover border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <IconComponent className="w-5 h-5" />
                    <span>{tab.label}</span>
                  </div>
                  {count > 0 && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold font-mono ${
                        isActive && !showSettings
                          ? 'bg-white/20 text-white'
                          : 'bg-app-input text-app-text-secondary'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom controls */}
        <div className="space-y-3 pt-6 border-t border-app-border select-none">
          {/* Theme toggle button */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition text-app-text-secondary hover:text-app-text-primary hover:bg-app-hover text-sm font-medium border border-transparent hover:border-app-border cursor-pointer"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-5 h-5 text-amber-400 shrink-0" />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-5 h-5 text-blue-500 shrink-0" />
                <span>Dark Mode</span>
              </>
            )}
          </button>

          {/* Settings button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 font-medium text-sm cursor-pointer ${
              showSettings
                ? 'bg-app-input text-cyan-500 border border-app-border'
                : 'text-app-text-secondary hover:text-app-text-primary hover:bg-app-hover border border-transparent'
            }`}
          >
            <Settings className="w-5 h-5 shrink-0" />
            <span>Settings</span>
          </button>
          
          <div className="px-4 text-[10px] text-app-text-muted font-mono text-center">
            Blaze v1.1.0
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        {/* Header bar */}
        <header className="h-20 flex items-center justify-between px-8 border-b border-app-border bg-app-header transition-colors duration-300 shrink-0">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-bold capitalize text-app-text-primary tracking-wide">
              {showSettings ? 'Configuration' : `${activeTab} downloads`}
            </h2>
            {!showSettings && filteredDownloads.length > 0 && (
              <label className="flex items-center space-x-2 text-xs text-app-text-secondary cursor-pointer select-none font-semibold hover:text-app-text-primary transition bg-app-input/60 border border-app-border px-3 py-1.5 rounded-lg">
                <input
                  type="checkbox"
                  checked={filteredDownloads.length > 0 && filteredDownloads.every(d => selectedCardIds.includes(d.id))}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded text-cyan-500 border-app-border bg-app-input cursor-pointer focus:ring-0"
                />
                <span>Select All ({selectedCardIds.length > 0 ? `${selectedCardIds.length}/` : ''}{filteredDownloads.length})</span>
              </label>
            )}
          </div>

          <div className="flex items-center space-x-3 select-none">
            {selectedCardIds.length > 0 && !showSettings && (
              <button
                onClick={() => setShowDeleteSelectedModal(true)}
                className="h-10 px-4 rounded-xl font-bold text-sm inline-flex items-center justify-center space-x-2 transition-all duration-200 bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white border border-rose-400/30 shadow-md shadow-rose-500/20 glow-btn shrink-0 cursor-pointer animate-in fade-in duration-200"
                title="Delete selected downloads"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Delete Selected ({selectedCardIds.length})</span>
              </button>
            )}
            {downloads.length > 0 && !showSettings && (
              <button
                onClick={() => setShowClearAllModal(true)}
                className="h-10 px-4 rounded-xl font-bold text-sm inline-flex items-center justify-center space-x-2 transition-all duration-200 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 hover:border-rose-500/50 shadow-sm shrink-0 cursor-pointer"
                title="Clear all downloads"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Clear All</span>
              </button>
            )}
            <button
              onClick={() => setShowAddModal(true)}
              className="h-10 px-4 rounded-xl font-bold text-sm inline-flex items-center justify-center space-x-2 transition-all duration-200 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white border border-cyan-400/30 shadow-md shadow-cyan-500/20 glow-btn shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>New Download</span>
            </button>
          </div>
        </header>

        {/* Dashboard Panels */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          
          {/* Settings view */}
          {showSettings ? (
            <div className="flex-1 p-8 overflow-y-auto w-full">
              <div className="glass p-8 rounded-2xl space-y-6">
                <div className="flex items-center space-x-2 border-b border-app-border pb-4">
                  <Sliders className="w-5 h-5 text-cyan-500" />
                  <h3 className="text-base font-bold text-app-text-primary">Download Settings</h3>
                </div>
                
                {/* Folder Selector */}
                <div className="space-y-2">
                  <label className="text-xs text-app-text-secondary block font-bold uppercase tracking-wider">Default Download Folder</label>
                  <div className="flex space-x-3">
                    <input
                      type="text"
                      readOnly
                      value={settings.downloadDir}
                      className="flex-1 glass-input rounded-xl px-4 py-3 text-sm font-mono select-all focus:outline-none"
                    />
                    <button
                      onClick={changeDownloadDir}
                      className="bg-app-input hover:bg-app-hover border border-app-border text-app-text-primary px-5 py-3 rounded-xl text-sm font-bold transition shrink-0"
                    >
                      Browse...
                    </button>
                  </div>
                </div>

                {/* Connection count selector */}
                <div className="space-y-2">
                  <label className="text-xs text-app-text-secondary block font-bold uppercase tracking-wider">Max Simultaneous Connections (Multi-threading)</label>
                  <div className="flex flex-col sm:flex-row sm:items-start md:items-center gap-3">
                    <div className="relative min-w-[240px] shrink-0">
                      <button
                        type="button"
                        onClick={() => setConnectionsDropdownOpen(!connectionsDropdownOpen)}
                        className="w-full flex items-center justify-between glass-input rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none text-left select-none"
                      >
                        <span>
                          {settings.connections === 1 ? '1 Connection (No Slicing)' :
                           settings.connections === 4 ? '4 Connections' :
                           settings.connections === 8 ? '8 Connections (Recommended)' :
                           settings.connections === 12 ? '12 Connections' :
                           settings.connections === 16 ? '16 Connections' :
                           `${settings.connections} Connections`}
                        </span>
                        <ChevronDown className={`w-4 h-4 ml-2 text-app-text-secondary transition-transform duration-200 ${connectionsDropdownOpen ? 'transform rotate-180' : ''}`} />
                      </button>

                      {connectionsDropdownOpen && (
                        <div className="absolute left-0 right-0 mt-2 z-50 rounded-xl border border-app-border bg-app-sidebar backdrop-blur-xl shadow-xl overflow-hidden py-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                          {[
                            { value: 1, label: '1 Connection (No Slicing)' },
                            { value: 4, label: '4 Connections' },
                            { value: 8, label: '8 Connections (Recommended)' },
                            { value: 12, label: '12 Connections' },
                            { value: 16, label: '16 Connections' },
                            { value: 32, label: '32 Connections (Whole Bandwidth)' }
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                saveSettings(opt.value);
                                setConnectionsDropdownOpen(false);
                              }}
                              className={`w-full text-left px-4 py-2.5 text-sm transition font-medium flex items-center justify-between ${
                                settings.connections === opt.value
                                  ? 'bg-gradient-to-r from-blue-600/20 to-cyan-500/5 text-cyan-500 font-bold'
                                  : 'text-app-text-primary hover:bg-app-hover'
                              }`}
                            >
                              <span>{opt.label}</span>
                              {settings.connections === opt.value && <Check className="w-4 h-4 text-cyan-500" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-cyan-500 font-mono">
                      * Multiple parallel connections trick the server to bypass connection limits.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-app-border flex justify-end">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition glow-btn"
                  >
                    Save & Close
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Downloads list panel */}
              <div className="flex-1 flex flex-col min-w-0 h-full min-h-0 overflow-hidden bg-transparent">
                <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 custom-scrollbar">
                  {filteredDownloads.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-app-text-secondary space-y-4 select-none">
                      <div className="p-4 bg-app-input border border-app-border rounded-full text-app-text-muted">
                        <DownloadCloud className="w-12 h-12 stroke-[1.5]" />
                      </div>
                      <p className="text-sm font-semibold">No downloads found in this category.</p>
                      <button
                        onClick={() => setShowAddModal(true)}
                        className="text-cyan-500 text-sm hover:underline font-bold"
                      >
                        Click here to start a new download
                      </button>
                    </div>
                  ) : (
                    filteredDownloads.map((item) => {
                      const isSelected = selectedDownloadId === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => setSelectedDownloadId(item.id)}
                          className={`glass-card p-5 rounded-2xl cursor-pointer transition-all duration-300 flex flex-col space-y-3 border relative group ${
                            isSelected
                              ? 'border-cyan-500/40 bg-gradient-to-r from-cyan-500/5 to-transparent shadow-sm'
                              : 'border-app-card-border'
                          }`}
                        >
                          <div className="flex items-start justify-between min-w-0">
                            <div className="flex items-start space-x-3 min-w-0 flex-1 pr-4">
                              <input
                                type="checkbox"
                                checked={selectedCardIds.includes(item.id)}
                                onChange={(e) => toggleSelectCard(item.id, e)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 mt-0.5 rounded text-cyan-500 border-app-border bg-app-input cursor-pointer focus:ring-0 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <h4 className="font-bold text-app-text-primary text-sm truncate select-text" title={item.filename}>
                                  {item.filename}
                                </h4>
                                <p className="text-sm text-app-text-secondary truncate select-text mt-1.5" title={item.url}>
                                  {item.url}
                                </p>
                              </div>
                            </div>
                            
                            {/* Badges */}
                            <div className="flex items-center space-x-2 shrink-0 select-none">
                              <span className={`text-[11px] font-bold font-sans uppercase px-3 py-0.5 rounded-full ${
                                item.status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20' :
                                item.status === 'DOWNLOADING' ? 'bg-cyan-500/15 text-cyan-500 border border-cyan-500/20 animate-pulse' :
                                item.status === 'PAUSED' ? 'bg-amber-500/15 text-amber-500 border border-amber-500/20' :
                                item.status === 'ERROR' ? 'bg-rose-500/15 text-rose-500 border border-rose-500/20' :
                                'bg-app-input text-app-text-secondary border border-app-border'
                              }`}>
                                {item.status}
                              </span>
                            </div>
                          </div>

                          {/* Progress bar and details */}
                          <div className="space-y-2">
                            <div className="w-full bg-app-track rounded-full h-2 overflow-hidden border border-app-border/40">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  item.status === 'COMPLETED' ? 'bg-gradient-to-r from-emerald-500 to-teal-500' :
                                  item.status === 'ERROR' ? 'bg-rose-500' :
                                  'bg-gradient-to-r from-blue-500 to-cyan-400'
                                }`}
                                style={{ width: `${item.percent}%` }}
                              />
                            </div>

                            <div className="flex items-center justify-between text-sm text-app-text-secondary font-mono select-none">
                              <div className="flex space-x-4">
                                <span className="font-bold text-app-text-primary">{item.percent}%</span>
                                <span>{formatBytes(item.downloaded)} / {item.totalSize > 0 ? formatBytes(item.totalSize) : 'Unknown'}</span>
                              </div>
                              <div className="flex space-x-4">
                                {item.status === 'DOWNLOADING' && (
                                  <>
                                    <span className="text-cyan-500 font-bold">{formatSpeed(item.speed)}</span>
                                    <span>ETA: {getETA(item)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Control Buttons (Lucide Icons) */}
                          <div className="flex items-center space-x-2 self-end shrink-0">
                            {item.status !== 'COMPLETED' && item.status !== 'ERROR' && (
                              item.status === 'DOWNLOADING' || item.status === 'CONNECTING' ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); pauseDownload(item.id); }}
                                  className="p-1.5 bg-app-input hover:bg-amber-500/10 rounded-lg text-amber-500 border border-app-border hover:border-amber-500/20 transition cursor-pointer"
                                  title="Pause Download"
                                >
                                  <Pause className="w-4 h-4 fill-current" />
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); startDownload(item.id); }}
                                  className="p-1.5 bg-app-input hover:bg-emerald-500/10 rounded-lg text-emerald-500 border border-app-border hover:border-emerald-500/20 transition cursor-pointer"
                                  title="Resume Download"
                                >
                                  <Play className="w-4 h-4 fill-current" />
                                </button>
                              )
                            )}
                            
                            {item.status === 'COMPLETED' && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); openFileDirectly(item.path); }}
                                  className="p-1.5 bg-app-input hover:bg-emerald-500/10 rounded-lg text-emerald-400 border border-app-border hover:border-emerald-500/20 transition cursor-pointer"
                                  title="Open File"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); openFile(item.path); }}
                                  className="p-1.5 bg-app-input hover:bg-cyan-500/10 rounded-lg text-cyan-500 border border-app-border hover:border-cyan-500/20 transition cursor-pointer"
                                  title="Open Folder Location"
                                >
                                  <FolderOpen className="w-4 h-4" />
                                </button>
                              </>
                            )}

                            <button
                              onClick={(e) => { e.stopPropagation(); openDeleteModal(item.id); }}
                              className="p-1.5 bg-app-input hover:bg-rose-500/10 rounded-lg text-rose-500 border border-app-border hover:border-rose-500/20 transition cursor-pointer"
                              title="Delete registry"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Real-time segment connection display panel */}
              {selectedDownload && (
                <div className="w-96 glass border-l border-app-border flex flex-col h-full overflow-hidden bg-app-sidebar transition-colors duration-300 shrink-0">
                  {/* Fixed Header */}
                  <div className="p-5 border-b border-app-border bg-app-header flex items-center justify-between shrink-0 select-none">
                    <div className="min-w-0 pr-4">
                      <h3 className="font-bold text-app-text-primary text-xs truncate w-64 select-text" title={selectedDownload.filename}>
                        {selectedDownload.filename}
                      </h3>
                      <p className="text-[9px] text-app-text-muted font-mono tracking-widest uppercase mt-0.5">Connection Monitor</p>
                    </div>
                    <button
                      onClick={() => setSelectedDownloadId(null)}
                      className="text-app-text-secondary hover:text-app-text-primary transition p-1.5 rounded-lg hover:bg-app-hover cursor-pointer"
                      title="Close panel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Fixed Details Pane (Stable) */}
                  <div className="p-5 space-y-4 shrink-0 border-b border-app-border/40 bg-app-sidebar/40">
                    {/* Performance Line Chart */}
                    {selectedDownload.status === 'DOWNLOADING' && (
                      <div className="space-y-2">
                        <span className="text-[10px] text-app-text-secondary font-bold uppercase tracking-wider block">Speed graph</span>
                        <div className="bg-app-input rounded-xl overflow-hidden border border-app-border p-2 shadow-inner">
                          <canvas ref={canvasRef} width={340} height={100} className="w-full h-[100px] block" />
                        </div>
                      </div>
                    )}

                    {/* Info Details List */}
                    <div className="glass-card rounded-xl p-3.5 space-y-2.5 text-[11px] font-mono border border-app-card-border select-text">
                      <div className="flex justify-between items-center">
                        <span className="text-app-text-muted flex items-center space-x-1.5"><FileText className="w-3.5 h-3.5" /> <span>File size:</span></span>
                        <span className="text-app-text-primary font-semibold">{formatBytes(selectedDownload.totalSize)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-app-text-muted flex items-center space-x-1.5"><Clock className="w-3.5 h-3.5" /> <span>Status:</span></span>
                        <span className="text-cyan-500 uppercase font-bold text-[10px]">{selectedDownload.status}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-app-text-muted flex items-center space-x-1.5"><Folder className="w-3.5 h-3.5" /> <span>Path:</span></span>
                        <span className="text-app-text-secondary truncate max-w-[190px]" title={selectedDownload.path}>{selectedDownload.path}</span>
                      </div>

                      {selectedDownload.status === 'COMPLETED' && (
                        <div className="flex items-center space-x-2 pt-2 border-t border-app-border/40">
                          <button
                            onClick={() => openFileDirectly(selectedDownload.path)}
                            className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white text-xs font-bold py-2 rounded-xl flex items-center justify-center space-x-1.5 cursor-pointer shadow-md shadow-emerald-500/10 transition"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Open File</span>
                          </button>
                          <button
                            onClick={() => openFile(selectedDownload.path)}
                            className="flex-1 bg-app-input border border-app-border hover:bg-app-hover text-app-text-primary text-xs font-bold py-2 rounded-xl flex items-center justify-center space-x-1.5 cursor-pointer transition"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-cyan-500" />
                            <span>Open Folder</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Thread Segments Header (Fixed Position) */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-app-text-secondary font-bold uppercase tracking-wider">
                        Thread Segments ({selectedDownload.segments?.length || 0})
                      </span>
                      {selectedDownload.status === 'DOWNLOADING' && (
                        <span className="text-[9px] font-mono text-cyan-500 font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 animate-pulse">
                          Active
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Scrollable Connections List (Cards scroll cleanly underneath fixed header) */}
                  <div className="flex-1 overflow-y-auto p-5 space-y-3 min-h-0 custom-scrollbar">
                    {selectedDownload.segments && selectedDownload.segments.length > 0 ? (
                      <div className="space-y-3">
                        {selectedDownload.segments.map((seg) => (
                          <div key={seg.id} className="glass-card p-3 rounded-xl space-y-1.5 border border-app-border/40 select-none hover:border-cyan-500/30 transition-colors">
                            <div className="flex justify-between text-[10px] font-mono text-app-text-secondary">
                              <span className="font-bold text-app-text-primary">Connection #{seg.id + 1}</span>
                              <span className="font-bold text-cyan-500">{seg.percent.toFixed(1)}%</span>
                            </div>
                            <div className="segment-bar">
                              <div
                                className={`segment-fill ${seg.completed ? 'completed' : ''} ${
                                  selectedDownload.status === 'DOWNLOADING' && !seg.completed ? 'active' : ''
                                }`}
                                style={{ width: `${seg.percent}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-[9px] font-mono text-app-text-muted">
                              <span>Bytes: {seg.start} - {seg.end}</span>
                              <span className="font-semibold text-app-text-secondary">({formatBytes(seg.downloaded)})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-app-text-secondary bg-app-input/50 p-4 rounded-xl text-center font-mono border border-app-border select-none">
                        {selectedDownload.status === 'COMPLETED' ? (
                          <span className="text-emerald-500 flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> Segments merged successfully</span>
                        ) : (
                          'Waiting to connect ranges...'
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Add Download Modal */}
        {showAddModal && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass w-full max-w-xl p-8 rounded-2xl border border-app-sidebar-border shadow-2xl relative animate-in fade-in zoom-in duration-200">
              
              <button
                onClick={() => setShowAddModal(false)}
                className="absolute top-6 right-6 text-app-text-secondary hover:text-app-text-primary transition"
              >
                <X className="w-6 h-6" />
              </button>

              <h3 className="text-base font-bold text-app-text-primary mb-6 flex items-center space-x-2">
                <Plus className="w-5 h-5 text-cyan-500" />
                <span>Add Download Link</span>
              </h3>

              <form onSubmit={handleAddDownload} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs text-app-text-secondary font-bold block uppercase tracking-wider">URL Address</label>
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/file.zip"
                    value={downloadUrl}
                    onChange={(e) => setDownloadUrl(e.target.value)}
                    className="w-full glass-input rounded-xl px-4 py-3 text-sm focus:outline-none select-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-app-text-secondary font-bold block uppercase tracking-wider">Custom Filename (Optional)</label>
                  <input
                    type="text"
                    placeholder="Leave empty to autodetect"
                    value={customFilename}
                    onChange={(e) => setCustomFilename(e.target.value)}
                    className="w-full glass-input rounded-xl px-4 py-3 text-sm focus:outline-none select-all"
                  />
                </div>

                <div className="pt-4 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="bg-app-input hover:bg-app-hover border border-app-border text-app-text-primary px-5 py-2.5 rounded-xl text-sm font-bold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition glow-btn flex items-center space-x-2"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin shrink-0" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <span>Start Download</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteItemId && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass w-full max-w-md p-6 rounded-2xl border border-app-sidebar-border shadow-2xl relative animate-in fade-in zoom-in duration-200">
              <button
                type="button"
                onClick={() => setDeleteItemId(null)}
                className="absolute top-4 right-4 text-app-text-secondary hover:text-app-text-primary transition"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-base font-bold text-app-text-primary mb-4 flex items-center space-x-2">
                <Trash2 className="w-5 h-5 text-rose-500" />
                <span>Delete Download</span>
              </h3>

              <div className="space-y-4">
                <p className="text-sm text-app-text-secondary leading-relaxed">
                  Are you sure you want to delete this download from the application registry?
                  {downloads.find(d => d.id === deleteItemId) && (
                    <span className="block font-bold text-app-text-primary mt-1 truncate select-text">
                      "{downloads.find(d => d.id === deleteItemId)?.filename}"
                    </span>
                  )}
                </p>

                <label className="flex items-center space-x-3 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    checked={alsoDeleteFile}
                    onChange={(e) => setAlsoDeleteFile(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-app-border bg-app-input cursor-pointer"
                  />
                  <span className="text-xs text-app-text-primary font-medium">
                    Also delete downloaded file from storage
                  </span>
                </label>

                <div className="pt-4 flex justify-end space-x-3 border-t border-app-border">
                  <button
                    type="button"
                    onClick={() => setDeleteItemId(null)}
                    className="bg-app-input hover:bg-app-hover border border-app-border text-app-text-primary px-4 py-2 rounded-xl text-sm font-bold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    className="bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition shadow-md shadow-rose-500/10 glow-btn"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Clear All Confirmation Modal */}
        {showClearAllModal && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass w-full max-w-md p-6 rounded-2xl border border-app-sidebar-border shadow-2xl relative animate-in fade-in zoom-in duration-200">
              <button
                type="button"
                onClick={() => setShowClearAllModal(false)}
                className="absolute top-4 right-4 text-app-text-secondary hover:text-app-text-primary transition"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-base font-bold text-app-text-primary mb-4 flex items-center space-x-2">
                <Trash2 className="w-5 h-5 text-rose-500" />
                <span>Clear All Downloads</span>
              </h3>

              <div className="space-y-4">
                <p className="text-sm text-app-text-secondary leading-relaxed">
                  Are you sure you want to remove all downloads from the list?
                </p>

                <label className="flex items-center space-x-3 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    checked={clearAllDeleteFiles}
                    onChange={(e) => setClearAllDeleteFiles(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-app-border bg-app-input cursor-pointer"
                  />
                  <span className="text-xs text-app-text-primary font-medium">
                    Also delete downloaded files from storage
                  </span>
                </label>

                <div className="pt-4 flex justify-end space-x-3 border-t border-app-border">
                  <button
                    type="button"
                    onClick={() => setShowClearAllModal(false)}
                    className="bg-app-input hover:bg-app-hover border border-app-border text-app-text-primary px-4 py-2 rounded-xl text-sm font-bold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmClearAll}
                    className="bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition shadow-md shadow-rose-500/10 glow-btn"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Selected Confirmation Modal */}
        {showDeleteSelectedModal && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass w-full max-w-md p-6 rounded-2xl border border-app-sidebar-border shadow-2xl relative animate-in fade-in zoom-in duration-200">
              <button
                type="button"
                onClick={() => setShowDeleteSelectedModal(false)}
                className="absolute top-4 right-4 text-app-text-secondary hover:text-app-text-primary transition"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-base font-bold text-app-text-primary mb-4 flex items-center space-x-2">
                <Trash2 className="w-5 h-5 text-rose-500" />
                <span>Delete {selectedCardIds.length} Selected Downloads</span>
              </h3>

              <div className="space-y-4">
                <p className="text-sm text-app-text-secondary leading-relaxed">
                  Are you sure you want to delete <strong className="text-app-text-primary">{selectedCardIds.length}</strong> selected downloads from the registry?
                </p>

                <label className="flex items-center space-x-3 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    checked={deleteSelectedFiles}
                    onChange={(e) => setDeleteSelectedFiles(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-app-border bg-app-input cursor-pointer"
                  />
                  <span className="text-xs text-app-text-primary font-medium">
                    Also delete downloaded files from storage
                  </span>
                </label>

                <div className="pt-4 flex justify-end space-x-3 border-t border-app-border">
                  <button
                    type="button"
                    onClick={() => setShowDeleteSelectedModal(false)}
                    className="bg-app-input hover:bg-app-hover border border-app-border text-app-text-primary px-4 py-2 rounded-xl text-sm font-bold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteSelected}
                    className="bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition shadow-md shadow-rose-500/10 glow-btn"
                  >
                    Delete Selected ({selectedCardIds.length})
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
