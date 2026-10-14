const STORAGE_KEY = 'cpoint_attendance_offline_test';
export const OFFLINE_TEST_CHANGED = 'attendance-offline-test-changed';

export function offlineTestAvailable() {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(globalThis.location?.hostname);
}

let enabled = false;
try { enabled = offlineTestAvailable() && globalThis.sessionStorage?.getItem(STORAGE_KEY) === 'true'; }
catch { /* Testing still works if browser session storage is unavailable. */ }
let connection = new AbortController();

export function isOfflineTestEnabled() {
  return offlineTestAvailable() && enabled;
}

export function setOfflineTestEnabled(value) {
  if (!offlineTestAvailable()) throw new Error('Offline testing is available only on localhost.');
  enabled = Boolean(value);
  try { globalThis.sessionStorage?.setItem(STORAGE_KEY, String(enabled)); }
  catch { /* Keep the test setting in memory for this page. */ }
  if (enabled) connection.abort(new Error('Offline test is on. Attendance server requests are paused.'));
  else if (connection.signal.aborted) connection = new AbortController();
  globalThis.dispatchEvent?.(new Event(OFFLINE_TEST_CHANGED));
}

export function attendanceConnectionSignal() {
  if (isOfflineTestEnabled()) throw new Error('Offline test is on. Turn it off to reconnect attendance.');
  return connection.signal;
}
