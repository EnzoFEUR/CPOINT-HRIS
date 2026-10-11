import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getManilaWorkDate } from '../../../shared/workPolicy.mjs';
import { isLeaveRestDay } from '../../../shared/leavePolicy.js';
import { fetchWithAuth } from '../utils/api';

export default function LeaveDatePicker({
    label,
    value,
    onChange,
    restDays = [],
    holidays = [],
    min,
    max,
    disabled = false,
    align = 'left',
    placeholder = 'Select date'
}) {
    const id = useId();
    const containerRef = useRef(null);
    const [isOpen, setIsOpen] = useState(false);

    // Initial month view defaults to current work date (today), clamped within [min, max]
    const initialMonth = () => {
        if (value) return value.slice(0, 7);
        const today = getManilaWorkDate();
        if (min && today < min) return min.slice(0, 7);
        if (max && today > max) return max.slice(0, 7);
        return today.slice(0, 7);
    };
    const [month, setMonth] = useState(initialMonth);

    useEffect(() => {
        if (value) setMonth(value.slice(0, 7));
    }, [value]);

    // Resilient fallback query if holidays prop is not provided directly
    const { data: fallbackHolidays = [] } = useQuery({
        queryKey: ['systemHolidaysList'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/leaves/holidays');
            const body = await res.json();
            return body.data || [];
        },
        staleTime: 5 * 60 * 1000,
        enabled: (!holidays || holidays.length === 0)
    });

    const activeHolidays = (holidays && holidays.length > 0) ? holidays : fallbackHolidays;

    const holidayMap = useMemo(() => {
        const map = new Map();
        if (Array.isArray(activeHolidays)) {
            for (const h of activeHolidays) {
                if (h?.date) map.set(h.date, h);
            }
        }
        return map;
    }, [activeHolidays]);

    // Close on outside click or Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleOutside = event => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = event => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    // Mutual exclusion: when any date picker opens, close other pickers
    useEffect(() => {
        const handleCloseOthers = event => {
            if (event.detail?.id !== id) {
                setIsOpen(false);
            }
        };
        window.addEventListener('close_date_pickers', handleCloseOthers);
        return () => window.removeEventListener('close_date_pickers', handleCloseOthers);
    }, [id]);

    const toggleOpen = () => {
        if (disabled) return;
        if (!isOpen) {
            window.dispatchEvent(new CustomEvent('close_date_pickers', { detail: { id } }));
            setMonth(initialMonth());
            setIsOpen(true);
        } else {
            setIsOpen(false);
        }
    };

    const first = new Date(`${month}-01T00:00:00Z`);
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const count = new Date(next.getTime() - 86400000).getUTCDate();

    const moveMonth = amount => {
        const date = new Date(`${month}-01T00:00:00Z`);
        date.setUTCMonth(date.getUTCMonth() + amount);
        setMonth(date.toISOString().slice(0, 7));
    };

    const todayStr = getManilaWorkDate();

    const formattedValue = value
        ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
              timeZone: 'UTC',
              month: 'short',
              day: 'numeric',
              year: 'numeric'
          })
        : placeholder;

    return (
        <div ref={containerRef} className="relative min-w-0">
            <span id={`${id}-label`} className="block text-xs font-semibold text-slate-700 mb-1">
                {label}
            </span>

            <button
                type="button"
                id={`${id}-trigger`}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-labelledby={`${id}-label ${id}-value`}
                disabled={disabled}
                onClick={toggleOpen}
                className={`w-full h-9 flex items-center justify-between rounded-md border bg-white px-3 text-xs transition-colors shadow-2xs select-none ${
                    disabled
                        ? 'opacity-50 cursor-not-allowed border-slate-200 text-slate-400'
                        : isOpen
                        ? 'border-accent ring-1 ring-accent text-slate-800'
                        : 'border-slate-200 hover:border-slate-300 text-slate-800'
                }`}
            >
                <span id={`${id}-value`} className={value ? 'font-semibold text-slate-800' : 'text-slate-400 font-normal'}>
                    {formattedValue}
                </span>
                <i className={`ti ti-calendar text-sm ${isOpen ? 'text-accent' : 'text-slate-400'}`} />
            </button>

            {isOpen && (
                <div
                    role="dialog"
                    aria-label={`${label} calendar`}
                    className={`absolute ${
                        align === 'right' ? 'right-0 sm:right-0 sm:left-auto' : 'left-0'
                    } mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100 select-none`}
                >
                    {/* Month Navigator Header */}
                    <div className="mb-2 flex items-center justify-between">
                        <button
                            type="button"
                            aria-label={`Previous month for ${label.toLowerCase()}`}
                            disabled={disabled || month <= (min?.slice(0, 7) || '0001-01')}
                            onClick={() => moveMonth(-1)}
                            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 disabled:opacity-20 transition-colors"
                        >
                            <i className="ti ti-chevron-left text-xs" />
                        </button>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-800">
                                {first.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
                            </span>
                            {month !== todayStr.slice(0, 7) && (
                                <button
                                    type="button"
                                    onClick={() => setMonth(todayStr.slice(0, 7))}
                                    className="px-1.5 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent-subtle rounded transition-colors"
                                    title="Jump to current month"
                                >
                                    Today
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            aria-label={`Next month for ${label.toLowerCase()}`}
                            disabled={disabled || month >= (max?.slice(0, 7) || '9999-12')}
                            onClick={() => moveMonth(1)}
                            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 disabled:opacity-20 transition-colors"
                        >
                            <i className="ti ti-chevron-right text-xs" />
                        </button>
                    </div>

                    {/* Day Headers */}
                    <div className="grid grid-cols-7 gap-1 text-center mb-1">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day, idx) => (
                            <span
                                key={day}
                                className={`text-[10px] font-bold uppercase ${
                                    idx === 0 || idx === 6 ? 'text-slate-300' : 'text-slate-400'
                                }`}
                            >
                                {day}
                            </span>
                        ))}
                    </div>

                    {/* Days Grid */}
                    <div className="grid grid-cols-7 gap-1 text-center">
                        {Array.from({ length: first.getUTCDay() }, (_, index) => (
                            <span key={`pad-${index}`} className="h-7 w-7" />
                        ))}
                        {Array.from({ length: count }, (_, index) => {
                            const date = `${month}-${String(index + 1).padStart(2, '0')}`;
                            const rest = isLeaveRestDay(date, restDays);
                            const holiday = holidayMap.get(date);
                            const isHoliday = Boolean(holiday);
                            const isToday = date === todayStr;
                            const unavailable = disabled || rest || Boolean(min && date < min) || Boolean(max && date > max);
                            const isSelected = date === value;

                            const tooltipText = isHoliday
                                ? `${holiday.name} (${holiday.type === 'regular' ? 'Regular Holiday' : 'Special Non-Working Holiday'})${rest ? ' • Rest Day' : ''}`
                                : rest
                                ? 'Rest day — non-working'
                                : isToday
                                ? `${date} (Today)`
                                : date;

                            return (
                                <button
                                    key={date}
                                    type="button"
                                    aria-label={`${date}${isHoliday ? ` (${holiday.name} Holiday)` : ''}${rest ? ' (rest day)' : ''}${isToday ? ' (today)' : ''}`}
                                    aria-pressed={isSelected}
                                    disabled={unavailable}
                                    title={tooltipText}
                                    onClick={() => {
                                        if (unavailable) return;
                                        onChange(date);
                                        setIsOpen(false);
                                    }}
                                    className={`relative h-7 w-7 mx-auto flex items-center justify-center rounded-md text-xs transition-colors ${
                                        isSelected
                                            ? 'bg-accent text-white font-bold shadow-2xs'
                                            : unavailable
                                            ? isHoliday
                                                ? 'cursor-not-allowed text-red-400 font-semibold opacity-60 hover:bg-transparent'
                                                : 'cursor-not-allowed text-slate-300 font-normal hover:bg-transparent'
                                            : isHoliday
                                            ? 'text-red-600 font-bold hover:bg-red-50 hover:text-red-700'
                                            : isToday
                                            ? 'text-slate-900 font-bold ring-1 ring-accent/60 bg-accent-subtle/20 hover:bg-slate-100'
                                            : 'text-slate-700 hover:bg-slate-100 font-semibold'
                                    }`}
                                >
                                    <span>{index + 1}</span>
                                    {isHoliday && (
                                        <span
                                            className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                                                isSelected ? 'bg-white' : 'bg-red-500'
                                            }`}
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Enterprise Mini-Legend Footer */}
                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-medium">
                        <div className="flex items-center gap-1.5" title="Statutory or Special Holidays">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                            <span className="text-red-600 font-semibold">Holiday</span>
                        </div>
                        <div className="flex items-center gap-1.5" title="Current Day">
                            <span className="w-1.5 h-1.5 rounded-full ring-1 ring-accent inline-block" />
                            <span className="text-slate-600">Today</span>
                        </div>
                        <div className="flex items-center gap-1.5" title="Scheduled Rest Days">
                            <span className="text-slate-300 font-bold">--</span>
                            <span className="text-slate-400">Rest Day</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
