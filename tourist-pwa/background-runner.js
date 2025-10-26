// Capacitor Background Runner script
// This runs in a background context on native builds (Android/iOS)
// Keep it minimal: avoid large imports. Use fetch and Capacitor plugins via global if needed.

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Derive backend URL with safe defaults
  const getBackend = () => {
    try {
      // Some runtimes expose window even in background. Guard it.
      if (typeof window !== 'undefined' && window.location) {
        const host = window.location.hostname;
        const proto = window.location.protocol || 'http:';
        if (/^(localhost|127\.0\.0\.1)$/.test(host)) return process.env.REACT_APP_BACKEND_URL;
        return `${proto}//${host}:3001`;
      }
    } catch {}
    return process.env.REACT_APP_BACKEND_URL;
  };

  const BACKEND_URL = getBackend();

  // Try to get a last-known passportId from a cookie-like store if available
  // In background context, access to cookies/localStorage isn't guaranteed.
  // You can adapt this to pull from a secure store via Capacitor Preferences if needed.
  let PASSPORT_ID = null;

  // Basic geolocation polling using the Web Geolocation API if available
  async function getCurrentPositionOnce() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
    return new Promise((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp || Date.now(),
          }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      } catch {
        resolve(null);
      }
    });
  }

  async function sendLocation(loc) {
    if (!loc) return;
    try {
      const payload = {
        passportId: PASSPORT_ID,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        timestamp: loc.timestamp || Date.now(),
        source: 'native-background',
      };
      await fetch(`${BACKEND_URL}/api/v1/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // swallow errors silently in background
    }
  }

  // Main loop: every 30s (configured in capacitor.config.json), attempt a reading and post it
  // If platform provides a different scheduling mechanism, Background Runner will re-invoke this file.
  try {
    const loc = await getCurrentPositionOnce();
    if (loc) await sendLocation(loc);
  } catch {}

  // Small delay to ensure the function doesn't exit too abruptly
  await sleep(50);
})();
