const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { EventEmitter } = require('events');

class SegmentDownloader extends EventEmitter {
  constructor(url, destPath, options = {}) {
    super();
    this.url = url;
    this.destPath = destPath;
    this.metaPath = destPath + '.blaze.json';
    this.connectionCount = options.connections || 8;
    this.retryLimit = options.retryLimit || 5;
    
    this.totalSize = 0;
    this.acceptRanges = false;
    this.filename = path.basename(destPath);
    this.status = 'IDLE'; // IDLE, CONNECTING, DOWNLOADING, PAUSED, COMPLETED, ERROR
    this.segments = [];
    this.activeRequests = [];
    this.fileHandle = null;
    
    // For speed calculations
    this.downloadedSinceLastTick = 0;
    this.speed = 0; // bytes per second
    this.prevDownloaded = 0;
    this.lastTickTime = Date.now();
    this.speedInterval = null;
  }
  
  async getInfo() {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(this.url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 10000
      };
      
      const req = client.request(this.url, options, (res) => {
        if (res.statusCode >= 400 && res.statusCode !== 405) {
          // If status code is an error, try with GET
          this.probeWithGet().then(resolve).catch(reject);
        } else {
          const contentLength = res.headers['content-length'];
          const acceptRanges = res.headers['accept-ranges'];
          
          this.totalSize = contentLength ? parseInt(contentLength, 10) : 0;
          this.acceptRanges = acceptRanges === 'bytes' || res.headers['content-range'] !== undefined;
          
          resolve({
            totalSize: this.totalSize,
            acceptRanges: this.acceptRanges,
            filename: this.getFilenameFromHeaders(res.headers) || path.basename(parsedUrl.pathname) || 'download'
          });
        }
      });
      
      req.on('error', (err) => {
        this.probeWithGet().then(resolve).catch(reject);
      });
      
      req.on('timeout', () => {
        req.destroy();
        this.probeWithGet().then(resolve).catch(reject);
      });
      
      req.end();
    });
  }
  
  async probeWithGet() {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(this.url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Range': 'bytes=0-0'
        },
        timeout: 10000
      };
      
      const req = client.request(this.url, options, (res) => {
        const isRangeSupported = res.statusCode === 206;
        let totalSize = 0;
        
        const contentRange = res.headers['content-range'];
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)$/);
          if (match) {
            totalSize = parseInt(match[1], 10);
          }
        }
        
        if (!totalSize && res.headers['content-length'] && !isRangeSupported) {
          totalSize = parseInt(res.headers['content-length'], 10);
        }
        
        resolve({
          totalSize: totalSize,
          acceptRanges: isRangeSupported,
          filename: this.getFilenameFromHeaders(res.headers) || path.basename(parsedUrl.pathname) || 'download'
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timeout while probing server'));
      });
      req.end();
    });
  }
  
  getFilenameFromHeaders(headers) {
    const disposition = headers['content-disposition'];
    if (disposition && disposition.indexOf('attachment') !== -1) {
      const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
      const matches = filenameRegex.exec(disposition);
      if (matches != null && matches[1]) {
        return matches[1].replace(/['"]/g, '');
      }
    }
    return null;
  }
  
  async start() {
    this.status = 'CONNECTING';
    this.emit('status', this.status);
    
    try {
      const info = await this.getInfo();
      this.totalSize = info.totalSize;
      this.acceptRanges = info.acceptRanges;
      this.filename = info.filename;
      
      this.status = 'DOWNLOADING';
      this.emit('status', this.status);
      this.emit('info', info);
      
      let isResume = false;
      if (fs.existsSync(this.metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf8'));
          if (meta.url === this.url && meta.totalSize === this.totalSize && meta.segments.length > 0) {
            this.segments = meta.segments;
            isResume = true;
          }
        } catch (e) {
          console.error("Failed to parse metadata, starting fresh:", e);
        }
      }
      
      if (!isResume) {
        if (fs.existsSync(this.destPath)) {
          fs.unlinkSync(this.destPath);
        }
        
        fs.writeFileSync(this.destPath, '');
        
        if (this.totalSize > 0) {
          const fd = fs.openSync(this.destPath, 'r+');
          fs.ftruncateSync(fd, this.totalSize);
          fs.closeSync(fd);
        }
        
        this.segments = [];
        if (this.acceptRanges && this.totalSize > 0 && this.connectionCount > 1) {
          const chunkSize = Math.floor(this.totalSize / this.connectionCount);
          for (let i = 0; i < this.connectionCount; i++) {
            const start = i * chunkSize;
            const end = (i === this.connectionCount - 1) ? this.totalSize - 1 : (start + chunkSize - 1);
            this.segments.push({
              id: i,
              start: start,
              end: end,
              current: start,
              completed: false,
              downloaded: 0
            });
          }
        } else {
          this.segments.push({
            id: 0,
            start: 0,
            end: this.totalSize ? this.totalSize - 1 : null,
            current: 0,
            completed: false,
            downloaded: 0
          });
        }
      }
      
      this.fileHandle = fs.openSync(this.destPath, 'r+');
      this.startSpeedTicker();
      
      const promises = this.segments.map(seg => this.downloadSegmentWithRetry(seg, this.retryLimit));
      
      Promise.all(promises).then(() => {
        if (this.status === 'DOWNLOADING') {
          this.status = 'COMPLETED';
          this.cleanup();
          this.saveMetadata(); // will delete metadata file since status is COMPLETED
          this.emit('status', this.status);
          this.emitProgress();
        }
      }).catch(err => {
        if (this.status === 'DOWNLOADING') {
          this.status = 'ERROR';
          this.cleanup();
          this.emit('status', this.status);
          this.emit('error', err.message || err);
        }
      });
      
    } catch (err) {
      this.status = 'ERROR';
      this.emit('status', this.status);
      this.emit('error', err.message || err);
    }
  }
  
  async downloadSegmentWithRetry(segment, retriesLeft) {
    try {
      await this.downloadSegment(segment);
    } catch (err) {
      if (this.status !== 'DOWNLOADING') {
        throw err;
      }
      if (retriesLeft > 0) {
        console.log(`Segment ${segment.id} failed, retrying in 1.5s. Retries left: ${retriesLeft}`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        return this.downloadSegmentWithRetry(segment, retriesLeft - 1);
      } else {
        throw err;
      }
    }
  }
  
  downloadSegment(segment) {
    return new Promise((resolve, reject) => {
      if (segment.completed) {
        resolve();
        return;
      }
      
      const parsedUrl = new URL(this.url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };
      
      if (this.acceptRanges && segment.end !== null) {
        headers['Range'] = `bytes=${segment.current}-${segment.end}`;
      }
      
      const options = {
        method: 'GET',
        headers: headers,
        timeout: 15000
      };
      
      const req = client.get(this.url, options, (res) => {
        if (this.acceptRanges && res.statusCode !== 206) {
          // If range was requested but server ignored and returned 200, we should adapt
          if (res.statusCode === 200) {
            // Server ignored range, fallback to single stream
            this.acceptRanges = false;
          } else {
            reject(new Error(`Server returned status code ${res.statusCode}`));
            return;
          }
        }
        
        res.on('data', (chunk) => {
          if (this.status !== 'DOWNLOADING') {
            req.destroy();
            return;
          }
          
          try {
            const chunkLength = chunk.length;
            
            // Check if we exceed bounds in range download
            if (this.acceptRanges && segment.end !== null && segment.current + chunkLength > segment.end + 1) {
              const overflow = (segment.current + chunkLength) - (segment.end + 1);
              const validBytes = chunkLength - overflow;
              if (validBytes > 0) {
                fs.writeSync(this.fileHandle, chunk, 0, validBytes, segment.current);
                segment.current += validBytes;
                segment.downloaded += validBytes;
                this.downloadedSinceLastTick += validBytes;
              }
              req.destroy();
              resolve();
              return;
            }
            
            fs.writeSync(this.fileHandle, chunk, 0, chunkLength, segment.current);
            segment.current += chunkLength;
            segment.downloaded += chunkLength;
            this.downloadedSinceLastTick += chunkLength;
            
            this.emitProgress();
          } catch (e) {
            req.destroy();
            reject(e);
          }
        });
        
        res.on('end', () => {
          if (this.status === 'DOWNLOADING') {
            segment.completed = true;
            this.saveMetadata();
            resolve();
          }
        });
        
        res.on('error', (err) => {
          reject(err);
        });
      });
      
      req.on('error', (err) => {
        reject(err);
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Read timeout on segment'));
      });
      
      this.activeRequests.push(req);
    });
  }
  
  pause() {
    if (this.status !== 'DOWNLOADING' && this.status !== 'CONNECTING') return;
    
    this.status = 'PAUSED';
    
    this.activeRequests.forEach(req => {
      try {
        req.destroy();
      } catch (e) {}
    });
    this.activeRequests = [];
    
    this.cleanup();
    this.saveMetadata();
    
    this.emit('status', this.status);
    this.emitProgress();
  }
  
  saveMetadata() {
    if (this.status === 'COMPLETED') {
      try {
        if (fs.existsSync(this.metaPath)) {
          fs.unlinkSync(this.metaPath);
        }
      } catch (e) {}
      return;
    }
    
    const meta = {
      url: this.url,
      totalSize: this.totalSize,
      segments: this.segments
    };
    
    try {
      fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch (e) {
      console.error("Failed to save download metadata:", e);
    }
  }
  
  cleanup() {
    if (this.speedInterval) {
      clearInterval(this.speedInterval);
      this.speedInterval = null;
    }
    
    if (this.fileHandle) {
      try {
        fs.closeSync(this.fileHandle);
      } catch (e) {}
      this.fileHandle = null;
    }
  }
  
  startSpeedTicker() {
    this.prevDownloaded = this.segments.reduce((acc, seg) => acc + seg.downloaded, 0);
    this.lastTickTime = Date.now();
    this.downloadedSinceLastTick = 0;
    
    this.speedInterval = setInterval(() => {
      const now = Date.now();
      const timePassed = (now - this.lastTickTime) / 1000;
      
      if (timePassed > 0) {
        this.speed = Math.floor(this.downloadedSinceLastTick / timePassed);
        this.downloadedSinceLastTick = 0;
        this.lastTickTime = now;
        this.emitProgress();
      }
    }, 1000);
  }
  
  emitProgress() {
    const downloaded = this.segments.reduce((acc, seg) => acc + seg.downloaded, 0);
    const percent = this.totalSize > 0 ? parseFloat(((downloaded / this.totalSize) * 100).toFixed(2)) : 0;
    
    this.emit('progress', {
      percent: percent,
      speed: this.speed,
      downloaded: downloaded,
      total: this.totalSize,
      status: this.status,
      segments: this.segments.map(seg => ({
        id: seg.id,
        start: seg.start,
        end: seg.end,
        current: seg.current,
        downloaded: seg.downloaded,
        percent: (seg.end - seg.start > 0) ? parseFloat(((seg.downloaded / (seg.end - seg.start + 1)) * 100).toFixed(2)) : 0,
        completed: seg.completed
      }))
    });
  }
}

module.exports = SegmentDownloader;
