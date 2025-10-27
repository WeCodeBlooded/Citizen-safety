import React from 'react';
import './RedesignHome.css';

export default function RedesignHome() {
  return (
    <div className="redesign-root">
      <header className="redesign-header">
        <div className="redesign-brand">
          <div className="redesign-logo">TS</div>
          <div>
            <div className="redesign-title">Tourist Safety</div>
            <div className="redesign-sub">Preview redesign — safe, fast, local</div>
          </div>
        </div>
        <nav className="redesign-nav">
          <a href="/?" className="btn btn-light">Open App</a>
          <button className="btn btn-primary" onClick={() => { try { localStorage.setItem('USE_REDESIGN','1'); alert('Redesign persisted. Reload to keep showing redesign.'); } catch(e){}}}>Keep redesign</button>
        </nav>
      </header>

      <main className="redesign-main">
        <section className="hero">
          <h1>Welcome to the refreshed Tourist PWA</h1>
          <p>A clean, mobile-first redesign mock that focuses on clarity, quick access to SOS, and easy navigation.</p>
          <div className="hero-cta">
            <a className="btn btn-cta" href="/?">Open current app</a>
            <a className="btn btn-ghost" href="#features">See features</a>
          </div>
        </section>

        <section id="features" className="features">
          <div className="feature">
            <h3>Fast SOS</h3>
            <p>One-tap panic activation and real-time location sharing.</p>
          </div>
          <div className="feature">
            <h3>Nearby Help</h3>
            <p>Find safe zones, helplines, and crowd-sourced assistance nearby.</p>
          </div>
          <div className="feature">
            <h3>Offline Ready</h3>
            <p>Queue alerts offline and sync when you're back online.</p>
          </div>
        </section>
      </main>

      <footer className="redesign-footer">
        <small>Local preview — no backend calls made from this page.</small>
      </footer>
    </div>
  );
}
