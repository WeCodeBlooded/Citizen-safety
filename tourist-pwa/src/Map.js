

import React, { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";


delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

const memberColors = [
  "red", "green", "purple", "orange", "yellow", "cyan", "magenta",
];

const createMarkerIcon = (color) => {
  return new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
};


const computeBearing = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (d) => (d * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const λ1 = toRad(lon1);
  const λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
};


const MapControls = ({ userPosition, realTimeTracking, isMapEnlarged, route }) => {
  const map = useMap();

  
  useEffect(() => {
    try {
      if (isMapEnlarged) {
        map.scrollWheelZoom.enable();
        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
      } else {
        map.scrollWheelZoom.disable();
        map.dragging.disable();
        map.touchZoom.disable();
        map.doubleClickZoom.disable();
      }
    } catch (e) {
      
    }
  }, [isMapEnlarged, map]);

  
  useEffect(() => {
    if (!realTimeTracking || !userPosition) return;
    try {
      map.panTo([userPosition.latitude, userPosition.longitude], { animate: true });
    } catch (e) {}
  }, [realTimeTracking, userPosition, map]);

  return null;
};


const RecenterButton = ({ userPosition }) => {
  const map = useMap();
  if (!userPosition) return null;
  const onClick = (e) => {
    e.preventDefault();
    try {
      map.flyTo([userPosition.latitude, userPosition.longitude], Math.max(map.getZoom(), 13), { animate: true });
    } catch {}
  };
  
  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: 'none' }}>
      <div className="leaflet-control" style={{ pointerEvents: 'auto' }}>
        <button
          onClick={onClick}
          title="Recenter to your location"
          aria-label="Recenter to your location"
          style={{
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.2)',
            borderRadius: 4,
            padding: '6px 8px',
            cursor: 'pointer'
          }}
        >
          ⦿ Recenter
        </button>
      </div>
    </div>
  );
};

const Map = ({ userPosition, groupMembers, route, realTimeTracking, isMapEnlarged }) => {
  
  const membersWithLocation = (groupMembers || []).filter(
    (member) => member.latitude != null && member.longitude != null
  );

  
  const routeLatLon = useMemo(() => {
    if (!route || !Array.isArray(route)) return [];
    return route.map((p) => [p[1], p[0]]);
  }, [route]);

  return (
    <MapContainer
      center={userPosition ? [userPosition.latitude, userPosition.longitude] : [0, 0]}
      zoom={13}
      style={{ height: "100%", width: "100%" }}
    >
      <MapControls userPosition={userPosition} realTimeTracking={realTimeTracking} isMapEnlarged={isMapEnlarged} route={routeLatLon} />
      <RecenterButton userPosition={userPosition} />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
      />

      {}
      {userPosition && (
        (() => {
          
          if (realTimeTracking && routeLatLon && routeLatLon.length > 0) {
            
            let nearestIdx = 0;
            let minDist = Infinity;
            const toRad = (d) => (d * Math.PI) / 180;
            const haversine = (aLat, aLon, bLat, bLon) => {
              const R = 6371e3; 
              const φ1 = toRad(aLat);
              const φ2 = toRad(bLat);
              const Δφ = toRad(bLat - aLat);
              const Δλ = toRad(bLon - aLon);
              const aa = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
              const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
              return R * c;
            };

            for (let i = 0; i < routeLatLon.length; i++) {
              const [rLat, rLon] = routeLatLon[i];
              const d = haversine(userPosition.latitude, userPosition.longitude, rLat, rLon);
              if (d < minDist) {
                minDist = d;
                nearestIdx = i;
              }
            }

            const nextIdx = Math.min(nearestIdx + 1, routeLatLon.length - 1);
            const [targetLat, targetLon] = routeLatLon[nextIdx];
            const bearing = computeBearing(userPosition.latitude, userPosition.longitude, targetLat, targetLon);

            
            const arrowHtml = `
              <div style="transform: rotate(${bearing}deg); width:32px; height:32px; display:flex; align-items:center; justify-content:center;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2 L19 21 L12 17 L5 21 L12 2 Z" fill="#2b7be4" stroke="#08306b" stroke-width="0.5"/>
                </svg>
              </div>
            `;

            const arrowIcon = L.divIcon({ html: arrowHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });

            return (
              <Marker
                position={[userPosition.latitude, userPosition.longitude]}
                icon={arrowIcon}
              >
                <Popup>Following route</Popup>
              </Marker>
            );
          }

          
          return (
            <Marker
              position={[userPosition.latitude, userPosition.longitude]}
              icon={createMarkerIcon("blue")}
            >
              <Popup>You are here</Popup>
            </Marker>
          );
        })()
      )}

      {}
      {membersWithLocation.map((member, index) => (
        
        <Marker
          key={member.passport_id || member.passportId || index}
          position={[member.latitude, member.longitude]}
          icon={createMarkerIcon(memberColors[index % memberColors.length])}
        >
          <Popup>{member.name}</Popup>
        </Marker>
      ))}
      {routeLatLon && routeLatLon.length > 0 && (
        <Polyline
          positions={routeLatLon}
          color="purple"
          weight={5}
        />
      )}
    </MapContainer>
  );
};

export default Map;