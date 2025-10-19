/**
 * Clear IndexedDB Helper
 * Run this in the browser console to clear the offline location database
 * and fix any IndexedDB-related errors
 */

(function() {
  console.log('[Clear IndexedDB] Starting cleanup...');
  
  // Delete the offline tracking database
  const request = indexedDB.deleteDatabase('WomenSafetyOfflineDB');
  
  request.onsuccess = function() {
    console.log('%c[Clear IndexedDB] ✅ Database deleted successfully!', 'color: green; font-weight: bold');
    console.log('[Clear IndexedDB] Please refresh the page (Ctrl+Shift+R) to reload with the new schema');
  };
  
  request.onerror = function(event) {
    console.error('[Clear IndexedDB] ❌ Error deleting database:', event);
  };
  
  request.onblocked = function() {
    console.warn('[Clear IndexedDB] ⚠️ Database deletion blocked. Please close all tabs using this app and try again.');
  };
})();
