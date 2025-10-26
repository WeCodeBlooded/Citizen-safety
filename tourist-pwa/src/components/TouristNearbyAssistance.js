import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './TouristNearbyAssistance.css';

export default function TouristNearbyAssistance({ backendUrl, currentLocation }) {
  const [data, setData] = useState({ categories: { embassy: [], police: [], taxi: [], medical: [], heritage: [] }, total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('embassy');

  const canFetch = !!currentLocation && Number.isFinite(currentLocation.latitude) && Number.isFinite(currentLocation.longitude);
  const bUrl = useMemo(() => backendUrl || (process.env.REACT_APP_BACKEND_URL || ''), [backendUrl]);

  useEffect(() => {
    if (!canFetch) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await axios.get(`${bUrl}/api/v1/tourist/nearby`, {
          params: { lat: currentLocation.latitude, lon: currentLocation.longitude, radius: 7000 },
          withCredentials: true,
          headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        if (cancelled) return;
        setData({ categories: resp.data.categories || {}, total: resp.data.total || 0, radius: resp.data.radius });
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e?.response?.data?.message || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bUrl, canFetch, currentLocation?.latitude, currentLocation?.longitude]);

  const tabs = [
    { id: 'embassy', label: 'Embassy/Consulate' },
    { id: 'police', label: 'Police' },
    { id: 'medical', label: 'Medical' },
    { id: 'taxi', label: 'Taxi' },
    { id: 'heritage', label: 'Heritage' },
  ];

  const list = data.categories[activeTab] || [];

  return (
    <div className="nearby-panel">
      <h3>Nearby Assistance</h3>
      <p className="muted">Quickly find embassies, police, medical facilities, trusted taxi stands, and heritage attractions around you.</p>

      <div className="nearby-tabs" role="tablist" aria-label="Nearby assistance categories">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={`nearby-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="loading">Loading nearby places…</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && list.length === 0 && (
        <div className="empty">No results found within {Math.round((data.radius || 0)/1000)} km.</div>
      )}

      <ul className="nearby-list">
        {list.map((p, idx) => (
          <li key={`${activeTab}-${idx}`} className="nearby-item">
            <div className="nearby-item-main">
              <div className="nearby-title">{p.name || 'Unknown'}</div>
              <div className="nearby-meta">{p.distance_m != null ? `${Math.round(p.distance_m)} m` : ''}{p.address ? ` • ${p.address}` : ''}</div>
            </div>
            <div className="nearby-actions">
              <a
                className="nearby-link"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat + ',' + p.lon)}&query_place_id=`}
                target="_blank" rel="noreferrer"
              >
                Open in Maps
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
