import React, { useState, useCallback } from 'react';
import axios from 'axios';

export default function FakeCallEscape({ email, aadhaarNumber }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [recent, setRecent] = useState([]);

  async function triggerEvent(type) {
    setLoading(true);
    setStatus('');
    try {
      const res = await axios.post('/api/women/fake-event', { email, aadhaarNumber, event_type: type });
      setStatus(type === 'fake_call' ? 'Fake call triggered!' : 'Silent alert sent!');
      fetchRecent();
      // Simulate fake call UI (browser only)
      if (type === 'fake_call') {
        window.alert('Incoming call: "Mom"\nTap to answer or decline.');
      }
    } catch (e) {
      setStatus('Failed to trigger event');
    }
    setLoading(false);
  }

  const fetchRecent = useCallback(async () => {
    try {
      const res = await axios.get('/api/women/fake-events', { params: { email, aadhaarNumber } });
      setRecent(res.data.events || []);
    } catch {}
  }, [email, aadhaarNumber]);

  React.useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  return (
    <div className="fake-call-escape">
      <h3>Escape Tools</h3>
      <div className="escape-actions">
        <button className="btn-fake-call" disabled={loading} onClick={() => triggerEvent('fake_call')}>Generate Fake Call</button>
        <button className="btn-silent-alert" disabled={loading} onClick={() => triggerEvent('silent_alert')}>Send Silent Alert</button>
      </div>
      {status && <div className="escape-status">{status}</div>}
      <div className="recent-escapes">
        <h4>Recent Escape Events</h4>
        <ul>
          {recent.map(ev => (
            <li key={ev.id}>
              <b>{ev.event_type === 'fake_call' ? 'Fake Call' : 'Silent Alert'}</b> - {ev.status} ({new Date(ev.created_at).toLocaleString()})
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
