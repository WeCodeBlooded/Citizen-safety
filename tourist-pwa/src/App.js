
// ...existing code...
import React, { useState, useEffect, useRef, useMemo } from "react";
// Routing additions
import { BrowserRouter as Router, Switch, Route, Link, Redirect } from 'react-router-dom';
import "./App.css";
import axios from "axios";
import AlertModal from "./AlertModal";
import io from "socket.io-client";
import GeoFenceAlertModal from "./GeoFenceAlertModal";
import Map from "./Map";
import FamilyLogin from "./components/FamilyLogin";
import FamilyDashboard from "./components/FamilyDashboard";
import ProfileForm from "./ProfileForm";
import Login from './components/Login';
import EmailVerification from './components/EmailVerification';
import Orbits from './components/Orbits';
import Guidance from './components/Guidance';
import ReportIncident from './components/ReportIncident';
import ServiceRegistration from './components/ServiceRegistration';
import WomenDashboard from './components/WomenDashboard';
import WomenAuth from './components/WomenAuth';
import HardwarePanicSettings from './components/HardwarePanicSettings';
import offlineLocationTracker from "./utils/offlineLocationTracker";
import HardwareButtonDetector from "./services/hardwareButtonDetector";

// Use http for local development (no TLS) to avoid ERR_SSL_PROTOCOL_ERROR.
// You can override the backend URL at runtime by setting localStorage.setItem('BACKEND_URL', '<your-backend>')
// Default backend selection: prefer localhost when running locally.
const FALLBACK_NGROK = "http://localhost:3001";
const DEFAULT_BACKEND =
  (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost')
    ? 'http://localhost:3001'
    : FALLBACK_NGROK;

// Read raw value from localStorage (if present) and sanitize it to avoid
// malformed values like " https://..." which create requests to
// "http://%20https/..." and cause ERR_NAME_NOT_RESOLVED.
let _rawBackend = DEFAULT_BACKEND;
if (typeof window !== 'undefined') {
  try {
    const v = localStorage.getItem('BACKEND_URL');
    if (v) _rawBackend = v;
  } catch (e) {
    // ignore localStorage access errors
  }
}
let BACKEND_URL = (typeof _rawBackend === 'string' ? _rawBackend.trim() : DEFAULT_BACKEND) || DEFAULT_BACKEND;
// Normalize scheme-less or malformed values
if (!/^https?:\/\//i.test(BACKEND_URL)) {
  console.warn('[config] BACKEND_URL lacked protocol, defaulting to', DEFAULT_BACKEND);
  BACKEND_URL = DEFAULT_BACKEND;
}

try {
  const parsed = new URL(BACKEND_URL);
  if (parsed.pathname && parsed.pathname !== '/') {
    console.warn(`[config] BACKEND_URL included path '${parsed.pathname}', trimming to origin.`);
  }
  BACKEND_URL = parsed.origin;
} catch (error) {
  console.warn('[config] Failed to parse BACKEND_URL, resetting to default.', error?.message || error);
  BACKEND_URL = DEFAULT_BACKEND;
}
// If the frontend is being opened from a LAN IP (e.g., 192.168.x.x) and BACKEND_URL still points to localhost,
// remote devices will try to reach their own localhost instead of the dev machine. Automatically rewrite.
try {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalhostBackend = /(^|\b)localhost\b/i.test(BACKEND_URL);
    const isLoopbackFrontend = /^(localhost|127\.0\.0\.1)$/i.test(host);
    if (!isLoopbackFrontend && isLocalhostBackend) {
      const newUrl = `${window.location.protocol}//${host}:3001`;
      console.warn(`[config] Rewriting BACKEND_URL from '${BACKEND_URL}' to '${newUrl}' for LAN access.`);
      BACKEND_URL = newUrl;
    }
  }
} catch (e) {
  // ignore
}
console.log('[config] Using BACKEND_URL =', BACKEND_URL);

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
  const [showGeoAlert, setShowGeoAlert] = useState(false);
  const [geoAlertData, setGeoAlertData] = useState(null);
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
  const [hardwarePanicSettings, setHardwarePanicSettings] = useState(null);
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
  // Dislocation alert suppression: proximity + local snooze
  const DISLOCATION_PROXIMITY_OK_KM = 0.3; // treat as together within 300m
  const DISLOCATION_SNOOZE_MS = 2 * 60 * 1000; // 2 minutes default snooze to match backend 'yes'

  // helpers for snooze persistence
  const getSnoozeKey = (groupName) => `disloc_snooze_${groupName || 'unknown'}`;
  const isGroupSnoozed = (groupName) => {
    try {
      const raw = localStorage.getItem(getSnoozeKey(groupName));
      if (!raw) return false;
      const until = Number(raw);
      if (!until) return false;
      if (Date.now() < until) return true;
      // expired -> cleanup
      localStorage.removeItem(getSnoozeKey(groupName));
      return false;
    } catch { return false; }
  };
  const snoozeGroup = (groupName, ms = DISLOCATION_SNOOZE_MS) => {
    try { localStorage.setItem(getSnoozeKey(groupName), String(Date.now() + ms)); } catch {}
  };

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
        setGroupInfo(safe.group_id ? safe : null);
        if (!safe.group_id) {
          console.warn("Group object received without group_id, treating as no group", data);
        }
        // No need to refresh invites if we have a group
        if (safe.group_id) {
          setPendingInvites([]);
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
  }, [passportId]);


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
      const nextService = responseData.serviceType || serviceType || 'general_safety';
      const nextUserType = responseData.userType || 'tourist';

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
      if (pendingLoginContext?.serviceType) payload.serviceType = pendingLoginContext.serviceType;
      if (pendingLoginContext?.userType) payload.userType = pendingLoginContext.userType;
      const response = await axios.post(
        `${BACKEND_URL}/api/v1/auth/verify-otp`,
        payload
      );
      setPendingLoginContext(null);
      const { token, name, serviceType: svc, userType: verifiedUserType, womenUser } = response.data;
      // Ensure passportId first so downstream effects have it when userToken appears
      const newPid = response.data.passportId || passportId;
      setPassportId(newPid);
      setLoggedInUserName(name);
      setUserToken(token);
      if (svc) {
        setServiceType(svc);
        try { localStorage.setItem('SERVICE_TYPE', svc); } catch {}
      }
      if (verifiedUserType === 'women' && womenUser) {
        try { localStorage.setItem('WOMEN_USER', JSON.stringify(womenUser)); } catch {}
        // Fetch women user avatar
        try { await fetchSidebarAvatar(null, 'women_safety'); } catch {}
      }
      if (verifiedUserType !== 'women') {
        try { await fetchSidebarAvatar(newPid, svc); } catch {}
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

  const handleDislocationResponse = (response) => {
    if (socketRef.current && geoAlertData) {
      socketRef.current.emit("dislocationResponse", {
        groupName: geoAlertData.groupName,
        passportId: passportId,
        response: response, // 'yes' or 'no'
      });
    }
    // Local snooze to avoid repeated popups immediately
    if (geoAlertData && geoAlertData.groupName) {
      // Match backend: 'yes' -> 2 minutes, 'no' -> 5 minutes
      const ms = String(response).toLowerCase() === 'no' ? (5 * 60 * 1000) : (2 * 60 * 1000);
      snoozeGroup(geoAlertData.groupName, ms);
    }
    // Close the modal immediately after responding
    setShowGeoAlert(false);
    setGeoAlertData(null);
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
      const groupName = alertData.groupName || alertData.group_name;
      // Suppress if snoozed locally
      if (groupName && isGroupSnoozed(groupName)) return;
      // Proximity suppression
      const nearestKm = nearestGroupDistanceKm();
      if (nearestKm != null && nearestKm <= DISLOCATION_PROXIMITY_OK_KM) {
        console.log('Suppressing dislocationAlert due to proximity:', nearestKm);
        return;
      }
      // Normalize payload to show in GeoFenceAlertModal (interactive)
      const normalized = {
        groupName,
        dislocatedMember: alertData.dislocatedMember || alertData.dislocated_member || 'A member',
        otherMember: alertData.otherMember || alertData.other_member || 'group',
        distance: String(alertData.distance || alertData.distanceKm || ''),
        message: alertData.message,
      };
      setGeoAlertData(normalized);
      setShowGeoAlert(true);
    });

    socket.on("geoFenceAlert", (alertData) => {
      console.log("Received Geo-Fence Alert:", alertData);
      // Only treat group-dislocation alerts here; other types show as-is
      const isGroupDislocation = alertData?.type === 'group-dislocation' || !!alertData?.dislocatedMember;
      const groupName = alertData.groupName || alertData.group_name;
      if (isGroupDislocation) {
        if (groupName && isGroupSnoozed(groupName)) return;
        const nearestKm = nearestGroupDistanceKm();
        if (nearestKm != null && nearestKm <= DISLOCATION_PROXIMITY_OK_KM) {
          console.log('Suppressing geoFenceAlert (dislocation) due to proximity:', nearestKm);
          return;
        }
        const normalized = {
          groupName,
          dislocatedMember: alertData.dislocatedMember || 'A member',
          otherMember: alertData.otherMember || 'group',
          distance: String(alertData.distance || alertData.distanceKm || ''),
          message: alertData.message,
        };
        setGeoAlertData(normalized);
        setShowGeoAlert(true);
        return;
      }
      // Non-dislocation geo-fence alerts
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
  }, [userToken, passportId, serviceType]);

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

  // Auto-night class (non-persistent, recalculated hourly)
  useEffect(() => {
    const body = document.body;
    function applyAutoNight(){
      const hr = new Date().getHours();
      if (hr >= 18 || hr < 6) body.classList.add('auto-night'); else body.classList.remove('auto-night');
    }
    applyAutoNight();
    const id = setInterval(applyAutoNight, 60 * 60 * 1000);
    return () => clearInterval(id);
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
  return (
    <Router>
    <div className="App">
      {showAlert && (
        <AlertModal message={alertMessage} onClose={handleCloseAlert} />
      )}
      {showGeoAlert && (
        <GeoFenceAlertModal
          alertData={geoAlertData}
          userPosition={currentPosition}
          onClose={handleCloseGeoAlert}
          onResponse={handleDislocationResponse}
        />
      )}

      <div className="app-container">
        <Orbits />
        <header className="app-header card">
          <div className="brand navbar-brand">
            <img src="/logo.png" alt="logo" className="app-logo navbar-logo" />
            <div className="navbar-title-group">
              <h1 className="app-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
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
                {serviceType ? (
                  <span style={{
                    fontSize: 12,
                    padding: '4px 8px',
                    borderRadius: 999,
                    background: '#eef2ff',
                    color: '#3730a3',
                    border: '1px solid #c7d2fe'
                  }}>
                    {serviceType.replace('_',' ').replace('_',' ')}
                  </span>
                ) : null}
              </h1>
              <p className="muted navbar-subtitle">Your safety companion on the go</p>
            </div>
          </div>
          <div className="user-actions navbar-user-actions">
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
                    // Prefer loggedInUserName; fallback to WOMEN_USER from localStorage
                    let name = (loggedInUserName || '').trim();
                    if (!name) {
                      try {
                        const raw = localStorage.getItem('WOMEN_USER');
                        if (raw) name = (JSON.parse(raw).name || '').trim();
                      } catch {}
                    }
                    return name || 'My Profile';
                  }
                  // For other services keep existing behavior (passportId)
                  return passportId;
                })()
              }</div>
            </button>
          </div>
        </header>

        {/* Global Profile modal overlay (visible on any dashboard route) */}
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
              />
            </div>
          </div>
        )}

        <div className="columns">
          <main>
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
                      window.location.reload(); // Reload to show dashboard
                    }} />;
                  }
                  
                  const userData = JSON.parse(womenUser);
                  return (
                    <>
                      {/* Live Location control panel for Women Safety dashboard */}
                      <section className="card hero-card" style={{ marginTop: 0 }}>
                        <div className="hero-top hero-flex">
                          <div className="hero-info">
                            <h2 style={{ margin: 0, marginBottom: '8px' }}>Live Location</h2>
                            {/* Live Location Toggle and Status */}
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
                              {/* Status indicator */}
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
                              
                              {/* Toggle switch with label */}
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
                <section className="card hero-card">
                  <div className="hero-top hero-flex">
                    <div className="hero-info">
                      <h2 style={{ margin: 0, marginBottom: '8px' }}>Live Location</h2>
                      {/* Live Location Toggle and Status */}
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
                        {/* Status indicator */}
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
                        
                        {/* Toggle switch with label */}
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
                            destInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
                          }
                        }}
                      >
                        Find Safe Route
                      </button>
                    </div>
                    <div className="safety-score-display hero-score">
                      <div className="score-label">Your Current Safety Score</div>
                      <div className="score">{safetyScore !== null ? safetyScore : "N/A"}</div>
                    </div>
                  </div>
                  {forwardedServices && isPanicMode && (
                    <div style={{ marginTop: 12, background:'#fff8e1', padding:12, borderRadius:8, border:'1px solid #facc15' }}>
                      <strong>Authorities Notified:</strong>{' '}
                      {Object.values(forwardedServices).map(s => s && s.name).filter(Boolean).join(', ') || 'Details pending'}
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

                        {/* Small preview map (non-interactive) */}
                        <div style={{ height: '300px', width: '100%', marginTop: '20px', overflow: 'hidden' }}>
                          <Map
                            userPosition={currentPosition}
                            // Exclude current user so they are not rendered twice ("You are here" + name)
                            groupMembers={serviceType === 'women_safety' ? [] : groupInfo?.members?.filter(m => m.passport_id !== passportId)}
                            route={safeRoute}
                            realTimeTracking={realTimeTracking}
                            isMapEnlarged={false} // preview is not interactive
                          />
                        </div>

                        <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                          <button
                            onClick={() => (realTimeTracking ? stopNavigation() : startNavigation())}
                            className="primary-button"
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

                        {/* Fullscreen overlay when map is enlarged */}
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
                                  // Exclude current user from group markers in enlarged map too
                                  groupMembers={serviceType === 'women_safety' ? [] : groupInfo?.members?.filter(m => m.passport_id !== passportId)}
                                  route={safeRoute}
                                  realTimeTracking={realTimeTracking}
                                  isMapEnlarged={true} // interactive map
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
                </section>

                {/* Hide group section for women_safety */}
                {serviceType !== 'women_safety' && (
                  <section className="card">
                    <h3>Your Group</h3>
                    {groupInfo ? (
                      <div>
                        <h4>{groupInfo.group_name}</h4>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap', margin:'6px 0 12px 0' }}>
                          <button className="primary-button" style={{ background:'linear-gradient(90deg,#f97316,#ef4444)' }} onClick={handleDeleteGroup} disabled={groupActionLoading}>
                            {groupActionLoading ? 'Deleting…' : 'Delete Group'}
                          </button>
                        </div>
                        <ul className="member-list" style={{ marginBottom:12 }}>
                          {(groupInfo.members || []).map((member, index) => (
                            <li key={index} className="member-item" style={{ display:'flex', gap:8, alignItems:'center' }}>
                              <span style={{ flex:1 }}>{member.name || member.passport_id || 'Member'}{member.status === 'pending' ? ' (pending)' : ''}</span>
                              {member.status === 'pending' && member.email && (
                                <button style={{ padding:'6px 10px', fontSize:'.7rem', background:'linear-gradient(90deg,#6366f1,#8b5cf6)' }} onClick={() => handleCancelInvite(member.email)}>Cancel</button>
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
                                  You've been invited to join{" "}
                                  <strong>{invite.group_name}</strong>
                                </span>
                                <button
                                  onClick={() => handleAcceptInvite(invite.group_id)}
                                >
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
              </Route>
            </Switch>
          </main>

          <aside className="card sidebar">
            <div className="profile-block">
              <label htmlFor="sidebarProfileImageInput" style={{ cursor: 'pointer', display: 'block' }}>
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
              <h3>{loggedInUserName}</h3>
              <div className="muted">{passportId}</div>
            </div>
            {/* (removed duplicate sidebar profile image logic) */}

            {serviceType === 'tourist_safety' && (
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-number">
                    {groupInfo?.members?.length || 0}
                  </div>
                  <div className="muted">Members</div>
                </div>
                <div className="stat-card">
                  <div className="stat-number">
                    {(pendingInvites || []).length}
                  </div>
                  <div className="muted">Invites</div>
                </div>
              </div>
            )}

            <button
              onClick={forceRefreshLocation}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'linear-gradient(90deg,#3b82f6,#0ea5e9)', color:'#fff', fontWeight:600, border:'none', cursor:'pointer' }}
            >
              Refresh Precise Location
            </button>

            <div style={{ marginTop: 16 }}>
              {/* Hardware Panic Progress Indicator */}
              {showHardwarePanicProgress && (
                <div style={{
                  marginBottom: '12px',
                  padding: '12px',
                  background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                  borderRadius: '8px',
                  border: '2px solid #fbbf24'
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', marginBottom: '6px' }}>
                    🔘 Hardware Panic Pattern Detected
                  </div>
                  <div style={{
                    width: '100%',
                    height: '6px',
                    background: '#fed7aa',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${hardwarePanicProgress}%`,
                      height: '100%',
                      background: '#f59e0b',
                      transition: 'width 0.3s ease',
                      borderRadius: '3px'
                    }} />
                  </div>
                </div>
              )}
              
              {isPanicMode ? (
                <button
                  onClick={handleCancelPanic}
                  className="cancel-button big" // You'll need to style this class
                >
                  Cancel Alert
                </button>
              ) : (
                <button
                  onClick={handlePanic}
                  className="panic-button big"
                  disabled={loadingPanic}
                >
                  {loadingPanic
                    ? (isOnline ? "Sending..." : "Queueing...")
                    : (serviceType === 'women_safety'
                        ? (isOnline ? 'SOS' : 'SOS (Offline)')
                        : (isOnline ? 'PANIC' : 'PANIC (Offline)'))}
                </button>
              )}
              {isRecording && (
                <p className="recording-indicator">◉ Recording audio...</p>
              )}
            </div>

            <div style={{ marginTop: 4 }}>
              <button onClick={handleLogout} className="logout-button">
                Logout
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </Router>
);
}

export default App;
