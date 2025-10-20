import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import axios from "axios";
import io from "socket.io-client";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";




import {
  AppBar, Toolbar, Typography, IconButton, Box, Dialog, DialogTitle,
  DialogContent, DialogActions, Slide, Button, List, ListItem, ListItemText, Popover, Snackbar, Alert
} from "@mui/material";
import MapIcon from '@mui/icons-material/Map';
import ReportIcon from '@mui/icons-material/Report';
import CloseIcon from '@mui/icons-material/Close';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';


delete L.Icon.Default.prototype._getIconUrl;
const defaultIcon = new L.Icon({
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
const distressIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png", shadowSize: [41, 41],
});
const anomalyIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-yellow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png", shadowSize: [41, 41],
});
const offlineIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png", shadowSize: [41, 41],
});

const anomalyRiskAreaIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png",
  iconSize: [25,41], iconAnchor:[12,41], popupAnchor:[1,-34], shadowUrl:"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png", shadowSize:[41,41]
});
const anomalyMlIcon = anomalyIcon; 
const anomalyDislocationIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-violet.png",
  iconSize: [25,41], iconAnchor:[12,41], popupAnchor:[1,-34], shadowUrl:"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png", shadowSize:[41,41]
});
const anomalyInactiveIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png",
  iconSize: [25,41], iconAnchor:[12,41], popupAnchor:[1,-34], shadowUrl:"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png", shadowSize:[41,41]
});

function MapController({ center, zoom }) {
    const map = useMap();
    useEffect(() => {
      map.setView(center, zoom);
      setTimeout(() => { map.invalidateSize(); }, 200);
    }, [map, center, zoom]);
    return null;
  }
const Transition = React.forwardRef(function Transition(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});



const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

function App() {
  const [tourists, setTourists] = useState([]);
  const [mapPosition, setMapPosition] = useState([20.5937, 78.9629]);
  const [mapZoom, setMapZoom] = useState(5);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedTourist, setSelectedTourist] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMapVisible, setIsMapVisible] = useState(false);
  const [adminList, setAdminList] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [audioUrls, setAudioUrls] = useState({});
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [womenStreams, setWomenStreams] = useState({}); // sessionId -> { segments: [{url,...}], ended }
  
  const [dislocationAlert, setDislocationAlert] = useState(null);
  const [isDislocationDialogOpen, setIsDislocationDialogOpen] = useState(false);
  
  const [groups, setGroups] = useState([]);
  const [filterGroup, setFilterGroup] = useState(null);
  // Incidents state
  const [incidentsOpen, setIncidentsOpen] = useState(false);
  const [incidents, setIncidents] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentFilter, setIncidentFilter] = useState({ category: '', status: '' });

  
  axios.defaults.timeout = 10000; 
  axios.defaults.headers.common['ngrok-skip-browser-warning'] = 'true';

  
  useEffect(() => {
    let mounted = true;
    const fetchInitialTourists = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v1/tourists`);
        if (!mounted) return;
        if (Array.isArray(res.data)) {
          setTourists(res.data);
        } else if (res && res.data && res.data.tourists) {
          setTourists(res.data.tourists);
        } else {
          console.warn('Unexpected tourists response shape:', res.data);
        }
      } catch (err) {
        console.error('Failed to fetch tourists from backend:', {
          url: `${BACKEND_URL}/api/v1/tourists`,
          message: err.message,
          response: err.response && {
            status: err.response.status,
            data: err.response.data,
          },
        });
        
        
        try {
          const status = err.response?.status;
          if (status === 401 || status === 403) {
            alert('Authentication failed when contacting backend. Check tokens or CORS rules.');
          } else if (status >= 500) {
            alert('Backend error (5xx). Check the server logs or ngrok tunnel.');
          } else if (!navigator.onLine) {
            alert('You appear offline. Check your network connection.');
          } else {
            alert('Failed to contact backend. See console for details.');
          }
        } catch (e) {
          console.debug('Error handling fetch failure message:', e);
        }
      }
    };
    fetchInitialTourists();
    return () => { mounted = false; };
  }, []);

  const fetchIncidents = async () => {
    setIncidentsLoading(true);
    try {
      const params = {};
      if (incidentFilter.category) params.category = incidentFilter.category;
      if (incidentFilter.status) params.status = incidentFilter.status;
      const res = await axios.get(`${BACKEND_URL}/api/v1/incidents`, { params });
      setIncidents(res.data?.incidents || []);
    } catch (e) {
      console.error('Failed to fetch incidents', e);
      setIncidents([]);
    } finally { setIncidentsLoading(false); }
  };

  useEffect(() => {
    if (!incidentsOpen) return;
    fetchIncidents();
  }, [incidentsOpen, incidentFilter]);

  const updateIncidentStatus = async (inc, nextStatus) => {
    try {
      await axios.patch(`${BACKEND_URL}/api/v1/incidents/${inc.id}`, { status: nextStatus });
      fetchIncidents();
    } catch (e) {
      console.error('Failed to update incident', e);
      alert('Failed to update incident');
    }
  };

  
  
  
  const uiStatusClass = (status) => {
    if (!status) return "";
    const s = String(status).toLowerCase();
    if (s === "distress") return "distress";
    if (s.startsWith("anomaly")) return "anomaly"; 
    if (s === "offline") return "offline";
    return ""; 
  };

  
  const socketRef = useRef(null);

  useEffect(() => {
    const responderSecret = process.env.REACT_APP_RESPONDER_SECRET;
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      auth: {
        clientType: 'responder',
        responderSecret: responderSecret
      }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to WebSocket server as responder');
      
      const storedAdminName = localStorage.getItem('adminName') || `Admin-${Math.floor(Math.random()*1000)}`;
      localStorage.setItem('adminName', storedAdminName);
      socket.emit('identifyAdmin', storedAdminName);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] connect_error:', err && (err.message || err));
      const reason = err && err.data && err.data.reason;
      if (reason === 'invalid_responder_token') {
        alert('Responder authentication failed. Check REACT_APP_RESPONDER_SECRET and server secret.');
      }
    });

    socket.on('adminListUpdate', (admins) => {
      setAdminList(admins);
    });

    socket.on('adminNotification', (payload) => {
      console.log('Received broadcast notification:', payload);
      setAdminNotifications(prev => [...prev, payload]);
      showSnackbar(payload.message, 'info');
    });
    socket.on('adminNotificationAdmins', (payload) => {
      console.log('Received admin-only notification:', payload);
      setAdminNotifications(prev => [...prev, payload]);
      showSnackbar(`[Admin] ${payload.message}`, 'info');
    });
    socket.on('adminNotificationsInit', (list) => {
      if (Array.isArray(list)) setAdminNotifications(list);
    });

    // Women stream events
    const onSeg = (payload) => {
      if (!payload || !payload.sessionId || !payload.url) return;
      setWomenStreams(prev => {
        const next = { ...prev };
        const s = next[payload.sessionId] || { segments: [], ended: false };
        s.segments = [...s.segments, payload].sort((a,b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9));
        next[payload.sessionId] = s;
        return next;
      });
    };
    const onEnd = ({ sessionId }) => {
      setWomenStreams(prev => {
        const next = { ...prev };
        if (!next[sessionId]) next[sessionId] = { segments: [], ended: true };
        else next[sessionId].ended = true;
        return next;
      });
    };
    socket.on('womenStreamSegment', onSeg);
    socket.on('womenStreamEnded', onEnd);

    const handleUpdate = (updateData) => {
      setTourists((prevTourists) =>
        prevTourists.map((tourist) =>
          tourist.passport_id === updateData.passport_id
            ? { ...tourist, ...updateData }
            : tourist
        )
      );
      
      if (updateData.status === 'active') {
        setForwardedIds(prev => { const next = new Set(prev); next.delete(updateData.passport_id); return next; });
        setAuthorityServicesMap(prev => {
          if (prev[updateData.passport_id]) {
            const clone = { ...prev };
            delete clone[updateData.passport_id];
            return clone;
          }
          return prev;
        });
      }
    };
    socket.on("locationUpdate", handleUpdate);
    socket.on("panicAlert", handleUpdate);
    socket.on("anomalyAlert", handleUpdate);
    socket.on("statusUpdate", handleUpdate);

    const dislocHandler = (payload) => {
      console.log('Received admin dislocation alert:', payload);
      setDislocationAlert(payload);
      setIsDislocationDialogOpen(true);
    };
    const legacyHandler = (payload) => {
      console.log('Received legacy dislocation alert:', payload);
      setDislocationAlert(payload);
      setIsDislocationDialogOpen(true);
    };
    socket.on('adminDislocationAlert', dislocHandler);
    socket.on('dislocationAlert', legacyHandler);

    return () => {
      socket.off('adminDislocationAlert', dislocHandler);
      socket.off('dislocationAlert', legacyHandler);
      socket.off('adminListUpdate');
      socket.off('adminNotification');
      socket.off('adminNotificationAdmins');
      socket.off('adminNotificationsInit');
      socket.off('womenStreamSegment', onSeg);
      socket.off('womenStreamEnded', onEnd);
      socket.disconnect();
    };
  }, []);

  
  useEffect(() => {
    let mounted = true;
    const fetchGroups = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v1/groups`);
        if (!mounted) return;
        if (Array.isArray(res.data)) setGroups(res.data);
        else if (res.data && Array.isArray(res.data.groups)) setGroups(res.data.groups);
      } catch (err) {
        
        try {
          const grouped = {};
          (tourists || []).forEach(t => {
            const g = t.group || t.group_id || t.team || 'Ungrouped';
            if (!g) return;
            if (!grouped[g]) grouped[g] = 0;
            grouped[g]++;
          });
          const arr = Object.keys(grouped).map(name => ({ name, count: grouped[name] }));
          if (mounted) setGroups(arr);
        } catch (e) {
          console.debug('Failed to derive groups', e);
        }
      }
    };
    fetchGroups();
    return () => { mounted = false; };
  }, [tourists]);

  
  const [recordingsError, setRecordingsError] = useState(null);

  
  const [timeframe, setTimeframe] = useState('2h'); 
  const [pathPoints, setPathPoints] = useState([]); 
  const [pathLoading, setPathLoading] = useState(false);
  const [pathError, setPathError] = useState(null);
  const [pathLastUpdated, setPathLastUpdated] = useState(null);
  const [pathAutoRefresh, setPathAutoRefresh] = useState(false);
  

  
  const fetchRecordingsFor = async (passportId) => {
    setRecordingsError(null);
    if (!passportId) {
      setRecordings([]);
      return;
    }
    const url = `${BACKEND_URL}/api/v1/recordings`;
    try {
  
  const params = { passportId, passport_id: passportId };
  console.debug('Requesting recordings', { url, params });
  const res = await axios.get(url, { params });
  console.debug('Recordings response shape:', res.data);
      
      const data = res.data;
      if (Array.isArray(data)) setRecordings(data);
      else if (data && Array.isArray(data.recordings)) setRecordings(data.recordings);
      else setRecordings([]);
    } catch (err) {
      
      const status = err.response && err.response.status;
      const respData = err.response && err.response.data;
      const msg = `Failed to fetch recordings: ${status || 'no-status'} - ${err.message}`;
      console.error(msg, { url, passportId, status, respData, err });
      setRecordings([]);
      setRecordingsError({ message: msg, status, respData, url });
    }
  };

  
  const fetchPathFor = async (passportId, tf = '2h') => {
    setPathError(null);
    setPathLoading(true);
    setPathPoints([]);
    if (!passportId) {
      setPathLoading(false);
      return;
    }
    try {
      
      const url1 = `${BACKEND_URL}/api/v1/tourists/${encodeURIComponent(passportId)}/locations`;
      const params = { since: tf, timeframe: tf };
      let res;
      try {
        res = await axios.get(url1, { params });
      } catch (e) {
        
        const url2 = `${BACKEND_URL}/api/v1/locations`;
        res = await axios.get(url2, { params: { passportId, ...params } });
      }
      const data = res.data;
      
      let points = [];
      if (Array.isArray(data)) {
        points = data.map(p => Array.isArray(p) ? [p[0], p[1]] : [p.latitude || p.lat, p.longitude || p.lon || p.lng]);
      } else if (data && Array.isArray(data.locations)) {
        points = data.locations.map(p => [p.latitude || p.lat, p.longitude || p.lon || p.lng]);
      }
      
      points = points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      setPathPoints(points);
    } catch (err) {
      console.error('Failed to fetch path points', err);
      setPathError({ message: err.message });
    } finally {
      setPathLoading(false);
    }
  };

  
  const handleDeleteRecording = async (rec) => {
    if (!rec) return;
    if (!window.confirm('Delete this recording?')) return;
    try {
      
      const id = rec.id;
      const fileName = rec.file_name || rec.fileName;
      if (id) {
        await axios.delete(`${BACKEND_URL}/api/v1/recordings/${id}`);
      } else if (fileName) {
        await axios.delete(`${BACKEND_URL}/api/v1/recordings/file/${fileName}`);
      } else {
        throw new Error('No id or fileName for recording');
      }
      setRecordings(prev => prev.filter(r => (r.id || r.file_name || r.fileName) !== (rec.id || rec.file_name || rec.fileName)));
    } catch (err) {
      console.error('Failed to delete recording', err);
      alert('Failed to delete recording');
    }
  };

  
  useEffect(() => {
    if (isModalOpen && selectedTourist && selectedTourist.passport_id) {
      fetchRecordingsFor(selectedTourist.passport_id);
      
      setPathError(null);
      setPathLoading(true);
      fetchPathFor(selectedTourist.passport_id, timeframe).then(()=>{
        setPathLastUpdated(new Date());
      });
    }
  }, [isModalOpen, selectedTourist, timeframe]);

  
  useEffect(() => {
    if (isModalOpen && selectedTourist?.passport_id) {
      fetchPathFor(selectedTourist.passport_id, timeframe).then(()=>setPathLastUpdated(new Date()));
    }
    
  }, [timeframe]);

  
  useEffect(() => {
    if (!pathAutoRefresh || !isModalOpen || !selectedTourist?.passport_id) return;
    const id = setInterval(() => {
      fetchPathFor(selectedTourist.passport_id, timeframe).then(()=>setPathLastUpdated(new Date()));
    }, 60000);
    return () => clearInterval(id);
    
  }, [pathAutoRefresh, isModalOpen, selectedTourist, timeframe]);

  
  function FitBoundsOnPoints({ points }) {
    const map = useMap();
    useEffect(() => {
      if (!map || !points || points.length === 0) return;
      try {
        const latLngs = points.map(p => [p[0], p[1]]);
        map.fitBounds(latLngs, { padding: [40, 40] });
      } catch (e) {
        console.debug('fitBounds failed', e);
      }
    }, [map, points]);
    return null;
  }

  
  const recordingUrl = (rec) => {
    if (!rec) return '';
    
  if (rec.file_name) return `${BACKEND_URL}/api/v1/recordings/file/${encodeURIComponent(rec.file_name)}`;
    const u = rec.file_url || rec.url || '';
    if (!u) return '';
    
    if (u.startsWith('/')) return `${BACKEND_URL}${u}`;
    
    return u;
  };

  const WomenStreamPanel = () => {
    const sessions = Object.keys(womenStreams).sort((a,b)=>Number(a)-Number(b));
    if (!sessions.length) return null;
    return (
      <div style={{ marginTop: 16 }}>
        <h3>Live Streams (Women Safety)</h3>
        {sessions.map((sid) => {
          const s = womenStreams[sid];
          return (
            <div key={sid} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Session #{sid}</strong>
                <span style={{ fontSize: 12, color: s.ended ? '#ef4444' : '#10b981' }}>{s.ended ? 'Ended' : 'Live'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, marginTop: 8 }}>
                {s.segments.map((seg, idx) => (
                  <video key={`${seg.url}-${idx}`} src={`${BACKEND_URL}${seg.url}`} controls style={{ width: '100%', background: '#000', borderRadius: 6 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ... later inside JSX return, append panel near top-level content

  
  const fetchAndPrepareRecording = async (rec) => {
    const key = rec.id || rec.file_name || rec.fileName;
    if (!key) return;
    if (audioUrls[key]) return; 
    try {
      const candidate = recordingUrl(rec);
      const url = candidate && (candidate.startsWith('http') ? candidate : (candidate.startsWith('/') ? `${BACKEND_URL}${candidate}` : `${BACKEND_URL}/${candidate}`));
      console.debug('Fetching recording blob:', { key, candidate, resolvedUrl: url });
      const res = await axios.get(url, { responseType: 'blob' });
      const blob = res.data;
      const objectUrl = URL.createObjectURL(blob);
      setAudioUrls(prev => ({ ...prev, [key]: objectUrl }));
    } catch (err) {
      console.error('Failed to load recording blob', err);
      
    }
  };

  const handleDownloadRecording = (rec) => {
    const key = rec.id || rec.file_name || rec.fileName;
    const url = audioUrls[key] || recordingUrl(rec);
    if (!url) return alert('Recording URL not available');
    if (audioUrls[key]) {
      const a = document.createElement('a');
      a.href = url;
      a.download = rec.file_name || `recording-${key}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(url, '_blank', 'noopener');
    }
  };

  
  useEffect(() => {
    if (!isModalOpen) {
      
      setAudioUrls((prev) => {
        Object.values(prev).forEach((u) => {
          try { URL.revokeObjectURL(u); } catch (e) {}
        });
        return {};
      });
    }
  }, [isModalOpen]);

  
  const getMarkerIcon = (status) => {
    if (!status) return defaultIcon;
    const s = String(status).toLowerCase();
    if (s === "distress") return distressIcon;
    if (s === "offline") return offlineIcon;
    if (s === "anomaly_risk_area") return anomalyRiskAreaIcon;
    if (s === "anomaly_ml") return anomalyMlIcon;
    if (s === "anomaly_dislocation") return anomalyDislocationIcon;
    if (s === "anomaly_inactive") return anomalyInactiveIcon;
    if (s.startsWith("anomaly")) return anomalyIcon; 
    return defaultIcon;
  };
  
  const mapStatusToCategory = (status) => {
    if (!status) return 'Active';
    const s = String(status).toLowerCase();
    if (s.includes('high') || s.includes('high_risk') || s.includes('highrisk') || s.includes('high-risk')) return 'High Risk';
    if (s.includes('group')) return 'Group Alert';
    if (s.includes('distress')) return 'Distress';
    if (s.includes('anomaly')) return 'Anomaly';
    if (s.includes('offline')) return 'Offline';
    
    if (s.includes('alert') && !s.includes('group')) return 'High Risk';
    return 'Active';
  };
  const alertTourists = tourists.filter(
    (t) => {
      const s = (t.status || '').toLowerCase();
      return s === 'distress' || s === 'anomaly' || s.startsWith('anomaly_');
    }
  );
  const filteredTourists = tourists
    .filter((tourist) => {
      if (filterStatus === "all") return true;
      if (filterStatus === "active") return !tourist.status || tourist.status === "active";
      if (filterStatus === "distress") return tourist.status === "distress" || tourist.status === "anomaly";
      return true;
    })
    .filter((tourist) => {
      if (!filterGroup) return true;
      const g = tourist.group || tourist.group_id || tourist.team || '';
      if (!g) return false;
      return String(g) === String(filterGroup);
    })
    .filter((tourist) => {
      const name = tourist.name || "";
      const passportId = tourist.passport_id || "";
      const query = searchQuery.toLowerCase();
      return name.toLowerCase().includes(query) || passportId.toLowerCase().includes(query);
    });
  const handleOpenModal = (tourist) => {
    
    setRecordings([]);
    setRecordingsError(null);
    setAudioUrls({});
    setSelectedTourist(tourist);
    setIsModalOpen(true);
    if (tourist?.passport_id) {
      fetchRecordingsFor(tourist.passport_id);
      fetchAlertHistory(tourist.passport_id);
    }
  };

  
  const [forwarding, setForwarding] = useState(false);
  const [forwardedIds, setForwardedIds] = useState(new Set());
  const [emergencyDialog, setEmergencyDialog] = useState({ open: false, services: null, passportId: null });
  const [editAuthorityDialog, setEditAuthorityDialog] = useState({ open:false, passportId:null, step:'chooseType', type:null, loading:false, error:null, lists:null });
  const [authorityServicesMap, setAuthorityServicesMap] = useState({}); 
  const [alertHistory, setAlertHistory] = useState([]);
  const [alertHistoryLoading, setAlertHistoryLoading] = useState(false);

  const fetchAlertHistory = async (passportId) => {
    setAlertHistoryLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/v1/alerts/${passportId}/history`);
      setAlertHistory(Array.isArray(res.data) ? res.data : []);
    } catch(e) {
      console.warn('Failed to load alert history', e.message);
      setAlertHistory([]);
    } finally { setAlertHistoryLoading(false); }
  };

  const handleForwardAlert = async (e, tourist) => {
    e.stopPropagation(); 
    if (!tourist || !tourist.passport_id) return;
    if (forwardedIds.has(tourist.passport_id)) return; 
    try {
      setForwarding(true);
      await axios.post(`${BACKEND_URL}/api/v1/alerts/forward-to-emergency`, { passportId: tourist.passport_id });
      setForwardedIds(prev => new Set(prev).add(tourist.passport_id));
    } catch (err) {
      console.error('Failed to forward alert:', err.response?.data || err.message);
      alert('Failed to forward alert. Check console for details.');
    } finally {
      setForwarding(false);
    }
  };

  
  useEffect(() => {
    let cancelled = false;
    const loadForwarded = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v1/alerts/forwarded`);
        if (!cancelled && Array.isArray(res.data)) {
          setForwardedIds(new Set(res.data.map(r => r.passport_id)));
          
          setAuthorityServicesMap(prev => {
            const next = { ...prev };
            res.data.forEach(r => { if (r.services) next[r.passport_id] = r.services; });
            return next;
          });
        }
      } catch (e) {
        console.warn('Could not load forwarded alerts:', e?.message);
      }
    };
    loadForwarded();
    return () => { cancelled = true; };
  }, []);

  
  useEffect(() => {
    if (!socketRef.current) return;
    const sock = socketRef.current;
    const handleDispatched = (payload) => {
      if (payload && payload.passport_id) {
        setForwardedIds(prev => {
          const next = new Set(prev);
          next.add(payload.passport_id);
          return next;
        });
        if (payload.services) {
          setAuthorityServicesMap(prev => ({ ...prev, [payload.passport_id]: payload.services }));
        }
        
        setEmergencyDialog({ open: true, services: payload.services || null, passportId: payload.passport_id });
      }
    };
    sock.on('emergencyResponseDispatched', handleDispatched);
    return () => sock.off('emergencyResponseDispatched', handleDispatched);
  }, []);
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedTourist(null);
  };
  const handleLocateOnMap = () => {
    if (selectedTourist && selectedTourist.latitude && selectedTourist.longitude) {
      setMapPosition([selectedTourist.latitude, selectedTourist.longitude]);
      setMapZoom(13);
      handleCloseModal();
      setIsMapVisible(true);
    }
  };
  const handleResetAlert = async (passportId) => {
    try {
      
      setTourists(prev => prev.map(t => t.passport_id === passportId ? { ...t, status: 'active' } : t));
      setForwardedIds(prev => { const next = new Set(prev); next.delete(passportId); return next; });
      await axios.post(`${BACKEND_URL}/api/v1/tourists/${passportId}/reset`);
      
      showSnackbar('Alert reset successfully', 'success');
    } catch (error) {
      console.error("Failed to reset alert:", error);
      
      showSnackbar('Failed to reset alert', 'error');
    }
  };
  const handleResetAllAlerts = async () => {
    const passportsToReset = alertTourists.map(t => t.passport_id).filter(Boolean);
    if (passportsToReset.length === 0) return alert('No active alerts to reset');
    if (!window.confirm('Reset all active alerts?')) return;
    try {
      
      setTourists(prev => prev.map(t => passportsToReset.includes(t.passport_id) ? { ...t, status: 'active' } : t));
  setForwardedIds(prev => { const next = new Set(prev); passportsToReset.forEach(pid => next.delete(pid)); return next; });
      
      await Promise.all(passportsToReset.map(pid => axios.post(`${BACKEND_URL}/api/v1/tourists/${pid}/reset`).catch(err => console.warn('reset failed', pid, err))));
      showSnackbar('All alerts reset successfully', 'success');
    } catch (e) {
      console.error('Failed to reset all alerts', e);
      showSnackbar('Failed to reset all alerts', 'error');
    }
  };

  
  const handleResetGroupAlerts = async () => {
    if (!filterGroup) return;
    if (!window.confirm(`Reset ALL alerts for group "${filterGroup}"?`)) return;
    try {
      
      setTourists(prev => prev.map(t => {
        const g = t.group || t.group_id || t.team;
        if (String(g) === String(filterGroup) && t.status && t.status !== 'active') {
          return { ...t, status: 'active' };
        }
        return t;
      }));
      
      setForwardedIds(prev => {
        const next = new Set(prev);
        tourists.forEach(t => {
          const g = t.group || t.group_id || t.team;
            if (String(g) === String(filterGroup)) next.delete(t.passport_id);
        });
        return next;
      });
      
      await axios.post(`${BACKEND_URL}/api/v1/groups/${encodeURIComponent(filterGroup)}/reset-alerts`);
      showSnackbar(`Group ${filterGroup} alerts reset`, 'success');
    } catch (e) {
      console.error('Failed to reset group alerts', e);
      showSnackbar('Failed to reset group alerts', 'error');
    }
  };

  
  const openEditAuthority = (passportId) => {
    setEditAuthorityDialog({ open:true, passportId, step:'chooseType', type:null, loading:false, error:null, lists:null });
  };

  
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState('success');
  const showSnackbar = (message, severity = 'success') => {
    setSnackbarMsg(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  };
  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbarOpen(false);
  };

  const handleAdminListClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleRenameAdmin = () => {
    const current = localStorage.getItem('adminName') || '';
    const name = window.prompt('Enter admin display name', current) || current;
    if (!name) return;
    localStorage.setItem('adminName', name);
    try {
      const socket = io(BACKEND_URL, { transports:['websocket','polling'], withCredentials:true });
      socket.on('connect', () => {
        socket.emit('identifyAdmin', name);
        setTimeout(()=>socket.disconnect(), 1000);
      });
    } catch(e) { console.warn('rename emit failed', e); }
    showSnackbar('Admin name updated','success');
  };

  const handleAdminListClose = () => {
    setAnchorEl(null);
  };

  const openAdminPopover = Boolean(anchorEl);
  const adminPopoverId = openAdminPopover ? 'admin-list-popover' : undefined;

  return (
    <div className="App">
      <div className="header">
        <h1>Authority Dashboard</h1>
        <div>
          <IconButton aria-describedby={adminPopoverId} className="header-button" onClick={handleAdminListClick}>
            <SupervisorAccountIcon />
          </IconButton>
          <IconButton className="header-button" onClick={() => setIncidentsOpen(true)} title="Incidents">
            <ReportIcon />
          </IconButton>
          <IconButton className="header-button" onClick={() => setIsMapVisible(true)}>
            <MapIcon />
          </IconButton>
        </div>
      </div>

      <Popover
        id={adminPopoverId}
        open={openAdminPopover}
        anchorEl={anchorEl}
        onClose={handleAdminListClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
      >
        <Box sx={{ p: 2, minWidth: 200 }}>
          {}
          <Typography variant="subtitle1">Connected Admins ({adminList.length})</Typography>
          <List dense>
            {adminList.map((adminId) => (
              <ListItem key={adminId}>
                <ListItemText primary={adminId} />
              </ListItem>
            ))}
          </List>
          <Button size="small" variant="outlined" onClick={handleRenameAdmin}>Rename</Button>
        </Box>
      </Popover>

      {/* Women live stream panel */}
      <div style={{ padding: 16 }}>
        <WomenStreamPanel />
      </div>

      {}
      {editAuthorityDialog.open && (
        <Dialog open maxWidth="sm" fullWidth onClose={()=> setEditAuthorityDialog({ open:false, passportId:null, step:'chooseType', type:null, loading:false, error:null, lists:null })}>
          <DialogTitle>Edit Dispatched Authority</DialogTitle>
          <DialogContent dividers>
            {editAuthorityDialog.step === 'chooseType' && (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <p style={{ marginTop:0 }}>Select which service to change for <strong>{editAuthorityDialog.passportId}</strong>:</p>
                {['hospital','police','fire'].map(opt => (
                  <Button key={opt} variant="outlined" onClick={async ()=> {
                    setEditAuthorityDialog(prev=> ({ ...prev, step:'list', type:opt, loading:true, error:null }));
                    try {
                      const res = await axios.get(`${BACKEND_URL}/api/v1/alerts/${editAuthorityDialog.passportId}/nearby-services`);
                      setEditAuthorityDialog(prev=> ({ ...prev, loading:false, lists: res.data }));
                    } catch (e) {
                      setEditAuthorityDialog(prev=> ({ ...prev, loading:false, error: 'Failed to load services' }));
                    }
                  }}>
                    {opt === 'hospital' ? 'Hospital' : opt === 'police' ? 'Police Station' : 'Fire Station'}
                  </Button>
                ))}
              </div>
            )}
            {editAuthorityDialog.step === 'list' && (
              <div>
                {editAuthorityDialog.loading && <p>Loading nearby {editAuthorityDialog.type} options...</p>}
                {editAuthorityDialog.error && <p style={{ color: 'var(--red-500)' }}>{editAuthorityDialog.error}</p>}
                {editAuthorityDialog.lists && !editAuthorityDialog.loading && (
                  <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:320, overflowY:'auto' }}>
                    {(editAuthorityDialog.type === 'hospital' ? editAuthorityDialog.lists.hospital : editAuthorityDialog.type === 'police' ? editAuthorityDialog.lists.police : editAuthorityDialog.lists.fire_station).map((svc, idx) => (
                      <button key={idx} className="btn" style={{ justifyContent:'space-between', fontSize:'.75rem' }} onClick={async ()=> {
                        try {
                          await axios.post(`${BACKEND_URL}/api/v1/alerts/${editAuthorityDialog.passportId}/update-authority`, {
                            authorityType: editAuthorityDialog.type,
                            service: svc
                          });
                          
                          if (emergencyDialog.open && emergencyDialog.services) {
                            setEmergencyDialog(prev => {
                              if (!prev.services) return prev;
                              const mapKey = editAuthorityDialog.type === 'hospital' ? 'closestHospital' : editAuthorityDialog.type === 'police' ? 'closestPoliceStation' : 'closestFireStation';
                              return { ...prev, services: { ...prev.services, [mapKey]: { ...svc } } };
                            });
                          }
                          showSnackbar('Authority updated','success');
                        } catch (e) {
                          console.error('Failed to save override', e);
                          showSnackbar('Failed to update authority','error');
                        }
                        setEditAuthorityDialog({ open:false, passportId:null, step:'chooseType', type:null, loading:false, error:null, lists:null });
                      }}>
                        <span style={{ fontWeight:600 }}>{svc.name}</span>
                        <span style={{ opacity:.65 }}>{svc.lat.toFixed(3)}, {svc.lon.toFixed(3)}</span>
                      </button>
                    ))}
                    {(editAuthorityDialog.type === 'hospital' ? editAuthorityDialog.lists.hospital.length : editAuthorityDialog.type === 'police' ? editAuthorityDialog.lists.police.length : editAuthorityDialog.lists.fire_station.length) === 0 && (
                      <p>No results found.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            {editAuthorityDialog.step === 'list' && <Button onClick={()=> setEditAuthorityDialog(prev=> ({ ...prev, step:'chooseType', type:null, lists:null }))}>Back</Button>}
            <Button onClick={()=> setEditAuthorityDialog({ open:false, passportId:null, step:'chooseType', type:null, loading:false, error:null, lists:null })}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      {}
       <div className="main-container">
        {emergencyDialog.open && (
          <Dialog open onClose={() => setEmergencyDialog({ open:false, services:null, passportId:null })} maxWidth="sm" fullWidth>
            <DialogTitle>Emergency Services Dispatched</DialogTitle>
            <DialogContent dividers>
              <p style={{ marginTop:0 }}>Forwarded alert for passport ID: <strong>{emergencyDialog.passportId}</strong></p>
              {(!emergencyDialog.services || Object.keys(emergencyDialog.services).length === 0) && <p>No services data available.</p>}
              {emergencyDialog.services && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {['closestHospital','closestPoliceStation','closestFireStation'].map(key => {
                    const svc = emergencyDialog.services[key];
                    if (!svc) return (
                      <div key={key} className="panel" style={{ padding:8 }}>
                        <strong>{key === 'closestHospital' ? 'Hospital' : key === 'closestPoliceStation' ? 'Police Station' : 'Fire Station'}</strong>
                        <div style={{ fontSize:'.8rem', color:'var(--muted)' }}>Not found within search radius</div>
                      </div>
                    );
                    const label = key === 'closestHospital' ? 'Hospital' : key === 'closestPoliceStation' ? 'Police Station' : 'Fire Station';
                    return (
                      <div key={key} className="panel" style={{ padding:8 }}>
                        <strong>{svc.name || label}</strong>
                        <div style={{ fontSize:'.75rem', opacity:.8 }}>Type: {label}</div>
                        {svc.distance_km && <div style={{ fontSize:'.75rem' }}>Distance: {svc.distance_km} km</div>}
                        <div style={{ fontSize:'.7rem' }}>Lat: {svc.lat?.toFixed ? svc.lat.toFixed(5) : svc.lat} | Lon: {svc.lon?.toFixed ? svc.lon.toFixed(5) : svc.lon}</div>
                        <a href={`https://www.google.com/maps/search/?api=1&query=${svc.lat},${svc.lon}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:'.7rem', color:'var(--indigo-500)' }}>Open in Maps</a>
                      </div>
                    );
                  })}
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEmergencyDialog({ open:false, services:null, passportId:null })}>Close</Button>
            </DialogActions>
          </Dialog>
        )}
        {}
        <div className="sidebar">
          <div className="alerts-container panel">
            <h2>🚨 Active Alerts ({alertTourists.length})</h2>
            <div className="list-scroll-area">
              {alertTourists.map((tourist) => (
                <div
                  key={tourist.id}
                  className={`alert-item ${tourist.status}`}
                  onClick={() => handleOpenModal(tourist)}
                >
                  <p>
                    <strong>{tourist.name}</strong> ({tourist.passport_id})
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap:'wrap' }} onClick={e => e.stopPropagation()}>
                    {!forwardedIds.has(tourist.passport_id) ? (
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 8px', fontSize: '0.65rem' }}
                        disabled={forwarding}
                        onClick={(e) => handleForwardAlert(e, tourist)}
                        title="Forward this alert to emergency services"
                      >
                        {forwarding ? 'Forwarding...' : 'Forward'}
                      </button>
                    ) : (
                      <>
                        <span className="forwarded-status" style={{ fontSize: '0.65rem' }}>Forwarded</span>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 6px', fontSize: '0.6rem' }}
                          title="Edit dispatched authorities"
                          onClick={() => openEditAuthority(tourist.passport_id)}
                        >Edit</button>
                      </>
                    )}
                    <button
                      className="btn btn-danger"
                      style={{ padding: '4px 6px', fontSize: '0.6rem' }}
                      title="Reset this alert"
                      onClick={() => handleResetAlert(tourist.passport_id)}
                    >Reset</button>
                  </div>
                </div>
              ))}
              {alertTourists.length === 0 && <p className="muted-small">No active alerts</p>}
            </div>
          </div>

          <div className="tourist-list-container panel">
            <h2>All Registered Tourists ({filteredTourists.length})</h2>
          
            <div className="groups-container" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: '6px 0' }}>Registered Groups</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
                {groups && groups.length > 0 ? (
                  groups.map((g, i) => {
                    const name = typeof g === 'string' ? g : (g.name || g.group || g.id);
                    const count = typeof g === 'string' ? null : (g.count || g.size || g.member_count || null);
                    return (
                      <button key={i} className={`group-button ${filterGroup === name ? 'active' : ''}`} onClick={() => setFilterGroup(filterGroup === name ? null : name)} style={{ textAlign: 'left', padding: '6px 8px' }}>
                        <span style={{ fontWeight: 600 }}>{name}</span>
                        {count !== null && <span style={{ float: 'right', opacity: 0.8 }}>{count}</span>}
                      </button>
                    );
                  })
                ) : (
                  <div className="muted-small">No groups registered</div>
                )}
              </div>
              {filterGroup && <div style={{ marginTop: 8 }}><button className="btn btn-ghost" onClick={() => setFilterGroup(null)}>Clear Group Filter</button></div>}
              {filterGroup && <div style={{ marginTop: 6 }}><button className="btn btn-danger" style={{ fontSize:'.7rem', padding:'4px 8px' }} onClick={handleResetGroupAlerts}>Reset {filterGroup} Alerts</button></div>}
            </div>
            <div className="filter-container">
              <button className={`filter-button ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>All</button>
              <button className={`filter-button ${filterStatus === 'active' ? 'active' : ''}`} onClick={() => setFilterStatus('active')}>Active</button>
              <button className={`filter-button ${filterStatus === 'distress' ? 'active' : ''}`} onClick={() => setFilterStatus('distress')}>In Distress</button>
            </div>
            <div className="search-container">
              <input
                type="text"
                placeholder="Search by name or passport ID..."
                className="search-bar"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="list-scroll-area">
              {filteredTourists.map((tourist) => (
                <div
                  key={tourist.id}
                  className={`tourist-item ${uiStatusClass(tourist.status)}`}
                  onClick={() => handleOpenModal(tourist)}
                >
                  <p><strong>Name:</strong> {tourist.name || "N/A"}</p>
                  <p><strong>Passport ID:</strong> {tourist.passport_id}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {}
        <div className="center-panel">
          <div className="panel">
            <h2>Map Preview</h2>
            <div className="map-preview" style={{ height: 320, borderRadius: 8, overflow: 'hidden' }}>
              <MapContainer center={mapPosition} zoom={mapZoom} style={{ height: '100%', width: '100%' }}>
                <MapController center={mapPosition} zoom={mapZoom} />
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" />
                {filteredTourists
                  .filter((t) => t.latitude && t.longitude)
                  .map((tourist) => (
                    <Marker key={tourist.id} position={[tourist.latitude, tourist.longitude]} icon={getMarkerIcon(tourist.status)}>
                      <Popup>
                        <b>{tourist.name}</b><br />Passport ID: {tourist.passport_id}<br />Status: {tourist.status || 'active'}
                      </Popup>
                    </Marker>
                  ))}
              </MapContainer>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => setIsMapVisible(true)}><MapIcon /> Open Map</button>
              <button className="btn btn-danger" onClick={handleResetAllAlerts}>Reset All Alerts</button>
            </div>
          </div>

          <div className="panel">
            <h2>Recent Activity</h2>
            <div className="list-scroll-area">
              {tourists.slice(0, 6).map((t) => (
                <div key={t.id || t.passport_id} className="tourist-item" style={{ marginBottom: 8 }}>
                  <p style={{ margin: 0 }}><strong>{t.name || 'Unknown'}</strong></p>
                  <p className="muted-small" style={{ margin: 0 }}>{t.passport_id} • {t.status || 'active'}</p>
                </div>
              ))}
              {tourists.length === 0 && <p className="muted-small">No recent activity</p>}
            </div>
          </div>
        </div>

        {}
        <div className="right-panel">
          <div className="panel">
            <h2>Overview</h2>
            <p>Total Tourists: <strong>{tourists.length}</strong></p>
            <p>Active: <strong>{tourists.filter(t => !t.status || t.status === 'active').length}</strong></p>
            <p>Alerts: <strong>{alertTourists.length}</strong></p>
            {}
            <div className="overview-chart" style={{ paddingTop: 6 }}>
              {(() => {
                const counts = {
                  'High Risk': 0,
                  'Anomaly': 0,
                  'Active': 0,
                  'Offline': 0,
                  'Group Alert': 0,
                  'Distress': 0,
                };
                tourists.forEach(t => {
                  const cat = mapStatusToCategory(t.status);
                  if (counts[cat] !== undefined) counts[cat]++;
                  else counts['Active']++;
                });
                const data = [
                  { name: 'High Risk', value: counts['High Risk'], color: '#ef4444' },
                  { name: 'Anomaly', value: counts['Anomaly'], color: '#f59e0b' },
                  { name: 'Active', value: counts['Active'], color: '#22c55e' },
                  { name: 'Offline', value: counts['Offline'], color: '#94a3b8' },
                  { name: 'Group Alert', value: counts['Group Alert'], color: '#6366f1' },
                  { name: 'Distress', value: counts['Distress'], color: '#b91c1c' },
                ];
                const total = data.reduce((s, d) => s + d.value, 0);

                if (total === 0) {
                  return (
                    <div style={{ textAlign: 'center', color: '#6b7280' }}>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>No data</div>
                      <div style={{ fontSize: 12 }}>No tourists available</div>
                    </div>
                  );
                }

                
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{total} Total</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {data.map(d => (
                        <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 12, height: 12, background: d.color, display: 'inline-block', borderRadius: 2 }} />
                            <span style={{ fontSize: 13 }}>{d.name}</span>
                          </div>
                          <div style={{ fontSize: 13, color: '#374151' }}>{d.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="panel">
            <h2>Quick Actions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary" onClick={() => {
                const msg = window.prompt('Enter a notification message to broadcast to other admins:');
                if (!msg) return;
                axios.post(`${BACKEND_URL}/api/v1/admin/notify`, { message: msg, scope: 'admins' })
                  .then(() => showSnackbar('Notification sent to admins','success'))
                  .catch(() => showSnackbar('Failed to send notification','error'));
              }}>Notify Admins</button>
              <button className="btn btn-secondary" onClick={() => {
                const msg = window.prompt('Broadcast message to all connected clients (admins + tourists viewers):');
                if (!msg) return;
                axios.post(`${BACKEND_URL}/api/v1/admin/notify`, { message: msg, scope: 'all' })
                  .then(() => showSnackbar('Broadcast sent','success'))
                  .catch(() => showSnackbar('Failed to broadcast','error'));
              }}>Broadcast All</button>
              <button className="btn btn-ghost" onClick={() => window.location.reload()}>Refresh Data</button>
            </div>
          </div>
          <div className="panel">
            <h2>Notifications ({adminNotifications.length})</h2>
            <div className="list-scroll-area" style={{ maxHeight: 160 }}>
              {adminNotifications.slice().reverse().slice(0,15).map(n => (
                <div key={n.id} className="tourist-item" style={{ marginBottom: 6 }}>
                  <p style={{ margin: 0, fontSize: 13 }}>{n.message}</p>
                  <p className="muted-small" style={{ margin: 0 }}>{new Date(n.ts).toLocaleTimeString()} • {n.scope}</p>
                </div>
              ))}
              {adminNotifications.length === 0 && <p className="muted-small">No notifications yet</p>}
            </div>
          </div>
        </div>
       </div>

      <Dialog open={isModalOpen} onClose={handleCloseModal} fullWidth maxWidth="md">
        <DialogTitle>
          Digital ID: {selectedTourist?.name}
          <IconButton
            onClick={handleCloseModal}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedTourist && (
            <Box>
                <List dense>
                    <ListItem><ListItemText primary="Passport ID" secondary={selectedTourist.passport_id} /></ListItem>
                    <ListItem><ListItemText primary="Emergency Contact" secondary={selectedTourist.emergencyContact || 'N/A'} /></ListItem>
                    <ListItem><ListItemText primary="Status" secondary={selectedTourist.status || 'active'} /></ListItem>
                    <ListItem>
                      <ListItemText primary="Last Known Location" secondary={`Lat: ${selectedTourist.latitude || 'N/A'}, Lon: ${selectedTourist.longitude || 'N/A'}`} />
                    </ListItem>
                    {selectedTourist.latitude && selectedTourist.longitude ? (
                      <ListItem>
                        <div style={{ width: '100%', borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                            <label style={{ fontSize: 13 }}>Path:</label>
                            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={{ padding: '6px 8px' }}>
                              <option value="30m">Last 30 minutes</option>
                              <option value="1h">Last 1 hour</option>
                              <option value="2h">Last 2 hours</option>
                              <option value="6h">Last 6 hours</option>
                              <option value="24h">Last 24 hours</option>
                            </select>
                            <Button size="small" variant="outlined" onClick={() => fetchPathFor(selectedTourist.passport_id, timeframe)} disabled={pathLoading}>
                              {pathLoading ? 'Loading...' : 'Load Path'}
                            </Button>
                            <Button size="small" variant="text" onClick={() => { setPathPoints([]); setPathError(null); }}>
                              Clear
                            </Button>
                            <label style={{ fontSize: 12, display:'flex', alignItems:'center', gap:4 }}>
                              <input type="checkbox" checked={pathAutoRefresh} onChange={e=>setPathAutoRefresh(e.target.checked)} /> Auto
                            </label>
                          </div>

                          {pathError && <div style={{ color: '#b91c1c', marginBottom: 8 }}>Failed to load path: {pathError.message}</div>}
                          {!pathError && pathPoints.length>0 && (
                            <div style={{ fontSize:11, color:'#555', marginBottom:6 }}>
                              {pathPoints.length} points • updated {pathLastUpdated ? pathLastUpdated.toLocaleTimeString() : '—'}
                            </div>
                          )}

                          <div style={{ width: '100%', height: 220 }}>
                            <MapContainer center={[selectedTourist.latitude, selectedTourist.longitude]} zoom={13} style={{ width: '100%', height: '100%' }}>
                              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                              <Marker position={[selectedTourist.latitude, selectedTourist.longitude]} icon={getMarkerIcon(selectedTourist.status)} />
                              {pathPoints && pathPoints.length > 0 && (
                                <>
                                  <Polyline pathOptions={{ color: '#3b82f6', weight: 4 }} positions={pathPoints} />
                                  <FitBoundsOnPoints points={pathPoints} />
                                </>
                              )}
                            </MapContainer>
                          </div>
                        </div>
                      </ListItem>
                    ) : (
                      <ListItem><ListItemText primary="Location preview" secondary="No coordinates available" /></ListItem>
                    )}
                </List>
            </Box>
          )}
          <div style={{ marginTop: 16 }}>
            <Typography variant="subtitle1">Forwarded Authority Details</Typography>
            {selectedTourist?.passport_id && authorityServicesMap[selectedTourist.passport_id] ? (
              <div style={{ fontSize: 13, marginTop: 6, display:'flex', flexDirection:'column', gap:4 }}>
                {Object.entries(authorityServicesMap[selectedTourist.passport_id]).map(([k,v]) => (
                  <div key={k} style={{ display:'flex', gap:6 }}>
                    <strong style={{ minWidth:140 }}>{k}:</strong>
                    <span>{(v && v.name) || v || '—'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-small" style={{ marginTop:4 }}>No authority dispatch recorded for this tourist yet.</p>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <Typography variant="subtitle1" sx={{ display:'flex', alignItems:'center', gap:8 }}>
              Alert History
              <Button size="small" variant="outlined" onClick={() => selectedTourist && fetchAlertHistory(selectedTourist.passport_id)} disabled={alertHistoryLoading}>
                {alertHistoryLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </Typography>
            {alertHistoryLoading && <p className="muted-small" style={{ marginTop:4 }}>Loading history...</p>}
            {!alertHistoryLoading && alertHistory.length === 0 && <p className="muted-small" style={{ marginTop:4 }}>No history entries.</p>}
            {!alertHistoryLoading && alertHistory.length > 0 && (
              <div style={{ maxHeight:160, overflowY:'auto', marginTop:8, border:'1px solid #eee', borderRadius:6, padding:8 }}>
                {alertHistory.slice().reverse().map(ev => (
                  <div key={ev.id} style={{ padding:'4px 0', borderBottom:'1px solid #f1f1f1' }}>
                    <div style={{ fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5 }}>{ev.event_type}</div>
                    <div style={{ fontSize:11, color:'#555' }}>{new Date(ev.created_at).toLocaleString()}</div>
                    {ev.details && <pre style={{ margin:0, marginTop:2, fontSize:11, background:'#fafafa', padding:4, borderRadius:4, whiteSpace:'pre-wrap' }}>{typeof ev.details === 'string' ? ev.details : JSON.stringify(ev.details, null, 2)}</pre>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <Typography variant="subtitle1">Recordings</Typography>
            <div className="recordings-list">
              {recordingsError && (
                <div className="muted-small" style={{ marginBottom: 8 }}>
                  <div>Unable to load recordings: {recordingsError.message}</div>
                  <div style={{ marginTop: 6 }}>
                    <Button size="small" variant="outlined" onClick={() => fetchRecordingsFor(selectedTourist.passport_id)}>Retry</Button>
                  </div>
                </div>
              )}
              {recordings.length === 0 && !recordingsError && <p className="muted-small">No recordings found</p>}
              {recordings.map((rec) => {
                const key = rec.id || rec.file_name || rec.fileName;
                const preparedUrl = audioUrls[key];
                return (
                  <div key={key} className="recording-item">
                    <div className="recording-info">
                      <Typography variant="body2">{rec.file_name || rec.id}</Typography>
                      <Typography variant="caption" className="muted-small">{new Date(rec.created_at).toLocaleString()}</Typography>
                    </div>
                    <div className="recording-actions">
                      {!preparedUrl ? (
                        <Button size="small" variant="outlined" color="primary" onClick={() => fetchAndPrepareRecording(rec)}>
                          Load
                        </Button>
                      ) : (
                        <>
                          <audio controls src={preparedUrl} style={{ maxWidth: 220, verticalAlign: 'middle' }} />
                          <Button size="small" variant="outlined" color="primary" onClick={() => handleDownloadRecording(rec)} style={{ marginLeft: 8 }}>
                            Download
                          </Button>
                        </>
                      )}
                      <Button size="small" variant="outlined" color="secondary" onClick={() => handleDeleteRecording(rec)} style={{ marginLeft: 8 }}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleLocateOnMap} startIcon={<MyLocationIcon />}>
            Locate on Map
          </Button>
          {(selectedTourist?.status === "distress" || selectedTourist?.status === "anomaly") && (
             <Button 
                variant="contained" 
                color="success"
                onClick={() => handleResetAlert(selectedTourist.passport_id)}
              >
                Reset Alert
              </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog
        open={isDislocationDialogOpen}
        onClose={() => setIsDislocationDialogOpen(false)}
      >
        <DialogTitle>Group Dislocation Detected</DialogTitle>
        <DialogContent dividers>
          {dislocationAlert ? (
            <Box>
              <Typography gutterBottom><strong>Group:</strong> {dislocationAlert.groupName || 'Unknown'}</Typography>
              <Typography gutterBottom><strong>Dislocated Member:</strong> {dislocationAlert.dislocatedMember || 'N/A'}</Typography>
              <Typography gutterBottom><strong>Other Member:</strong> {dislocationAlert.otherMember || 'N/A'}</Typography>
              {dislocationAlert.distanceKm && (
                <Typography gutterBottom><strong>Distance:</strong> {dislocationAlert.distanceKm} km</Typography>
              )}
              <Typography gutterBottom>{dislocationAlert.message}</Typography>
              <Typography variant="caption" display="block" sx={{ mt:1 }} color="text.secondary">
                This alert is generated when two group members exceed the separation threshold.
              </Typography>
            </Box>
          ) : (
            <Typography>No alert data.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsDislocationDialogOpen(false)} variant="contained">Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        fullScreen
        open={isMapVisible}
        onClose={() => setIsMapVisible(false)}
        TransitionComponent={Transition}
      >
        <AppBar sx={{ position: 'relative' }}>
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Tourist Map View
            </Typography>
            <IconButton
              edge="end"
              color="inherit"
              onClick={() => setIsMapVisible(false)}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
          </Toolbar>
        </AppBar>
        <MapContainer
          center={mapPosition}
          zoom={mapZoom}
          style={{ height: "100%", width: "100%" }}
        >
          <MapController center={mapPosition} zoom={mapZoom} />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
          />
          {filteredTourists
            .filter((tourist) => tourist.latitude && tourist.longitude)
            .map((tourist) => (
              <Marker
                key={tourist.id}
                position={[tourist.latitude, tourist.longitude]}
                icon={getMarkerIcon(tourist.status)}
              >
                <Popup>
                    <b>{tourist.name}</b><br />
                    Passport ID: {tourist.passport_id}<br />
                    Status: {tourist.status || "active"}
                </Popup>
              </Marker>
            ))}
        </MapContainer>
      </Dialog>
      {/* Incidents dialog */}
      <Dialog open={incidentsOpen} onClose={() => setIncidentsOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Citizen Incidents</DialogTitle>
        <DialogContent dividers>
          <div style={{ display:'flex', gap:10, marginBottom:12 }}>
            <select value={incidentFilter.category} onChange={e=>setIncidentFilter(f=>({ ...f, category: e.target.value }))}>
              <option value="">All categories</option>
              <option value="women_safety">Women Safety</option>
              <option value="street_animal">Street Animal</option>
              <option value="tourist_safety">Tourist Safety</option>
              <option value="fire">Fire</option>
              <option value="medical">Medical</option>
              <option value="police">Police</option>
            </select>
            <select value={incidentFilter.status} onChange={e=>setIncidentFilter(f=>({ ...f, status: e.target.value }))}>
              <option value="">All status</option>
              <option value="new">New</option>
              <option value="forwarded">Forwarded</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
            <Button variant="outlined" size="small" onClick={fetchIncidents} disabled={incidentsLoading}>Refresh</Button>
          </div>
          {incidentsLoading ? (
            <div className="muted">Loading…</div>
          ) : incidents.length === 0 ? (
            <div className="muted">No incidents found.</div>
          ) : (
            <List>
              {incidents.map(inc => (
                <ListItem key={inc.id} alignItems="flex-start" divider>
                  <ListItemText 
                    primary={`${inc.category}${inc.sub_type ? ' • ' + inc.sub_type : ''} — ${inc.status}`}
                    secondary={
                      <div>
                        <div>{inc.description || 'No description'}</div>
                        <div className="muted" style={{ fontSize:12, marginTop:4 }}>
                          {Number.isFinite(inc.latitude) && Number.isFinite(inc.longitude) ? `@ ${inc.latitude.toFixed?.(4)}, ${inc.longitude.toFixed?.(4)}` : 'No location'}
                          {inc.reporter_name ? ` • Reporter: ${inc.reporter_name}` : ''}
                        </div>
                      </div>
                    }
                  />
                  <div style={{ display:'flex', gap:6 }}>
                    <Button size="small" variant="outlined" onClick={() => updateIncidentStatus(inc, 'in_progress')}>In progress</Button>
                    <Button size="small" variant="outlined" onClick={() => updateIncidentStatus(inc, 'resolved')}>Resolve</Button>
                    <Button size="small" variant="outlined" onClick={() => updateIncidentStatus(inc, 'dismissed')}>Dismiss</Button>
                    <Button size="small" variant="outlined" onClick={async () => {
                      const v = window.prompt('Assign to agency/service', inc.assigned_agency || '');
                      if (v != null) {
                        try { await axios.patch(`${BACKEND_URL}/api/v1/incidents/${inc.id}`, { assigned_agency: v }); fetchIncidents(); }
                        catch { alert('Failed to assign'); }
                      }
                    }}>Assign</Button>
                  </div>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIncidentsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      {}
      <Snackbar open={snackbarOpen} autoHideDuration={4000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={handleCloseSnackbar} severity={snackbarSeverity} sx={{ width: '100%' }}>
          {snackbarMsg}
        </Alert>
      </Snackbar>
    </div>
  );
}

export default App;