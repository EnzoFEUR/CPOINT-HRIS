import { useSyncExternalStore } from 'react';

/**
 * Enterprise Mobile Media Query Hook
 * Subscribes to window.matchMedia via useSyncExternalStore to eliminate cascading renders.
 * Tracks whether the current viewport is below the target breakpoint (default: 1024px / lg).
 * Allows desktop routes to skip mounting mobile-only shells, drawers, or framer-motion components.
 */
export function useIsMobile(breakpoint = 1024) {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) {
        return () => {};
      }
      const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    () => {
      if (typeof window === 'undefined' || !window.matchMedia) return false;
      return window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
    },
    () => false // Server snapshot
  );
}

export default useIsMobile;
