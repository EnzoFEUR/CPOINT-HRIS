import { useState, useEffect, useCallback } from 'react';

export const THEME_STORAGE_KEY = 'cpoint_theme';
export const THEME_BROADCAST_CHANNEL = 'cpoint_theme_sync';

/**
 * Enterprise Theme Applier
 * Modifies <html> class, CSS color-scheme, and <meta name="theme-color"> synchronously.
 */
export function applyThemeToDOM(mode) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const root = document.documentElement;
  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const systemPrefersDark = Boolean(mql && mql.matches);
  const isDark = mode === 'dark' || (mode === 'system' && systemPrefersDark);

  if (isDark) {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#090d16' : '#ffffff');
  }

  return isDark;
}

/**
 * Enterprise Real-Time Theme Hook
 * Provides sub-millisecond local execution, zero-FOUC persistence,
 * and instant cross-tab synchronization via BroadcastChannel.
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return 'system';
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    } catch {
      return 'system';
    }
  });

  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  const setTheme = useCallback((newTheme) => {
    const validTheme = ['system', 'dark', 'light'].includes(newTheme) ? newTheme : 'system';
    setThemeState(validTheme);
    const activeDark = applyThemeToDOM(validTheme);
    setIsDark(activeDark);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, validTheme);

      // Real-time broadcast across all active browser windows and tabs
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
        channel.postMessage({ theme: validTheme, isDark: activeDark });
        channel.close();
      }
    } catch (err) {
      console.warn('[Theme] Storage/Broadcast unavailable:', err);
    }
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme(current => {
      if (current === 'system') return 'dark';
      if (current === 'dark') return 'light';
      return 'system';
    });
  }, [setTheme]);

  // Synchronize across tabs and listen for OS system preference changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Cross-tab real-time listener via BroadcastChannel
    let bc = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
        bc.onmessage = (event) => {
          if (event.data?.theme) {
            setThemeState(event.data.theme);
            const activeDark = applyThemeToDOM(event.data.theme);
            setIsDark(activeDark);
          }
        };
      } catch (e) {
        console.warn('[Theme] BroadcastChannel failed to initialize:', e);
      }
    }

    // 2. Storage event fallback for older or sandboxed contexts
    const handleStorage = (event) => {
      if (event.key === THEME_STORAGE_KEY && event.newValue) {
        const next = event.newValue;
        setThemeState(next);
        const activeDark = applyThemeToDOM(next);
        setIsDark(activeDark);
      }
    };
    window.addEventListener('storage', handleStorage);

    // 3. Native OS system theme changes (e.g. sunset scheduler)
    let mql = null;
    const handleSystemChange = () => {
      if (theme === 'system') {
        const activeDark = applyThemeToDOM('system');
        setIsDark(activeDark);
      }
    };

    if (window.matchMedia) {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', handleSystemChange);
    }

    return () => {
      if (bc) bc.close();
      window.removeEventListener('storage', handleStorage);
      if (mql) mql.removeEventListener('change', handleSystemChange);
    };
  }, [theme]);

  return { theme, isDark, setTheme, cycleTheme };
}
