import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const getBackend = () => {
  const FALLBACK = (typeof window !== 'undefined' && window.location.hostname === 'localhost') ? process.env.REACT_APP_BACKEND_URL : process.env.REACT_APP_BACKEND_URL;
  let v = FALLBACK; try { const s = localStorage.getItem('BACKEND_URL'); if (s) v = s.trim(); } catch {}
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const parsed = new URL(v);
    if (parsed.pathname && parsed.pathname !== '/') {
      console.warn('[ReportIncident] BACKEND_URL included path, trimming to origin:', parsed.pathname);
    }
    v = parsed.origin;
  } catch (err) {
    console.warn('[ReportIncident] Unable to parse BACKEND_URL, falling back to default.', err?.message || err);
    v = FALLBACK;
  }
  return v;
};

export default function ReportIncident({ onDone }) {
  const BACKEND_URL = useMemo(() => getBackend(), []);
  const [form, setForm] = useState({
    category: (typeof window !== 'undefined' && localStorage.getItem('SERVICE_TYPE')) || 'women_safety',
    sub_type: '',
    description: '',
    latitude: '',
    longitude: '',
    reporter_name: '',
    reporter_contact: '',
  });
  // read initial category from hash query (?cat=...)
  useEffect(() => {
    try {
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const qIndex = hash.indexOf('?');
      if (qIndex !== -1) {
        const params = new URLSearchParams(hash.substring(qIndex + 1));
        const cat = params.get('cat');
        if (cat) setForm(f => ({ ...f, category: cat }));
      }
    } catch {}
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const autofillLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords || {};
      setForm((f) => ({ ...f, latitude: latitude?.toFixed?.(6) || '', longitude: longitude?.toFixed?.(6) || '' }));
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setCreated(null);
    try {
      const payload = { ...form };
      ['latitude','longitude'].forEach(k => { if (payload[k] === '') delete payload[k]; else payload[k] = parseFloat(payload[k]); });
      const res = await axios.post(`${BACKEND_URL}/api/v1/incidents`, payload, { headers: { 'ngrok-skip-browser-warning': 'true' } });
      setCreated(res.data?.incident || res.data);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to submit incident');
    } finally { setLoading(false); }
  };

  if (created) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '24px auto' }}>
        <h2 style={{ marginTop: 0 }}>Incident reported</h2>
        <p>Reference ID: {created.id}</p>
        <p>Status: {created.status}</p>
        <button className="primary-button" onClick={() => onDone ? onDone() : window.location.hash = ''}>Back to Home</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 560, margin: '24px auto' }}>
      <h2 style={{ marginTop: 0 }}>Report an Incident</h2>
      {error && <div className="error-message" style={{ marginBottom: 12 }}>{error}</div>}
      <form onSubmit={submit}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:8 }}>
          {[
            { v:'women_safety', label:'Women Safety' },
            { v:'street_animal', label:'Street Animal' },
            { v:'tourist_safety', label:'Tourist Safety' },
            { v:'fire', label:'Fire' },
            { v:'medical', label:'Medical' },
            { v:'police', label:'Police' },
          ].map(opt => (
            <button
              key={opt.v}
              type="button"
              className={`secondary-button ${form.category === opt.v ? 'active' : ''}`}
              onClick={() => setForm({ ...form, category: opt.v })}
              style={{ padding:'6px 10px', fontSize:13 }}
            >{opt.label}</button>
          ))}
        </div>
        <label>Category</label>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          <option value="women_safety">Women Safety</option>
          <option value="street_animal">Street Animal</option>
          <option value="tourist_safety">Tourist Safety</option>
          <option value="fire">Fire</option>
          <option value="medical">Medical</option>
          <option value="police">Police</option>
        </select>
        <label>Sub-type (optional)</label>
        <input value={form.sub_type} onChange={(e) => setForm({ ...form, sub_type: e.target.value })} placeholder="e.g., harassment, rabies risk" />
        <label>Description</label>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the situation" rows={4} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label>Latitude</label>
            <input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="e.g., 28.6139" />
          </div>
          <div>
            <label>Longitude</label>
            <input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="e.g., 77.2090" />
          </div>
        </div>
        <button type="button" className="secondary-button" onClick={autofillLocation} style={{ marginTop: 8 }}>Use My Location</button>
        <label>Your name (optional)</label>
        <input value={form.reporter_name} onChange={(e) => setForm({ ...form, reporter_name: e.target.value })} placeholder="Name" />
        <label>Contact (optional)</label>
        <input value={form.reporter_contact} onChange={(e) => setForm({ ...form, reporter_contact: e.target.value })} placeholder="Email or phone" />
        <button className="auth-primary-btn" type="submit" disabled={loading} style={{ marginTop: 12 }}>{loading ? 'Submitting…' : 'Submit Incident'}</button>
      </form>
    </div>
  );
}
