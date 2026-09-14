import React from 'react';

/**
 * Enterprise Production Card System
 * Clean flat planes, crisp 1px solid border, subtle shadow-xs, zero blurry glassmorphism.
 */
export const Card = ({ children, className = '', ...props }) => (
    <div 
        className={`bg-white border border-slate-200 rounded-xl shadow-xs transition-colors ${className}`}
        {...props}
    >
        {children}
    </div>
);

export const CardHeader = ({ children, className = '', ...props }) => (
    <div className={`p-4 sm:p-5 border-b border-slate-100 flex flex-col gap-1 ${className}`} {...props}>
        {children}
    </div>
);

export const CardTitle = ({ children, className = '', ...props }) => (
    <h3 className={`text-base sm:text-lg font-bold text-slate-900 tracking-tight ${className}`} {...props}>
        {children}
    </h3>
);

export const CardDescription = ({ children, className = '', ...props }) => (
    <p className={`text-xs text-slate-500 leading-relaxed ${className}`} {...props}>
        {children}
    </p>
);

export const CardContent = ({ children, className = '', ...props }) => (
    <div className={`p-4 sm:p-5 ${className}`} {...props}>
        {children}
    </div>
);

export const CardFooter = ({ children, className = '', ...props }) => (
    <div className={`p-4 sm:p-5 border-t border-slate-100 bg-slate-50/60 rounded-b-xl flex items-center justify-between gap-3 ${className}`} {...props}>
        {children}
    </div>
);

export default Card;
