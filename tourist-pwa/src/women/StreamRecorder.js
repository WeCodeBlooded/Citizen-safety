import React, { useEffect, useRef, useState } from 'react';

// Utility to get backend origin from same logic used elsewhere
const getBackendURL = () => {
  try {
    const stored = localStorage.getItem('BACKEND_URL');
    if (stored && stored.trim()) return stored.trim();
  } catch {}
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
    return `${window.location.protocol}//${host}:3001`;
  }
  return 'http://localhost:3001';
};

// Build identity payload compatible with backend womenService extractors
const buildIdentity = (user) => {
  if (!user) return {};
  const payload = {};
  if (user.passportId) payload.passportId = user.passportId;
  if (user.id) { payload.userId = user.id; payload.user_id = user.id; }
  if (user.email) payload.email = user.email;
  if (user.mobileNumber) { payload.mobileNumber = user.mobileNumber; payload.mobile = user.mobileNumber; }
  return payload;
};

export default function StreamRecorder({ currentUser, onStarted, onEnded }) {
  const [session, setSession] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const seqRef = useRef(0);
  const videoRef = useRef(null);

  useEffect(() => {
    return () => {
      try { if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop(); } catch {}
      try { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); } catch {}
    };
  }, []);

  const start = async () => {
    const backend = getBackendURL();
    // Ensure WOMEN- prefixed passport id if possible
    const identity = buildIdentity(currentUser || {});
    if (!identity.passportId && identity.userId) identity.passportId = `WOMEN-${identity.userId}`;

    // Create session
    const res = await fetch(`${backend}/api/women/stream/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      credentials: 'include',
      body: JSON.stringify(identity)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || 'Failed to start stream');
    setSession(data.session);
    if (onStarted) onStarted(data.session);

    // Capture media
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    streamRef.current = mediaStream;
    if (videoRef.current) videoRef.current.srcObject = mediaStream;
    const mr = new MediaRecorder(mediaStream, { mimeType: 'video/webm;codecs=vp8,opus' });
    mediaRecorderRef.current = mr;
    seqRef.current = 0;

    mr.ondataavailable = async (ev) => {
      if (!ev.data || !ev.data.size) return;
      const chunk = ev.data;
      const form = new FormData();
      form.append('chunk', chunk, `chunk-${seqRef.current}.webm`);
      form.append('sequence', String(seqRef.current));
      form.append('fileBase', `women-${data.session.id}-${Date.now()}-${seqRef.current}`);
      // Include identity for attribution if backend wants to double-check
      Object.entries(identity).forEach(([k,v]) => form.append(k, v));
      try {
        await fetch(`${backend}/api/women/stream/${data.session.id}/chunk`, {
          method: 'POST',
          body: form,
          credentials: 'include'
        });
      } catch (e) {
        console.warn('Failed to upload media chunk:', e?.message || e);
      }
      seqRef.current += 1;
    };
    mr.start(3000); // 3s chunks
    setIsRecording(true);
  };

  const stop = async () => {
    try { if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop(); } catch {}
    try { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); } catch {}
    setIsRecording(false);
    const s = session;
    setSession(null);
    if (s) {
      const backend = getBackendURL();
      try {
        await fetch(`${backend}/api/women/stream/${s.id}/end`, { method: 'POST', credentials: 'include' });
      } catch (e) { console.warn('Failed to end session:', e?.message || e); }
      if (onEnded) onEnded(s);
    }
  };

  return (
    <div style={{ border: '1px solid #e91e63', borderRadius: 8, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Women Safety: Live Stream</h3>
      <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', maxHeight: 240, background: '#000', borderRadius: 6 }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        {!isRecording && <button onClick={start} style={{ background: '#e91e63', color: '#fff', padding: '8px 12px', border: 0, borderRadius: 4 }}>Start Streaming</button>}
        {isRecording && <button onClick={stop} style={{ background: '#111827', color: '#fff', padding: '8px 12px', border: 0, borderRadius: 4 }}>Stop</button>}
      </div>
      {session && <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>Session #{session.id} active…</div>}
    </div>
  );
}
