import { supabase } from '../supabaseClient';
import { getUser, isAdmin, isSecurity } from '../routes/guards';

const AUTH_SYNC_KEY = 'cpoint_auth_sync_event';

/**
 * Enterprise Single Sign-Out across all browser tabs:
 * Terminates the Supabase session, purges user credentials and profile caches,
 * notifies all other open windows/tabs via storage event, and navigates to login.
 */
export const performLogout = async (redirectUrl = '/login') => {
  try {
    // 1. Notify other open tabs immediately via broadcast storage event
    try {
      localStorage.setItem(
        AUTH_SYNC_KEY,
        JSON.stringify({
          type: 'LOGOUT',
          timestamp: Date.now()
        })
      );
    } catch (_) {}

    // 2. Sign out locally from Supabase
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (err) {
      console.warn('[AUTH] Supabase signOut warning:', err);
    }

    // 3. Purge user state and scoped caches
    localStorage.removeItem('user');
    try {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith('cpoint_') || key.includes('profile') || key.includes('auth')) {
          sessionStorage.removeItem(key);
        }
      });
      sessionStorage.removeItem('cpoint_login_2fa_session');
      sessionStorage.removeItem('cpoint_my_profile_cache');
    } catch (_) {}

    // 4. Clean up broadcast trigger key shortly after
    setTimeout(() => {
      try {
        localStorage.removeItem(AUTH_SYNC_KEY);
      } catch (_) {}
    }, 150);

    // 5. Hard redirect to /login to flush in-memory state cleanly
    window.location.href = redirectUrl;
  } catch (err) {
    console.error('[AUTH] Fatal error during logout:', err);
    window.location.href = redirectUrl || '/login';
  }
};

/**
 * Broadcast an authentication state update (such as login or profile update)
 * to all open tabs and windows in real time.
 */
export const broadcastAuthChange = (user) => {
  try {
    localStorage.setItem(
      AUTH_SYNC_KEY,
      JSON.stringify({
        type: 'AUTH_UPDATE',
        userId: user?.id,
        role: user?.role,
        name: user?.name,
        timestamp: Date.now()
      })
    );
    setTimeout(() => {
      try {
        localStorage.removeItem(AUTH_SYNC_KEY);
      } catch (_) {}
    }, 150);
  } catch (_) {}
};

/**
 * Real-Time Cross-Tab & Supabase Authentication Synchronizer:
 * Subscribes to window storage events and Supabase onAuthStateChange
 * to ensure that all open tabs reflect identity changes immediately with 0ms lag.
 */
export const subscribeToAuthSync = ({ onUserChange, onLogout }) => {
  const handleStorage = (e) => {
    // Case 1: Explicit cross-tab broadcast sync message
    if (e.key === AUTH_SYNC_KEY && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        if (payload.type === 'LOGOUT') {
          if (onLogout) onLogout();
          return;
        }
        if (payload.type === 'AUTH_UPDATE') {
          const freshUser = getUser();
          if (onUserChange) onUserChange(freshUser);
          return;
        }
      } catch (_) {}
    }

    // Case 2: Direct user object or Supabase token modification in another tab
    if (e.key === 'user' || (e.key && e.key.startsWith('sb-'))) {
      const freshUser = getUser();
      if (!freshUser) {
        if (onLogout) onLogout();
      } else {
        if (onUserChange) onUserChange(freshUser);
      }
    }
  };

  window.addEventListener('storage', handleStorage);

  // Supabase real-time auth state subscription
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      const currentUser = getUser();
      if (!currentUser && onLogout) {
        onLogout();
      }
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      const freshUser = getUser();
      if (freshUser && onUserChange) {
        onUserChange(freshUser);
      }
    }
  });

  return () => {
    window.removeEventListener('storage', handleStorage);
    subscription?.unsubscribe();
  };
};
