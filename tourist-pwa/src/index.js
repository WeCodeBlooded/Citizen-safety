import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (typeof window !== 'undefined') {
  const resizeObserverErr = 'ResizeObserver loop completed with undelivered notifications.';
  window.addEventListener('error', (event) => {
    if (event?.message === resizeObserverErr || event?.error?.message === resizeObserverErr) {
      event.stopImmediatePropagation();
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    const message = event?.reason?.message;
    if (message === resizeObserverErr) {
      event.preventDefault();
    }
  });
}



reportWebVitals();
