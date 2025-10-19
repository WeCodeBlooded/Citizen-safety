import React from 'react';
import './register.css';

export default function EmailVerification({ email, passportId, code, setCode, onVerifyEmail, errorMessage }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    onVerifyEmail();
  };

  return (
  <div className="auth-screen has-brand">
      <div className="auth-brand">Secure Safar</div>
      <div className="auth-subtag">Finish signup — verify your identity securely.</div>
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <h2 className="auth-title">Verify Your Email</h2>
        <p className="auth-lead">Enter the 6‑digit code sent to <strong>{email}</strong>.</p>
        <div className="auth-form-fields">
          <div className="auth-field">
            <label>Account ID</label>
            <input value={passportId} readOnly type="text" placeholder="Passport / Aadhaar" />
          </div>
          <div className="auth-field">
            <label>Verification Code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter 6-digit code"
              type="text"
              maxLength="6"
              required
            />
            {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
          </div>
          <button className="auth-primary-btn" disabled={!code.trim()} type="submit">Verify Email</button>
          <div className="auth-small-note">Didn't receive it? Check spam or wait a moment.</div>
        </div>
      </form>
    </div>
  );
}