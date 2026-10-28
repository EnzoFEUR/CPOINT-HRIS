import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';

const ConfirmContext = createContext(null);

/**
 * Enterprise confirmation dialog hook.
 * Returns an async function `confirm(options)` that resolves to `true` (confirmed) or `false` (cancelled).
 */
export function useConfirm() {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('useConfirm must be used within a <ConfirmProvider>');
    }
    return context;
}

/**
 * Global ConfirmProvider that mounts at root and manages enterprise confirmation dialogs
 * with 0ms latency, zero thread blocking, accessible focus trapping, and mobile bottom sheet ergonomics.
 */
export function ConfirmProvider({ children }) {
    const [dialogState, setDialogState] = useState(null);

    const confirm = useCallback((options) => {
        return new Promise((resolve) => {
            const normalized = typeof options === 'string'
                ? { message: options }
                : (options || {});

            setDialogState({
                title: normalized.title || (normalized.destructive || normalized.variant === 'danger' ? 'Confirm Deletion' : 'Confirm Action'),
                message: normalized.message || 'Are you sure you want to proceed?',
                description: normalized.description || null,
                variant: normalized.destructive ? 'danger' : (normalized.variant || 'accent'),
                confirmLabel: normalized.confirmLabel || (normalized.destructive || normalized.variant === 'danger' ? 'Delete' : 'Confirm'),
                cancelLabel: normalized.cancelLabel || 'Cancel',
                icon: normalized.icon || null,
                destructive: Boolean(normalized.destructive || normalized.variant === 'danger'),
                resolve,
            });
        });
    }, []);

    const handleConfirm = useCallback(() => {
        if (dialogState?.resolve) {
            dialogState.resolve(true);
        }
        setDialogState(null);
    }, [dialogState]);

    const handleCancel = useCallback(() => {
        if (dialogState?.resolve) {
            dialogState.resolve(false);
        }
        setDialogState(null);
    }, [dialogState]);

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {dialogState && (
                <ConfirmDialogModal
                    {...dialogState}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                />
            )}
        </ConfirmContext.Provider>
    );
}

function ConfirmDialogModal({
    title,
    message,
    description,
    variant = 'accent',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    icon,
    destructive = false,
    onConfirm,
    onCancel,
}) {
    const confirmButtonRef = useRef(null);
    const cancelButtonRef = useRef(null);
    const dialogRef = useRef(null);
    const previousFocusRef = useRef(null);

    // Save previous active element to restore focus on unmount
    useEffect(() => {
        previousFocusRef.current = document.activeElement;
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        // Focus management: For destructive actions, default to Cancel to prevent accidental Enter keys.
        // For non-destructive actions, focus Confirm.
        const timer = setTimeout(() => {
            if (destructive || variant === 'danger') {
                cancelButtonRef.current?.focus();
            } else {
                confirmButtonRef.current?.focus();
            }
        }, 30);

        return () => {
            clearTimeout(timer);
            document.body.style.overflow = originalOverflow;
            if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
                previousFocusRef.current.focus();
            }
        };
    }, [destructive, variant]);

    // Handle Escape key and tab trapping
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
        }

        if (e.key === 'Tab') {
            const focusables = dialogRef.current?.querySelectorAll(
                'button:not([disabled]), [tabindex="0"]'
            );
            if (!focusables || focusables.length === 0) return;

            const first = focusables[0];
            const last = focusables[focusables.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    }, [onCancel]);

    // Variant style maps matching HRIS design tokens
    const variantStyles = {
        danger: {
            iconBg: 'bg-rose-50 border-rose-200/80 text-rose-600',
            defaultIcon: 'ti-trash',
            confirmBtn: 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white focus-visible:ring-rose-500 shadow-2xs',
            role: 'alertdialog',
        },
        warning: {
            iconBg: 'bg-amber-50 border-amber-200/80 text-amber-700',
            defaultIcon: 'ti-alert-triangle',
            confirmBtn: 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white focus-visible:ring-amber-500 shadow-2xs',
            role: 'alertdialog',
        },
        accent: {
            iconBg: 'bg-indigo-50 border-indigo-200/80 text-indigo-700',
            defaultIcon: 'ti-help-circle',
            confirmBtn: 'bg-accent hover:bg-accent-hover active:bg-accent-hover text-white focus-visible:ring-accent shadow-2xs',
            role: 'dialog',
        },
        info: {
            iconBg: 'bg-blue-50 border-blue-200/80 text-blue-700',
            defaultIcon: 'ti-info-circle',
            confirmBtn: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white focus-visible:ring-blue-500 shadow-2xs',
            role: 'dialog',
        },
    };

    const currentStyle = variantStyles[variant] || variantStyles.accent;
    const finalIcon = icon || currentStyle.defaultIcon;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 max-sm:items-end max-sm:p-0 bg-slate-950/70 backdrop-blur-[2px] transition-opacity duration-150 font-sans"
            onClick={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
            onKeyDown={handleKeyDown}
        >
            <div
                ref={dialogRef}
                role={currentStyle.role}
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                aria-describedby="confirm-dialog-description"
                className="w-full max-w-md bg-white rounded-xl max-sm:rounded-b-none max-sm:rounded-t-2xl border border-slate-200 shadow-2xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto text-left transform transition-all duration-150 ease-out"
            >
                {/* Header row: Icon, Title & Dismiss button */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${currentStyle.iconBg}`}>
                            <i className={`ti ${finalIcon} text-lg`} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 id="confirm-dialog-title" className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight leading-snug break-words [overflow-wrap:anywhere]">
                                {title}
                            </h3>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="w-8 h-8 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors duration-100 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950"
                        title="Close dialog"
                        aria-label="Close dialog"
                    >
                        <i className="ti ti-x text-sm" />
                    </button>
                </div>

                {/* Message & contextual description */}
                <div className="space-y-2.5">
                    <p id="confirm-dialog-description" className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal break-words [overflow-wrap:anywhere]">
                        {message}
                    </p>
                    {description && (
                        <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg text-xs text-slate-700 break-words [overflow-wrap:anywhere]">
                            {description}
                        </div>
                    )}
                </div>

                {/* Mobile: stacked flex-col-reverse (Cancel is bottom-most, easily reachable)
                    Desktop: inline flex-row with Cancel on left of primary action */}
                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-2.5 pt-2">
                    <button
                        ref={cancelButtonRef}
                        type="button"
                        onClick={onCancel}
                        className="h-10 sm:h-9 px-4 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 font-semibold text-xs rounded-md border border-slate-200 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmButtonRef}
                        type="button"
                        onClick={onConfirm}
                        className={`h-10 sm:h-9 px-4 font-semibold text-xs rounded-md transition-colors duration-100 flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 ${currentStyle.confirmBtn}`}
                    >
                        <span>{confirmLabel}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ConfirmProvider;
