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
 * Enterprise Fluid Transition Orchestrator (iOS Spring Sliding Physics)
 * Progressive enhancement:
 * 1. View Transitions API (Chrome 111+, Edge 111+, Safari 18+) with native GPU-accelerated
 *    bouncy sliding transitions (@keyframes ios-slide-in-from-right / from-left) with spring overshoot.
 * 2. Parallax recession on outgoing snapshot with subtle depth dimming.
 * 3. Scoped 450ms CSS transition fallback with Apple spring easing for older browser engines.
 * 4. Zero animation if user has prefers-reduced-motion enabled.
 */
export function transitionTheme(applyFn, direction = 'from-right') {
  if (typeof document === 'undefined') {
    applyFn();
    return;
  }

  const root = document.documentElement;
  const prefersReducedMotion = Boolean(
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  );

  // If user requests reduced motion, apply synchronously with 0ms transition
  if (prefersReducedMotion) {
    applyFn();
    return;
  }

  // 1. View Transitions API with GPU-accelerated iOS spring sliding physics
  if (typeof document.startViewTransition === 'function') {
    const slideClass = direction === 'from-left' ? 'theme-slide-from-left' : 'theme-slide-from-right';
    root.classList.add(slideClass);

    try {
      const transition = document.startViewTransition(() => {
        applyFn();
      });

      transition.finished.finally(() => {
        root.classList.remove('theme-slide-from-left', 'theme-slide-from-right');
      });
      return;
    } catch {
      root.classList.remove('theme-slide-from-left', 'theme-slide-from-right');
    }
  }

  // 2. Scoped CSS transition fallback (Firefox / older engines)
  root.classList.add('theme-transition');
  applyFn();
  window.setTimeout(() => {
    root.classList.remove('theme-transition');
  }, 460);
}

/**
 * Enterprise Real-Time Theme Hook
 * Provides sub-millisecond local execution, zero-FOUC persistence,
 * fluid View Transitions, and instant cross-tab synchronization.
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

  const setTheme = useCallback((newTheme, eventOrDirection = null) => {
    const validTheme = ['system', 'dark', 'light'].includes(newTheme) ? newTheme : 'system';

    // Determine fluid sliding direction
    let direction = 'from-right';
    if (typeof eventOrDirection === 'string' && (eventOrDirection === 'from-left' || eventOrDirection === 'from-right')) {
      direction = eventOrDirection;
    } else {
      const currentDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
      const targetDark = validTheme === 'dark' || (validTheme === 'system' && Boolean(typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches));
      if (currentDark !== targetDark) {
        direction = targetDark ? 'from-right' : 'from-left';
      } else {
        const themeOrder = ['light', 'system', 'dark'];
        const prevIdx = themeOrder.indexOf(theme);
        const nextIdx = themeOrder.indexOf(validTheme);
        direction = nextIdx >= prevIdx ? 'from-right' : 'from-left';
      }
    }

    let activeDark = false;
    transitionTheme(() => {
      setThemeState(validTheme);
      activeDark = applyThemeToDOM(validTheme);
      setIsDark(activeDark);
    }, direction);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, validTheme);

      // Real-time broadcast across all active browser windows and tabs
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
        channel.postMessage({ theme: validTheme, isDark: activeDark, direction });
        channel.close();
      }
    } catch (err) {
      console.warn('[Theme] Storage/Broadcast unavailable:', err);
    }
  }, [theme]);

  const cycleTheme = useCallback((eventOrDirection = null) => {
    const nextTheme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    const direction = nextTheme === 'light' ? 'from-left' : 'from-right';
    setTheme(nextTheme, typeof eventOrDirection === 'string' ? eventOrDirection : direction);
  }, [theme, setTheme]);

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
            transitionTheme(() => {
              setThemeState(event.data.theme);
              const activeDark = applyThemeToDOM(event.data.theme);
              setIsDark(activeDark);
            });
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
        transitionTheme(() => {
          setThemeState(next);
          const activeDark = applyThemeToDOM(next);
          setIsDark(activeDark);
        });
      }
    };
    window.addEventListener('storage', handleStorage);

    // 3. Native OS system theme changes (e.g. sunset scheduler)
    let mql = null;
    const handleSystemChange = () => {
      if (theme === 'system') {
        transitionTheme(() => {
          const activeDark = applyThemeToDOM('system');
          setIsDark(activeDark);
        });
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
