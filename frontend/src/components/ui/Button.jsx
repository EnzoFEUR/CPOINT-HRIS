import React from 'react';

/**
 * Enterprise Production Button
 * Tactile micro-interactions, distinct WCAG contrast, zero generic opacity-80 fades.
 */
export const Button = React.forwardRef(({
    children,
    variant = 'primary', // 'primary' | 'accent' | 'secondary' | 'outline' | 'destructive' | 'subtleDestructive' | 'ghost' | 'link'
    size = 'md',         // 'xs' | 'sm' | 'md' | 'lg'
    icon,
    iconRight,
    isLoading = false,
    disabled = false,
    className = '',
    type = 'button',
    ...props
}, ref) => {
    const baseClasses = 'inline-flex items-center justify-center font-semibold rounded-lg transition-transform duration-75 ease-out select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none active:scale-[0.98]';

    const variants = {
        primary: 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950 focus-visible:ring-slate-900 shadow-xs border border-transparent',
        accent: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-blue-600 shadow-xs border border-transparent',
        secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200 active:bg-slate-300 focus-visible:ring-slate-400 border border-slate-200 shadow-2xs',
        outline: 'bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100 border border-slate-300 focus-visible:ring-slate-400 shadow-2xs',
        destructive: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 focus-visible:ring-rose-600 shadow-xs border border-transparent',
        subtleDestructive: 'bg-rose-50 text-rose-700 hover:bg-rose-100 active:bg-rose-200 border border-rose-200 focus-visible:ring-rose-400',
        ghost: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200 focus-visible:ring-slate-400',
        link: 'text-blue-600 hover:text-blue-800 underline-offset-4 hover:underline focus-visible:ring-blue-500 p-0 h-auto font-medium'
    };

    const sizes = {
        xs: 'text-xs px-2.5 py-1 gap-1.5 h-7',
        sm: 'text-xs px-3 py-1.5 gap-1.5 h-8',
        md: 'text-sm px-4 py-2 gap-2 h-9',
        lg: 'text-sm sm:text-base px-5 py-2.5 gap-2.5 h-11'
    };

    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || isLoading}
            className={`${baseClasses} ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`}
            {...props}
        >
            {isLoading ? (
                <i className="ti ti-loader-2 animate-spin text-current text-sm shrink-0" />
            ) : icon ? (
                <span className="shrink-0 flex items-center">{icon}</span>
            ) : null}
            <span>{children}</span>
            {iconRight && !isLoading && <span className="shrink-0 flex items-center">{iconRight}</span>}
        </button>
    );
});

Button.displayName = 'Button';
export default Button;
