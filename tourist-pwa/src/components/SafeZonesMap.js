import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';

// Fix for default marker icons in Leaflet with React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const SafeZonesMap = () => {
  const [safeZones, setSafeZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [selectedType, setSelectedType] = useState('all');
  const [mapCenter, setMapCenter] = useState([20.5937, 78.9629]); // India center
  const [showOfflineIndicator, setShowOfflineIndicator] = useState(false);
  
  const mapRef = useRef(null);
  const markerClusterGroupRef = useRef(null);
  const userMarkerRef = useRef(null);

  const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3001';

  // Define marker colors by type
  const markerColors = {
    police: '#2563eb', // blue
    hospital: '#dc2626', // red
    shelter: '#16a34a', // green
    treatment_centre: '#9333ea', // purple
  };

  const typeLabels = {
    police: 'Police Station',
    hospital: 'Hospital',
    shelter: 'Shelter',
    treatment_centre: 'Treatment Centre',
  };

  // Create custom colored marker icons
  const createColoredIcon = (color) => {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="background-color: ${color}; width: 25px; height: 25px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
      iconSize: [25, 25],
      iconAnchor: [12, 12],
    });
  };

  // Get user's current location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(userPos);
          setMapCenter([userPos.lat, userPos.lng]);
        },
        (err) => {
          console.warn('Geolocation error:', err);
          // Keep default India center if geolocation fails
        }
      );
    }
  }, []);

  // Fetch safe zones from API or IndexedDB cache
  useEffect(() => {
    const fetchSafeZones = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Try to fetch from server first
        const response = await axios.get(`${API_BASE}/api/v1/safe-zones`, {
          params: { limit: 500 },
          timeout: 5000,
        });
        
        const zones = response.data.data || [];
        setSafeZones(zones);
        
        // Cache data for offline use
        await cacheToIndexedDB(zones);
        setShowOfflineIndicator(false);
      } catch (err) {
        console.error('Error fetching safe zones from server:', err);
        
        // Fallback to IndexedDB cache
        const cachedZones = await loadFromIndexedDB();
        if (cachedZones && cachedZones.length > 0) {
          setSafeZones(cachedZones);
          setShowOfflineIndicator(true);
          console.log('Loaded safe zones from cache');
        } else {
          setError('Unable to load safe zones. Please check your connection.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSafeZones();
  }, [API_BASE]);

  // IndexedDB caching functions
  const openDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('TouristSafetyDB', 1);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('safeZones')) {
          db.createObjectStore('safeZones', { keyPath: 'id' });
        }
      };
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const cacheToIndexedDB = async (zones) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(['safeZones'], 'readwrite');
      const store = transaction.objectStore('safeZones');
      
      // Clear existing data
      store.clear();
      
      // Add new data with timestamp
      zones.forEach((zone) => {
        store.put({ ...zone, cached_at: Date.now() });
      });
      
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      
      console.log('Cached safe zones to IndexedDB');
    } catch (err) {
      console.error('IndexedDB cache error:', err);
    }
  };

  const loadFromIndexedDB = async () => {
    try {
      const db = await openDB();
      const transaction = db.transaction(['safeZones'], 'readonly');
      const store = transaction.objectStore('safeZones');
      const request = store.getAll();
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const zones = request.result;
          // Check cache age (24 hour TTL)
          if (zones.length > 0 && zones[0].cached_at) {
            const cacheAge = Date.now() - zones[0].cached_at;
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours
            if (cacheAge < maxAge) {
              resolve(zones);
            } else {
              console.log('Cache expired');
              resolve([]);
            }
          } else {
            resolve(zones);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('IndexedDB load error:', err);
      return [];
    }
  };

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map('safe-zones-map').setView(mapCenter, 6);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);
      
      mapRef.current = map;
      markerClusterGroupRef.current = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
      });
      map.addLayer(markerClusterGroupRef.current);
    } else {
      // Update center when user location changes
      mapRef.current.setView(mapCenter, 12);
    }
  }, [mapCenter]);

  // Add user location marker
  useEffect(() => {
    if (mapRef.current && userLocation) {
      if (userMarkerRef.current) {
        mapRef.current.removeLayer(userMarkerRef.current);
      }
      
      const userIcon = L.divIcon({
        className: 'user-marker',
        html: '<div style="background-color: #3b82f6; width: 15px; height: 15px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(59,130,246,0.5);"></div>',
        iconSize: [15, 15],
        iconAnchor: [7, 7],
      });
      
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon: userIcon,
      }).addTo(mapRef.current);
      
      userMarkerRef.current.bindPopup('<b>Your Location</b>').openPopup();
    }
  }, [userLocation]);

  // Add markers for safe zones
  useEffect(() => {
    if (mapRef.current && markerClusterGroupRef.current && safeZones.length > 0) {
      markerClusterGroupRef.current.clearLayers();
      
      const filteredZones = selectedType === 'all' 
        ? safeZones 
        : safeZones.filter(zone => zone.type === selectedType);
      
      filteredZones.forEach((zone) => {
        const icon = createColoredIcon(markerColors[zone.type] || '#6b7280');
        const marker = L.marker([zone.latitude, zone.longitude], { icon });
        
        const popupContent = `
          <div style="min-width: 200px;">
            <h3 style="margin: 0 0 10px 0; color: ${markerColors[zone.type]};">
              ${zone.name}
            </h3>
            <p style="margin: 5px 0; font-weight: bold;">
              ${typeLabels[zone.type] || zone.type}
            </p>
            <p style="margin: 5px 0;">
              <strong>Address:</strong><br/>${zone.address || 'N/A'}
            </p>
            ${zone.contact ? `<p style="margin: 5px 0;"><strong>Contact:</strong> ${zone.contact}</p>` : ''}
            ${zone.operational_hours ? `<p style="margin: 5px 0;"><strong>Hours:</strong> ${zone.operational_hours}</p>` : ''}
            ${zone.services && zone.services.length > 0 ? `
              <p style="margin: 5px 0;">
                <strong>Services:</strong> ${zone.services.join(', ')}
              </p>
            ` : ''}
            ${zone.verified ? '<p style="margin: 5px 0; color: green;">✓ Verified</p>' : ''}
          </div>
        `;
        
        marker.bindPopup(popupContent);
        markerClusterGroupRef.current.addLayer(marker);
      });
    }
  }, [safeZones, selectedType]);

  // Handle filter change
  const handleFilterChange = (type) => {
    setSelectedType(type);
  };

  // Recenter map to user location
  const recenterMap = () => {
    if (userLocation && mapRef.current) {
      mapRef.current.setView([userLocation.lat, userLocation.lng], 14);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '15px' }}>Safe Zones Map</h2>
      
      {showOfflineIndicator && (
        <div style={{ 
          padding: '10px', 
          background: '#fef3c7', 
          border: '1px solid #f59e0b',
          borderRadius: '4px',
          marginBottom: '15px'
        }}>
          <strong>⚠️ Offline Mode:</strong> Showing cached data. Connect to internet for latest updates.
        </div>
      )}
      
      {/* Filter controls */}
      <div style={{ marginBottom: '15px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>Filter:</strong>
        <button
          onClick={() => handleFilterChange('all')}
          style={{
            padding: '8px 16px',
            border: selectedType === 'all' ? '2px solid #3b82f6' : '1px solid #d1d5db',
            borderRadius: '4px',
            background: selectedType === 'all' ? '#eff6ff' : 'white',
            cursor: 'pointer',
          }}
        >
          All
        </button>
        {Object.entries(typeLabels).map(([type, label]) => (
          <button
            key={type}
            onClick={() => handleFilterChange(type)}
            style={{
              padding: '8px 16px',
              border: selectedType === type ? `2px solid ${markerColors[type]}` : '1px solid #d1d5db',
              borderRadius: '4px',
              background: selectedType === type ? `${markerColors[type]}22` : 'white',
              cursor: 'pointer',
            }}
          >
            <span style={{ color: markerColors[type], marginRight: '5px' }}>●</span>
            {label}
          </button>
        ))}
        
        <button
          onClick={recenterMap}
          disabled={!userLocation}
          style={{
            padding: '8px 16px',
            border: '1px solid #3b82f6',
            borderRadius: '4px',
            background: '#3b82f6',
            color: 'white',
            cursor: userLocation ? 'pointer' : 'not-allowed',
            opacity: userLocation ? 1 : 0.5,
            marginLeft: 'auto',
          }}
        >
          📍 My Location
        </button>
      </div>
      
      {/* Loading/Error states */}
      {loading && <p>Loading safe zones...</p>}
      {error && !showOfflineIndicator && (
        <div style={{ 
          padding: '15px', 
          background: '#fee2e2', 
          border: '1px solid #ef4444',
          borderRadius: '4px',
          marginBottom: '15px'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      
      {/* Map container */}
      <div 
        id="safe-zones-map" 
        style={{ 
          height: '600px', 
          width: '100%', 
          border: '2px solid #e5e7eb',
          borderRadius: '8px',
        }}
      />
      
      {/* Statistics */}
      <div style={{ marginTop: '15px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ padding: '10px', background: '#f9fafb', borderRadius: '4px' }}>
          <strong>Total Zones:</strong> {safeZones.length}
        </div>
        {selectedType !== 'all' && (
          <div style={{ padding: '10px', background: '#f9fafb', borderRadius: '4px' }}>
            <strong>Filtered:</strong> {safeZones.filter(z => z.type === selectedType).length}
          </div>
        )}
      </div>
    </div>
  );
};

export default SafeZonesMap;
