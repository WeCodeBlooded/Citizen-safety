
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import COUNTRIES from './countries';
import './App.css';
import './ProfileForm.css';

const MAX_FILE_MB = 5;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;


const Field = ({ label, htmlFor, children, required }) => (
  <div className="form-field">
    <label htmlFor={htmlFor} className="form-label">
      {label} {required && <span className="required">*</span>}
    </label>
    {children}
  </div>
);

const ErrorText = ({ children }) => (
  <div className="error-message" style={{ marginTop: 4 }}>{children}</div>
);

export default function ProfileForm({ backendUrl, initialEmail = '', initialPassportId = '' }) {
  const BACKEND_URL = useMemo(() => (backendUrl || ''), [backendUrl]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [errors, setErrors] = useState({});
  const [serverFiles, setServerFiles] = useState({ passportMain: null, passportSecondary: null, visaDetails: null });
  const [profileComplete, setProfileComplete] = useState(false);
  const [serviceType, setServiceType] = useState(() => {
    try { return localStorage.getItem('SERVICE_TYPE') || ''; } catch { return ''; }
  });
  // Try to read Women user context to enable email/Aadhaar lookup when no passportId exists
  const womenUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('WOMEN_USER');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  const [form, setForm] = useState({
    fullName: '',
    contactNumber: '',
    email: initialEmail || (womenUser?.email || ''),
    passportId: initialPassportId || '',
    country: '',
    visaId: '',
    visaExpiry: '',
    emergencyPhone1: '',
    emergencyEmail1: '',
    emergencyPhone2: '',
    emergencyEmail2: '',
    passportMain: null,
    passportSecondary: null, 
    visaDetails: null,
  });

  // (header badge is rendered in pf-meta below)

  
  useEffect(() => {
    const pid = (form.passportId || initialPassportId || '').trim();
    let cancelled = false;
    
    const toInputDate = (val) => {
      if (!val) return '';
      try {
        
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
        
        const d = new Date(val);
        if (isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      } catch { return ''; }
    };
    (async () => {
      try {
        // Build lookup params: prefer passportId; else email (and optionally Aadhaar) for non-tourist services
        const params = {};
        const svc = (serviceType || '').trim();
        if (pid) {
          params.passportId = pid;
        } else {
          // For women/general/citizen, allow email/Aadhaar lookup
          const emailLookup = (form.email || initialEmail || womenUser?.email || '').trim();
          if (emailLookup) params.email = emailLookup;
          const aadhaarLookup = womenUser?.aadhaarNumber || womenUser?.aadhaar_number || '';
          if (!params.email && aadhaarLookup) params.aadhaar = String(aadhaarLookup).trim();
        }
        if (svc) params.serviceType = svc;

        // If we still have neither passportId nor email/aadhaar, do not call yet
        if (!params.passportId && !params.email && !params.aadhaar) return;

        const res = await axios.get(`${BACKEND_URL}/api/user/profile`, {
          params,
          withCredentials: true,
          headers: { 'ngrok-skip-browser-warning': 'true' },
          timeout: 8000,
        });
  const d = res && res.data ? res.data : null;
        if (!d || cancelled) return;
        
        setForm(prev => ({
          ...prev,
          fullName: d.fullName || '',
          contactNumber: d.contactNumber || '',
          email: d.email || prev.email || '',
          passportId: d.passportId || pid,
          country: d.country || '',
          visaId: d.visaId || '',
          
          visaExpiry: toInputDate(d.visaExpiry || ''),
          emergencyPhone1: d.emergencyPhone1 || '',
          emergencyEmail1: d.emergencyEmail1 || '',
          emergencyPhone2: d.emergencyPhone2 || '',
          emergencyEmail2: d.emergencyEmail2 || '',
          
        }));
        if (d.files && typeof d.files === 'object') {
          setServerFiles({
            passportMain: d.files.passportMain || null,
            passportSecondary: d.files.passportSecondary || null,
            visaDetails: d.files.visaDetails || null,
          });
        }
        if (typeof d.profileComplete === 'boolean') setProfileComplete(d.profileComplete);
        if (d.serviceType) {
          setServiceType(d.serviceType);
          try { localStorage.setItem('SERVICE_TYPE', d.serviceType); } catch {}
        }
      } catch (e) {
        // Only set error if a lookup param was present and request failed
        setSuccess('');
        setErrors(prev => ({ ...prev, submit: prev.submit || 'Could not load saved profile details.' }));
      }
    })();
    return () => { cancelled = true; };
  }, [BACKEND_URL, form.passportId, initialPassportId, form.email, initialEmail, serviceType, womenUser]);

  
  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  
  const isTourist = (serviceType || '').toLowerCase() === 'tourist_safety';

  const validate = () => {
    const e = {};
    if (!form.fullName?.trim()) e.fullName = 'Full Name is required.';
    if (!form.contactNumber?.trim()) e.contactNumber = 'Contact Number is required.';
    if (!form.email?.trim()) e.email = 'Email is required.';
    if (isTourist) {
      if (!form.passportId?.trim()) e.passportId = 'Account ID is required.';
    }
    if (isTourist) {
      if (!form.country?.trim()) e.country = 'Please select your country.';
      if (!form.visaId?.trim()) e.visaId = 'Visa ID is required.';
      if (!form.visaExpiry) e.visaExpiry = 'Visa expiry date is required.';
      else {
        const today = new Date();
        today.setHours(0,0,0,0);
        const exp = new Date(form.visaExpiry);
        if (exp < today) e.visaExpiry = 'Visa expiry cannot be in the past.';
      }
    }
    if (!form.emergencyPhone1?.trim()) e.emergencyPhone1 = 'Emergency Contact Number 1 is required.';
    if (!form.emergencyEmail1?.trim()) e.emergencyEmail1 = 'Emergency Email ID 1 is required.';
    if (!form.emergencyPhone2?.trim()) e.emergencyPhone2 = 'Emergency Contact Number 2 is required.';
    if (!form.emergencyEmail2?.trim()) e.emergencyEmail2 = 'Emergency Email ID 2 is required.';

    
    const validateFile = (file, key) => {
      if (!file) return; 
      if (file.size > MAX_FILE_BYTES) e[key] = `File exceeds ${MAX_FILE_MB}MB.`;
    };
    if (isTourist) {
      validateFile(form.passportMain, 'passportMain');
      validateFile(form.passportSecondary, 'passportSecondary');
      validateFile(form.visaDetails, 'visaDetails');
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onFileChange = (key) => (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { update(key, null); return; }
    if (file.size > MAX_FILE_BYTES) {
      setErrors(prev => ({ ...prev, [key]: `File exceeds ${MAX_FILE_MB}MB.` }));
      
    } else {
      setErrors(prev => ({ ...prev, [key]: undefined }));
      update(key, file);
    }
  };

  const allRequiredValid = useMemo(() => {
    
    const baseRequired = isTourist
      ? [form.fullName, form.contactNumber, form.email, form.passportId,
         form.emergencyPhone1, form.emergencyEmail1, form.emergencyPhone2, form.emergencyEmail2]
      : [form.fullName, form.contactNumber, form.email,
         form.emergencyPhone1, form.emergencyEmail1, form.emergencyPhone2, form.emergencyEmail2];
    const touristOnly = isTourist ? [
      form.country, form.visaId, form.visaExpiry,
      form.passportMain, form.visaDetails,
    ] : [];
    const requiredFilled = [...baseRequired, ...touristOnly].every(Boolean);
    const noErrors = Object.values(errors).filter(Boolean).length === 0;
    return requiredFilled && noErrors;
  }, [form, errors, isTourist]);

  
  const completenessPercent = useMemo(() => {
    const checks = isTourist ? [
      form.fullName, form.contactNumber, form.email, form.passportId,
      form.country, form.visaId, form.visaExpiry,
      form.emergencyPhone1, form.emergencyEmail1, form.emergencyPhone2, form.emergencyEmail2,
    ] : [
      form.fullName, form.contactNumber, form.email,
      form.emergencyPhone1, form.emergencyEmail1, form.emergencyPhone2, form.emergencyEmail2,
    ];
    const total = checks.length;
    const done = checks.filter(Boolean).length;
    return Math.round((done / total) * 100);
  }, [form, isTourist]);

  // no-op placeholder removed

  const handleSubmit = async (e) => {
  e.preventDefault();
  setSuccess('');
  if (!validate()) return;

  const fd = new FormData();
  fd.append('fullName', form.fullName);
  fd.append('contactNumber', form.contactNumber);
  fd.append('email', form.email);
  fd.append('passportId', form.passportId);
  if (isTourist) {
    fd.append('country', form.country);
    fd.append('visaId', form.visaId);
    fd.append('visaExpiry', form.visaExpiry);
  }
  fd.append('emergencyPhone1', form.emergencyPhone1);
  fd.append('emergencyEmail1', form.emergencyEmail1);
  fd.append('emergencyPhone2', form.emergencyPhone2);
  fd.append('emergencyEmail2', form.emergencyEmail2);
  if (isTourist) {
    if (form.passportMain) fd.append('passportMain', form.passportMain);
    if (form.passportSecondary) fd.append('passportSecondary', form.passportSecondary);
    if (form.visaDetails) fd.append('visaDetails', form.visaDetails);
  }

  setSaving(true);
  try {
    const res = await axios.post(`${BACKEND_URL}/api/user/profile`, fd, {
      headers: { 'Content-Type': 'multipart/form-data', 'ngrok-skip-browser-warning': 'true' },
      withCredentials: true,
    });
    if (res.status === 200) {
      setSuccess('Profile saved successfully!');
      if (typeof res.data?.profileComplete === 'boolean') setProfileComplete(res.data.profileComplete);
      
      if (isTourist) {
        update('passportMain', null);
        update('passportSecondary', null);
        update('visaDetails', null);
      }
      
    } else {
      setSuccess('');
      setErrors(prev => ({ ...prev, submit: 'Failed to save profile. Please try again.' }));
    }
  } catch (err) {
    setSaving(false);
    setSuccess('');
    let msg = err?.response?.data?.message || err?.message || 'Failed to save profile. Please try again.';
    if (msg.includes('EACCES') || msg.includes('permission')) {
      msg += ' (Check server upload directory permissions)';
    }
    setErrors(prev => ({ ...prev, submit: msg }));
  }
  setSaving(false);
};

  const renderServerFile = (label, url) => {
    if (!url) return null;
    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(url);
    const isPdf = /\.pdf$/i.test(url);
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 12, color: '#555' }}>Previously uploaded:</div>
        {isImage && (
          <img src={`${BACKEND_URL}${url}`} alt={label} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' }} />
        )}
        {isPdf && (
          <a href={`${BACKEND_URL}${url}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 18, height: 18, background: '#d32f2f', color: 'white', borderRadius: 3, fontSize: 12, textAlign: 'center', lineHeight: '18px' }}>PDF</span>
            View PDF
          </a>
        )}
      </div>
    );
  };

  const initials = useMemo(() => {
    const n = form.fullName?.trim() || '';
    const parts = n.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [form.fullName]);

  
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [profileImageUploading, setProfileImageUploading] = useState(false);
  const profileImgObjectUrlRef = useRef(null);

  
  useEffect(() => {
    async function fetchProfileImage() {
      const pid = form.passportId || initialPassportId;
      if (!pid) return;
      try {
        const res = await axios.get(`${BACKEND_URL}/api/user/profile-image`, {
          withCredentials: true,
          params: { passportId: pid },
          headers: { 'ngrok-skip-browser-warning': 'true' },
        });
        if (res.data && res.data.url) {
          setProfileImageUrl(`${BACKEND_URL}${res.data.url}`);
        } else {
          setProfileImageUrl('');
        }
      } catch (e) {
        setProfileImageUrl(''); 
      }
    }
    fetchProfileImage();
  }, [BACKEND_URL, form.passportId, initialPassportId]);

  
  const onProfileImageChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setErrors(prev => ({ ...prev, profileImage: `File exceeds ${MAX_FILE_MB}MB.` }));
      return;
    }
    setErrors(prev => ({ ...prev, profileImage: undefined }));
    setProfileImageUploading(true);
    try {
      const fd = new FormData();
      
      const pid = form.passportId || initialPassportId;
      if (pid) fd.append('passportId', pid);
      fd.append('profileImage', file);
      const res = await axios.post(`${BACKEND_URL}/api/user/profile-image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true,
      });
      if (res.data && res.data.url) {
        const rel = res.data.url;
        setProfileImageUrl(`${BACKEND_URL}${rel}`);
        try {
          window.dispatchEvent(new CustomEvent('profile-image-updated', { detail: rel }));
        } catch {}
      } else {
        setProfileImageUrl(URL.createObjectURL(file)); 
      }
    } catch (err) {
      setErrors(prev => ({ ...prev, profileImage: 'Failed to upload image.' }));
    }
    setProfileImageUploading(false);
  };

  return (
    <section className="profile-card ModernProfile light">
      {}
      <div className="pf-header">
        <label htmlFor="profileImageInput" style={{ cursor: 'pointer' }}>
          <div className="pf-avatar" aria-label="Profile avatar">
            {profileImageUrl ? (
              <img
                src={profileImageUrl}
                alt="Profile"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                onError={async () => {
                  try {
                    
                    const resp = await axios.get(profileImageUrl, {
                      responseType: 'blob',
                      headers: { 'ngrok-skip-browser-warning': 'true' },
                      withCredentials: true,
                    });
                    const objUrl = URL.createObjectURL(resp.data);
                    if (profileImgObjectUrlRef.current) {
                      try { URL.revokeObjectURL(profileImgObjectUrlRef.current); } catch {}
                    }
                    profileImgObjectUrlRef.current = objUrl;
                    setProfileImageUrl(objUrl);
                  } catch (e) {
                    
                    setProfileImageUrl('');
                  }
                }}
              />
            ) : (
              initials
            )}
            {profileImageUploading && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
                <span style={{ fontSize: 12, color: '#888' }}>Uploading…</span>
              </div>
            )}
          </div>
          <input
            id="profileImageInput"
            type="file"
            accept="image/jpeg, image/png"
            style={{ display: 'none' }}
            onChange={onProfileImageChange}
          />
        </label>
        <div className="pf-meta">
          <h2 className="pf-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
            My Profile
            {serviceType ? (
              <span style={{
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 999,
                background: '#eef2ff',
                color: '#3730a3',
                border: '1px solid #c7d2fe',
              }}>{serviceType.replace('_',' ').replace('_',' ')}</span>
            ) : null}
          </h2>
          <div className="pf-sub">Keep your emergency and travel details up to date.</div>
        </div>
        <div className={`pf-chip ${profileComplete ? 'ok' : 'warn'}`}>
          {profileComplete ? 'Complete' : 'Incomplete'}
        </div>
      </div>

      {}
      <div className="pf-progress">
        <div className="pf-progress-bar" style={{ width: `${completenessPercent}%` }} />
        <span className="pf-progress-text">{completenessPercent}% complete</span>
      </div>

      {errors.profileImage && <ErrorText>{errors.profileImage}</ErrorText>}

      <form onSubmit={handleSubmit} className="profile-form pf-grid">
        <div className="pf-section">
          <div className="pf-section-title">Personal Info</div>
          <div className="pf-section-grid">
        {}
        <Field label="Full Name" htmlFor="fullName" required>
          <input id="fullName" type="text" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} required />
          {errors.fullName && <ErrorText>{errors.fullName}</ErrorText>}
        </Field>

        {}
        <Field label="Contact Number" htmlFor="contactNumber" required>
          <input id="contactNumber" type="tel" value={form.contactNumber} onChange={(e) => update('contactNumber', e.target.value)} required />
          {errors.contactNumber && <ErrorText>{errors.contactNumber}</ErrorText>}
        </Field>

        {}
        <Field label="Email ID" htmlFor="email" required>
          <input id="email" type="email" value={form.email} readOnly disabled />
          {errors.email && <ErrorText>{errors.email}</ErrorText>}
        </Field>

        {}
  <Field label={isTourist ? "Account ID" : "Account ID (optional)"} htmlFor="passportId" required={isTourist}>
          <input
            id="passportId"
            type="text"
            value={form.passportId}
            onChange={(e) => update('passportId', e.target.value)}
            required={isTourist}
            placeholder={isTourist ? 'Enter your Passport ID' : 'Will be filled automatically or fetched by email/Aadhaar'}
          />
          {errors.passportId && <ErrorText>{errors.passportId}</ErrorText>}
        </Field>

        {}
        {isTourist && (
        <Field label="Country" htmlFor="country" required>
          <select id="country" value={form.country} onChange={(e) => update('country', e.target.value)} required={isTourist}>
            <option value="" disabled>Select your country</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {errors.country && <ErrorText>{errors.country}</ErrorText>}
        </Field>
        )}
          </div>
        </div>

        {isTourist && (
        <div className="pf-section">
          <div className="pf-section-title">Travel & Visa</div>
          <div className="pf-section-grid">
            <Field label="Visa ID" htmlFor="visaId" required>
              <input id="visaId" type="text" value={form.visaId} onChange={(e) => update('visaId', e.target.value)} required={isTourist} />
              {errors.visaId && <ErrorText>{errors.visaId}</ErrorText>}
            </Field>
            <Field label="Visa Expiry" htmlFor="visaExpiry" required>
              <input id="visaExpiry" type="date" value={form.visaExpiry} onChange={(e) => update('visaExpiry', e.target.value)} required={isTourist} />
              {errors.visaExpiry && <ErrorText>{errors.visaExpiry}</ErrorText>}
            </Field>
          </div>
        </div>
        )}

        <div className="pf-section">
          <div className="pf-section-title">Emergency Contacts</div>
          <div className="pf-section-grid">
            <Field label="Emergency Contact Number 1" htmlFor="emergencyPhone1" required>
              <input id="emergencyPhone1" type="tel" value={form.emergencyPhone1} onChange={(e) => update('emergencyPhone1', e.target.value)} required />
              {errors.emergencyPhone1 && <ErrorText>{errors.emergencyPhone1}</ErrorText>}
            </Field>
            <Field label="Emergency Email ID 1" htmlFor="emergencyEmail1" required>
              <input id="emergencyEmail1" type="email" value={form.emergencyEmail1} onChange={(e) => update('emergencyEmail1', e.target.value)} required />
              {errors.emergencyEmail1 && <ErrorText>{errors.emergencyEmail1}</ErrorText>}
            </Field>
            <Field label="Emergency Contact Number 2" htmlFor="emergencyPhone2" required>
              <input id="emergencyPhone2" type="tel" value={form.emergencyPhone2} onChange={(e) => update('emergencyPhone2', e.target.value)} required />
              {errors.emergencyPhone2 && <ErrorText>{errors.emergencyPhone2}</ErrorText>}
            </Field>
            <Field label="Emergency Email ID 2" htmlFor="emergencyEmail2" required>
              <input id="emergencyEmail2" type="email" value={form.emergencyEmail2} onChange={(e) => update('emergencyEmail2', e.target.value)} required />
              {errors.emergencyEmail2 && <ErrorText>{errors.emergencyEmail2}</ErrorText>}
            </Field>
          </div>
        </div>

        {isTourist && (
        <div className="pf-section">
          <div className="pf-section-title">Documents</div>
          <div className="pf-section-grid">
            <Field label="Upload Passport (Main)" htmlFor="passportMain" required>
              <label className="pf-file">
                <input id="passportMain" type="file" accept="image/jpeg, image/png, application/pdf" onChange={onFileChange('passportMain')} required={isTourist} />
                <span className="pf-file-cta">Choose file</span>
                <span className="pf-file-name">{form.passportMain ? form.passportMain.name : 'No file selected'}</span>
              </label>
              {form.passportMain && (
                <div className="file-preview">{form.passportMain.name} ({(form.passportMain.size/1024/1024).toFixed(2)} MB)</div>
              )}
              {!form.passportMain && renderServerFile('Passport Main', serverFiles.passportMain)}
              {errors.passportMain && <ErrorText>{errors.passportMain}</ErrorText>}
            </Field>
            <Field label="Upload Passport (Secondary)" htmlFor="passportSecondary">
              <label className="pf-file">
                <input id="passportSecondary" type="file" accept="image/jpeg, image/png, application/pdf" onChange={onFileChange('passportSecondary')} />
                <span className="pf-file-cta">Choose file</span>
                <span className="pf-file-name">{form.passportSecondary ? form.passportSecondary.name : 'No file selected'}</span>
              </label>
              {form.passportSecondary && (
                <div className="file-preview">{form.passportSecondary.name} ({(form.passportSecondary.size/1024/1024).toFixed(2)} MB)</div>
              )}
              {!form.passportSecondary && renderServerFile('Passport Secondary', serverFiles.passportSecondary)}
              {errors.passportSecondary && <ErrorText>{errors.passportSecondary}</ErrorText>}
            </Field>
            <Field label="Upload Visa Details" htmlFor="visaDetails" required>
              <label className="pf-file">
                <input id="visaDetails" type="file" accept="image/jpeg, image/png, application/pdf" onChange={onFileChange('visaDetails')} required={isTourist} />
                <span className="pf-file-cta">Choose file</span>
                <span className="pf-file-name">{form.visaDetails ? form.visaDetails.name : 'No file selected'}</span>
              </label>
              {form.visaDetails && (
                <div className="file-preview">{form.visaDetails.name} ({(form.visaDetails.size/1024/1024).toFixed(2)} MB)</div>
              )}
              {!form.visaDetails && renderServerFile('Visa Details', serverFiles.visaDetails)}
              {errors.visaDetails && <ErrorText>{errors.visaDetails}</ErrorText>}
            </Field>
          </div>
        </div>
        )}

        {errors.submit && <ErrorText>{errors.submit}</ErrorText>}
        {success && <div className="success-message" style={{ marginTop: 8 }}>{success}</div>}

        <div className="pf-actions">
          <button type="submit" className="pf-save" disabled={saving || !allRequiredValid}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </form>
    </section>
  );
}
