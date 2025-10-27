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
      <div className={`login-screen theme-${theme}`}>
        <div className="login-shell">
          <div className="login-brand-block">
            <div className="login-logo">SurakshaChakra</div>
            <div className="login-tagline">Secure your journey. Rejoin your safety dashboard.</div>
          </div>

          <form className="login-card" onSubmit={handleLoginSubmit} noValidate>
            <header className="login-card-header">
              <h1>Login</h1>
              <p>Enter your registered email address to receive an OTP.</p>
            </header>

            <div className="login-field">
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                required
                autoFocus
              />
              {errorMessage && <div className="login-error" role="alert">{errorMessage}</div>}
            </div>

            <button
              className="login-primary"
              disabled={loadingLogin || !email.trim()}
              aria-busy={loadingLogin}
              type="submit"
            >
              {loadingLogin ? 'Sending OTP…' : 'Send OTP'}
            </button>

            <div className="login-links">
              <span className="login-link" onClick={onSwitchToRegister}>Don't have an account? Register</span>
              <span className="login-link muted" onClick={onSwitchToFamily}>Family member login</span>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (authState === "verifyOtp") {
    const theme = serviceType || 'tourist_safety';
    return (
      <div className={`login-screen theme-${theme}`}>
        <div className="login-shell">
          <div className="login-brand-block">
            <div className="login-logo">SurakshaChakra</div>
            <div className="login-tagline">Enter the code sent to your registered email.</div>
          </div>

          <form className="login-card" onSubmit={handleOtpSubmit} noValidate>
            <header className="login-card-header">
              <h1>Enter OTP</h1>
              <p>We've sent a 6-digit verification code.</p>
            </header>

            <div className="login-field">
              <label>Registered email</label>
              <input
                value={email}
                readOnly
                placeholder="you@example.com"
                type="email"
              />
            </div>

            {passportId && (
              <div className="login-field">
                <label>Account ID</label>
                <input value={passportId} readOnly placeholder="Assigned ID" type="text" />
              </div>
            )}

            <div className="login-field">
              <label htmlFor="login-otp">OTP code</label>
              <input
                id="login-otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 6-digit OTP"
                type="text"
                maxLength="6"
                required
              />
              {errorMessage && <div className="login-error" role="alert">{errorMessage}</div>}
            </div>

            <button className="login-primary" disabled={!otp.trim()} type="submit">
              Login
            </button>

            <div className="login-note">Didn't receive it? Check spam or request again later.</div>
          </form>
        </div>
      </div>
    );
  }

  return null;
}