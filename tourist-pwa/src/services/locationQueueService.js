/**
 * Location Update Queue Service
 * 
 * Provides intelligent queueing and retry logic for location updates
 * with exponential backoff and telemetry
 */

import axios from 'axios';

const MAX_QUEUE_SIZE = 100;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;
const TELEMETRY_BUFFER_SIZE = 50;

class LocationQueueService {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.telemetry = [];
    this.stats = {
      totalQueued: 0,
      totalSent: 0,
      totalFailed: 0,
      totalRetried: 0,
      avgRetryCount: 0,
      lastSyncTime: null,
      lastError: null
    };
    this.onStatsUpdate = null;
  }

  /**
   * Add location update to queue
   */
  enqueue(locationData, options = {}) {
    const {
      priority = 'normal', // low | normal | high | emergency
      retryCount = 0,
      maxRetries = MAX_RETRIES
    } = options;

    const item = {
      id: `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      data: locationData,
      priority,
      retryCount,
      maxRetries,
      timestamp: Date.now(),
      nextRetryTime: Date.now()
    };

    // Check queue size
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest low-priority items
      this.queue = this.queue.filter(i => i.priority !== 'low');
      
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        // Still full, remove oldest normal priority
        this.queue.sort((a, b) => {
          if (a.priority === b.priority) {
            return a.timestamp - b.timestamp;
          }
          return a.priority === 'emergency' ? -1 : 1;
        });
        this.queue.shift();
      }
    }

    this.queue.push(item);
    this.stats.totalQueued++;
    
    // Sort by priority and timestamp
    this.sortQueue();

    this.recordTelemetry('queued', { itemId: item.id, priority, queueSize: this.queue.length });

    console.log(`[LocationQueue] Enqueued ${item.id}, queue size: ${this.queue.length}`);

    // Trigger processing if not already running
    if (!this.processing) {
      this.processQueue();
    }

    return item.id;
  }

  /**
   * Sort queue by priority
   */
  sortQueue() {
    const priorityOrder = { emergency: 0, high: 1, normal: 2, low: 3 };
    this.queue.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.nextRetryTime - b.nextRetryTime;
    });
  }

  /**
   * Process queue
   */
  async processQueue() {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      // Check if we should wait before processing next item
      const next = this.queue[0];
      const now = Date.now();

      if (next.nextRetryTime > now) {
        // Wait until next retry time
        const waitMs = Math.min(next.nextRetryTime - now, 5000);
        await this.sleep(waitMs);
        continue;
      }

      const item = this.queue.shift();

      try {
        await this.sendLocationUpdate(item);
        this.stats.totalSent++;
        this.stats.lastSyncTime = Date.now();
        this.recordTelemetry('sent', { itemId: item.id, retryCount: item.retryCount });
        console.log(`[LocationQueue] Sent ${item.id}`);
      } catch (error) {
        console.error(`[LocationQueue] Failed to send ${item.id}:`, error?.message || error);
        this.stats.lastError = {
          itemId: item.id,
          error: error?.message || 'Unknown error',
          timestamp: Date.now()
        };

        // Retry logic
        if (item.retryCount < item.maxRetries) {
          item.retryCount++;
          this.stats.totalRetried++;
          
          // Calculate backoff
          const backoffMs = Math.min(
            INITIAL_BACKOFF_MS * Math.pow(2, item.retryCount),
            MAX_BACKOFF_MS
          );
          
          item.nextRetryTime = Date.now() + backoffMs;
          
          // Re-add to queue
          this.queue.push(item);
          this.sortQueue();

          this.recordTelemetry('retry', { 
            itemId: item.id, 
            retryCount: item.retryCount,
            backoffMs,
            error: error?.message 
          });

          console.log(`[LocationQueue] Retry ${item.id} (${item.retryCount}/${item.maxRetries}) in ${backoffMs}ms`);
        } else {
          this.stats.totalFailed++;
          this.recordTelemetry('failed', { 
            itemId: item.id, 
            retryCount: item.retryCount,
            error: error?.message 
          });
          console.error(`[LocationQueue] Max retries exceeded for ${item.id}`);
        }
      }

      // Update stats
      if (this.onStatsUpdate) {
        this.onStatsUpdate(this.getStats());
      }

      // Small delay between sends to avoid overwhelming server
      await this.sleep(100);
    }

    this.processing = false;
    console.log('[LocationQueue] Queue processing complete');
  }

  /**
   * Send location update to backend
   */
  async sendLocationUpdate(item) {
    const { data } = item;
    
    // Get backend URL
    const backendUrl = this.getBackendURL();
    const endpoint = `${backendUrl}/api/location`;

    const payload = {
      passportId: data.passportId || data.identifier,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      timestamp: data.timestamp || Date.now(),
      source: data.source || 'app',
      ...data
    };

    const response = await axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      withCredentials: true,
      timeout: 10000
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Get backend URL
   */
  getBackendURL() {
    const sanitize = (value) => {
      if (!value) return null;
      let candidate = value.trim();
      if (!candidate) return null;
      if (!/^https?:\/\//i.test(candidate)) {
        candidate = `http://${candidate.replace(/^\/+/,'')}`;
      }
      try {
        const parsed = new URL(candidate);
        return parsed.origin;
      } catch (err) {
        console.warn('[LocationQueueService] Failed to sanitize backend URL:', err?.message || err);
        return null;
      }
    };

    try {
      const stored = localStorage.getItem('BACKEND_URL');
      const normalized = sanitize(stored);
      if (normalized) {
        return normalized;
      }
    } catch (e) {
      // ignore
    }

    const fallbackLocal = sanitize(process.env.REACT_APP_BACKEND_URL) || 'http://localhost:3001';

    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return fallbackLocal;
      }
      return `${window.location.protocol}//${hostname}:3001`;
    }

    return fallbackLocal;
  }

  /**
   * Record telemetry event
   */
  recordTelemetry(event, data) {
    const entry = {
      event,
      timestamp: Date.now(),
      data
    };

    this.telemetry.push(entry);

    // Keep buffer size limited
    if (this.telemetry.length > TELEMETRY_BUFFER_SIZE) {
      this.telemetry.shift();
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const avgRetry = this.stats.totalRetried > 0
      ? this.stats.totalRetried / (this.stats.totalSent + this.stats.totalFailed)
      : 0;

    return {
      ...this.stats,
      avgRetryCount: avgRetry,
      queueSize: this.queue.length,
      isProcessing: this.processing,
      successRate: this.stats.totalSent > 0
        ? (this.stats.totalSent / (this.stats.totalSent + this.stats.totalFailed)) * 100
        : 0
    };
  }

  /**
   * Get telemetry data
   */
  getTelemetry(limit = 20) {
    return this.telemetry.slice(-limit);
  }

  /**
   * Clear queue
   */
  clearQueue() {
    this.queue = [];
    console.log('[LocationQueue] Queue cleared');
  }

  /**
   * Reset stats
   */
  resetStats() {
    this.stats = {
      totalQueued: 0,
      totalSent: 0,
      totalFailed: 0,
      totalRetried: 0,
      avgRetryCount: 0,
      lastSyncTime: null,
      lastError: null
    };
    console.log('[LocationQueue] Stats reset');
  }

  /**
   * Set stats update callback
   */
  setStatsUpdateCallback(callback) {
    this.onStatsUpdate = callback;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get queue snapshot
   */
  getQueueSnapshot() {
    return this.queue.map(item => ({
      id: item.id,
      priority: item.priority,
      retryCount: item.retryCount,
      timestamp: item.timestamp,
      nextRetryTime: item.nextRetryTime
    }));
  }

  /**
   * Force process queue (manual trigger)
   */
  async forceSync() {
    if (this.queue.length === 0) {
      console.log('[LocationQueue] No items to sync');
      return { success: true, synced: 0 };
    }

    console.log('[LocationQueue] Force sync triggered');
    await this.processQueue();
    
    return { 
      success: true, 
      synced: this.stats.totalSent,
      failed: this.stats.totalFailed
    };
  }
}

// Create singleton
const locationQueueService = new LocationQueueService();

export default locationQueueService;
