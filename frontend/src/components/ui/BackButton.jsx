import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Enterprise Production BackButton
 * Zero-latency client-side navigation with smart history boundary fallback,
 * keyboard shortcut acceleration (Alt + Left Arrow), and touch-target compliance.
 */
export const BackButton = ({
    fallback = '/',
    label = 'Back',
    compact = false,
    enableShortcut = true,
    variant = 'default',
    className = '',
    onClick,
}) => {
    const navigate = useNavigate();

    const handleNavigate = useCallback((e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (onClick) {
            onClick();
            return;
        }

        // Smart history depth inspection:
        // In React Router, window.history.state.idx tracks navigation depth within the current session.
        const hasHistory = typeof window !== 'undefined' &&
                           window.history.state &&
                           typeof window.history.state.idx === 'number' &&
                           window.history.state.idx > 0;

        if (hasHistory) {
            navigate(-1);
        } else {
            navigate(fallback, { replace: true });
        }
    }, [navigate, fallback, onClick]);

    // Keyboard shortcut acceleration: Alt + ArrowLeft
    useEffect(() => {
        if (!enableShortcut) return;

        const handleKeyDown = (event) => {
            const tag = event.target?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) {
                return;
            }

            if (event.altKey && event.key === 'ArrowLeft') {
                event.preventDefault();
                handleNavigate();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enableShortcut, handleNavigate]);

    const variantStyles = {
        default: 'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-200 shadow-2xs',
        dark: 'bg-slate-900/90 hover:bg-slate-800 text-white/90 hover:text-white border-slate-700/80 shadow-md backdrop-blur-md',
        ghost: 'bg-transparent hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-transparent',
    }[variant] || 'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-200 shadow-2xs';

    const iconVariantStyles = {
        default: 'text-slate-500 group-hover:text-slate-800',
        dark: 'text-white/80 group-hover:text-white',
        ghost: 'text-slate-500 group-hover:text-slate-800',
    }[variant] || 'text-slate-500 group-hover:text-slate-800';

    return (
        <button
            type="button"
            onClick={handleNavigate}
            aria-label={label ? `${label} (Alt + Left Arrow)` : 'Go back'}
            title={enableShortcut ? `${label} (Alt + ←)` : label}
            className={`group inline-flex items-center justify-center gap-1.5 h-8 ${
                compact ? 'w-8 px-0' : 'px-2.5 sm:px-3'
            } border rounded-md text-xs font-semibold transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 cursor-pointer select-none shrink-0 touch-manipulation active:scale-[0.98] ${variantStyles} ${className}`}
        >
            <ArrowLeft className={`w-3.5 h-3.5 ${iconVariantStyles} group-hover:-translate-x-0.5 transition-transform duration-100 shrink-0`} />
            {!compact && <span>{label}</span>}
        </button>
    );
};

export default React.memo(BackButton);
