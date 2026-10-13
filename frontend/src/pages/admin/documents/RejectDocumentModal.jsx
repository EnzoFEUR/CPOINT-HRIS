import { useState, useEffect } from 'react';

const COMMON_REJECTION_REASONS = [
    'Blurry, cropped, or unreadable document scan',
    'Document has expired or is past validity date',
    'Incorrect document type or form submitted',
    'Missing required signature or official seal',
    'Incomplete submission (missing front/back or pages)',
    'Name or details do not match employee record',
    'Document is not an official or certified copy'
];

export default function RejectDocumentModal({
    isOpen,
    onClose,
    document: doc,
    onConfirm,
    isSubmitting = false
}) {
    const [selectedReason, setSelectedReason] = useState('');
    const [customNotes, setCustomNotes] = useState('');

    useEffect(() => {
        if (isOpen) {
            setSelectedReason('');
            setCustomNotes('');
        }
    }, [isOpen, doc?.id]);

    if (!isOpen || !doc) return null;

    const finalReason = selectedReason && customNotes
        ? `${selectedReason}: ${customNotes.trim()}`
        : selectedReason || customNotes.trim();

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!finalReason) return;
        onConfirm(finalReason);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 overflow-y-auto font-sans">
            <div className="bg-surface rounded-lg p-5 sm:p-6 max-w-lg w-full shadow-xl border border-line space-y-4 my-auto max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-line">
                    <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 bg-danger-subtle text-danger-ink rounded-md flex items-center justify-center shrink-0 border border-danger/30">
                            <i className="ti ti-file-x text-base" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-ink text-sm sm:text-base">
                                Reject Document Submission
                            </h3>
                            <p className="text-[11px] text-ink-muted">
                                Send formal rejection remarks to employee
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface-muted flex items-center justify-center transition-colors duration-100 shrink-0 cursor-pointer"
                    >
                        <i className="ti ti-x text-xs" />
                    </button>
                </div>

                {/* Document summary info */}
                <div className="bg-surface-muted border border-line rounded-md p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink-subtle uppercase tracking-wider text-[10px]">
                            Document
                        </span>
                        <span className="font-mono text-ink-subtle text-[10px]">
                            {doc.category || 'General'}
                        </span>
                    </div>
                    <p className="font-semibold text-ink text-sm truncate" title={doc.title || doc.file_name}>
                        {doc.title || doc.file_name}
                    </p>
                    {doc.employees && (
                        <p className="text-ink-muted text-xs flex items-center gap-1.5 pt-0.5">
                            <i className="ti ti-user text-ink-subtle" />
                            <span>{doc.employees.first_name} {doc.employees.last_name} ({doc.employees.company_id || 'ID N/A'})</span>
                        </p>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-3.5">
                    {/* Common reasons chips */}
                    <div>
                        <label className="block text-xs font-semibold text-ink-muted mb-1.5">
                            Standard Rejection Reason (Select One)
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                            {COMMON_REJECTION_REASONS.map((r) => {
                                const isSelected = selectedReason === r;
                                return (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setSelectedReason(isSelected ? '' : r)}
                                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-100 border cursor-pointer text-left ${
                                            isSelected
                                                ? 'bg-danger-subtle text-danger-ink border-danger/40 font-medium shadow-2xs'
                                                : 'bg-surface text-ink-muted border-line hover:bg-surface-muted hover:text-ink'
                                        }`}
                                    >
                                        {r}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Detailed custom notes */}
                    <div>
                        <label className="block text-xs font-semibold text-ink-muted mb-1">
                            Additional Instructions / Specific Remarks
                        </label>
                        <textarea
                            rows={3}
                            maxLength={500}
                            placeholder="Provide clear instructions for the employee on what to re-submit..."
                            value={customNotes}
                            onChange={(e) => setCustomNotes(e.target.value)}
                            className="w-full p-2.5 bg-surface border border-line rounded-md focus:border-slate-400 focus:outline-none text-xs text-ink transition-colors duration-100 shadow-2xs resize-none"
                        />
                        <div className="flex items-center justify-between text-[10px] text-ink-subtle mt-0.5">
                            <span>Explain clearly what corrections are needed.</span>
                            <span className="font-mono">{customNotes.length}/500</span>
                        </div>
                    </div>

                    {/* Real-time sync policy reminder */}
                    <div className="p-2.5 rounded-md bg-warning-subtle border border-warning/30 text-warning-ink flex items-start gap-2 text-xs">
                        <i className="ti ti-info-circle text-warning-ink text-sm mt-0.5 shrink-0" />
                        <p className="leading-relaxed text-[11px] text-warning-ink">
                            The employee will receive an instant real-time notification with these remarks and the requested document status will reset to pending.
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="h-8 px-3.5 bg-surface hover:bg-surface-muted text-ink-muted hover:text-ink text-xs font-medium rounded-md border border-line transition-colors duration-100 cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !finalReason}
                            className="h-8 px-4 bg-danger hover:bg-danger-ink text-white text-xs font-medium rounded-md transition-colors duration-100 flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                        >
                            {isSubmitting ? (
                                <>
                                    <i className="ti ti-loader animate-spin text-sm" /> Rejecting...
                                </>
                            ) : (
                                <>
                                    <i className="ti ti-x text-sm" /> Confirm Rejection
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
