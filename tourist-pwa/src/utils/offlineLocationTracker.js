/**
 * Offline Location Tracker for Women Safety
 * 
 * Provides robust location tracking that works even in low-connectivity
 * or completely offline situations by:
 * - Storing location data in IndexedDB when offline
 * - Automatic sync when connection is restored
 * - Background location tracking
 * - Queue-based retry mechanism with exponential backoff
 */

const DB_NAME = 'WomenSafetyOfflineDB';
const DB_VERSION = 3;
const LOCATION_STORE = 'pendingLocations';
const SOS_STORE = 'pendingSOS';
const PANIC_STORE = 'pendingPanicAlerts';
const PANIC_AUDIO_STORE = 'pendingPanicRecordings';
const MAX_PENDING_LOCATIONS = 500; // Prevent unlimited storage growth
const SYNC_INTERVAL = 30000; // Try to sync every 30 seconds when online

let ensureIndexedDBPromise = null;
const ensureIndexedDB = async () => {
  if (typeof indexedDB !== 'undefined') {
    return indexedDB;
  }

  if (!ensureIndexedDBPromise) {
    ensureIndexedDBPromise = (async () => {
      if (typeof window === 'undefined') {
        try {
          await import('fake-indexeddb/auto');
        } catch (error) {
          console.warn('[OfflineTracker] Failed to polyfill indexedDB for non-browser environment:', error?.message || error);
        }
      }
      return typeof indexedDB !== 'undefined' ? indexedDB : undefined;
    })();
  }

  return ensureIndexedDBPromise;
};

const buildEndpoint = (baseUrl, path) => {
  try {
    return new URL(path, baseUrl).toString();
  } catch (error) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  }
};

// Get backend URL from localStorage or default
const getBackendURL = () => {
  let candidate = null;

  try {
    const stored = localStorage.getItem('BACKEND_URL');
    if (stored && stored.trim()) {
      candidate = stored.trim();
    }
  } catch (e) {
    // ignore localStorage issues
  }

  const ensureAbsolute = (value) => {
    if (!/^https?:\/\//i.test(value)) {
      value = `http://${value}`;
    }
    try {
      const parsed = new URL(value);
      if (parsed.pathname && parsed.pathname !== '/') {
        console.warn(`[OfflineTracker] BACKEND_URL included path '${parsed.pathname}', trimming to origin.`);
      }
      return parsed.origin;
    } catch (err) {
      console.warn('[OfflineTracker] Failed to parse BACKEND_URL, falling back to default.', err?.message || err);
      return null;
    }
  };

  if (candidate) {
    const normalized = ensureAbsolute(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const hasWindow = typeof window !== 'undefined' && window.location;
  const hostname = hasWindow ? window.location.hostname : 'localhost';
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }

  const protocol = hasWindow ? window.location.protocol : 'http:';
  const fallback = `${protocol}//${hostname}:3001`;
  const normalizedFallback = ensureAbsolute(fallback) || 'http://localhost:3001';
  return normalizedFallback;
};

const normalizeIdentityValue = (value) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
};

const normalizeIdentity = (input) => {
  if (!input && input !== 0) {
    return null;
  }

  if (typeof input === 'string' || typeof input === 'number') {
    const primary = normalizeIdentityValue(input);
    return primary ? { passportId: primary, primary } : null;
  }

  if (typeof input !== 'object') {
    return null;
  }

  const identity = {
    passportId: normalizeIdentityValue(input.passportId ?? input.passport_id),
    mobileNumber: normalizeIdentityValue(input.mobileNumber ?? input.mobile ?? input.phone),
    aadhaarNumber: normalizeIdentityValue(input.aadhaarNumber ?? input.aadhaar ?? input.aadhaar_number),
    userId: normalizeIdentityValue(input.userId ?? input.id ?? input.user_id),
    email: normalizeIdentityValue(input.email ?? input.userEmail),
    identifier: normalizeIdentityValue(input.identifier ?? input.uniqueId)
  };

  identity.primary = identity.userId
    ?? identity.email
    ?? identity.mobileNumber
    ?? identity.aadhaarNumber
    ?? identity.passportId
    ?? identity.identifier
    ?? null;

  // Women-safety identity normalization:
  // If we have a userId but no valid women pseudo passport, derive one as WOMEN-<userId>.
  // This prevents sending bare numeric IDs like "1" that the backend would reject.
  if (identity.userId) {
    const hasWomenPrefix = typeof identity.passportId === 'string' && /^WOMEN-\w+$/i.test(identity.passportId);
    const noPassport = !identity.passportId || String(identity.passportId).trim() === '';
    const isBareNumeric = typeof identity.passportId === 'string' && /^\d+$/.test(identity.passportId);
    const equalsUserId = typeof identity.passportId === 'string' && identity.passportId === identity.userId;
    if (!hasWomenPrefix && (noPassport || isBareNumeric || equalsUserId)) {
      identity.passportId = `WOMEN-${identity.userId}`;
    }
  }

  if (!identity.primary) {
    return null;
  }

  return identity;
};

const buildIdentityPayload = (identity) => {
  if (!identity) {
    return {};
  }

  const payload = {};

  const assign = (key, value) => {
    if (value !== undefined && value !== null && value !== '') {
      payload[key] = value;
    }
  };

  assign('passportId', identity.passportId ?? identity.primary ?? undefined);
  assign('identifier', identity.identifier ?? identity.primary ?? undefined);

  if (identity.userId) {
    assign('userId', identity.userId);
    assign('user_id', identity.userId);
  }

  if (identity.mobileNumber) {
    assign('mobileNumber', identity.mobileNumber);
    assign('mobile', identity.mobileNumber);
  }

  if (identity.aadhaarNumber) {
    assign('aadhaarNumber', identity.aadhaarNumber);
    assign('aadhaar', identity.aadhaarNumber);
  }

  if (identity.email) {
    assign('email', identity.email);
  }

  return payload;
};

class OfflineLocationTracker {
  constructor() {
    this.db = null;
    this.syncInProgress = false;
    this.watchId = null;
    this.syncInterval = null;
    this.onlineStatusListener = null;
    this.isTracking = false;
    this.identity = null;
  }

  /**
   * Set identity without starting geolocation tracking.
   * Accepts the same input shapes as startTracking (passportId, WOMEN-<id>, or user object)
   */
  setIdentity(identityInput) {
    const resolved = normalizeIdentity(identityInput);
    if (!resolved) {
      console.warn('[OfflineTracker] setIdentity called with invalid input');
      return;
    }
    this.identity = resolved;
    console.log('[OfflineTracker] Identity set to', this.identity);
  }

  /**
   * Initialize IndexedDB for offline storage
   */
  async initDB() {
    if (this.db) {
      return this.db;
    }

    const idb = await ensureIndexedDB();
    if (!idb) {
      throw new Error('[OfflineTracker] IndexedDB is not available in this environment');
    }

    return new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[OfflineTracker] IndexedDB error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[OfflineTracker] IndexedDB initialized successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const upgradeTransaction = event.target.transaction;

        const ensureStore = (storeName, indexes = []) => {
          let store;
          if (!db.objectStoreNames.contains(storeName)) {
            store = db.createObjectStore(storeName, {
              keyPath: 'id',
              autoIncrement: true
            });
          } else if (upgradeTransaction) {
            store = upgradeTransaction.objectStore(storeName);
          }

          if (!store) {
            return;
          }

          indexes.forEach(({ name, keyPath, options }) => {
            if (!store.indexNames.contains(name)) {
              store.createIndex(name, keyPath, options || { unique: false });
            }
          });
        };

        ensureStore(LOCATION_STORE, [{ name: 'timestamp', keyPath: 'timestamp' }]);
        ensureStore(SOS_STORE, [
          { name: 'timestamp', keyPath: 'timestamp' },
          { name: 'passportId', keyPath: 'passportId' }
        ]);
        ensureStore(PANIC_STORE, [
          { name: 'timestamp', keyPath: 'timestamp' },
          { name: 'passportId', keyPath: 'passportId' }
        ]);
        ensureStore(PANIC_AUDIO_STORE, [
          { name: 'timestamp', keyPath: 'timestamp' },
          { name: 'passportId', keyPath: 'passportId' }
        ]);

        console.log('[OfflineTracker] Database schema created/updated');
      };

      request.onblocked = () => {
        console.warn('[OfflineTracker] Database upgrade blocked. Please close all tabs using this app.');
      };
    });
  }

  /**
   * Store location data (will sync when online)
   */
  async storeLocation(locationData) {
    if (!this.db) {
      await this.initDB();
    }

    const record = {
      ...buildIdentityPayload(this.identity),
      ...locationData,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([LOCATION_STORE], 'readwrite');
      const store = transaction.objectStore(LOCATION_STORE);
      const request = store.add(record);

      request.onsuccess = () => {
        console.log('[OfflineTracker] Location stored locally:', record);
        // Cleanup old records if we have too many
        this.cleanupOldRecords(LOCATION_STORE);
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('[OfflineTracker] Failed to store location:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Store SOS alert (high priority, will sync immediately when online)
   */
  async storeSOS(sosData) {
    if (!this.db) {
      await this.initDB();
    }

    const record = {
      ...buildIdentityPayload(this.identity),
      ...sosData,
      timestamp: Date.now(),
      synced: false,
      priority: 'high',
      retryCount: 0
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([SOS_STORE], 'readwrite');
      const store = transaction.objectStore(SOS_STORE);
      const request = store.add(record);

      request.onsuccess = () => {
        console.log('[OfflineTracker] SOS stored locally:', record);
        // Try to sync immediately
        this.syncPendingData();
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('[OfflineTracker] Failed to store SOS:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Store panic alert (dedicated queue for global panic button)
   */
  async storePanicAlert(panicData) {
    if (!this.db) {
      await this.initDB();
    }

    const record = {
      ...buildIdentityPayload(this.identity),
      ...panicData,
      timestamp: Date.now(),
      synced: false,
      priority: 'critical',
      retryCount: 0
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([PANIC_STORE], 'readwrite');
      const store = transaction.objectStore(PANIC_STORE);
      const request = store.add(record);

      request.onsuccess = () => {
        console.log('[OfflineTracker] Panic alert stored locally:', record);
        this.syncPendingData();
        this.cleanupOldRecords(PANIC_STORE);
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('[OfflineTracker] Failed to store panic alert:', request.error);
        reject(request.error);
      };
    });
  }

  async cancelPanicAlert(recordId) {
    if (!this.db) {
      await this.initDB();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([PANIC_STORE], 'readwrite');
      const store = transaction.objectStore(PANIC_STORE);
      const getRequest = store.get(recordId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          resolve({ cancelled: false, reason: 'not_found' });
          return;
        }

        const deleteRequest = store.delete(recordId);
        deleteRequest.onsuccess = () => resolve({ cancelled: true, reason: 'deleted' });
        deleteRequest.onerror = () => reject(deleteRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async storePanicRecording(recordingData) {
    if (!this.db) {
      await this.initDB();
    }

    const record = {
      ...buildIdentityPayload(this.identity),
      ...recordingData,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([PANIC_AUDIO_STORE], 'readwrite');
      const store = transaction.objectStore(PANIC_AUDIO_STORE);
      const request = store.add(record);

      request.onsuccess = () => {
        console.log('[OfflineTracker] Panic recording stored locally');
        this.syncPendingData();
        this.cleanupOldRecords(PANIC_AUDIO_STORE);
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('[OfflineTracker] Failed to store panic recording:', request.error);
        reject(request.error);
      };
    });
  }

  async cancelPanicRecordings(passportId) {
    if (!this.db) {
      await this.initDB();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([PANIC_AUDIO_STORE], 'readwrite');
      const store = transaction.objectStore(PANIC_AUDIO_STORE);
      const hasPassportIndex = store.indexNames.contains('passportId');
      const iterator = hasPassportIndex
        ? store.index('passportId').openCursor(IDBKeyRange.only(passportId))
        : store.openCursor();

      iterator.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (!hasPassportIndex && cursor.value.passportId !== passportId) {
            cursor.continue();
            return;
          }
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };

      iterator.onerror = (event) => {
        console.error('[OfflineTracker] Failed to cancel panic recordings:', event?.target?.error);
        reject(event?.target?.error);
      };
    });
  }

  /**
   * Get all pending (unsynced) records from a store
   */
  async getPendingRecords(storeName) {
    if (!this.db) {
      await this.initDB();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll(); // Get all records

      request.onsuccess = () => {
        // Filter for unsynced records
        const allRecords = request.result || [];
        const pending = allRecords.filter(record => !record.synced);
        resolve(pending);
      };

      request.onerror = () => {
        console.error('[OfflineTracker] Failed to get pending records:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Mark a record as synced
   */
  async markAsSynced(storeName, recordId) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const getRequest = store.get(recordId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (record) {
          record.synced = true;
          record.syncedAt = Date.now();
          const updateRequest = store.put(record);

          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve(); // Record doesn't exist, that's okay
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete a record from the store
   */
  async deleteRecord(storeName, recordId) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(recordId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Cleanup old synced records to prevent storage bloat
   */
  async cleanupOldRecords(storeName, maxAge = 7 * 24 * 60 * 60 * 1000) {
    // Keep records for 7 days by default
    if (!this.db) return;

    const cutoffTime = Date.now() - maxAge;

    await new Promise((resolve) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const index = store.index('timestamp');
      const request = index.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const record = cursor.value;
          // Delete if synced and older than cutoff
          if (record.synced && record.timestamp < cutoffTime) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => resolve(); // Don't fail, just move on
    });

    // Also limit total number of pending records
    const pending = await this.getPendingRecords(storeName);
    if (pending.length > MAX_PENDING_LOCATIONS) {
      // Delete oldest pending records
      const toDelete = pending
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, pending.length - MAX_PENDING_LOCATIONS);

      for (const record of toDelete) {
        await this.deleteRecord(storeName, record.id);
      }
    }
  }

  /**
   * Sync pending data to backend
   */
  async syncPendingData() {
    if (this.syncInProgress) {
      console.log('[OfflineTracker] Sync already in progress, skipping');
      return;
    }

    if (!navigator.onLine) {
      console.log('[OfflineTracker] Offline, skipping sync');
      return;
    }

    this.syncInProgress = true;

    try {
    // Sync panic alerts first (highest priority)
    await this.syncStore(PANIC_STORE, '/api/v1/alert/panic');

    // Upload any offline panic audio recordings next
    await this.syncPanicRecordings();

    // Next sync women safety SOS alerts (high priority)
    await this.syncStore(SOS_STORE, '/api/women/sos');

      // Then sync location updates
  await this.syncStore(LOCATION_STORE, '/api/v1/location');

      console.log('[OfflineTracker] Sync completed successfully');
    } catch (error) {
      console.error('[OfflineTracker] Sync failed:', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Sync a specific store to backend
   */
  async syncStore(storeName, endpoint) {
    const pending = await this.getPendingRecords(storeName);

    if (pending.length === 0) {
      return;
    }

    console.log(`[OfflineTracker] Syncing ${pending.length} records from ${storeName}`);

  const backendURL = getBackendURL();
  const fullEndpoint = buildEndpoint(backendURL, endpoint);
    
    console.log(`[OfflineTracker] Using backend URL: ${fullEndpoint}`);

    for (const record of pending) {
      try {
        // Extract the actual data (remove our metadata)
        const { id, synced, timestamp, retryCount, syncedAt, ...data } = record;

        let identityPayload = buildIdentityPayload(normalizeIdentity(record)) || {};

        if ((!identityPayload.userId && !identityPayload.email && !identityPayload.mobileNumber) && this.identity) {
          identityPayload = { ...identityPayload, ...buildIdentityPayload(this.identity) };
        }

        if (!identityPayload.userId && !identityPayload.email && !identityPayload.mobileNumber) {
          try {
            const stored = localStorage.getItem('WOMEN_USER');
            if (stored) {
              const parsed = JSON.parse(stored);
              identityPayload = {
                ...identityPayload,
                ...buildIdentityPayload(normalizeIdentity({
                  userId: parsed?.id,
                  email: parsed?.email,
                  mobileNumber: parsed?.mobileNumber,
                  aadhaarNumber: parsed?.aadhaarNumber,
                  passportId: parsed?.passportId,
                }))
              };
            }
          } catch (err) {
            console.warn('[OfflineTracker] Failed to rehydrate identity from localStorage:', err?.message || err);
          }
        }

  const payload = { ...data, ...identityPayload };

        console.log(`[OfflineTracker] Sending record ${id}:`, payload);

        // Try to send to backend
        const axios = (await import('axios')).default;
        const response = await axios.post(fullEndpoint, payload, {
          headers: { 'ngrok-skip-browser-warning': 'true' },
          withCredentials: true,
          timeout: 10000 // 10 second timeout
        });

        console.log(`[OfflineTracker] Backend response for record ${id}:`, response.data);

        // Success! Mark as synced and delete after a delay
        await this.markAsSynced(storeName, id);
        setTimeout(() => this.deleteRecord(storeName, id), 60000); // Delete after 1 minute

        console.log(`[OfflineTracker] Successfully synced record ${id}`);
      } catch (error) {
        console.error(`[OfflineTracker] Failed to sync record ${record.id}:`, error);
        
        // Log more details about the error
        if (error.response) {
          console.error(`[OfflineTracker] Backend error response:`, {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          });
        } else if (error.request) {
          console.error(`[OfflineTracker] No response received:`, error.message);
        } else {
          console.error(`[OfflineTracker] Request setup error:`, error.message);
        }

        const isUserNotFound = error?.response?.status === 404 && /not found/i.test(String(error?.response?.data?.error || ''));

        if (isUserNotFound) {
          console.warn(`[OfflineTracker] Dropping record ${record.id} due to unresolved user identity.`);
          await this.deleteRecord(storeName, record.id);
          continue;
        }

        // Update retry count
        if (record.retryCount < 5) {
          const transaction = this.db.transaction([storeName], 'readwrite');
          const store = transaction.objectStore(storeName);
          record.retryCount++;
          store.put(record);
        } else {
          console.warn(`[OfflineTracker] Record ${record.id} exceeded retry limit, deleting to prevent duplicate sync attempts.`);
          await this.deleteRecord(storeName, record.id);
        }
      }
    }
  }

  async syncPanicRecordings() {
    const pending = await this.getPendingRecords(PANIC_AUDIO_STORE);

    if (pending.length === 0) {
      return;
    }

    console.log(`[OfflineTracker] Syncing ${pending.length} panic audio recording(s)`);

  const backendURL = getBackendURL();
  const uploadEndpoint = buildEndpoint(backendURL, '/api/v1/alert/upload-recording');

    for (const record of pending) {
      const { id, timestamp, blob, filename, triggeredAt, recordedAt } = record;

      if (!blob) {
        console.warn(`[OfflineTracker] Panic recording ${id} missing blob payload, deleting`);
        await this.deleteRecord(PANIC_AUDIO_STORE, id);
        continue;
      }

      try {
        const formData = new FormData();
          let identityInfo = normalizeIdentity(record);
          let identityPayload = buildIdentityPayload(identityInfo) || {};

          if ((!identityPayload.userId && !identityPayload.email && !identityPayload.mobileNumber) && this.identity) {
            identityPayload = { ...identityPayload, ...buildIdentityPayload(this.identity) };
            identityInfo = normalizeIdentity({ ...identityInfo, ...this.identity }) || identityInfo;
          }

          if (!identityPayload.userId && !identityPayload.email && !identityPayload.mobileNumber) {
            try {
              const stored = localStorage.getItem('WOMEN_USER');
              if (stored) {
                const parsed = JSON.parse(stored);
                const fallbackIdentity = normalizeIdentity({
                  userId: parsed?.id,
                  email: parsed?.email,
                  mobileNumber: parsed?.mobileNumber,
                  aadhaarNumber: parsed?.aadhaarNumber,
                  passportId: parsed?.passportId,
                });
                identityPayload = {
                  ...identityPayload,
                  ...buildIdentityPayload(fallbackIdentity)
                };
                identityInfo = identityInfo || fallbackIdentity;
              }
            } catch (err) {
              console.warn('[OfflineTracker] Failed to rehydrate identity for panic recordings:', err?.message || err);
            }
          }

          Object.entries(identityPayload).forEach(([key, value]) => {
            formData.append(key, value);
          });
        if (triggeredAt) {
          formData.append('triggeredAt', triggeredAt);
        }
        if (recordedAt) {
          formData.append('recordedAt', recordedAt);
        }

  const identityLabel = identityInfo?.passportId || identityInfo?.primary || this.identity?.primary || 'unknown';
          const resolvedFilename = filename || `panic-${identityLabel}-${timestamp || Date.now()}.webm`;
        formData.append('recording', blob, resolvedFilename);

        const axios = (await import('axios')).default;
        const response = await axios.post(uploadEndpoint, formData, {
          headers: { 'Content-Type': 'multipart/form-data', 'ngrok-skip-browser-warning': 'true' },
          withCredentials: true,
          timeout: 20000
        });

        console.log(`[OfflineTracker] Uploaded panic recording ${id}:`, response.data);

        await this.markAsSynced(PANIC_AUDIO_STORE, id);
        setTimeout(() => this.deleteRecord(PANIC_AUDIO_STORE, id), 60000);
      } catch (error) {
  console.error(`[OfflineTracker] Failed to sync panic recording ${record.id}:`, error);

        if (error.response) {
          console.error('[OfflineTracker] Recording upload error response:', {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          });
        }

        if (record.retryCount < 5) {
          const transaction = this.db.transaction([PANIC_AUDIO_STORE], 'readwrite');
          const store = transaction.objectStore(PANIC_AUDIO_STORE);
          record.retryCount++;
          store.put(record);
        } else {
          console.warn(`[OfflineTracker] Panic recording ${record.id} exceeded retry limit`);
        }
      }
    }
  }

  /**
   * Start continuous location tracking
   */
  startTracking(identityInput, onLocationUpdate) {
    if (this.isTracking) {
      console.log('[OfflineTracker] Already tracking');
      return;
    }

    const resolvedIdentity = normalizeIdentity(identityInput);
    if (!resolvedIdentity) {
      console.warn('[OfflineTracker] Cannot start tracking without a valid identifier');
      return;
    }

    this.identity = resolvedIdentity;
    this.isTracking = true;
    console.log('[OfflineTracker] Starting location tracking for', this.identity.primary);

    // Initialize database
    this.initDB().catch(err => {
      console.error('[OfflineTracker] Failed to init DB:', err);
    });

    // Watch position changes
    if (navigator.geolocation) {
      this.watchId = navigator.geolocation.watchPosition(
        async (position) => {
          const identityPayload = buildIdentityPayload(this.identity);
          const locationData = {
            ...identityPayload,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            source: 'gps'
          };

          // Notify callback
          if (onLocationUpdate) {
            onLocationUpdate(locationData);
          }

          // Try to send to backend if online
          if (navigator.onLine) {
            try {
              const axios = (await import('axios')).default;
              const backendURL = getBackendURL();
              const target = buildEndpoint(backendURL, '/api/v1/location');
              await axios.post(target, locationData, {
                headers: { 'ngrok-skip-browser-warning': 'true' },
                withCredentials: true,
                timeout: 5000
              });
              console.log('[OfflineTracker] Location sent to backend');
            } catch (error) {
              console.log('[OfflineTracker] Failed to send location, storing offline:', error.message);
              await this.storeLocation(locationData);
            }
          } else {
            // Offline, store for later sync
            await this.storeLocation(locationData);
          }
        },
        (error) => {
          console.error('[OfflineTracker] Geolocation error:', error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    }

    // Set up periodic sync attempts
    this.syncInterval = setInterval(() => {
      if (navigator.onLine) {
        this.syncPendingData();
      }
    }, SYNC_INTERVAL);

    // Listen for online/offline events
    this.onlineStatusListener = () => {
      if (navigator.onLine) {
        console.log('[OfflineTracker] Connection restored, syncing...');
        this.syncPendingData();
      }
    };
    window.addEventListener('online', this.onlineStatusListener);
  }

  /**
   * Stop location tracking
   */
  stopTracking() {
    this.isTracking = false;
    this.identity = null;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.onlineStatusListener) {
      window.removeEventListener('online', this.onlineStatusListener);
      this.onlineStatusListener = null;
    }

    console.log('[OfflineTracker] Stopped location tracking');
  }

  /**
   * Get pending data statistics
   */
  async getStats() {
    try {
      const pendingLocations = await this.getPendingRecords(LOCATION_STORE);
      const pendingSOS = await this.getPendingRecords(SOS_STORE);
      const pendingPanic = await this.getPendingRecords(PANIC_STORE);
      const pendingPanicRecordings = await this.getPendingRecords(PANIC_AUDIO_STORE);

      return {
        pendingLocations: pendingLocations.length,
        pendingSOS: pendingSOS.length,
        pendingPanic: pendingPanic.length,
        pendingPanicRecordings: pendingPanicRecordings.length,
        isOnline: navigator.onLine,
        isTracking: this.isTracking
      };
    } catch (error) {
      console.error('[OfflineTracker] Failed to get stats:', error);
      return {
        pendingLocations: 0,
        pendingSOS: 0,
        pendingPanic: 0,
        pendingPanicRecordings: 0,
        isOnline: navigator.onLine,
        isTracking: this.isTracking
      };
    }
  }
}

// Export singleton instance
const offlineLocationTracker = new OfflineLocationTracker();
export default offlineLocationTracker;
