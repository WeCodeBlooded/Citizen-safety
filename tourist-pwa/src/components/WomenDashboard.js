import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import Map from '../Map';
import offlineLocationTracker from '../utils/offlineLocationTracker';
import './WomenDashboard.css';

const resolveBackendUrl = () => {
  const FALLBACK = (typeof window !== 'undefined' && window.location.hostname === 'localhost')
    ? 'http://localhost:3001'
    : 'http://localhost:3001';
  let value = FALLBACK;
  try {
    const stored = localStorage.getItem('BACKEND_URL');
    if (stored) value = stored.trim();
  } catch {}
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const parsed = new URL(value);
    if (parsed.pathname && parsed.pathname !== '/') {
      console.warn('[WomenDashboard] BACKEND_URL included path, trimming to origin:', parsed.pathname);
    }
    value = parsed.origin;
  } catch (err) {
    console.warn('[WomenDashboard] Unable to parse BACKEND_URL, using fallback origin.', err?.message || err);
    value = FALLBACK;
  }
  return value;
};

// Free national helplines
const NATIONAL_HELPLINES = [
  { name: 'Women Helpline', number: '181' },
  { name: 'Emergency Services', number: '112' },
  { name: 'Police', number: '100' },
  { name: 'Cyber Crime', number: '1930' },
];

export default function WomenDashboard({ user = {}, location = null }) {
  // SOS logic removed as per request
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activePage, setActivePage] = useState('home');
  const [harassmentReport, setHarassmentReport] = useState({ desc: '', anonymous: false });
  const [reportStatus, setReportStatus] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [showSelfDefense, setShowSelfDefense] = useState(false);
  const [selfDefenseGuides, setSelfDefenseGuides] = useState([]);
  const [selfDefenseLoading, setSelfDefenseLoading] = useState(false);
  const [selfDefenseError, setSelfDefenseError] = useState('');
  const [offlineStats, setOfflineStats] = useState({ pendingLocations: 0, pendingSOS: 0, pendingPanic: 0, pendingPanicRecordings: 0 });
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Build a comprehensive identity payload for tracking
  const userIdentity = useMemo(() => {
    if (!user) return null;

    const identity = {
      userId: user.id ?? user.user_id ?? null,
      email: user.email ?? null,
      mobileNumber: user.mobileNumber ?? user.mobile_number ?? null,
      aadhaarNumber: user.aadhaarNumber ?? user.aadhaar_number ?? null,
      passportId: user.passportId ?? user.passport_id ?? null,
    };

    const hasIdentifier = Object.values(identity).some((value) => value !== null && value !== undefined && String(value).trim() !== '');
    return hasIdentifier ? identity : null;
  }, [user]);

  const BACKEND_URL = useMemo(() => resolveBackendUrl(), []);

  // Debug logging
  console.log('[WomenDashboard] Received location prop:', location);
  console.log('[WomenDashboard] User:', user);

  // Initialize offline location tracking when component mounts
  useEffect(() => {
    if (!userIdentity) return;

    console.log('[WomenDashboard] Starting offline location tracker');
    
    // Start tracking with the user's identifier
    offlineLocationTracker.startTracking(userIdentity, (locationData) => {
      console.log('[WomenDashboard] Location updated:', locationData);
    });

    // Update stats every 10 seconds
    const statsInterval = setInterval(async () => {
      const stats = await offlineLocationTracker.getStats();
      setOfflineStats(stats);
    }, 10000);

    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup on unmount
    return () => {
      offlineLocationTracker.stopTracking();
      clearInterval(statsInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [userIdentity]);

  const resolvedLocation = useMemo(() => {
    if (!location) return {};
    if (typeof location === 'string') {
      return { address: location };
    }
    if (typeof location === 'object') {
      const address = location.address || location.label || location.description || location.city || '';
      const city = location.city || location.town || location.locality || '';
      return { ...location, address, city };
    }
    return {};
  }, [location]);

  const mapPosition = useMemo(() => {
    if (!location || typeof location !== 'object') return null;
    const candidateLat =
      location.latitude ?? location.lat ?? location.coords?.latitude ?? null;
    const candidateLon =
      location.longitude ?? location.lon ?? location.coords?.longitude ?? null;

    console.log('[WomenDashboard] mapPosition candidates:', { candidateLat, candidateLon, location });

    if (candidateLat === null || candidateLat === undefined || candidateLon === null || candidateLon === undefined) {
      return null;
    }

    const latitude = Number(candidateLat);
    const longitude = Number(candidateLon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.warn('[WomenDashboard] Invalid coordinates:', { latitude, longitude });
      return null;
    }

    console.log('[WomenDashboard] Resolved mapPosition:', { latitude, longitude });
    return { latitude, longitude };
  }, [location]);

  const locationDescriptor = resolvedLocation.city || resolvedLocation.address || '';
  const welcomeLocationText = useMemo(() => {
    if (!locationDescriptor) return 'on your journey';
    return /not available|failed/i.test(locationDescriptor)
      ? 'on your journey'
      : `in ${locationDescriptor}`;
  }, [locationDescriptor]);

  const locationPayload = useMemo(() => {
    if (mapPosition) {
      return {
        latitude: mapPosition.latitude,
        longitude: mapPosition.longitude,
        accuracy:
          resolvedLocation.accuracy ??
          resolvedLocation.coords?.accuracy ??
          null,
        address: resolvedLocation.address || null,
      };
    }
    if (resolvedLocation.address) {
      return resolvedLocation.address;
    }
    if (typeof location === 'string') {
      return location;
    }
    return null;
  }, [location, mapPosition, resolvedLocation]);

  const handleNavigate = (page) => {
    setActivePage(page);
    setSidebarOpen(false);
    setReportStatus('');
    setFeedbackStatus('');
  };

  const handleReportSubmit = async (event) => {
    event.preventDefault();

    if (!harassmentReport.desc.trim()) {
      setReportStatus('Please describe the incident before submitting.');
      return;
    }

    setReportLoading(true);
    setReportStatus('');

    try {
      await axios.post(`${BACKEND_URL}/api/women/report`, {
        userId: user.id,
        email: user.email,
        name: user.name,
        desc: harassmentReport.desc,
        anonymous: harassmentReport.anonymous,
        timestamp: new Date().toISOString(),
        location: locationPayload,
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });

      setReportStatus('Report submitted successfully. Stay safe, help is on the way.');
      setHarassmentReport({ desc: '', anonymous: harassmentReport.anonymous });
    } catch (error) {
      const message = error?.response?.data?.message || 'We could not submit your report right now. Please try again shortly.';
      setReportStatus(message);
    } finally {
      setReportLoading(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedback.trim()) {
      setFeedbackStatus('Please share some feedback before submitting.');
      return;
    }

    setFeedbackLoading(true);
    setFeedbackStatus('');

    try {
      await axios.post(`${BACKEND_URL}/api/women/feedback`, {
        userId: user.id,
        mobileNumber: user.mobileNumber,
        name: user.name,
        feedback,
        timestamp: new Date().toISOString(),
        location: locationPayload,
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });

      setFeedbackStatus('Feedback submitted successfully. Thanks for helping the community!');
      setFeedback('');
    } catch (error) {
      const message = error?.response?.data?.message || 'We could not submit your feedback right now.';
      setFeedbackStatus(message);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const fetchSelfDefenseGuides = async () => {
    setShowSelfDefense(true);
    setSelfDefenseError('');
    setSelfDefenseLoading(true);

    try {
      const response = await axios.get(`${BACKEND_URL}/api/women/selfdefense`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setSelfDefenseGuides(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      const message = error?.response?.data?.message || 'Unable to load self-defense resources right now.';
      setSelfDefenseError(message);
    } finally {
      setSelfDefenseLoading(false);
    }
  };

  const closeSelfDefenseModal = () => {
    setShowSelfDefense(false);
    setSelfDefenseGuides([]);
    setSelfDefenseLoading(false);
    setSelfDefenseError('');
  };

  const renderHome = () => (
    <div className="women-home-3d">
      {/* Offline Status Indicator */}
      {!isOnline && (
        <div className="offline-banner">
          <span className="offline-icon">📡</span>
          <div>
            <strong>Offline Mode Active</strong>
            <p>Location tracking continues. Data will sync when connection is restored.</p>
            {offlineStats.pendingLocations > 0 && (
              <small>{offlineStats.pendingLocations} location(s) pending sync</small>
            )}
            {offlineStats.pendingSOS > 0 && (
              <small>{offlineStats.pendingSOS} SOS alert(s) ready to send</small>
            )}
            {offlineStats.pendingPanic > 0 && (
              <small>{offlineStats.pendingPanic} SOS panic alert(s) ready to send</small>
            )}
            {offlineStats.pendingPanicRecordings > 0 && (
              <small>{offlineStats.pendingPanicRecordings} audio recording(s) waiting to upload</small>
            )}
          </div>
        </div>
      )}

      {/* Pending Sync Indicator (when online but has pending data) */}
      {isOnline && (
        (offlineStats.pendingLocations > 0 || offlineStats.pendingSOS > 0 || offlineStats.pendingPanic > 0 || offlineStats.pendingPanicRecordings > 0)
      ) && (
        <div className="sync-banner">
          <span className="sync-icon">🔄</span>
          <div>
            <strong>Syncing...</strong>
            <p>
              Uploading
              {' '}
              {offlineStats.pendingLocations + offlineStats.pendingSOS + offlineStats.pendingPanic + offlineStats.pendingPanicRecordings}
              {' '}pending record(s)
            </p>
          </div>
        </div>
      )}

      <section className="welcome-card">
        <h2>Welcome back{user?.name ? `, ${user.name}` : ''}!</h2>
        <p>
          You are currently {welcomeLocationText}. Keep your trusted contacts close and remember help is just a tap away.
        </p>
        <div className="home-actions">
          <button onClick={() => handleNavigate('report')}>Report Incident</button>
          <button onClick={() => handleNavigate('selfdefense')}>Self-defense Guides</button>
        </div>
      </section>

      <section className="helpline-card">
        <h3>Quick Helplines</h3>
        <ul>
          {NATIONAL_HELPLINES.map((helpline) => (
            <li key={helpline.number}>
              <span>{helpline.name}</span>
              <a href={`tel:${helpline.number}`}>{helpline.number}</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="women-map-card">
        <div className="map-card-header">
          <div>
            <h3>Your Live Location</h3>
            <p>{locationDescriptor || 'Waiting for location lock…'}</p>
          </div>
          {mapPosition && (
            <span className="map-coordinates">
              {mapPosition.latitude.toFixed(3)}, {mapPosition.longitude.toFixed(3)}
            </span>
          )}
        </div>
        <div className="women-map-container">
          {mapPosition ? (
            <Map
              userPosition={mapPosition}
              groupMembers={[]}
              route={[]}
              realTimeTracking={false}
              isMapEnlarged={true}
            />
          ) : (
            <div className="women-map-empty">
              <p>Enable location access to view yourself on the map.</p>
              <p style={{ marginTop: '12px', fontSize: '0.9rem', opacity: 0.8 }}>
                Check browser permissions or click "Refresh Precise Location" in the sidebar.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const renderContacts = () => (
    <div className="women-section-3d">
      <h2>Emergency Contacts</h2>
      <p>If you feel unsafe, reach out immediately. These national helplines are available 24/7.</p>
      <div className="contacts-grid">
        {NATIONAL_HELPLINES.map((helpline) => (
          <div className="contact-card" key={helpline.number}>
            <h4>{helpline.name}</h4>
            <a href={`tel:${helpline.number}`}>{helpline.number}</a>
            <span>Tap to call</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderReport = () => (
    <div className="women-section-3d">
      <h2>Report &amp; Track Harassment</h2>
      <form className="report-form" onSubmit={handleReportSubmit}>
        <label>
          Incident Description
          <textarea
            value={harassmentReport.desc}
            onChange={(event) => setHarassmentReport((prev) => ({ ...prev, desc: event.target.value }))}
            placeholder="Describe the incident, location, and any identifiable details."
            rows={6}
            required
          />
        </label>
        <label className="anonymous-toggle">
          <input
            type="checkbox"
            checked={harassmentReport.anonymous}
            onChange={(event) => setHarassmentReport((prev) => ({ ...prev, anonymous: event.target.checked }))}
          />
          Submit anonymously
        </label>
        <button type="submit" disabled={reportLoading} aria-busy={reportLoading}>
          {reportLoading ? 'Submitting…' : 'Submit Report'}
        </button>
      </form>
      {reportStatus && (
        <div className={`status-message ${reportStatus.startsWith('Report submitted') ? 'success' : 'error'}`}>
          {reportStatus}
        </div>
      )}
    </div>
  );

  const renderFeedback = () => (
    <div className="women-section-3d">
      <h2>Community Safety Feedback</h2>
      <label>
        Share your experience
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="Rate the safety of areas or share tips for fellow travellers."
          rows={5}
        />
      </label>
      <button
        className="feedback-btn"
        onClick={handleFeedbackSubmit}
        disabled={feedbackLoading || !feedback.trim()}
        aria-busy={feedbackLoading}
      >
        {feedbackLoading ? 'Submitting…' : 'Submit Feedback'}
      </button>
      {feedbackStatus && (
        <div className={`status-message ${feedbackStatus.startsWith('Feedback submitted') ? 'success' : 'error'}`}>
          {feedbackStatus}
        </div>
      )}
    </div>
  );

  const renderSelfDefense = () => (
    <div className="women-section-3d">
      <h2>Self-defense Guides</h2>
      <p>Access curated videos and step-by-step guides prepared by certified instructors.</p>
      <button className="self-defense-btn" onClick={fetchSelfDefenseGuides}>
        View Guides
      </button>

      {showSelfDefense && (
        <div className="self-defense-modal" role="dialog" aria-modal="true">
          <div className="modal-header">
            <h3>Self-defense Resources</h3>
            <button className="modal-close" onClick={closeSelfDefenseModal} aria-label="Close self-defense resources">
              &times;
            </button>
          </div>

          {selfDefenseLoading && <div className="status-message info">Loading guides…</div>}
          {selfDefenseError && <div className="status-message error">{selfDefenseError}</div>}

          {!selfDefenseLoading && !selfDefenseError && (
            <ul className="guide-list">
              {selfDefenseGuides.length === 0 && <li>No guides available right now. Please check back soon.</li>}
              {selfDefenseGuides.map((guide, index) => (
                <li key={`${guide.title}-${index}`}>
                  <strong>{guide.title}</strong>
                  {guide.description && <p>{guide.description}</p>}
                  {guide.video_url && (
                    <div className="video-wrapper">
                      <iframe
                        title={guide.title}
                        src={guide.video_url}
                        width="320"
                        height="180"
                        allowFullScreen
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    switch (activePage) {
      case 'contacts':
        return renderContacts();
      case 'report':
        return renderReport();
      case 'feedback':
        return renderFeedback();
      case 'selfdefense':
        return renderSelfDefense();
      case 'home':
      default:
        return renderHome();
    }
  };

  return (
    <div className="women-dashboard-bg">
      <nav className="women-navbar-3d">
        <div className="navbar-brand">
          <img
            src="https://images.unsplash.com/photo-1517841905240-472988babdf9?w=40&q=80"
            alt="Women Safety"
            className="navbar-logo"
          />
          <span className="navbar-title">Secure Safar</span>
        </div>
        <button
          type="button"
          className="navbar-hamburger"
          onClick={() => setSidebarOpen((prev) => !prev)}
          aria-label="Toggle navigation"
          aria-expanded={sidebarOpen}
        >
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </button>
      </nav>

      {sidebarOpen && <div className="women-sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <div className="women-layout">
        <aside className={`women-sidebar-3d${sidebarOpen ? ' open' : ''}`}>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            &times;
          </button>
          <ul className="sidebar-links">
            <li className={activePage === 'home' ? 'active' : ''} onClick={() => handleNavigate('home')}>
              Home
            </li>
            <li className={activePage === 'contacts' ? 'active' : ''} onClick={() => handleNavigate('contacts')}>
              Emergency Contacts
            </li>
            <li className={activePage === 'report' ? 'active' : ''} onClick={() => handleNavigate('report')}>
              Report Harassment
            </li>
            <li className={activePage === 'feedback' ? 'active' : ''} onClick={() => handleNavigate('feedback')}>
              Community Feedback
            </li>
            <li className={activePage === 'selfdefense' ? 'active' : ''} onClick={() => handleNavigate('selfdefense')}>
              Self-defense Guides
            </li>
          </ul>
          <div style={{ margin: '32px 0 0 0', textAlign: 'center' }}>
            {/* SOS button removed as per request */}
          </div>
        </aside>

        <main className="women-dashboard-content">{renderContent()}</main>
      </div>
    </div>
  );
}
