import ReportIncident from './components/ReportIncident';
import ServiceRegistration from './components/ServiceRegistration';
import EmailVerification from './components/EmailVerification';
import Login from './components/Login';
import Guidance from './components/Guidance';
import WomenAuth from './components/WomenAuth';
import WomenDashboard from './components/WomenDashboard';
import HardwarePanicSettings from './components/HardwarePanicSettings';
import OfflineSOS from './components/OfflineSOS';
import TouristSafetyScoreAlerts from './components/TouristSafetyScoreAlerts';
import Orbits from './components/Orbits';
import React, { useState, useEffect, useRef, useMemo } from "react";
// Routing additions
import { BrowserRouter as Router, Switch, Route, Redirect, Link } from 'react-router-dom';
import "./App.css";
import axios from "axios";
import AlertModal from "./AlertModal";
import io from "socket.io-client";
import GeoFenceAlertModal from "./GeoFenceAlertModal";
import Map from "./Map";
import FamilyLogin from "./components/FamilyLogin";
import FamilyDashboard from "./components/FamilyDashboard";
import ProfileForm from "./ProfileForm";
import SafeZonesMap from './components/SafeZonesMap';
import offlineLocationTracker from "./utils/offlineLocationTracker";
import HardwareButtonDetector from "./services/hardwareButtonDetector";
import TouristSupportCenterModule from "./components/TouristSupportCenter";
import TouristIncidentReporting from './components/TouristIncidentReporting';
import TouristNearbyAssistance from './components/TouristNearbyAssistance';

const TouristSupportCenter = TouristSupportCenterModule?.default || TouristSupportCenterModule;

const TOURIST_FEATURE_SECTIONS = [
  { id: 'live', label: 'Live Location' },
  { id: 'support', label: 'Support Center' },
  { id: 'group', label: 'My Group' },
  { id: 'panic', label: 'Panic Controls' },
  { id: 'safezones', label: 'Safe Zones' },
  { id: 'incidents', label: 'Report Incident' },
  { id: 'nearby', label: 'Nearby Assistance' }
];

const DEFAULT_BACKEND_PORT = process.env.REACT_APP_BACKEND_PORT || '3001';

const deriveDefaultBackendUrl = () => {
  const envValue = (process.env.REACT_APP_BACKEND_URL || '').trim();
  if (envValue) {
    return envValue;
  }
  if (typeof window !== 'undefined' && window.location) {
    const { protocol = 'http:', hostname = 'localhost', port } = window.location;
    if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) {
      return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
    }
    const targetPort = port ? `:${port}` : '';
    return `${protocol}//${hostname}${targetPort}`;
  }
  return `http://localhost:${DEFAULT_BACKEND_PORT}`;
};

const sanitizeBackendUrl = (rawValue, fallbackValue) => {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    return fallbackValue;
  }
  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) {
    const protocolGuess =
      (typeof window !== 'undefined' && window.location && window.location.protocol) || 'http:';
    candidate = `${protocolGuess}//${candidate.replace(/^\/+/, '')}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.pathname && parsed.pathname !== '/') {
      console.warn(
        `[config] BACKEND_URL included path '${parsed.pathname}', trimming to origin.`
      );
    }
    return parsed.origin;
  } catch (error) {
    console.warn('[config] Failed to parse BACKEND_URL, resetting to fallback.', error?.message || error);
    return fallbackValue;
  }
};

const DEFAULT_BACKEND = deriveDefaultBackendUrl();

let rawBackendUrl = DEFAULT_BACKEND;
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('BACKEND_URL');
    if (stored) {
      rawBackendUrl = stored;
    }
  } catch (error) {
    console.warn('[config] Unable to read BACKEND_URL from storage:', error?.message || error);
  }
}

let BACKEND_URL = sanitizeBackendUrl(rawBackendUrl, DEFAULT_BACKEND);

try {
  const parsed = new URL(BACKEND_URL);
  if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname) && parsed.port !== String(DEFAULT_BACKEND_PORT)) {
    const newUrl = `${parsed.protocol}//${parsed.hostname}:${DEFAULT_BACKEND_PORT}`;
    console.warn(
      `[config] Normalizing BACKEND_URL from '${BACKEND_URL}' to '${newUrl}' for local backend access.`
    );
    BACKEND_URL = newUrl;
  }
} catch (error) {
  console.warn('[config] BACKEND_URL normalization failed:', error?.message || error);
}

try {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLoopbackFrontend = /^(localhost|127\.0\.0\.1)$/i.test(host);
    const isLocalhostBackend = /(^|\b)localhost\b/i.test(BACKEND_URL);
    if (!isLoopbackFrontend && isLocalhostBackend) {
      const newUrl = `${window.location.protocol}//${host}:${DEFAULT_BACKEND_PORT}`;
      console.warn(
        `[config] Rewriting BACKEND_URL from '${BACKEND_URL}' to '${newUrl}' for LAN access.`
      );
      BACKEND_URL = newUrl;
    }
  }
} catch (error) {
  console.warn('[config] BACKEND_URL rewrite for LAN failed:', error?.message || error);
}

console.log('[config] Using BACKEND_URL =', BACKEND_URL);

if (typeof window !== 'undefined') {
  try {
    localStorage.setItem('BACKEND_URL', BACKEND_URL);
  } catch (error) {
    console.warn('[config] Failed to persist BACKEND_URL:', error?.message || error);
  }
}

// Ensure axios sends cookies for session handling and add the ngrok skip header globally
axios.defaults.withCredentials = true;
axios.defaults.headers.common["ngrok-skip-browser-warning"] = "true";

// --- REUSABLE COMPONENT TO SECURELY LOAD IMAGES ---
// Try a normal <img src> first (fast, uses browser cache). If that fails
// (for example ngrok blocks the request), fall back to fetching the blob
// with axios so we can send the special header and create an object URL.
const ProfileImage = ({ relativeUrl, alt, className, onClick, style }) => {
  // Use backend-hosted default; placed inside a ref so hooks don't require it as a dep
  const DEFAULT_FALLBACK_REF = useRef(`${BACKEND_URL}/uploads/profile-images/default-avatar.png`);
  const [imageUrl, setImageUrl] = useState(DEFAULT_FALLBACK_REF.current);
  const objectUrlRef = useRef(null);
  const triedBlobFetchRef = useRef(false);

  useEffect(() => {
    console.log(`[ProfileImage] Received relativeUrl: '${relativeUrl}'`);
    // Old check removed: if (!relativeUrl || relativeUrl.includes("undefined")) {
    // New check: only fallback if relativeUrl is empty or all spaces
    if (!relativeUrl || relativeUrl.trim() === "") {
      setImageUrl(DEFAULT_FALLBACK_REF.current);
      return;
    }

    let fullImageUrl = relativeUrl.startsWith("http") || relativeUrl.startsWith("blob:")
      ? relativeUrl
      : `${BACKEND_URL}${relativeUrl}`;
    // Encode spaces or other characters to avoid accidental 404s
    try {
      fullImageUrl = encodeURI(fullImageUrl);
    } catch (e) {
      // ignore
    }

    console.log(`[ProfileImage] Attempting to load full URL: '${fullImageUrl}'`);
    // First try letting the browser load the image directly.
    setImageUrl(fullImageUrl);

    return () => {
      if (objectUrlRef.current) {
        try {
          URL.revokeObjectURL(objectUrlRef.current);
        } catch (e) {}
        objectUrlRef.current = null;
      }
    };
  }, [relativeUrl]);

  // Called when the <img> fails to load. We attempt an axios blob fetch once.
  const handleImgError = async () => {
    console.warn(`[ProfileImage] Initial load failed for src: ${imageUrl}`);
    if (!relativeUrl) {
      setImageUrl(DEFAULT_FALLBACK_REF.current);
      return;
    }
    if (triedBlobFetchRef.current) {
      // Already tried blob fetch, fall back to default
  setImageUrl(DEFAULT_FALLBACK_REF.current);
      return;
    }

    triedBlobFetchRef.current = true;
    console.log('[ProfileImage] Retrying with blob fetch...');

    try {
      let fullImageUrl = relativeUrl.startsWith("http") || relativeUrl.startsWith("blob:")
        ? relativeUrl
        : `${BACKEND_URL}${relativeUrl}`;
      try { fullImageUrl = encodeURI(fullImageUrl); } catch (e) {}

      const response = await axios.get(fullImageUrl, {
        responseType: "blob",
        headers: { "ngrok-skip-browser-warning": "true" },
        withCredentials: true,
        timeout: 8000,
      });

      const objectUrl = URL.createObjectURL(response.data);
      objectUrlRef.current = objectUrl;
      console.log(`[ProfileImage] Blob fetch success, created object URL: ${objectUrl}`);
      setImageUrl(objectUrl);
    } catch (error) {
      // Provide richer logs to help debug network/CORS problems
      console.error(`[ProfileImage] Blob fetch failed for ${relativeUrl}:`, {
        message: error?.message,
        status: error?.response?.status,
        headers: error?.response?.headers,
        urlTried: relativeUrl,
      });
      setImageUrl(DEFAULT_FALLBACK_REF.current);
    }
  };

  // Lock in dimensions to avoid layout shift if src changes / missing
  const sizeAttrs = {};
  if (className && className.includes('profile-picture-large')) {
    sizeAttrs.width = 220; // match App.css definition
    sizeAttrs.height = 220;
  }
  return (
    <img
      {...sizeAttrs}
      src={imageUrl}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={handleImgError}
      title={imageUrl}
      style={{ backgroundColor: '#f3f4f6', objectFit: 'cover', ...style }}
    />
  );
};

function App() {
  // --- Geolocation Filtering & Smoothing Configuration ---
  // Max acceptable instantaneous speed (m/s). 60 m/s ~ 216 km/h (well above car speeds)
  const MAX_INSTANT_SPEED_MS = 60;
  // If accuracy worse than this (meters) and movement is large, discard
  const MAX_POOR_ACCURACY_M = 150; // ignore big jumps when accuracy is poor
  // Hard ceiling accuracy (discard anything worse than this immediately)
  const HARD_ACCURACY_LIMIT_M = 5000; // previously 20km; tighten to 5km
  // Maximum single jump distance allowed without intermediate points (meters) if accuracy not great
  const MAX_JUMP_DISTANCE_M = 1200; // 1.2 km sudden jump likely bad
  // Minimum time delta (ms) before allowing big movement consideration (prevents rapid successive jumps)
  const MIN_TIME_DELTA_FOR_BIG_MOVE_MS = 4000;
  // Size of smoothing buffer (moving average)
  const SMOOTHING_BUFFER_SIZE = 5;

  // Refs for filtering logic
  const lastAcceptedPosRef = useRef(null); // {lat, lon, time, accuracy}
  const smoothingBufferRef = useRef([]); // array of {lat, lon}

  // Compute haversine distance in meters
  const haversineMeters = (lat1, lon1, lat2, lon2) => {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371000; // m
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Accept & smooth position
  const acceptAndSmoothPosition = (latitude, longitude, accuracy) => {
    // Push into smoothing buffer
    const buf = smoothingBufferRef.current;
    buf.push({ lat: latitude, lon: longitude });
    if (buf.length > SMOOTHING_BUFFER_SIZE) buf.shift();
    // Compute simple average
    const avg = buf.reduce((acc, p) => { acc.lat += p.lat; acc.lon += p.lon; return acc; }, { lat: 0, lon: 0 });
    const len = buf.length || 1;
    const smoothLat = avg.lat / len;
    const smoothLon = avg.lon / len;
    setCurrentPosition({ latitude: smoothLat, longitude: smoothLon });
    setLastLocationTimestamp(Date.now());
    currentPositionRef.current = { latitude: smoothLat, longitude: smoothLon, accuracy };
    lastAcceptedPosRef.current = { lat: latitude, lon: longitude, time: Date.now(), accuracy };
  };

  // Decide whether to accept incoming raw reading
  const maybeUpdatePosition = (latitude, longitude, accuracy) => {
    if (accuracy != null) {
      if (accuracy > HARD_ACCURACY_LIMIT_M) {
        console.log('[geo-filter] Discard reading: accuracy too poor', accuracy);
        return false;
      }
    }
    const last = lastAcceptedPosRef.current;
    if (!last) {
      acceptAndSmoothPosition(latitude, longitude, accuracy);
      return true;
    }
    const dt = Date.now() - last.time;
    const dist = haversineMeters(last.lat, last.lon, latitude, longitude);
    // If no movement or trivial (< 3m) just ignore to reduce noise unless accuracy significantly improved
    if (dist < 3) {
      if (accuracy != null && last.accuracy != null && accuracy + 5 < last.accuracy) {
        // improved accuracy -> update smoothing anyway
        acceptAndSmoothPosition(latitude, longitude, accuracy);
        return true;
      }
      return false;
    }
    // Compute speed if time delta available
    if (dt > 0) {
      const speed = dist / (dt / 1000); // m/s
      if (speed > MAX_INSTANT_SPEED_MS) {
        console.log('[geo-filter] Discard improbable speed', { dist, dt, speed });
        return false;
      }
    }
    // Large jump checks
    if (dist > MAX_JUMP_DISTANCE_M) {
      // If large jump AND accuracy is poor OR time delta is short, reject
      if ((accuracy != null && accuracy > MAX_POOR_ACCURACY_M) || dt < MIN_TIME_DELTA_FOR_BIG_MOVE_MS) {
        console.log('[geo-filter] Discard large jump', { dist, accuracy, dt });
        return false;
      }
    }
    acceptAndSmoothPosition(latitude, longitude, accuracy);
    return true;
  };
  // Helper to append a cache-busting query so the browser fetches the latest avatar
  const addCacheBuster = (url) => {
    try {
      if (!url || typeof url !== 'string') return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}v=${Date.now()}`;
    } catch {
      return url;
    }
  };
  // Reusable fetcher for the sidebar avatar (stable via useCallback)
  const DEFAULT_AVATAR = `${BACKEND_URL}/uploads/profile-images/default-avatar.png`;
  const stripCacheBuster = (url) => {
    try {
      if (!url) return url;
      const u = new URL(url, window.location.origin);
      u.searchParams.delete('v');
      return u.toString();
    } catch { return url; }
  };
  const broadcastProfileImage = (url) => {
    try { window.dispatchEvent(new CustomEvent('profile-image-updated', { detail: url })); } catch {}
  };

  const fetchSidebarAvatar = React.useCallback(async (pid, svcType = null) => {
    const p = pid;
    // svcType must be passed as parameter since serviceType is defined later in code
    const currentServiceType = svcType;
    
    console.log(`[fetchSidebarAvatar] Fetching for serviceType: ${currentServiceType}`);
    
    try {
      const params = {};
      
      // Check if this is a women user
      if (currentServiceType === 'women_safety') {
        const womenUserStr = localStorage.getItem('WOMEN_USER');
        if (womenUserStr) {
          try {
            const womenUserData = JSON.parse(womenUserStr);
            if (womenUserData.email) {
              params.email = womenUserData.email;
              console.log(`[fetchSidebarAvatar] Using email for women user: ${womenUserData.email}`);
            }
            if (womenUserData.aadhaarNumber || womenUserData.aadhaar_number) {
              params.aadhaarNumber = womenUserData.aadhaarNumber || womenUserData.aadhaar_number;
              console.log(`[fetchSidebarAvatar] Using aadhaarNumber for women user`);
            }
          } catch (parseErr) {
            console.error('[fetchSidebarAvatar] Failed to parse women user data:', parseErr);
          }
        }
        
        // If no women user identifiers found, use default avatar
        if (!params.email && !params.aadhaarNumber) {
          console.warn('[fetchSidebarAvatar] No women user identifiers found, using default avatar');
          setSidebarProfileImageUrl(DEFAULT_AVATAR);
          return;
        }
      } else {
        // Tourist user - use passportId
        if (!p) {
          console.warn('[fetchSidebarAvatar] No passportId provided for tourist user');
          setSidebarProfileImageUrl(DEFAULT_AVATAR);
          return;
        }
        params.passportId = p;
        console.log(`[fetchSidebarAvatar] Using passportId for tourist user: ${p}`);
      }
      
      const res = await axios.get(`${BACKEND_URL}/api/user/profile-image`, {
        withCredentials: true,
        params,
        headers: { 'ngrok-skip-browser-warning': 'true' },
      });
      console.log('[fetchSidebarAvatar] Response:', res.data);
      if (res.data && res.data.url) {
        let rel = res.data.url;
        // Normalize to full absolute URL for consistency
        if (!/^https?:/i.test(rel)) rel = `${BACKEND_URL}${rel}`;
        console.log(`[fetchSidebarAvatar] Success, setting absolute URL: ${rel}`);
        const busted = rel.includes('?') ? `${rel}&v=${Date.now()}` : `${rel}?v=${Date.now()}`;
        setSidebarProfileImageUrl(busted);
        try { localStorage.setItem('PROFILE_IMG_URL', stripCacheBuster(rel)); } catch {}
      } else {
        setSidebarProfileImageUrl(DEFAULT_AVATAR);
        try { localStorage.setItem('PROFILE_IMG_URL', DEFAULT_AVATAR); } catch {}
      }
    } catch (e) {
      console.error('[fetchSidebarAvatar] Fetch failed:', e?.message || e);
      setSidebarProfileImageUrl(DEFAULT_AVATAR);
      try { localStorage.setItem('PROFILE_IMG_URL', DEFAULT_AVATAR); } catch {}
    }
  }, [DEFAULT_AVATAR]);
  // Sidebar profile image state and upload logic will be declared after passportId state

  const onSidebarProfileImageChange = async (e) => {
    console.log('[onSidebarProfileImageChange] File input changed.');
    const file = e.target.files && e.target.files[0];
    if (!file) {
      console.log('[onSidebarProfileImageChange] No file selected.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("File exceeds 5MB.");
      return;
    }
    console.log('[onSidebarProfileImageChange] Setting uploading state to true.');
    setSidebarProfileImageUploading(true);
    try {
      const fd = new FormData();
      
      // Check if this is a women user (serviceType === 'women_safety')
      if (serviceType === 'women_safety') {
        // Get women user data from localStorage
        const womenUserStr = localStorage.getItem('WOMEN_USER');
        if (womenUserStr) {
          try {
            const womenUserData = JSON.parse(womenUserStr);
            if (womenUserData.email) {
              fd.append('email', womenUserData.email);
              console.log('[onSidebarProfileImageChange] Using email for women user:', womenUserData.email);
            }
            if (womenUserData.aadhaarNumber || womenUserData.aadhaar_number) {
              fd.append('aadhaarNumber', womenUserData.aadhaarNumber || womenUserData.aadhaar_number);
              console.log('[onSidebarProfileImageChange] Using aadhaarNumber for women user');
            }
          } catch (parseErr) {
            console.error('[onSidebarProfileImageChange] Failed to parse women user data:', parseErr);
          }
        }
        
        // Verify we have at least email or aadhaarNumber
        if (!fd.has('email') && !fd.has('aadhaarNumber')) {
          alert("Email or Aadhaar number is required for women users to upload profile image.");
          setSidebarProfileImageUploading(false);
          return;
        }
      } else {
        // Tourist user - use passportId
        if (passportId) {
          fd.append('passportId', passportId);
          console.log('[onSidebarProfileImageChange] Using passportId for tourist user');
        } else {
          alert("Passport ID is required to upload profile image.");
          setSidebarProfileImageUploading(false);
          return;
        }
      }
      
      fd.append('profileImage', file);
      console.log('[onSidebarProfileImageChange] Posting image to backend...');
      const res = await axios.post(`${BACKEND_URL}/api/user/profile-image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      console.log('[onSidebarProfileImageChange] Upload response:', res.data);
      if (res.data && res.data.url) {
        let newUrl = res.data.url;
        if (!/^https?:/i.test(newUrl)) newUrl = `${BACKEND_URL}${newUrl}`;
        const busted = addCacheBuster(newUrl);
        console.log(`[onSidebarProfileImageChange] Success, setting new URL: ${busted}`);
        setSidebarProfileImageUrl(busted);
        try { localStorage.setItem('PROFILE_IMG_URL', stripCacheBuster(newUrl)); } catch {}
        broadcastProfileImage(newUrl);
      } else {
        // Fallback to a local object URL if backend doesn't return a URL
        const localUrl = URL.createObjectURL(file);
        console.log(`[onSidebarProfileImageChange] Backend did not return URL, using local object URL: ${localUrl}`);
        setSidebarProfileImageUrl(localUrl);
        broadcastProfileImage(localUrl);
      }
    } catch (err) {
      console.error('[onSidebarProfileImageChange] Upload failed:', err);
      const errorMsg = err?.response?.data?.error || err?.response?.data?.message || "Failed to upload image.";
      alert(errorMsg);
    }
    console.log('[onSidebarProfileImageChange] Setting uploading state to false.');
    setSidebarProfileImageUploading(false);
  };
  // Simple hash-based routing to avoid adding react-router
  const [route, setRoute] = useState(() => (typeof window !== 'undefined' ? window.location.hash.replace('#', '') : ''));
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.replace('#',''));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const go = (path) => {
    try { window.location.hash = path; } catch {}
  };
  // (Old theme persistence block removed – superseded by new adaptive theme system further below)
  // --- State Management ---
  const [authState, setAuthState] = useState("register");
  const [passportId, setPassportId] = useState("");
  const passportIdRef = useRef("");
  useEffect(() => { passportIdRef.current = passportId; }, [passportId]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState("");
  const [userToken, setUserToken] = useState(null);
  useEffect(() => {
    if (!userToken || !passportId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v1/location/sharing`, {
          params: { passportId },
          withCredentials: true,
          headers: { 'ngrok-skip-browser-warning': 'true' },
        });
        if (cancelled) return;
        if (typeof res.data?.enabled === 'boolean') {
          setIsLiveLocationEnabled(res.data.enabled);
          try { localStorage.setItem('liveLocationEnabled', String(res.data.enabled)); } catch {}
        }
        if (typeof res.data?.locked === 'boolean') {
          setIsPanicMode(res.data.locked);
        }
      } catch (e) {
  console.warn('[location-sharing] Failed to fetch preference:', e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, [userToken, passportId]);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [serviceType, setServiceType] = useState(() => {
    try { return localStorage.getItem('SERVICE_TYPE') || ''; } catch { return ''; }
  });
  const [pendingLoginContext, setPendingLoginContext] = useState(null);
  const [loggedInUserName, setLoggedInUserName] = useState("");
  const [touristActivePanel, setTouristActivePanel] = useState('live');
  const isTouristDashboard = serviceType === 'tourist_safety';

  useEffect(() => {
    if (!isTouristDashboard) {
      setTouristActivePanel('live');
    }
  }, [isTouristDashboard]);

  useEffect(() => {
    if (!isTouristDashboard) return;
    if (typeof window === 'undefined') return;
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {
      window.scrollTo(0, 0);
    }
  }, [touristActivePanel, isTouristDashboard]);
  // profilePicture is not used directly; the profile image is fetched separately
  const destInputRef = useRef(null);
  const [currentPosition, setCurrentPosition] = useState(null);
  const currentPositionRef = useRef(null);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingPanic, setLoadingPanic] = useState(false);
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === 'undefined') {
      return true;
    }
    return navigator.onLine;
  });
  const socketRef = useRef(null);
  const [groupInfo, setGroupInfo] = useState(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [pendingInvites, setPendingInvites] = useState([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [groupActionLoading, setGroupActionLoading] = useState(false);
  const [safeZoneSummary, setSafeZoneSummary] = useState({ count: null, nearest: null, loading: false, error: null, list: [] });
  const [lastLocationTimestamp, setLastLocationTimestamp] = useState(null);
  const [emergencyContactCount, setEmergencyContactCount] = useState(0);
  const [showGeoAlert, setShowGeoAlert] = useState(false);
  const [geoAlertData, setGeoAlertData] = useState(null);
  const [dislocationPrompts, setDislocationPrompts] = useState([]);
  const [locationName, setLocationName] = useState("");
  const [safetyScore, setSafetyScore] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPanicMode, setIsPanicMode] = useState(false);
  const [queuedOfflinePanicId, setQueuedOfflinePanicId] = useState(null);
  const [forwardedServices, setForwardedServices] = useState(null); // authorities to which current alert forwarded
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  
  // Hardware Button Detector
  const hardwareDetectorRef = useRef(null);
  const [, setHardwarePanicSettings] = useState(null);
  const [showHardwarePanicProgress, setShowHardwarePanicProgress] = useState(false);
  const [hardwarePanicProgress, setHardwarePanicProgress] = useState(0);
  
  // eslint-disable-next-line no-unused-vars
  const [safeRoute, setSafeRoute] = useState([]);
  // Navigation & map UI state
  const [realTimeTracking, setRealTimeTracking] = useState(false);
  const [isMapEnlarged, setIsMapEnlarged] = useState(false);
  // Live location sharing control
  const [isLiveLocationEnabled, setIsLiveLocationEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('liveLocationEnabled');
      return saved === null ? true : saved === 'true'; // default ON
    } catch { return true; }
  });
  const [locationSharingStatus, setLocationSharingStatus] = useState('idle'); // idle | sending | syncing | offline | error
  
  // --- Safe Route Destination Autocomplete State ---
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const destinationFetchTimeout = useRef(null);
  const [destinationError, setDestinationError] = useState("");
  const [destinationInputFocused, setDestinationInputFocused] = useState(false);
  
  // Dislocation alert suppression: proximity + local snooze
  const DISLOCATION_PROXIMITY_OK_KM = 0.3; // treat as together within 300m
  const DISLOCATION_SNOOZE_MS = 2 * 60 * 1000; // 2 minutes default snooze to match backend 'yes'

  // helpers for snooze persistence
  const getSnoozeKey = React.useCallback(
    (groupName) => `disloc_snooze_${groupName || 'unknown'}`,
    []
  );
  const isGroupSnoozed = React.useCallback(
    (groupName) => {
      try {
        const raw = localStorage.getItem(getSnoozeKey(groupName));
        if (!raw) return false;
        const until = Number(raw);
        if (!until) return false;
        if (Date.now() < until) return true;
        // expired -> cleanup
        localStorage.removeItem(getSnoozeKey(groupName));
        return false;
      } catch {
        return false;
      }
    },
    [getSnoozeKey]
  );
  const snoozeGroup = React.useCallback(
    (groupName, ms = DISLOCATION_SNOOZE_MS) => {
      try {
        localStorage.setItem(
          getSnoozeKey(groupName),
          String(Date.now() + ms)
        );
      } catch {}
    },
    [getSnoozeKey, DISLOCATION_SNOOZE_MS]
  );

  const submitDislocationResponse = React.useCallback(
    async ({ groupName, response, alertId }) => {
      if (!passportId) return;
      try {
        await axios.post(
          `${BACKEND_URL}/api/v1/groups/dislocation-response`,
          {
            groupName,
            passportId,
            response,
            alertId,
          },
          {
            withCredentials: true,
            headers: { 'ngrok-skip-browser-warning': 'true' },
          }
        );
      } catch (error) {
        console.warn(
          '[dislocation] Failed to submit response via HTTP:',
          error?.message || error
        );
      }
    },
    [passportId]
  );

  // Toggle live location sharing
  const toggleLiveLocation = () => {
    if (isPanicMode) return;
    const previousState = isLiveLocationEnabled;
    const newState = !previousState;
    setIsLiveLocationEnabled(newState);
    try { localStorage.setItem('liveLocationEnabled', String(newState)); } catch {}

    (async () => {
      const pid = passportIdRef.current;
      if (!pid) {
        setIsLiveLocationEnabled(previousState);
        try { localStorage.setItem('liveLocationEnabled', String(previousState)); } catch {}
        return;
      }
      try {
        const res = await axios.post(`${BACKEND_URL}/api/v1/location/sharing`, {
          passportId: pid,
          enabled: newState,
        }, { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } });
        if (typeof res.data?.enabled === 'boolean') {
          setIsLiveLocationEnabled(res.data.enabled);
          try { localStorage.setItem('liveLocationEnabled', String(res.data.enabled)); } catch {}
        }
        if (typeof res.data?.locked === 'boolean') {
          setIsPanicMode(res.data.locked);
        }
      } catch (err) {
        console.error('Failed to persist live location preference:', err?.message || err);
        setIsLiveLocationEnabled(previousState);
        try { localStorage.setItem('liveLocationEnabled', String(previousState)); } catch {}
      }
    })();

    if (newState) {
      setLocationSharingStatus('idle');
      if (currentPositionRef.current && passportIdRef.current) {
        const { latitude, longitude, accuracy } = currentPositionRef.current;
        try {
          offlineLocationTracker.setIdentity(passportIdRef.current);
          offlineLocationTracker.storeLocation({ latitude, longitude, accuracy, source: 'manual-enable' });
          if (navigator.onLine) {
            offlineLocationTracker.syncPendingData();
          }
        } catch (err) {
          console.error('Failed to queue immediate location sync:', err);
        }
      }
    } else {
      setLocationSharingStatus('idle');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateOnlineStatus = () => {
      try {
        const online = navigator.onLine;
        setIsOnline(online);
        if (online) {
          offlineLocationTracker.syncPendingData().catch((err) => {
            console.error('[PanicButton] Pending sync failed:', err);
          });
        }
      } catch (statusError) {
        console.error('[PanicButton] Online status update failed:', statusError);
      }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const initials = useMemo(() => {
    const n = loggedInUserName?.trim() || '';
    const parts = n.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [loggedInUserName]);

  const lastCheckInLabel = useMemo(() => {
    if (!lastLocationTimestamp) return '—';
    const diffSeconds = Math.max(0, Math.round((Date.now() - lastLocationTimestamp) / 1000));
    if (diffSeconds < 60) return '<1m';
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`;
    return `${Math.floor(diffSeconds / 86400)}d`;
  }, [lastLocationTimestamp]);

  const safeZoneCountLabel = useMemo(() => {
    if (safeZoneSummary.loading && safeZoneSummary.count === null) return '…';
    if (safeZoneSummary.count == null) return '0';
    return String(safeZoneSummary.count);
  }, [safeZoneSummary]);

  const nearestSafeZoneLabel = useMemo(() => {
    if (safeZoneSummary.loading) return 'Fetching nearby safe zones…';
    if (!safeZoneSummary.count) return 'No safe zones within 5 km';
    if (typeof safeZoneSummary.nearest === 'number') {
      if (safeZoneSummary.nearest < 1) {
        const meters = Math.max(50, Math.round(safeZoneSummary.nearest * 1000));
        return `${meters} m away`;
      }
      return `${safeZoneSummary.nearest.toFixed(1)} km away`;
    }
    const firstListed = safeZoneSummary.list?.[0];
    if (firstListed?.distanceText) return firstListed.distanceText;
    return 'Within 5 km radius';
  }, [safeZoneSummary]);

  const safeZoneList = useMemo(() => safeZoneSummary.list || [], [safeZoneSummary.list]);

  const resolveSafeZoneGlyph = React.useCallback((label = '') => {
    const normalized = String(label).toLowerCase();
    if (normalized.includes('police')) return '🚓';
    if (normalized.includes('hospital') || normalized.includes('clinic')) return '🏥';
    if (normalized.includes('embassy') || normalized.includes('consulate')) return '🛂';
    if (normalized.includes('tourist') || normalized.includes('info')) return '🧭';
    if (normalized.includes('station')) return '🚉';
    return '🛡';
  }, []);

  const liveStatusLabel = useMemo(() => {
    if (isPanicMode) return 'Locked';
    if (locationSharingStatus === 'error') return 'Error';
    if (locationSharingStatus === 'offline') return 'Offline';
    if (locationSharingStatus === 'sending' || locationSharingStatus === 'syncing') return 'Syncing';
    return isLiveLocationEnabled ? 'Active' : 'Paused';
  }, [isPanicMode, locationSharingStatus, isLiveLocationEnabled]);

  const liveStatusVariant = useMemo(() => {
    if (isPanicMode) return 'locked';
    if (locationSharingStatus === 'error') return 'error';
    if (locationSharingStatus === 'offline') return 'offline';
    if (locationSharingStatus === 'sending' || locationSharingStatus === 'syncing') return 'syncing';
    return isLiveLocationEnabled ? 'active' : 'paused';
  }, [isPanicMode, locationSharingStatus, isLiveLocationEnabled]);

  const destinationSummaryLabel = useMemo(() => {
    if (selectedDestination) {
      return selectedDestination.formatted || selectedDestination.name || selectedDestination.address_line1 || destinationQuery || 'Selected destination';
    }
    if (destinationQuery) return destinationQuery;
    return 'Choose your next stop';
  }, [selectedDestination, destinationQuery]);

  const destinationDistanceLabel = useMemo(() => {
    if (selectedDestination) {
      const destLat = selectedDestination.lat || selectedDestination.latitude || selectedDestination.geometry?.lat;
      const destLon = selectedDestination.lon || selectedDestination.longitude || selectedDestination.geometry?.lon;
      if (currentPosition && destLat != null && destLon != null && currentPosition.latitude != null && currentPosition.longitude != null) {
        const meters = haversineMeters(currentPosition.latitude, currentPosition.longitude, destLat, destLon);
        if (Number.isFinite(meters)) {
          if (meters < 1000) return `${Math.max(50, Math.round(meters))} m`;
          return `${(meters / 1000).toFixed(1)} km`;
        }
      }
      if (typeof selectedDestination.distance_text === 'string' && selectedDestination.distance_text.trim()) {
        return selectedDestination.distance_text.trim();
      }
      if (typeof selectedDestination.distance === 'number' && Number.isFinite(selectedDestination.distance)) {
        const kilometers = selectedDestination.distance;
        return kilometers < 1
          ? `${Math.max(50, Math.round(kilometers * 1000))} m`
          : `${kilometers.toFixed(1)} km`;
      }
    }
    return '—';
  }, [selectedDestination, currentPosition]);

  const touristDisplayName = useMemo(() => {
    if (!loggedInUserName) return 'Traveler';
    const trimmed = loggedInUserName.trim();
    if (!trimmed) return 'Traveler';
    const first = trimmed.split(/\s+/)[0];
    return first || 'Traveler';
  }, [loggedInUserName]);

  const locationStatusColor = useMemo(() => {
    if (locationSharingStatus === 'error') return '#dc2626';
    if (locationSharingStatus === 'offline') return '#f59e0b';
    if (locationSharingStatus === 'syncing' || locationSharingStatus === 'sending') return '#3b82f6';
    return isLiveLocationEnabled ? '#10b981' : '#94a3b8';
  }, [locationSharingStatus, isLiveLocationEnabled]);

  // Sidebar profile image state and upload logic (depends on passportId)
  const [sidebarProfileImageUrl, setSidebarProfileImageUrl] = useState("");
  const [sidebarProfileImageUploading, setSidebarProfileImageUploading] = useState(false);
  useEffect(() => {
    console.log(`[App.js] sidebarProfileImageUrl state changed to:`, sidebarProfileImageUrl);
  }, [sidebarProfileImageUrl, DEFAULT_AVATAR]);

  // Hydrate sidebar avatar instantly from localStorage while network fetch runs
  useEffect(() => {
    try {
      if (!sidebarProfileImageUrl) {
        const cached = localStorage.getItem('PROFILE_IMG_URL');
        if (cached) setSidebarProfileImageUrl(addCacheBuster(cached));
        else setSidebarProfileImageUrl(DEFAULT_AVATAR);
      }
    } catch { if (!sidebarProfileImageUrl) setSidebarProfileImageUrl(DEFAULT_AVATAR); }
  }, [sidebarProfileImageUrl, DEFAULT_AVATAR]);
  // Fetch sidebar profile image using provided logic (mapped to passportId)
  useEffect(() => {
    async function fetchProfileImage() {
      const pid = passportId;
      if (!pid) {
        setSidebarProfileImageUrl(DEFAULT_AVATAR);
        try { localStorage.setItem('PROFILE_IMG_URL', DEFAULT_AVATAR); } catch {}
        return;
      }
      try {
        const res = await axios.get(`${BACKEND_URL}/api/user/profile-image`, {
          withCredentials: true,
          params: { passportId: pid },
          headers: { 'ngrok-skip-browser-warning': 'true' },
        });
        if (res.data && res.data.url) {
          let full = res.data.url;
          if (!/^https?:/i.test(full)) full = `${BACKEND_URL}${full}`;
          const busted = addCacheBuster(full);
            setSidebarProfileImageUrl(busted);
          try { localStorage.setItem('PROFILE_IMG_URL', stripCacheBuster(full)); } catch {}
        } else {
          setSidebarProfileImageUrl(DEFAULT_AVATAR);
          try { localStorage.setItem('PROFILE_IMG_URL', DEFAULT_AVATAR); } catch {}
        }
      } catch (e) {
        setSidebarProfileImageUrl(DEFAULT_AVATAR);
        try { localStorage.setItem('PROFILE_IMG_URL', DEFAULT_AVATAR); } catch {}
      }
    }
    fetchProfileImage();
  }, [passportId, DEFAULT_AVATAR]);

  // Pre-cache the image in the browser to speed up future renders
  useEffect(() => {
    try {
      if (sidebarProfileImageUrl) {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = sidebarProfileImageUrl;
        document.head.appendChild(link);
      }
    } catch {}
  }, [sidebarProfileImageUrl]);

  // Keep sidebar avatar in sync if other components update the profile image
  useEffect(() => {
    const handler = (evt) => {
      const url = evt?.detail;
      if (typeof url === 'string' && url.trim()) {
        const busted = addCacheBuster(url);
        setSidebarProfileImageUrl(busted);
        try { localStorage.setItem('PROFILE_IMG_URL', busted); } catch {}
      }
    };
    window.addEventListener('profile-image-updated', handler);
    return () => window.removeEventListener('profile-image-updated', handler);
  }, [fetchSidebarAvatar]);

  // compute nearest distance (km) from current user to any other member in group
  const nearestGroupDistanceKm = React.useCallback(() => {
    try {
      if (!currentPosition || !groupInfo || !Array.isArray(groupInfo.members)) return null;
      const others = groupInfo.members.filter(m => (m.passport_id || m.passportId) !== passportId && m.latitude != null && m.longitude != null);
      if (others.length === 0) return null;
      const toRad = (d) => (d * Math.PI) / 180;
      const R = 6371; // km
      const { latitude: lat1, longitude: lon1 } = currentPosition;
      let min = Infinity;
      for (const m of others) {
        const lat2 = m.latitude, lon2 = m.longitude;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c;
        if (d < min) min = d;
      }
      return isFinite(min) ? min : null;
    } catch { return null; }
  }, [currentPosition, groupInfo, passportId]);

  const presentDislocationAlert = React.useCallback(
    (incoming, options = {}) => {
      if (!incoming) return false;
      const { ignoreProximityCheck = false } = options || {};

      const dislocatedMemberRaw =
        incoming.dislocatedMember || incoming.dislocated_member;
      if (!dislocatedMemberRaw) {
        return false;
      }

      const groupName = incoming.groupName || incoming.group_name;
      if (groupName && isGroupSnoozed(groupName)) {
        console.log(
          `[dislocationAlert] Ignoring alert for ${groupName} because it is snoozed locally.`
        );
        return false;
      }

      const distanceRaw =
        incoming.distance ?? incoming.distanceKm ?? incoming.distance_km;
      const parsedDistance =
        typeof distanceRaw === "number" ? distanceRaw : parseFloat(distanceRaw);
      const proximityDistance = Number.isFinite(parsedDistance)
        ? parsedDistance
        : nearestGroupDistanceKm();

      if (
        !ignoreProximityCheck &&
        proximityDistance != null &&
        proximityDistance <= DISLOCATION_PROXIMITY_OK_KM
      ) {
        console.log(
          "[dislocationAlert] Suppressing due to proximity:",
          proximityDistance
        );
        return false;
      }

      const promptKey = groupName ? `group:${groupName}` : "group:unknown";
      const normalizedAlert = {
        id:
          incoming.alertId ||
          incoming.id ||
          `disloc-${groupName || "unknown"}-${Date.now()}`,
        alertId: incoming.alertId || incoming.id || null,
        promptKey,
        groupName,
        dislocatedMember: dislocatedMemberRaw,
        otherMember: incoming.otherMember || incoming.other_member || "group",
        distance:
          distanceRaw !== undefined && distanceRaw !== null
            ? String(distanceRaw)
            : "",
        message: incoming.message,
      };

      setDislocationPrompts((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const filtered = base.filter((entry) => {
          if (normalizedAlert.alertId && entry.alertId) {
            return entry.alertId !== normalizedAlert.alertId;
          }
          return entry.promptKey !== promptKey;
        });
        return [...filtered, normalizedAlert];
      });
      setGeoAlertData(normalizedAlert);
      setShowGeoAlert(true);
      return true;
    },
    [
      isGroupSnoozed,
      nearestGroupDistanceKm,
      setDislocationPrompts,
      setGeoAlertData,
      setShowGeoAlert,
      DISLOCATION_PROXIMITY_OK_KM,
    ]
  );

  // When the map is enlarged (fullscreen overlay), disable page scroll
  useEffect(() => {
    if (isMapEnlarged) {
      try { document.body.style.overflow = 'hidden'; } catch (e) {}
    } else {
      try { document.body.style.overflow = ''; } catch (e) {}
    }
    return () => { try { document.body.style.overflow = ''; } catch (e) {} };
  }, [isMapEnlarged]);

  // --- Handlers for Authentication Flow ---
  const fetchGroupInfo = React.useCallback(async () => {
    if (!passportId) return;
    try {
      const groupRes = await axios.get(
        `${BACKEND_URL}/api/v1/groups/my-group/${passportId}`,
        { headers: { "ngrok-skip-browser-warning": "true" } }
      );
      const data = groupRes && groupRes.data;
      if (data && typeof data === "object" && data !== null) {
        // Ensure expected shape
        const safe = {
          group_id: data.group_id || data.groupId || null,
          group_name: data.group_name || data.groupName || "Unnamed Group",
          members: Array.isArray(data.members) ? data.members : [],
        };
        if (data.pendingDislocationAlert) {
          safe.pendingDislocationAlert = data.pendingDislocationAlert;
        }
        setGroupInfo(safe.group_id ? safe : null);
        if (!safe.group_id) {
          console.warn("Group object received without group_id, treating as no group", data);
        }
        // No need to refresh invites if we have a group
        if (safe.group_id) {
          setPendingInvites([]);
          if (data.pendingDislocationAlert) {
            presentDislocationAlert(data.pendingDislocationAlert, {
              ignoreProximityCheck: true,
            });
          }
          return;
        }
      }
      // Either no group or invalid data -> get invitations
      setGroupInfo(null);
      try {
        const invitesRes = await axios.get(
          `${BACKEND_URL}/api/v1/groups/invitations/${passportId}`,
          { headers: { "ngrok-skip-browser-warning": "true" } }
        );
        setPendingInvites(
          Array.isArray(invitesRes.data) ? invitesRes.data : []
        );
      } catch (invErr) {
        console.warn(
          "Could not fetch pending invites:",
          invErr?.message || invErr
        );
        setPendingInvites([]);
      }
    } catch (error) {
      console.warn("Could not fetch group info:", error?.message || error);
    }
  }, [passportId, presentDislocationAlert]);

  useEffect(() => {
    if (!isTouristDashboard) {
      setEmergencyContactCount(0);
      return;
    }
    const count = Array.isArray(groupInfo?.members)
      ? groupInfo.members.filter(Boolean).length
      : 0;
    setEmergencyContactCount(count);
  }, [groupInfo, isTouristDashboard]);


  // Registration is delegated to RegisterForm component now; removed unused handleRegister

  const handleVerifyEmail = async () => {
    setErrorMessage("");
    try {
      await axios.post(`${BACKEND_URL}/api/v1/auth/verify-email`, {
        passportId,
        code,
      });
      setAlertMessage("Email verified! You can now log in.");
      setShowAlert(true);
      setAuthState("login");
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "Verification failed.");
    }
  };

  const handleLogin = async () => {
    setErrorMessage("");
    if (!email || !email.trim()) {
      setErrorMessage('Email address is required.');
      return;
    }
    const normalizedEmail = email.trim();
    setLoadingLogin(true);
    try {
      let loginResponse = null;
      const attemptLogin = async (url) => {
        const resp = await axios.post(url, { email: normalizedEmail });
        return resp;
      };

      try {
        loginResponse = await attemptLogin(`${BACKEND_URL}/api/v1/auth/login`);
      } catch (primaryErr) {
        const blocked = /ERR_BLOCKED_BY_CLIENT/i.test(primaryErr?.message || '') || (primaryErr?.code === 'ERR_BLOCKED_BY_CLIENT');
        // Some ad/privacy blockers or strict extension rules can block localhost:3001 direct calls.
        // If blocked, retry via same-origin relative path (will use CRA proxy when in dev environment).
        if (blocked) {
          console.warn('[handleLogin] Primary login request appears blocked by client. Retrying via relative /api path.');
          try {
            loginResponse = await attemptLogin(`/api/v1/auth/login`);
          } catch (retryErr) {
            console.error('[handleLogin] Retry via relative path failed:', retryErr);
            throw retryErr; // propagate to outer catch
          }
        } else {
          throw primaryErr; // rethrow non-block related error
        }
      }

  const responseData = loginResponse?.data || {};
  const nextService = responseData.serviceType || responseData.service_type || serviceType || 'general_safety';
  const rawNextUserType = responseData.userType || responseData.user_type || 'tourist';
  const nextUserType = (rawNextUserType || '').toLowerCase() || 'tourist';

      if (nextService) {
        setServiceType(nextService);
        try { localStorage.setItem('SERVICE_TYPE', nextService); } catch {}
      }
      setPendingLoginContext({ serviceType: nextService, userType: nextUserType });

      setAlertMessage(responseData.message || "OTP has been sent to your registered email.");
      setShowAlert(true);
      setAuthState("verifyOtp");
    } catch (error) {
      // Provide more granular diagnostics to help troubleshoot
      const status = error?.response?.status;
      if (status === 404) {
        console.error('[handleLogin] 404 Not Found. Check if backend route /api/v1/auth/login exists.');
      } else if (status === 500) {
        console.error('[handleLogin] 500 Server Error during login.');
      } else if (!status) {
        console.error('[handleLogin] Network/Client error during login:', error?.message);
      }
      setErrorMessage(error.response?.data?.message || (error?.message?.includes('ERR_BLOCKED_BY_CLIENT') ? 'Request was blocked by a browser extension. Please disable it for this site and try again.' : 'Login failed.'));
    } finally {
      setLoadingLogin(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMessage("");
    const normalizedEmail = email ? email.trim() : '';
    if (!normalizedEmail) {
      setErrorMessage('Email address is required.');
      return;
    }
    try {
      const payload = { email: normalizedEmail, otp };
      const pendingServiceType = pendingLoginContext?.serviceType;
      const pendingUserType = pendingLoginContext?.userType;
      if (pendingServiceType) {
        payload.serviceType = pendingServiceType;
        payload.service_type = pendingServiceType;
      }
      if (pendingUserType) {
        payload.userType = pendingUserType;
        payload.user_type = pendingUserType;
      }
      const response = await axios.post(
        `${BACKEND_URL}/api/v1/auth/verify-otp`,
        payload
      );
      setPendingLoginContext(null);
      const responseData = response.data || {};
      const {
        token,
        name,
        serviceType: svcCamel,
        service_type: svcSnake,
        userType: userTypeCamel,
        user_type: userTypeSnake,
        womenUser,
        women_user: womenUserSnake
      } = responseData;
  const resolvedServiceType = svcCamel || svcSnake || pendingServiceType || serviceType || 'general_safety';
  const verifiedUserType = (userTypeCamel || userTypeSnake || pendingUserType || '').toLowerCase() || 'tourist';
      // Ensure passportId first so downstream effects have it when userToken appears
      const newPid = responseData.passportId || passportId;
      setPassportId(newPid);
      setLoggedInUserName(name);
      setUserToken(token);
      if (resolvedServiceType) {
        setServiceType(resolvedServiceType);
        try { localStorage.setItem('SERVICE_TYPE', resolvedServiceType); } catch {}
      }
      const normalizedWomenUser = womenUser || womenUserSnake;
      if (verifiedUserType === 'women' && normalizedWomenUser) {
        try { localStorage.setItem('WOMEN_USER', JSON.stringify(normalizedWomenUser)); } catch {}
        // Fetch women user avatar
        try { await fetchSidebarAvatar(null, 'women_safety'); } catch {}
      }
      if (verifiedUserType !== 'women') {
        try { localStorage.removeItem('WOMEN_USER'); } catch {}
        try { await fetchSidebarAvatar(newPid, resolvedServiceType); } catch {}
      }
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "OTP verification failed.");
    }
  };

  const handleLogout = async () => {
    try {
      if (passportId) {
        await axios.post(
          `${BACKEND_URL}/api/v1/auth/logout`,
          { passportId },
          { withCredentials: true }
        );
      }
    } catch (error) {
      console.error("Error notifying server of logout:", error);
    } finally {
      // Clear all user state
      setUserToken(null);
      setLoggedInUserName("");
      setPassportId("");
      setEmail("");
      setOtp("");
      setGroupInfo(null);
      setPendingInvites([]);
      setErrorMessage("");
      setAuthState("login");
  setDislocationPrompts([]);
      
      // Clear women user from localStorage
      try {
        localStorage.removeItem('WOMEN_USER');
        localStorage.removeItem('SERVICE_TYPE');
      } catch (err) {
        console.warn('[Logout] Error clearing localStorage:', err);
      }
    }
  };

  // Removed inline profile picture upload from header; handled within profile flow if needed.

  const handleDislocationResponse = (response, alertPayload = null) => {
    const payload = alertPayload || geoAlertData;
    if (!payload) {
      return;
    }

    if (socketRef.current) {
      socketRef.current.emit("dislocationResponse", {
        groupName: payload.groupName,
        passportId: passportId,
        response: response,
        alertId: payload.alertId || payload.id || null,
      });
    }

    submitDislocationResponse({
      groupName: payload.groupName,
      response,
      alertId: payload.alertId || payload.id || null,
    });

    if (payload.groupName) {
      const ms = String(response).toLowerCase() === 'no' ? (5 * 60 * 1000) : (2 * 60 * 1000);
      snoozeGroup(payload.groupName, ms);
    }

    const promptKey =
      payload.promptKey || (payload.groupName ? `group:${payload.groupName}` : null);
    setDislocationPrompts((prev) => {
      if (!Array.isArray(prev)) {
        return [];
      }
      return prev.filter((entry) => {
        if (payload.alertId && entry.alertId) {
          return entry.alertId !== payload.alertId;
        }
        if (promptKey) {
          return entry.promptKey !== promptKey;
        }
        return entry.id !== payload.id;
      });
    });

    if (!alertPayload || (geoAlertData && geoAlertData.groupName === payload.groupName)) {
      setShowGeoAlert(false);
      setGeoAlertData(null);
    }
  };

  const handleCloseAlert = () => {
    setShowAlert(false);
    setAlertMessage("");
  };
  const handleCloseGeoAlert = () => {
    setShowGeoAlert(false);
    setGeoAlertData(null);
  };

  // Reverse geocode helper wrapped to provide stable reference for hooks
  const fetchLocationName = React.useCallback(async (latitude, longitude) => {
    try {
      // The new URL points to YOUR backend
      const response = await axios.post(
        `${BACKEND_URL}/api/v1/location/reverse-geocode`,
        {
          latitude,
          longitude,
        }
      );

      if (response.data?.features?.length > 0) {
        const address = response.data.features[0].properties.formatted;
        setLocationName(address);
      } else {
        setLocationName("Address not available");
      }
    } catch (error) {
      console.error("Error fetching location from backend proxy:", error);
      setLocationName("Location lookup failed");
    }
  }, []);

  // Manual location refresh (helps when browser provided only coarse IP-based location initially)
  const forceRefreshLocation = React.useCallback(() => {
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
      console.warn('Geolocation API not available for force refresh');
      return;
    }
    const attempt = (highAccuracy, attemptNo) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          console.log('[forceRefreshLocation] Fresh reading:', { latitude, longitude, accuracy, attempt: attemptNo, highAccuracy });
          setCurrentPosition({ latitude, longitude });
          setLastLocationTimestamp(Date.now());
          currentPositionRef.current = { latitude, longitude, accuracy };
          fetchLocationName(latitude, longitude);
          // push immediate update via offline tracker (no await in sync callback)
          if (isLiveLocationEnabled || isPanicMode) {
            try {
              setLocationSharingStatus('sending');
              offlineLocationTracker.setIdentity(passportIdRef.current);
              offlineLocationTracker.storeLocation({
                latitude,
                longitude,
                accuracy,
                source: 'force-refresh'
              });
              if (navigator.onLine) {
                setLocationSharingStatus('syncing');
                offlineLocationTracker.syncPendingData().then(() => {
                  setLocationSharingStatus('idle');
                }).catch(() => {
                  setLocationSharingStatus('error');
                });
              } else {
                setLocationSharingStatus('offline');
              }
            } catch (err) {
              console.error('Location sharing error:', err);
              setLocationSharingStatus('error');
            }
          }
        },
        (err) => {
          console.error('[forceRefreshLocation] getCurrentPosition error', err, { attempt: attemptNo, highAccuracy });
          if (attemptNo === 1) attempt(false, 2);
        },
        { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 15000 : 25000, maximumAge: 0 }
      );
    };
    attempt(true, 1);
  }, [fetchLocationName, isLiveLocationEnabled, isPanicMode]);

  // Trigger a precise location refresh once both passportId and userToken are available
  useEffect(() => {
    if (userToken && passportId) {
      console.log('[auth ready] invoking forceRefreshLocation');
      forceRefreshLocation();
    }
  }, [userToken, passportId, forceRefreshLocation]);

  useEffect(() => {
    if (!isTouristDashboard) return;
    if (!currentPosition?.latitude || !currentPosition?.longitude) return;

    let cancelled = false;
  setSafeZoneSummary((prev) => ({ ...prev, loading: true, error: null }));

    const fetchNearbyZones = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v1/safe-zones/nearby`, {
          params: {
            lat: currentPosition.latitude,
            lon: currentPosition.longitude,
            radius: 5,
            limit: 12,
          },
          headers: { 'ngrok-skip-browser-warning': 'true' },
        });

        if (cancelled) return;
        const zones = Array.isArray(res.data?.data) ? res.data.data : [];
        let nearestDistance = null;
        if (zones.length) {
          const rawDistance = zones[0]?.distance ?? zones[0]?.distance_km ?? zones[0]?.distanceMeters;
          if (typeof rawDistance === 'number' && Number.isFinite(rawDistance)) {
            nearestDistance = rawDistance;
          } else if (typeof rawDistance === 'string' && rawDistance.trim()) {
            const parsed = parseFloat(rawDistance);
            if (!Number.isNaN(parsed)) {
              nearestDistance = parsed;
            }
          }
        }
        const formattedZones = zones.slice(0, 3).map((zone, index) => {
          const rawName = zone.name || zone.zone_name || zone.place_name || zone.location || zone.title || zone.type;
          const label = rawName ? String(rawName) : `Safe Zone ${index + 1}`;
          let distanceText = null;
          if (typeof zone.distance === 'number' && Number.isFinite(zone.distance)) {
            distanceText = zone.distance < 1
              ? `${Math.max(50, Math.round(zone.distance * 1000))} m`
              : `${zone.distance.toFixed(1)} km`;
          } else if (typeof zone.distance === 'string' && zone.distance.trim()) {
            distanceText = zone.distance.trim();
          } else if (typeof zone.distance_text === 'string' && zone.distance_text.trim()) {
            distanceText = zone.distance_text.trim();
          } else if (typeof zone.distance_label === 'string' && zone.distance_label.trim()) {
            distanceText = zone.distance_label.trim();
          }
          return {
            id: zone.id || zone.zone_id || zone.place_id || zone.uuid || `zone-${index}`,
            label,
            distanceText: distanceText || 'Within reach',
          };
        });
        setSafeZoneSummary({ count: zones.length, nearest: nearestDistance, loading: false, error: null, list: formattedZones });
      } catch (error) {
        if (cancelled) return;
        setSafeZoneSummary((prev) => ({ ...prev, loading: false, error: error?.message || 'Failed to load safe zones', list: prev.list || [] }));
      }
    };

    const timer = setTimeout(fetchNearbyZones, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isTouristDashboard, currentPosition?.latitude, currentPosition?.longitude]);

  // --- Safe Route Destination Autocomplete Handlers ---
  const fetchDestinationSuggestions = React.useCallback(async (query) => {
    setDestinationError("");
    console.log('[fetchDestinationSuggestions] Fetching suggestions for:', query);
    const apiKey = process.env.REACT_APP_GEOAPIFY_KEY || 'YOUR_GEOAPIFY_API_KEY';
    let url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&limit=6&format=json&apiKey=${apiKey}`;
    // Use currentPositionRef for bias if available
    if (currentPositionRef.current) {
      const { latitude, longitude } = currentPositionRef.current;
      url += `&lat=${latitude}&lon=${longitude}`;
      console.log('[fetchDestinationSuggestions] Biasing results to current location:', { latitude, longitude });
    }
    try {
      console.log('[fetchDestinationSuggestions] Fetching from URL:', url);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      console.log('[fetchDestinationSuggestions] Received results:', data.results?.length || 0);
      setDestinationSuggestions(data.results || []);
      if (!data.results || data.results.length === 0) {
        setDestinationError("No suggestions found.");
      }
    } catch (e) {
      console.error('[fetchDestinationSuggestions] Error fetching suggestions:', e);
      setDestinationSuggestions([]);
      setDestinationError("Error fetching suggestions. Check your network or API key.");
    }
  }, []);

  const handleDestinationInput = React.useCallback((e) => {
    const value = e.target.value;
    setDestinationQuery(value);
    setSelectedDestination(null);
    setDestinationError("");
    if (destinationFetchTimeout.current) clearTimeout(destinationFetchTimeout.current);
    if (!value || value.length < 2) {
      setDestinationSuggestions([]);
      setDestinationError("");
      return;
    }
    destinationFetchTimeout.current = setTimeout(() => {
      fetchDestinationSuggestions(value);
    }, 300);
  }, [fetchDestinationSuggestions]);

  const handleSelectDestination = React.useCallback((suggestion) => {
    console.log('[handleSelectDestination] Selected:', suggestion);
    setSelectedDestination(suggestion);
    setDestinationQuery(suggestion.formatted || suggestion.name || suggestion.address_line1 || '');
    setDestinationSuggestions([]);
  }, []);

  const findSafeRoute = React.useCallback(async (destination) => {
    console.log('[findSafeRoute] Finding route to:', destination);
    setDestinationError("");
    if (!currentPositionRef.current) {
      setAlertMessage('Current location not available.');
      setShowAlert(true);
      return;
    }
    const apiKey = process.env.REACT_APP_GEOAPIFY_KEY || 'YOUR_GEOAPIFY_API_KEY';
    const { latitude, longitude } = currentPositionRef.current;
    const destLat = destination.lat || destination.latitude || (destination.geometry && destination.geometry.lat);
    const destLon = destination.lon || destination.longitude || (destination.geometry && destination.geometry.lon);
    if (destLat == null || destLon == null) {
      setAlertMessage('Destination coordinates not found.');
      setShowAlert(true);
      return;
    }
    const url = `https://api.geoapify.com/v1/routing?waypoints=${latitude},${longitude}|${destLat},${destLon}&mode=walk&apiKey=${apiKey}`;
    try {
      setAlertMessage('Finding safe route...');
      setShowAlert(true);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.features && data.features.length > 0) {
        // Geoapify returns a GeoJSON LineString in geometry.coordinates [lon, lat]
        let coords = data.features[0].geometry.coordinates;
        if (!Array.isArray(coords) || coords.length === 0 || !Array.isArray(coords[0])) {
          setSafeRoute([]);
          setAlertMessage('Route data invalid or empty.');
          setShowAlert(true);
          console.error('[findSafeRoute] Invalid route coordinates:', coords);
          return;
        }
        setSafeRoute(coords);
        setAlertMessage('Route found!');
        setShowAlert(true);
        console.log('[findSafeRoute] Route coordinates:', coords);
      } else {
        setSafeRoute([]);
        setAlertMessage('No route found.');
        setShowAlert(true);
        console.error('[findSafeRoute] No route found in API response:', data);
      }
    } catch (e) {
      setSafeRoute([]);
      setAlertMessage('Error fetching route. Check your network or API key.');
      setShowAlert(true);
      console.error('[findSafeRoute] Error:', e);
    }
  }, []);

  // Hardware Panic Trigger Handler
  const handleHardwarePanicTrigger = React.useCallback(async (triggerData) => {
    console.log('[Hardware Panic] Trigger detected:', triggerData);
    
    if (!userToken || !currentPositionRef.current || !passportId) {
      console.warn('[Hardware Panic] Cannot trigger: user or location not available');
      return;
    }

    const { latitude, longitude, accuracy } = currentPositionRef.current;

    try {
      setLoadingPanic(true);
      
      const response = await axios.post(
        `${BACKEND_URL}/api/v1/hardware-panic/trigger`,
        {
          triggerType: triggerData.triggerType,
          triggerPattern: triggerData.triggerPattern,
          triggerCount: triggerData.triggerCount,
          latitude,
          longitude,
          accuracy: accuracy || null,
          deviceInfo: triggerData.deviceInfo
        },
        { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } }
      );

      if (response.data.success) {
        setIsPanicMode(true);
        setForwardedServices(response.data.services || null);
        
        // Auto-enable live location sharing
        setIsLiveLocationEnabled(true);
        try {
          localStorage.setItem('liveLocationEnabled', 'true');
        } catch {}

        // Auto-start audio recording if enabled
        if (response.data.autoRecordAudio && !isRecording) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            recordedChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) {
                recordedChunksRef.current.push(event.data);
              }
            };

            mediaRecorder.start();
            setIsRecording(true);
            console.log('[Hardware Panic] Audio recording started');
          } catch (recErr) {
            console.warn('[Hardware Panic] Failed to start audio recording:', recErr);
          }
        }

        setAlertMessage(`🚨 Hardware panic alert sent! Alert ID: ${response.data.alertId}`);
        setShowAlert(true);

        // Emit socket event
        if (socketRef.current) {
          socketRef.current.emit("startPanicMode", { passportId });
        }
      } else if (response.data.settingsDisabled) {
        setAlertMessage('Hardware panic trigger is disabled. Enable it in settings.');
        setShowAlert(true);
      }
    } catch (error) {
      console.error('[Hardware Panic] Error triggering alert:', error);
      setErrorMessage('Failed to send hardware panic alert. Please try again.');
    } finally {
      setLoadingPanic(false);
    }
  }, [userToken, passportId, isRecording]);

  // Initialize Hardware Button Detector
  useEffect(() => {
    if (!userToken || !passportId) return;

    // Load hardware panic settings
    const loadHardwareSettings = async () => {
      try {
        const response = await axios.get(
          `${BACKEND_URL}/api/v1/hardware-panic/settings`,
          { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } }
        );
        
        if (response.data.success && response.data.settings) {
          setHardwarePanicSettings(response.data.settings);
          
          // Initialize detector with settings
          if (response.data.settings.enabled && !hardwareDetectorRef.current) {
            const detector = new HardwareButtonDetector({
              ...response.data.settings,
              onTrigger: handleHardwarePanicTrigger,
              onPatternProgress: (progress) => {
                setHardwarePanicProgress(progress.progress);
                setShowHardwarePanicProgress(progress.count > 0);
                
                // Auto-hide progress indicator after 2 seconds of inactivity
                setTimeout(() => {
                  setShowHardwarePanicProgress(false);
                  setHardwarePanicProgress(0);
                }, 2000);
              }
            });
            
            detector.start();
            hardwareDetectorRef.current = detector;
            console.log('[Hardware Panic] Detector initialized and started');
          }
        }
      } catch (error) {
        console.error('[Hardware Panic] Failed to load settings:', error);
      }
    };

    loadHardwareSettings();

    // Cleanup on unmount
    return () => {
      if (hardwareDetectorRef.current) {
        hardwareDetectorRef.current.stop();
        hardwareDetectorRef.current = null;
        console.log('[Hardware Panic] Detector stopped');
      }
    };
  }, [userToken, passportId, handleHardwarePanicTrigger]);

  const handlePanic = async () => {
    setErrorMessage("");
    setLoadingPanic(true);

    if (!userToken || !currentPosition || !passportId) {
      setErrorMessage(
        "Cannot activate panic mode: user or location is not available."
      );
      setLoadingPanic(false);
      return;
    }

    const panicRecord = {
      passportId,
      latitude: currentPosition.latitude,
      longitude: currentPosition.longitude,
      accuracy: currentPositionRef.current?.accuracy ?? null,
      location: locationName && locationName.trim() ? locationName : undefined,
      triggeredAt: new Date().toISOString(),
      source: 'panic-button',
    };

    const queuePanicOffline = async (message) => {
      const queuedPayload = {
        passportId: panicRecord.passportId,
        latitude: panicRecord.latitude,
        longitude: panicRecord.longitude,
        triggeredAt: panicRecord.triggeredAt,
        source: panicRecord.source,
      };
      if (panicRecord.location) {
        queuedPayload.location = panicRecord.location;
      }
      if (panicRecord.accuracy !== null && panicRecord.accuracy !== undefined) {
        queuedPayload.accuracy = panicRecord.accuracy;
      }

      try {
        const id = await offlineLocationTracker.storePanicAlert(queuedPayload);
        setQueuedOfflinePanicId(id);
        setIsPanicMode(true);
        try {
          setIsLiveLocationEnabled(true);
          localStorage.setItem('liveLocationEnabled', 'true');
        } catch {}
        const pid = passportIdRef.current || panicRecord.passportId;
        if (pid) {
          axios.post(`${BACKEND_URL}/api/v1/location/sharing`, {
            passportId: pid,
            enabled: true,
          }, { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } }).catch(() => {});
        }
        setAlertMessage(message);
        setShowAlert(true);
        return { success: true, id };
      } catch (storeError) {
        console.error("Panic offline queue error:", storeError);
        setErrorMessage("Unable to queue SOS alert offline. Please retry once you have connectivity.");
        return { success: false };
      }
    };

    const isNavigatorOnline = typeof navigator === "undefined" ? true : navigator.onLine;
    let panicInitiated = false;
    let queuedOffline = false;

    if (!isNavigatorOnline) {
      const { success } = await queuePanicOffline("You're offline. SOS alert queued and will auto-send once you're back online.");
      if (!success) {
  setIsPanicMode(false);
        setLoadingPanic(false);
        return;
      }
      panicInitiated = true;
      queuedOffline = true;
    } else {
      try {
        await axios.post(`${BACKEND_URL}/api/v1/alert/panic`, {
          passportId: panicRecord.passportId,
          latitude: panicRecord.latitude,
          longitude: panicRecord.longitude,
        });

        setAlertMessage("Panic signal sent! Help is on the way.");
        setShowAlert(true);
        setIsPanicMode(true);
        try {
          setIsLiveLocationEnabled(true);
          localStorage.setItem('liveLocationEnabled', 'true');
        } catch {}
        axios.post(`${BACKEND_URL}/api/v1/location/sharing`, {
          passportId: passportIdRef.current || panicRecord.passportId,
          enabled: true,
        }, { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } }).catch(() => {});
        panicInitiated = true;

        if (socketRef.current) {
          console.log('Emitting startPanicMode and identify for passportId', passportId);
          socketRef.current.emit("startPanicMode", { passportId });
          try {
            socketRef.current.emit('identify', passportId, () => {
              console.log('Identify ack from server for', passportId);
            });
          } catch (e) {
            console.warn('identify emit failed:', e && e.message);
          }
        }
      } catch (error) {
        console.error("Panic signal error:", error);
        const { success } = await queuePanicOffline("Connectivity issue detected. SOS alert queued and will auto-send once the connection is restored.");
        if (!success) {
          setErrorMessage("Failed to send panic signal and could not queue it offline. Please try again when you have a connection.");
          setIsPanicMode(false);
          setLoadingPanic(false);
          return;
        }
        queuedOffline = true;
        panicInitiated = true;
      }
    }

    setLoadingPanic(false);

    if (!panicInitiated) {
      return;
    }

    if (!queuedOffline) {
      setQueuedOfflinePanicId(null);
    }

    // --- 2. Start Audio Recording and Streaming ---
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      console.warn("Audio capture is not supported in this browser.");
      setAlertMessage(
        "Panic signal sent, but audio recording is not supported on your device."
      );
      setShowAlert(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder; // Save instance to ref

      // When the recorder starts, update the UI
      mediaRecorder.onstart = () => {
        setIsRecording(true);
        console.log("Audio recording started.");
      };

      // Handle the audio data as it becomes available. We'll both buffer locally
      // (so we can upload reliably on stop) and attempt to stream via socket.
      recordedChunksRef.current = [];
      mediaRecorder.ondataavailable = async (event) => {
        try {
          if (event.data && event.data.size > 0) {
            // Buffer locally
            recordedChunksRef.current.push(event.data);

            // Try to stream via socket as well
            // We no longer stream chunks via socket to avoid duplicate files.
            // The full buffered Blob will be uploaded reliably on stop.
          }
        } catch (err) {
          console.error("Failed to handle audio chunk:", err);
        }
      };

      // Clean up when the recorder stops and notify backend to finalize the file
      mediaRecorder.onstop = async () => {
        try {
          stream.getTracks().forEach((track) => track.stop()); // Release the microphone
          setIsRecording(false);
          console.log("Audio recording stopped and microphone released.");

          // Notify backend via socket to finalize any streamed file
          if (socketRef.current) {
            socketRef.current.emit("stopAudio", { passportId });
          }

          const chunks = recordedChunksRef.current || [];
          if (chunks.length > 0) {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const filename = `panic-${passportId}-${Date.now()}.webm`;
            const recordedAt = new Date().toISOString();

            const persistOfflineRecording = async () => {
              try {
                await offlineLocationTracker.storePanicRecording({
                  passportId,
                  filename,
                  blob,
                  triggeredAt: panicRecord.triggeredAt,
                  recordedAt,
                  location: panicRecord.location,
                  accuracy: panicRecord.accuracy ?? undefined
                });
                setAlertMessage("Audio saved offline. It will upload once you're back online.");
                setShowAlert(true);
              } catch (storeErr) {
                console.error('Failed to store panic recording offline:', storeErr);
                setErrorMessage("Could not save the audio recording offline. Please retry when you have a connection.");
              }
            };

            const currentlyOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

            if (currentlyOnline) {
              try {
                const formData = new FormData();
                formData.append('recording', blob, filename);
                formData.append('passportId', passportId);
                formData.append('recordedAt', recordedAt);
                if (panicRecord.triggeredAt) {
                  formData.append('triggeredAt', panicRecord.triggeredAt);
                }
                if (panicRecord.location) {
                  formData.append('location', panicRecord.location);
                }
                if (panicRecord.accuracy !== null && panicRecord.accuracy !== undefined) {
                  formData.append('accuracy', String(panicRecord.accuracy));
                }

                const uploadRes = await axios.post(`${BACKEND_URL}/api/v1/alert/upload-recording`, formData, {
                  headers: { 'Content-Type': 'multipart/form-data', 'ngrok-skip-browser-warning': 'true' },
                  withCredentials: true,
                  timeout: 20000,
                });
                console.log('Uploaded final recording via HTTP:', uploadRes.data);
              } catch (uploadErr) {
                console.error('Failed to upload final recording:', uploadErr);
                await persistOfflineRecording();
              }
            } else {
              await persistOfflineRecording();
            }
          } else {
            console.log('No buffered chunks to upload');
          }
        } catch (e) {
          console.warn('Error in mediaRecorder.onstop:', e && e.message);
        } finally {
          recordedChunksRef.current = [];
        }
      };

      // Start recording and stream data in 2-second chunks
      mediaRecorder.start(2000);
    } catch (err) {
      console.error("Failed to start audio recording:", err);
      setErrorMessage(
        "Could not start audio recording. Check microphone permissions."
      );
    }
  };

  const handleCancelPanic = async () => {
    if (!isPanicMode) return;

    // --- 1. Stop the Audio Recording ---
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }

    let queuedOutcome = null;
    if (queuedOfflinePanicId !== null) {
      try {
        const result = await offlineLocationTracker.cancelPanicAlert(queuedOfflinePanicId);
        queuedOutcome = result.cancelled ? 'removed' : 'not_found';
      } catch (deleteError) {
        console.error("Failed to cancel offline SOS alert:", deleteError);
        setErrorMessage("Could not cancel the queued SOS alert. Please try again.");
        return;
      } finally {
        setQueuedOfflinePanicId(null);
      }
    }

    const canNotifyBackend = typeof navigator === 'undefined' || navigator.onLine;

    if (canNotifyBackend) {
      try {
        await axios.post(`${BACKEND_URL}/api/v1/alert/cancel`, { passportId });

        if (socketRef.current) {
          socketRef.current.emit("cancelPanicMode", { passportId });
        }

        if (queuedOutcome === 'removed') {
          setAlertMessage("Queued offline SOS alert removed. Cancellation notice sent to responders.");
          setShowAlert(true);
        } else if (queuedOutcome === 'not_found') {
          setAlertMessage("Alert had already synced earlier. Cancellation notice sent now.");
          setShowAlert(true);
        } else {
          setAlertMessage("The panic alert has been cancelled.");
          setShowAlert(true);
        }
      } catch (error) {
        console.error("Failed to send panic cancellation:", error);
        if (queuedOutcome === 'removed') {
          setAlertMessage("Queued alert removed locally, but cancellation failed to reach the server. Please retry.");
          setShowAlert(true);
        } else {
          setErrorMessage("Failed to notify the server about the cancellation. Please try again.");
        }
      } finally {
        setIsPanicMode(false);
        setIsRecording(false);
        setForwardedServices(null);
      }
    } else {
      if (queuedOutcome === 'removed') {
        setAlertMessage("Queued SOS alert cancelled. It will not be sent when you're back online.");
      } else if (queuedOutcome === 'not_found') {
        setAlertMessage("Alert likely already reached responders. We'll send the cancellation once you're connected.");
      } else {
        setAlertMessage("You're offline. Cancellation will be sent once connectivity returns.");
      }
      setShowAlert(true);
      setIsPanicMode(false);
      setIsRecording(false);
      setForwardedServices(null);
    }
  };

  // Navigation helpers: start/stop with validation and small position bump to trigger map updates
  const startNavigation = () => {
    if (!safeRoute || safeRoute.length === 0) {
      setAlertMessage('Find a safe route first.');
      setShowAlert(true);
      return;
    }
    // Force a tiny refresh of currentPosition so Map components that depend on it re-render/pan
    const lastPos = currentPositionRef.current;
    if (lastPos) {
      setCurrentPosition({ latitude: lastPos.latitude, longitude: lastPos.longitude });
    }
    setRealTimeTracking(true);
  };

  const stopNavigation = () => {
    setRealTimeTracking(false);
  };

  // On first load, try to restore session from cookie via backend
  useEffect(() => {
    const restoreSession = async () => {
      setSessionChecking(true);
      
      // First, check if we have a women user in localStorage
      try {
        const womenUserStr = localStorage.getItem('WOMEN_USER');
        if (womenUserStr) {
          const womenUserData = JSON.parse(womenUserStr);
          if (womenUserData && womenUserData.email) {
            // Restore women user session
            setLoggedInUserName(womenUserData.name || womenUserData.email);
            setUserToken("session");
            setServiceType('women_safety');
            try { localStorage.setItem('SERVICE_TYPE', 'women_safety'); } catch {}
            console.log('[Session] Restored women user session:', womenUserData.email);
            setSessionChecking(false);
            return; // Don't check regular auth endpoint for women users
          }
        }
      } catch (err) {
        console.warn('[Session] Error restoring women user:', err);
      }
      
      // If not a women user, try regular session restore
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v1/auth/me`, {
          withCredentials: true,
        });
        if (res && res.data && res.data.passportId) {
          setPassportId(res.data.passportId);
          setLoggedInUserName(res.data.name || "");
          // profile picture URL (if needed) is handled by the sidebar fetch effect
          // Set a simple truthy token so UI treats user as logged in
          setUserToken("session");
          // ensure serviceType is restored
          if (res.data.serviceType || res.data.service_type) {
            const svc = res.data.serviceType || res.data.service_type;
            setServiceType(svc);
            try { localStorage.setItem('SERVICE_TYPE', svc); } catch {}
          }
          // Fetch sidebar avatar immediately after session restore
          const svcTypeForAvatar = res.data.serviceType || res.data.service_type;
          try { await fetchSidebarAvatar(res.data.passportId, svcTypeForAvatar); } catch {}
        }
      } catch (err) {
        // Not authenticated or error - keep user on auth flow
        console.debug(
          "No active session found:",
          err?.response?.status || err?.message
        );
      } finally {
        setSessionChecking(false);
      }
    };
    restoreSession();
  }, [fetchSidebarAvatar]);

  // As an extra guard, when userToken becomes available and we have a passportId or women user,
  // ensure the sidebar avatar is loaded (covers edge timing after reloads)
  useEffect(() => {
    if (userToken && (!sidebarProfileImageUrl || sidebarProfileImageUrl.includes('default-avatar'))) {
      // Check if tourist user or women user
      if (serviceType === 'women_safety') {
        fetchSidebarAvatar(null, 'women_safety');
      } else if (passportId) {
        fetchSidebarAvatar(passportId, serviceType);
      }
    }
  }, [userToken, passportId, serviceType, sidebarProfileImageUrl, fetchSidebarAvatar]);

  useEffect(() => {
    const fetchSafetyScore = async () => {
      if (currentPosition) {
        try {
          const response = await axios.post(
            `${BACKEND_URL}/api/v1/safety/score`,
            {
              latitude: currentPosition.latitude,
              longitude: currentPosition.longitude,
              passportId: passportId,
            }
          );
          setSafetyScore(response.data.score);
        } catch (error) {
          console.error("Error fetching safety score:", error);
        }
      }
    };

  // Fetch immediately, then on interval
  fetchSafetyScore();
  const scoreInterval = setInterval(fetchSafetyScore, 60000); // Fetch every minute

  return () => clearInterval(scoreInterval);
  }, [currentPosition, passportId]);

  useEffect(() => {
    if (userToken) {
      fetchGroupInfo();
    }
  }, [userToken, fetchGroupInfo]);

  useEffect(() => {
    if (!userToken || !serviceType) {
      return;
    }
    try {
      const desiredPath = `/dashboard/${serviceType}`;
      const currentPath = window.location.pathname;
      if (currentPath !== desiredPath) {
        window.history.replaceState(null, '', desiredPath);
      }
    } catch (navErr) {
      console.warn('[navigation] Failed to sync dashboard route:', navErr);
    }
  }, [userToken, serviceType]);

  useEffect(() => {
    if (!userToken || !passportId) {
      if (socketRef.current) {
        try { socketRef.current.disconnect(); } catch (_) {}
        socketRef.current = null;
      }
      return;
    }

    const clientType = serviceType === 'women_safety' ? 'women' : 'tourist';
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      auth: {
        clientType,
        passportId,
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to WebSocket server!');
      socket.emit('identify', passportId);
    });

    socket.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err?.message || err);
    });

    socket.on("dislocationAlert", (alertData) => {
      console.log("Received Dislocation Alert:", alertData);
      const handled = presentDislocationAlert(alertData);
      if (!handled) {
        console.log(
          "[dislocationAlert] Alert ignored (snoozed, proximate, or invalid)."
        );
      }
    });

    socket.on("geoFenceAlert", (alertData) => {
      console.log("Received Geo-Fence Alert:", alertData);
      if (presentDislocationAlert(alertData)) {
        return;
      }
      setGeoAlertData(alertData);
      setShowGeoAlert(true);
    });

    // If server asks to cancel panic mode (admin reset or cancel), stop local recording
    socket.on("cancelPanicMode", (data) => {
      console.log("Received cancelPanicMode:", data);
      if (data && data.passportId && data.passportId === passportId) {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          try {
            mediaRecorderRef.current.stop();
            // backend finalization now happens via HTTP upload on onstop
          } catch (e) {
            console.warn('Error stopping media recorder on cancel:', e && e.message);
          }
        }
        setIsPanicMode(false);
      }
    });

    // Live location updates from other group members
    socket.on('locationUpdate', (loc) => {
      try {
        if (!loc || !loc.passport_id) return;
        // Update groupInfo.members if this member exists
        setGroupInfo(prev => {
          if (!prev || !Array.isArray(prev.members)) return prev;
          const updated = prev.members.map(m => {
            const pid = m.passport_id || m.passportId;
            if (pid === loc.passport_id) {
              return { ...m, latitude: loc.latitude, longitude: loc.longitude, status: loc.status || m.status };
            }
            return m;
          });
          return { ...prev, members: updated };
        });
        // If the update is for the current user but arrived via socket (e.g., another tab), update currentPosition
        if (loc.passport_id === passportId && loc.latitude != null && loc.longitude != null) {
          setCurrentPosition({ latitude: loc.latitude, longitude: loc.longitude });
          currentPositionRef.current = { latitude: loc.latitude, longitude: loc.longitude };
        }
      } catch (e) {
        console.warn('Failed to process locationUpdate socket event', e && e.message);
      }
    });

    // Also react to statusUpdate events: if status becomes active for this user, stop recording
    socket.on("statusUpdate", (update) => {
      if (update && update.passport_id && update.passport_id === passportId) {
        if (update.status === "active") {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            try {
              mediaRecorderRef.current.stop();
              // backend finalization now happens via HTTP upload on onstop
            } catch (e) {
              console.warn('Error stopping media recorder on statusUpdate:', e && e.message);
            }
          }
          setIsPanicMode(false);
        }
      }
    });

    // Capture authority dispatch events for this tourist
    socket.on('emergencyResponseDispatched', (payload) => {
      if (payload && payload.passport_id === passportId) {
        setForwardedServices(payload.services || {});
        setAlertMessage(prev => {
          const base = prev && prev.trim().length ? prev : 'Your alert has been forwarded.';
            const names = Object.values(payload.services || {}).map(s => s && s.name).filter(Boolean).join(', ');
          return names ? `${base}\nAuthorities: ${names}` : base;
        });
        setShowAlert(true);
      }
    });

    // Helper to send location to backend (used by watcher and heartbeat)
    const sendLocationUpdate = (latitude, longitude, accuracy) => {
      const pidLive = passportIdRef.current;
      if (!pidLive) return; // require identity
      // During panic mode, always send regardless of user toggle
      if (!isPanicMode && !isLiveLocationEnabled) return;
      try {
        setLocationSharingStatus('sending');
        offlineLocationTracker.setIdentity(pidLive);
        offlineLocationTracker.storeLocation({ latitude, longitude, accuracy, source: 'watch' });
        if (navigator.onLine) {
          setLocationSharingStatus('syncing');
          offlineLocationTracker.syncPendingData().then(() => {
            setLocationSharingStatus('idle');
          }).catch(() => {
            setLocationSharingStatus('error');
          });
        } else {
          setLocationSharingStatus('offline');
        }
      } catch (err) {
        console.error("Failed to queue location:", err?.message || err);
        setLocationSharingStatus('error');
      }
    };

    // Initial high-accuracy one-shot before starting watch (reduces stale cached IP-based value)
    if (navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function') {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          console.log('[geolocation:init] One-shot position', { latitude, longitude, accuracy });
            if (maybeUpdatePosition(latitude, longitude, accuracy)) {
              fetchLocationName(currentPositionRef.current.latitude, currentPositionRef.current.longitude);
              sendLocationUpdate(currentPositionRef.current.latitude, currentPositionRef.current.longitude, accuracy);
            }
        },
        (err) => console.warn('[geolocation:init] getCurrentPosition error', err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    }

    // Start watching position (if available)
    let watchId = null;
    if (navigator.geolocation && typeof navigator.geolocation.watchPosition === 'function') {
      try {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            console.log('[geolocation:watch] Raw update', { latitude, longitude, accuracy });
            if (maybeUpdatePosition(latitude, longitude, accuracy)) {
              fetchLocationName(currentPositionRef.current.latitude, currentPositionRef.current.longitude);
              sendLocationUpdate(currentPositionRef.current.latitude, currentPositionRef.current.longitude, accuracy);
            }
          },
          (error) => console.error('Error getting location (watchPosition):', error),
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
        );
      } catch (err) {
        console.warn('watchPosition failed, falling back to heartbeat-only mode:', err);
      }
    }

    // Heartbeat: ensure backend receives the user's last-known location even when it doesn't change
    const HEARTBEAT_MS = 30000; // 30s
    const heartbeatId = setInterval(() => {
      const pos = currentPositionRef.current;
      if (pos && pos.latitude != null && pos.longitude != null) {
        // queue the last-known position; sync if online
        sendLocationUpdate(pos.latitude, pos.longitude, pos.accuracy);
        return;
      }

      // If we don't have a last-known pos (or watchPosition didn't run), try a quick getCurrentPosition
      if (navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function') {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            if (maybeUpdatePosition(latitude, longitude, accuracy)) {
              fetchLocationName(currentPositionRef.current.latitude, currentPositionRef.current.longitude);
              sendLocationUpdate(currentPositionRef.current.latitude, currentPositionRef.current.longitude, accuracy);
            }
          },
          (err) => console.error('Heartbeat getCurrentPosition failed', err),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );
      }
    }, HEARTBEAT_MS);
    return () => {
      try {
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
      } catch (e) {
        // ignore
      }
      clearInterval(heartbeatId);
      if (socketRef.current) socketRef.current.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- socket/geolocation lifecycle managed manually
  }, [
    userToken,
    passportId,
    serviceType,
    presentDislocationAlert,
    submitDislocationResponse,
  ]);

  // Geolocation tracking for women users (no passportId, uses email/aadhaar)
  useEffect(() => {
    if (serviceType !== 'women_safety' || !userToken) return;

    console.log('[Women Geolocation] Starting location tracking for women user');

    // Helper to update position with smoothing
    const maybeUpdateWomenPosition = (lat, lng, acc) => {
      const prev = currentPositionRef.current;
      if (!prev) {
        const newPos = { latitude: lat, longitude: lng, accuracy: acc };
        setCurrentPosition(newPos);
        currentPositionRef.current = newPos;
        return true;
      }
      const dist = Math.sqrt((lat - prev.latitude) ** 2 + (lng - prev.longitude) ** 2);
      if (dist < 0.0001 && Math.abs(acc - (prev.accuracy || 0)) < 5) return false;
      const smoothLat = prev.latitude * 0.3 + lat * 0.7;
      const smoothLon = prev.longitude * 0.3 + lng * 0.7;
      const newPos = { latitude: smoothLat, longitude: smoothLon, accuracy: acc };
      setCurrentPosition(newPos);
      currentPositionRef.current = newPos;
      return true;
    };

    // Initial position
    if (navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function') {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          console.log('[Women Geolocation] Initial position:', { latitude, longitude, accuracy });
          maybeUpdateWomenPosition(latitude, longitude, accuracy);
          fetchLocationName(latitude, longitude);
        },
        (err) => console.warn('[Women Geolocation] Initial getCurrentPosition error', err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    }

    // Watch position continuously
    let watchId = null;
    if (navigator.geolocation && typeof navigator.geolocation.watchPosition === 'function') {
      try {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            console.log('[Women Geolocation] Position update:', { latitude, longitude, accuracy });
            if (maybeUpdateWomenPosition(latitude, longitude, accuracy)) {
              fetchLocationName(latitude, longitude);
            }
          },
          (error) => console.error('[Women Geolocation] watchPosition error:', error),
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
        );
      } catch (err) {
        console.warn('[Women Geolocation] watchPosition failed:', err);
      }
    }

    // Heartbeat to ensure continuous location updates
    const heartbeatId = setInterval(() => {
      const pos = currentPositionRef.current;
      if (pos && pos.latitude != null && pos.longitude != null) {
        console.log('[Women Geolocation] Heartbeat with existing position:', pos);
        return;
      }

      // Try to get position if we don't have one
      if (navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function') {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            console.log('[Women Geolocation] Heartbeat position:', { latitude, longitude, accuracy });
            if (maybeUpdateWomenPosition(latitude, longitude, accuracy)) {
              fetchLocationName(latitude, longitude);
            }
          },
          (err) => console.error('[Women Geolocation] Heartbeat getCurrentPosition failed', err),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );
      }
    }, 30000); // 30 seconds

    return () => {
      console.log('[Women Geolocation] Cleaning up location tracking');
      try {
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
      } catch (e) {
        console.warn('[Women Geolocation] Error clearing watch:', e);
      }
      clearInterval(heartbeatId);
    };
  }, [userToken, serviceType, fetchLocationName]);

  // Fetch persisted forwarded services (if any) once passportId & token are ready
  useEffect(() => {
    if (!userToken || !passportId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v1/alerts/${passportId}/forwarded-services`);
        if (!cancelled && res.data && res.data.services) {
          setForwardedServices(res.data.services);
        }
      } catch (e) { /* not forwarded yet */ }
    })();
    return () => { cancelled = true; };
  }, [userToken, passportId]);

  // Re-identify the socket when passportId changes (in case identify wasn't set yet)
  useEffect(() => {
    if (socketRef.current && passportId) {
      try {
        socketRef.current.emit('identify', passportId);
        console.log('Re-emitted identify for passportId', passportId);
      } catch (e) {
        console.warn('Failed to emit identify on passportId change', e && e.message);
      }
    }
  }, [passportId]);

  // ...existing code...

  const handleCreateGroup = async () => {
    if (!newGroupName) {
      setErrorMessage("Please enter a group name.");
      return;
    }
    try {
      await axios.post(`${BACKEND_URL}/api/v1/groups/create`, {
        groupName: newGroupName,
        passportId,
      });
      await fetchGroupInfo();
      setNewGroupName("");
      setAlertMessage("Group created successfully!");
      setShowAlert(true);
    } catch (error) {
      console.error("Error creating group:", error);
      setErrorMessage("Failed to create group.");
    }
  };

  const handleInviteMember = async () => {
    if (!inviteEmail) {
      setErrorMessage("Please enter an email to invite.");
      return;
    }
    if (!groupInfo || !groupInfo.group_id) {
      setErrorMessage("Cannot send invite: Group ID is missing.");
      console.error(
        "Attempted to invite without a valid groupInfo object:",
        groupInfo
      );
      return;
    }
    try {
      setInviteLoading(true);
      await axios.post(`${BACKEND_URL}/api/v1/groups/invite`, { groupId: groupInfo.group_id, inviteeEmail: inviteEmail });
      setInviteEmail("");
      setAlertMessage("Invitation sent!");
      setShowAlert(true);
    } catch (error) {
      console.error("Error sending invite:", error);
      setErrorMessage(
        error.response?.data?.message || "Failed to send invite."
      );
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCancelInvite = async (email) => {
    if (!groupInfo?.group_id) return;
    try {
      await axios.post(`${BACKEND_URL}/api/v1/groups/cancel-invite`, { groupId: groupInfo.group_id, inviteeEmail: email });
      setAlertMessage('Invitation cancelled');
      setShowAlert(true);
      // Optimistic: remove pending member with that email (if present)
      setGroupInfo(prev => {
        if (!prev) return prev;
        const updated = (prev.members || []).filter(m => m.email !== email || m.status !== 'pending');
        return { ...prev, members: updated };
      });
    } catch (e) {
      setErrorMessage(e.response?.data?.message || 'Failed to cancel invitation');
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupInfo?.group_id) return;
    if (!window.confirm('Delete this group? This cannot be undone.')) return;
    try {
      setGroupActionLoading(true);
      await axios.post(`${BACKEND_URL}/api/v1/groups/delete`, { groupId: groupInfo.group_id, passportId });
      setGroupInfo(null);
      setAlertMessage('Group deleted.');
      setShowAlert(true);
    } catch (e) {
      setErrorMessage(e.response?.data?.message || 'Failed to delete group');
    } finally {
      setGroupActionLoading(false);
    }
  };

  const handleAcceptInvite = async (groupId) => {
    try {
      await axios.post(`${BACKEND_URL}/api/v1/groups/accept-invite`, {
        passportId: passportId,
        groupId: groupId,
      });
      setAlertMessage("You have joined the group!");
      setShowAlert(true);
      setPendingInvites([]);
      await fetchGroupInfo();
    } catch (error) {
      console.error("Error accepting invite:", error);
      setErrorMessage(error.response?.data?.message || "Failed to join group.");
    }
  };

  /* =============================
     Theme handling (light / dark)
     ============================= */
  // Theme handling: retain persisted preference but we no longer need state if no toggle here
  const initialTheme = (() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('THEME_MODE');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return 'light';
  })();
  useEffect(() => {
    const body = document.body;
    if (initialTheme === 'dark') body.setAttribute('data-theme','dark'); else body.removeAttribute('data-theme');
  }, [initialTheme]);

  // Auto-night previously introduced a dark mode; keep the dashboard light-only for now.
  useEffect(() => {
    const body = document.body;
    body.classList.remove('auto-night');
    return () => body.classList.remove('auto-night');
  }, []);

  // (toggleTheme removed – family view currently not exposing manual theme toggle here)
  
  // Clear hash when authenticated to avoid conflicts with BrowserRouter
  useEffect(() => {
    if (userToken) {
      try { window.location.hash = ''; } catch {}
    }
  }, [userToken]);

  // After login, route to service-specific dashboard path for clarity
  useEffect(() => {
    if (typeof window !== 'undefined' && userToken && serviceType) {
      const target = `/dashboard/${serviceType}`;
      if (window.location.pathname === '/' || window.location.pathname === '') {
        try { window.history.replaceState(null, '', target); } catch {}
      }
    }
  }, [userToken, serviceType]);

  // Family routes take precedence over tourist auth when hash matches
 if (route === '/login/family') {
    return (
      <div className="App">
        <FamilyLogin 
          onSuccess={() => go('/family-dashboard')}
          onBack={() => go('')}
          serviceType={serviceType || 'general_safety'}
          setServiceType={setServiceType}
          fetchFamilyInfo={async () => {
            try {
              const res = await axios.get(`${BACKEND_URL}/api/family/info`, { withCredentials: true });
              return res.data;
            } catch {
              return null;
            }
          }}
        />
      </div>
    );
  }
  if (route === '/family-dashboard') {
    return (
      <div className="App">
        <div className="app-container">
          <header className="app-header card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="/logo.png" alt="logo" className="app-logo" />
              <div>
                <h1 className="app-title">Family Dashboard</h1>
                <p className="muted">View your tourist's safety status</p>
              </div>
            </div>
            <div>
              <button className="logout-button" onClick={() => { localStorage.removeItem('FAMILY_TOKEN'); go('/login/family'); }}>Logout</button>
            </div>
          </header>
          <FamilyDashboard />
        </div>
      </div>
    );
  }

  if (route === '/report-incident') {
    return (
      <div className="App">
        <div className="app-container">
          <header className="app-header card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="/logo.png" alt="logo" className="app-logo" />
              <div>
                <h1 className="app-title">Report Incident</h1>
                <p className="muted">Women safety, street animals, fire, medical and more</p>
              </div>
            </div>
            <div>
              <button className="logout-button" onClick={() => { window.location.hash = ''; }}>Close</button>
            </div>
          </header>
          <ReportIncident onDone={() => { window.location.hash = ''; }} />
        </div>
      </div>
    );
  }

  if (sessionChecking) {
    return (
      <div className="App">
        <div className="app-container" style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
          <div className="card" style={{ padding:24, textAlign:'center' }}>
            <div className="spinner" style={{ marginBottom:12 }} />
            <div>Restoring your session…</div>
          </div>
        </div>
      </div>
    );
  }

  if (!userToken) {
    return (
      <div className="App">
        {showAlert && (
          <AlertModal message={alertMessage} onClose={handleCloseAlert} />
        )}

        {authState === "register" && (
            <ServiceRegistration
              onSuccess={(data) => {
                // After successful registration and OTP verification, transition to login
                if (data && data.email) {
                  setEmail(data.email);
                }
                if (data && data.passportId) {
                  setPassportId(data.passportId);
                }
                if (data && data.service_type) {
                  setServiceType(data.service_type);
                  try { localStorage.setItem('SERVICE_TYPE', data.service_type); } catch {}
                }
                // User is registered and verified, prompt them to login
                setAlertMessage('Registration successful! Please login with your credentials.');
                setShowAlert(true);
                setAuthState('login');
              }}
              onSwitchToLogin={() => setAuthState('login')}
            />
        )}

        {authState === "verifyEmail" && (
          <EmailVerification
            email={email}
            passportId={passportId}
            code={code}
            setCode={setCode}
            onVerifyEmail={handleVerifyEmail}
            errorMessage={errorMessage}
          />
        )}

        {authState === "login" || authState === "verifyOtp" ? (
          <Login
            onLogin={handleLogin}
            onVerifyOtp={handleVerifyOtp}
            onSwitchToRegister={() => setAuthState("register")}
            onSwitchToFamily={() => go('/login/family')}
            errorMessage={errorMessage}
            loadingLogin={loadingLogin}
            email={email}
            setEmail={setEmail}
            passportId={passportId}
            otp={otp}
            setOtp={setOtp}
            authState={authState}
            serviceType={serviceType || 'general_safety'}
            setServiceType={setServiceType}
            fetchProfile={async () => {
              try {
                const res = await axios.get(`${BACKEND_URL}/api/v1/auth/me`, { withCredentials: true });
                if (res?.data) {
                  return {
                    ...res.data,
                    service_type: res.data.serviceType || res.data.service_type,
                  };
                }
              } catch (err) {
                console.warn('[App] fetchProfile fallback failed:', err?.response?.status || err?.message || err);
              }
              return null;
            }}
          />
        ) : null}
      </div>
    );
  }

  // MAIN AUTHENTICATED APP VIEW WITH ROUTER
  const headerNode = (
    <header className={`app-header card${isTouristDashboard ? ' tourist-navbar' : ''}`}>
      <div className="brand navbar-brand">
        <img src="/logo.png" alt="logo" className="app-logo navbar-logo" />
        <div className="navbar-title-group">
          <h1 className="app-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {(() => {
              switch (serviceType) {
                case 'women_safety': return 'Women Safety';
                case 'tourist_safety': return 'Tourist Safety';
                case 'citizen_safety': return 'Citizen Safety';
                case 'animal_safety': return 'Animal Safety';
                case 'general_safety':
                default: return 'Safety Dashboard';
              }
            })()}
          </h1>
          <p className="muted navbar-subtitle">Your safety companion on the go</p>
        </div>
      </div>

      <div className="user-actions navbar-user-actions">
        {isTouristDashboard && (
          <button
            type="button"
            className={`navbar-panic-button${isPanicMode ? ' navbar-panic-button--active' : ''}`}
            onClick={isPanicMode ? handleCancelPanic : handlePanic}
            disabled={loadingPanic}
            title={isPanicMode ? 'Cancel active SOS alert' : 'Trigger emergency SOS'}
          >
            {loadingPanic ? 'Processing…' : (isPanicMode ? 'Cancel SOS' : 'SOS Panic')}
          </button>
        )}
        <button
          aria-label="Open profile"
          onClick={() => setIsProfileOpen(true)}
          className="navbar-profile-btn"
          title="My Profile"
        >
          <div className="pf-avatar navbar-avatar" aria-label="Profile avatar">{initials}</div>
          <div className="navbar-passport-id">{
            (() => {
              const svc = (serviceType || '').toLowerCase();
              if (svc === 'women_safety') {
                let name = (loggedInUserName || '').trim();
                if (!name) {
                  try {
                    const raw = localStorage.getItem('WOMEN_USER');
                    if (raw) name = (JSON.parse(raw).name || '').trim();
                  } catch {}
                }
                return name || 'My Profile';
              }
              return passportId;
            })()
          }</div>
        </button>
      </div>
    </header>
  );


  const touristFeatureMenu = isTouristDashboard ? (
    <nav className="tourist-feature-menu" aria-label="Tourist dashboard navigation">
      <div className="tourist-feature-menu__label">Feature Shortcuts</div>
      <ul className="tourist-feature-menu__list">
        {TOURIST_FEATURE_SECTIONS.map((item) => {
          const isActive = touristActivePanel === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`tourist-feature-menu__link${isActive ? ' tourist-feature-menu__link--active' : ''}`}
                onClick={() => setTouristActivePanel(item.id)}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  ) : null;

  const dashboardRoutes = (
    <Switch>
      <Route exact path="/">
        <Redirect to={`/dashboard/${serviceType || 'general_safety'}`} />
      </Route>
      <Route path="/guidance">
        <Guidance />
      </Route>
      <Route path="/dashboard/women_safety">
        {/* Check if women user is authenticated */}
        {(() => {
          const womenUser = localStorage.getItem('WOMEN_USER');
          if (!womenUser) {
            return <WomenAuth onAuthSuccess={(user) => {
              window.location.reload();
            }} />;
          }

          const userData = JSON.parse(womenUser);
          return (
            <>
              <section className="card hero-card" style={{ marginTop: 0 }}>
                <div className="hero-top hero-flex">
                  <div className="hero-info">
                    <h2 style={{ margin: 0, marginBottom: '8px' }}>Live Location</h2>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      flexWrap: 'wrap',
                      marginBottom: '8px',
                      padding: '12px',
                      background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                      borderRadius: '12px',
                      border: '1px solid #bae6fd'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        color: locationSharingStatus === 'error' ? '#dc2626' :
                               locationSharingStatus === 'offline' ? '#f59e0b' :
                               locationSharingStatus === 'syncing' || locationSharingStatus === 'sending' ? '#3b82f6' : '#10b981'
                      }}>
                        <div style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: locationSharingStatus === 'error' ? '#dc2626' :
                                     locationSharingStatus === 'offline' ? '#f59e0b' :
                                     locationSharingStatus === 'syncing' || locationSharingStatus === 'sending' ? '#3b82f6' : '#10b981',
                          animation: (locationSharingStatus === 'syncing' || locationSharingStatus === 'sending') ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none',
                          boxShadow: '0 0 8px currentColor'
                        }} />
                        <span>
                          {locationSharingStatus === 'sending' ? 'Sending...' :
                           locationSharingStatus === 'syncing' ? 'Syncing...' :
                           locationSharingStatus === 'offline' ? 'Queued (Offline)' :
                           locationSharingStatus === 'error' ? 'Error' :
                           isLiveLocationEnabled ? 'Sharing Location' : 'Paused'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto', opacity: isPanicMode ? 0.6 : 1, pointerEvents: isPanicMode ? 'none' : 'auto' }} title={isPanicMode ? 'Location sharing is locked during an active alert' : undefined}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                          Live Sharing
                        </span>
                        <label style={{
                          position: 'relative',
                          display: 'inline-block',
                          width: '56px',
                          height: '32px',
                          cursor: 'pointer',
                          flexShrink: 0
                        }} title={isPanicMode ? 'Location sharing is locked during an active alert' : (isLiveLocationEnabled ? 'Click to pause location sharing' : 'Click to enable location sharing')}>
                          <input
                            type="checkbox"
                            checked={isLiveLocationEnabled}
                            onChange={toggleLiveLocation}
                            style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                          />
                          <span style={{
                            position: 'absolute',
                            inset: 0,
                            background: isLiveLocationEnabled ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#cbd5e1',
                            borderRadius: '32px',
                            transition: 'all 0.3s ease',
                            boxShadow: isLiveLocationEnabled ? '0 2px 8px rgba(16, 185, 129, 0.4)' : 'inset 0 1px 3px rgba(0,0,0,0.1)'
                          }}>
                            <span style={{
                              position: 'absolute',
                              left: isLiveLocationEnabled ? '28px' : '4px',
                              top: '4px',
                              width: '24px',
                              height: '24px',
                              background: 'white',
                              borderRadius: '50%',
                              transition: 'left 0.3s ease',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
                            }} />
                          </span>
                        </label>
                      </div>
                    </div>
                    <p className="muted">We track your location in real-time to keep you safe.</p>
                  </div>
                </div>
              </section>

              <WomenDashboard
                user={{
                  name: userData.name,
                  id: userData.id,
                  email: userData.email,
                  mobileNumber: userData.mobileNumber,
                  aadhaarNumber: userData.aadhaarNumber
                }}
                location={{
                  address: locationName,
                  latitude: currentPosition?.latitude,
                  longitude: currentPosition?.longitude,
                  coords: currentPosition ? {
                    latitude: currentPosition.latitude,
                    longitude: currentPosition.longitude,
                    accuracy: currentPositionRef.current?.accuracy
                  } : null
                }}
              />
            </>
          );
        })()}
      </Route>
      <Route path="/hardware-panic-settings">
        <div className="card" style={{ marginTop: 20 }}>
          <HardwarePanicSettings passportId={passportId} />
        </div>
      </Route>
      <Route path="/dashboard/:svc">
        {(!isTouristDashboard || touristActivePanel === 'live') && (
          <section className={`card hero-card${isTouristDashboard ? ' tourist-hero-card' : ''}`} id="live-location-section">
            {isTouristDashboard ? (
              <div className="tourist-hero">
                <div className="tourist-hero__intro">
                  <div className="tourist-hero__welcome">
                    <h2>Welcome back, {touristDisplayName}!</h2>
                    <p>Your current location: <span>{locationName || 'Detecting location…'}</span></p>
                  </div>
                  <div className="tourist-hero__stats-grid">
                    <article className="tourist-stat-card">
                      <span className="tourist-stat-card__label">Safety Score</span>
                      <span className="tourist-stat-card__value">{safetyScore !== null ? safetyScore : '—'}</span>
                      <span className="tourist-stat-card__hint">Updated every minute</span>
                    </article>
                    <article className="tourist-stat-card">
                      <span className="tourist-stat-card__label">Emergency Contacts</span>
                      <span className="tourist-stat-card__value">{emergencyContactCount}</span>
                      <span className="tourist-stat-card__hint">{emergencyContactCount > 0 ? 'Trusted circle ready' : 'Add your trusted circle'}</span>
                    </article>
                    <article className="tourist-stat-card">
                      <span className="tourist-stat-card__label">Safe Zones Nearby</span>
                      <span className="tourist-stat-card__value">{safeZoneCountLabel}</span>
                      <span className="tourist-stat-card__hint">{nearestSafeZoneLabel}</span>
                    </article>
                    <article className="tourist-stat-card">
                      <span className="tourist-stat-card__label">Last Check-in</span>
                      <span className="tourist-stat-card__value">{lastCheckInLabel}</span>
                      <span className="tourist-stat-card__hint">Auto synced</span>
                    </article>
                  </div>
                </div>

                <div className="tourist-hero__body">
                  <div className="tourist-live-card">
                    <header className="tourist-live-card__header">
                      <div className="tourist-live-card__header-text">
                        <span className="tourist-live-card__heading">Live Location</span>
                        <span className="tourist-live-card__subheading">Last check-in {lastCheckInLabel}</span>
                      </div>
                      <span className={`tourist-live-card__badge tourist-live-card__badge--${liveStatusVariant}`}>
                        {liveStatusLabel}
                      </span>
                    </header>

                    <div className="tourist-live-card__status-bar">
                      <div
                        className="tourist-live-card__status-indicator"
                        style={{ background: locationStatusColor, boxShadow: `0 0 12px ${locationStatusColor}` }}
                      />
                      <div className="tourist-live-card__status-text">
                        {locationSharingStatus === 'sending' ? 'Sending…' :
                         locationSharingStatus === 'syncing' ? 'Syncing…' :
                         locationSharingStatus === 'offline' ? 'Queued (Offline)' :
                         locationSharingStatus === 'error' ? 'Error' :
                         isLiveLocationEnabled ? 'Sharing Location' : 'Paused'}
                      </div>
                      <div className="tourist-live-card__status-toggle" title={isPanicMode ? 'Location sharing is locked during an active alert' : undefined}>
                        <span className="tourist-live-card__toggle-label">Live Sharing</span>
                        <label className={`tourist-live-card__toggle${isLiveLocationEnabled ? ' tourist-live-card__toggle--on' : ''}${isPanicMode ? ' tourist-live-card__toggle--disabled' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isLiveLocationEnabled}
                            onChange={toggleLiveLocation}
                            disabled={isPanicMode}
                          />
                          <span />
                        </label>
                      </div>
                    </div>
                    <p className="tourist-live-card__helper">We track your location in real-time to keep you safe.</p>

                    <div className="tourist-live-card__map-shell">
                      <div className="tourist-live-card__map">
                        <div className="tourist-live-card__location-header">
                          <span className="tourist-live-card__location-title">Map View</span>
                          <span className="tourist-live-card__location-subtitle">{locationName || 'Getting your location…'}</span>
                        </div>
                        {currentPosition ? (
                          <>
                            <div className="dashboard-map-wrapper">
                              <Map
                                userPosition={currentPosition}
                                groupMembers={serviceType === 'women_safety' ? [] : groupInfo?.members?.filter((m) => m.passport_id !== passportId)}
                                route={safeRoute}
                                realTimeTracking={realTimeTracking}
                                isMapEnlarged={false}
                              />
                            </div>
                            <div className="dashboard-map-actions">
                              <button
                                onClick={() => (realTimeTracking ? stopNavigation() : startNavigation())}
                                className="primary-button"
                                disabled={!safeRoute || safeRoute.length === 0}
                                title={!safeRoute || safeRoute.length === 0 ? 'Find a safe route first' : (realTimeTracking ? 'Stop Navigation' : 'Start Navigation')}
                              >
                                {realTimeTracking ? 'Stop Navigation' : 'Start Navigation'}
                              </button>
                              <button
                                onClick={() => setIsMapEnlarged(true)}
                                className="primary-button"
                              >
                                Enlarge Map
                              </button>
                            </div>

                            {isMapEnlarged && (
                              <div className="tourist-map-overlay">
                                <div className="tourist-map-overlay__panel">
                                  <div className="tourist-map-overlay__header">
                                    <div className="tourist-map-overlay__title">Map - Navigation</div>
                                    <div className="tourist-map-overlay__actions">
                                      <button className="primary-button" onClick={() => (realTimeTracking ? stopNavigation() : startNavigation())}>{realTimeTracking ? 'Stop Navigation' : 'Start Navigation'}</button>
                                      <button className="primary-button" onClick={() => setIsMapEnlarged(false)}>Close</button>
                                    </div>
                                  </div>
                                  <div className="tourist-map-overlay__body">
                                    <Map
                                      userPosition={currentPosition}
                                      groupMembers={serviceType === 'women_safety' ? [] : groupInfo?.members?.filter((m) => m.passport_id !== passportId)}
                                      route={safeRoute}
                                      realTimeTracking={realTimeTracking}
                                      isMapEnlarged
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="status-text">Getting your location...</p>
                        )}
                      </div>
                    </div>

                    <div className="tourist-live-card__summary">
                      <div className="tourist-live-card__summary-item">
                        <span>Destination</span>
                        <strong>{destinationSummaryLabel}</strong>
                      </div>
                      <div className="tourist-live-card__summary-item">
                        <span>Distance</span>
                        <strong>{destinationDistanceLabel}</strong>
                      </div>
                      <div className="tourist-live-card__summary-item">
                        <span>Last Check-in</span>
                        <strong>{lastCheckInLabel}</strong>
                      </div>
                    </div>

                    <div className="tourist-live-card__destination">
                      <div className="tourist-live-card__destination-header">
                        <span>Plan your next move</span>
                        <small>Find the safest path to your next stop</small>
                      </div>
                      <div className="tourist-live-card__destination-input">
                        <input
                          id="destination-search"
                          ref={destInputRef}
                          type="text"
                          value={destinationQuery || ''}
                          onChange={handleDestinationInput}
                          onFocus={() => setDestinationInputFocused(true)}
                          onBlur={() => setTimeout(() => setDestinationInputFocused(false), 200)}
                          placeholder="Enter destination (address, place, landmark)"
                          autoComplete="off"
                        />
                        {(destinationInputFocused && destinationQuery.length >= 2) && (
                          <ul className="suggestions-list">
                            {destinationSuggestions.length > 0 ? (
                              destinationSuggestions.map((s, idx) => (
                                <li
                                  key={s.place_id || idx}
                                  onClick={() => handleSelectDestination(s)}
                                >
                                  <span className="suggestions-list__primary">{s.formatted || s.name || s.address_line1}</span>
                                  <span className="suggestions-list__secondary">{s.address_line2 || s.city || s.country || ''}</span>
                                </li>
                              ))
                            ) : (
                              <li className="suggestions-list__empty">{destinationError || 'No suggestions found.'}</li>
                            )}
                          </ul>
                        )}
                      </div>
                      <div className="tourist-live-card__destination-actions">
                        <button
                          className="primary-button"
                          onClick={() => {
                            if (destInputRef.current) {
                              destInputRef.current.focus();
                              destInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                            if (selectedDestination) {
                              findSafeRoute(selectedDestination);
                            } else {
                              setAlertMessage('Please select a destination from suggestions.');
                              setShowAlert(true);
                            }
                          }}
                        >
                          Find Safe Route
                        </button>
                        <button
                          type="button"
                          className="tourist-live-card__secondary"
                          onClick={() => setTouristActivePanel('nearby')}
                        >
                          Explore Area
                        </button>
                      </div>
                    </div>

                    {forwardedServices && isPanicMode && (
                      <div className="tourist-live-card__alert">
                        <strong>Authorities Notified:</strong>{' '}
                        {Object.values(forwardedServices).map((s) => s && s.name).filter(Boolean).join(', ') || 'Details pending'}
                      </div>
                    )}

                    <div className="tourist-quick-actions">
                      <button
                        type="button"
                        className="tourist-quick-action tourist-quick-action--alert"
                        onClick={isPanicMode ? handleCancelPanic : handlePanic}
                        disabled={loadingPanic}
                      >
                        {isPanicMode ? 'Cancel Alert' : (loadingPanic ? (isOnline ? 'Sending…' : 'Queueing…') : 'Emergency Alert')}
                      </button>
                      <button type="button" className="tourist-quick-action" onClick={forceRefreshLocation}>
                        Share Location
                      </button>
                      <button type="button" className="tourist-quick-action" onClick={() => setTouristActivePanel('support')}>
                        Call Support
                      </button>
                      <button type="button" className="tourist-quick-action" onClick={() => setTouristActivePanel('safety')}>
                        Community Feedback
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="hero-top hero-flex">
                  <div className="hero-info">
                    <h2 style={{ margin: 0, marginBottom: '8px' }}>Live Location</h2>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      flexWrap: 'wrap',
                      marginBottom: '8px',
                      padding: '12px',
                      background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                      borderRadius: '12px',
                      border: '1px solid #bae6fd'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        color: locationSharingStatus === 'error' ? '#dc2626' :
                               locationSharingStatus === 'offline' ? '#f59e0b' :
                               locationSharingStatus === 'syncing' || locationSharingStatus === 'sending' ? '#3b82f6' : '#10b981'
                      }}>
                        <div style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: locationSharingStatus === 'error' ? '#dc2626' :
                                     locationSharingStatus === 'offline' ? '#f59e0b' :
                                     locationSharingStatus === 'syncing' || locationSharingStatus === 'sending' ? '#3b82f6' : '#10b981',
                          animation: (locationSharingStatus === 'syncing' || locationSharingStatus === 'sending') ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none',
                          boxShadow: '0 0 8px currentColor'
                        }} />
                        <span>
                          {locationSharingStatus === 'sending' ? 'Sending...' :
                           locationSharingStatus === 'syncing' ? 'Syncing...' :
                           locationSharingStatus === 'offline' ? 'Queued (Offline)' :
                           locationSharingStatus === 'error' ? 'Error' :
                           isLiveLocationEnabled ? 'Sharing Location' : 'Paused'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto', opacity: isPanicMode ? 0.6 : 1, pointerEvents: isPanicMode ? 'none' : 'auto' }} title={isPanicMode ? 'Location sharing is locked during an active alert' : undefined}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                          Live Sharing
                        </span>
                        <label style={{
                          position: 'relative',
                          display: 'inline-block',
                          width: '56px',
                          height: '32px',
                          cursor: 'pointer',
                          flexShrink: 0
                        }} title={isPanicMode ? 'Location sharing is locked during an active alert' : (isLiveLocationEnabled ? 'Click to pause location sharing' : 'Click to enable location sharing')}>
                          <input
                            type="checkbox"
                            checked={isLiveLocationEnabled}
                            onChange={toggleLiveLocation}
                            style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                          />
                          <span style={{
                            position: 'absolute',
                            inset: 0,
                            background: isLiveLocationEnabled ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#cbd5e1',
                            borderRadius: '32px',
                            transition: 'all 0.3s ease',
                            boxShadow: isLiveLocationEnabled ? '0 2px 8px rgba(16, 185, 129, 0.4)' : 'inset 0 1px 3px rgba(0,0,0,0.1)'
                          }}>
                            <span style={{
                              position: 'absolute',
                              left: isLiveLocationEnabled ? '28px' : '4px',
                              top: '4px',
                              width: '24px',
                              height: '24px',
                              background: 'white',
                              borderRadius: '50%',
                              transition: 'left 0.3s ease',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
                            }} />
                          </span>
                        </label>
                      </div>
                    </div>
                    <p className="muted">We track your location in real-time to keep you safe.</p>
                    <button
                      className="primary-button hero-find-route"
                      onClick={() => {
                        if (destInputRef.current) {
                          destInputRef.current.focus();
                          destInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }}
                    >
                      Find Safe Route
                    </button>
                  </div>
                  <div className="safety-score-display hero-score">
                    <div className="score-label">Your Current Safety Score</div>
                    <div className="score">{safetyScore !== null ? safetyScore : 'N/A'}</div>
                  </div>
                </div>
                {forwardedServices && isPanicMode && (
                  <div style={{ marginTop: 12, background: '#fff8e1', padding: 12, borderRadius: 8, border: '1px solid #facc15' }}>
                    <strong>Authorities Notified:</strong>{' '}
                    {Object.values(forwardedServices).map((s) => s && s.name).filter(Boolean).join(', ') || 'Details pending'}
                  </div>
                )}
                <div className="map-area card-section hero-map-area">
                  {currentPosition ? (
                    <>
                      <div className="location-details">
                        <p>
                          <strong>{locationName}</strong>
                        </p>
                      </div>

                      <div className="dashboard-map-wrapper">
                        <Map
                          userPosition={currentPosition}
                          groupMembers={serviceType === 'women_safety' ? [] : groupInfo?.members?.filter((m) => m.passport_id !== passportId)}
                          route={safeRoute}
                          realTimeTracking={realTimeTracking}
                          isMapEnlarged={false}
                        />
                      </div>

                      <div className="dashboard-map-actions">
                        <button
                          onClick={() => (realTimeTracking ? stopNavigation() : startNavigation())}
                          className="primary-button"
                          disabled={!safeRoute || safeRoute.length === 0}
                          title={!safeRoute || safeRoute.length === 0 ? 'Find a safe route first' : (realTimeTracking ? 'Stop Navigation' : 'Start Navigation')}
                        >
                          {realTimeTracking ? 'Stop Navigation' : 'Start Navigation'}
                        </button>
                        <button
                          onClick={() => setIsMapEnlarged(true)}
                          className="primary-button"
                        >
                          Enlarge Map
                        </button>
                      </div>

                      {isMapEnlarged && (
                        <div style={{
                          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                          background: 'rgba(0,0,0,0.6)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          <div style={{ width: '95%', height: '90%', background: '#fff', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f5f5' }}>
                              <div style={{ fontWeight: 700 }}>Map - Navigation</div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="primary-button" onClick={() => (realTimeTracking ? stopNavigation() : startNavigation())}>{realTimeTracking ? 'Stop Navigation' : 'Start Navigation'}</button>
                                <button className="primary-button" onClick={() => setIsMapEnlarged(false)}>Close</button>
                              </div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <Map
                                userPosition={currentPosition}
                                groupMembers={serviceType === 'women_safety' ? [] : groupInfo?.members?.filter((m) => m.passport_id !== passportId)}
                                route={safeRoute}
                                realTimeTracking={realTimeTracking}
                                isMapEnlarged
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="status-text">Getting your location...</p>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {isTouristDashboard && touristActivePanel === 'support' && (
          <section className="card" id="tourist-support-section">
            <TouristSupportCenter
              backendUrl={BACKEND_URL}
              passportId={passportId}
            />
          </section>
        )}

        {serviceType !== 'women_safety' && (!isTouristDashboard || touristActivePanel === 'group') && (
          <section className="card" id="group-section">
            <h3>Your Group</h3>
            {groupInfo ? (
              <div>
                <h4>{groupInfo.group_name}</h4>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0 12px 0' }}>
                  <button className="primary-button" style={{ background: 'linear-gradient(90deg,#f97316,#ef4444)' }} onClick={handleDeleteGroup} disabled={groupActionLoading}>
                    {groupActionLoading ? 'Deleting…' : 'Delete Group'}
                  </button>
                </div>
                <ul className="member-list" style={{ marginBottom: 12 }}>
                  {(groupInfo.members || []).map((member, index) => (
                    <li key={index} className="member-item" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ flex: 1 }}>{member.name || member.passport_id || 'Member'}{member.status === 'pending' ? ' (pending)' : ''}</span>
                      {member.status === 'pending' && member.email && (
                        <button style={{ padding: '6px 10px', fontSize: '.7rem', background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} onClick={() => handleCancelInvite(member.email)}>Cancel</button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="invite-form" style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Invite member by email"
                  />
                  <button onClick={handleInviteMember} className="primary-button" disabled={inviteLoading}>{inviteLoading ? 'Sending…' : 'Invite'}</button>
                </div>
              </div>
            ) : (
              <div>
                {(pendingInvites || []).length > 0 && (
                  <div className="pending-invites">
                    <h4>Pending Invitations</h4>
                    {(pendingInvites || []).map((invite) => (
                      <div key={invite.group_id} className="invite-item">
                        <span>
                          You've been invited to join <strong>{invite.group_name}</strong>
                        </span>
                        <button onClick={() => handleAcceptInvite(invite.group_id)}>
                          Accept
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <p>You are not in a group yet.</p>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Enter New Group Name"
                />
                <button
                  onClick={handleCreateGroup}
                  className="primary-button"
                >
                  Create Group
                </button>
              </div>
            )}
          </section>
        )}

        {isTouristDashboard && touristActivePanel === 'panic' && (
          <section className="card" id="tourist-panic-panel">
            <h3>Panic Controls</h3>
            <p className="muted" style={{ marginBottom: 16 }}>
              Trigger an alert instantly or review your hardware panic settings. Use the quick actions below for the fastest response.
            </p>
            <div className="panic-panel-grid">
              <div className="panic-panel-card">
                <h4>Instant SOS</h4>
                <p>Send a panic alert to your trusted contacts and command center.</p>
                {isPanicMode ? (
                  <button
                    onClick={handleCancelPanic}
                    className="cancel-button"
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    Cancel Active Alert
                  </button>
                ) : (
                  <button
                    onClick={handlePanic}
                    className="panic-button"
                    style={{ width: '100%', marginTop: 8 }}
                    disabled={loadingPanic}
                  >
                    {loadingPanic ? (isOnline ? 'Sending…' : 'Queueing…') : (isOnline ? 'Trigger Panic Alert' : 'Queue Alert (Offline)')}
                  </button>
                )}
                {/* Offline SOS UI (tourist-only) */}
                {serviceType === 'tourist_safety' && (
                  <div style={{ marginTop: 12 }}>
                    <OfflineSOS passportId={passportId} backendUrl={BACKEND_URL} />
                  </div>
                )}
                {isRecording && (
                  <p className="recording-indicator" style={{ marginTop: 8 }}>◉ Recording audio…</p>
                )}
              </div>
              <div className="panic-panel-card">
                <h4>Hardware Pattern</h4>
                <p>Configure how many button presses activate the hardware panic trigger on your wearable or phone.</p>
                <Link to="/hardware-panic-settings" className="tourist-link-button">
                  Open Hardware Settings
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Safe Zones Map - Tourist Only */}
        {isTouristDashboard && touristActivePanel === 'safezones' && (
          <section className="card" id="tourist-safezones-panel">
            <SafeZonesMap />
          </section>
        )}

        {/* Incident Reporting - Tourist Only */}
        {isTouristDashboard && touristActivePanel === 'incidents' && (
          <section className="card" id="tourist-incidents-panel">
            <TouristIncidentReporting
              backendUrl={BACKEND_URL}
              passportId={passportId}
              currentLocation={currentPosition}
            />
          </section>
        )}

        {/* Safety Score & Alerts - Tourist Only */}
        {isTouristDashboard && touristActivePanel === 'safety' && (
          <section className="card" id="tourist-safety-panel">
            <TouristSafetyScoreAlerts
              backendUrl={BACKEND_URL}
              passportId={passportId}
              currentLocation={currentPosition}
            />
          </section>
        )}

        {isTouristDashboard && touristActivePanel === 'alerts' && (
          <section className="card" id="tourist-alerts-panel">
          </section>
        )}

        {isTouristDashboard && touristActivePanel === 'nearby' && (
          <section className="card" id="tourist-nearby-panel">
            <TouristNearbyAssistance backendUrl={BACKEND_URL} currentLocation={currentPosition} />
          </section>
        )}
      </Route>
    </Switch>
  );

  const rightSidebar = (
    <aside className={`card sidebar${isTouristDashboard ? ' tourist-sidebar' : ''}`} id="panic-controls">
      <div className="tourist-sidebar__profile">
        <div className="tourist-sidebar__avatar-shell">
          <label htmlFor="sidebarProfileImageInput" className="tourist-sidebar__avatar-label">
            <ProfileImage
              relativeUrl={sidebarProfileImageUrl}
              alt="Profile"
              className="profile-picture-large"
              style={{ pointerEvents: 'none' }}
            />
            <input
              id="sidebarProfileImageInput"
              type="file"
              accept="image/jpeg, image/png"
              style={{ display: 'none' }}
              onChange={onSidebarProfileImageChange}
              disabled={sidebarProfileImageUploading}
            />
          </label>
        </div>
        <div className="tourist-sidebar__identity">
          <h3>{loggedInUserName || 'Traveler'}</h3>
          <div className="tourist-sidebar__passport">{passportId}</div>
        </div>
        <ul className="tourist-sidebar__status-list">
          <li className="tourist-sidebar__status tourist-sidebar__status--success">✔ Verified Identity</li>
          <li className={`tourist-sidebar__status${emergencyContactCount > 0 ? ' tourist-sidebar__status--success' : ' tourist-sidebar__status--pending'}`}>
            {emergencyContactCount > 0 ? '✔ Emergency Contacts Ready' : '⚠ Add Emergency Contacts'}
          </li>
          <li className={`tourist-sidebar__status${isLiveLocationEnabled ? ' tourist-sidebar__status--success' : ' tourist-sidebar__status--pending'}`}>
            {isLiveLocationEnabled ? '✔ Location Sharing Active' : '⚠ Location Sharing Paused'}
          </li>
        </ul>
        <button type="button" className="tourist-sidebar__edit" onClick={() => setIsProfileOpen(true)}>
          Edit Profile
        </button>
      </div>

      {serviceType === 'tourist_safety' && (
        <div className="tourist-sidebar__stats">
          <div className="tourist-sidebar__stat">
            <span>{groupInfo?.members?.length || 0}</span>
            <small>Group Members</small>
          </div>
          <div className="tourist-sidebar__stat">
            <span>{(pendingInvites || []).length}</span>
            <small>Invites</small>
          </div>
        </div>
      )}

      {isTouristDashboard && (
        <>
          <div className="tourist-sidebar__safezones">
            <h4>Nearby Safe Zones</h4>
            <ul className="tourist-sidebar__safezones-list">
              {safeZoneSummary.loading ? (
                <li className="tourist-sidebar__safezones-empty">Loading nearby zones…</li>
              ) : safeZoneList.length ? (
                safeZoneList.map((zone) => (
                  <li key={zone.id} className="tourist-sidebar__safezones-item">
                    <span className="tourist-sidebar__safezones-icon" aria-hidden="true">
                      {resolveSafeZoneGlyph(zone.label)}
                    </span>
                    <div className="tourist-sidebar__safezones-text">
                      <strong>{zone.label}</strong>
                      <span>{zone.distanceText}</span>
                    </div>
                  </li>
                ))
              ) : (
                <li className="tourist-sidebar__safezones-empty">No safe zones detected within 5 km.</li>
              )}
            </ul>
          </div>

          <div className="tourist-sidebar__tip">
            <h4>Safety Tip</h4>
            <p>Always share your live location with trusted contacts when exploring new areas.</p>
          </div>
        </>
      )}

      <button
        onClick={forceRefreshLocation}
        className="tourist-sidebar__refresh"
      >
        Refresh Precise Location
      </button>

      <div className="tourist-sidebar__panic">
        {showHardwarePanicProgress && (
          <div className="tourist-sidebar__panic-progress">
            <div className="tourist-sidebar__panic-progress-title">🔘 Hardware Panic Pattern Detected</div>
            <div className="tourist-sidebar__panic-progress-bar">
              <div style={{ width: `${hardwarePanicProgress}%` }} />
            </div>
          </div>
        )}

        {isPanicMode ? (
          <button
            onClick={handleCancelPanic}
            className="cancel-button big tourist-sidebar__panic-button"
          >
            Cancel Alert
          </button>
        ) : (
          <button
            onClick={handlePanic}
            className="panic-button big tourist-sidebar__panic-button"
            disabled={loadingPanic}
          >
            {loadingPanic
              ? (isOnline ? 'Sending...' : 'Queueing...')
              : (serviceType === 'women_safety'
                  ? (isOnline ? 'SOS' : 'SOS (Offline)')
                  : (isOnline ? 'PANIC' : 'PANIC (Offline)'))}
          </button>
        )}
        {isRecording && (
          <p className="recording-indicator">◉ Recording audio...</p>
        )}
      </div>

      <button onClick={handleLogout} className="logout-button tourist-sidebar__logout">
        Logout
      </button>
    </aside>
  );
  return (
    <Router>
    <div className="App">
      {showAlert && (
        <AlertModal message={alertMessage} onClose={handleCloseAlert} />
      )}
      {dislocationPrompts.length > 0 && (
        <div className="dislocation-prompt-stack">
          {dislocationPrompts.map((prompt) => (
            <div key={prompt.id} className="dislocation-prompt-card">
              <div className="dislocation-prompt-title">Group Dislocation Alert</div>
              <p className="dislocation-prompt-body">
                {prompt.dislocatedMember} is approximately&nbsp;
                <strong>{prompt.distance || 'unknown'}</strong>&nbsp;km away from&nbsp;
                <strong>{prompt.otherMember}</strong>.
              </p>
              {prompt.groupName && (
                <p className="dislocation-prompt-meta">Group: {prompt.groupName}</p>
              )}
              <p className="dislocation-prompt-question">Are you aware of this separation?</p>
              <div className="dislocation-prompt-actions">
                <button
                  type="button"
                  className="dislocation-btn dislocation-btn-no"
                  onClick={() => handleDislocationResponse('no', prompt)}
                >
                  No
                </button>
                <button
                  type="button"
                  className="dislocation-btn dislocation-btn-yes"
                  onClick={() => handleDislocationResponse('yes', prompt)}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="dislocation-btn dislocation-btn-view"
                  onClick={() => {
                    setGeoAlertData(prompt);
                    setShowGeoAlert(true);
                  }}
                >
                  View Map
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showGeoAlert && (
        <GeoFenceAlertModal
          alertData={geoAlertData}
          userPosition={currentPosition}
          onClose={handleCloseGeoAlert}
          onResponse={handleDislocationResponse}
        />
      )}
      <div className={`app-container${isTouristDashboard ? ' tourist-shell' : ''}`}>
        {!isTouristDashboard && <Orbits />}

        {isProfileOpen && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
            }}
            onClick={() => setIsProfileOpen(false)}
          >
            <div
              className="card"
              style={{ width: 'min(900px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>My Profile</h2>
                <button className="primary-button" onClick={() => setIsProfileOpen(false)}>Close</button>
              </div>
              <ProfileForm
                backendUrl={BACKEND_URL}
                initialEmail={email}
                initialPassportId={passportId}
                activeServiceType={serviceType}
              />
            </div>
          </div>
        )}

        {isTouristDashboard ? (
          <div className="tourist-dashboard-bg">
            {headerNode}
            <div className="tourist-layout">
              <main className="tourist-dashboard-content">
                {touristFeatureMenu}
                {dashboardRoutes}
              </main>
              {/* Always render the right sidebar for all tourist dashboard panels */}
              {rightSidebar}
            </div>
          </div>
        ) : (
          <>
            {headerNode}
            <div className="columns">
              <main>
                {dashboardRoutes}
              </main>
              {rightSidebar}
            </div>
          </>
        )}
      </div>
    </div>
  </Router>
);
}

export default App;
