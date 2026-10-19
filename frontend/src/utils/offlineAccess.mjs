import { isOfflineTestEnabled, OFFLINE_TEST_CHANGED } from './offlineAttendanceTestMode.mjs';

export const OFFLINE_TERMINAL_PATH = '/attendance-terminal';

export function isAppOffline() {
  return globalThis.navigator?.onLine === false || isOfflineTestEnabled();
}

export function canOpenOfflinePath(pathname) {
  return pathname === OFFLINE_TERMINAL_PATH || pathname === `${OFFLINE_TERMINAL_PATH}/`;
}

export function subscribeOfflineAccess(listener) {
  const events = ['online', 'offline', OFFLINE_TEST_CHANGED];
  events.forEach(event => globalThis.addEventListener?.(event, listener));
  return () => events.forEach(event => globalThis.removeEventListener?.(event, listener));
}
