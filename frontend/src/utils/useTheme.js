import { useState, useEffect, useCallback } from 'react';

export const THEME_STORAGE_KEY = 'cpoint_theme';
export const THEME_BROADCAST_CHANNEL = 'cpoint_theme_sync';
const CLIENT_INSTANCE_ID = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

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
 * Enterprise Fluid Transition Orchestrator (Circular Reveal & Slide Fallback)
 * Progressive enhancement:
 * 1. View Transitions API with circular clip-path reveal expanding from toggle coordinates.
 * 2. Disabled CSS cross-fade on ::view-transition snapshots via html.theme-circular-reveal to prevent interruption.
 * 3. Scoped 450ms CSS transition fallback for older browser engines.
 * 4. Zero animation if user has prefers-reduced-motion enabled.
 */
export function transitionTheme(applyFn, originOrDirection = null) {
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
    const isDirectionString = typeof originOrDirection === 'string' && (originOrDirection === 'from-left' || originOrDirection === 'from-right');

    if (!isDirectionString) {
      // Circular Reveal from click/touch coordinates or element
      let x = typeof window !== 'undefined' ? Math.round(window.innerWidth / 2) : 195;
      let y = 0;

      if (originOrDirection) {
        // 1. Element bounding rect
        const targetEl = originOrDirection.currentTarget || originOrDirection.target;
        if (targetEl && typeof targetEl.getBoundingClientRect === 'function') {
          const rect = targetEl.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            x = Math.round(rect.left + rect.width / 2);
            y = Math.round(rect.top + rect.height / 2);
          }
        }

        // 2. Direct event or nativeEvent coordinates
        const clientX = typeof originOrDirection.clientX === 'number'
          ? originOrDirection.clientX
          : originOrDirection.nativeEvent?.clientX;
        const clientY = typeof originOrDirection.clientY === 'number'
          ? originOrDirection.clientY
          : originOrDirection.nativeEvent?.clientY;

        if (typeof clientX === 'number' && typeof clientY === 'number' && (clientX !== 0 || clientY !== 0)) {
          x = Math.round(clientX);
          y = Math.round(clientY);
        } else if (typeof originOrDirection.x === 'number' && typeof originOrDirection.y === 'number') {
          x = Math.round(originOrDirection.x);
          y = Math.round(originOrDirection.y);
        }
      }

      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      root.classList.add('theme-circular-reveal');

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
                duration: 450,
                easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
                pseudoElement: '::view-transition-new(root)',
              }
            );
          } catch {
            // Graceful fallback if pseudoElement animation unsupported
          }
        }).catch(() => {});

        transition.finished.finally(() => {
          root.classList.remove('theme-circular-reveal');
        });
        return;
      } catch {
        root.classList.remove('theme-circular-reveal');
      }
    } else {
      const slideClass = originOrDirection === 'from-left' ? 'theme-slide-from-left' : 'theme-slide-from-right';
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
    if (typeof window === 'undefined') return 'light';
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || 'light';
    } catch {
      return 'light';
    }
  });

  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  const setTheme = useCallback((newTheme, eventOrOrigin = null) => {
    const validTheme = ['light', 'dark', 'system'].includes(newTheme) ? newTheme : 'light';

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
        channel.postMessage({ theme: validTheme, isDark: activeDark, senderId: CLIENT_INSTANCE_ID });
        channel.close();
      }
    } catch (err) {
      console.warn('[Theme] Storage/Broadcast unavailable:', err);
    }

    // 4. Asynchronous Cloud Account Sync (Enterprise Roaming)
    // Non-blocking background sync; preserves sub-millisecond local execution
    try {
      if (typeof window !== 'undefined') {
        import('../supabaseClient')
          .then(({ supabase }) => {
            supabase.auth.getSession().then(({ data: { session } }) => {
              if (session?.user?.id) {
                supabase.auth.updateUser({
                  data: { theme_preference: validTheme }
                }).catch(() => { /* Silent failure during offline / network timeout */ });
              }
            }).catch(() => {});
          })
          .catch(() => {});
      }
    } catch { /* Background dual-write is best-effort */ }
  }, []);

  const cycleTheme = useCallback((eventOrOrigin = null) => {
    const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
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
          if (event.data?.theme && event.data?.senderId !== CLIENT_INSTANCE_ID) {
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

  // 4. Initial cloud metadata reconciliation for authenticated sessions
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      import('../supabaseClient')
        .then(({ supabase }) => {
          supabase.auth.getSession().then(({ data: { session } }) => {
            const cloudTheme = session?.user?.user_metadata?.theme_preference;
            if (cloudTheme && ['system', 'dark', 'light'].includes(cloudTheme)) {
              const localTheme = localStorage.getItem(THEME_STORAGE_KEY);
              if (localTheme !== cloudTheme) {
                setThemeState(cloudTheme);
                const activeDark = applyThemeToDOM(cloudTheme);
                setIsDark(activeDark);
                try {
                  localStorage.setItem(THEME_STORAGE_KEY, cloudTheme);
                } catch {
                  /* ignore storage error */
                }
              }
            }
          }).catch(() => {});
        })
        .catch(() => {});
    } catch {
      /* ignore sync error */
    }
  }, []);

  return { theme, isDark, setTheme, cycleTheme };
}
