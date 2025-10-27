import React, { useState } from 'react';
import axios from 'axios';
import './register.css';

const HIGHLIGHT_CARDS = [
  {
    id: 'create-account',
    accent: 'accent-plum',
    title: 'Create Account',
    bullets: [
      'Quick setup — stay protected wherever you go.',
      'Data encrypted • Privacy-first • Works offline'
    ]
  },
  {
    id: 'location-sharing',
    accent: 'accent-blue',
    title: 'Location sharing',
    bullets: [
      'Enable real-time safety & geofence alerts.',
      'Receive urgent notifications instantly.'
    ]
  },
  {
    id: 'suraksha',
    accent: 'accent-mint',
    title: 'SurakshaChakra',
    bullets: [
      'Discover safely. Stay connected. Travel smart.',
      'You\'re protected'
    ]
  },
  {
    id: 'dashboard',
    accent: 'accent-violet',
    title: 'Go to Dashboard',
    bullets: [
      'Already registered? Login here',
      'Quick setup — stay protected wherever you go.'
    ]
  }
];


const FALLBACK_NGROK = process.env.REACT_APP_BACKEND_URL;
const DEFAULT_BACKEND = (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost')
  ? process.env.REACT_APP_BACKEND_URL
  : FALLBACK_NGROK;
let _rawBackend = DEFAULT_BACKEND;
try { const v = localStorage.getItem('BACKEND_URL'); if (v) _rawBackend = v; } catch {}
const BACKEND_URL = (typeof _rawBackend === 'string' ? _rawBackend.trim() : DEFAULT_BACKEND) || DEFAULT_BACKEND;


axios.defaults.withCredentials = true;
axios.defaults.headers.common['ngrok-skip-browser-warning'] = 'true';

export default function RegisterForm({ onRegistered, onSwitchToLogin }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    passportId: '',
    locationOptIn: true,
    smsOptIn: true,
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPermission, setShowPermission] = useState(false);
  const [registered, setRegistered] = useState(false);


  function validate() {
    const e = {};
  if (!form.name.trim()) e.name = 'Please enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Please enter a valid email address.';
  if (!form.phone || !form.phone.trim()) e.phone = 'Please enter your phone number.';
  if (!form.passportId || !form.passportId.trim()) e.passportId = 'Please enter your government ID.';
    return e;
  }

  function isFormValid() {
    return form.name.trim() && 
           /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && 
           form.phone.trim() && 
           form.passportId.trim();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const eErrors = validate();
    setErrors(eErrors);
    if (Object.keys(eErrors).length) return;
    setLoading(true);
    
    try {
      
      await axios.post(`${BACKEND_URL}/api/v1/auth/register`, {
        name: form.name,
        email: form.email,
        passportId: form.passportId,
        phone: form.phone,
        emergencyContact: form.phone, 
        locationOptIn: form.locationOptIn,
        smsOptIn: form.smsOptIn
      });
      
      setLoading(false);
      
      
      setErrors({});
      
      
      if (form.locationOptIn) {
        setShowPermission(true);
      } else {
        setRegistered(true);
        onRegistered && onRegistered(form);
      }
    } catch (err) {
      setLoading(false);
      
      
      if (err.response?.data?.errors && Array.isArray(err.response.data.errors)) {
        
        const validationErrors = {};
        err.response.data.errors.forEach(error => {
          if (error.path === 'email') validationErrors.email = error.msg;
          else if (error.path === 'name') validationErrors.name = error.msg;
          else if (error.path === 'passportId') validationErrors.passportId = error.msg;
          else if (error.path === 'phone') validationErrors.phone = error.msg;
          else validationErrors.general = error.msg;
        });
        setErrors(validationErrors);
      } else {
        
        const errorMessage = err.response?.data?.message || 'Registration failed. Please try again.';
        setErrors({ general: errorMessage });
      }
      
      console.error('Registration error:', err);
    }
  }

  function handleAllowLocation() {
    
    setShowPermission(false);
    setRegistered(true);
    onRegistered && onRegistered(form);
  }

  return (
  <div className="registration-screen">
    <div className="registration-wrapper">
      <div className="registration-branding">
        <div className="registration-logo">SurakshaChakra</div>
        <div className="registration-tagline">Discover safely. Stay connected. Travel smart.</div>
      </div>

      {!registered ? (
        <form className="registration-card" onSubmit={handleSubmit} noValidate>
          <header className="registration-header">
            <h1><strong>Choose Your Safety Service</strong></h1>
            <p className="registration-header-sub">Select the service that best fits your needs.</p>
            <p className="registration-header-note">Quick setup — stay protected wherever you go.</p>
          </header>

          {errors.general && (
            <div className="registration-inline-error" role="alert">
              {errors.general}
            </div>
          )}

          <div className="registration-service-grid" aria-hidden="true">
            {HIGHLIGHT_CARDS.map(card => (
              <div className={`registration-service-card ${card.accent}`} key={card.id}>
                <div className="registration-service-title">{card.title}</div>
                <ul className="registration-service-points">
                  {card.bullets.map((point, idx) => (
                    <li key={`${card.id}-${idx}`}>{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="registration-fields-grid">
            <div className={`registration-field ${errors.name ? 'has-error' : ''}`}>
              <label htmlFor="register-name">Full name</label>
              <input
                id="register-name"
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Full name"
                aria-invalid={!!errors.name}
              />
              {errors.name && <div className="registration-error">{errors.name}</div>}
            </div>

            <div className={`registration-field ${errors.email ? 'has-error' : ''}`}>
              <label htmlFor="register-email">Email address</label>
              <input
                id="register-email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="Email address"
                type="email"
                aria-invalid={!!errors.email}
              />
              {errors.email && <div className="registration-error">{errors.email}</div>}
            </div>

            <div className={`registration-field ${errors.phone ? 'has-error' : ''}`}>
              <label htmlFor="register-phone">Phone number</label>
              <input
                id="register-phone"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone number"
                type="tel"
                aria-invalid={!!errors.phone}
              />
              {errors.phone && <div className="registration-error">{errors.phone}</div>}
            </div>

            <div className={`registration-field ${errors.passportId ? 'has-error' : ''}`}>
              <label htmlFor="register-passport">Government ID</label>
              <input
                id="register-passport"
                type="text"
                value={form.passportId}
                onChange={e => setForm({ ...form, passportId: e.target.value })}
                placeholder="Passport/Aadhaar Number"
                aria-invalid={!!errors.passportId}
              />
              {errors.passportId && <div className="registration-error">{errors.passportId}</div>}
            </div>
          </div>

          <div className="registration-checkboxes">
            <label className="registration-checkbox">
              <input
                type="checkbox"
                checked={form.locationOptIn}
                onChange={e => setForm({ ...form, locationOptIn: e.target.checked })}
              />
              <span><strong>Location sharing</strong><br />Enable real-time safety & geofence alerts.</span>
            </label>
            <label className="registration-checkbox">
              <input
                type="checkbox"
                checked={form.smsOptIn}
                onChange={e => setForm({ ...form, smsOptIn: e.target.checked })}
              />
              <span><strong>SMS alerts</strong><br />Receive urgent notifications instantly.</span>
            </label>
          </div>

          <button
            className="registration-primary"
            disabled={loading || !isFormValid()}
            aria-busy={loading}
            type="submit"
          >
            {loading ? 'Creating…' : 'Create Account'}
          </button>

          <div className="registration-secondary">
            Already registered? <span onClick={() => onSwitchToLogin && onSwitchToLogin()}>Login here</span>
          </div>
          <div className="registration-note">Data encrypted • Privacy-first • Works offline</div>
        </form>
      ) : (
        <div className="registration-card registration-success" role="status">
          <div className="registration-success-icon" aria-hidden="true" />
          <h2>You're protected</h2>
          <p>Smart safety features are active. We'll alert you when needed.</p>
          <button className="registration-primary" onClick={() => window.location.replace('/')}>Go to Dashboard</button>
        </div>
      )}

      {showPermission && (
        <div className="rt-modal" role="dialog" aria-modal="true" style={{ zIndex: 50 }}>
          <div className="rt-modal-card">
            <h3>Enable location</h3>
            <p>Allow location to receive geofence alerts and nearby safety notifications while using the app.</p>
            <div className="rt-cta-row">
              <button className="rt-cta" onClick={handleAllowLocation}>Allow</button>
              <button className="rt-ghost" onClick={() => { setShowPermission(false); setRegistered(true); }}>Not now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}
