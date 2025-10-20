import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// fix default marker
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Backend resolution & normalization (shared logic similar to FamilyLogin)
const FALLBACK_NGROK = "localhost:3001";
const DEFAULT_BACKEND = (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost')
  ? 'localhost:3001'
  : FALLBACK_NGROK;
let _rawBackend = DEFAULT_BACKEND;
try { const v = localStorage.getItem('BACKEND_URL'); if (v) _rawBackend = v; } catch {}
let BACKEND_URL = (typeof _rawBackend === 'string' ? _rawBackend.trim() : DEFAULT_BACKEND) || DEFAULT_BACKEND;
if (!/^https?:\/\//i.test(BACKEND_URL)) BACKEND_URL = `http://${BACKEND_URL}`; // ensure protocol for axios
try {
  const parsed = new URL(BACKEND_URL);
  if (parsed.pathname && parsed.pathname !== '/') {
    console.warn('[FamilyDashboard] BACKEND_URL included path, trimming to origin:', parsed.pathname);
  }
  BACKEND_URL = parsed.origin;
} catch (err) {
  console.warn('[FamilyDashboard] Unable to parse BACKEND_URL, reverting to fallback origin.', err?.message || err);
  BACKEND_URL = `http://${DEFAULT_BACKEND}`;
}

axios.defaults.withCredentials = true;
axios.defaults.headers.common['ngrok-skip-browser-warning'] = 'true';

const memberColors = ['red','green','purple','orange','yellow','cyan','magenta'];
const createMarkerIcon = (color) => new L.Icon({
  iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1,-34], shadowSize: [41,41],
});

const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => d * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Auto center component: whenever coordinates change, center/fly the map
const AutoCenter = ({ lat, lon }) => {
  const map = useMap();
  const prevRef = React.useRef(null);
  useEffect(() => {
    if (lat == null || lon == null) return;
    const prev = prevRef.current;
    prevRef.current = [lat, lon];
    // first time – jump directly
    if (!prev) {
      try { map.setView([lat, lon], Math.max(map.getZoom(), 13)); } catch {}
      return;
    }
    // haversine distance
    const toRad = (d) => d * Math.PI / 180;
    const R = 6371000;
    const dLat = toRad(lat - prev[0]);
    const dLon = toRad(lon - prev[1]);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(prev[0]))*Math.cos(toRad(lat))*Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const dist = R * c;
    if (dist > 25) { // only animate if moved more than 25m
      try { map.flyTo([lat, lon], Math.max(map.getZoom(), 13), { animate: true }); } catch {}
    }
  }, [lat, lon, map]);
  return null;
};

const FamilyDashboard = () => {
  const token = localStorage.getItem('FAMILY_TOKEN');
  const trackedName = localStorage.getItem('FAMILY_TOURIST_NAME') || 'Tourist';
  const trackedPassport = localStorage.getItem('FAMILY_TOURIST_PASSPORT') || '';
  const [data, setData] = useState(null); // { tourist, group }
  const [alerts, setAlerts] = useState({ standard: [], panic: [], resolved: [] });
  const [womenStreams, setWomenStreams] = useState({}); // { [sessionId]: { segments:[], ended: bool, passportId } }
  const [locationName, setLocationName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const socketRef = useRef(null);
  const lastGeoRef = useRef({ lat: null, lon: null, ts: 0 });
  const reverseGeoPendingRef = useRef(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const refreshReverseGeocode = useCallback(async (lat, lon, force = false) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const now = Date.now();
    const last = lastGeoRef.current;
    if (!force && last.lat != null && last.lon != null) {
      const distance = haversineMeters(last.lat, last.lon, lat, lon);
      if (distance < 100 && (now - (last.ts || 0)) < 60000) {
        return;
      }
    }
    if (reverseGeoPendingRef.current) return;
    lastGeoRef.current = { lat, lon, ts: now };
    reverseGeoPendingRef.current = true;
    try {
      const rev = await axios.post(`${BACKEND_URL}/api/v1/location/reverse-geocode`, { latitude: lat, longitude: lon }, { timeout: 8000 });
      if (rev.data?.features?.length) {
        setLocationName(rev.data.features[0].properties.formatted || '');
      } else if (rev.data?.provider === 'nominatim') {
        setLocationName(rev.data?.data?.display_name || '');
      }
    } catch (geoErr) {
      console.warn('[FamilyDashboard] reverse geocode failed:', geoErr?.message || geoErr);
    } finally {
      reverseGeoPendingRef.current = false;
    }
  }, []);

  const applySnapshot = useCallback((snapshot, forceReverse = false) => {
    if (!snapshot) return;
    const passportId = snapshot.passportId || snapshot.passport_id || trackedPassport;
    if (!passportId) return;
    const lat = Number(snapshot.latitude);
    const lon = Number(snapshot.longitude);
    setData((prev) => {
      const prevTourist = prev?.tourist || {};
      const nextTourist = {
        ...prevTourist,
        passport_id: passportId,
        passportId,
        name: snapshot.name || prevTourist.name || trackedName,
        latitude: Number.isFinite(lat) ? lat : prevTourist.latitude ?? null,
        longitude: Number.isFinite(lon) ? lon : prevTourist.longitude ?? null,
        status: snapshot.status ?? prevTourist.status ?? null,
        lastSeen: snapshot.lastSeen ?? prevTourist.lastSeen ?? null,
        updatedAt: snapshot.updatedAt || prevTourist.updatedAt || new Date().toISOString(),
      };
      return {
        tourist: nextTourist,
        group: prev?.group || null,
      };
    });
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      refreshReverseGeocode(lat, lon, forceReverse);
    }
  }, [refreshReverseGeocode, trackedName, trackedPassport]);

  const handleAlertUpdate = useCallback((payload) => {
    if (!payload || !payload.alert) {
      setAlerts((prev) => ({ ...prev, panic: [], standard: [] }));
      return;
    }
    const alert = payload.alert;
    const enriched = {
      ...alert,
      elapsedMs: alert.startedAt ? Math.max(0, Date.now() - alert.startedAt) : 0,
    };
    setAlerts((prev) => {
      const resolved = Array.isArray(prev?.resolved) ? [...prev.resolved] : [];
      if (alert.type === 'panic') {
        return { panic: [enriched], standard: [], resolved };
      }
      return { panic: [], standard: [enriched], resolved };
    });
  }, []);

  const handleAlertResolved = useCallback((payload) => {
    if (!payload || !payload.resolved) return;
    setAlerts((prev) => {
      const resolved = [payload.resolved, ...(Array.isArray(prev?.resolved) ? prev.resolved : [])];
      return { panic: [], standard: [], resolved: resolved.slice(0, 20) };
    });
  }, []);

  // central fetch routine (memoized so retry button reuses it)
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const fetchAll = async () => {
      setLoading(true);
      setError('');
      try {
        const [locRes, alertRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/api/family/location`, { headers }),
          axios.get(`${BACKEND_URL}/api/family/alerts`, { headers }),
        ]);
        if (cancelled) return;

        if (locRes.data && Object.prototype.hasOwnProperty.call(locRes.data, 'group')) {
          setData((prev) => ({
            tourist: prev?.tourist || null,
            group: locRes.data.group,
          }));
        }

        const touristSnapshot = locRes?.data?.tourist
          ? {
              passportId: locRes.data.tourist.passport_id || locRes.data.tourist.passportId || trackedPassport,
              name: locRes.data.tourist.name,
              latitude: locRes.data.tourist.latitude != null ? Number(locRes.data.tourist.latitude) : null,
              longitude: locRes.data.tourist.longitude != null ? Number(locRes.data.tourist.longitude) : null,
              status: locRes.data.tourist.status,
              lastSeen: locRes.data.tourist.last_seen || locRes.data.tourist.lastSeen,
            }
          : null;

        if (touristSnapshot) {
          applySnapshot(touristSnapshot, true);
        } else {
          setLocationName('');
        }

        if (alertRes?.data) {
          setAlerts((prev) => {
            const nextResolved = Array.isArray(alertRes.data.resolved) ? alertRes.data.resolved : (prev?.resolved || []);
            const hasActiveSocketAlert = (prev?.panic && prev.panic.length > 0) || (prev?.standard && prev.standard.length > 0);
            return {
              panic: hasActiveSocketAlert ? (prev.panic || []) : (alertRes.data.panic || []),
              standard: hasActiveSocketAlert ? (prev.standard || []) : (alertRes.data.standard || []),
              resolved: nextResolved,
            };
          });
        }
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, headers, applySnapshot, trackedPassport]);

  useEffect(() => {
    if (!token) return;
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('identifyFamily', { token }, (resp) => {
        if (resp?.snapshot) applySnapshot(resp.snapshot, true);
        if (resp?.alert) handleAlertUpdate({ alert: resp.alert });
      });
    });

    socket.on('familyLocationInit', (payload) => applySnapshot(payload, true));
    socket.on('familyLocationUpdate', (payload) => applySnapshot(payload, false));
    socket.on('familyAlertUpdate', (payload) => handleAlertUpdate(payload));
    socket.on('familyAlertResolved', (payload) => handleAlertResolved(payload));

    // Women stream targeted events
    socket.on('familyWomenStreamStarted', (payload) => {
      if (!payload || !payload.sessionId) return;
      setWomenStreams((prev) => ({
        ...prev,
        [payload.sessionId]: { segments: [], ended: false, passportId: payload.passportId }
      }));
    });
    socket.on('familyWomenStreamSegment', (seg) => {
      if (!seg || !seg.sessionId) return;
      setWomenStreams((prev) => {
        const cur = prev[seg.sessionId] || { segments: [], ended: false, passportId: seg.passportId };
        const nextSegs = [...cur.segments, seg].sort((a,b) => (a.sequence||0)-(b.sequence||0));
        return { ...prev, [seg.sessionId]: { ...cur, segments: nextSegs } };
      });
    });
    socket.on('familyWomenStreamEnded', (payload) => {
      if (!payload || !payload.sessionId) return;
      setWomenStreams((prev) => ({
        ...prev,
        [payload.sessionId]: { ...(prev[payload.sessionId]||{ segments:[] }), ended: true, passportId: payload.passportId }
      }));
    });

    socket.on('disconnect', () => {
      socketRef.current = null;
    });

    return () => {
      try { socket.off('connect'); } catch (e) {}
      socket.off('familyLocationInit');
      socket.off('familyLocationUpdate');
      socket.off('familyAlertUpdate');
      socket.off('familyAlertResolved');
      socket.off('familyWomenStreamStarted');
      socket.off('familyWomenStreamSegment');
      socket.off('familyWomenStreamEnded');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, applySnapshot, handleAlertUpdate, handleAlertResolved]);

  // Preload any recent sessions and their segments when token changes
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const headersAuth = { Authorization: `Bearer ${token}` };
    const preload = async () => {
      try {
        const sessRes = await axios.get(`${BACKEND_URL}/api/family/women/stream/sessions`, { headers: headersAuth });
        const sessions = Array.isArray(sessRes.data?.sessions) ? sessRes.data.sessions : [];
        const next = {};
        for (const s of sessions) {
          next[s.id] = { segments: [], ended: !!s.ended_at, passportId: s.passport_id || s.passportId };
          try {
            const segRes = await axios.get(`${BACKEND_URL}/api/women/stream/${s.id}/segments`, { headers: { 'ngrok-skip-browser-warning': 'true' } });
            const segs = Array.isArray(segRes.data?.segments) ? segRes.data.segments : [];
            next[s.id].segments = segs.sort((a,b) => (a.sequence||0)-(b.sequence||0)).map((sg) => ({
              ...sg,
              url: sg.url && sg.url.startsWith('http') ? sg.url : `${BACKEND_URL}${sg.url}`,
            }));
          } catch { /* ignore */ }
        }
        if (!cancelled) setWomenStreams(next);
      } catch { /* ignore */ }
    };
    preload();
    return () => { cancelled = true; };
  }, [token]);

  // (Removed explicit auto recenter toggle & manual control; AutoCenter handles it automatically)

  if (!token) {
    return (
      <div className="card-section">
        <h2>Unauthorized</h2>
        <p>Please log in as a Family Member first.</p>
      </div>
    );
  }

  const grpMembers = (data?.group?.members || []).filter(m => m.latitude != null && m.longitude != null);
  const center = data?.tourist && data.tourist.latitude != null ? [data.tourist.latitude, data.tourist.longitude] : [0,0];

  return (
    <div className="card-section" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ margin:0, fontSize: '1.35rem', marginBottom: 4 }}>Tracking Status for {trackedName}</h2>
        {locationName && <div className="muted" style={{ marginBottom: 12, fontSize:13 }}>{locationName}</div>}
        <div style={{ position:'relative', flex:1, minHeight: 420, width: '100%', borderRadius: 10, overflow: 'hidden' }}>
          {loading && !data && (
            <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.25)', zIndex:500 }}>
              <div className="muted">Loading latest location…</div>
            </div>
          )}
          {error && !data && (
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, background:'rgba(0,0,0,0.25)', zIndex:500 }}>
              <div className="error-message" style={{ textAlign:'center' }}>{error}</div>
              <button className="primary-button" onClick={() => window.location.reload()}>Retry</button>
            </div>
          )}
          <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
            <AutoCenter lat={data?.tourist?.latitude} lon={data?.tourist?.longitude} />
            {data?.tourist && data.tourist.latitude != null && (
              <Marker position={[data.tourist.latitude, data.tourist.longitude]} icon={createMarkerIcon('blue')}>
                <Popup>{data.tourist.name || 'Tourist'}</Popup>
              </Marker>
            )}
            {grpMembers.map((m, i) => (
              <Marker key={m.passport_id || i} position={[m.latitude, m.longitude]} icon={createMarkerIcon(memberColors[i % memberColors.length])}>
                <Popup>{m.name || m.passport_id}</Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop:0 }}>Alerts & Notifications</h3>
          {error && data && <p className="error-message" style={{ marginTop: 4 }}>{error}</p>}
          <section style={{ marginTop:10 }}>
            <h4 style={{ margin:'0 0 4px 0' }}>Panic Alerts</h4>
            {alerts.panic && alerts.panic.length > 0 ? (
              alerts.panic.map((a, idx) => (
                <div key={`panic-${idx}`} style={{ marginBottom: 8 }}>
                  <div>Active Panic Alert</div>
                  {a.services && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      Alert forwarded to authorities:
                      {a.services.closestPoliceStation ? ` Police: ${a.services.closestPoliceStation.name}` : ''}
                      {a.services.closestHospital ? `, Hospital: ${a.services.closestHospital.name}` : ''}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="muted">No panic alerts to display (per 30 min rule)</div>
            )}
          </section>
          <section style={{ marginTop:18 }}>
            <h4 style={{ margin:'0 0 4px 0' }}>Standard Alerts</h4>
            {alerts.standard && alerts.standard.length > 0 ? (
              alerts.standard.map((a, idx) => (
                <div key={`std-${idx}`}>Active alert in risk area</div>
              ))
            ) : (
              <div className="muted">No alerts older than 1 hour</div>
            )}
          </section>
          <section style={{ marginTop:18 }}>
            <h4 style={{ margin:'0 0 4px 0' }}>Resolved</h4>
            {alerts.resolved && alerts.resolved.length > 0 ? (
              alerts.resolved.map((r, idx) => (
                <div key={`res-${idx}`} className="muted">Alert at {r.lat != null && r.lon != null ? `(${r.lat.toFixed?.(4)}, ${r.lon.toFixed?.(4)})` : 'unknown location'} resolved. Tourist safe.</div>
              ))
            ) : (
              <div className="muted">No resolved alerts yet</div>
            )}
          </section>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop:0 }}>Live Stream</h3>
          {Object.keys(womenStreams).length === 0 && (
            <div className="muted">No active streams</div>
          )}
          {Object.entries(womenStreams).map(([sid, v]) => (
            <div key={sid} style={{ marginBottom: 12 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>Session #{sid} {v.ended ? '(ended)' : '(live)'}</div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8, marginTop:8 }}>
                {v.segments.map((s) => {
                  const src = s.url && s.url.startsWith('http') ? s.url : `${BACKEND_URL}${s.url}`;
                  return (
                    <video key={`${sid}-${s.sequence}`} src={src} controls style={{ width:'100%', borderRadius:6, background:'#000' }} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FamilyDashboard;
