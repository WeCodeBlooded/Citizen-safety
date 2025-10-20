/**
 * Background Location Tracking Service
 * 
 * Provides native background tracking capabilities using Capacitor.
 * Falls back to web geolocation when native is unavailable.
 */

import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { BackgroundRunner } from '@capacitor/background-runner';

class BackgroundTrackingService {
  constructor() {
    this.isNative = Capacitor.isNativePlatform();
    this.watchId = null;
    this.backgroundWatchId = null;
    this.callbacks = {
      onLocation: null,
      onError: null,
      onPermissionDenied: null
    };
  }

  /**
   * Check if background tracking is available
   */
  isBackgroundTrackingAvailable() {
    return this.isNative && Capacitor.isPluginAvailable('Geolocation');
  }

  /**
   * Request necessary permissions
   */
  async requestPermissions() {
    if (!this.isNative) {
      // Web: permissions are handled by browser
      return { granted: true, web: true };
    }

    try {
      // Check current permission status
      const status = await Geolocation.checkPermissions();
      
      if (status.location === 'granted') {
        return { granted: true, status };
      }

      // Request permissions
      const result = await Geolocation.requestPermissions({
        permissions: ['location', 'coarseLocation']
      });

      if (result.location === 'granted') {
        return { granted: true, status: result };
      }

      if (this.callbacks.onPermissionDenied) {
        this.callbacks.onPermissionDenied(result);
      }

      return { granted: false, status: result };
    } catch (error) {
      console.error('[BackgroundTracking] Permission request failed:', error);
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
      return { granted: false, error };
    }
  }

  /**
   * Start foreground tracking
   */
  async startForegroundTracking(options = {}) {
    const {
      enableHighAccuracy = true,
      timeout = 20000,
      maximumAge = 5000
    } = options;

    if (this.isNative && Capacitor.isPluginAvailable('Geolocation')) {
      // Use Capacitor Geolocation
      try {
        const permResult = await this.requestPermissions();
        if (!permResult.granted) {
          throw new Error('Location permission not granted');
        }

        this.watchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy,
            timeout,
            maximumAge
          },
          (position, err) => {
            if (err) {
              console.error('[BackgroundTracking] Watch error:', err);
              if (this.callbacks.onError) {
                this.callbacks.onError(err);
              }
              return;
            }

            if (position && this.callbacks.onLocation) {
              this.callbacks.onLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                altitude: position.coords.altitude,
                altitudeAccuracy: position.coords.altitudeAccuracy,
                heading: position.coords.heading,
                speed: position.coords.speed,
                timestamp: position.timestamp,
                source: 'native-foreground'
              });
            }
          }
        );

        console.log('[BackgroundTracking] Started native foreground tracking');
        return { success: true, watchId: this.watchId };
      } catch (error) {
        console.error('[BackgroundTracking] Failed to start native tracking:', error);
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
        throw error;
      }
    } else {
      // Fall back to web geolocation
      return this.startWebTracking(options);
    }
  }

  /**
   * Start web-based tracking (fallback)
   */
  startWebTracking(options = {}) {
    const {
      enableHighAccuracy = true,
      timeout = 20000,
      maximumAge = 5000
    } = options;

    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        const error = new Error('Geolocation not available');
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
        reject(error);
        return;
      }

      try {
        this.watchId = navigator.geolocation.watchPosition(
          (position) => {
            if (this.callbacks.onLocation) {
              this.callbacks.onLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                altitude: position.coords.altitude,
                altitudeAccuracy: position.coords.altitudeAccuracy,
                heading: position.coords.heading,
                speed: position.coords.speed,
                timestamp: position.timestamp,
                source: 'web'
              });
            }
          },
          (error) => {
            console.error('[BackgroundTracking] Web watch error:', error);
            if (this.callbacks.onError) {
              this.callbacks.onError(error);
            }
          },
          { enableHighAccuracy, timeout, maximumAge }
        );

        console.log('[BackgroundTracking] Started web tracking');
        resolve({ success: true, watchId: this.watchId, web: true });
      } catch (error) {
        console.error('[BackgroundTracking] Failed to start web tracking:', error);
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
        reject(error);
      }
    });
  }

  /**
   * Start background tracking (native only)
   */
  async startBackgroundTracking() {
    if (!this.isBackgroundTrackingAvailable()) {
      console.warn('[BackgroundTracking] Background tracking not available, using foreground only');
      return { success: false, reason: 'not-available' };
    }

    try {
      const permResult = await this.requestPermissions();
      if (!permResult.granted) {
        return { success: false, reason: 'permission-denied' };
      }

      // Check if BackgroundRunner is available
      if (!Capacitor.isPluginAvailable('BackgroundRunner')) {
        console.warn('[BackgroundTracking] BackgroundRunner plugin not available');
        return { success: false, reason: 'plugin-unavailable' };
      }

      // Start background location updates
      this.backgroundWatchId = await BackgroundRunner.start();
      
      console.log('[BackgroundTracking] Started background tracking');
      return { success: true, watchId: this.backgroundWatchId };
    } catch (error) {
      console.error('[BackgroundTracking] Failed to start background tracking:', error);
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
      return { success: false, error };
    }
  }

  /**
   * Stop all tracking
   */
  async stopTracking() {
    try {
      // Stop foreground tracking
      if (this.watchId !== null) {
        if (this.isNative && Capacitor.isPluginAvailable('Geolocation')) {
          await Geolocation.clearWatch({ id: this.watchId });
        } else if (navigator.geolocation) {
          navigator.geolocation.clearWatch(this.watchId);
        }
        this.watchId = null;
      }

      // Stop background tracking
      if (this.backgroundWatchId !== null && Capacitor.isPluginAvailable('BackgroundRunner')) {
        await BackgroundRunner.stop();
        this.backgroundWatchId = null;
      }

      console.log('[BackgroundTracking] Stopped all tracking');
      return { success: true };
    } catch (error) {
      console.error('[BackgroundTracking] Error stopping tracking:', error);
      return { success: false, error };
    }
  }

  /**
   * Get current position once
   */
  async getCurrentPosition(options = {}) {
    const {
      enableHighAccuracy = true,
      timeout = 10000,
      maximumAge = 0
    } = options;

    if (this.isNative && Capacitor.isPluginAvailable('Geolocation')) {
      try {
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy,
          timeout,
          maximumAge
        });

        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp,
          source: 'native'
        };
      } catch (error) {
        console.error('[BackgroundTracking] Native getCurrentPosition failed:', error);
        throw error;
      }
    } else {
      // Web fallback
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation not available'));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              altitude: position.coords.altitude,
              altitudeAccuracy: position.coords.altitudeAccuracy,
              heading: position.coords.heading,
              speed: position.coords.speed,
              timestamp: position.timestamp,
              source: 'web'
            });
          },
          (error) => {
            reject(error);
          },
          { enableHighAccuracy, timeout, maximumAge }
        );
      });
    }
  }

  /**
   * Set callback handlers
   */
  setCallbacks({ onLocation, onError, onPermissionDenied }) {
    if (onLocation) this.callbacks.onLocation = onLocation;
    if (onError) this.callbacks.onError = onError;
    if (onPermissionDenied) this.callbacks.onPermissionDenied = onPermissionDenied;
  }

  /**
   * Check permission status without requesting
   */
  async checkPermissions() {
    if (!this.isNative) {
      return { location: 'granted', web: true };
    }

    try {
      const status = await Geolocation.checkPermissions();
      return status;
    } catch (error) {
      console.error('[BackgroundTracking] Permission check failed:', error);
      return { location: 'denied', error };
    }
  }
}

// Create singleton instance
const backgroundTrackingService = new BackgroundTrackingService();

export default backgroundTrackingService;
