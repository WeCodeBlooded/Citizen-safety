import React, { useState, useEffect, useRef } from 'react';
import './Guidance.css';




function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371; 
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const PLACEHOLDER_COORD_ENDPOINT = 'https://script.google.com/macros/s/PLACEHOLDER/exec';

export default function Guidance() {
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [destinationCoords, setDestinationCoords] = useState(null); 
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState('');
  const [distance, setDistance] = useState(null);
  const [proximityReached, setProximityReached] = useState(false);
  const [suggestions, setSuggestions] = useState([]); 
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null); 
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  const watchIdRef = useRef(null);
  const audioRef = useRef(null);

  
  useEffect(() => {
    audioRef.current = new Audio(
      'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA'+
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    ); 
  }, []);

  async function handleStartTrip(e) {
    e.preventDefault();
    setError('');
    setProximityReached(false);

    if (!source.trim() || !destination.trim()) {
      setError('Please enter both source and destination.');
      return;
    }

    try {
      let coords = null;
      if (selectedSuggestion && typeof selectedSuggestion.lat === 'number' && typeof selectedSuggestion.lon === 'number') {
        coords = { lat: selectedSuggestion.lat, lon: selectedSuggestion.lon };
      } else {
        
        const url = `${PLACEHOLDER_COORD_ENDPOINT}?destination=${encodeURIComponent(destination)}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error('Failed to fetch destination coordinates');
        const data = await res.json();
        const lat = data.lat ?? data.latitude;
        const lon = data.lon ?? data.lng ?? data.longitude;
        if (typeof lat !== 'number' || typeof lon !== 'number') {
          throw new Error('Invalid coordinates received.');
        }
        coords = { lat, lon };
      }
      setDestinationCoords(coords);
      setIsTracking(true);
    } catch (err) {
      console.error('Destination fetch error:', err);
      setError(err.message || 'Could not fetch destination.');
    }
  }

  function stopTracking() {
    setIsTracking(false);
    try {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    } catch (e) {  }
    watchIdRef.current = null;
  }

  
  useEffect(() => {
    if (!isTracking || !destinationCoords) return;
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      setIsTracking(false);
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const dKm = haversineKm(latitude, longitude, destinationCoords.lat, destinationCoords.lon);
        setDistance(dKm);

        if (dKm <= 0.1 && !proximityReached) { 
          setProximityReached(true);
          try { audioRef.current && audioRef.current.play().catch(()=>{}); } catch {}
          if (navigator.vibrate) {
            try { navigator.vibrate([250, 120, 250, 120, 400]); } catch {}
          }
          
          stopTracking();
        }
      },
      (err) => {
        console.warn('watchPosition error', err);
        setError(err.message || 'Location error');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );

    return () => {
      try {
        if (watchIdRef.current != null && navigator.geolocation) {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
      } catch {  }
    };
  }, [isTracking, destinationCoords, proximityReached]);

  
  useEffect(() => {
    if (isTracking) return; 
    if (!destination.trim()) {
      setSuggestions([]);
      setSelectedSuggestion(null);
      return;
    }
    
    if (selectedSuggestion && destination !== selectedSuggestion.displayName) {
      setSelectedSuggestion(null);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        if (abortRef.current) {
          abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setLoadingSuggestions(true);
        
        const queryUrl = `${PLACEHOLDER_COORD_ENDPOINT}?mode=search&q=${encodeURIComponent(destination)}`;
        const res = await fetch(queryUrl, { signal: controller.signal });
        if (!res.ok) throw new Error('Suggestion fetch failed');
        const json = await res.json();
        
        let items = [];
        if (Array.isArray(json)) items = json; else if (Array.isArray(json.results)) items = json.results; else if (Array.isArray(json.places)) items = json.places;
        const mapped = items.slice(0,10).map((p,i) => ({
          id: p.id || p.place_id || p.placeId || p.name || `s-${i}`,
          displayName: p.displayName || p.name || p.formatted || p.address || destination,
          lat: p.lat ?? p.latitude ?? p.center?.[1],
          lon: p.lon ?? p.lng ?? p.longitude ?? p.center?.[0]
        })).filter(r => typeof r.lat === 'number' && typeof r.lon === 'number');
        setSuggestions(mapped);
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.warn('Autocomplete error', e);
          setSuggestions([]);
        }
      } finally {
        setLoadingSuggestions(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [destination, isTracking, selectedSuggestion]);

  return (
    <div className="guidance-container">
      {!isTracking && (
        <form className="guidance-form" onSubmit={handleStartTrip}>
          <h2 className="guidance-header">Bus Destination Alert</h2>
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="srcInput">Source</label>
            <input
              id="srcInput"
              type="text"
              value={source}
              placeholder="Enter starting point (optional free text)"
              onChange={(e) => setSource(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div style={{ marginBottom: 6 }} className="guidance-suggestion-wrapper">
            <label htmlFor="destInput">Destination</label>
            <input
              id="destInput"
              type="text"
              value={destination}
              placeholder="e.g. Central Bus Station"
              onChange={(e) => setDestination(e.target.value)}
              autoComplete="off"
              required
            />
            {loadingSuggestions && destination && (
              <div style={{ fontSize:'.65rem', fontWeight:600, letterSpacing:'.12em', marginTop:4, color:'#64748b' }}>Searching…</div>
            )}
            {suggestions.length > 0 && (
              <ul className="guidance-suggestions-list" role="listbox" aria-label="Destination suggestions">
                {suggestions.map(s => (
                  <li key={s.id} role="option" aria-selected={selectedSuggestion?.id === s.id} onClick={() => { setDestination(s.displayName); setSelectedSuggestion(s); setSuggestions([]); }}>
                    <span className="guidance-pill">DEST</span>
                    <span style={{ flex:1 }}>{s.displayName}</span>
                  </li>
                ))}
              </ul>
            )}
            {!loadingSuggestions && destination && suggestions.length === 0 && selectedSuggestion == null && (
              <div className="guidance-suggestions-empty">No suggestions</div>
            )}
          </div>
          <div className="guidance-actions">
            <button type="submit" className="guidance-btn" disabled={!destination.trim()}>Start Trip</button>
            <button type="button" className="guidance-btn secondary" onClick={() => { setSource(''); setDestination(''); setError(''); }}>Reset</button>
          </div>
          {error && <div className="guidance-error" role="alert">{error}</div>}
          <p className="guidance-small-note" style={{ marginTop: 18 }}>We will notify you when you are nearing the destination (within 100 meters).</p>
        </form>
      )}

      {isTracking && (
        <div className="guidance-status-box">
          <div className="guidance-meta">Tracking Active</div>
          <div className="guidance-destination-label">Destination</div>
          <div className="guidance-destination-value">{destination}</div>
          <h3 className="guidance-status-heading">Distance Remaining</h3>
          <div className="guidance-distance">{distance != null ? `${distance.toFixed(3)} km` : 'Calculating...'}</div>
          <div className={`guidance-proximity-alert ${proximityReached ? 'active' : ''}`}>You have arrived near your destination!</div>
          <div className="guidance-actions" style={{ marginTop: 10 }}>
            <button onClick={stopTracking} className="guidance-btn secondary">Cancel Trip</button>
          </div>
          {error && <div className="guidance-error" role="alert" style={{ marginTop: 16 }}>{error}</div>}
          <p className="guidance-small-note" style={{ marginTop: 20 }}>Tracking uses your device GPS. Keep this page open.</p>
        </div>
      )}
    </div>
  );
}
