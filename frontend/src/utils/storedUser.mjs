export const USER_CHANGED = 'cpoint_user_changed';

export function getStoredUser() {
  try {
    const raw = globalThis.localStorage?.getItem('user');
    return raw && raw !== 'undefined' ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function subscribeStoredUser(listener) {
  const storageChanged = event => { if (!event.key || ['user', 'cpoint_auth_sync_event'].includes(event.key)) listener(); };
  globalThis.addEventListener?.('storage', storageChanged);
  globalThis.addEventListener?.(USER_CHANGED, listener);
  return () => {
    globalThis.removeEventListener?.('storage', storageChanged);
    globalThis.removeEventListener?.(USER_CHANGED, listener);
  };
}
