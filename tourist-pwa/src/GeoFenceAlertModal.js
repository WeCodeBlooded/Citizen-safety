
import React from "react";
import { MapContainer, TileLayer, Marker, Polygon, Popup } from "react-leaflet";
import "./GeoFenceAlertModal.css"; 

function GeoFenceAlertModal({ alertData, userPosition, onClose, onResponse }) {
  if (!alertData) return null;

  
  const isDislocationAlert = alertData.dislocatedMember;

  const handleResponse = (response) => {
    if (onResponse) {
      onResponse(response); 
    }
  };

  return (
    <div className="modal-overlay"> {}
      <div className="modal-content">
        {isDislocationAlert ? (
          
          <>
            <h2 className="modal-title">
              <i className="fas fa-users-slash"></i> Group Dislocation Alert!
            </h2>
            <p className="modal-message">
              Your group member <strong>{alertData.dislocatedMember}</strong> is
              approximately <strong>{alertData.distance} km</strong> away from{" "}
              <strong>{alertData.otherMember}</strong>.
            </p>
            <p className="modal-question">Are you aware of this?</p>
            <div className="modal-actions">
              <button
                className="modal-button button-no"
                onClick={() => handleResponse('no')}
              >
                No
              </button>
              <button
                className="modal-button button-yes"
                onClick={() => handleResponse('yes')}
              >
                Yes
              </button>
            </div>
          </>
        ) : (
          
          <>
            <h2>
              <i className="fas fa-exclamation-triangle"></i>{" "}
              {alertData.title || "Geo-Fence Alert"}
            </h2>
            <p>{alertData.message}</p>
            <div className="map-container">
              <MapContainer
                center={userPosition ? [userPosition.latitude, userPosition.longitude] : [28.6139, 77.209]}
                zoom={15}
                scrollWheelZoom={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {userPosition && (
                  <Marker position={[userPosition.latitude, userPosition.longitude]}>
                    <Popup>You are here</Popup>
                  </Marker>
                )}
                {alertData.zoneCoordinates && alertData.zoneCoordinates.length > 0 && (
                  <Polygon pathOptions={{ color: 'red' }} positions={alertData.zoneCoordinates} />
                )}
              </MapContainer>
            </div>
            <button onClick={onClose} className="primary-button">
              I Understand
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default GeoFenceAlertModal;