import React, { useEffect, useRef, useState, useCallback } from 'react';
import './FakeCallOverlay.css';

export default function FakeCallOverlay({ onAnswer, onDecline, callerName = 'Mom', callerNumber = '+91 98765 43210' }) {
  const [isRinging, setIsRinging] = useState(true);
  const audioRef = useRef(null);

  const handleDecline = useCallback(() => {
    setIsRinging(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setTimeout(() => {
      onDecline && onDecline();
    }, 300);
  }, [onDecline]);

  useEffect(() => {
    // Play ringtone
    const audio = audioRef.current;
    if (audio) {
      audio.play().catch(err => {
        console.warn('[FakeCallOverlay] Audio play failed:', err);
      });
    }

    // Auto-dismiss after 30 seconds
    const timeout = setTimeout(() => {
      handleDecline();
    }, 30000);

    return () => {
      clearTimeout(timeout);
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, [handleDecline]);

  const handleAnswer = () => {
    setIsRinging(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setTimeout(() => {
      onAnswer && onAnswer();
    }, 500);
  };

  return (
    <div className="fake-call-overlay">
      <audio ref={audioRef} loop>
        {/* Inline data URL for a simple beep sound */}
        <source src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjGJ0fPTgjMGHm7A7+OZTR8IUKjj8bFjHQY8ldj0zX0yBSJ3x/HdkUEKFF64" type="audio/wav" />
      </audio>

      <div className="fake-call-content">
        <div className="fake-call-header">
          <p className="call-status">{isRinging ? 'Incoming Call' : 'Call Ended'}</p>
        </div>

        <div className="fake-call-body">
          <div className="caller-avatar">
            <img 
              src="https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop" 
              alt={callerName}
            />
          </div>
          <h2 className="caller-name">{callerName}</h2>
          <p className="caller-number">{callerNumber}</p>
          
          {isRinging && (
            <>
              <div className="ringing-animation">
                <div className="pulse-ring"></div>
                <div className="pulse-ring delay-1"></div>
                <div className="pulse-ring delay-2"></div>
              </div>
              <p className="ringing-text">Ringing...</p>
            </>
          )}
        </div>

        {isRinging && (
          <div className="fake-call-actions">
            <button 
              className="call-btn decline-btn" 
              onClick={handleDecline}
              aria-label="Decline call"
            >
              <span className="btn-icon">✕</span>
              <span className="btn-label">Decline</span>
            </button>
            <button 
              className="call-btn answer-btn" 
              onClick={handleAnswer}
              aria-label="Answer call"
            >
              <span className="btn-icon">📞</span>
              <span className="btn-label">Answer</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
