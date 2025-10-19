import React, { useState, useMemo } from 'react';
import axios from 'axios';
import '../ServiceRegistration.css';

const getBackend = () => {
  const FALLBACK = (typeof window !== 'undefined' && window.location.hostname === 'localhost') ? 'http://localhost:3001' : 'http://localhost:3001';
  let v = FALLBACK; 
  try { 
    const s = localStorage.getItem('BACKEND_URL'); 
    if (s) v = s.trim(); 
  } catch {}
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v;
};

const serviceModules = [
  {
    id: 'women_safety',
    label: 'Women Safety',
    icon: '👩',
    color: '#ec4899',
    bgGradient: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
    bgImage: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=1200&q=80',
    description: 'Emergency support, safe routes, and harassment reporting',
    features: ['24/7 Emergency SOS', 'Safe Route Finder', 'Quick Police Contact', 'Anonymous Reporting']
  },
  {
    id: 'tourist_safety',
    label: 'Tourist Safety',
    icon: '✈️',
    color: '#3b82f6',
    bgGradient: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
      bgImage: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1200&q=80',
    description: 'Location tracking, group monitoring, and travel alerts',
    features: ['Real-time Tracking', 'Group Coordination', 'Geofence Alerts', 'Travel Guidance']
  },
    {
    id: 'citizen_safety',
    label: 'Citizen Safety',
    icon: '🏘️',
    color: '#10b981',
    bgGradient: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
    bgImage: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1200&q=80',
    description: 'Community safety, local alerts, and incident reporting',
    features: ['Community Alerts', 'Neighborhood Watch', 'Local Incidents', 'Safety Tips']
  },
  {
    id: 'general_safety',
    label: 'General Safety',
    icon: '🛡️',
    color: '#8b5cf6',
    bgGradient: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
    bgImage: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&q=80',
    description: 'All-in-one safety platform with comprehensive features',
    features: ['All Features', 'Multi-Module Access', 'Emergency Services', 'Complete Protection']
  }
];

export default function ServiceRegistration({ onSuccess, onSwitchToLogin }) {
  const BACKEND_URL = useMemo(() => getBackend(), []);
  const [selectedService, setSelectedService] = useState('general_safety');
  const [step, setStep] = useState('select'); // select | register | verify
  const [form, setForm] = useState({
    name: '',
    email: '',
    passportId: '',
    emergencyContact: '',
  });
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const currentModule = serviceModules.find(m => m.id === selectedService) || serviceModules[3];
  const isTouristModule = selectedService === 'tourist_safety';
  const idFieldLabel = isTouristModule ? 'Passport Number' : 'Aadhaar Number';
  const idPlaceholder = isTouristModule ? 'AB1234567' : '1234 5678 9012';

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      // Register with selected service
      const res = await axios.post(`${BACKEND_URL}/api/v1/auth/register`, {
        name: form.name,
        email: form.email,
        passportId: form.passportId.trim(),
        phone: form.emergencyContact,
        service_type: selectedService,
        idType: isTouristModule ? 'passport' : 'aadhaar',
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });

      const nextService = res.data?.serviceType || selectedService;
      if (nextService && nextService !== selectedService) {
        setSelectedService(nextService);
      }

      if (res.data?.requiresVerification !== false) {
        setStep('verify');
      } else {
        onSuccess && onSuccess({ ...form, service_type: nextService });
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      await axios.post(`${BACKEND_URL}/api/v1/auth/verify-email`, {
        passportId: form.passportId,
        code: otp,
        serviceType: selectedService,
        email: form.email,
      }, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      
      onSuccess && onSuccess({ ...form, service_type: selectedService });
    } catch (err) {
      setError(err?.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'verify') {
    return (
      <div className="service-registration-container" style={{ background: currentModule.bgGradient }}>
        <div className="service-registration-card">
          <div className="service-header" style={{ borderLeftColor: currentModule.color }}>
            <span className="service-icon" style={{ fontSize: 48 }}>{currentModule.icon}</span>
            <h2>{currentModule.label}</h2>
            <p className="service-subtitle">Verify your email</p>
          </div>
          
          <form onSubmit={handleVerifyOTP} className="registration-form">
            {error && <div className="error-message">{error}</div>}
            
            <p style={{ textAlign: 'center', marginBottom: 16, color: '#6b7280' }}>
              Enter the 6-digit code sent to <strong>{form.email}</strong>
            </p>
            
            <input
              type="text"
              placeholder="Enter OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              maxLength={6}
              required
              style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
            />
            
            <button type="submit" disabled={loading} className="primary-button" style={{ backgroundColor: currentModule.color }}>
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </button>
            
            <button type="button" onClick={() => setStep('register')} className="secondary-button">
              Back to Registration
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 'register') {
    return (
      <div 
        className="service-registration-container" 
        style={{ 
          backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${currentModule.bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        <div className="service-registration-card">
          <div className="service-header" style={{ borderLeftColor: currentModule.color }}>
            <span className="service-icon" style={{ fontSize: 48 }}>{currentModule.icon}</span>
            <h2>{currentModule.label}</h2>
            <p className="service-subtitle">{currentModule.description}</p>
          </div>
          
          <form onSubmit={handleRegister} className="registration-form">
            {error && <div className="error-message">{error}</div>}
            
            <label>Full Name</label>
            <input
              type="text"
              placeholder="Enter your full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            
            <label>Email Address</label>
            <input
              type="email"
              placeholder="your.email@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            
            <label>{idFieldLabel}</label>
            <input
              type="text"
              placeholder={idPlaceholder}
              value={form.passportId}
              onChange={(e) => setForm({ ...form, passportId: e.target.value })}
              required
            />
            
            <label>Emergency Contact</label>
            <input
              type="tel"
              placeholder="+1234567890"
              value={form.emergencyContact}
              onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
              required
            />
            
            <button type="submit" disabled={loading} className="primary-button" style={{ backgroundColor: currentModule.color }}>
              {loading ? 'Registering...' : 'Register'}
            </button>
            
            <button type="button" onClick={() => setStep('select')} className="secondary-button">
              Change Service
            </button>
          </form>
          
          <div className="login-link">
            Already have an account? <button onClick={onSwitchToLogin} className="link-button">Login</button>
          </div>
        </div>
      </div>
    );
  }

  // Service selection screen
  return (
    <div className="service-selection-container">
      <div className="service-selection-header">
        <h1 className="main-title">Choose Your Safety Service</h1>
        <p className="main-subtitle">Select the service that best fits your needs</p>
      </div>
      
      <div className="service-grid">
        {serviceModules.map(module => (
          <div
            key={module.id}
            className={`service-card ${selectedService === module.id ? 'selected' : ''}`}
            onClick={() => setSelectedService(module.id)}
            style={{
              borderColor: selectedService === module.id ? module.color : '#e5e7eb',
              backgroundColor: selectedService === module.id ? `${module.color}10` : '#fff'
            }}
          >
            <div className="service-card-icon" style={{ backgroundColor: module.color }}>
              {module.icon}
            </div>
            <h3 className="service-card-title">{module.label}</h3>
            <p className="service-card-description">{module.description}</p>
            <ul className="service-card-features">
              {module.features.map((feature, idx) => (
                <li key={idx}>
                  <span style={{ color: module.color }}>✓</span> {feature}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      
      <div className="service-selection-actions">
        <button
          className="primary-button large"
          onClick={() => setStep('register')}
          style={{ backgroundColor: currentModule.color }}
        >
          Continue with {currentModule.label}
        </button>
        
        <div className="login-link">
          Already have an account? <button onClick={onSwitchToLogin} className="link-button">Login</button>
        </div>
      </div>
    </div>
  );
}
