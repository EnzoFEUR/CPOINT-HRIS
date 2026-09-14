import React from 'react';

/**
 * Enterprise Production Form Input
 * Precision border, distinct focus states, integrated icons, and clear validation feedback.
 */
export const Input = React.forwardRef(({
    label,
    error,
    icon,
    iconRight,
    className = '',
    id,
    type = 'text',
    required = false,
    ...props
}, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
        <div className="w-full">
            {label && (
                <label htmlFor={inputId} className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {label} {required && <span className="text-rose-500">*</span>}
                </label>
            )}
            <div className="relative">
                {icon && (
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                        {icon}
                    </div>
                )}
                <input
                    ref={ref}
                    id={inputId}
                    type={type}
                    required={required}
                    className={`w-full py-2 bg-white border rounded-lg text-sm text-slate-900 placeholder-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                        icon ? 'pl-9' : 'pl-3'
                    } ${iconRight ? 'pr-9' : 'pr-3'} ${
                        error 
                            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' 
                            : 'border-slate-300 focus:border-slate-900 focus:ring-slate-900/15'
                    } ${className}`}
                    {...props}
                />
                {iconRight && (
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 text-sm">
                        {iconRight}
                    </div>
                )}
            </div>
            {error && (
                <p className="mt-1 text-xs text-rose-600 font-medium">{error}</p>
            )}
        </div>
    );
});

Input.displayName = 'Input';
export default Input;
