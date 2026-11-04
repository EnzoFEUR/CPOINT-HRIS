import { useEffect } from 'react';

/**
 * Enterprise hook to prevent unauthorized photo dragging, saving, or context-menu access
 * on biometric captures and employee profile photos.
 */
export const useBiometricProtection = () => {
  useEffect(() => {
    const isProtectedTarget = (target) => {
      const el = target instanceof Element ? target : target?.parentElement;
      if (!el || typeof el.closest !== 'function') return false;
      return el.tagName === 'IMG' || Boolean(el.closest('img, [data-protected-photo], .protected-photo'));
    };

    const handleContextMenu = (e) => {
      if (isProtectedTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleDragStart = (e) => {
      if (isProtectedTarget(e.target)) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu, { capture: true });
    document.addEventListener('dragstart', handleDragStart, { capture: true });

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      document.removeEventListener('dragstart', handleDragStart, { capture: true });
    };
  }, []);
};

export default useBiometricProtection;
