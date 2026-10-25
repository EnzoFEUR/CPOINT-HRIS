import { useState } from 'react';
import { isImageDocument, isPdfDocument } from '../utils/documentUtils';

export default function DocumentThumbnail({
    document: doc,
    size = 'md',
    variant = 'box',
    onPreview,
    className = '',
    showBadge = true
}) {
    const [imgLoaded, setImgLoaded] = useState(false);
    const [imgError, setImgError] = useState(false);

    if (!doc) return null;

    const safeTitle = typeof doc.title === 'string' ? doc.title.trim() : '';
    const fileName = typeof doc.file_name === 'string' && doc.file_name.trim() ? doc.file_name.trim() : safeTitle;
    const ext = fileName.includes('.') ? (fileName.split('.').pop() || '').toLowerCase() : '';
    const isImage = Boolean(ext) && isImageDocument(fileName);
    const isPdf = Boolean(ext) && isPdfDocument(fileName);
    const label = safeTitle || fileName || 'Document';
    const previewUrl = doc.preview_url || null;

    // Size mappings for box variant
    const sizeClasses = {
        sm: 'w-8 h-8 rounded-md text-xs',
        md: 'w-10 h-10 sm:w-11 sm:h-11 rounded-lg text-sm',
        lg: 'w-14 h-14 sm:w-16 sm:h-16 rounded-xl text-base',
        banner: 'w-full h-32 sm:h-36 rounded-lg text-sm'
    }[size] || 'w-10 h-10 rounded-lg text-sm';

    const handleKeyDown = (e) => {
        if (onPreview && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onPreview(doc);
        }
    };

    // Render Box Variant (for tables, list items, or compact grids)
    if (variant !== 'banner') {
        return (
            <div
                role={onPreview ? 'button' : undefined}
                tabIndex={onPreview ? 0 : undefined}
                onClick={onPreview ? (e) => { e.stopPropagation(); onPreview(doc); } : undefined}
                onKeyDown={handleKeyDown}
                title={onPreview ? `Preview ${label}` : label}
                className={`relative group shrink-0 overflow-hidden border border-slate-200/80 bg-slate-50 transition-all duration-150 ${onPreview ? 'cursor-pointer hover:border-slate-400 hover:shadow-xs' : ''} ${sizeClasses} ${className}`}
            >
                {isImage && previewUrl && !imgError ? (
                    <>
                        {!imgLoaded && (
                            <div className="absolute inset-0 bg-slate-100 animate-pulse flex items-center justify-center">
                                <i className="ti ti-photo text-slate-300" />
                            </div>
                        )}
                        <img
                            src={previewUrl}
                            alt={label}
                            loading="lazy"
                            onLoad={() => setImgLoaded(true)}
                            onError={() => setImgError(true)}
                            className={`w-full h-full object-cover transition-transform duration-200 group-hover:scale-105 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {showBadge && size !== 'sm' && (
                            <span className="absolute bottom-0.5 right-0.5 px-1 py-0.2 bg-slate-900/70 text-white font-mono text-[8px] font-bold rounded uppercase tracking-tighter backdrop-blur-2xs">
                                {ext || 'IMG'}
                            </span>
                        )}
                    </>
                ) : isPdf ? (
                    <div className="w-full h-full bg-rose-50/80 flex flex-col items-center justify-center text-rose-600 border border-rose-100/60">
                        <i className="ti ti-file-type-pdf text-lg sm:text-xl" />
                        {showBadge && size !== 'sm' && (
                            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-rose-700 mt-0.5">
                                PDF
                            </span>
                        )}
                    </div>
                ) : ['doc', 'docx'].includes(ext) ? (
                    <div className="w-full h-full bg-blue-50/80 flex flex-col items-center justify-center text-blue-600 border border-blue-100/60">
                        <i className="ti ti-file-type-docx text-lg sm:text-xl" />
                        {showBadge && size !== 'sm' && (
                            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-blue-700 mt-0.5">
                                DOC
                            </span>
                        )}
                    </div>
                ) : ['xls', 'xlsx', 'csv'].includes(ext) ? (
                    <div className="w-full h-full bg-emerald-50/80 flex flex-col items-center justify-center text-emerald-600 border border-emerald-100/60">
                        <i className="ti ti-file-type-xls text-lg sm:text-xl" />
                        {showBadge && size !== 'sm' && (
                            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-emerald-700 mt-0.5">
                                XLS
                            </span>
                        )}
                    </div>
                ) : (
                    <div className="w-full h-full bg-slate-100 flex flex-col items-center justify-center text-slate-600 border border-slate-200">
                        <i className="ti ti-file-text text-lg sm:text-xl" />
                        {showBadge && size !== 'sm' && (
                            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-slate-600 mt-0.5">
                                {ext ? ext.toUpperCase() : 'DOC'}
                            </span>
                        )}
                    </div>
                )}

                {/* Hover overlay hint */}
                {onPreview && (
                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center text-white backdrop-blur-[0.5px]">
                        <i className="ti ti-eye text-sm sm:text-base drop-shadow-sm" />
                    </div>
                )}
            </div>
        );
    }

    // Render Banner Variant (for top of document cards in Grid view)
    return (
        <div
            role={onPreview ? 'button' : undefined}
            tabIndex={onPreview ? 0 : undefined}
            onClick={onPreview ? (e) => { e.stopPropagation(); onPreview(doc); } : undefined}
            onKeyDown={handleKeyDown}
            title={onPreview ? `Preview ${label}` : label}
            className={`relative group w-full h-32 sm:h-36 rounded-t-lg overflow-hidden border-b border-slate-200 bg-slate-100 transition-colors ${onPreview ? 'cursor-pointer hover:bg-slate-200/60' : ''} ${className}`}
        >
            {isImage && previewUrl && !imgError ? (
                <>
                    {!imgLoaded && (
                        <div className="absolute inset-0 bg-slate-100 animate-pulse flex items-center justify-center">
                            <i className="ti ti-photo text-2xl text-slate-300" />
                        </div>
                    )}
                    <img
                        src={previewUrl}
                        alt={label}
                        loading="lazy"
                        onLoad={() => setImgLoaded(true)}
                        onError={() => setImgError(true)}
                        className={`w-full h-full object-cover object-top transition-transform duration-200 group-hover:scale-105 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                    />
                    <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-950/60 to-transparent pointer-events-none" />
                </>
            ) : isPdf ? (
                <div className="w-full h-full bg-gradient-to-br from-rose-50 to-slate-100 flex flex-col items-center justify-center text-rose-600 p-4">
                    <div className="w-12 h-14 bg-white rounded-md border border-rose-200 shadow-2xs flex flex-col items-center justify-center relative">
                        <i className="ti ti-file-type-pdf text-2xl text-rose-600" />
                        <span className="font-mono text-[9px] font-bold text-rose-700 tracking-wider">PDF</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 mt-2">PDF Document</span>
                </div>
            ) : ['doc', 'docx'].includes(ext) ? (
                <div className="w-full h-full bg-gradient-to-br from-blue-50 to-slate-100 flex flex-col items-center justify-center text-blue-600 p-4">
                    <div className="w-12 h-14 bg-white rounded-md border border-blue-200 shadow-2xs flex flex-col items-center justify-center">
                        <i className="ti ti-file-type-docx text-2xl text-blue-600" />
                        <span className="font-mono text-[9px] font-bold text-blue-700 tracking-wider">DOC</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 mt-2">Word Document</span>
                </div>
            ) : ['xls', 'xlsx', 'csv'].includes(ext) ? (
                <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-slate-100 flex flex-col items-center justify-center text-emerald-600 p-4">
                    <div className="w-12 h-14 bg-white rounded-md border border-emerald-200 shadow-2xs flex flex-col items-center justify-center">
                        <i className="ti ti-file-type-xls text-2xl text-emerald-600" />
                        <span className="font-mono text-[9px] font-bold text-emerald-700 tracking-wider">XLS</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 mt-2">Spreadsheet Document</span>
                </div>
            ) : (
                <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center text-slate-500 p-4">
                    <div className="w-12 h-14 bg-white rounded-md border border-slate-200 shadow-2xs flex flex-col items-center justify-center">
                        <i className="ti ti-file-text text-2xl text-slate-500" />
                        <span className="font-mono text-[9px] font-bold text-slate-600 tracking-wider">DOC</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 mt-2">Official Document</span>
                </div>
            )}

            {/* Hover overlay hint */}
            {onPreview && (
                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-1.5 text-white backdrop-blur-[0.5px]">
                    <i className="ti ti-eye text-lg drop-shadow-sm" />
                    <span className="text-xs font-semibold drop-shadow-sm">Click to Preview</span>
                </div>
            )}
        </div>
    );
}
