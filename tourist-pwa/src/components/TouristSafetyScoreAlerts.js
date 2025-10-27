import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet marker icons in bundlers
try {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
    iconUrl: require('leaflet/dist/images/marker-icon.png'),
    shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
  });
} catch (_) {}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const colorForScore = (score) => {
  const s = clamp(Number(score) || 0, 1, 5);
  // Red (1) to Green (5)
  const t = (s - 1) / 4; // 0..1
  const r = Math.round(255 * (1 - t));
  const g = Math.round(180 * t + 60 * (1 - t)); // mix for readability
  const b = Math.round(60 * (1 - t));
  return `rgb(${r},${g},${b})`;
};

export default function TouristSafetyScoreAlerts({ backendUrl = process.env.REACT_APP_BACKEND_URL, passportId, currentLocation }) {
  const mapRef = useRef(null);
  const cellsLayerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const [rating, setRating] = useState(4);
  const [tags, setTags] = useState([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [cells, setCells] = useState([]);
  const [areaAvg, setAreaAvg] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [radius, setRadius] = useState(3000);
  const [statusMsg, setStatusMsg] = useState('');

  const effectiveLoc = currentLocation || null;
  const center = effectiveLoc ? [effectiveLoc.latitude, effectiveLoc.longitude] : [20.5937, 78.9629];

  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map('tourist-safety-map').setView(center, effectiveLoc ? 13 : 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      cellsLayerRef.current = L.layerGroup().addTo(map);
    } else {
      mapRef.current.setView(center, effectiveLoc ? 13 : mapRef.current.getZoom());
    }
    // Add or update user marker
    if (effectiveLoc) {
      const pos = [effectiveLoc.latitude, effectiveLoc.longitude];
      if (!userMarkerRef.current) {
        userMarkerRef.current = L.marker(pos, { title: 'You are here' }).addTo(mapRef.current);
      } else {
        userMarkerRef.current.setLatLng(pos);
      }
    }
  }, [effectiveLoc]);

  // Fetch cells around current location
  const fetchCells = async () => {
    if (!effectiveLoc) return;
    try {
      const { data } = await axios.get(`${backendUrl}/api/v1/safety/score`, {
        params: { lat: effectiveLoc.latitude, lon: effectiveLoc.longitude, radius: radius },
        withCredentials: true,
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      setCells(Array.isArray(data.cells) ? data.cells : []);
      setAreaAvg(data.areaAvg ?? null);
    } catch (e) {
      // silent; UI will just not show cells
    }
  };

  // Fetch alerts near current location
  const fetchAlerts = async () => {
    if (!effectiveLoc) return;
    try {
      const { data } = await axios.get(`${backendUrl}/api/v1/safety/alerts`, {
        params: { lat: effectiveLoc.latitude, lon: effectiveLoc.longitude, radius },
        withCredentials: true,
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
    } catch (e) {
      // ignore
    }
  };

  // Render cells on map whenever cells change
  useEffect(() => {
    const layer = cellsLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    cells.forEach(c => {
      const color = colorForScore(c.avg_score || 0);
      const latlng = [c.cell_lat, c.cell_lon];
      const circle = L.circle(latlng, {
        radius: 180, // ~180m radius visual
        color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 1,
      }).bindPopup(
        `<div style="min-width:180px">
          <div><strong>Avg Score:</strong> ${Number(c.avg_score || 0).toFixed(1)} / 5</div>
          <div><strong>Ratings:</strong> ${c.ratings_count || 0}</div>
        </div>`
      );
      circle.addTo(layer);
    });
  }, [cells]);

  // Poll for data
  useEffect(() => {
    let t1, t2;
    (async () => {
      await fetchCells();
      await fetchAlerts();
    })();
    t1 = setInterval(fetchCells, 30000);
    t2 = setInterval(fetchAlerts, 30000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [effectiveLoc, radius]);

  const toggleTag = (tag) => {
    setTags((prev) => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const submitRating = async (e) => {
    e.preventDefault();
    if (!effectiveLoc) {
      setStatusMsg('Waiting for location…');
      return;
    }
    if (!passportId) {
      setStatusMsg('Missing passport id.');
      return;
    }
    setLoading(true);
    setStatusMsg('');
    try {
      await axios.post(`${backendUrl}/api/v1/safety/ratings`, {
        passport_id: passportId,
        score: rating,
        tags,
        comment: comment || null,
        latitude: effectiveLoc.latitude,
        longitude: effectiveLoc.longitude,
      }, { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } });
      setComment('');
      setTags([]);
      setStatusMsg('Thanks for your feedback!');
      fetchCells();
    } catch (e) {
      setStatusMsg(e?.response?.data?.message || 'Failed to submit rating');
    }
    setLoading(false);
  };

  const severityColor = (sev) => {
    switch ((sev || '').toLowerCase()) {
      case 'critical': return '#991b1b';
      case 'high': return '#b91c1c';
      case 'medium': return '#d97706';
      case 'low': return '#15803d';
      case 'info':
      default: return '#2563eb';
    }
  };

  return (
    <div className="tourist-safety-score-alerts">
      <div className="panel-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Safety Score & Alerts</h3>
          <div className="muted">Rate the neighborhood and see nearby alerts</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <label>Radius</label>
          <select value={radius} onChange={(e)=>setRadius(parseInt(e.target.value,10))}>
            <option value={1000}>1 km</option>
            <option value={3000}>3 km</option>
            <option value={5000}>5 km</option>
            <option value={10000}>10 km</option>
          </select>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap:16 }}>
        <div>
          <div id="tourist-safety-map" style={{ width:'100%', height: 380, borderRadius: 8, overflow:'hidden', border:'1px solid #e5e7eb' }} />
          <div style={{ marginTop:8, fontSize:12, color:'#64748b' }}>
            {areaAvg != null ? <>Area average score: <strong>{areaAvg}</strong>/5</> : 'No ratings yet nearby.'}
          </div>
        </div>
        <div>
          <form onSubmit={submitRating} className="card" style={{ padding:12 }}>
            <h4 style={{ marginTop:0 }}>Rate This Area</h4>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <label htmlFor="rating">Score:</label>
              <input id="rating" type="range" min="1" max="5" value={rating} onChange={(e)=>setRating(parseInt(e.target.value,10))} />
              <div style={{ width:36, textAlign:'center', fontWeight:700 }}>{rating}</div>
            </div>
            <div style={{ marginTop:8 }}>
              <div style={{ fontSize:12, color:'#475569', marginBottom:6 }}>Tags</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {['well-lit','crowded','isolated','police-visible','pickpocket-risk','road-block','flooding','protest'].map(t => (
                  <button key={t} type="button" onClick={()=>toggleTag(t)} className={`chip ${tags.includes(t)?'chip--active':''}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop:8 }}>
              <textarea placeholder="Share a quick note (optional)" value={comment} onChange={(e)=>setComment(e.target.value)} rows={3} style={{ width:'100%' }} />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8 }}>
              <button className="primary-button" disabled={loading || !effectiveLoc}>{loading ? 'Submitting…' : 'Submit Rating'}</button>
              <div style={{ fontSize:12, color:'#64748b' }}>{statusMsg}</div>
            </div>
          </form>

          <div className="card" style={{ padding:12, marginTop:12 }}>
            <h4 style={{ marginTop:0 }}>Nearby Alerts</h4>
            {alerts.length === 0 ? (
              <div className="muted">No active alerts nearby.</div>
            ) : (
              <ul className="alert-list" style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:8 }}>
                {alerts.map(a => (
                  <li key={a.id} className="alert-item" style={{ border:'1px solid #e5e7eb', borderLeft:`4px solid ${severityColor(a.severity)}`, borderRadius:6, padding:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ fontWeight:700 }}>{a.title}</div>
                      <span style={{ fontSize:12, padding:'2px 6px', borderRadius:999, border:'1px solid #cbd5e1', color:'#334155' }}>{a.category}</span>
                    </div>
                    {a.description ? <div style={{ fontSize:13, color:'#475569', marginTop:4 }}>{a.description}</div> : null}
                    <div style={{ fontSize:12, color:'#64748b', marginTop:6 }}>
                      Severity: <strong style={{ color: severityColor(a.severity) }}>{(a.severity||'').toUpperCase()}</strong> · Radius: {a.radius_m || 1000}m
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
