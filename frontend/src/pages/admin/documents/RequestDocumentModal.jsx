import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { DOCUMENT_TYPES, DOCUMENT_CATEGORIES } from '../../../../../shared/documentTypes.mjs';
import { createDocumentRequest } from '../../../utils/documentApi';
import { fetchWithAuth } from '../../../utils/api';

export default function RequestDocumentModal({
    isOpen,
    onClose,
    onSuccess,
    initialEmployeeId = null,
    initialEmployee = null,
    initialDocTypeId = 'tin'
}) {
    const [employeeId, setEmployeeId] = useState(initialEmployeeId || '');
    const [employees, setEmployees] = useState([]);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
    const [selectedDocTypeId, setSelectedDocTypeId] = useState(initialDocTypeId || 'tin');
    const [customDocType, setCustomDocType] = useState('');
    const [priority, setPriority] = useState('normal');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen && initialDocTypeId) {
            setSelectedDocTypeId(initialDocTypeId);
        }
    }, [isOpen, initialDocTypeId]);

    // Sync initial employee
    useEffect(() => {
        if (initialEmployeeId) {
            setEmployeeId(initialEmployeeId);
        }
    }, [initialEmployeeId]);

    // Load active employees if not pre-selected
    useEffect(() => {
        if (isOpen && !initialEmployeeId) {
            setIsLoadingEmployees(true);
            fetchWithAuth('/api/employees')
                .then(res => res.json())
                .then(data => {
                    const list = Array.isArray(data) ? data : data.data || [];
                    // Keep active / non-archived employees
                    const activeList = list.filter(e =>
                        !e.archived_at &&
                        e.is_active !== false &&
                        !['inactive', 'terminated', 'separated', 'archived'].includes(String(e.status || '').toLowerCase())
                    );
                    setEmployees(activeList);
                    if (activeList.length > 0 && !employeeId) {
                        setEmployeeId(activeList[0].id);
                    }
                })
                .catch(err => {
                    console.error('Failed to load employees for request modal:', err);
                })
                .finally(() => {
                    setIsLoadingEmployees(false);
                });
        }
    }, [isOpen, initialEmployeeId]);

    if (!isOpen) return null;

    const selectedTypeObj = DOCUMENT_TYPES.find(t => t.id === selectedDocTypeId) || DOCUMENT_TYPES[0];
    const isCustomType = selectedDocTypeId === 'unknown';

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!employeeId) {
            toast.error('Please select an employee.');
            return;
        }

        const resolvedDocType = isCustomType ? customDocType.trim() : selectedTypeObj.label;
        if (!resolvedDocType) {
            toast.error('Please specify the document type needed.');
            return;
        }

        setIsSubmitting(true);
        try {
            await createDocumentRequest({
                employeeId,
                documentType: resolvedDocType,
                category: selectedTypeObj.category || 'Other',
                priority,
                dueDate: dueDate || null,
                notes: notes.trim() || null
            });

            toast.success(`Document request sent for ${resolvedDocType}.`);
            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            toast.error(err.message || 'Failed to create document request.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-2xs shrink-0">
                            <i className="ti ti-file-alert text-lg" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">Request Required Document</h3>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                        aria-label="Close dialog"
                    >
                        <i className="ti ti-x text-base" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
                    {/* Employee Target */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                            Target Employee <span className="text-rose-500">*</span>
                        </label>
                        {initialEmployee ? (
                            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold font-mono">
                                        {(initialEmployee.first_name?.[0] || 'E')}
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-900">
                                            {initialEmployee.first_name} {initialEmployee.last_name}
                                        </p>
                                        <p className="text-[11px] text-slate-500 font-mono">
                                            {initialEmployee.company_id || initialEmployee.id?.slice(0, 8)}
                                        </p>
                                    </div>
                                </div>
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Target Personnel
                                </span>
                            </div>
                        ) : (
                            <select
                                value={employeeId}
                                onChange={e => setEmployeeId(e.target.value)}
                                required
                                disabled={isLoadingEmployees}
                                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-slate-400 transition-colors"
                            >
                                {isLoadingEmployees ? (
                                    <option value="">Loading active personnel...</option>
                                ) : (
                                    employees.map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.first_name} {emp.last_name} ({emp.company_id || 'ID Pending'}) - {emp.department || 'General'}
                                        </option>
                                    ))
                                )}
                            </select>
                        )}
                    </div>

                    {/* Document Type Selection */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                                Required Document Type <span className="text-rose-500">*</span>
                            </label>
                            {selectedTypeObj.is201Required && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                    <i className="ti ti-certificate text-[11px]" />
                                    <span>Statutory Mandatory</span>
                                </span>
                            )}
                        </div>
                        <select
                            value={selectedDocTypeId}
                            onChange={e => setSelectedDocTypeId(e.target.value)}
                            className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-slate-400 transition-colors"
                        >
                            <optgroup label="Statutory & Government Identification">
                                {DOCUMENT_TYPES.filter(t => t.category === 'Government ID').map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.label} {t.is201Required ? '· Mandatory' : ''}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Employment & Contracts">
                                {DOCUMENT_TYPES.filter(t => t.category === 'Contract').map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.label} {t.is201Required ? '· Mandatory' : ''}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Clearances & Background">
                                {DOCUMENT_TYPES.filter(t => t.category === 'Clearance').map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.label} {t.is201Required ? '· Mandatory' : ''}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Certificates & Credentials">
                                {DOCUMENT_TYPES.filter(t => t.category === 'Certificate').map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.label} {t.is201Required ? '· Mandatory' : ''}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Performance & Other">
                                {DOCUMENT_TYPES.filter(t => ['Performance', 'Other'].includes(t.category)).map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.label}
                                    </option>
                                ))}
                            </optgroup>
                        </select>

                        {/* Description */}
                        {selectedTypeObj.description && !isCustomType && (
                            <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-2 rounded border border-slate-100">
                                {selectedTypeObj.description}
                            </p>
                        )}

                        {/* Custom Title Input */}
                        {isCustomType && (
                            <div className="mt-2.5">
                                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                    Custom Document Name <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={customDocType}
                                    onChange={e => setCustomDocType(e.target.value)}
                                    placeholder="e.g. Special Power of Attorney, PRC Board License"
                                    className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-slate-400"
                                />
                            </div>
                        )}
                    </div>

                    {/* Priority and Due Date Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                                Priority Level
                            </label>
                            <select
                                value={priority}
                                onChange={e => setPriority(e.target.value)}
                                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-slate-400"
                            >
                                <option value="normal">Normal Priority</option>
                                <option value="high">High Priority</option>
                                <option value="urgent">Urgent · Immediate Compliance</option>
                                <option value="low">Low Priority</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                                Due Date (Optional)
                            </label>
                            <input
                                type="date"
                                min={new Date().toISOString().split('T')[0]}
                                value={dueDate}
                                onChange={e => setDueDate(e.target.value)}
                                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-slate-400"
                            />
                        </div>
                    </div>

                    {/* Instructions / Notes for the Employee */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                            HR Instructions & Remarks (Optional)
                        </label>
                        <textarea
                            rows="2"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="e.g., Must include official dry seal from the issuing agency; clear colored scan required."
                            maxLength="500"
                            className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-slate-400"
                        />
                    </div>

                    {/* Actions */}
                    <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="h-9 px-4 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                            {isSubmitting ? (
                                <>
                                    <i className="ti ti-loader-2 animate-spin text-sm" />
                                    <span>Sending Request...</span>
                                </>
                            ) : (
                                <>
                                    <i className="ti ti-send text-sm" />
                                    <span>Send Document Request</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
