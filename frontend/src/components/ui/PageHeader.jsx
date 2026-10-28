import React from 'react';
import BackButton from './BackButton';

/**
 * Enterprise Production PageHeader
 * Domain-specific architectural header banner with breadcrumbs, action slots,
 * and optional integrated low-latency BackButton.
 */
export const PageHeader = ({ 
    breadcrumbs = [], 
    title, 
    description, 
    actions,
    showBack = false,
    backFallback = '/',
    backLabel = 'Back',
    className = ''
}) => {
    return (
        <div className={`bg-white border border-slate-200 rounded-lg p-4 sm:p-5 mb-6 shadow-2xs ${className}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className={`flex items-start sm:items-center min-w-0 flex-1 ${showBack ? 'gap-2.5 sm:gap-3' : ''}`}>
                    {showBack && (
                        <div className="shrink-0 mt-0.5 sm:mt-0">
                            <BackButton fallback={backFallback} label={backLabel} />
                        </div>
                    )}
                    <div className="min-w-0 flex-1">
                        {breadcrumbs.length > 0 && (
                            <nav aria-label="Breadcrumb" className={`flex items-center gap-1.5 text-xs font-semibold text-slate-500 overflow-x-auto no-scrollbar ${title ? 'mb-1.5' : ''}`}>
                                {breadcrumbs.map((crumb, idx) => (
                                    <React.Fragment key={idx}>
                                        {idx > 0 && <span className="text-slate-300 font-normal">/</span>}
                                        <span className={idx === breadcrumbs.length - 1 ? 'text-slate-900 font-bold whitespace-nowrap' : 'text-slate-500 hover:text-slate-700 transition-colors whitespace-nowrap'}>
                                            {crumb}
                                        </span>
                                    </React.Fragment>
                                ))}
                            </nav>
                        )}
                        {title && (
                            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 break-words">
                                {title}
                            </h1>
                        )}
                        {description && (
                            <p className="mt-1 text-xs sm:text-sm text-slate-600 max-w-3xl leading-relaxed">
                                {description}
                            </p>
                        )}
                    </div>
                </div>

                {actions && (
                    <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 flex-wrap w-full md:w-auto">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PageHeader;
