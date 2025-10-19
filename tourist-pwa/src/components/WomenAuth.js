import React, { useState } from 'react';
import axios from 'axios';
import './WomenAuth.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

axios.defaults.withCredentials = true;
axios.defaults.headers.common['ngrok-skip-browser-warning'] = 'true';

export default function WomenAuth({ onAuthSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [step, setStep] = useState(1); // 1: enter details, 2: verify OTP
  const [formData, setFormData] = useState({
    name: '',
    mobileNumber: '',
    aadhaarNumber: '',
    email: '',
    identifier: '', // for login
    otp: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
    setMessage('');
  };

  const handleRequestRegistrationOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (!formData.name || !formData.mobileNumber) {
      setError('Name and mobile number are required');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${BACKEND_URL}/api/women/auth/register/request-otp`, {
        name: formData.name,
        mobileNumber: formData.mobileNumber,
        aadhaarNumber: formData.aadhaarNumber || null,
        email: formData.email || null
      });

      if (response.data.success) {
        setMessage('OTP sent successfully! Check your SMS/Email.');
        setStep(2);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRegistrationOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (!formData.otp) {
      setError('Please enter the OTP');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${BACKEND_URL}/api/women/auth/register/verify-otp`, {
        mobileNumber: formData.mobileNumber,
        otp: formData.otp
      });

      if (response.data.success) {
        setMessage('Registration successful! You can now login.');
        // Auto switch to login mode after 2 seconds
        setTimeout(() => {
          setMode('login');
          setStep(1);
          setFormData({
            name: '',
            mobileNumber: '',
            aadhaarNumber: '',
            email: '',
            identifier: formData.mobileNumber,
            otp: ''
          });
        }, 2000);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestLoginOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (!formData.identifier) {
      setError('Please enter your mobile number or Aadhaar number');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${BACKEND_URL}/api/women/auth/login/request-otp`, {
        identifier: formData.identifier
      });

      if (response.data.success) {
        setMessage('OTP sent successfully! Check your SMS/Email.');
        setStep(2);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyLoginOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (!formData.otp) {
      setError('Please enter the OTP');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${BACKEND_URL}/api/women/auth/login/verify-otp`, {
        identifier: formData.identifier,
        otp: formData.otp
      });

      if (response.data.success) {
        setMessage('Login successful!');
        // Store user data in localStorage
        localStorage.setItem('WOMEN_USER', JSON.stringify(response.data.user));
        localStorage.setItem('WOMEN_USER_ID', response.data.user.id);
        localStorage.setItem('WOMEN_USER_MOBILE', response.data.user.mobileNumber);
        
        // Call parent callback
        if (onAuthSuccess) {
          onAuthSuccess(response.data.user);
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setStep(1);
    setError('');
    setMessage('');
    setFormData({
      name: '',
      mobileNumber: '',
      aadhaarNumber: '',
      email: '',
      identifier: '',
      otp: ''
    });
  };

  return (
    <div className="women-auth-container">
      <div className="women-auth-card">
        <div className="women-auth-header">
          <h2 className="women-auth-title">
            {mode === 'login' ? '👩 Women Safety Login' : '👩 Women Safety Registration'}
          </h2>
          <p className="women-auth-subtitle">
            {mode === 'login' 
              ? 'Access your safety dashboard securely' 
              : 'Create your account for enhanced safety features'}
          </p>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-success">{message}</div>}

        {mode === 'register' && step === 1 && (
          <form onSubmit={handleRequestRegistrationOTP} className="auth-form">
            <div className="form-group">
              <label htmlFor="name">Full Name *</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Enter your full name"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="mobileNumber">Mobile Number *</label>
              <input
                type="tel"
                id="mobileNumber"
                name="mobileNumber"
                value={formData.mobileNumber}
                onChange={handleChange}
                placeholder="+91 XXXXXXXXXX"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="aadhaarNumber">Aadhaar Number (Optional)</label>
              <input
                type="text"
                id="aadhaarNumber"
                name="aadhaarNumber"
                value={formData.aadhaarNumber}
                onChange={handleChange}
                placeholder="XXXX XXXX XXXX"
                maxLength="12"
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email (Optional)</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="your.email@example.com"
              />
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
          </form>
        )}

        {mode === 'register' && step === 2 && (
          <form onSubmit={handleVerifyRegistrationOTP} className="auth-form">
            <div className="form-group">
              <label htmlFor="otp">Enter OTP *</label>
              <input
                type="text"
                id="otp"
                name="otp"
                value={formData.otp}
                onChange={handleChange}
                placeholder="Enter 6-digit OTP"
                maxLength="6"
                required
              />
              <small className="form-hint">OTP sent to {formData.mobileNumber}</small>
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify & Register'}
            </button>

            <button 
              type="button" 
              className="auth-button-secondary" 
              onClick={() => setStep(1)}
              disabled={loading}
            >
              Back
            </button>
          </form>
        )}

        {mode === 'login' && step === 1 && (
          <form onSubmit={handleRequestLoginOTP} className="auth-form">
            <div className="form-group">
              <label htmlFor="identifier">Email Address *</label>
              <input
                type="email"
                id="identifier"
                name="identifier"
                value={formData.identifier}
                onChange={handleChange}
                placeholder="Enter your email address"
                required
              />
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
          </form>
        )}

        {mode === 'login' && step === 2 && (
          <form onSubmit={handleVerifyLoginOTP} className="auth-form">
            <div className="form-group">
              <label htmlFor="otp">Enter OTP *</label>
              <input
                type="text"
                id="otp"
                name="otp"
                value={formData.otp}
                onChange={handleChange}
                placeholder="Enter 6-digit OTP"
                maxLength="6"
                required
              />
              <small className="form-hint">OTP sent to your registered contact</small>
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>

            <button 
              type="button" 
              className="auth-button-secondary" 
              onClick={() => setStep(1)}
              disabled={loading}
            >
              Back
            </button>
          </form>
        )}

        <div className="auth-switch">
          <p>
            {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button 
              type="button" 
              className="auth-switch-link" 
              onClick={switchMode}
              disabled={loading}
            >
              {mode === 'login' ? 'Register' : 'Login'}
            </button>
          </p>
        </div>

        <div className="auth-info">
          <p>🔒 Your data is secure and encrypted</p>
          <p>📞 24/7 Emergency helplines available</p>
        </div>
      </div>
    </div>
  );
}
