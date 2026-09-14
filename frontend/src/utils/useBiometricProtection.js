import { useEffect } from 'react';

/**
 * Enterprise hook to prevent unauthorized photo dragging, saving, or context-menu access
 * on biometric captures and employee profile photos.
 */
export const useBiometricProtection = () => {
  useEffect(() => {
    const handleContextMenu = (e) => {
      if (
        e.target.tagName === 'IMG' ||
        e.target.closest('img') ||
        e.target.closest('[data-protected-photo]') ||
        e.target.closest('.protected-photo')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleDragStart = (e) => {
      if (e.target.tagName === 'IMG' || e.target.closest('img')) {
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
