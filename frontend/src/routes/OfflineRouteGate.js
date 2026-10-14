import { createElement, useSyncExternalStore } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { canOpenOfflinePath, isAppOffline, OFFLINE_TERMINAL_PATH, subscribeOfflineAccess } from '../utils/offlineAccess.mjs';
import { canUseAttendanceTerminal } from '../../../shared/offlineAttendance.mjs';
import { getStoredUser, subscribeStoredUser } from '../utils/storedUser.mjs';

const terminalAccess = () => {
  const user = getStoredUser();
  if (!user) return 'login';
  if (user.requires_password_change) return 'setup';
  return canUseAttendanceTerminal(user) ? 'allowed' : 'denied';
};

export const isOfflineFeatureActive = Boolean(
  import.meta.env?.DEV ||
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(globalThis.location?.hostname) ||
  import.meta.env?.VITE_ENABLE_OFFLINE_ATTENDANCE === 'true'
);

export default function OfflineRouteGate() {
  const offline = useSyncExternalStore(subscribeOfflineAccess, isAppOffline, isAppOffline);
  const access = useSyncExternalStore(subscribeStoredUser, terminalAccess, terminalAccess);
  const { pathname } = useLocation();
  if ((isOfflineFeatureActive && offline) || canOpenOfflinePath(pathname)) {
    if (access !== 'allowed') {
      if (!offline) return createElement(Navigate, { to: access === 'login' ? '/login' : access === 'setup' ? '/force-password-change' : '/', replace: true });
      return createElement('main', { className: 'min-h-screen bg-canvas p-6 text-ink' },
        createElement('h1', { className: 'text-lg font-semibold' }, 'Security Guard and Admin only'),
        createElement('p', { role: 'status' }, 'Reconnect and sign in with an authorized account. Online employee features are unavailable offline.'),
      );
    }
  }
  if (isOfflineFeatureActive && offline && !canOpenOfflinePath(pathname)) {
    return createElement(Navigate, { to: OFFLINE_TERMINAL_PATH, replace: true });
  }
  return createElement(Outlet);
}
