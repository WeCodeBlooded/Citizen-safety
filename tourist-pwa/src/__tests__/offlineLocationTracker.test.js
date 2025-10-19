/**
 * Test suite for Offline Location Tracker
 * Run these tests to verify offline tracking functionality
 */

import offlineLocationTracker from '../utils/offlineLocationTracker';

describe('OfflineLocationTracker', () => {
  beforeEach(async () => {
    // Clear IndexedDB before each test
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('WomenSafetyOfflineDB');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  });

  afterEach(() => {
    offlineLocationTracker.stopTracking();
  });

  test('should initialize IndexedDB successfully', async () => {
    const db = await offlineLocationTracker.initDB();
    expect(db).toBeDefined();
    expect(db.name).toBe('WomenSafetyOfflineDB');
  });

  test('should store location data offline', async () => {
    const locationData = {
      passportId: 'TEST123',
      latitude: 28.6139,
      longitude: 77.2090,
      accuracy: 10,
      source: 'gps'
    };

    const id = await offlineLocationTracker.storeLocation(locationData);
    expect(id).toBeDefined();

    const pending = await offlineLocationTracker.getPendingRecords('pendingLocations');
    expect(pending.length).toBe(1);
    expect(pending[0].passportId).toBe('TEST123');
  });

  test('should store SOS alerts with high priority', async () => {
    const sosData = {
      passportId: 'TEST123',
      latitude: 28.6139,
      longitude: 77.2090,
      location: 'Test Location'
    };

    const id = await offlineLocationTracker.storeSOS(sosData);
    expect(id).toBeDefined();

    const pending = await offlineLocationTracker.getPendingRecords('pendingSOS');
    expect(pending.length).toBe(1);
    expect(pending[0].priority).toBe('high');
  });

  test('should store panic alerts with critical priority', async () => {
    const panicData = {
      passportId: 'TEST999',
      latitude: 12.9716,
      longitude: 77.5946
    };

    const id = await offlineLocationTracker.storePanicAlert(panicData);
    expect(id).toBeDefined();

    const pending = await offlineLocationTracker.getPendingRecords('pendingPanicAlerts');
    expect(pending.length).toBe(1);
    expect(pending[0].priority).toBe('critical');
  });

  test('should cancel queued panic alert', async () => {
    const panicData = {
      passportId: 'TEST888',
      latitude: 10.1234,
      longitude: 76.5432
    };

    const id = await offlineLocationTracker.storePanicAlert(panicData);
    const result = await offlineLocationTracker.cancelPanicAlert(id);
    expect(result.cancelled).toBe(true);

    const pending = await offlineLocationTracker.getPendingRecords('pendingPanicAlerts');
    expect(pending.length).toBe(0);
  });
  
  test('should store panic recordings offline', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const id = await offlineLocationTracker.storePanicRecording({
      passportId: 'TESTREC',
      filename: 'panic.webm',
      blob,
      triggeredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString()
    });

    expect(id).toBeDefined();
    const pending = await offlineLocationTracker.getPendingRecords('pendingPanicRecordings');
    expect(pending.length).toBe(1);
    expect(pending[0].blob).toBeInstanceOf(Blob);
  });

  test('should cancel panic recordings by passport', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await offlineLocationTracker.storePanicRecording({
      passportId: 'TESTREC2',
      filename: 'panic2.webm',
      blob
    });

    await offlineLocationTracker.cancelPanicRecordings('TESTREC2');
    const pending = await offlineLocationTracker.getPendingRecords('pendingPanicRecordings');
    expect(pending.length).toBe(0);
  });

  test('should mark records as synced', async () => {
    const locationData = {
      passportId: 'TEST123',
      latitude: 28.6139,
      longitude: 77.2090
    };

    const id = await offlineLocationTracker.storeLocation(locationData);
    await offlineLocationTracker.markAsSynced('pendingLocations', id);

    const pending = await offlineLocationTracker.getPendingRecords('pendingLocations');
    expect(pending.length).toBe(0);
  });

  test('should delete records', async () => {
    const locationData = {
      passportId: 'TEST123',
      latitude: 28.6139,
      longitude: 77.2090
    };

    const id = await offlineLocationTracker.storeLocation(locationData);
    await offlineLocationTracker.deleteRecord('pendingLocations', id);

    const pending = await offlineLocationTracker.getPendingRecords('pendingLocations');
    expect(pending.length).toBe(0);
  });

  test('should limit pending locations to MAX_PENDING_LOCATIONS', async () => {
    // Store more than the limit
    for (let i = 0; i < 550; i++) {
      await offlineLocationTracker.storeLocation({
        passportId: 'TEST123',
        latitude: 28.6139 + i * 0.0001,
        longitude: 77.2090 + i * 0.0001
      });
    }

    await offlineLocationTracker.cleanupOldRecords('pendingLocations');
    const pending = await offlineLocationTracker.getPendingRecords('pendingLocations');
    
    // Should be limited to 500
    expect(pending.length).toBeLessThanOrEqual(500);
  });

  test('should get correct stats', async () => {
    await offlineLocationTracker.storeLocation({
      passportId: 'TEST123',
      latitude: 28.6139,
      longitude: 77.2090
    });

    await offlineLocationTracker.storeSOS({
      passportId: 'TEST123',
      latitude: 28.6139,
      longitude: 77.2090
    });

    await offlineLocationTracker.storePanicAlert({
      passportId: 'TEST123',
      latitude: 28.6139,
      longitude: 77.2090
    });

    await offlineLocationTracker.storePanicRecording({
      passportId: 'TEST123',
      filename: 'panic.webm',
      blob: new Blob(['audio'], { type: 'audio/webm' })
    });

    const stats = await offlineLocationTracker.getStats();
    expect(stats.pendingLocations).toBe(1);
    expect(stats.pendingSOS).toBe(1);
    expect(stats.pendingPanic).toBe(1);
    expect(stats.pendingPanicRecordings).toBe(1);
    expect(stats.isOnline).toBeDefined();
  });

  test('should start and stop tracking', () => {
    const mockCallback = jest.fn();
    
    offlineLocationTracker.startTracking('TEST123', mockCallback);
    expect(offlineLocationTracker.isTracking).toBe(true);

    offlineLocationTracker.stopTracking();
    expect(offlineLocationTracker.isTracking).toBe(false);
  });
});

// Integration test with mock navigator.geolocation
describe('OfflineLocationTracker Integration', () => {
  let mockGeolocation;

  beforeEach(() => {
    // Mock geolocation API
    mockGeolocation = {
      getCurrentPosition: jest.fn(),
      watchPosition: jest.fn(() => 123), // Returns watch ID
      clearWatch: jest.fn()
    };

    global.navigator.geolocation = mockGeolocation;
  });

  test('should track location with geolocation API', (done) => {
    const mockPosition = {
      coords: {
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 10
      }
    };

    // Mock successful position update
    mockGeolocation.watchPosition.mockImplementation((success) => {
      setTimeout(() => success(mockPosition), 100);
      return 123;
    });

    offlineLocationTracker.startTracking('TEST123', (locationData) => {
      expect(locationData.latitude).toBe(28.6139);
      expect(locationData.longitude).toBe(77.2090);
      expect(locationData.accuracy).toBe(10);
      offlineLocationTracker.stopTracking();
      done();
    });

    expect(mockGeolocation.watchPosition).toHaveBeenCalled();
  });

  test('should handle geolocation errors gracefully', () => {
    const mockError = {
      code: 1,
      message: 'User denied geolocation'
    };

    mockGeolocation.watchPosition.mockImplementation((success, error) => {
      setTimeout(() => error(mockError), 100);
      return 123;
    });

    // Should not throw
    expect(() => {
      offlineLocationTracker.startTracking('TEST123');
    }).not.toThrow();
  });
});

// Mock online/offline events
describe('OfflineLocationTracker Sync', () => {
  beforeEach(() => {
    // Mock online state
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true
    });
  });

  test('should detect offline state', () => {
    navigator.onLine = false;
    const stats = offlineLocationTracker.getStats();
    expect(stats.isOnline).toBe(false);
  });

  test('should detect online state', () => {
    navigator.onLine = true;
    const stats = offlineLocationTracker.getStats();
    expect(stats.isOnline).toBe(true);
  });

  test('should trigger sync when coming online', async () => {
    const syncSpy = jest.spyOn(offlineLocationTracker, 'syncPendingData');
    
    // Store some data while "offline"
    navigator.onLine = false;
    await offlineLocationTracker.storeLocation({
      passportId: 'TEST123',
      latitude: 28.6139,
      longitude: 77.2090
    });

    // Go back online
    navigator.onLine = true;
    window.dispatchEvent(new Event('online'));

    // Should trigger sync
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(syncSpy).toHaveBeenCalled();
  });
});
