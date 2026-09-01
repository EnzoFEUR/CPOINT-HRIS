import React from 'react';

export const PageHeader = ({ 
    breadcrumbs = [], 
    title, 
    description, 
    actions 
}) => {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 mb-6 shadow-xs">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    {breadcrumbs.length > 0 && (
                        <nav className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1.5">
                            {breadcrumbs.map((crumb, idx) => (
                                <React.Fragment key={idx}>
                                    {idx > 0 && <span className="text-slate-300">/</span>}
                                    <span className={idx === breadcrumbs.length - 1 ? 'text-slate-900 font-semibold' : 'text-slate-500 hover:text-slate-700'}>
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
                        <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-3xl">
                            {description}
                        </p>
                    )}
                </div>

                {actions && (
                    <div className="flex items-center gap-2.5 shrink-0">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PageHeader;
