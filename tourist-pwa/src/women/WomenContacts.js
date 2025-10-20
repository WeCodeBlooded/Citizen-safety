import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import './WomenContacts.css';

// Resolve backend URL - same logic as WomenDashboard
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
      console.warn('[WomenContacts] BACKEND_URL included path, trimming to origin:', parsed.pathname);
    }
    value = parsed.origin;
  } catch (err) {
    console.warn('[WomenContacts] Unable to parse BACKEND_URL, using fallback origin.', err?.message || err);
    value = FALLBACK;
  }
  return value;
};

export default function WomenContacts({ email, aadhaarNumber }) {
  const [contacts, setContacts] = useState([]);
  const [helplines, setHelplines] = useState([]);
  const [form, setForm] = useState({ name: '', mobile_number: '', email: '', relationship: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const BACKEND_URL = useMemo(() => resolveBackendUrl(), []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${BACKEND_URL}/api/women/emergency-contacts`, { 
        params: { email, aadhaarNumber },
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setContacts(res.data.contacts || []);
      setHelplines(res.data.helplines || []);
    } catch (e) {
      console.error('[WomenContacts] Failed to load contacts:', e);
      setError('Failed to load contacts');
    }
    setLoading(false);
  }, [email, aadhaarNumber, BACKEND_URL]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // removed duplicate fetchContacts definition; useCallback version above

  async function addContact(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // Send contact info + user auth separately to avoid email conflict
      await axios.post(`${BACKEND_URL}/api/women/emergency-contacts`, { 
        // Contact information
        name: form.name,
        mobile_number: form.mobile_number,
        contact_email: form.email, // Renamed to avoid conflict with user's email
        relationship: form.relationship,
        // User authentication (women user's credentials)
        userEmail: email,
        userAadhaarNumber: aadhaarNumber
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      setForm({ name: '', mobile_number: '', email: '', relationship: '' });
      fetchContacts();
    } catch (e) {
      console.error('[WomenContacts] Failed to add contact:', e);
      setError('Failed to add contact');
    }
    setLoading(false);
  }

  async function removeContact(id) {
    setLoading(true);
    setError('');
    try {
      await axios.delete(`${BACKEND_URL}/api/women/emergency-contacts/${id}`, { 
        data: { email, aadhaarNumber },
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      fetchContacts();
    } catch (e) {
      console.error('[WomenContacts] Failed to remove contact:', e);
      setError('Failed to remove contact');
    }
    setLoading(false);
  }

  return (
    <div className="women-contacts">
      <div className="contacts-section">
        <h3>Your Trusted Contacts</h3>
        {loading && <div className="loading-spinner">Loading...</div>}
        {error && <div className="error-message">{error}</div>}
        
        {!loading && contacts.length === 0 && (
          <div className="empty-state">
            <p>No emergency contacts added yet. Add your trusted contacts below.</p>
          </div>
        )}
        
        <ul className="contacts-list">
          {contacts.map(c => (
            <li key={c.id} className="contact-item">
              <div className="contact-info">
                <div className="contact-name">{c.name}</div>
                <div className="contact-relationship">{c.relationship || 'trusted'}</div>
                <div className="contact-details">
                  <span className="contact-phone">📞 {c.mobile_number}</span>
                  {c.email && <span className="contact-email">✉️ {c.email}</span>}
                </div>
              </div>
              <button 
                className="btn-remove" 
                onClick={() => removeContact(c.id)}
                disabled={loading}
                aria-label={`Remove ${c.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={addContact} className="add-contact-form">
          <h4>Add New Contact</h4>
          <div className="form-grid">
            <input 
              type="text"
              placeholder="Name *" 
              value={form.name} 
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} 
              required 
              className="form-input"
            />
            <input 
              type="tel"
              placeholder="Mobile Number *" 
              value={form.mobile_number} 
              onChange={e => setForm(f => ({ ...f, mobile_number: e.target.value }))} 
              required 
              className="form-input"
            />
            <input 
              type="email"
              placeholder="Email (optional)" 
              value={form.email} 
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} 
              className="form-input"
            />
            <input 
              type="text"
              placeholder="Relationship (e.g., Mother, Friend)" 
              value={form.relationship} 
              onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))} 
              className="form-input"
            />
          </div>
          <button type="submit" className="btn-add" disabled={loading}>
            {loading ? 'Adding...' : 'Add Contact'}
          </button>
        </form>
      </div>

      <div className="helplines-section">
        <h3>National Helplines</h3>
        <p className="helplines-subtitle">Available 24/7 for immediate assistance</p>
        <ul className="helplines-list">
          {helplines.map(h => (
            <li key={h.number} className="helpline-item">
              <div className="helpline-info">
                <div className="helpline-name">{h.name}</div>
                <a href={`tel:${h.number}`} className="helpline-number">{h.number}</a>
              </div>
              <a href={`tel:${h.number}`} className="btn-call">Call Now</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
