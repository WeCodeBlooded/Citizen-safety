import React, { useMemo, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Map from '../Map';
import offlineLocationTracker from '../utils/offlineLocationTracker';
import './WomenDashboard.css';
import WomenContacts from '../women/WomenContacts';
import StreamRecorder from '../women/StreamRecorder';
import FakeCallOverlay from './FakeCallOverlay';
import HardwarePanicSettings from './HardwarePanicSettings';

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

const NATIONAL_HELPLINES = [
  { name: 'Women Helpline', number: '181' },
  { name: 'Emergency Services', number: '112' },
  { name: 'Police', number: '100' },
  { name: 'Cyber Crime', number: '1930' },
];

const FALLBACK_REPORT_RESOURCES = [
  {
    name: 'National Police Helpline 112',
    description: 'Call for immediate assistance in any emergency.',
    url: 'tel:112',
    contact: 'Dial 112',
    type: 'phone',
  },
  {
    name: 'Women Helpline 1091',
    description: 'Dedicated women safety helpline across India.',
    url: 'tel:1091',
    contact: 'Dial 1091',
    type: 'phone',
  },
  {
    name: 'National Cyber Crime Portal',
    description: 'Report online harassment, stalking, or blackmailing.',
    url: 'https://www.cybercrime.gov.in/',
    contact: 'cybercrime.gov.in',
    type: 'web',
  },
];

const SMART_TAG_SUGGESTIONS = ['well-lit', 'busy area', 'isolated', 'police presence', 'patrol', 'needs lighting'];

const REPORT_CATEGORIES = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'stalking', label: 'Stalking' },
  { value: 'domestic', label: 'Domestic Violence' },
  { value: 'cyber', label: 'Cyber Harassment' },
  { value: 'other', label: 'Other' },
];

const FEEDBACK_TIMES_OF_DAY = [
  { value: 'morning', label: 'Morning (5am - 12pm)' },
  { value: 'afternoon', label: 'Afternoon (12pm - 5pm)' },
  { value: 'evening', label: 'Evening (5pm - 9pm)' },
  { value: 'night', label: 'Night (9pm - 5am)' },
];

const WomenDashboard = ({ user = {}, location = null }) => {
  const welcomeLocationText = location ? `${location.city || location.region || 'your area'}` : 'your area';
  const locationDescriptor = location ? `${location.city || location.region || 'Unknown location'}` : 'Unknown location';
  const mapPosition = location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    ? { latitude: Number(location.latitude), longitude: Number(location.longitude) }
    : null;

  const initialSelfDefenseFilters = useMemo(
    () => ({
      language: typeof navigator !== 'undefined' ? navigator.language || '' : '',
      region: location?.city || location?.region || '',
      mediaType: 'all',
    }),
    [location?.city, location?.region],
  );

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activePage, setActivePage] = useState('home');
  const [showHardwarePanicSettings, setShowHardwarePanicSettings] = useState(false);
  const [reportForm, setReportForm] = useState({
    description: '',
    anonymous: false,
    category: REPORT_CATEGORIES[0].value,
    policeStation: '',
    externalRefUrl: '',
    occurredAt: '',
    locationDetails: '',
    latitude: mapPosition?.latitude ?? null,
    longitude: mapPosition?.longitude ?? null,
    location: mapPosition
      ? {
          autoDetected: true,
          latitude: mapPosition.latitude,
          longitude: mapPosition.longitude,
        }
      : null,
  });
  const [reportStatus, setReportStatus] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportList, setReportList] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [reportResources, setReportResources] = useState(FALLBACK_REPORT_RESOURCES);
  const [lastSubmittedReference, setLastSubmittedReference] = useState('');
  const [feedbackForm, setFeedbackForm] = useState({
    area: location?.city || location?.region || '',
    routeName: '',
    timeOfDay: '',
    rating: 4,
    isPositive: true,
    comment: '',
    tags: [],
    tagsInput: '',
    latitude: mapPosition?.latitude ?? null,
    longitude: mapPosition?.longitude ?? null,
    location: mapPosition
      ? {
          autoDetected: true,
          latitude: mapPosition.latitude,
          longitude: mapPosition.longitude,
        }
      : null,
  });
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackSummaryLoading, setFeedbackSummaryLoading] = useState(false);
  const [feedbackSummary, setFeedbackSummary] = useState({ summary: [], hotspots: [], routes: [], recent: [] });
  const [showSelfDefense, setShowSelfDefense] = useState(false);
  const [selfDefenseGuides, setSelfDefenseGuides] = useState([]);
  const [selfDefenseLoading, setSelfDefenseLoading] = useState(false);
  const [selfDefenseError, setSelfDefenseError] = useState('');
  const [selfDefenseFilters, setSelfDefenseFilters] = useState(initialSelfDefenseFilters);
  const [offlineStats, setOfflineStats] = useState({
    pendingLocations: 0,
    pendingSOS: 0,
    pendingPanic: 0,
    pendingPanicRecordings: 0,
  });
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showStream, setShowStream] = useState(false);
  const [escapeLoading, setEscapeLoading] = useState(false);
  const [escapeStatus, setEscapeStatus] = useState('');
  const [showFakeCall, setShowFakeCall] = useState(false);
  const [silentAlertLoading, setSilentAlertLoading] = useState(false);
  const [silentAlertStatus, setSilentAlertStatus] = useState('');
  const [eventHistory, setEventHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const userIdentity = useMemo(() => {
    if (!user) return null;

    const identity = {
      userId: user.id ?? user.user_id ?? null,
      email: user.email ?? null,
      mobileNumber: user.mobileNumber ?? user.mobile_number ?? null,
      aadhaarNumber: user.aadhaarNumber ?? user.aadhaar_number ?? null,
      passportId: user.passportId ?? user.passport_id ?? null,
    };

    const hasIdentifier = Object.values(identity).some(
      (value) => value !== null && value !== undefined && String(value).trim() !== '',
    );
    return hasIdentifier ? identity : null;
  }, [user]);

  const BACKEND_URL = useMemo(() => resolveBackendUrl(), []);

  console.log('[WomenDashboard] Received location prop:', location);
  console.log('[WomenDashboard] User:', user);

  useEffect(() => {
    if (!userIdentity) return undefined;

    console.log('[WomenDashboard] Starting offline location tracker');

    offlineLocationTracker.startTracking(userIdentity, (locationData) => {
      console.log('[WomenDashboard] Location updated:', locationData);
    });

    const statsInterval = setInterval(async () => {
      const stats = await offlineLocationTracker.getStats();
      setOfflineStats(stats);
    }, 10000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      offlineLocationTracker.stopTracking();
      clearInterval(statsInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [userIdentity]);

  useEffect(() => {
    setSelfDefenseFilters((previous) => {
      let changed = false;
      const next = { ...previous };
      if (!previous.language && initialSelfDefenseFilters.language) {
        next.language = initialSelfDefenseFilters.language;
        changed = true;
      }
      if (!previous.region && initialSelfDefenseFilters.region) {
        next.region = initialSelfDefenseFilters.region;
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [initialSelfDefenseFilters.language, initialSelfDefenseFilters.region]);

  const handleNavigate = (page) => {
    setActivePage(page);
    setSidebarOpen(false);
  };

  const triggerFakeCall = async () => {
    const identifier = userIdentity?.email || userIdentity?.aadhaarNumber || userIdentity?.passportId;
    if (!identifier) {
      setEscapeStatus('Unable to identify user');
      return;
    }
    setEscapeLoading(true);
    setEscapeStatus('');
    try {
      await axios.post(`${BACKEND_URL}/api/women/fake-event`, {
        email: userIdentity?.email,
        aadhaarNumber: userIdentity?.aadhaarNumber,
        passportId: userIdentity?.passportId,
        event_type: 'fake_call',
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setEscapeStatus('Fake call triggered');
      setShowFakeCall(true);
    } catch (error) {
      console.error('[WomenDashboard] Fake call error:', error);
      setEscapeStatus('Failed to trigger fake call');
    } finally {
      setEscapeLoading(false);
    }
  };

  const handleFakeCallAnswer = () => {
    setShowFakeCall(false);
    setEscapeStatus('Call answered');
  };

  const handleFakeCallDecline = () => {
    setShowFakeCall(false);
    setEscapeStatus('Call declined');
  };

  const triggerSilentAlert = async () => {
    const identifier = userIdentity?.email || userIdentity?.aadhaarNumber || userIdentity?.passportId;
    if (!identifier) {
      setSilentAlertStatus('Unable to identify user');
      return;
    }
    setSilentAlertLoading(true);
    setSilentAlertStatus('');
    try {
      await axios.post(`${BACKEND_URL}/api/women/fake-event`, {
        email: userIdentity?.email,
        aadhaarNumber: userIdentity?.aadhaarNumber,
        passportId: userIdentity?.passportId,
        event_type: 'silent_alert',
        location: mapPosition || undefined,
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setSilentAlertStatus('Silent alert sent');
      setTimeout(() => setSilentAlertStatus(''), 4000);
    } catch (error) {
      console.error('[WomenDashboard] Silent alert error:', error);
      setSilentAlertStatus('Failed to send silent alert');
    } finally {
      setSilentAlertLoading(false);
    }
  };

  const fetchEventHistory = useCallback(async () => {
    if (!userIdentity) return;
    setHistoryLoading(true);
    try {
      const response = await axios.get(`${BACKEND_URL}/api/women/fake-events`, {
        params: {
          email: userIdentity.email,
          aadhaarNumber: userIdentity.aadhaarNumber,
          passportId: userIdentity.passportId,
        },
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setEventHistory(response.data?.events || []);
    } catch (error) {
      console.error('[WomenDashboard] Failed to fetch event history:', error);
      setEventHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [BACKEND_URL, userIdentity]);

  useEffect(() => {
    if (activePage === 'history') {
      fetchEventHistory();
    }
  }, [activePage, fetchEventHistory]);

  const fetchReportResources = useCallback(async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/women/reports/resources`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      const resources = Array.isArray(response.data?.resources) ? response.data.resources : [];
      if (resources.length > 0) {
        setReportResources(resources);
      }
    } catch (error) {
      console.warn('[WomenDashboard] Failed to load police resources:', error?.message || error);
    }
  }, [BACKEND_URL]);

  const fetchReportList = useCallback(async () => {
    if (!userIdentity) return;
    setReportsLoading(true);
    setReportsError('');
    try {
      const params = {};
      if (userIdentity.email) params.email = userIdentity.email;
      if (userIdentity.aadhaarNumber) params.aadhaarNumber = userIdentity.aadhaarNumber;
      if (userIdentity.passportId) params.passportId = userIdentity.passportId;

      const response = await axios.get(`${BACKEND_URL}/api/women/reports`, {
        params,
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setReportList(response.data?.reports || []);
    } catch (error) {
      console.error('[WomenDashboard] Failed to load reports:', error);
      setReportsError('Failed to load your report timeline.');
    } finally {
      setReportsLoading(false);
    }
  }, [BACKEND_URL, userIdentity]);

  const fetchCommunityFeedback = useCallback(async () => {
    setFeedbackSummaryLoading(true);
    setFeedbackError('');
    try {
      const params = {};
      if (userIdentity?.email) params.email = userIdentity.email;
      if (userIdentity?.passportId) params.passportId = userIdentity.passportId;
      if (userIdentity?.aadhaarNumber) params.aadhaarNumber = userIdentity.aadhaarNumber;

      const response = await axios.get(`${BACKEND_URL}/api/women/feedback`, {
        params,
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });

      setFeedbackSummary({
        summary: response.data?.summary || [],
        hotspots: response.data?.hotspots || [],
        routes: response.data?.routes || [],
        recent: response.data?.recent || [],
      });
    } catch (error) {
      console.error('[WomenDashboard] Failed to load community feedback:', error);
      setFeedbackError('Failed to load community trends.');
    } finally {
      setFeedbackSummaryLoading(false);
    }
  }, [BACKEND_URL, userIdentity]);

  const handleReportFieldChange = (event) => {
    const { name, value, type, checked } = event.target;
    setReportForm((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleFeedbackFieldChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFeedbackForm((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : name === 'rating' ? Number(value) : value,
    }));
  };

  const handleSmartTagToggle = useCallback((tag) => {
    setFeedbackForm((previous) => {
      const alreadySelected = previous.tags.includes(tag);
      const updated = alreadySelected
        ? previous.tags.filter((item) => item !== tag)
        : [...previous.tags, tag];
      return { ...previous, tags: updated };
    });
  }, []);

  useEffect(() => {
    fetchReportResources();
  }, [fetchReportResources]);

  useEffect(() => {
    if (activePage === 'report') {
      fetchReportList();
    }
  }, [activePage, fetchReportList]);

  useEffect(() => {
    if (activePage === 'feedback') {
      fetchCommunityFeedback();
    }
  }, [activePage, fetchCommunityFeedback]);

  useEffect(() => {
    if (!location) return;

    setReportForm((previous) => {
      if (!previous) return previous;
      const manualOverride = previous.location?.manual;
      if (manualOverride) return previous;
      if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return previous;

      const lat = Number(location.latitude);
      const lon = Number(location.longitude);
      const alreadySet = Number.isFinite(previous.latitude)
        && Number.isFinite(previous.longitude)
        && previous.latitude === lat
        && previous.longitude === lon;
      if (alreadySet) return previous;

      return {
        ...previous,
        latitude: lat,
        longitude: lon,
        location: {
          ...(previous.location || {}),
          autoDetected: true,
          latitude: lat,
          longitude: lon,
        },
      };
    });

    setFeedbackForm((previous) => {
      if (!previous) return previous;
      let changed = false;
      const updates = { ...previous };

      if (!previous.area) {
        const suggestion = location.city || location.region || '';
        if (suggestion) {
          updates.area = suggestion;
          changed = true;
        }
      }

      const manualOverride = previous.location?.manual;
      if (!manualOverride && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
        const lat = Number(location.latitude);
        const lon = Number(location.longitude);
        if (!Number.isFinite(previous.latitude) || previous.latitude !== lat) {
          updates.latitude = lat;
          changed = true;
        }
        if (!Number.isFinite(previous.longitude) || previous.longitude !== lon) {
          updates.longitude = lon;
          changed = true;
        }
        if (
          !previous.location
          || previous.location.latitude !== lat
          || previous.location.longitude !== lon
          || !previous.location.autoDetected
        ) {
          updates.location = {
            ...(previous.location || {}),
            autoDetected: true,
            latitude: lat,
            longitude: lon,
          };
          changed = true;
        }
      }

      return changed ? updates : previous;
    });
  }, [location]);

  const handleReportSubmit = async (event) => {
    event.preventDefault();
    if (!userIdentity) {
      setReportStatus('User identity not available');
      return;
    }

    if (!reportForm.description.trim()) {
      setReportStatus('Please describe the incident.');
      return;
    }

    const locationPayload = reportForm.location
      || (Number.isFinite(reportForm.latitude) && Number.isFinite(reportForm.longitude)
        ? {
            latitude: Number(reportForm.latitude),
            longitude: Number(reportForm.longitude),
          }
        : mapPosition);

    setReportLoading(true);
    setReportStatus('');
    try {
  const response = await axios.post(`${BACKEND_URL}/api/women/report`, {
        description: reportForm.description.trim(),
        anonymous: reportForm.anonymous,
        category: reportForm.category,
        policeStation: reportForm.policeStation.trim() || undefined,
        externalRefUrl: reportForm.externalRefUrl.trim() || undefined,
        occurredAt: reportForm.occurredAt || undefined,
        locationDetails: reportForm.locationDetails.trim() || undefined,
        location: locationPayload || undefined,
        email: userIdentity.email,
        aadhaarNumber: userIdentity.aadhaarNumber,
        passportId: userIdentity.passportId,
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });

      const referenceNumber = response.data?.report?.reference_number || response.data?.report?.referenceNumber;
      setReportStatus(referenceNumber
        ? `Report submitted successfully. Reference: ${referenceNumber}`
        : 'Report submitted successfully');
      setLastSubmittedReference(referenceNumber || '');
      setReportForm((previous) => ({
        ...previous,
        description: '',
        locationDetails: '',
        externalRefUrl: '',
        occurredAt: '',
      }));
      fetchReportList();
    } catch (error) {
      console.error('[WomenDashboard] Report submit failed:', error);
      setReportStatus('Failed to submit report');
    } finally {
      setReportLoading(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!userIdentity) {
      setFeedbackStatus('User identity not available');
      return;
    }
    if (!feedbackForm.area.trim()) {
      setFeedbackStatus('Please specify an area or route before submitting.');
      return;
    }
    if (!feedbackForm.comment.trim()) {
      setFeedbackStatus('Share a short comment to help others.');
      return;
    }
    setFeedbackLoading(true);
    setFeedbackStatus('');
    setFeedbackError('');
    try {
      const manualTags = feedbackForm.tagsInput
        ? feedbackForm.tagsInput
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0)
        : [];
      const combinedTags = [...new Set([...feedbackForm.tags, ...manualTags])];

      const locationPayload = feedbackForm.location
        || (Number.isFinite(feedbackForm.latitude) && Number.isFinite(feedbackForm.longitude)
          ? {
              latitude: Number(feedbackForm.latitude),
              longitude: Number(feedbackForm.longitude),
            }
          : mapPosition);

      await axios.post(`${BACKEND_URL}/api/women/feedback`, {
        comment: feedbackForm.comment.trim(),
        area: feedbackForm.area.trim(),
        rating: feedbackForm.rating,
        tags: combinedTags,
        routeName: feedbackForm.routeName.trim() || undefined,
        timeOfDay: feedbackForm.timeOfDay || undefined,
        isPositive: feedbackForm.isPositive,
        location: locationPayload || undefined,
        latitude: locationPayload?.latitude ?? undefined,
        longitude: locationPayload?.longitude ?? undefined,
        email: userIdentity.email,
        aadhaarNumber: userIdentity.aadhaarNumber,
        passportId: userIdentity.passportId,
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setFeedbackStatus('Feedback submitted successfully');
      setFeedbackForm((prev) => ({
        ...prev,
        comment: '',
        tagsInput: '',
        tags: [],
        routeName: '',
      }));
      fetchCommunityFeedback();
    } catch (error) {
      console.error('[WomenDashboard] Feedback submit failed:', error);
      setFeedbackStatus('Failed to submit feedback');
    } finally {
      setFeedbackLoading(false);
    }
  };

  const fetchSelfDefenseGuides = async (overrides = null) => {
    setShowSelfDefense(true);
    setSelfDefenseLoading(true);
    setSelfDefenseError('');
    try {
      const filtersToUse = overrides ? { ...overrides } : { ...selfDefenseFilters };
      setSelfDefenseFilters(filtersToUse);
      const { language, region, mediaType } = filtersToUse;
      const params = new URLSearchParams();
      if (language) params.append('language', language);
      if (region) params.append('region', region);
      if (mediaType && mediaType !== 'all') params.append('type', mediaType);

      const query = params.toString();
      const response = await axios.get(`${BACKEND_URL}/api/women/selfdefense${query ? `?${query}` : ''}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setSelfDefenseGuides(response.data || []);
    } catch (error) {
      console.error('[WomenDashboard] Failed to load self-defense guides:', error);
      setSelfDefenseError('Failed to load guides. Please try again later.');
    } finally {
      setSelfDefenseLoading(false);
    }
  };

  const closeSelfDefenseModal = () => {
    setShowSelfDefense(false);
  };

  const handleSelfDefenseFilterChange = (event) => {
    const { name, value } = event.target;
    setSelfDefenseFilters((previous) => ({ ...previous, [name]: value }));
  };

  const applySelfDefenseFilters = () => {
    fetchSelfDefenseGuides({ ...selfDefenseFilters });
  };

  const resetSelfDefenseFilters = () => {
    const defaults = { ...initialSelfDefenseFilters };
    setSelfDefenseFilters(defaults);
    fetchSelfDefenseGuides(defaults);
  };

  const renderStatusBanners = () => (
    <>
      {!isOnline && (
        <div className="offline-banner">
          <span className="offline-icon">[OFFLINE]</span>
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
              <small>{offlineStats.pendingPanic} panic alert(s) ready to send</small>
            )}
            {offlineStats.pendingPanicRecordings > 0 && (
              <small>{offlineStats.pendingPanicRecordings} audio recording(s) waiting to upload</small>
            )}
          </div>
        </div>
      )}
      {isOnline && (
        offlineStats.pendingLocations > 0 ||
        offlineStats.pendingSOS > 0 ||
        offlineStats.pendingPanic > 0 ||
        offlineStats.pendingPanicRecordings > 0
      ) && (
        <div className="sync-banner">
          <span className="sync-icon">[SYNC]</span>
          <div>
            <strong>Syncing...</strong>
            <p>
              Uploading{' '}
              {offlineStats.pendingLocations +
                offlineStats.pendingSOS +
                offlineStats.pendingPanic +
                offlineStats.pendingPanicRecordings}{' '}
              pending record(s)
            </p>
          </div>
        </div>
      )}
    </>
  );

  const renderHome = () => (
    <>
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

      <section className="stream-card">
        <div className="stream-card-header">
          <h3>Live Stream to Family</h3>
          <button className="stream-toggle" onClick={() => setShowStream((prev) => !prev)}>
            {showStream ? 'Hide' : 'Start'}
          </button>
        </div>
        {showStream && (
          <div className="stream-recorder-wrapper">
            <StreamRecorder currentUser={user} />
          </div>
        )}
      </section>

      <section className="women-map-card">
        <div className="map-card-header">
          <div>
            <h3>Your Live Location</h3>
            <p>{locationDescriptor || 'Waiting for location lock'}</p>
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
                Check browser permissions or tap the precise location refresh in the sidebar.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );

  const renderContacts = () => (
    <div className="women-section-3d">
      <h2>Emergency Contacts</h2>
      <p>Manage your trusted contacts and access national helplines 24/7.</p>

      <div className="contacts-manager">
        <WomenContacts email={userIdentity?.email} aadhaarNumber={userIdentity?.aadhaarNumber} />
      </div>
    </div>
  );

  const renderReport = () => (
    <div className="women-section-3d">
      <h2>Report &amp; Track Harassment</h2>
      <p className="section-intro">
        File a complaint, notify local authorities, and track status updates with a unique reference number.
      </p>
      <form className="report-form" onSubmit={handleReportSubmit}>
        <div className="form-grid">
          <label>
            Category
            <select name="category" value={reportForm.category} onChange={handleReportFieldChange}>
              {REPORT_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Police Station / Jurisdiction
            <input
              type="text"
              name="policeStation"
              value={reportForm.policeStation}
              onChange={handleReportFieldChange}
              placeholder="e.g. Connaught Place Police Station"
            />
          </label>
          <label>
            Date &amp; Time of Incident
            <input
              type="datetime-local"
              name="occurredAt"
              value={reportForm.occurredAt}
              onChange={handleReportFieldChange}
              max={new Date().toISOString().slice(0, 16)}
            />
          </label>
          <label>
            Police Complaint Link / Reference (optional)
            <input
              type="url"
              name="externalRefUrl"
              value={reportForm.externalRefUrl}
              onChange={handleReportFieldChange}
              placeholder="Paste FIR / complaint tracking link"
            />
          </label>
        </div>
        <label>
          Location Details
          <textarea
            name="locationDetails"
            value={reportForm.locationDetails}
            onChange={handleReportFieldChange}
            placeholder="Nearby landmarks, route taken, or supporting context."
            rows={3}
          />
        </label>
        <label>
          Incident Description
          <textarea
            value={reportForm.description}
            name="description"
            onChange={handleReportFieldChange}
            placeholder="Describe the incident, location, and any identifiable details."
            rows={6}
            required
          />
        </label>
        <label className="anonymous-toggle">
          <input
            type="checkbox"
            checked={reportForm.anonymous}
            name="anonymous"
            onChange={handleReportFieldChange}
          />
          Submit anonymously
        </label>
        <button type="submit" disabled={reportLoading} aria-busy={reportLoading}>
          {reportLoading ? 'Submitting' : 'Submit Report'}
        </button>
      </form>
      {reportStatus && (
        <div
          className={`status-message ${
            reportStatus.toLowerCase().includes('success') ? 'success' : 'error'
          }`}
        >
          {reportStatus}
        </div>
      )}
      {lastSubmittedReference && (
        <div className="status-message info">
          Track this complaint anytime using reference <strong>{lastSubmittedReference}</strong>.
        </div>
      )}

      <div className="report-resources">
        <h3>Contact Police Directly</h3>
        <div className="report-resource-grid">
          {reportResources.map((resource) => {
            const type = (resource.type || 'web').toLowerCase();
            const isWeb = type === 'web';
            const isSms = type === 'sms';
            const actionLabel = isWeb ? 'Open portal' : isSms ? 'Send SMS' : 'Call now';
            return (
              <div className="report-resource" key={resource.url || resource.name}>
                <header>
                  <span className={`resource-type-pill resource-${type}`}>{type.toUpperCase()}</span>
                  <h4>{resource.name}</h4>
                </header>
                {resource.description && <p>{resource.description}</p>}
                {resource.contact && <span className="resource-contact">{resource.contact}</span>}
                <div className="report-resource-actions">
                  <a
                    href={resource.url}
                    target={isWeb ? '_blank' : undefined}
                    rel={isWeb ? 'noopener noreferrer' : undefined}
                  >
                    {actionLabel}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="report-tracker">
        <div className="tracker-header">
          <h3>Complaint Timeline</h3>
          <button
            type="button"
            onClick={fetchReportList}
            disabled={reportsLoading}
            className="tracker-refresh"
          >
            Refresh
          </button>
        </div>
        {reportsLoading && <div className="status-message info">Loading reports...</div>}
        {reportsError && <div className="status-message error">{reportsError}</div>}
        {!reportsLoading && !reportsError && reportList.length === 0 && (
          <div className="status-message info">
            No reports filed yet. Submit the form above to generate your first complaint timeline.
          </div>
        )}
        {!reportsLoading && !reportsError && reportList.length > 0 && (
          <div className="report-card-list">
            {reportList.map((report) => {
              const reportReference = report.reference_number || report.referenceNumber || '';
              const isHighlighted = reportReference && reportReference === lastSubmittedReference;
              return (
                <article
                  key={report.id}
                  className={`report-card ${isHighlighted ? 'highlight' : ''}`}
                >
                {(function renderReportCardBody() {
                  const updates = Array.isArray(report.updates) ? report.updates : [];
                  const reportRef = report.reference_number || report.referenceNumber || 'Pending reference';
                  const submittedAt = report.created_at ? new Date(report.created_at).toLocaleString() : '';
                  const latestStatusEntry = updates.length > 0 ? updates[updates.length - 1] : null;
                  const latestStatus = (latestStatusEntry?.status || report.status || 'submitted').toLowerCase();
                  const formattedStatus = (latestStatusEntry?.status || report.status || 'submitted')
                    .replace(/_/g, ' ');

                  return (
                    <>
                      <header className="report-card-header">
                        <div>
                          <span className="report-reference">{reportRef}</span>
                          {submittedAt && <span className="report-meta">{submittedAt}</span>}
                        </div>
                        <span className={`report-status status-${latestStatus}`}>
                          {formattedStatus}
                        </span>
                      </header>
                      <p className="report-description">{report.description || 'No description provided.'}</p>
                      <ul className="report-details">
                        {report.category && (
                          <li><strong>Category:</strong> {report.category}</li>
                        )}
                        {report.police_station && (
                          <li><strong>Police Station:</strong> {report.police_station}</li>
                        )}
                        {report.external_ref_url && (
                          <li>
                            <a href={report.external_ref_url} target="_blank" rel="noopener noreferrer">
                              View official complaint portal
                            </a>
                          </li>
                        )}
                      </ul>
                      <div className={`report-timeline ${updates.length === 0 ? 'report-timeline-empty' : ''}`}>
                        {updates.length === 0 && (
                          <p>No updates shared yet. Check back for police acknowledgements or investigator notes.</p>
                        )}
                        {updates.length > 0 && (
                          <ul>
                            {updates.map((update, index) => (
                              <li key={`${report.id}-update-${index}`}>
                                <div className="timeline-dot" />
                                <div>
                                  <strong>{(update.status || 'update').replace(/_/g, ' ')}</strong>
                                  <span className="timeline-date">
                                    {update.createdAt ? new Date(update.createdAt).toLocaleString() : ''}
                                  </span>
                                  {update.note && <p>{update.note}</p>}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  );
                })()}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderFeedback = () => {
    const safeZones = feedbackSummary.summary
      .filter((item) => Number(item.average_rating) >= 4)
      .slice(0, 3);
    const riskZones = feedbackSummary.summary
      .filter((item) => Number(item.average_rating) <= 2.5)
      .slice(0, 3);
    const topRoutes = feedbackSummary.routes.slice(0, 3);
    const hotspotLocations = feedbackSummary.hotspots.slice(0, 4);

    return (
      <div className="women-section-3d">
        <h2>Community Safety Feedback</h2>
        <p className="section-intro">
          Rate areas and routes to crowdsource safer paths for everyone. Your tips surface in the shared safety map.
        </p>
        <div className="feedback-grid">
          <form
            className="feedback-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleFeedbackSubmit();
            }}
          >
            <div className="form-grid">
              <label>
                Area / Landmark
                <input
                  type="text"
                  name="area"
                  value={feedbackForm.area}
                  onChange={handleFeedbackFieldChange}
                  placeholder="e.g. MG Road Metro, Lodhi Garden Trail"
                  required
                />
              </label>
              <label>
                Route (optional)
                <input
                  type="text"
                  name="routeName"
                  value={feedbackForm.routeName}
                  onChange={handleFeedbackFieldChange}
                  placeholder="e.g. Metro to City Mall walkway"
                />
              </label>
              <label>
                Time of Day
                <select
                  name="timeOfDay"
                  value={feedbackForm.timeOfDay}
                  onChange={handleFeedbackFieldChange}
                >
                  <option value="">Select time window</option>
                  {FEEDBACK_TIMES_OF_DAY.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="feedback-rating">
                Safety rating: <strong>{feedbackForm.rating}/5</strong>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  name="rating"
                  value={feedbackForm.rating}
                  onChange={handleFeedbackFieldChange}
                />
              </label>
            </div>

            <label className="toggle-field">
              <input
                type="checkbox"
                name="isPositive"
                checked={feedbackForm.isPositive}
                onChange={handleFeedbackFieldChange}
              />
              Mark this location as generally safe (untick for unsafe alert)
            </label>

            <div className="smart-tag-input">
              <span>Quick tags</span>
              <div className="smart-tags">
                {SMART_TAG_SUGGESTIONS.map((tag) => {
                  const selected = feedbackForm.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={selected ? 'active' : ''}
                      onClick={() => handleSmartTagToggle(tag)}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                name="tagsInput"
                value={feedbackForm.tagsInput}
                onChange={handleFeedbackFieldChange}
                placeholder="Add more tags (comma separated)"
              />
            </div>

            <label>
              Share your experience
              <textarea
                name="comment"
                value={feedbackForm.comment}
                onChange={handleFeedbackFieldChange}
                placeholder="Describe what felt safe or risky about this spot."
                rows={5}
                required
              />
            </label>

            <button
              type="submit"
              className="feedback-btn"
              disabled={feedbackLoading}
              aria-busy={feedbackLoading}
            >
              {feedbackLoading ? 'Submitting' : 'Submit Feedback'}
            </button>
            {feedbackStatus && (
              <div
                className={`status-message ${
                  feedbackStatus.toLowerCase().includes('success') ? 'success' : 'error'
                }`}
              >
                {feedbackStatus}
              </div>
            )}
            {feedbackError && !feedbackStatus && (
              <div className="status-message error">{feedbackError}</div>
            )}
          </form>

          <div className="feedback-insights">
            <div className="insights-header">
              <h3>Shared Insights</h3>
              {feedbackSummaryLoading && <span className="insights-loading">Updating…</span>}
            </div>
            {feedbackSummary.summary.length === 0 && !feedbackSummaryLoading && (
              <p>No feedback yet. Be the first to rate your route.</p>
            )}

            {safeZones.length > 0 && (
              <section>
                <h4>Top Safe Zones</h4>
                <ul className="insight-list safe">
                  {safeZones.map((item) => (
                    <li key={`safe-${item.area}`}>
                      <strong>{item.area}</strong>
                      <span>{Number(item.average_rating).toFixed(1)} ★ · {item.submissions} reports</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {riskZones.length > 0 && (
              <section>
                <h4>Needs Attention</h4>
                <ul className="insight-list risk">
                  {riskZones.map((item) => (
                    <li key={`risk-${item.area}`}>
                      <strong>{item.area}</strong>
                      <span>{Number(item.average_rating).toFixed(1)} ★ · {item.submissions} alerts</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {topRoutes.length > 0 && (
              <section>
                <h4>Most Rated Routes</h4>
                <ul className="insight-list routes">
                  {topRoutes.map((route) => (
                    <li key={`route-${route.route_name}`}>
                      <strong>{route.route_name}</strong>
                      <span>{Number(route.average_rating).toFixed(1)} ★ · {route.submissions} reviews</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {hotspotLocations.length > 0 && (
              <section>
                <h4>Hotspot Updates</h4>
                <ul className="insight-list hotspots">
                  {hotspotLocations.map((spot, index) => (
                    <li key={`hotspot-${index}`}>
                      <strong>{spot.area}</strong>
                      <span>{spot.safety_level} · {spot.reports} reports</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {feedbackSummary.recent.length > 0 && (
              <section>
                <h4>Your recent submissions</h4>
                <ul className="insight-list recent">
                  {feedbackSummary.recent.map((item, index) => (
                    <li key={`recent-${index}`}>
                      <strong>{item.area}</strong>
                      <span>{Number(item.rating).toFixed(1)} ★ · {new Date(item.created_at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    );
  };

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

          <div className="self-defense-filters" role="group" aria-label="Self-defense filters">
            <label>
              Language
              <input
                type="text"
                name="language"
                value={selfDefenseFilters.language}
                onChange={handleSelfDefenseFilterChange}
                placeholder="e.g. en, hi, ta"
              />
            </label>
            <label>
              Region / City
              <input
                type="text"
                name="region"
                value={selfDefenseFilters.region}
                onChange={handleSelfDefenseFilterChange}
                placeholder="e.g. Delhi"
              />
            </label>
            <label>
              Media type
              <select
                name="mediaType"
                value={selfDefenseFilters.mediaType}
                onChange={handleSelfDefenseFilterChange}
              >
                <option value="all">All</option>
                <option value="video">Video</option>
                <option value="infographic">Infographic</option>
                <option value="audio">Audio</option>
                <option value="article">Article</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
          </div>

          <div className="self-defense-filters-actions">
            <button
              type="button"
              onClick={applySelfDefenseFilters}
              className="filter-apply-btn"
              disabled={selfDefenseLoading}
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={resetSelfDefenseFilters}
              className="filter-reset-btn"
              disabled={selfDefenseLoading}
            >
              Reset
            </button>
          </div>

          {selfDefenseLoading && <div className="status-message info">Loading guides</div>}
          {selfDefenseError && <div className="status-message error">{selfDefenseError}</div>}

          {!selfDefenseLoading && !selfDefenseError && (
            <ul className="guide-list">
              {selfDefenseGuides.length === 0 && (
                <li>No guides available right now. Please check back soon.</li>
              )}
              {selfDefenseGuides.map((guide, index) => (
                <li key={guide.id || `${guide.title}-${index}`}>
                  <div className="guide-header">
                    <strong>{guide.title}</strong>
                    <div className="guide-meta">
                      {guide.languageLabel && <span className="guide-pill">{guide.languageLabel}</span>}
                      {guide.region && <span className="guide-pill muted">{guide.region}</span>}
                      {guide.mediaType && <span className="guide-pill accent">{guide.mediaType}</span>}
                      {Array.isArray(guide.tags) && guide.tags.length > 0 && (
                        <span className="guide-tags">{guide.tags.join(', ')}</span>
                      )}
                    </div>
                  </div>

                  {guide.description && <p className="guide-description">{guide.description}</p>}

                  {guide.mediaType === 'video' && guide.mediaUrl && (
                    <div className="video-wrapper">
                      <iframe
                        title={`${guide.title} video`}
                        src={guide.mediaUrl}
                        width="320"
                        height="180"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  )}

                  {guide.mediaType === 'infographic' && guide.infographicUrl && (
                    <div className="infographic-wrapper">
                      <img src={guide.infographicUrl} alt={`${guide.title} infographic`} loading="lazy" />
                    </div>
                  )}

                  {guide.mediaType === 'audio' && guide.mediaUrl && (
                    <audio controls preload="none">
                      <source src={guide.mediaUrl} />
                      Your browser does not support the audio element.
                    </audio>
                  )}

                  {guide.mediaType === 'pdf' && guide.mediaUrl && (
                    <div className="guide-actions">
                      <a href={guide.mediaUrl} target="_blank" rel="noopener noreferrer">
                        Open PDF guide
                      </a>
                    </div>
                  )}

                  {guide.mediaType === 'article' && guide.mediaUrl && (
                    <div className="guide-actions">
                      <a href={guide.mediaUrl} target="_blank" rel="noopener noreferrer">
                        Read article
                      </a>
                    </div>
                  )}

                  {guide.transcriptUrl && (
                    <div className="guide-actions">
                      <a href={guide.transcriptUrl} target="_blank" rel="noopener noreferrer">
                        View transcript / printable card
                      </a>
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

  const renderHistory = () => (
    <div className="women-section-3d">
      <h2>Event History</h2>
      <p>View your recent fake call and silent alert events.</p>

      {historyLoading && <div className="status-message info">Loading event history...</div>}

      {!historyLoading && eventHistory.length === 0 && (
        <div className="status-message info">
          No events recorded yet. Try triggering a fake call or silent alert.
        </div>
      )}

      {!historyLoading && eventHistory.length > 0 && (
        <div className="event-history-list">
          <table className="history-table">
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Date &amp; Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {eventHistory.map((event, index) => (
                <tr key={event.id || index}>
                  <td>
                    <span
                      className={`event-badge ${
                        event.event_type === 'fake_call' ? 'badge-primary' : 'badge-danger'
                      }`}
                    >
                      {event.event_type === 'fake_call' ? 'Fake Call' : 'Silent Alert'}
                    </span>
                  </td>
                  <td>{new Date(event.created_at).toLocaleString()}</td>
                  <td>
                    <span
                      className={`status-badge ${
                        event.status === 'triggered' ? 'status-success' : 'status-default'
                      }`}
                    >
                      {event.status || 'triggered'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        className="btn btn-secondary"
        onClick={fetchEventHistory}
        disabled={historyLoading}
        style={{ marginTop: '1rem' }}
      >
        {historyLoading ? 'Refreshing...' : 'Load History'}
      </button>
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
      case 'history':
        return renderHistory();
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
          <span className="navbar-title">SurakshaChakra</span>
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

      {sidebarOpen && (
        <div className="women-sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

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
            <li className={activePage === 'history' ? 'active' : ''} onClick={() => handleNavigate('history')}>
              Event History
            </li>
            <li
              onClick={() => {
                setShowHardwarePanicSettings(true);
                setSidebarOpen(false);
              }}
              style={{fontWeight: 'bold', cursor: 'pointer', marginTop: '12px' }}
            >
              Hardware Panic Settings
            </li>
          </ul>
          <div className="card_sidebar" style={{ margin: '16px 0 0 0', textAlign: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={triggerFakeCall}
              disabled={escapeLoading}
              title="Trigger a fake incoming call"
              style={{ marginBottom: '12px' }}
            >
              {escapeLoading ? 'Triggering' : 'One-Click Fake Call'}
            </button>
            {escapeStatus && (
              <div style={{ marginTop: 8, fontSize: '0.85rem', opacity: 0.85 }}>{escapeStatus}</div>
            )}
            <button
              type="button"
              className="btn btn-danger"
              onClick={triggerSilentAlert}
              disabled={silentAlertLoading}
              title="Send silent alert to emergency contacts"
              style={{ marginTop: '8px', backgroundColor: '#dc3545', borderColor: '#dc3545' }}
            >
              {silentAlertLoading ? 'Sending' : 'Silent Alert'}
            </button>
            {/* <button
              type="button"
              className="btn btn-warning"
              onClick={() => setShowHardwarePanicSettings(true)}
              style={{
                marginTop: '12px',
                backgroundColor: '#f59e42',
                borderColor: '#f59e42',
                color: '#222',
                fontWeight: 'bold',
              }}
            >
              Hardware Panic Settings
            </button> */}
            {silentAlertStatus && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: '0.85rem',
                  opacity: 0.85,
                  color: silentAlertStatus.includes('Failed') ? '#dc3545' : '#10b981',
                }}
              >
                {silentAlertStatus}
              </div>
            )}
          </div>
        </aside>
        <main className="women-dashboard-content">
          {showHardwarePanicSettings ? (
            <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 0' }}>
              <button
                className="btn btn-secondary"
                style={{ float: 'right', marginBottom: 12 }}
                onClick={() => setShowHardwarePanicSettings(false)}
              >
                Close
              </button>
              <h2 style={{ color: '#dc3545', marginBottom: 16 }}>Hardware Panic Settings</h2>
              <hr />
              <HardwarePanicSettings
                passportId={
                  userIdentity?.passportId || userIdentity?.aadhaarNumber || userIdentity?.email || ''
                }
              />
            </div>
          ) : (
            <>
              {renderStatusBanners()}
              {renderContent()}
            </>
          )}
        </main>
      </div>

      {showFakeCall && (
        <FakeCallOverlay
          onAnswer={handleFakeCallAnswer}
          onDecline={handleFakeCallDecline}
          callerName="Mom"
          callerNumber="+91 98765 43210"
        />
      )}
    </div>
  );
};

export default WomenDashboard;
