import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './TouristIncidentReporting.css';

const TouristIncidentReporting = ({ backendUrl, passportId, currentLocation }) => {
  const [category, setCategory] = useState('');
  const [subType, setSubType] = useState('');
  const [description, setDescription] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaPreview, setMediaPreview] = useState([]);
  const [reporterName, setReporterName] = useState('');
  const [reporterContact, setReporterContact] = useState('');
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [myIncidents, setMyIncidents] = useState([]);
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [showMyReports, setShowMyReports] = useState(false);

  const categories = [
    { value: 'crime', label: 'Crime / Theft', subTypes: ['Theft', 'Robbery', 'Assault', 'Fraud', 'Other'] },
    { value: 'threat', label: 'Threat / Harassment', subTypes: ['Physical Threat', 'Verbal Harassment', 'Stalking', 'Intimidation', 'Other'] },
    { value: 'disaster', label: 'Natural Disaster', subTypes: ['Flood', 'Earthquake', 'Fire', 'Storm', 'Landslide', 'Other'] },
    { value: 'accident', label: 'Accident', subTypes: ['Traffic Accident', 'Medical Emergency', 'Injury', 'Other'] },
    { value: 'suspicious', label: 'Suspicious Activity', subTypes: ['Suspicious Person', 'Suspicious Vehicle', 'Suspicious Package', 'Other'] },
    { value: 'other', label: 'Other', subTypes: [] }
  ];

  const selectedCategory = categories.find(cat => cat.value === category);

  useEffect(() => {
    if (currentLocation && useCurrentLocation) {
      setLatitude(currentLocation.latitude?.toString() || '');
      setLongitude(currentLocation.longitude?.toString() || '');
    }
  }, [currentLocation, useCurrentLocation]);

  const fetchMyIncidents = async () => {
    if (!passportId) return;
    
    setLoadingIncidents(true);
    try {
      const response = await axios.get(`${backendUrl}/api/v1/incidents`, {
        params: { passportId, limit: 20 },
        headers: { 'ngrok-skip-browser-warning': 'true' },
        withCredentials: true
      });

      if (response.data.success) {
        setMyIncidents(response.data.incidents);
      }
    } catch (error) {
      console.error('Error fetching incidents:', error);
    } finally {
      setLoadingIncidents(false);
    }
  };

  useEffect(() => {
    if (showMyReports && passportId) {
      fetchMyIncidents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMyReports, passportId]);

  const handleMediaChange = (e) => {
    const files = Array.from(e.target.files);
    
    if (files.length + mediaFiles.length > 5) {
      setMessage({ type: 'error', text: 'Maximum 5 media files allowed' });
      return;
    }

    // Create preview URLs
    const newPreviews = files.map(file => ({
      url: URL.createObjectURL(file),
      type: file.type.startsWith('image/') ? 'image' : 'video',
      name: file.name
    }));

    setMediaFiles([...mediaFiles, ...files]);
    setMediaPreview([...mediaPreview, ...newPreviews]);
  };

  const removeMedia = (index) => {
    const newFiles = [...mediaFiles];
    const newPreviews = [...mediaPreview];
    
    // Revoke object URL to free memory
    URL.revokeObjectURL(newPreviews[index].url);
    
    newFiles.splice(index, 1);
    newPreviews.splice(index, 1);
    
    setMediaFiles(newFiles);
    setMediaPreview(newPreviews);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!category || !description) {
      setMessage({ type: 'error', text: 'Category and description are required' });
      return;
    }

    setSubmitting(true);
    setMessage({ type: '', text: '' });

    try {
      const formData = new FormData();
      formData.append('category', category);
      formData.append('subType', subType);
      formData.append('description', description);
      formData.append('reporterName', reporterName);
      formData.append('reporterContact', reporterContact);
      
      if (passportId) {
        formData.append('passportId', passportId);
      }

      if (useCurrentLocation && currentLocation) {
        formData.append('latitude', currentLocation.latitude);
        formData.append('longitude', currentLocation.longitude);
      } else if (latitude && longitude) {
        formData.append('latitude', latitude);
        formData.append('longitude', longitude);
      }

      // Append media files
      mediaFiles.forEach(file => {
        formData.append('media', file);
      });

      const response = await axios.post(
        `${backendUrl}/api/v1/incidents`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            'ngrok-skip-browser-warning': 'true'
          },
          withCredentials: true
        }
      );

      if (response.data.success) {
        setMessage({ 
          type: 'success', 
          text: `Incident reported successfully! Reference ID: ${response.data.incident.id}` 
        });
        
        // Reset form
        setCategory('');
        setSubType('');
        setDescription('');
        setMediaFiles([]);
        setMediaPreview([]);
        setReporterName('');
        setReporterContact('');
        
        // Refresh incidents list if visible
        if (showMyReports) {
          fetchMyIncidents();
        }
      }
    } catch (error) {
      console.error('Error submitting incident:', error);
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.message || 'Failed to submit incident. Please try again.' 
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'new': return 'status-badge status-new';
      case 'under_review': return 'status-badge status-review';
      case 'resolved': return 'status-badge status-resolved';
      case 'rejected': return 'status-badge status-rejected';
      default: return 'status-badge';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="tourist-incident-reporting">
      <div className="incident-header">
        <h2>Incident Reporting</h2>
        <p className="incident-subtitle">
          Report crimes, threats, harassment, or disasters with location and photo evidence
        </p>
      </div>

      <div className="incident-tabs">
        <button 
          className={`tab-button ${!showMyReports ? 'active' : ''}`}
          onClick={() => setShowMyReports(false)}
        >
          Report New Incident
        </button>
        <button 
          className={`tab-button ${showMyReports ? 'active' : ''}`}
          onClick={() => setShowMyReports(true)}
        >
          My Reports ({myIncidents.length})
        </button>
      </div>

      {!showMyReports ? (
        <form onSubmit={handleSubmit} className="incident-form">
          {message.text && (
            <div className={`message-box ${message.type}`}>
              {message.text}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="category">Incident Category *</label>
            <select
              id="category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setSubType('');
              }}
              required
            >
              <option value="">Select Category</option>
              {categories.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>

          {selectedCategory && selectedCategory.subTypes.length > 0 && (
            <div className="form-group">
              <label htmlFor="subType">Sub-Type</label>
              <select
                id="subType"
                value={subType}
                onChange={(e) => setSubType(e.target.value)}
              >
                <option value="">Select Sub-Type (Optional)</option>
                {selectedCategory.subTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="description">Description *</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the incident in detail..."
              rows={5}
              required
            />
          </div>

          <div className="form-group location-group">
            <label>
              <input
                type="checkbox"
                checked={useCurrentLocation}
                onChange={(e) => setUseCurrentLocation(e.target.checked)}
              />
              <span>Use my current location</span>
            </label>
            
            {!useCurrentLocation && (
              <div className="manual-location">
                <input
                  type="number"
                  step="any"
                  placeholder="Latitude"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Longitude"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="mediaUpload">Photo/Video Evidence (Max 5 files, 10MB each)</label>
            <input
              type="file"
              id="mediaUpload"
              accept="image/*,video/*"
              multiple
              onChange={handleMediaChange}
              disabled={mediaFiles.length >= 5}
            />
            
            {mediaPreview.length > 0 && (
              <div className="media-preview-grid">
                {mediaPreview.map((preview, index) => (
                  <div key={index} className="media-preview-item">
                    {preview.type === 'image' ? (
                      <img src={preview.url} alt={`Preview ${index + 1}`} />
                    ) : (
                      <video src={preview.url} controls />
                    )}
                    <button
                      type="button"
                      className="remove-media-btn"
                      onClick={() => removeMedia(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="reporterName">Your Name (Optional)</label>
            <input
              type="text"
              id="reporterName"
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              placeholder="Enter your name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="reporterContact">Contact Number (Optional)</label>
            <input
              type="tel"
              id="reporterContact"
              value={reporterContact}
              onChange={(e) => setReporterContact(e.target.value)}
              placeholder="Enter your contact number"
            />
          </div>

          <button 
            type="submit" 
            className="submit-incident-btn"
            disabled={submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Incident Report'}
          </button>
        </form>
      ) : (
        <div className="my-incidents-section">
          {loadingIncidents ? (
            <div className="loading-spinner">Loading your reports...</div>
          ) : myIncidents.length === 0 ? (
            <div className="no-incidents">
              <p>You haven't reported any incidents yet.</p>
            </div>
          ) : (
            <div className="incidents-list">
              {myIncidents.map(incident => (
                <div key={incident.id} className="incident-card">
                  <div className="incident-card-header">
                    <div>
                      <h4>
                        {categories.find(c => c.value === incident.category)?.label || incident.category}
                        {incident.subType && <span className="sub-type"> - {incident.subType}</span>}
                      </h4>
                      <p className="incident-id">ID: {incident.id}</p>
                    </div>
                    <span className={getStatusBadgeClass(incident.status)}>
                      {incident.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  
                  <p className="incident-description">{incident.description}</p>
                  
                  {incident.mediaUrls && incident.mediaUrls.length > 0 && (
                    <div className="incident-media">
                      <span className="media-count">📎 {incident.mediaUrls.length} file(s) attached</span>
                    </div>
                  )}
                  
                  {incident.assignedAgency && (
                    <p className="assigned-agency">
                      <strong>Assigned to:</strong> {incident.assignedAgency}
                    </p>
                  )}
                  
                  <p className="incident-date">{formatDate(incident.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TouristIncidentReporting;
