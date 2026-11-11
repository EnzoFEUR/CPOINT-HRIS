import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Filter, Globe, History, Info, LayoutGrid, LayoutList, MoreHorizontal, Pencil, Plus, RefreshCw, Scale, Search, ShieldCheck, Users, X } from 'lucide-react';
import { fetchWithAuth } from '../../utils/api';
import { readHolidayResponse, refreshHolidayCalendar, safeHolidaySource } from '../../utils/holidayCalendar.mjs';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/ui/PageHeader';

function holidayAvailabilityMessage(data, error) {
    if (error) return error.message || 'Cannot check holiday calendar availability. Reconnect and retry.';
    if (!data) return 'Checking holiday calendar availability…';
    if (data.configured === false) return 'Dynamic holiday calendar schema is not initialized. Please run the database migration before managing holidays.';
    return 'Holiday calendar service is temporarily unavailable.';
}

const HOLIDAY_TYPES = {
    regular: {
        label: 'Regular',
        fullLabel: 'Regular Holiday',
        shortLabel: 'Regular',
        rate: '200% Pay Rate',
        ratePercent: '200%',
        rateDesc: 'Worked = 200% · Unworked = 100%',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200/80',
        dotClass: 'bg-amber-500',
    },
    special_non_working: {
        label: 'Special Non-Working',
        fullLabel: 'Special Non-Working Day',
        shortLabel: 'Special NW',
        rate: '130% Pay Rate',
        ratePercent: '130%',
        rateDesc: 'Worked = 130% · Unworked = 0%',
        badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200/80',
        dotClass: 'bg-indigo-500',
    },
    special_working: {
        label: 'Special Working',
        fullLabel: 'Special Working Day',
        shortLabel: 'Special W',
        rate: '100% Pay Rate',
        ratePercent: '100%',
        rateDesc: 'Worked = 100% · Standard Day',
        badgeClass: 'bg-sky-50 text-sky-800 border-sky-200/80',
        dotClass: 'bg-sky-500',
    },
};

const monthFormatter = new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'Asia/Manila' });
const weekdayFormatter = new Intl.DateTimeFormat('en-PH', { weekday: 'short', timeZone: 'Asia/Manila' });

const btnBase = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 select-none';
const btnSecondary = `${btnBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs active:bg-slate-100`;
const btnPrimary = `${btnBase} bg-slate-900 text-white hover:bg-slate-800 shadow-2xs active:bg-slate-950 font-semibold`;
const inputBase = 'w-full min-h-9 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-accent transition-colors shadow-2xs';

const emptyHoliday = {
    name: '',
    date: '',
    type: 'regular',
    source_reference: '',
    source_url: '',
    coverage: 'all',
    employee_ids: [],
};

// Accessible Modal Dialog Wrapper
function HolidayDialog({ title, titleId, subtitle, busy = false, onClose, children }) {
    const ref = useRef(null);

    useEffect(() => {
        const dialog = ref.current;
        const opener = document.activeElement;
        dialog.showModal();
        return () => {
            dialog.close();
            if (opener?.isConnected) opener.focus({ preventScroll: true });
        };
    }, []);

    return (
        <dialog
            ref={ref}
            tabIndex={-1}
            aria-labelledby={titleId}
            aria-describedby={`${titleId}-description`}
            onCancel={(event) => {
                event.preventDefault();
                if (!busy) onClose();
            }}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) {
                    event.preventDefault();
                    onClose();
                    return;
                }
                if (event.key !== 'Tab') return;
                const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary')].filter(c => c.getClientRects().length > 0);
                const first = controls[0];
                const last = controls.at(-1);
                if (!first) {
                    event.preventDefault();
                    event.currentTarget.focus();
                } else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }}
            className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/45 backdrop:backdrop-blur-xs animate-in fade-in-0 zoom-in-95 duration-150"
        >
            <div className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur-xs sm:px-6">
                <div className="min-w-0">
                    <h2 id={titleId} className="text-base font-bold tracking-tight text-slate-900">
                        {title}
                    </h2>
                    <p id={`${titleId}-description`} className="mt-0.5 break-words text-xs leading-relaxed text-slate-500">
                        {subtitle}
                    </p>
                </div>
                <button
                    type="button"
                    disabled={busy}
                    onClick={onClose}
                    aria-label={`Close ${title}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
                >
                    <X size={16} aria-hidden="true" />
                </button>
            </div>
            {children}
        </dialog>
    );
}

// Holiday Form
export function HolidayForm({ record, action, employees = [], employeesError, busy, canPublish = true, onSubmit, onClose }) {
    const [holiday, setHoliday] = useState(() => ({
        ...emptyHoliday,
        ...record,
        employee_ids: record?.employee_ids || [],
    }));
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const errorRef = useRef(null);
    const [personnelSearch, setPersonnelSearch] = useState('');

    const personnelTerm = personnelSearch.trim().toLowerCase();
    const visibleEmployees = useMemo(() => {
        return employees.filter(emp =>
            !personnelTerm ||
            [emp.first_name, emp.last_name, emp.company_id, emp.department]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(personnelTerm)
        );
    }, [employees, personnelTerm]);

    const cancelling = action === 'cancel';
    const set = (field, value) => setHoliday(current => ({ ...current, [field]: value }));

    const handleSelectAllVisible = () => {
        const visibleIds = visibleEmployees.map(e => e.id);
        const next = Array.from(new Set([...holiday.employee_ids, ...visibleIds]));
        set('employee_ids', next);
    };

    const handleClearVisibleSelection = () => {
        const visibleIds = new Set(visibleEmployees.map(e => e.id));
        const next = holiday.employee_ids.filter(id => !visibleIds.has(id));
        set('employee_ids', next);
    };

    const submit = async (event) => {
        event.preventDefault();
        setError('');
        if (!canPublish || busy) return;

        if (!cancelling && holiday.source_url && !safeHolidaySource(holiday.source_url)) {
            setError('Source link must be a valid, secure HTTPS URL.');
            requestAnimationFrame(() => errorRef.current?.focus());
            return;
        }

        if (!cancelling && holiday.coverage === 'selected' && !holiday.employee_ids.length) {
            setError('Please select at least one covered personnel record.');
            requestAnimationFrame(() => errorRef.current?.focus());
            return;
        }

        try {
            await onSubmit({
                action,
                ...(record ? { holiday_id: record.id, expected_revision: record.revision } : {}),
                reason: reason.trim(),
                ...(!cancelling ? {
                    holiday: {
                        name: holiday.name.trim(),
                        date: holiday.date,
                        type: holiday.type,
                        source_reference: holiday.source_reference.trim(),
                        source_url: holiday.source_url?.trim() || null,
                        coverage: holiday.coverage,
                        employee_ids: holiday.coverage === 'selected' ? holiday.employee_ids : [],
                    }
                } : {}),
            });
        } catch (failure) {
            setError(failure.message || 'Operation failed. Please review the inputs and retry.');
            requestAnimationFrame(() => errorRef.current?.focus());
        }
    };

    const selectedMeta = HOLIDAY_TYPES[holiday.type] || HOLIDAY_TYPES.regular;

    return (
        <section className="p-5 sm:p-6" aria-label={cancelling ? 'Cancellation details' : 'Holiday declaration details'}>
            {record && (
                <div className="mb-4 flex items-center justify-between text-xs text-slate-500 border-b border-slate-100 pb-2">
                    <span>Editing declaration: <strong className="text-slate-800">{record.name}</strong></span>
                    <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-[11px]">Revision {record.revision}</span>
                </div>
            )}

            {cancelling && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-xs leading-relaxed text-amber-900 flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-amber-950">Confirm Holiday Cancellation</p>
                        <p className="mt-0.5">
                            This deactivates the holiday for upcoming attendance and payroll calculations.
                            Previously finalized payroll registers and audit revision history remain preserved.
                        </p>
                    </div>
                </div>
            )}

            <form onSubmit={submit} className="space-y-4">
                {!canPublish && (
                    <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-center gap-2">
                        <ShieldCheck size={16} className="text-amber-600 shrink-0" />
                        <span>Calendar verification required. Close and refresh before publishing changes.</span>
                    </div>
                )}

                {error && (
                    <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-900 flex items-start gap-2">
                        <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                        <span className="font-medium">{error}</span>
                    </div>
                )}

                <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
                    {!cancelling && (
                        <>
                            <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Holiday Name <span className="text-rose-500">*</span>
                                        </label>
                                        <input
                                            className={inputBase}
                                            required
                                            maxLength={120}
                                            placeholder="e.g. Bonifacio Day, Rizal Day"
                                            value={holiday.name}
                                            onChange={e => set('name', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Official Date <span className="text-rose-500">*</span>
                                        </label>
                                        <input
                                            type="date"
                                            min="1990-01-01"
                                            max="2100-12-31"
                                            className={inputBase}
                                            required
                                            value={holiday.date}
                                            onChange={e => set('date', e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Official DOLE Classification <span className="text-rose-500">*</span>
                                        </label>
                                        <select
                                            className={inputBase}
                                            value={holiday.type}
                                            onChange={e => set('type', e.target.value)}
                                        >
                                            {Object.entries(HOLIDAY_TYPES).map(([val, info]) => (
                                                <option key={val} value={val}>
                                                    {info.fullLabel} ({info.ratePercent})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Legal Proclamation Reference <span className="text-rose-500">*</span>
                                        </label>
                                        <input
                                            className={inputBase}
                                            required
                                            maxLength={240}
                                            placeholder="e.g. Proclamation No. 727, s. 2026"
                                            value={holiday.source_reference || ''}
                                            onChange={e => set('source_reference', e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className={`rounded-lg p-2.5 border text-xs flex items-center justify-between gap-3 ${selectedMeta.badgeClass}`}>
                                    <div className="flex items-center gap-2">
                                        <Scale size={14} className="shrink-0" />
                                        <span className="font-semibold">{selectedMeta.fullLabel} Statutory Rule:</span>
                                    </div>
                                    <span className="font-medium tabular-nums">{selectedMeta.rateDesc}</span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Official Gazette / Reference Link <span className="font-normal text-slate-400">(Optional, HTTPS)</span>
                                </label>
                                <input
                                    type="url"
                                    className={inputBase}
                                    maxLength={1000}
                                    placeholder="https://www.officialgazette.gov.ph/..."
                                    value={holiday.source_url || ''}
                                    onChange={e => set('source_url', e.target.value)}
                                />
                            </div>

                            <div className="space-y-2 pt-1 border-t border-slate-100">
                                <label className="block text-xs font-semibold text-slate-700">
                                    Workforce Applicability
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => set('coverage', 'all')}
                                        className={`flex items-center justify-center gap-2 rounded-lg p-2.5 text-xs font-medium border transition-colors cursor-pointer ${holiday.coverage === 'all'
                                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs font-semibold'
                                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                            }`}
                                    >
                                        <Globe size={14} />
                                        <span>All Personnel (Nationwide)</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => set('coverage', 'selected')}
                                        className={`flex items-center justify-center gap-2 rounded-lg p-2.5 text-xs font-medium border transition-colors cursor-pointer ${holiday.coverage === 'selected'
                                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs font-semibold'
                                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                            }`}
                                    >
                                        <Users size={14} />
                                        <span>Selected Personnel Only</span>
                                    </button>
                                </div>

                                {holiday.coverage === 'selected' && (
                                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-xs font-semibold text-slate-800">
                                                Covered Personnel ({holiday.employee_ids.length} selected)
                                            </p>
                                            <div className="flex items-center gap-2 text-xs">
                                                <button
                                                    type="button"
                                                    onClick={handleSelectAllVisible}
                                                    className="text-accent hover:underline font-medium cursor-pointer"
                                                >
                                                    Select All
                                                </button>
                                                <span className="text-slate-300">|</span>
                                                <button
                                                    type="button"
                                                    onClick={handleClearVisibleSelection}
                                                    className="text-slate-500 hover:underline font-medium cursor-pointer"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                type="search"
                                                className={`${inputBase} pl-8 text-xs min-h-8`}
                                                placeholder="Filter by name, ID, or department..."
                                                value={personnelSearch}
                                                onChange={e => setPersonnelSearch(e.target.value)}
                                            />
                                        </div>

                                        {employeesError ? (
                                            <p role="alert" className="text-xs text-rose-600">
                                                Personnel list could not be retrieved. Please retry.
                                            </p>
                                        ) : !employees.length ? (
                                            <p className="text-xs text-slate-500">No personnel records found.</p>
                                        ) : (
                                            <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                                                {visibleEmployees.map(employee => {
                                                    const isChecked = holiday.employee_ids.includes(employee.id);
                                                    return (
                                                        <label
                                                            key={employee.id}
                                                            className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${isChecked ? 'bg-white border border-slate-200 text-slate-900 font-medium' : 'hover:bg-slate-100/80 text-slate-600'
                                                                }`}
                                                        >
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <input
                                                                    type="checkbox"
                                                                    className="rounded border-slate-300 text-slate-900 focus:ring-accent cursor-pointer"
                                                                    checked={isChecked}
                                                                    onChange={e => {
                                                                        const checked = e.target.checked;
                                                                        set('employee_ids', checked
                                                                            ? [...holiday.employee_ids, employee.id]
                                                                            : holiday.employee_ids.filter(id => id !== employee.id)
                                                                        );
                                                                    }}
                                                                />
                                                                <span className="truncate">
                                                                    {employee.last_name}, {employee.first_name}
                                                                </span>
                                                            </div>
                                                            <span className="text-[11px] text-slate-400 shrink-0 font-mono">
                                                                {employee.company_id || employee.department || ''}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                                {visibleEmployees.length === 0 && (
                                                    <p className="text-center py-3 text-xs text-slate-400">
                                                        No employees match search.
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    <div className="pt-2 border-t border-slate-100">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                            {cancelling ? 'Cancellation Governance Reason' : 'Audit Rationale / Reason for Change'} <span className="text-rose-500">*</span>
                        </label>
                        <textarea
                            required
                            maxLength={500}
                            rows={2}
                            className={`${inputBase} min-h-[3.5rem] text-xs resize-none`}
                            placeholder={cancelling ? 'Explain why this declaration is being rescinded...' : 'State proclamation declaration, republic act, or presidential decree basis...'}
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                        />
                        <span className="mt-0.5 block text-right text-[11px] text-slate-400" aria-hidden="true">
                            {reason.length}/500 characters
                        </span>
                    </div>
                </fieldset>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={onClose}
                        className={btnSecondary}
                    >
                        Dismiss
                    </button>
                    <button
                        type="submit"
                        disabled={busy || !canPublish || (!cancelling && holiday.coverage === 'selected' && employeesError)}
                        className={cancelling ? 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-2xs' : btnPrimary}
                    >
                        {busy ? 'Processing...' : cancelling ? 'Confirm Cancellation' : record ? 'Update Holiday' : 'Publish Holiday'}
                    </button>
                </div>
            </form>
        </section>
    );
}

// Main Page Component
export default function Holidays() {
    const queryClient = useQueryClient();
    const request = useRef(null);

    const [editor, setEditor] = useState(null);
    const [historyId, setHistoryId] = useState(null);
    const [result, setResult] = useState(null);

    // Filters
    const currentYear = new Date().getFullYear();
    const [filters, setFilters] = useState({
        year: currentYear,
        month: '',
        type: '',
        coverage: '',
        search: '',
    });
    const [viewMode, setViewMode] = useState('register'); // 'register' | 'matrix'
    const [showStatutoryInfo, setShowStatutoryInfo] = useState(false);
    const [showMoreFilters, setShowMoreFilters] = useState(false);
    const [showPastHolidays, setShowPastHolidays] = useState(false);
    const [activeMenuId, setActiveMenuId] = useState(null);
    const [expandedRowId, setExpandedRowId] = useState(null);

    // Latency-optimized deferred search
    const deferredSearch = filters.search;

    // Element Refs for Popovers and Shortcuts
    const searchInputRef = useRef(null);
    const statutoryPopoverRef = useRef(null);
    const moreFiltersPopoverRef = useRef(null);
    const moreFiltersButtonRef = useRef(null);
    const actionMenuRef = useRef(null);

    // Close floating menus on click outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (statutoryPopoverRef.current && !statutoryPopoverRef.current.contains(event.target)) {
                setShowStatutoryInfo(false);
            }
            if (
                moreFiltersPopoverRef.current &&
                !moreFiltersPopoverRef.current.contains(event.target) &&
                !moreFiltersButtonRef.current?.contains(event.target)
            ) {
                setShowMoreFilters(false);
            }
            if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
                setActiveMenuId(null);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Global keyboard shortcuts (Ctrl+K and ESC)
    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Escape') {
                setShowStatutoryInfo(false);
                setShowMoreFilters(false);
                setActiveMenuId(null);
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
                event.preventDefault();
                searchInputRef.current?.focus();
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Queries
    const query = useQuery({
        queryKey: ['holidays', filters.year],
        queryFn: async ({ signal }) => readHolidayResponse(await fetchWithAuth(`/api/holidays?year=${filters.year}`, { signal })),
        staleTime: 30000,
        retry: false,
    });

    const employees = useQuery({
        queryKey: ['holidays', 'employees'],
        queryFn: async ({ signal }) => readHolidayResponse(await fetchWithAuth('/api/holidays/employees', { signal })),
        enabled: Boolean(editor && editor.action !== 'cancel' && query.data?.configured),
        retry: false,
    });

    const history = useQuery({
        queryKey: ['holidayHistory', historyId],
        queryFn: async ({ signal }) => readHolidayResponse(await fetchWithAuth(`/api/holidays/${encodeURIComponent(historyId)}/history`, { signal })),
        enabled: Boolean(historyId),
        retry: false,
    });

    // Realtime Supabase Channel Listener
    useEffect(() => {
        const channel = supabase.channel('admin-holidays-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, () => {
                void queryClient.invalidateQueries({ queryKey: ['holidays'] });
                void queryClient.invalidateQueries({ queryKey: ['holidayHistory'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'holiday_calendar_state' }, () => {
                void queryClient.invalidateQueries({ queryKey: ['holidays'] });
                void queryClient.invalidateQueries({ queryKey: ['holidayCalendarVersion'] });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [queryClient]);

    // Mutation
    const mutation = useMutation({
        mutationFn: async (command) => {
            const fingerprint = JSON.stringify(command);
            if (request.current?.fingerprint !== fingerprint) {
                request.current = { fingerprint, operation_id: crypto.randomUUID() };
            }
            const response = await fetchWithAuth('/api/holidays/commands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...command, operation_id: request.current.operation_id })
            });
            try {
                return await readHolidayResponse(response);
            } catch (error) {
                if (response.status < 500) request.current = null;
                throw error;
            }
        },
        onSuccess: (data) => {
            request.current = null;
            setResult(data);
            setEditor(null);
            refreshHolidayCalendar(queryClient, data.version);
            void queryClient.invalidateQueries({ queryKey: ['holidayCalendarVersion'] });
        },
        onError: () => {
            void queryClient.invalidateQueries({ queryKey: ['holidays'] });
        },
    });

    const writable = query.data?.configured === true && !query.isError && !mutation.isPending;

    // Timezone-safe today string for Philippine business operations
    const todayIso = useMemo(() => {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    }, []);

    // Raw holiday list for current year
    const allHolidays = useMemo(() => query.data?.items || [], [query.data?.items]);

    // Metrics & Next Upcoming Holiday Calculation
    const metrics = useMemo(() => {
        let regularCount = 0;
        let specialNonWorkingCount = 0;
        let specialWorkingCount = 0;
        let activeCount = 0;
        let cancelledCount = 0;

        let upcoming = null;

        allHolidays.forEach(h => {
            if (h.status === 'cancelled') {
                cancelledCount++;
            } else {
                activeCount++;
                if (h.type === 'regular') regularCount++;
                else if (h.type === 'special_non_working') specialNonWorkingCount++;
                else if (h.type === 'special_working') specialWorkingCount++;

                if (h.date >= todayIso && (!upcoming || h.date < upcoming.date)) {
                    upcoming = h;
                }
            }
        });

        let upcomingDays = null;
        if (upcoming) {
            const diffTime = new Date(`${upcoming.date}T00:00:00`).getTime() - new Date(`${todayIso}T00:00:00`).getTime();
            upcomingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        return {
            total: allHolidays.length,
            activeCount,
            cancelledCount,
            regularCount,
            specialNonWorkingCount,
            specialWorkingCount,
            upcoming,
            upcomingDays,
        };
    }, [allHolidays, todayIso]);

    // View state determination
    const isPastYear = filters.year < currentYear;
    const isFutureYear = filters.year > currentYear;
    const isSearching = Boolean(deferredSearch.trim());
    const isCurrentYear = !isPastYear && !isFutureYear;
    const isDefaultCurrentYearView = isCurrentYear && !isSearching;
    const isFilteringOrSearching = Boolean(
        deferredSearch.trim() ||
        filters.month ||
        filters.type ||
        filters.coverage
    );

    // Filtered items when a search or filter is active, or when browsing past/future years
    const filteredItems = useMemo(() => {
        const term = deferredSearch.trim().toLowerCase();

        return allHolidays.filter(item => {
            if (filters.month && item.date?.slice(5, 7) !== filters.month) return false;
            if (filters.type === 'upcoming_only') {
                if (item.date < todayIso || item.status === 'cancelled') return false;
            } else if (filters.type === 'special') {
                if (item.type !== 'special_non_working' && item.type !== 'special_working') return false;
            } else if (filters.type && item.type !== filters.type) {
                return false;
            }
            if (filters.coverage && (item.coverage || 'all') !== filters.coverage) return false;
            if (term) {
                const searchCorpus = [item.name, item.source_reference, item.date].filter(Boolean).join(' ').toLowerCase();
                if (!searchCorpus.includes(term)) return false;
            }
            return true;
        }).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    }, [allHolidays, filters.month, filters.type, filters.coverage, deferredSearch, todayIso]);

    // Separate upcoming vs past lists for current year collapsible view
    const upcomingList = useMemo(() => {
        return filteredItems
            .filter(item => item.date >= todayIso)
            .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    }, [filteredItems, todayIso]);

    const pastList = useMemo(() => {
        return filteredItems
            .filter(item => item.date < todayIso)
            .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)); // newest first
    }, [filteredItems, todayIso]);

    // 12-Month Matrix Data
    const matrixMonths = useMemo(() => {
        const source = isDefaultCurrentYearView ? allHolidays : filteredItems;
        const months = Array.from({ length: 12 }, (_, i) => ({
            monthNum: String(i + 1).padStart(2, '0'),
            name: new Date(2026, i, 1).toLocaleString('en-PH', { month: 'long' }),
            shortName: new Date(2026, i, 1).toLocaleString('en-PH', { month: 'short' }),
            holidays: [],
        }));

        source.forEach(h => {
            const mIdx = parseInt(h.date?.slice(5, 7), 10) - 1;
            if (mIdx >= 0 && mIdx < 12) {
                months[mIdx].holidays.push(h);
            }
        });

        return months;
    }, [allHolidays, filteredItems, isDefaultCurrentYearView]);

    const hasMoreFiltersActive = Boolean(filters.month || filters.coverage);
    const moreFiltersCount = (filters.month ? 1 : 0) + (filters.coverage ? 1 : 0);
    const hasAnyFilterActive = Boolean(filters.month || filters.type || filters.coverage || filters.search);

    const filter = (name, value) => {
        if (name === 'year') {
            setShowPastHolidays(false);
        }
        setFilters(current => ({ ...current, [name]: value }));
    };

    const handleClearAllFilters = () => {
        setShowPastHolidays(false);
        setFilters(current => ({ ...current, month: '', type: '', coverage: '', search: '' }));
    };

    const openEditor = (record, action) => {
        setResult(null);
        setActiveMenuId(null);
        setEditor({ record, action });
    };

    // Reusable Table Row Renderer
    const renderHolidayRow = (record, { isUpcomingNext = false, isPastMuted = false } = {}) => {
        const typeInfo = HOLIDAY_TYPES[record.type] || HOLIDAY_TYPES.regular;
        const isCancelled = record.status === 'cancelled';
        const dateObj = new Date(`${record.date}T00:00:00Z`);
        const dayNum = record.date.slice(8, 10);
        const monthStr = monthFormatter.format(dateObj);
        const weekdayStr = weekdayFormatter.format(dateObj);
        const isExpanded = expandedRowId === record.id;

        return (
            <tr
                key={record.id}
                onClick={() => setExpandedRowId(isExpanded ? null : record.id)}
                className={`group h-11 border-b border-slate-100 transition-colors cursor-pointer ${
                    isUpcomingNext
                        ? 'bg-blue-50/30 border-l-3 border-l-blue-600'
                        : isPastMuted
                            ? 'opacity-65 hover:opacity-100 hover:bg-slate-50/70'
                            : 'hover:bg-slate-50/70'
                }`}
            >
                {/* Date Column: "01 Jan" bold, weekday in small muted text. No repeated year. */}
                <td className="py-2.5 px-3.5 whitespace-nowrap">
                    <div className="flex items-baseline gap-1.5">
                        <span className="font-bold text-slate-900 text-xs">
                            {dayNum} {monthStr}
                        </span>
                        <span className="text-[11px] text-slate-400">
                            {weekdayStr}
                        </span>
                    </div>
                </td>

                {/* Holiday Column: name only, plus dynamic "In 20 days" badge on next upcoming */}
                <td className="py-2.5 px-3 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-semibold text-xs text-slate-900 ${isCancelled ? 'line-through text-slate-400' : ''}`}>
                            {record.name}
                        </span>

                        {/* Next upcoming highlight dynamic countdown badge */}
                        {isUpcomingNext && metrics.upcomingDays != null && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 border border-blue-200/80 shrink-0">
                                {metrics.upcomingDays === 0
                                    ? 'Today'
                                    : metrics.upcomingDays === 1
                                        ? 'Tomorrow'
                                        : `In ${metrics.upcomingDays} days`}
                            </span>
                        )}

                        {isCancelled && (
                            <span className="px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                                Cancelled
                            </span>
                        )}

                        {/* Show coverage only when NOT default (all) */}
                        {record.coverage === 'selected' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px] font-medium" title={`${record.employee_ids?.length || 0} designated personnel`}>
                                <Users size={11} />
                                <span>{record.employee_ids?.length || 0} Personnel</span>
                            </span>
                        )}

                        {/* Show link icon only if verified URL exists */}
                        {safeHolidaySource(record.source_url) && (
                            <a
                                href={safeHolidaySource(record.source_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="text-slate-400 hover:text-accent p-0.5 inline-flex items-center"
                                title="Official Gazette Link"
                                aria-label={`Official Gazette reference link for ${record.name}`}
                            >
                                <ExternalLink size={12} />
                            </a>
                        )}
                    </div>
                </td>

                {/* Type Column: One small colored badge (Regular = amber, Special NW = indigo, Special W = sky) */}
                <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${typeInfo.badgeClass}`}>
                        <span className="hidden sm:inline">{typeInfo.label}</span>
                        <span className="sm:hidden">{typeInfo.shortLabel}</span>
                    </span>
                </td>

                {/* Pay Rate Column: Plain text like "200%", no monospace, no "Rev 1" */}
                <td className="py-2.5 px-3 whitespace-nowrap text-xs font-semibold text-slate-700">
                    {typeInfo.ratePercent}
                </td>

                {/* Actions: One "⋯" overflow menu per row */}
                <td className="py-2.5 px-3 whitespace-nowrap text-right">
                    <div className="relative inline-block text-left" onClick={e => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => setActiveMenuId(activeMenuId === record.id ? null : record.id)}
                            aria-label={`Actions for ${record.name}`}
                            aria-expanded={activeMenuId === record.id}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                        >
                            <MoreHorizontal size={15} />
                        </button>

                        {activeMenuId === record.id && (
                            <div
                                ref={actionMenuRef}
                                className="absolute right-0 top-full mt-1 z-40 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg text-xs animate-in fade-in-0 zoom-in-95 duration-100"
                            >
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveMenuId(null);
                                        setHistoryId(record.id);
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                                >
                                    <History size={13} className="text-slate-400" />
                                    <span>View History</span>
                                </button>

                                {!isCancelled && (
                                    <>
                                        <button
                                            type="button"
                                            disabled={!writable || !record.revision}
                                            onClick={() => {
                                                setActiveMenuId(null);
                                                openEditor(record, 'update');
                                            }}
                                            className="flex w-full items-center gap-2 px-3 py-1.5 text-slate-700 hover:bg-slate-50 cursor-pointer text-left disabled:opacity-40"
                                        >
                                            <Pencil size={13} className="text-slate-400" />
                                            <span>Edit</span>
                                        </button>

                                        <button
                                            type="button"
                                            disabled={!writable || !record.revision}
                                            onClick={() => {
                                                setActiveMenuId(null);
                                                openEditor(record, 'cancel');
                                            }}
                                            className="flex w-full items-center gap-2 px-3 py-1.5 text-rose-600 hover:bg-rose-50 cursor-pointer text-left disabled:opacity-40"
                                        >
                                            <Ban size={13} />
                                            <span>Disable</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </td>
            </tr>
        );
    };

    const isApprovalReady = query.data?.configured !== false;
    const backendReady = !query.isError && (query.isLoading || Boolean(query.data));

    // Keep hooks in the same order when the backend enables/disables the module.
    if (!backendReady) return (
        <div className="space-y-4">
            <PageHeader
                breadcrumbs={['Admin', 'Holidays']}
            />
            <div className="rounded-md border border-line bg-surface p-4">
                <p role="status" className="text-sm text-ink">{holidayAvailabilityMessage(query.data, query.error)}</p>
                <button
                    type="button"
                    onClick={() => query.refetch()}
                    disabled={query.isFetching}
                    className="mt-3 rounded-md border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                    Check again
                </button>
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Enterprise PageHeader */}
            <PageHeader
                breadcrumbs={['Admin', 'Holidays']}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        {!isApprovalReady && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                <i className="ti ti-alert-triangle text-xs" />
                                <span>Migration Required</span>
                            </span>
                        )}

                        <button
                            type="button"
                            disabled={!writable}
                            onClick={() => openEditor(null, 'create')}
                            className="h-9 px-3.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
                            title="Declare official national or local holiday"
                        >
                            <i className="ti ti-plus text-xs" />
                            <span>Declare Holiday</span>
                        </button>
                    </div>
                }
            />

            {result && (
                <div role="status" className="flex items-start justify-between gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-950 shadow-2xs animate-in fade-in-0 duration-150">
                    <div className="flex items-start gap-2">
                        <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                        <div>
                            <p className="font-semibold text-emerald-900">
                                Holiday Declaration {result.holiday?.status === 'cancelled' ? 'Rescinded' : 'Successfully Published'}.
                            </p>
                            <p className="mt-0.5 text-emerald-800">
                                {result.impact?.saved_payroll_count ?? 0} saved payroll records affected. Finalized disbursements are preserved; open cutoffs will automatically apply the statutory rate.
                            </p>
                        </div>
                    </div>
                    <button type="button" className="p-1 text-emerald-700 hover:text-emerald-900 cursor-pointer" onClick={() => setResult(null)} aria-label="Dismiss confirmation">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* 2. Summary: ONE slim inline strip (single row, small text) */}
            <div className="relative flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-lg bg-slate-100/70 border border-slate-200/80 text-xs text-slate-600">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="font-semibold text-slate-900">
                        {metrics.total} holidays
                    </span>
                    <span className="text-slate-300">·</span>
                    <span>{metrics.regularCount} Regular (200%)</span>
                    <span className="text-slate-300">·</span>
                    <span>{metrics.specialNonWorkingCount + metrics.specialWorkingCount} Special (130%)</span>
                    {metrics.upcoming && (
                        <>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-800">
                                Next: <strong className="font-semibold text-slate-900">{metrics.upcoming.name}</strong> {metrics.upcomingDays === 0 ? 'today' : `in ${metrics.upcomingDays} day${metrics.upcomingDays > 1 ? 's' : ''}`}
                            </span>
                        </>
                    )}
                </div>

                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setShowStatutoryInfo(prev => !prev)}
                        aria-expanded={showStatutoryInfo}
                        aria-label="DOLE statutory pay rules info"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                        title="Click to view DOLE statutory pay rules"
                    >
                        <Info size={13} aria-hidden="true" />
                        <span>DOLE Rules</span>
                    </button>

                    {showStatutoryInfo && (
                        <div
                            ref={statutoryPopoverRef}
                            className="absolute right-0 top-full mt-1.5 z-40 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl text-xs space-y-2.5 animate-in fade-in-0 zoom-in-95 duration-100 text-slate-700"
                        >
                            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                                    <Scale size={14} className="text-slate-700 shrink-0" />
                                    <span>Philippine DOLE Holiday Payroll Rules</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowStatutoryInfo(false)}
                                    aria-label="Close DOLE guide"
                                    className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                                >
                                    <X size={13} />
                                </button>
                            </div>

                            <p className="text-[11px] font-medium text-slate-800 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                Regular: 200% worked / 100% unworked · Special: 130% worked / 0% unworked
                            </p>

                            <div className="space-y-2 text-[11px] leading-relaxed text-slate-600">
                                <div>
                                    <strong className="text-amber-800 block font-semibold">Regular Holiday (Article 94)</strong>
                                    <span>100% daily rate if unworked. 200% for first 8 hours worked; +30% of hourly rate for OT.</span>
                                </div>
                                <div>
                                    <strong className="text-indigo-800 block font-semibold">Special Non-Working Day</strong>
                                    <span>"No work, no pay" applies unless company policy dictates. 130% daily rate if worked.</span>
                                </div>
                                <div>
                                    <strong className="text-sky-800 block font-semibold">Special Working Day</strong>
                                    <span>Standard 100% working day rate. Approved leaves do not consume leave credits.</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content Container (Single Surface, No Nested Cards) */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
                {/* 3. Toolbar (ONE row only) */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 sm:px-4 border-b border-slate-100 bg-slate-50/40">
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                        {/* Year switcher (‹ 2026 ›) */}
                        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs shrink-0">
                            <button
                                type="button"
                                onClick={() => filter('year', filters.year - 1)}
                                className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                                aria-label="Previous Year"
                                title="Previous Year"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <span className="px-2 font-mono text-xs font-bold text-slate-900 select-none">
                                {filters.year}
                            </span>
                            <button
                                type="button"
                                onClick={() => filter('year', filters.year + 1)}
                                className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                                aria-label="Next Year"
                                title="Next Year"
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>

                        {/* Search input with Ctrl+K shortcut */}
                        <div className="relative min-w-[140px] sm:min-w-[180px] max-w-[240px] flex-1">
                            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                ref={searchInputRef}
                                type="search"
                                maxLength={120}
                                value={filters.search || ''}
                                onChange={e => filter('search', e.target.value)}
                                placeholder="Search (Ctrl+K)..."
                                aria-label="Search holidays"
                                className="w-full h-8 rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-accent shadow-2xs"
                            />
                            {filters.search && (
                                <button
                                    type="button"
                                    onClick={() => filter('search', '')}
                                    aria-label="Clear search"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>

                        {/* Segmented control for type: All | Regular | Special | Upcoming */}
                        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5 shrink-0 text-xs font-medium">
                            {[
                                { id: '', label: 'All' },
                                { id: 'regular', label: 'Regular' },
                                { id: 'special', label: 'Special' },
                                { id: 'upcoming_only', label: 'Upcoming' },
                            ].map(tab => {
                                const active = filters.type === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => filter('type', tab.id)}
                                        className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                                            active
                                                ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* "More filters" Dropdown (Month & Applicability) */}
                        <div className="relative shrink-0">
                            <button
                                type="button"
                                ref={moreFiltersButtonRef}
                                onClick={() => setShowMoreFilters(prev => !prev)}
                                aria-expanded={showMoreFilters}
                                aria-label="More filters"
                                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors cursor-pointer shadow-2xs ${
                                    hasMoreFiltersActive
                                        ? 'border-slate-900 bg-slate-900 text-white font-semibold'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                            >
                                <Filter size={12} />
                                <span>Filters</span>
                                {moreFiltersCount > 0 && (
                                    <span className="h-4 min-w-4 px-1 rounded-full bg-white text-slate-900 text-[10px] font-bold inline-flex items-center justify-center">
                                        {moreFiltersCount}
                                    </span>
                                )}
                            </button>

                            {showMoreFilters && (
                                <div
                                    ref={moreFiltersPopoverRef}
                                    className="absolute left-0 sm:right-auto top-full mt-1.5 z-40 w-64 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl space-y-3 text-xs animate-in fade-in-0 zoom-in-95 duration-100"
                                >
                                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                        <span className="font-bold text-slate-900">Additional Filters</span>
                                        {hasMoreFiltersActive && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setFilters(curr => ({ ...curr, month: '', coverage: '' }));
                                                }}
                                                className="text-[11px] text-accent hover:underline font-semibold cursor-pointer"
                                            >
                                                Reset
                                            </button>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                            Month
                                        </label>
                                        <select
                                            value={filters.month}
                                            onChange={e => filter('month', e.target.value)}
                                            className="w-full h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
                                        >
                                            <option value="">All Months (Whole Year)</option>
                                            {Array.from({ length: 12 }, (_, i) => {
                                                const mVal = String(i + 1).padStart(2, '0');
                                                const mName = new Date(2026, i, 1).toLocaleString('en-PH', { month: 'long' });
                                                return <option key={mVal} value={mVal}>{mName}</option>;
                                            })}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                            Workforce Applicability
                                        </label>
                                        <select
                                            value={filters.coverage}
                                            onChange={e => filter('coverage', e.target.value)}
                                            className="w-full h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
                                        >
                                            <option value="">All Applicability</option>
                                            <option value="all">All Personnel Only</option>
                                            <option value="selected">Selected Personnel Only</option>
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>

                        {hasAnyFilterActive && (
                            <button
                                type="button"
                                onClick={handleClearAllFilters}
                                className="text-xs text-slate-400 hover:text-slate-700 underline cursor-pointer shrink-0"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Register / Month Matrix Toggle on far right */}
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5 shrink-0 text-xs font-medium self-end sm:self-auto">
                        <button
                            type="button"
                            onClick={() => setViewMode('register')}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                                viewMode === 'register'
                                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Register View"
                        >
                            <LayoutList size={13} />
                            <span className="hidden sm:inline">Register</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('matrix')}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                                viewMode === 'matrix'
                                    ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Month Matrix View"
                        >
                            <LayoutGrid size={13} />
                            <span className="hidden sm:inline">Matrix</span>
                        </button>
                    </div>
                </div>

                {/* 4. Content View: Register Table */}
                {viewMode === 'register' && (
                    <>
                        {query.isPending ? (
                            <div className="px-5 py-16 text-center">
                                <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-accent" />
                                <p className="text-xs font-semibold text-slate-700">Loading holiday declarations...</p>
                            </div>
                        ) : query.isError ? (
                            <div className="px-5 py-16 text-center">
                                <AlertTriangle size={20} className="mx-auto mb-2 text-rose-500" />
                                <p className="text-xs font-semibold text-slate-700">Unable to load holiday records.</p>
                                <button type="button" className={`${btnSecondary} mt-3 text-xs`} onClick={() => query.refetch()}>
                                    Refresh
                                </button>
                            </div>
                        ) : !allHolidays.length ? (
                            <div className="px-5 py-16 text-center">
                                <CalendarDays size={28} className="mx-auto mb-2 text-slate-300" aria-hidden="true" />
                                <h3 className="text-xs font-bold text-slate-800">
                                    No Holidays Declared for {filters.year}
                                </h3>
                                <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                                    Click "Declare Holiday" above to add official proclamations.
                                </p>
                                <button
                                    type="button"
                                    className={`${btnPrimary} mt-3 text-xs`}
                                    disabled={!writable}
                                    onClick={() => openEditor(null, 'create')}
                                >
                                    <Plus size={13} />
                                    <span>Declare First Holiday</span>
                                </button>
                            </div>
                        ) : isFilteringOrSearching && !filteredItems.length ? (
                            <div className="px-5 py-16 text-center">
                                <Search size={28} className="mx-auto mb-2 text-slate-300" aria-hidden="true" />
                                <h3 className="text-xs font-bold text-slate-800">
                                    No Matching Holiday Declarations
                                </h3>
                                <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                                    Try clearing active search or filters to show more declarations.
                                </p>
                                <button type="button" className={`${btnSecondary} mt-3 text-xs`} onClick={handleClearAllFilters}>
                                    Reset Filters
                                </button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-left text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200/90 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500 select-none">
                                            <th scope="col" className="py-2.5 px-3.5 w-24">Date</th>
                                            <th scope="col" className="py-2.5 px-3">Holiday</th>
                                            <th scope="col" className="py-2.5 px-3 w-36">Type</th>
                                            <th scope="col" className="py-2.5 px-3 w-20">Pay Rate</th>
                                            <th scope="col" className="py-2.5 px-3 w-12 text-right">
                                                <span className="sr-only">Actions</span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {/* Case A: Filtering, Searching, Past Year, or Future Year -> Show unified list without collapse */}
                                        {!isDefaultCurrentYearView && (
                                            filteredItems.map(record => {
                                                const isUpcomingNext = metrics.upcoming?.id === record.id;
                                                const isPastMuted = record.date < todayIso;
                                                return renderHolidayRow(record, { isUpcomingNext, isPastMuted });
                                            })
                                        )}

                                        {/* Case B: Default Current Year View -> Show Upcoming first */}
                                        {isDefaultCurrentYearView && (
                                            <>
                                                {upcomingList.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                                                            No upcoming holidays remaining in {filters.year}
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    upcomingList.map(record => {
                                                        const isUpcomingNext = metrics.upcoming?.id === record.id;
                                                        return renderHolidayRow(record, { isUpcomingNext });
                                                    })
                                                )}

                                                {/* Expanded Past Holidays Inline Rows */}
                                                {showPastHolidays && pastList.length > 0 && (
                                                    <>
                                                        <tr className="bg-slate-100/60 dark:bg-[#172033] border-t border-b border-slate-200/60 dark:border-white/10">
                                                            <td colSpan={5} className="py-1 px-3.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                                                                Past Holidays ({pastList.length}) · Newest First
                                                            </td>
                                                        </tr>
                                                        {pastList.map(record => renderHolidayRow(record, { isPastMuted: true }))}
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Past Holidays Toggle (Shown below table in default current year view) */}
                        {isDefaultCurrentYearView && pastList.length > 0 && (
                            <div className="border-t border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-[#111827]/70 px-3.5 py-2">
                                <button
                                    type="button"
                                    onClick={() => setShowPastHolidays(prev => !prev)}
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer select-none"
                                >
                                    <ChevronDown
                                        size={14}
                                        className={`transition-transform duration-150 ${showPastHolidays ? 'rotate-180' : ''}`}
                                    />
                                    <span>
                                        {showPastHolidays
                                            ? `Hide past holidays (${pastList.length})`
                                            : `Show past holidays (${pastList.length})`}
                                    </span>
                                </button>
                            </div>
                        )}

                        {/* 5. Clean Footer (No Prev/Next buttons; pure count indicator) */}
                        <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-100 dark:border-white/10 bg-slate-50/40 dark:bg-[#111827]/70 text-xs text-slate-500 dark:text-slate-400">
                            <p className="tabular-nums">
                                {deferredSearch.trim() ? (
                                    <>
                                        Showing <strong className="text-slate-700 dark:text-slate-200 font-semibold">{filteredItems.length}</strong> matching holiday{filteredItems.length === 1 ? '' : 's'} in {filters.year}
                                    </>
                                ) : isPastYear ? (
                                    <>
                                        Showing <strong className="text-slate-700 dark:text-slate-200 font-semibold">{allHolidays.length}</strong> holidays in {filters.year}
                                    </>
                                ) : isFutureYear ? (
                                    <>
                                        Showing <strong className="text-slate-700 dark:text-slate-200 font-semibold">{allHolidays.length}</strong> upcoming holidays in {filters.year}
                                    </>
                                ) : showPastHolidays ? (
                                    <>
                                        Showing <strong className="text-slate-700 dark:text-slate-200 font-semibold">{upcomingList.length}</strong> upcoming and{' '}
                                        <strong className="text-slate-700 dark:text-slate-200 font-semibold">{pastList.length}</strong> past of{' '}
                                        <strong className="text-slate-700 dark:text-slate-200 font-semibold">{filteredItems.length}</strong> holidays in {filters.year}
                                    </>
                                ) : (
                                    <>
                                        Showing <strong className="text-slate-700 dark:text-slate-200 font-semibold">{upcomingList.length}</strong> upcoming of{' '}
                                        <strong className="text-slate-700 dark:text-slate-200 font-semibold">{filteredItems.length}</strong> holidays in {filters.year}
                                        {pastList.length > 0 && (
                                            <span className="text-slate-400 dark:text-slate-500"> ({pastList.length} past hidden)</span>
                                        )}
                                    </>
                                )}
                            </p>
                        </div>
                    </>
                )}

                {/* Content View 2: Month Matrix */}
                {viewMode === 'matrix' && (
                    <div className="p-4 sm:p-5">
                        <div className="mb-3.5 flex items-center justify-between text-xs text-slate-500">
                            <span>12-month annual holiday distribution for calendar year <strong>{filters.year}</strong></span>
                            <span className="font-semibold text-slate-700">{allHolidays.length} Total in view</span>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {matrixMonths.map(m => {
                                const count = m.holidays.length;
                                return (
                                    <div
                                        key={m.monthNum}
                                        className={`rounded-lg border p-3 transition-all ${
                                            count > 0 ? 'border-slate-200 bg-white shadow-2xs' : 'border-slate-100 bg-slate-50/40'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                                            <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                                                {m.name}
                                            </span>
                                            <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ${count > 0 ? 'bg-slate-900 text-white' : 'text-slate-400'}`}>
                                                {count}
                                            </span>
                                        </div>

                                        {count === 0 ? (
                                            <p className="py-4 text-center text-[11px] text-slate-400">
                                                No holidays
                                            </p>
                                        ) : (
                                            <div className="mt-2 space-y-1">
                                                {m.holidays.map(h => {
                                                    const typeInfo = HOLIDAY_TYPES[h.type] || HOLIDAY_TYPES.regular;
                                                    const isCancelled = h.status === 'cancelled';
                                                    return (
                                                        <div
                                                            key={h.id}
                                                            onClick={() => openEditor(h, 'update')}
                                                            className={`group flex items-start gap-1.5 rounded-md p-1.5 border text-xs cursor-pointer transition-all hover:shadow-2xs ${typeInfo.badgeClass} ${isCancelled ? 'opacity-50' : ''}`}
                                                            title="Click to edit or view details"
                                                        >
                                                            <span className="font-bold tabular-nums text-slate-900 shrink-0 font-mono text-[11px] mt-0.5">
                                                                {h.date.slice(8, 10)}
                                                            </span>
                                                            <div className="min-w-0 flex-1">
                                                                <p className="truncate font-semibold text-slate-900 group-hover:underline">
                                                                    {h.name}
                                                                </p>
                                                                <p className="text-[10px] opacity-80 truncate">
                                                                    {typeInfo.ratePercent}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Dialog 1: Add / Edit / Cancel Holiday */}
            {editor && (
                <HolidayDialog
                    title={editor.action === 'cancel' ? 'Rescind Holiday Declaration' : editor.record ? 'Edit Holiday Declaration' : 'Declare Official Holiday'}
                    titleId="holiday-editor-title"
                    subtitle={editor.record?.name || 'Publish an official proclamation and configure employee coverage.'}
                    busy={mutation.isPending}
                    onClose={() => setEditor(null)}
                >
                    <HolidayForm
                        key={`${editor.action}-${editor.record?.id || 'new'}`}
                        {...editor}
                        employees={employees.data?.items || []}
                        employeesError={employees.isError}
                        busy={mutation.isPending}
                        canPublish={writable}
                        onSubmit={mutation.mutateAsync}
                        onClose={() => setEditor(null)}
                    />
                </HolidayDialog>
            )}

            {/* Dialog 2: Revision Audit History */}
            {historyId && (
                <HolidayDialog
                    title="Declaration Revision Audit Trail"
                    titleId="holiday-history-title"
                    subtitle={allHolidays.find(h => h.id === historyId)?.name || 'Complete recorded governance timeline for this declaration.'}
                    onClose={() => setHistoryId(null)}
                >
                    <div className="p-5 sm:p-6">
                        {history.isPending ? (
                            <div className="py-10 text-center text-xs text-slate-500">
                                <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-accent" />
                                <span>Loading revision history...</span>
                            </div>
                        ) : history.isError ? (
                            <div role="alert" className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-900">
                                <p className="font-semibold">Failed to load audit history.</p>
                                <p className="mt-0.5">{history.error.message}</p>
                                <button type="button" className={`${btnSecondary} mt-2.5 text-xs`} onClick={() => history.refetch()}>
                                    Retry History
                                </button>
                            </div>
                        ) : !history.data?.items?.length ? (
                            <div className="py-10 text-center text-xs text-slate-500">
                                <History size={22} className="mx-auto mb-2 text-slate-300" />
                                <p className="font-medium text-slate-700">No recorded audit revisions found.</p>
                                <p className="text-slate-400 text-[11px] mt-0.5">Legacy records may predate the event logger.</p>
                            </div>
                        ) : (
                            <div className="relative border-l border-slate-200 ml-3.5 pl-3.5 space-y-5">
                                {history.data.items.map((item, idx) => {
                                    const actionColor = item.action === 'create'
                                        ? 'bg-emerald-500 ring-emerald-100'
                                        : item.action === 'cancel'
                                            ? 'bg-rose-500 ring-rose-100'
                                            : 'bg-accent ring-sky-100';

                                    return (
                                        <div key={item.id || idx} className="relative group">
                                            <div className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-3 ${actionColor}`} />

                                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-bold uppercase tracking-wider text-slate-900">
                                                        {item.action}
                                                    </span>
                                                    <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] text-slate-600">
                                                        Rev {item.after_record?.revision ?? '—'}
                                                    </span>
                                                </div>
                                                <time className="text-[11px] text-slate-400 font-mono">
                                                    {item.created_at ? new Date(item.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : ''}
                                                </time>
                                            </div>

                                            {item.command?.reason && (
                                                <p className="mt-1 text-xs text-slate-700 leading-relaxed bg-slate-50 p-2 rounded-lg border border-slate-100">
                                                    "{item.command.reason}"
                                                </p>
                                            )}

                                            <div className="mt-1.5 text-[11px] text-slate-400 flex flex-wrap items-center gap-2.5">
                                                <span>Source: <strong>{item.after_record?.source_reference || 'Unrecorded'}</strong></span>
                                                <span>Actor: <strong className="font-mono">{item.actor_id ? `${String(item.actor_id).slice(0, 8)}...` : 'System'}</strong></span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </HolidayDialog>
            )}
        </div>
    );
}
