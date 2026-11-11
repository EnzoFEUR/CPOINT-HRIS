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
 * Enterprise Fluid Transition Orchestrator
 * Progressive enhancement:
 * 1. View Transitions API (Chrome 111+, Edge 111+, Safari 18+) with radial ripple when click origin exists.
 * 2. Silky global crossfade when triggered via shortcut or cross-tab sync.
 * 3. Scoped 320ms CSS transition fallback for older browser engines.
 * 4. Zero animation if user has prefers-reduced-motion enabled.
 */
export function transitionTheme(applyFn, origin = null) {
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

  // 1. View Transitions API
  if (typeof document.startViewTransition === 'function') {
    if (origin && typeof origin.x === 'number' && typeof origin.y === 'number') {
      root.classList.add('theme-ripple-transition');
      const { x, y } = origin;
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      try {
        const transition = document.startViewTransition(() => {
          applyFn();
        });

        transition.ready.then(() => {
          try {
            const animation = root.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${endRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: 400,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                pseudoElement: '::view-transition-new(root)',
              }
            );

            animation.onfinish = () => {
              root.classList.remove('theme-ripple-transition');
            };
            animation.oncancel = () => {
              root.classList.remove('theme-ripple-transition');
            };
          } catch {
            root.classList.remove('theme-ripple-transition');
          }
        }).catch(() => {
          root.classList.remove('theme-ripple-transition');
        });

        transition.finished.finally(() => {
          root.classList.remove('theme-ripple-transition');
        });
        return;
      } catch {
        root.classList.remove('theme-ripple-transition');
      }
    } else {
      // Crossfade transition when origin is not available
      try {
        document.startViewTransition(() => {
          applyFn();
        });
        return;
      } catch {
        // Fall through to CSS fallback
      }
    }
  }

  // 2. Scoped CSS transition fallback (Firefox / older engines)
  root.classList.add('theme-transition');
  applyFn();
  window.setTimeout(() => {
    root.classList.remove('theme-transition');
  }, 350);
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

    // Resolve click/touch origin coordinates if available
    let origin = null;
    if (eventOrOrigin) {
      if (
        typeof eventOrOrigin.clientX === 'number' &&
        typeof eventOrOrigin.clientY === 'number' &&
        (eventOrOrigin.clientX !== 0 || eventOrOrigin.clientY !== 0)
      ) {
        origin = { x: eventOrOrigin.clientX, y: eventOrOrigin.clientY };
      } else if (typeof eventOrOrigin.x === 'number' && typeof eventOrOrigin.y === 'number') {
        origin = { x: eventOrOrigin.x, y: eventOrOrigin.y };
      } else if (eventOrOrigin.currentTarget?.getBoundingClientRect) {
        const rect = eventOrOrigin.currentTarget.getBoundingClientRect();
        origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      } else if (eventOrOrigin.target?.getBoundingClientRect) {
        const rect = eventOrOrigin.target.getBoundingClientRect();
        origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }

    let activeDark = false;
    transitionTheme(() => {
      setThemeState(validTheme);
      activeDark = applyThemeToDOM(validTheme);
      setIsDark(activeDark);
    }, origin);

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
