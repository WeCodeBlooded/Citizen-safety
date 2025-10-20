import React from 'react';
import './Login.css';

export default function Login({ onLogin, onVerifyOtp, onSwitchToRegister, onSwitchToFamily, errorMessage, loadingLogin, email, setEmail, passportId, otp, setOtp, authState, serviceType, setServiceType, fetchProfile }) {

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    await onLogin();
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    if (!otp.trim()) return;
    await onVerifyOtp();
    // If main app still needs profile info (tourist flow), try to fetch it once.
    if (typeof fetchProfile === 'function') {
      try {
        const profile = await fetchProfile();
        if (profile && profile.service_type) {
          setServiceType(profile.service_type);
        }
      } catch (err) {
        console.warn('[Login] fetchProfile failed after OTP verification:', err?.message || err);
      }
    }
  };

  if (authState === "login") {
    const theme = serviceType || 'tourist_safety';
    return (
      <div className={`auth-screen has-brand theme-${theme}`}>
  <div className="auth-brand">SurakshaChakra</div>
        <div className="auth-subtag">Secure your journey. Rejoin your safety dashboard.</div>
        
        <form className="auth-card" onSubmit={handleLoginSubmit} noValidate>
          <h2 className="auth-title">Login</h2>
          <p className="auth-lead">Enter your registered email address to receive an OTP.</p>
          
          <div className="auth-form-fields">
            <div className="auth-field">
              <label>Email Address</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                required
                autoFocus
              />
              {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
            </div>
            
            <button
              className="auth-primary-btn"
              disabled={loadingLogin || !email.trim()}
              aria-busy={loadingLogin}
              type="submit"
            >
              {loadingLogin ? 'Sending OTP…' : 'Send OTP'}
            </button>
            
            <div className="auth-secondary-link">
              Don't have an account? <span onClick={onSwitchToRegister}>Register</span>
            </div>
            <div className="auth-inline-links">
              Or <span onClick={onSwitchToFamily}>Family Member Login</span>
            </div>
          </div>
        </form>
      </div>
    );
  }

  if (authState === "verifyOtp") {
    const theme = serviceType || 'tourist_safety';
    return (
      <div className={`auth-screen has-brand theme-${theme}`}>
  <div className="auth-brand">SurakshaChakra</div>
        <div className="auth-subtag">Enter the code sent to your registered email.</div>
        
        <form className="auth-card" onSubmit={handleOtpSubmit} noValidate>
          <h2 className="auth-title">Enter OTP</h2>
          <p className="auth-lead">We've sent a 6‑digit verification code.</p>
          
          <div className="auth-form-fields">
            <div className="auth-field">
              <label>Registered Email</label>
              <input
                value={email}
                readOnly
                placeholder="you@example.com"
                type="email"
              />
            </div>
            
            {passportId && (
              <div className="auth-field">
                <label>Account ID</label>
                <input value={passportId} readOnly placeholder="Assigned ID" type="text" />
              </div>
            )}

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
              {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
            </div>
            
            <button className="auth-primary-btn" disabled={!otp.trim()} type="submit">
              Login
            </button>
            
            <div className="auth-small-note">
              Didn't receive it? Check spam or request again later.
            </div>
          </div>
        </form>
      </div>
    );
  }

  return null;
}