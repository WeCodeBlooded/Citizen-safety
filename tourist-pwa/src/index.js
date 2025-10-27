import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import RedesignHome from './RedesignHome';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
const rootElement = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If the user opens the app with ?redesign=1 or sets localStorage.USE_REDESIGN = '1',
// show the lightweight redesign landing page instead of the full App. This is
// non-destructive and makes it easy to preview a new UI locally.
try {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const useRedesignFlag = params?.get('redesign') === '1' || (typeof localStorage !== 'undefined' && localStorage.getItem('USE_REDESIGN') === '1');
  if (useRedesignFlag) {
    root.render(
      <React.StrictMode>
        <RedesignHome />
      </React.StrictMode>
    );
  } else {
    root.render(rootElement);
  }
} catch (e) {
  // Fallback to normal app on any error
  root.render(rootElement);
}

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
