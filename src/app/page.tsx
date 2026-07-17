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
  downloaded: number;
  percent: number;
  completed: boolean;
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
      addDownload: (data: { url: string; fileName?: string; customDir?: string }) => Promise<DownloadItem>;
      startDownload: (data: { id: string }) => Promise<boolean>;
      pauseDownload: (data: { id: string }) => Promise<boolean>;
      deleteDownload: (data: { id: string; deleteFile: boolean }) => Promise<boolean>;
      openFileLocation: (data: { filePath: string }) => Promise<boolean>;
      onDownloadsUpdated: (callback: (data: DownloadItem[]) => void) => () => void;
      onDownloadInfo: (callback: (data: { id: string; info: any }) => void) => () => void;
      onDownloadStatus: (callback: (data: { id: string; status: string }) => void) => () => void;
      onDownloadProgress: (callback: (data: { id: string; progress: any }) => void) => () => void;
      onDownloadError: (callback: (data: { id: string; error: string }) => void) => () => void;
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
  
  // Form fields
  const [downloadUrl, setDownloadUrl] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Settings fields
  const [settings, setSettings] = useState<AppSettings>({ downloadDir: '', connections: 8 });
  const [connectionsDropdownOpen, setConnectionsDropdownOpen] = useState(false);
  
  // Delete fields
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [alsoDeleteFile, setAlsoDeleteFile] = useState(false);
  
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

      return () => {
        unsubUpdated();
        unsubProgress();
        unsubStatus();
        unsubError();
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
          fileName: customFilename || undefined
        });
        
        await window.electronAPI.startDownload({ id: item.id });
        
        setDownloadUrl('');
        setCustomFilename('');
        setShowAddModal(false);
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

  const openFile = async (filePath: string) => {
    if (window.electronAPI) {
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

  // Filtering
  const filteredDownloads = downloads.filter((d) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'downloading') return d.status === 'DOWNLOADING' || d.status === 'CONNECTING';
    if (activeTab === 'paused') return d.status === 'PAUSED';
    if (activeTab === 'completed') return d.status === 'COMPLETED';
    return true;
  });

  const selectedDownload = downloads.find(d => d.id === selectedDownloadId);

  return (
    <div className="flex-1 flex overflow-hidden bg-app-bg text-app-text-primary font-sans transition-colors duration-300">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 glass flex flex-col justify-between p-6 border-r border-app-sidebar-border bg-app-sidebar">
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
                return false;
              }).length;

              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    setShowSettings(false);
                  }}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 font-medium text-sm border-l-4 ${
                    isActive && !showSettings
                      ? 'bg-gradient-to-r from-blue-600/20 to-cyan-500/5 text-cyan-500 border-cyan-500 shadow-sm'
                      : 'text-app-text-secondary border-transparent hover:text-app-text-primary hover:bg-app-hover'
                  }`}
                >
                  <IconComponent className="w-5 h-5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                  {tab.id !== 'all' && count > 0 && (
                    <span className="ml-auto h-5 min-w-[20px] px-1.5 flex items-center justify-center text-[11px] font-bold bg-app-input border border-app-border text-app-text-secondary rounded-full font-mono leading-none">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Controls */}
        <div className="space-y-2 select-none">
          {/* Light/Dark Toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition text-app-text-secondary hover:text-app-text-primary hover:bg-app-hover text-sm font-medium border border-transparent hover:border-app-border"
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
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 font-medium text-sm ${
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
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header bar */}
        <header className="h-20 flex items-center justify-between px-8 border-b border-app-border bg-app-header transition-colors duration-300">
          <div>
            <h2 className="text-lg font-bold capitalize text-app-text-primary tracking-wide">
              {showSettings ? 'Configuration' : `${activeTab} downloads`}
            </h2>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-md shadow-cyan-500/10 flex items-center space-x-2 transition-all glow-btn"
            >
              <Plus className="w-5 h-5" />
              <span>New Download</span>
            </button>
          </div>
        </header>

        {/* Dashboard Panels */}
        <div className="flex-1 flex overflow-hidden">
          
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
              <div className="flex-1 flex flex-col min-w-0 bg-transparent">
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                            <div className="min-w-0 flex-1 pr-4">
                              <h4 className="font-bold text-app-text-primary text-sm truncate select-text" title={item.filename}>
                                {item.filename}
                              </h4>
                              <p className="text-sm text-app-text-secondary truncate select-text mt-1.5" title={item.url}>
                                {item.url}
                              </p>
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
                                  className="p-1.5 bg-app-input hover:bg-amber-500/10 rounded-lg text-amber-500 border border-app-border hover:border-amber-500/20 transition"
                                  title="Pause Download"
                                >
                                  <Pause className="w-4 h-4 fill-current" />
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); startDownload(item.id); }}
                                  className="p-1.5 bg-app-input hover:bg-emerald-500/10 rounded-lg text-emerald-500 border border-app-border hover:border-emerald-500/20 transition"
                                  title="Resume Download"
                                >
                                  <Play className="w-4 h-4 fill-current" />
                                </button>
                              )
                            )}
                            
                            {item.status === 'COMPLETED' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); openFile(item.path); }}
                                className="p-1.5 bg-app-input hover:bg-cyan-500/10 rounded-lg text-cyan-500 border border-app-border hover:border-cyan-500/20 transition"
                                title="Open Location"
                              >
                                <FolderOpen className="w-4 h-4" />
                              </button>
                            )}

                            <button
                              onClick={(e) => { e.stopPropagation(); openDeleteModal(item.id); }}
                              className="p-1.5 bg-app-input hover:bg-rose-500/10 rounded-lg text-rose-500 border border-app-border hover:border-rose-500/20 transition"
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
                <div className="w-96 glass border-l border-app-border flex flex-col overflow-hidden bg-app-sidebar transition-colors duration-300">
                  <div className="p-6 border-b border-app-border bg-app-header flex items-center justify-between">
                    <div className="min-w-0 pr-4">
                      <h3 className="font-bold text-app-text-primary text-xs truncate w-72 select-text" title={selectedDownload.filename}>
                        {selectedDownload.filename}
                      </h3>
                      <p className="text-[9px] text-app-text-muted font-mono select-none tracking-widest uppercase">Connection Monitor</p>
                    </div>
                    <button
                      onClick={() => setSelectedDownloadId(null)}
                      className="text-app-text-secondary hover:text-app-text-primary transition p-1"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Performance Line Chart */}
                    {selectedDownload.status === 'DOWNLOADING' && (
                      <div className="space-y-2">
                        <span className="text-[11px] text-app-text-secondary font-bold uppercase tracking-wider block">Speed graph</span>
                        <div className="bg-app-input rounded-xl overflow-hidden border border-app-border p-2">
                          <canvas ref={canvasRef} width={340} height={120} className="w-full h-[120px] block" />
                        </div>
                      </div>
                    )}

                    {/* Info Details List */}
                    <div className="glass-card rounded-xl p-4 space-y-3 text-[11px] font-mono border border-app-card-border select-text">
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
                        <span className="text-app-text-secondary truncate max-w-[200px]" title={selectedDownload.path}>{selectedDownload.path}</span>
                      </div>
                    </div>

                    {/* IDM style Connection Segments Visualizer */}
                    <div className="space-y-3">
                      <span className="text-[11px] text-app-text-secondary font-bold uppercase tracking-wider block">
                        Thread Segments ({selectedDownload.segments?.length || 0})
                      </span>
                      
                      {selectedDownload.segments && selectedDownload.segments.length > 0 ? (
                        <div className="space-y-3.5">
                          {selectedDownload.segments.map((seg) => (
                            <div key={seg.id} className="space-y-1 select-none">
                              <div className="flex justify-between text-[10px] font-mono text-app-text-secondary">
                                <span className="font-semibold text-app-text-primary">Connection #{seg.id + 1}</span>
                                <span>{seg.percent.toFixed(1)}%</span>
                              </div>
                              <div className="segment-bar">
                                <div
                                  className={`segment-fill ${seg.completed ? 'completed' : ''} ${
                                    selectedDownload.status === 'DOWNLOADING' && !seg.completed ? 'active' : ''
                                  }`}
                                  style={{ width: `${seg.percent}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[8px] font-mono text-app-text-muted">
                                <span>Bytes: {seg.start} - {seg.end}</span>
                                <span>({formatBytes(seg.downloaded)})</span>
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
      </main>
    </div>
  );
}
