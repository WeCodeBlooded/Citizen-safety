import React, { useEffect, useState } from 'react';
import axios from 'axios';

const OfflineSOS = ({ passportId, backendUrl }) => {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('I need help. My location: ');
  const [status, setStatus] = useState(null);
  const [queue, setQueue] = useState([]);

  const fetchQueue = async () => {
    try {
      const res = await axios.get(`${backendUrl}/api/v1/alert/sms-queue`);
      if (res.data && res.data.items) setQueue(res.data.items);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => { fetchQueue(); }, []);

  const handleEnqueue = async () => {
    try {
      setStatus('enqueueing');
      const payload = { passportId, phoneNumber: phone, message };
      await axios.post(`${backendUrl}/api/v1/alert/enqueue-sms`, payload, { headers: { 'ngrok-skip-browser-warning': 'true' } });
      setStatus('queued');
      setPhone('');
      fetchQueue();
    } catch (e) {
      setStatus('error');
      console.error('enqueue failed', e?.message || e);
    }
  };

  const handleProcess = async () => {
    try {
      setStatus('processing');
      const res = await axios.post(`${backendUrl}/api/v1/alert/process-sms-queue`, {}, { headers: { 'ngrok-skip-browser-warning': 'true' } });
      setStatus('processed');
      fetchQueue();
      return res.data;
    } catch (e) {
      setStatus('error');
      console.error('process failed', e?.message || e);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <h4>Offline SOS (SMS/USSD)</h4>
      <p className="muted">Send or enqueue a fallback SMS/USSD when data connectivity is poor.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (e.g. +911234567890)" />
        <button onClick={handleEnqueue} className="tourist-link-button">Enqueue</button>
        <button onClick={handleProcess} className="tourist-link-button">Process Queue</button>
      </div>
      <div style={{ marginTop: 8 }}>
        <strong>Status:</strong> {status || 'idle'}
      </div>
      <div style={{ marginTop: 12 }}>
        <strong>Recent queue items:</strong>
        <ul style={{ maxHeight: 220, overflow: 'auto', paddingLeft: 18 }}>
          {queue.slice(0,20).map(item => (
            <li key={item.id}><strong>{item.phone_number}</strong> — {item.status} — {new Date(item.created_at).toLocaleString()}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default OfflineSOS;
