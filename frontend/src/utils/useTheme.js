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
 * Enterprise Fluid Circular Reveal Orchestrator
 * Progressive enhancement:
 * 1. View Transitions API (Chrome 111+, Edge 111+, Safari 18+) with native GPU-accelerated
 *    circular clip-path reveal originating at the exact center of the trigger element.
 * 2. Cinematic expo curve cubic-bezier(.65, 0, .15, 1) over 720ms.
 * 3. Registered @property CSS colour token interpolation for browsers without View Transitions.
 * 4. Zero animation if user has prefers-reduced-motion enabled.
 */
export function transitionTheme(applyFn, originElOrCoords = null) {
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

  // 1. View Transitions API with Circular Reveal
  if (typeof document.startViewTransition === 'function') {
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;

    if (originElOrCoords) {
      if (typeof originElOrCoords.getBoundingClientRect === 'function') {
        const rect = originElOrCoords.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      } else if (originElOrCoords.currentTarget?.getBoundingClientRect) {
        const rect = originElOrCoords.currentTarget.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      } else if (originElOrCoords.target?.getBoundingClientRect) {
        const rect = originElOrCoords.target.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      } else if (typeof originElOrCoords.clientX === 'number' && typeof originElOrCoords.clientY === 'number') {
        if (originElOrCoords.clientX !== 0 || originElOrCoords.clientY !== 0) {
          x = originElOrCoords.clientX;
          y = originElOrCoords.clientY;
        }
      } else if (typeof originElOrCoords.x === 'number' && typeof originElOrCoords.y === 'number') {
        x = originElOrCoords.x;
        y = originElOrCoords.y;
      }
    }

    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    try {
      const transition = document.startViewTransition(() => {
        applyFn();
      });

      transition.ready.then(() => {
        try {
          root.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${radius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 720,
              easing: 'cubic-bezier(.65, 0, .15, 1)',
              pseudoElement: '::view-transition-new(root)',
            }
          );
        } catch {
          // Graceful fallback if pseudoElement animation unsupported
        }
      }).catch(() => {});

      return;
    } catch {
      // Fall through to CSS fallback
    }
  }

  // 2. Scoped CSS @property color fade fallback (Firefox / older engines)
  root.classList.add('theme-fade');
  applyFn();
  window.setTimeout(() => {
    root.classList.remove('theme-fade');
  }, 750);
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

  const setTheme = useCallback((newTheme, eventOrOrigin = null) => {
    const validTheme = ['system', 'dark', 'light'].includes(newTheme) ? newTheme : 'system';

    let activeDark = false;
    transitionTheme(() => {
      setThemeState(validTheme);
      activeDark = applyThemeToDOM(validTheme);
      setIsDark(activeDark);
    }, eventOrOrigin);

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

  const cycleTheme = useCallback((eventOrOrigin = null) => {
    const nextTheme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    setTheme(nextTheme, eventOrOrigin);
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
