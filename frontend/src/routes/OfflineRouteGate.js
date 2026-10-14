import { createElement, useSyncExternalStore } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { canOpenOfflinePath, isAppOffline, OFFLINE_TERMINAL_PATH, subscribeOfflineAccess } from '../utils/offlineAccess.mjs';

export const isOfflineFeatureActive = Boolean(
  import.meta.env.DEV ||
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(globalThis.location?.hostname) ||
  import.meta.env.VITE_ENABLE_OFFLINE_ATTENDANCE === 'true'
);

export default function OfflineRouteGate() {
  const offline = useSyncExternalStore(subscribeOfflineAccess, isAppOffline, isAppOffline);
  const { pathname } = useLocation();
  if (isOfflineFeatureActive && offline && !canOpenOfflinePath(pathname)) {
    return createElement(Navigate, { to: OFFLINE_TERMINAL_PATH, replace: true });
  }
  return createElement(Outlet);
}
