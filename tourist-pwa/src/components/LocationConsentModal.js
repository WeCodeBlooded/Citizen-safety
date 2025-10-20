import React, { useState } from 'react';
import './LocationConsentModal.css';

const LocationConsentModal = ({ 
  isOpen, 
  onConsent, 
  onDeny, 
  serviceType = 'general_safety',
  isBackgroundAvailable = false 
}) => {
  const [backgroundTracking, setBackgroundTracking] = useState(false);
  const [shareWithResponders, setShareWithResponders] = useState(true);
  const [shareWithTrustedCircle, setShareWithTrustedCircle] = useState(true);
  const [autoShare, setAutoShare] = useState(false);

  if (!isOpen) return null;

  const handleGrant = () => {
    const consent = {
      granted: true,
      backgroundTracking: isBackgroundAvailable && backgroundTracking,
      shareWithResponders,
      shareWithTrustedCircle,
      autoShare,
      services: [serviceType]
    };
    onConsent(consent);
  };

  const handleDeny = () => {
    onDeny();
  };

  const getServiceName = () => {
    switch (serviceType) {
      case 'women_safety':
        return 'Women Safety';
      case 'tourist_safety':
        return 'Tourist Safety';
      case 'citizen_safety':
        return 'Citizen Safety';
      default:
        return 'General Safety';
    }
  };

  return (
    <div className="location-consent-modal-overlay">
      <div className="location-consent-modal">
        <div className="location-consent-header">
          <h2>📍 Location Sharing</h2>
        </div>

        <div className="location-consent-body">
          <p className="location-consent-description">
            <strong>{getServiceName()}</strong> needs access to your location to provide:
          </p>

          <ul className="location-consent-benefits">
            <li>🚨 Emergency response coordination</li>
            <li>🗺️ Real-time location tracking</li>
            <li>👥 Share location with trusted contacts</li>
            <li>⚡ Quick access to nearby services</li>
            {serviceType === 'women_safety' && (
              <>
                <li>🔒 Safety monitoring and alerts</li>
                <li>👮 Direct connection to authorities</li>
              </>
            )}
          </ul>

          <div className="location-consent-options">
            <h3>Sharing Preferences</h3>

            {isBackgroundAvailable && (
              <label className="consent-checkbox">
                <input
                  type="checkbox"
                  checked={backgroundTracking}
                  onChange={(e) => setBackgroundTracking(e.target.checked)}
                />
                <span>
                  <strong>Background Tracking</strong>
                  <small>Continue tracking when app is in background (recommended for safety)</small>
                </span>
              </label>
            )}

            <label className="consent-checkbox">
              <input
                type="checkbox"
                checked={shareWithResponders}
                onChange={(e) => setShareWithResponders(e.target.checked)}
              />
              <span>
                <strong>Share with Emergency Responders</strong>
                <small>Allow emergency services to see your location during SOS</small>
              </span>
            </label>

            <label className="consent-checkbox">
              <input
                type="checkbox"
                checked={shareWithTrustedCircle}
                onChange={(e) => setShareWithTrustedCircle(e.target.checked)}
              />
              <span>
                <strong>Share with Trusted Circle</strong>
                <small>Family and friends can see your location</small>
              </span>
            </label>

            <label className="consent-checkbox">
              <input
                type="checkbox"
                checked={autoShare}
                onChange={(e) => setAutoShare(e.target.checked)}
              />
              <span>
                <strong>Auto-Share on Login</strong>
                <small>Automatically share location when you log in</small>
              </span>
            </label>
          </div>

          <div className="location-consent-privacy">
            <p>
              <strong>Privacy Notice:</strong> Your location data is encrypted and only shared with 
              authorized contacts and emergency services. You can revoke permission at any time.
            </p>
          </div>
        </div>

        <div className="location-consent-actions">
          <button 
            className="consent-button consent-button-deny" 
            onClick={handleDeny}
          >
            Deny
          </button>
          <button 
            className="consent-button consent-button-grant" 
            onClick={handleGrant}
          >
            Grant Permission
          </button>
        </div>
      </div>
    </div>
  );
};

export default LocationConsentModal;
