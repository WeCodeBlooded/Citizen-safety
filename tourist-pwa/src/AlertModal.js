import React from 'react';
import './AlertModal.css';

const AlertModal = ({ message, onClose }) => {
  return (
    <div className="alert-modal-overlay">
      <div className="alert-modal-content">
        <p className="alert-modal-message">{message}</p>
        <button className="alert-modal-button" onClick={onClose}>OK</button>
      </div>
    </div>
  );
};

export default AlertModal;