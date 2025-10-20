/**
 * Location Sharing Consent Manager
 * 
 * Manages user consent for location sharing with persistence
 */

const CONSENT_KEY = 'location_sharing_consent';
const CONSENT_TIMESTAMP_KEY = 'location_consent_timestamp';
const CONSENT_VERSION = '1.0';

class LocationConsentManager {
  constructor() {
    this.consent = this.loadConsent();
  }

  /**
   * Load consent from localStorage
   */
  loadConsent() {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (!stored) return null;

      const parsed = JSON.parse(stored);
      
      // Validate consent structure
      if (!parsed.version || !parsed.granted !== undefined || !parsed.timestamp) {
        return null;
      }

      // Check if consent is still valid (optional: expire after X days)
      const EXPIRY_DAYS = 365; // 1 year
      const ageMs = Date.now() - parsed.timestamp;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      
      if (ageDays > EXPIRY_DAYS) {
        this.clearConsent();
        return null;
      }

      return parsed;
    } catch (error) {
      console.error('[ConsentManager] Failed to load consent:', error);
      return null;
    }
  }

  /**
   * Save consent to localStorage
   */
  saveConsent(granted, options = {}) {
    const consent = {
      version: CONSENT_VERSION,
      granted,
      timestamp: Date.now(),
      backgroundTracking: options.backgroundTracking || false,
      shareWithResponders: options.shareWithResponders !== false, // default true
      shareWithTrustedCircle: options.shareWithTrustedCircle !== false, // default true
      autoShare: options.autoShare || false, // auto-share on login
      services: options.services || [] // which services: tourist_safety, women_safety, etc.
    };

    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
      localStorage.setItem(CONSENT_TIMESTAMP_KEY, consent.timestamp.toString());
      this.consent = consent;
      console.log('[ConsentManager] Consent saved:', consent);
      return consent;
    } catch (error) {
      console.error('[ConsentManager] Failed to save consent:', error);
      return null;
    }
  }

  /**
   * Check if user has granted consent
   */
  hasConsent() {
    if (!this.consent) {
      this.consent = this.loadConsent();
    }
    return this.consent && this.consent.granted === true;
  }

  /**
   * Get current consent settings
   */
  getConsent() {
    if (!this.consent) {
      this.consent = this.loadConsent();
    }
    return this.consent;
  }

  /**
   * Clear consent
   */
  clearConsent() {
    try {
      localStorage.removeItem(CONSENT_KEY);
      localStorage.removeItem(CONSENT_TIMESTAMP_KEY);
      this.consent = null;
      console.log('[ConsentManager] Consent cleared');
    } catch (error) {
      console.error('[ConsentManager] Failed to clear consent:', error);
    }
  }

  /**
   * Update specific consent options
   */
  updateConsent(options) {
    if (!this.consent) {
      return this.saveConsent(true, options);
    }

    const updated = {
      ...this.consent,
      ...options,
      timestamp: Date.now()
    };

    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(updated));
      this.consent = updated;
      console.log('[ConsentManager] Consent updated:', updated);
      return updated;
    } catch (error) {
      console.error('[ConsentManager] Failed to update consent:', error);
      return null;
    }
  }

  /**
   * Check if background tracking is consented
   */
  hasBackgroundTrackingConsent() {
    return this.hasConsent() && this.consent.backgroundTracking === true;
  }

  /**
   * Check if auto-share is enabled
   */
  isAutoShareEnabled() {
    return this.hasConsent() && this.consent.autoShare === true;
  }

  /**
   * Check if service is allowed
   */
  isServiceAllowed(serviceType) {
    if (!this.hasConsent()) return false;
    if (!this.consent.services || this.consent.services.length === 0) return true; // no restriction
    return this.consent.services.includes(serviceType);
  }
}

// Create singleton
const locationConsentManager = new LocationConsentManager();

export default locationConsentManager;
