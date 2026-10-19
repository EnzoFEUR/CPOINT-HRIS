export const DEFAULT_REST_DAYS = Object.freeze([0, 6]);

export const WORK_POLICY_INPUT_LIMITS = Object.freeze({
    late_rate_per_minute: Object.freeze({ min: 0, max: 10000, step: 0.01 }),
    grace_period_minutes: Object.freeze({ min: 0, max: 1440, step: 1 }),
    call_time_hour: Object.freeze({ min: 0, max: 23, step: 1 }),
    call_time_minute: Object.freeze({ min: 0, max: 59, step: 1 }),
});

export function isValidWorkPolicyInput(name, raw) {
    const limits = WORK_POLICY_INPUT_LIMITS[name];
    if (!limits || !['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return false;
    if (typeof raw === 'string' && !/^\d+(?:\.\d{0,2})?$/.test(raw)) return false;
    const value = Number(raw);
    return Number.isFinite(value) && value >= limits.min && value <= limits.max
        && (limits.step === 1 ? Number.isInteger(value) : Math.abs(value * 100 - Math.round(value * 100)) < 1e-8);
}

export function getEmployeeRestDays(employee) {
    if (!Array.isArray(employee?.rest_days)) return [...DEFAULT_REST_DAYS];
    const days = employee.rest_days.map(Number);
    if (days.length > 6 || days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) throw new Error('Invalid employee rest days. HR must reconcile the schedule.');
    return days;
}

export function getWorkPolicy(source = {}) {
    const integer = (name, altName, fallback, max) => {
        const raw = source[name] !== undefined && source[name] !== '' ? source[name] : source[altName];
        if (raw === undefined || raw === '' || raw === null) return fallback;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`Invalid work policy configuration: ${name}.`);
        return value;
    };
    const number = (name, altName, fallback, max) => {
        const raw = source[name] !== undefined && source[name] !== '' ? source[name] : source[altName];
        if (raw === undefined || raw === '' || raw === null) return fallback;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`Invalid work policy configuration: ${name}.`);
        return value;
    };
    return Object.freeze({
        callTimeHour: integer('call_time_hour', 'CALL_TIME_HOUR', 8, WORK_POLICY_INPUT_LIMITS.call_time_hour.max),
        callTimeMinute: integer('call_time_minute', 'CALL_TIME_MINUTE', 0, WORK_POLICY_INPUT_LIMITS.call_time_minute.max),
        gracePeriodMinutes: integer('grace_period_minutes', 'GRACE_PERIOD_MINUTES', 15, WORK_POLICY_INPUT_LIMITS.grace_period_minutes.max),
        lateRatePerMinute: number('late_rate_per_minute', 'LATE_RATE_PER_MINUTE', 25, WORK_POLICY_INPUT_LIMITS.late_rate_per_minute.max),
        timeZone: 'Asia/Manila',
    });
}

export const DEFAULT_WORK_POLICY = getWorkPolicy();
export const getManilaWorkDate = (time = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
const isWorkDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

export function getScheduledWorkDates(startDate, endDate, restDays = DEFAULT_REST_DAYS) {
    if (!isWorkDate(startDate) || !isWorkDate(endDate) || endDate < startDate) throw new Error('Invalid attendance date range.');
    const dates = [];
    for (let time = Date.parse(startDate); time <= Date.parse(endDate); time += 86400000) {
        const date = new Date(time);
        if (!restDays.includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
}

export function getGraceDeadline(date, policy = DEFAULT_WORK_POLICY) {
    if (!isWorkDate(date)) throw new Error('Invalid attendance work date.');
    const hour = String(policy.callTimeHour).padStart(2, '0');
    const minute = String(policy.callTimeMinute).padStart(2, '0');
    return new Date(Date.parse(`${date}T${hour}:${minute}:00+08:00`) + policy.gracePeriodMinutes * 60000);
}

export function getChargeableLateMinutes(log, policy = DEFAULT_WORK_POLICY, restDays = DEFAULT_REST_DAYS) {
    if (!log?.time_in) return 0;
    if (typeof log.time_in !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(log.time_in) || !Number.isFinite(Date.parse(log.time_in))) throw new Error('Invalid attendance clock-in timestamp.');
    const date = log.date || getManilaWorkDate(log.time_in);
    const deadline = getGraceDeadline(date, policy).getTime();
    if (restDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) return 0;
    return Math.max(0, Math.floor((Date.parse(log.time_in) - deadline) / 60000));
}

export function calculateTardiness(logs, policy = DEFAULT_WORK_POLICY, restDays = DEFAULT_REST_DAYS) {
    const seen = new Set();
    let minutes = 0;
    for (const log of logs) {
        if (!log?.time_in) continue;
        const key = log.id ?? `${log.date || ''}:${log.time_in}`;
        if (seen.has(key)) continue;
        seen.add(key);
        minutes += getChargeableLateMinutes(log, policy, restDays);
    }
    return { minutes, deduction: minutes * policy.lateRatePerMinute };
}
