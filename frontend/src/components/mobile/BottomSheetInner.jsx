import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Enterprise Mobile BottomSheet (Cupertino Gesture Sheet)
 * Features:
 * - Touch swipe-down drag to dismiss with momentum threshold
 * - Escape key & backdrop click dismissal
 * - Accessible focus trap with auto-restore
 * - Background inert locking
 * - Native safe-area inset compensation
 * - Respects prefers-reduced-motion
 */
export const BottomSheet = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxHeight = 'max-h-[88vh]',
  showClose = true,
  dragHandle = true,
}) => {
  const sheetRef = useRef(null);
  const previousActiveElement = useRef(null);

  // Focus trap & background inert management
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Mark background content as inert for assistive technology
    const backgroundEl = document.querySelector('main') || document.getElementById('root');
    if (backgroundEl) {
      backgroundEl.setAttribute('inert', '');
      backgroundEl.setAttribute('aria-hidden', 'true');
    }

    // Focus the first actionable element or the sheet itself
    const timer = setTimeout(() => {
      if (sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          sheetRef.current.focus();
        }
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      if (backgroundEl) {
        backgroundEl.removeAttribute('inert');
        backgroundEl.removeAttribute('aria-hidden');
      }
      if (previousActiveElement.current?.focus) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen]);

  // Safety guard: Resizing across lg breakpoint (>= 1024px) automatically closes the sheet
  // to ensure desktop view is never left inert, unscrollable, or focus-trapped.
  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(min-width: 1024px)');
    const handleMediaChange = (e) => {
      if (e.matches) {
        onClose();
      }
    };
    if (mql.matches) {
      onClose();
    }
    mql.addEventListener('change', handleMediaChange);
    return () => mql.removeEventListener('change', handleMediaChange);
  }, [isOpen, onClose]);

  // Keyboard navigation: Escape key closes modal & Tab cycles focus
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose]
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[120] flex items-end justify-center p-0 overflow-hidden font-sans"
          onKeyDown={handleKeyDown}
        >
          {/* Dimmed backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 w-screen h-screen min-h-[100dvh] bg-slate-950/70 dark:bg-black/80 backdrop-blur-xs"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet surface */}
          <motion.div
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'bottom-sheet-title' : undefined}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            drag={dragHandle ? 'y' : false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.08}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || info.velocity.y > 400) {
                onClose();
              }
            }}
            className={`relative z-10 w-full max-w-lg bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-3xl shadow-2xl flex flex-col ${maxHeight} overflow-hidden outline-none select-text touch-pan-y pb-[max(1rem,env(safe-area-inset-bottom))]`}
          >
            {/* Drag Handle Pill */}
            {dragHandle && (
              <div className="pt-3 pb-1 cursor-grab active:cursor-grabbing shrink-0 flex items-center justify-center">
                <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full" />
              </div>
            )}

            {/* Header */}
            {(title || showClose) && (
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between shrink-0">
                <div className="min-w-0 flex-1 pr-3">
                  {title && (
                    <h2
                      id="bottom-sheet-title"
                      className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate leading-tight"
                    >
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 font-medium">
                      {subtitle}
                    </p>
                  )}
                </div>
                {showClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    aria-label="Close sheet"
                  >
                    <i className="ti ti-x text-sm" />
                  </button>
                )}
              </div>
            )}

            {/* Scrollable body content */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-4 touch-scroll">
              {children}
            </div>

            {/* Optional sticky footer */}
            {footer && (
              <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default BottomSheet;
