import React from 'react';

/**
 * Enterprise Production PageHeader
 * Domain-specific architectural header banner with breadcrumbs and action slots.
 */
export const PageHeader = ({ 
    breadcrumbs = [], 
    title, 
    description, 
    actions,
    className = ''
}) => {
    return (
        <div className={`bg-white border border-slate-200 rounded-xl p-4 sm:p-6 mb-6 shadow-xs ${className}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    {breadcrumbs.length > 0 && (
                        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-2">
                            {breadcrumbs.map((crumb, idx) => (
                                <React.Fragment key={idx}>
                                    {idx > 0 && <span className="text-slate-300 font-normal">/</span>}
                                    <span className={idx === breadcrumbs.length - 1 ? 'text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-700 transition-colors'}>
                                        {crumb}
                                    </span>
                                </React.Fragment>
                            ))}
                        </nav>
                    )}
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                        {title}
                    </h1>
                    {description && (
                        <p className="mt-1.5 text-xs sm:text-sm text-slate-600 max-w-3xl leading-relaxed">
                            {description}
                        </p>
                    )}
                </div>

                {actions && (
                    <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PageHeader;
