import { useQuery } from '@tanstack/react-query';
import { isLeaveDate } from '../../../shared/leavePolicy.js';
import { fetchWithAuth } from '../utils/api';
import { getUser } from '../routes/guards';
import { readLeaveCreditResponse } from '../utils/useEmployeeLeaveCredits';
import LeaveDatePicker from './LeaveDatePicker';

const addDays = (date, count) => new Date(Date.parse(date) + count * 86400000).toISOString().slice(0, 10);
const coveredDates = periods => [...new Set(periods.flatMap(p => Array.from({ length: (Date.parse(p.to) - Date.parse(p.from)) / 86400000 + 1 }, (_, index) => addDays(p.from, index))))].sort();

export default function SilEvidencePeriodPicker({ employeeId, asOf, value, onChange, onPreview, loading = false }) {
    const actorId = getUser()?.id;
    const query = useQuery({
        queryKey: ['silValuationPeriods', actorId, employeeId, asOf],
        enabled: Boolean(actorId && employeeId), staleTime: 15000,
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({ employee_id: employeeId, as_of: asOf });
            const data = await readLeaveCreditResponse(await fetchWithAuth(`/api/leave-credits/valuation-periods?${params}`, { signal }));
            if (data?.employee_id !== employeeId || data.as_of !== asOf || !Array.isArray(data.periods) || data.periods.length > 60
                || data.periods.some(p => !isLeaveDate(p.from) || !isLeaveDate(p.to) || p.from > p.to || p.to > asOf || Date.parse(p.to) - Date.parse(p.from) > 6 * 86400000)) throw new Error('Invalid available payroll periods. Refresh before choosing dates.');
            return data;
        },
    });
    const periods = query.data?.periods || [];
    const dates = coveredDates(periods);
    const endLimit = value.reference_start ? addDays(value.reference_start, 365) : asOf;
    const endPeriods = periods.filter(p => (!value.reference_start || p.from >= value.reference_start) && p.to <= endLimit);
    const choose = (date, end) => {
        const period = periods.find(p => p.from <= date && p.to >= date);
        if (!period) return;
        if (end) onChange({ reference_start: value.reference_start || period.from, reference_end: period.to });
        else onChange({ reference_start: period.from, reference_end: value.reference_end && value.reference_end >= period.to && value.reference_end <= addDays(period.from, 365) ? value.reference_end : period.to });
    };
    return <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-ink-subtle">
            <span role="status">{query.isPending ? 'Finding saved payroll periods…' : query.isError ? 'Period lookup unavailable' : `${periods.length} saved payroll period(s)${query.data?.has_more ? ' · latest 60 shown' : ''}`}</span>
            <button type="button" disabled={query.isFetching} onClick={() => query.refetch()} className="shrink-0 font-semibold text-ink-muted hover:text-ink disabled:opacity-50 cursor-pointer transition-colors">Refresh periods</button>
        </div>
        {query.isError && <p role="alert" className="text-xs text-rose-700">{query.error.message}</p>}
        {!query.isPending && !query.isError && !periods.length && <p className="text-xs text-ink-subtle">No compatible saved payroll periods yet. Review payroll records or use an externally verified rate.</p>}
        {!query.isError && periods.length > 0 && onPreview && <div className="space-y-1">
            <button type="button" disabled={loading || query.isFetching} onClick={() => onPreview({ reference_start: periods[0].from, reference_end: periods[0].to })}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-muted disabled:opacity-50">
                Preview latest saved week
            </button>
            <p className="text-[11px] text-ink-subtle">Latest recorded week: {periods[0].from} to {periods[0].to}. This is a record preview, not a statutory averaging period.</p>
        </div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LeaveDatePicker label="Evidence period from" value={value.reference_start} onChange={date => choose(date, false)}
                availableDates={dates} availabilityLabel="saved payroll" showHolidays={false} inline min={dates[0]} max={dates.at(-1) || asOf} disabled={query.isPending || query.isError || !dates.length} />
            <LeaveDatePicker label="Evidence period to" value={value.reference_end} onChange={date => choose(date, true)}
                availableDates={coveredDates(endPeriods)} availabilityLabel="saved payroll" showHolidays={false} inline min={value.reference_start || dates[0]} max={dates.at(-1) || asOf} disabled={query.isPending || query.isError || !endPeriods.length} />
        </div>
        
    </div>;
}
