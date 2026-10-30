import { useState, useEffect, useRef } from 'react';
import { isImageDocument, isPdfDocument, isDocxDocument, formatDocumentSize, getDocumentStatus } from '../utils/documentUtils';
import { fetchWithAuth } from '../utils/api';
import { parseAsync, renderDocument } from 'docx-preview';

// Security Sanitization for untrusted Word Document AST / DOM
function sanitizeDocxNodes(nodes) {
    const dangerousTags = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'APPLET', 'BASE']);
    const cleanElement = (el) => {
        if (!el || el.nodeType !== (typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1)) return;
        if (dangerousTags.has(el.nodeName)) {
            el.remove();
            return;
        }
        if (el.nodeName === 'A') {
            const href = (el.getAttribute('href') || '').trim().toLowerCase();
            if (href.startsWith('javascript:') || href.startsWith('vbscript:') || href.startsWith('data:text/html')) {
                el.removeAttribute('href');
            } else if (href) {
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer nofollow');
            }
        }
        const attrs = Array.from(el.attributes || []);
        for (const attr of attrs) {
            if (attr.name.toLowerCase().startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        }
        Array.from(el.children).forEach(cleanElement);
    };

    for (const node of nodes) {
        if (node && node.nodeType === (typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1)) {
            cleanElement(node);
        }
    }
}

function sanitizeDocxCss(css) {
    if (!css || typeof css !== 'string') return '';
    return css
        .replace(/@import\s+[^;]+;/gi, '/* @import stripped */')
        .replace(/expression\s*\([^)]*\)/gi, 'none')
        .replace(/behavior\s*:[^;]+;/gi, '');
}

export default function DocumentPreviewModal({
    isOpen,
    onClose,
    document: doc,
    isAdmin = false,
    onApprove,
    onReject,
    onReopen,
    onDelete,
    isReviewing = false
}) {
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [activeUrl, setActiveUrl] = useState(doc?.preview_url || null);
    const [isLoadingUrl, setIsLoadingUrl] = useState(Boolean(isOpen && doc?.id && !doc?.preview_url));
    const [loadError, setLoadError] = useState(null);
    const [docxResult, setDocxResult] = useState(null);
    const docxContainerRef = useRef(null);
    const documentId = doc?.id;
    const previewUrl = doc?.preview_url;
    const fileName = doc?.file_name || doc?.title || '';
    const isImage = isImageDocument(fileName);
    const isPdf = isPdfDocument(fileName);
    const isDocx = isDocxDocument(fileName);
    const isDocxRendering = Boolean(isOpen && isDocx && activeUrl && docxResult?.url !== activeUrl);
    const docxRenderError = isOpen && isDocx && docxResult?.url === activeUrl ? docxResult.error : null;
    const [previewContext, setPreviewContext] = useState({ isOpen, documentId, previewUrl, isDocx });
    if (previewContext.isOpen !== isOpen || previewContext.documentId !== documentId || previewContext.previewUrl !== previewUrl || previewContext.isDocx !== isDocx) {
        setPreviewContext({ isOpen, documentId, previewUrl, isDocx });
        setZoom(1);
        setRotation(0);
        setLoadError(null);
        setDocxResult(null);
        setActiveUrl(isOpen ? previewUrl || null : null);
        setIsLoadingUrl(Boolean(isOpen && documentId && !previewUrl));
    }

    // Reset zoom and rotation when modal opens with a new doc
    useEffect(() => {
        let active = true;
        if (isOpen && documentId && !previewUrl) {
                fetchWithAuth(`/api/employee-documents/${encodeURIComponent(documentId)}/url`)
                    .then(res => res.json())
                    .then(data => {
                        if (!active) return;
                        if (data.success && data.url) {
                            setActiveUrl(data.url);
                        } else {
                            throw new Error(data.message || 'Unable to retrieve document preview link.');
                        }
                    })
                    .catch(err => {
                        if (active) setLoadError(err.message || 'Error loading preview.');
                    })
                    .finally(() => {
                        if (active) setIsLoadingUrl(false);
                    });
        }
        return () => { active = false; };
    }, [isOpen, documentId, previewUrl]);

    // Handle ESC key to close
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Asynchronously render DOCX OpenXML packages client-side
    useEffect(() => {
        if (!isOpen || !isDocx || !activeUrl) return;

        let active = true;

        const renderDocx = async () => {
            let error = null;
            try {
                const res = activeUrl.startsWith('http')
                    ? await fetch(activeUrl)
                    : await fetchWithAuth(activeUrl);

                if (!res.ok) {
                    throw new Error(`Failed to load document content (${res.status} ${res.statusText}).`);
                }

                const buffer = await res.arrayBuffer();
                if (!active || !docxContainerRef.current) return;

                const renderOptions = {
                    className: 'docx',
                    inWrapper: true,
                    ignoreWidth: false,
                    ignoreHeight: false,
                    breakPages: true,
                    renderHeaders: true,
                    renderFooters: true,
                    renderFootnotes: true,
                    renderEndnotes: true,
                    useBase64URL: true,
                };

                const doc = await parseAsync(buffer, renderOptions);
                if (!active || !docxContainerRef.current) return;

                const nodes = await renderDocument(doc, renderOptions);
                if (!active || !docxContainerRef.current) return;

                // 1. Separate style nodes from document body nodes
                const styleNodes = [];
                const bodyNodes = [];
                for (const node of nodes) {
                    if (node.nodeName === 'STYLE') {
                        styleNodes.push(node);
                    } else {
                        bodyNodes.push(node);
                    }
                }

                // 2. Sanitize document nodes against clickjacking, script execution, and malicious embeds
                sanitizeDocxNodes(bodyNodes);

                // 3. Extract and sanitize CSS rules
                const rawCss = sanitizeDocxCss(styleNodes.map(s => s.textContent || s.innerText || '').join('\n'));
                const defaultPaperStyles = `
                    .docx-wrapper {
                        background: transparent !important;
                        padding: 0 !important;
                        display: flex !important;
                        flex-direction: column !important;
                        align-items: center !important;
                    }
                    .docx-wrapper > section.docx {
                        background: #ffffff !important;
                        color: #0f172a !important;
                        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.08) !important;
                        border: 1px solid #e2e8f0 !important;
                        border-radius: 4px !important;
                        margin-bottom: 24px !important;
                    }
                `;
                const fullCss = `${rawCss}\n${defaultPaperStyles}`;

                // 4. Enterprise Sandboxing via Shadow DOM
                const container = docxContainerRef.current;
                let shadow = container.shadowRoot;
                if (!shadow) {
                    shadow = container.attachShadow({ mode: 'open' });
                }
                shadow.replaceChildren();

                // 5. Enterprise CSP-compliant styling via Constructable Stylesheets (CSSOM)
                // W3C CSP Level 3 spec exempts Constructable Stylesheets from style-src
                // because they are script-driven objects and not inline <style> DOM tags.
                let appliedViaCssom = false;
                if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
                    try {
                        const sheet = new CSSStyleSheet();
                        sheet.replaceSync(fullCss);
                        shadow.adoptedStyleSheets = [sheet];
                        appliedViaCssom = true;
                    } catch (e) {
                        console.warn('[DocumentPreviewModal] Constructable Stylesheet failed, falling back to nonced element:', e);
                    }
                }

                if (!appliedViaCssom) {
                    const metaNonce = document.querySelector('meta[name="csp-nonce"]')?.content;
                    const currentNonce = (metaNonce && !metaNonce.includes('PLACEHOLDER'))
                        ? metaNonce
                        : (document.querySelector('script[nonce]')?.nonce || document.querySelector('style[nonce]')?.nonce || '');

                    const styleTag = document.createElement('style');
                    if (currentNonce) {
                        styleTag.nonce = currentNonce;
                        styleTag.setAttribute('nonce', currentNonce);
                    }
                    styleTag.textContent = fullCss;
                    shadow.appendChild(styleTag);
                }

                // 6. Mount sanitized document nodes into isolated Shadow DOM
                for (const bodyNode of bodyNodes) {
                    shadow.appendChild(bodyNode);
                }
            } catch (err) {
                if (!active) return;
                console.error('[DocumentPreviewModal] DOCX render failure:', err);
                error = err.message || 'Unable to parse Word document format.';
            } finally {
                if (active) {
                    setDocxResult({ url: activeUrl, error });
                }
            }
        };

        renderDocx();

        return () => {
            active = false;
        };
    }, [isOpen, isDocx, activeUrl, documentId, previewUrl]);

    if (!isOpen || !doc) return null;

    const statusMeta = getDocumentStatus(doc);

    const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
    const handleRotate = () => setRotation(prev => (prev + 90) % 360);
    const handleReset = () => { setZoom(1); setRotation(0); };

    const handleDownload = () => {
        if (!activeUrl) return;
        const a = window.document.createElement('a');
        a.href = activeUrl;
        a.download = doc.file_name || doc.title || 'document';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
    };

    const handleOpenNewTab = () => {
        if (!activeUrl) return;
        window.open(activeUrl, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 overflow-hidden font-sans">
            <div className="bg-surface rounded-lg shadow-xl border border-line flex flex-col w-full max-w-5xl h-[90vh] max-h-[880px] overflow-hidden">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-line bg-surface shrink-0">
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                        <div className="h-8 w-8 rounded-md bg-surface-muted border border-line flex items-center justify-center shrink-0 text-ink">
                            <i className={`ti ${isImage ? 'ti-photo text-accent' : isPdf ? 'ti-file-type-pdf text-danger-ink' : isDocx ? 'ti-file-type-docx text-blue-600' : 'ti-file-text text-ink-muted'} text-base`} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-ink text-sm sm:text-base truncate" title={doc.title || fileName}>
                                    {doc.title || fileName}
                                </h3>
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${statusMeta.className} shrink-0`}>
                                    {statusMeta.label}
                                </span>
                            </div>
                            <p className="text-[11px] text-ink-muted font-mono truncate mt-0.5">
                                {doc.file_name} · {formatDocumentSize(doc.file_size)} · {doc.category || 'General'}
                            </p>
                        </div>
                    </div>

                    {/* Toolbar & Controls */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {(isImage || isDocx) && activeUrl && (
                            <div className="hidden sm:flex items-center gap-0.5 px-1 py-0.5 bg-surface border border-line rounded-md shadow-2xs">
                                <button
                                    type="button"
                                    onClick={handleZoomOut}
                                    title="Zoom out"
                                    aria-label="Zoom out"
                                    className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-muted rounded-sm transition-colors duration-100 cursor-pointer"
                                >
                                    <i className="ti ti-zoom-out text-xs" />
                                </button>
                                <span className="font-mono text-[11px] font-medium text-ink px-1 min-w-[36px] text-center select-none">
                                    {Math.round(zoom * 100)}%
                                </span>
                                <button
                                    type="button"
                                    onClick={handleZoomIn}
                                    title="Zoom in"
                                    aria-label="Zoom in"
                                    className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-muted rounded-sm transition-colors duration-100 cursor-pointer"
                                >
                                    <i className="ti ti-zoom-in text-xs" />
                                </button>
                                <div className="h-3.5 w-px bg-line mx-0.5" />
                                <button
                                    type="button"
                                    onClick={handleRotate}
                                    title="Rotate 90 degrees"
                                    aria-label="Rotate 90 degrees"
                                    className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-muted rounded-sm transition-colors duration-100 cursor-pointer"
                                >
                                    <i className="ti ti-rotate text-xs" />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    title="Reset view"
                                    aria-label="Reset zoom and rotation"
                                    className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-muted rounded-sm transition-colors duration-100 cursor-pointer"
                                >
                                    <i className="ti ti-refresh text-xs" />
                                </button>
                            </div>
                        )}

                        {activeUrl && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleOpenNewTab}
                                    title="Open file in new tab"
                                    className="h-8 px-2.5 bg-surface hover:bg-surface-muted text-ink-muted hover:text-ink text-xs font-medium rounded-md border border-line transition-colors duration-100 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="ti ti-external-link text-xs" />
                                    <span className="hidden md:inline">Open</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDownload}
                                    title="Download document file"
                                    className="h-8 px-2.5 bg-surface hover:bg-surface-muted text-ink-muted hover:text-ink text-xs font-medium rounded-md border border-line transition-colors duration-100 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="ti ti-download text-xs" />
                                    <span className="hidden md:inline">Download</span>
                                </button>
                            </>
                        )}

                        {onDelete && (
                            <button
                                type="button"
                                disabled={isReviewing}
                                onClick={() => onDelete(doc)}
                                title="Delete document file"
                                aria-label="Delete document"
                                className="h-8 w-8 bg-surface hover:bg-danger-subtle text-ink-muted hover:text-danger-ink rounded-md border border-line hover:border-danger/30 transition-colors duration-100 shadow-2xs flex items-center justify-center cursor-pointer disabled:opacity-50"
                            >
                                <i className="ti ti-trash text-xs" />
                            </button>
                        )}

                        <div className="h-4 w-px bg-line mx-0.5 hidden sm:block" />

                        <button
                            type="button"
                            onClick={onClose}
                            title="Close preview (Esc)"
                            aria-label="Close preview"
                            className="w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface-muted flex items-center justify-center transition-colors duration-100 cursor-pointer"
                        >
                            <i className="ti ti-x text-base" />
                        </button>
                    </div>
                </div>

                {/* Modal Body / Viewer Canvas */}
                <div className="flex-1 bg-canvas overflow-hidden relative flex items-center justify-center p-3 sm:p-5">
                    {isLoadingUrl ? (
                        <div className="flex flex-col items-center justify-center space-y-2.5">
                            <i className="ti ti-loader text-2xl text-ink-muted animate-spin" />
                            <p className="text-xs font-medium text-ink-muted">
                                Loading document preview...
                            </p>
                        </div>
                    ) : loadError ? (
                        <div className="bg-surface rounded-lg p-6 max-w-md w-full text-center border border-danger/20 shadow-xs space-y-3">
                            <div className="w-10 h-10 bg-danger-subtle text-danger-ink rounded-md flex items-center justify-center mx-auto border border-danger/20">
                                <i className="ti ti-alert-circle text-xl" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-ink text-sm">Unable to Preview File</h4>
                                <p className="text-xs text-ink-muted mt-1 leading-relaxed">{loadError}</p>
                            </div>
                            {activeUrl && (
                                <button
                                    type="button"
                                    onClick={handleOpenNewTab}
                                    className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-md shadow-2xs transition-colors duration-100 cursor-pointer"
                                >
                                    Try Direct Download
                                </button>
                            )}
                        </div>
                    ) : isImage && activeUrl ? (
                        <div className="w-full h-full overflow-auto flex items-center justify-center select-none p-2">
                            <img
                                src={activeUrl}
                                alt={doc.title || fileName}
                                style={{
                                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                                    transition: 'transform 0.15s ease-out'
                                }}
                                className="max-w-full max-h-full object-contain rounded-md shadow-xs border border-line bg-surface"
                            />
                        </div>
                    ) : isPdf && activeUrl ? (
                        <div className="w-full h-full bg-surface rounded-md shadow-xs border border-line overflow-hidden flex flex-col">
                            <iframe
                                src={`${activeUrl}#toolbar=1&navpanes=0`}
                                title={doc.title || fileName}
                                className="w-full h-full border-0 rounded-md flex-1"
                            />
                        </div>
                    ) : isDocx && activeUrl ? (
                        <div className="w-full h-full bg-slate-100/90 rounded-md shadow-xs border border-line overflow-auto flex flex-col relative">
                            {isDocxRendering && (
                                <div className="absolute inset-0 z-10 bg-surface/80 backdrop-blur-2xs flex flex-col items-center justify-center space-y-2">
                                    <i className="ti ti-loader text-2xl text-accent animate-spin" />
                                    <p className="text-xs font-medium text-ink-muted">Rendering Word document preview...</p>
                                </div>
                            )}
                            {docxRenderError ? (
                                <div className="m-auto bg-surface rounded-lg p-6 max-w-md w-full text-center border border-danger/20 shadow-xs space-y-3">
                                    <div className="w-10 h-10 bg-danger-subtle text-danger-ink rounded-md flex items-center justify-center mx-auto border border-danger/20">
                                        <i className="ti ti-alert-circle text-xl" />
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-ink text-sm">Word Preview Notice</h4>
                                        <p className="text-xs text-ink-muted mt-1 leading-relaxed">{docxRenderError}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleDownload}
                                        className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-md shadow-2xs inline-flex items-center gap-1.5 transition-colors duration-100 cursor-pointer"
                                    >
                                        <i className="ti ti-download text-xs" />
                                        <span>Download file</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="p-3 sm:p-6 overflow-auto flex-1 flex justify-center items-start">
                                    <div
                                        ref={docxContainerRef}
                                        style={{
                                            transform: `scale(${zoom})`,
                                            transformOrigin: 'top center',
                                            transition: 'transform 0.12s ease-out'
                                        }}
                                        className="docx-preview-root max-w-4xl w-full"
                                    />
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-surface rounded-lg p-6 max-w-md w-full border border-line shadow-xs space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 bg-surface-muted border border-line rounded-md flex items-center justify-center text-ink shrink-0">
                                    <i className="ti ti-file-text text-xl" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-semibold text-ink text-sm truncate" title={doc.title || fileName}>
                                        {doc.title || fileName}
                                    </h4>
                                    <p className="text-xs text-ink-muted font-mono mt-0.5 truncate">
                                        {doc.file_name} · {formatDocumentSize(doc.file_size)}
                                    </p>
                                </div>
                            </div>
                            <div className="bg-surface-muted border border-line rounded-md p-3 text-xs text-ink-muted leading-relaxed">
                                Direct in-browser visual preview is supported for image and PDF files. Download or open this file to review it in its native application.
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={handleDownload}
                                    className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-md shadow-2xs flex items-center gap-1.5 transition-colors duration-100 cursor-pointer"
                                >
                                    <i className="ti ti-download text-xs" /> Download file
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Modal Footer (Admin Quick Actions or Metadata bar) */}
                <div className="px-4 sm:px-5 py-3 border-t border-line bg-surface shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-ink-muted">
                        {doc.created_at && (
                            <span className="inline-flex items-center gap-1">
                                <i className="ti ti-calendar text-xs text-ink-subtle" />
                                <span>Uploaded {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            </span>
                        )}
                        {doc.expiry_date && (
                            <span className="inline-flex items-center gap-1 font-medium text-warning-ink bg-warning-subtle px-2 py-0.5 rounded-md border border-warning/20">
                                <i className="ti ti-clock-hour-4 text-xs" />
                                <span>Expires: {doc.expiry_date}</span>
                            </span>
                        )}
                        {doc.rejection_reason && (
                            <span className="inline-flex items-center gap-1 text-danger-ink bg-danger-subtle px-2 py-0.5 rounded-md border border-danger/20 font-medium truncate max-w-xs" title={doc.rejection_reason}>
                                <i className="ti ti-alert-triangle text-xs shrink-0" />
                                <span className="truncate">Note: {doc.rejection_reason}</span>
                            </span>
                        )}
                    </div>

                    {/* Admin Approval / Rejection / Reopen buttons inside the preview */}
                    {isAdmin && (
                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                            {doc.status === 'approved' ? (
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-success-subtle text-success-ink border border-success/30 rounded-md text-xs font-medium">
                                        <i className="ti ti-circle-check text-xs" /> Approved Record
                                    </span>
                                    {onReopen && (
                                        <button
                                            type="button"
                                            disabled={isReviewing}
                                            onClick={() => onReopen(doc)}
                                            className="h-8 px-3 bg-surface hover:bg-surface-muted text-ink-muted hover:text-ink font-medium text-xs rounded-md border border-line transition-colors duration-100 shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                            title="Reopen review to reset to pending"
                                        >
                                            <i className="ti ti-rotate-2 text-xs" /> Re-open Review
                                        </button>
                                    )}
                                </div>
                            ) : doc.status === 'rejected' ? (
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-danger-subtle text-danger-ink border border-danger/30 rounded-md text-xs font-medium">
                                        <i className="ti ti-circle-x text-xs" /> Rejected Submission
                                    </span>
                                    {onReopen && (
                                        <button
                                            type="button"
                                            disabled={isReviewing}
                                            onClick={() => onReopen(doc)}
                                            className="h-8 px-3 bg-surface hover:bg-surface-muted text-ink-muted hover:text-ink font-medium text-xs rounded-md border border-line transition-colors duration-100 shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                            title="Reopen review to reset to pending"
                                        >
                                            <i className="ti ti-rotate-2 text-xs" /> Re-open Review
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {onReject && (
                                        <button
                                            type="button"
                                            disabled={isReviewing}
                                            onClick={() => onReject(doc)}
                                            className="h-8 px-3 bg-surface hover:bg-danger-subtle text-danger-ink border border-danger/30 hover:border-danger/50 font-medium text-xs rounded-md transition-colors duration-100 shadow-2xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                                        >
                                            <i className="ti ti-x text-xs" /> Reject
                                        </button>
                                    )}
                                    {onApprove && (
                                        <button
                                            type="button"
                                            disabled={isReviewing}
                                            onClick={() => onApprove(doc)}
                                            className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-md transition-colors duration-100 shadow-2xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                                        >
                                            <i className="ti ti-check text-xs" /> Approve Document
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
