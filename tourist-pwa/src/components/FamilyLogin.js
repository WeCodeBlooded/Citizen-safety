import React, { useState } from 'react';
import axios from 'axios';
import './FamilyLogin.css';

const FALLBACK_NGROK = "http://localhost:3001";
const DEFAULT_BACKEND = (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost')
  ? 'http://localhost:3001'
  : FALLBACK_NGROK;

function normalizeBackend(raw) {
  if (!raw || typeof raw !== 'string') return DEFAULT_BACKEND;
  let trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = 'http://' + trimmed.replace(/^\/*/, '');
  }
  trimmed = trimmed.replace(/\/$/, '');
  return trimmed;
}

const BACKEND_URL = (() => {
  let _rawBackend = DEFAULT_BACKEND;
  try {
    const stored = localStorage.getItem('BACKEND_URL');
    if (stored) _rawBackend = stored;
  } catch {}
  return normalizeBackend(_rawBackend);
})();

axios.defaults.withCredentials = true;
axios.defaults.headers.common['ngrok-skip-browser-warning'] = 'true';

function FamilyLogin({ onSuccess, onBack, serviceType, setServiceType, fetchFamilyInfo }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const requestOtp = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { 
      setError('Please enter the emergency email'); 
      return; 
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { 
      setError('Please enter a valid email address'); 
      return; 
    }
    setLoading(true);
    try {
      await axios.post(`${BACKEND_URL}/api/family/auth/request-otp`, { email }, { timeout: 8000 });
      setStep('otp');
    } catch (e2) {
      if (e2.response) {
        setError(e2.response.data?.message || `Server error (${e2.response.status})`);
      } else if (e2.request) {
        setError('Network error contacting server. Check BACKEND_URL and CORS.');
      } else {
        setError(e2.message || 'Failed to request OTP');
      }
    } finally { 
      setLoading(false); 
    }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    if (!otp.trim()) { 
      setError('Enter the OTP sent to email'); 
      return; 
    }
    if (otp.length !== 6) { 
      setError('OTP must be 6 digits'); 
      return; 
    }
    setLoading(true);
    try {
      const res = await axios.post(`${BACKEND_URL}/api/family/auth/verify-otp`, { email, otp }, { timeout: 8000 });
      const { token, passportId, name } = res.data || {};
      if (token) {
        localStorage.setItem('FAMILY_TOKEN', token);
        localStorage.setItem('FAMILY_TOURIST_PASSPORT', passportId || '');
        localStorage.setItem('FAMILY_TOURIST_NAME', name || '');
        if (typeof fetchFamilyInfo === 'function') {
          const info = await fetchFamilyInfo();
          if (info && info.service_type) {
            setServiceType(info.service_type);
          }
        }
        if (typeof onSuccess === 'function') onSuccess();
      } else {
        setError('Invalid response from server.');
      }
    } catch (e2) {
      if (e2.response) {
        setError(e2.response.data?.message || `Server error (${e2.response.status})`);
      } else if (e2.request) {
        setError('Network error contacting server.');
      } else {
        setError(e2.message || 'OTP verification failed');
      }
    } finally { 
      setLoading(false); 
    }
  };

  if (step === 'email') {
    const theme = serviceType || 'general_safety';
    return (
      <div className={`auth-screen has-brand theme-${theme}`}>
        <div className="auth-brand">Secure Safar</div>
        <div className="auth-subtag">Family access - securely view your loved one's safety status.</div>
        
        <form className="auth-card" onSubmit={requestOtp} noValidate>
          <h2 className="auth-title">Family Login</h2>
          <p className="auth-lead">Enter the emergency email to receive an OTP.</p>
          
          <div className="auth-form-fields">
            <div className="auth-field">
              <label>Emergency Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Tourist emergency email"
                type="email"
                required
                autoFocus
              />
              {error && <div className="auth-error" role="alert">{error}</div>}
            </div>
            
            <button
              className="auth-primary-btn"
              disabled={loading || !email.trim()}
              aria-busy={loading}
              type="submit"
            >
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
            
            <div className="auth-secondary-link">
              <span onClick={onBack}>Back to Tourist Login</span>
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={`auth-screen has-brand theme-${serviceType || 'general_safety'}`}>
      <div className="auth-brand">Secure Safar</div>
      <div className="auth-subtag">Verify family access for {email}</div>
      
      <form className="auth-card" onSubmit={verifyOtp} noValidate>
        <h2 className="auth-title">Enter OTP</h2>
        <p className="auth-lead">A 6-digit code was sent to the email above.</p>
        
        <div className="auth-form-fields">
          <div className="auth-field">
            <label>Emergency Email</label>
            <input value={email} readOnly type="email" />
          </div>
          
          <div className="auth-field">
            <label>OTP Code</label>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="Enter 6-digit OTP"
              type="text"
              maxLength="6"
              required
            />
            {error && <div className="auth-error" role="alert">{error}</div>}
          </div>
          
          <button
            className="auth-primary-btn"
            disabled={loading || !otp.trim()}
            aria-busy={loading}
            type="submit"
          >
            {loading ? 'Verifying...' : 'Access Dashboard'}
          </button>
          
          <div className="auth-inline-links">
            <span onClick={() => setStep('email')}>Change email</span>
            {' | '}
            <span onClick={onBack}>Back to Tourist Login</span>
          </div>
        </div>
      </form>
    </div>
  );
}

export default FamilyLogin;
