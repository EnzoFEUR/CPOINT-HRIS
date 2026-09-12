import React, { useCallback, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import googleCalendarPlugin from '@fullcalendar/google-calendar';
import { fetchWithAuth } from '../../../utils/api';
import {
    HOLIDAY_TYPES,
    HOLIDAY_TYPE_LABELS,
    MULTIPLIERS,
    extractDateStr,
    formatReadableDate,
} from './utils/payrollHelpers';

// ------------------------------------------------------------------
// Reference calendar: Google's public Philippine Holidays calendar.
// This is READ-ONLY — it tells you *that* a date is a holiday, not
// which DOLE pay category it falls under, since that classification
// is a legal/company decision Google has no concept of. Your own
// `holidays` table (Supabase) remains the single source of truth for
// payroll math; this calendar is only a reference layer so nothing
// gets missed when classifying each year's dates.
//
// Override with VITE_HOLIDAY_REFERENCE_CALENDAR_ID if you want a
// different source calendar (e.g. a company-specific one).
// ------------------------------------------------------------------
const GOOGLE_CALENDAR_API_KEY = import.meta.env.VITE_GOOGLE_CALENDAR_API_KEY || '';
const REFERENCE_CALENDAR_ID =
    import.meta.env.VITE_HOLIDAY_REFERENCE_CALENDAR_ID || 'en.philippines#holiday@group.v.calendar.google.com';

// Visual language kept in one place so the calendar, the legend, and the
// classify panel can never disagree about what color means what type.
const TYPE_STYLES = {
    [HOLIDAY_TYPES.REGULAR]: {
        dot: 'bg-rose-500',
        chip: 'bg-rose-50 text-rose-700 border-rose-200',
        eventBg: '#e11d48',
        ring: 'ring-rose-500',
    },
    [HOLIDAY_TYPES.SPECIAL_NON_WORKING]: {
        dot: 'bg-amber-500',
        chip: 'bg-amber-50 text-amber-700 border-amber-200',
        eventBg: '#d97706',
        ring: 'ring-amber-500',
    },
    [HOLIDAY_TYPES.SPECIAL_WORKING]: {
        dot: 'bg-blue-500',
        chip: 'bg-blue-50 text-blue-700 border-blue-200',
        eventBg: '#2563eb',
        ring: 'ring-blue-500',
    },
};

const pct = (n) => `${Math.round(n * 100)}%`;

function multiplierSummary(type) {
    const m = MULTIPLIERS[type];
    if (!m) return '';
    if (m.worked === 0 && m.unworked === 0) return 'No pay';
    return `Worked ${pct(m.worked)} · Unworked ${pct(m.unworked)}`;
}

export default function HolidayCalendarManager() {
    const calendarRef = useRef(null);
    const [panel, setPanel] = useState(null); // { mode: 'classify' | 'manage', date, name, type, holidayId }
    const [generating, setGenerating] = useState(false);
    const [genYear, setGenYear] = useState(new Date().getFullYear());
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState(null); // { type: 'success' | 'error', message }

    const flash = (type, message) => {
        setToast({ type, message });
        window.clearTimeout(flash._t);
        flash._t = window.setTimeout(() => setToast(null), 4000);
    };

    const refetch = () => calendarRef.current?.getApi()?.refetchEvents();

    // Own Supabase-backed holidays — the actual payroll source of truth.
    const ownEventsSource = useCallback((fetchInfo, successCallback, failureCallback) => {
        const start = extractDateStr(fetchInfo.startStr);
        const end = extractDateStr(fetchInfo.endStr);
        fetchWithAuth(`/api/payroll/holidays?start=${start}&end=${end}`)
            .then((res) => {
                if (!res.ok) throw new Error('Failed to load holidays');
                return res.json();
            })
            .then((rows) => {
                const events = (Array.isArray(rows) ? rows : []).map((h) => ({
                    id: `db-${h.id}`,
                    title: h.name,
                    start: h.date,
                    allDay: true,
                    backgroundColor: TYPE_STYLES[h.type]?.eventBg || '#64748b',
                    borderColor: TYPE_STYLES[h.type]?.eventBg || '#64748b',
                    extendedProps: { holidayId: h.id, holidayType: h.type, holidayName: h.name },
                }));
                successCallback(events);
            })
            .catch(failureCallback);
    }, []);

    const eventSources = useMemo(() => {
        const sources = [{ events: ownEventsSource }];
        if (GOOGLE_CALENDAR_API_KEY) {
            sources.push({
                googleCalendarId: REFERENCE_CALENDAR_ID,
                className: 'holiday-ref-event',
                color: '#94a3b8',
            });
        }
        return sources;
    }, [ownEventsSource]);

    const openClassifyPanel = (dateStr, suggestedName = '') => {
        setPanel({
            mode: 'classify',
            date: dateStr,
            name: suggestedName,
            type: HOLIDAY_TYPES.REGULAR,
            holidayId: null,
        });
    };

    const handleDateClick = (info) => {
        openClassifyPanel(extractDateStr(info.dateStr));
    };

    const handleEventClick = (info) => {
        const { holidayId, holidayType, holidayName } = info.event.extendedProps || {};
        const dateStr = extractDateStr(info.event.startStr);

        if (holidayId) {
            // One of our own classified holidays — offer to manage/delete it.
            setPanel({ mode: 'manage', date: dateStr, name: holidayName, type: holidayType, holidayId });
        } else {
            // A Google reference event with no DOLE classification yet.
            openClassifyPanel(dateStr, info.event.title || '');
        }
    };

    const handleSaveClassification = async () => {
        if (!panel?.name?.trim()) {
            flash('error', 'Give this holiday a name before saving.');
            return;
        }
        setSaving(true);
        try {
            const res = await fetchWithAuth('/api/payroll/holidays', {
                method: 'POST',
                body: JSON.stringify({ name: panel.name.trim(), date: panel.date, type: panel.type }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to save holiday.');
            }
            flash('success', `Saved as ${HOLIDAY_TYPE_LABELS[panel.type]}.`);
            setPanel(null);
            refetch();
        } catch (err) {
            flash('error', err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!panel?.holidayId) return;
        setSaving(true);
        try {
            const res = await fetchWithAuth(`/api/payroll/holidays/${panel.holidayId}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to remove holiday.');
            }
            flash('success', 'Holiday removed.');
            setPanel(null);
            refetch();
        } catch (err) {
            flash('error', err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const res = await fetchWithAuth('/api/payroll/holidays/generate', {
                method: 'POST',
                body: JSON.stringify({ year: genYear }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to generate holidays.');
            flash(
                'success',
                `${genYear}: added ${data.inserted_count} holiday${data.inserted_count === 1 ? '' : 's'}` +
                (data.skipped_existing ? `, ${data.skipped_existing} already existed.` : '.')
            );
            refetch();
        } catch (err) {
            flash('error', err.message);
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100/80">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-5 sm:mb-6">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                        <i className="ti ti-calendar-event text-lg"></i>
                    </div>
                    <div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-800">Holiday Calendar (DOLE)</h2>
                        <p className="text-[11px] sm:text-xs text-slate-400 font-medium">
                            Reference dates come from the public PH holidays calendar &mdash; classify each one to
                            drive payroll math.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        value={genYear}
                        onChange={(e) => setGenYear(Number(e.target.value))}
                        className="w-20 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 text-center outline-none focus:border-blue-500"
                    />
                    <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={generating}
                        className="px-3.5 py-2 bg-slate-900 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <i className="ti ti-wand text-sm"></i>
                        {generating ? 'Generating…' : 'Generate DOLE Holidays'}
                    </button>
                </div>
            </div>

            {!GOOGLE_CALENDAR_API_KEY && (
                <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl flex items-center gap-2">
                    <i className="ti ti-alert-triangle text-base shrink-0"></i>
                    Set <code className="font-mono bg-amber-100 px-1 rounded">VITE_GOOGLE_CALENDAR_API_KEY</code> to
                    layer in the official PH holidays reference calendar. Your own classified holidays still work
                    without it.
                </div>
            )}

            {toast && (
                <div
                    className={`mb-4 text-xs font-bold px-3.5 py-2.5 rounded-xl border ${toast.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-red-50 border-red-200 text-red-700'
                        }`}
                >
                    {toast.message}
                </div>
            )}

            {/* Legend, driven directly by the actual multiplier table so it can never go stale */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                {Object.values(HOLIDAY_TYPES).map((type) => (
                    <span
                        key={type}
                        className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border ${TYPE_STYLES[type].chip}`}
                    >
                        <span className={`w-2 h-2 rounded-full ${TYPE_STYLES[type].dot}`}></span>
                        {HOLIDAY_TYPE_LABELS[type]}
                        <span className="font-normal opacity-70">&middot; {multiplierSummary(type)}</span>
                    </span>
                ))}
                {GOOGLE_CALENDAR_API_KEY && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-slate-50 text-slate-500 border-slate-200">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        Unclassified reference date
                    </span>
                )}
            </div>

            <div className="holiday-fullcalendar-wrap">
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin, googleCalendarPlugin]}
                    initialView="dayGridMonth"
                    googleCalendarApiKey={GOOGLE_CALENDAR_API_KEY || undefined}
                    eventSources={eventSources}
                    height="auto"
                    dateClick={handleDateClick}
                    eventClick={handleEventClick}
                    headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
                    dayMaxEvents={3}
                />
            </div>

            {/* Classify / manage panel */}
            {panel && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div onClick={() => !saving && setPanel(null)} className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs" />
                    <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden z-10">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <h3 className="text-sm font-extrabold text-slate-800">
                                {panel.mode === 'classify' ? 'Classify Holiday' : 'Manage Holiday'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setPanel(null)}
                                className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
                            >
                                <i className="ti ti-x"></i>
                            </button>
                        </div>

                        <div className="p-4 sm:p-5 space-y-4">
                            <div className="text-xs font-bold text-blue-600 bg-blue-50 inline-block px-2.5 py-1 rounded-md">
                                {formatReadableDate(panel.date)}
                            </div>

                            {panel.mode === 'classify' ? (
                                <>
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                            Holiday name
                                        </label>
                                        <input
                                            type="text"
                                            value={panel.name}
                                            onChange={(e) => setPanel((p) => ({ ...p, name: e.target.value }))}
                                            placeholder="e.g. Ninoy Aquino Day"
                                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                            DOLE classification
                                        </label>
                                        <div className="space-y-1.5">
                                            {Object.values(HOLIDAY_TYPES).map((type) => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => setPanel((p) => ({ ...p, type }))}
                                                    className={`w-full text-left px-3.5 py-2.5 rounded-xl border flex items-center justify-between transition-colors cursor-pointer ${panel.type === type
                                                            ? `${TYPE_STYLES[type].chip} ring-2 ${TYPE_STYLES[type].ring}`
                                                            : 'bg-white border-slate-200 hover:bg-slate-50'
                                                        }`}
                                                >
                                                    <span className="text-xs font-bold text-slate-800">
                                                        {HOLIDAY_TYPE_LABELS[type]}
                                                    </span>
                                                    <span className="text-[10px] font-semibold text-slate-500">
                                                        {multiplierSummary(type)}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleSaveClassification}
                                        disabled={saving}
                                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {saving ? 'Saving…' : 'Save Classification'}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3">
                                        <div>
                                            <p className="text-sm font-bold text-slate-800">{panel.name}</p>
                                            <span
                                                className={`inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${TYPE_STYLES[panel.type]?.chip}`}
                                            >
                                                {HOLIDAY_TYPE_LABELS[panel.type]}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={saving}
                                        className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                                    >
                                        <i className="ti ti-trash text-sm"></i>
                                        {saving ? 'Removing…' : 'Remove Holiday'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}