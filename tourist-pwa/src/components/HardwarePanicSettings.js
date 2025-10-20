import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './HardwarePanicSettings.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

const HardwarePanicSettings = ({ passportId }) => {
  const [settings, setSettings] = useState({
    enabled: true,
    trigger_method: 'volume_up_3x',
    custom_pattern: '',
    sensitivity: 'medium',
    confirmation_required: false,
    auto_record_audio: true,
    auto_share_location: true,
    vibration_feedback: true
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadSettings();
    loadStats();
  }, [passportId]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${BACKEND_URL}/api/v1/hardware-panic/settings`,
        { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } }
      );
      
      if (response.data.success) {
        setSettings(response.data.settings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      setMessage('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await axios.get(
        `${BACKEND_URL}/api/v1/hardware-panic/stats`,
        { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } }
      );
      
      if (response.data.success) {
        setStats(response.data.stats);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage('');

      const response = await axios.post(
        `${BACKEND_URL}/api/v1/hardware-panic/settings`,
        settings,
        { withCredentials: true, headers: { 'ngrok-skip-browser-warning': 'true' } }
      );

      if (response.data.success) {
        setMessage('Settings saved successfully!');
        setTimeout(() => setMessage(''), 3000);
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (field) => {
    setSettings(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const handleChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (loading) {
    return (
      <div className="hardware-panic-settings loading">
        <div className="spinner"></div>
        <p>Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="hardware-panic-settings">
      <div className="settings-header">
        <h2>🔘 Hardware Panic Trigger</h2>
        <p className="settings-description">
          Configure emergency panic alerts triggered by volume or power button patterns.
          Perfect for situations when you can't access your screen.
        </p>
      </div>

      {message && (
        <div className={`settings-message ${message.includes('Failed') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      <div className="settings-section">
        <div className="setting-item">
          <div className="setting-header">
            <label htmlFor="enabled">Enable Hardware Panic Trigger</label>
            <button
              type="button"
              className={`toggle-switch ${settings.enabled ? 'active' : ''}`}
              onClick={() => handleToggle('enabled')}
              aria-label="Toggle hardware panic"
            >
              <span className="toggle-slider"></span>
            </button>
          </div>
          <p className="setting-help">
            When enabled, rapid button presses will trigger a panic alert
          </p>
        </div>

        <div className="setting-item">
          <label htmlFor="trigger_method">Trigger Pattern</label>
          <select
            id="trigger_method"
            value={settings.trigger_method}
            onChange={(e) => handleChange('trigger_method', e.target.value)}
            disabled={!settings.enabled}
            className="setting-select"
          >
            <option value="volume_up_3x">Volume Up (3 times)</option>
            <option value="volume_down_3x">Volume Down (3 times)</option>
            <option value="volume_up_5x">Volume Up (5 times)</option>
            <option value="power_5x">Power Button (5 times)</option>
            <option value="pattern_combo">Custom Pattern</option>
          </select>
          <p className="setting-help">
            Choose the button pattern that will trigger the panic alert
          </p>
        </div>

        {settings.trigger_method === 'pattern_combo' && (
          <div className="setting-item">
            <label htmlFor="custom_pattern">Custom Pattern</label>
            <input
              type="text"
              id="custom_pattern"
              value={settings.custom_pattern}
              onChange={(e) => handleChange('custom_pattern', e.target.value)}
              placeholder="e.g., volume_up_2x_volume_down_1x"
              disabled={!settings.enabled}
              className="setting-input"
            />
            <p className="setting-help">
              Define your own button pattern (advanced)
            </p>
          </div>
        )}

        <div className="setting-item">
          <label htmlFor="sensitivity">Detection Sensitivity</label>
          <select
            id="sensitivity"
            value={settings.sensitivity}
            onChange={(e) => handleChange('sensitivity', e.target.value)}
            disabled={!settings.enabled}
            className="setting-select"
          >
            <option value="low">Low (5 seconds window)</option>
            <option value="medium">Medium (3 seconds window)</option>
            <option value="high">High (2 seconds window)</option>
          </select>
          <p className="setting-help">
            Lower sensitivity gives you more time between button presses
          </p>
        </div>

        <div className="setting-item">
          <div className="setting-header">
            <label htmlFor="confirmation_required">Require Confirmation</label>
            <button
              type="button"
              className={`toggle-switch ${settings.confirmation_required ? 'active' : ''}`}
              onClick={() => handleToggle('confirmation_required')}
              disabled={!settings.enabled}
              aria-label="Toggle confirmation"
            >
              <span className="toggle-slider"></span>
            </button>
          </div>
          <p className="setting-help">
            Show confirmation dialog before sending panic alert (prevents accidental triggers)
          </p>
        </div>

        <div className="setting-item">
          <div className="setting-header">
            <label htmlFor="auto_record_audio">Auto-Record Audio</label>
            <button
              type="button"
              className={`toggle-switch ${settings.auto_record_audio ? 'active' : ''}`}
              onClick={() => handleToggle('auto_record_audio')}
              disabled={!settings.enabled}
              aria-label="Toggle auto record"
            >
              <span className="toggle-slider"></span>
            </button>
          </div>
          <p className="setting-help">
            Automatically start recording audio when panic is triggered
          </p>
        </div>

        <div className="setting-item">
          <div className="setting-header">
            <label htmlFor="auto_share_location">Auto-Share Location</label>
            <button
              type="button"
              className={`toggle-switch ${settings.auto_share_location ? 'active' : ''}`}
              onClick={() => handleToggle('auto_share_location')}
              disabled={!settings.enabled}
              aria-label="Toggle auto share"
            >
              <span className="toggle-slider"></span>
            </button>
          </div>
          <p className="setting-help">
            Automatically share your live location with emergency contacts
          </p>
        </div>

        <div className="setting-item">
          <div className="setting-header">
            <label htmlFor="vibration_feedback">Vibration Feedback</label>
            <button
              type="button"
              className={`toggle-switch ${settings.vibration_feedback ? 'active' : ''}`}
              onClick={() => handleToggle('vibration_feedback')}
              disabled={!settings.enabled}
              aria-label="Toggle vibration"
            >
              <span className="toggle-slider"></span>
            </button>
          </div>
          <p className="setting-help">
            Device vibrates when buttons are pressed (confirms detection)
          </p>
        </div>
      </div>

      {stats && (
        <div className="settings-section stats-section">
          <h3>📊 Usage Statistics</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.total_triggers || 0}</div>
              <div className="stat-label">Total Triggers</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.alerts_sent || 0}</div>
              <div className="stat-label">Alerts Sent</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.volume_up_triggers || 0}</div>
              <div className="stat-label">Volume Up</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.power_triggers || 0}</div>
              <div className="stat-label">Power Button</div>
            </div>
          </div>
          {stats.last_trigger_at && (
            <p className="last-trigger">
              Last trigger: {new Date(stats.last_trigger_at).toLocaleString()}
            </p>
          )}
        </div>
      )}

      <div className="settings-info-box">
        <h4>ℹ️ How It Works</h4>
        <ul>
          <li>Press the configured button pattern rapidly (within the time window)</li>
          <li>Your device will vibrate to confirm each button press</li>
          <li>Once the pattern is complete, a panic alert is automatically sent</li>
          <li>Works even when your phone screen is off or locked</li>
          <li>Perfect for discreet emergency situations</li>
        </ul>
      </div>

      <div className="settings-actions">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-save"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

export default HardwarePanicSettings;
