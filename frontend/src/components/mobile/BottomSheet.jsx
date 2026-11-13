import { lazy, Suspense } from 'react';

let sheetPromise = null;

/**
 * Preload BottomSheet and framer-motion chunk ahead of user interaction.
 * Can be called explicitly on hover/focus/touchstart, or left to automatic idle preload.
 */
const preloadBottomSheet = () => {
  if (!sheetPromise && typeof window !== 'undefined') {
    sheetPromise = import('./BottomSheetInner');
  }
  return sheetPromise;
};

// Automatic background prefetch during idle periods & first touch
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => preloadBottomSheet(), { timeout: 3500 });
  } else {
    setTimeout(() => preloadBottomSheet(), 2000);
  }

  // Prefetch immediately on the first touchstart anywhere on mobile viewport
  const onFirstTouch = () => {
    preloadBottomSheet();
    window.removeEventListener('touchstart', onFirstTouch, { capture: true });
  };
  window.addEventListener('touchstart', onFirstTouch, { capture: true, passive: true, once: true });
}

const LazyBottomSheetInner = lazy(() => preloadBottomSheet());

/**
 * Lazy-loaded BottomSheet with idle / touchstart progressive prefetching.
 * Keeps initial route bundles clean of framer-motion while ensuring 0ms first-tap delay.
 */
export const BottomSheet = (props) => {
  if (!props.isOpen && !sheetPromise) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyBottomSheetInner {...props} />
    </Suspense>
  );
};

export default BottomSheet;
