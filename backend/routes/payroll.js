import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { createAuditLog } from './auditLogs.js';
import { createNotification } from './notifications.js';
import {
    toSafeNumber,
    round2,
    computeHolidayPayForPeriod,
    calculateMaternityDifferential,
    calculateStatutoryLeavePay,
    aggregate13thMonthPay,
} from '../utils/payrollCalculations.js';
import { getLeaveSummaryForPeriod } from '../utils/leaveUtils.js';

const router = express.Router();

// Statutory rates and caps with fallback defaults when configuration is unreachable
const DEFAULT_STATUTORY_SETTINGS = Object.freeze({
    sss_employee_rate: 5,
    sss_employer_rate: 10,
    sss_max_msc: 35000,
    philhealth_rate: 5,
    philhealth_min_salary: 10000,
    philhealth_max_salary: 100000,
    pagibig_employee_rate: 2,
    pagibig_employer_rate: 2,
    pagibig_max_contribution: 200,
});

let statutorySettingsCache = null;
let statutorySettingsCacheExpires = 0;

export const invalidateStatutorySettingsCache = () => {
    statutorySettingsCache = null;
    statutorySettingsCacheExpires = 0;
};

const getStatutorySettings = async () => {
    const now = Date.now();
    if (statutorySettingsCache && now < statutorySettingsCacheExpires) {
        return statutorySettingsCache;
    }

    const merged = { ...DEFAULT_STATUTORY_SETTINGS };
    try {
        const { data, error } = await supabase
            .from('statutory_settings')
            .select('*')
            .limit(1)
            .maybeSingle();
        if (!error && data) {
            for (const key of Object.keys(DEFAULT_STATUTORY_SETTINGS)) {
                const raw = data[key];
                if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
                    merged[key] = Number(raw);
                }
            }
        }
    } catch (err) {
        console.error('Failed to load statutory settings, using defaults:', err.message);
    }
    statutorySettingsCache = merged;
    statutorySettingsCacheExpires = now + 60000; // 60-second in-memory cache
    return merged;
};

// Optional breakdown columns: gracefully fallback and omit unmigrated schema columns without failing
const OPTIONAL_PAYROLL_COLUMNS = [
    'holiday_pay',
    'holiday_breakdown',
    'sss_deduction',
    'philhealth_deduction',
    'pagibig_deduction',
    'tax_deduction',
];

const insertPayrollRow = async (payload) => {
    const row = { ...payload };
    for (let attempt = 0; attempt <= OPTIONAL_PAYROLL_COLUMNS.length; attempt++) {
        const { data, error } = await supabase.from('payrolls').insert(row).select('id').maybeSingle();
        if (!error) return { data, error: null };
        const missing = OPTIONAL_PAYROLL_COLUMNS.find((col) => col in row && error.message?.includes(col));
        if (!missing) return { data: null, error };
        delete row[missing];
    }
    return { data: null, error: new Error('Payroll insert failed after removing optional columns.') };
};

// Weekly cutoff span constraint: enforces strict calendar day bounds (maximum 7 days)
const MAX_WEEKLY_CUTOFF_DAYS = 7;
const getCutoffSpanDays = (start, end) => {
    const s = new Date(`${String(start).substring(0, 10)}T00:00:00`);
    const e = new Date(`${String(end).substring(0, 10)}T00:00:00`);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
};

// DOLE Art. 94 holiday-pay eligibility looks at the workday before a holiday (lookback window)
const HOLIDAY_LOOKBACK_DAYS = 7;

const shiftDateStr = (dateStr, days) => {
    const d = new Date(`${String(dateStr).substring(0, 10)}T00:00:00`);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const getRecordDateKey = (log) => {
    const raw = log?.date || (typeof log?.time_in === 'string' ? log.time_in.split('T')[0] : '');
    return String(raw || '').substring(0, 10);
};

// Expands approved PAID leave records (start_date..end_date) into individual YYYY-MM-DD dates.
const getPaidLeaveDates = (leaveRecords = []) => {
    const dates = new Set();
    for (const leave of leaveRecords || []) {
        if (!leave || !leave.is_paid || !leave.start_date || !leave.end_date) continue;
        let cursor = String(leave.start_date).substring(0, 10);
        const end = String(leave.end_date).substring(0, 10);
        for (let i = 0; i < 62 && cursor <= end; i++) {
            dates.add(cursor);
            cursor = shiftDateStr(cursor, 1);
        }
    }
    return Array.from(dates);
};

const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

// ==============================================================================
// Enterprise Low-Latency Real-Time Broadcast Bus (<5ms Execution Overhead)
// Synchronizes Admin Ledger, Employee Dashboards, and Live Payslip Views
// ==============================================================================
class PayrollRealtimeManager {
    constructor(client, maxPooledChannels = 150) {
        this.client = client;
        this.maxPooledChannels = maxPooledChannels;
        this.channels = new Map();

        // Pre-warm mission-critical persistent channels
        this.staticTopics = [
            'payroll_realtime_sync',
            'admin-live-payroll-ledger',
            'admin-dashboard-realtime',
            'dashboard-realtime'
        ];
        this.staticTopics.forEach(t => this.getOrSubscribe(t));
    }

    getOrSubscribe(topic) {
        if (this.channels.has(topic)) {
            return this.channels.get(topic);
        }

        // Bounded LRU eviction to prevent channel leaks
        if (this.channels.size >= this.maxPooledChannels) {
            for (const key of this.channels.keys()) {
                if (!this.staticTopics.includes(key)) {
                    const stale = this.channels.get(key);
                    try { this.client.removeChannel(stale.ch); } catch (_) { }
                    this.channels.delete(key);
                    break;
                }
            }
        }

        const ch = this.client.channel(topic);
        let resolveSub;
        const subPromise = new Promise(resolve => { resolveSub = resolve; });

        const entry = {
            ch,
            isSubscribed: false,
            subPromise
        };

        ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                entry.isSubscribed = true;
                resolveSub(true);
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                entry.isSubscribed = false;
                resolveSub(false);
            }
        });

        this.channels.set(topic, entry);
        return entry;
    }

    async sendToTopic(topic, event, payload) {
        try {
            const entry = this.getOrSubscribe(topic);
            if (!entry.isSubscribed) {
                await Promise.race([
                    entry.subPromise,
                    new Promise(r => setTimeout(r, 350))
                ]);
            }
            return await entry.ch.send({
                type: 'broadcast',
                event,
                payload
            });
        } catch (_) {
            return 'error';
        }
    }

    dispatch(event, payload = {}) {
        const enrichedPayload = { ...payload, broadcast_timestamp: new Date().toISOString() };
        const topics = new Set(this.staticTopics);

        const empIds = Array.isArray(payload.employee_ids)
            ? payload.employee_ids
            : (payload.employee_id ? [payload.employee_id] : []);

        empIds.forEach(id => {
            if (id) {
                topics.add(`employee-live-dashboard-${id}`);
                topics.add(`myprofile-realtime-${id}`);
            }
        });

        const payrollIds = Array.isArray(payload.payroll_ids)
            ? payload.payroll_ids
            : (payload.id ? [payload.id] : []);

        payrollIds.forEach(id => {
            if (id) topics.add(`payslip-live-${id}`);
        });

        // Non-blocking fire-and-forget dispatch
        topics.forEach(t => {
            this.sendToTopic(t, event, enrichedPayload).catch(() => { });
        });
    }
}

const realtimeManager = new PayrollRealtimeManager(supabase);

export function broadcastPayrollUpdate(event, payload = {}) {
    realtimeManager.dispatch(event, payload);
}

const normalizeDateRange = (d1, d2) => {
    if (!d1 || !d2) return { start: d1 || d2, end: d2 || d1 };
    return d1 <= d2 ? { start: d1, end: d2 } : { start: d2, end: d1 };
};

const getEffectiveMonthlySalary = (employee) => {
    if (!employee) return 0;

    const dailyRate = toSafeNumber(employee.daily_rate || employee.daily_pay);
    if (dailyRate > 0) return dailyRate * 26;

    const hourlyRate = toSafeNumber(employee.hourly_rate);
    if (hourlyRate > 0) return hourlyRate * 8 * 26;

    const salary = toSafeNumber(employee.salary || employee.monthly_salary);
    if (salary > 0) return salary;

    const pieceRate = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
    if (pieceRate > 0) return pieceRate * 8 * 26;

    return 0;
};

/**
 * Helper: Computes BIR Withholding Tax under TRAIN Law (Weekly / Semi-Monthly / Monthly Brackets)
 * Reference: BIR Revised Withholding Tax Table under RA 10963 (TRAIN Law)
 */
const calculateBIRWithholdingTax = (taxableIncome, frequency = 'weekly') => {
    const taxable = Math.max(0, toSafeNumber(taxableIncome));

    if (frequency === 'weekly') {
        // BIR Revised Withholding Tax Table - WEEKLY
        // Bracket 1: <= ₱4,807.69 (Annual <= P250,000 / 52) -> 0% Tax
        if (taxable <= 4807.69) return 0;
        // Bracket 2: ₱4,807.70 to ₱7,692.30 -> 15% of excess over ₱4,807.69
        if (taxable <= 7692.30) return round2((taxable - 4807.69) * 0.15);
        // Bracket 3: ₱7,692.31 to ₱15,384.61 -> ₱432.69 + 20% of excess over ₱7,692.31
        if (taxable <= 15384.61) return round2(432.69 + (taxable - 7692.31) * 0.20);
        // Bracket 4: ₱15,384.62 to ₱38,461.53 -> ₱1,971.15 + 25% of excess over ₱15,384.62
        if (taxable <= 38461.53) return round2(1971.15 + (taxable - 15384.62) * 0.25);
        // Bracket 5: ₱38,461.54 to ₱153,846.15 -> ₱7,740.38 + 30% of excess over ₱38,461.54
        if (taxable <= 153846.15) return round2(7740.38 + (taxable - 38461.54) * 0.30);
        // Bracket 6: > ₱153,846.15 -> ₱42,355.77 + 35% of excess over ₱153,846.15
        return round2(42355.77 + (taxable - 153846.15) * 0.35);
    } else if (frequency === 'semi-monthly') {
        // BIR Revised Withholding Tax Table - SEMI-MONTHLY
        if (taxable <= 10416.67) return 0;
        if (taxable <= 16666.67) return round2((taxable - 10416.67) * 0.15);
        if (taxable <= 33333.33) return round2(937.50 + (taxable - 16666.67) * 0.20);
        if (taxable <= 83333.33) return round2(4270.83 + (taxable - 33333.33) * 0.25);
        if (taxable <= 333333.33) return round2(16770.83 + (taxable - 83333.33) * 0.30);
        return round2(91770.83 + (taxable - 333333.33) * 0.35);
    } else {
        // BIR Revised Withholding Tax Table - MONTHLY
        if (taxable <= 20833.33) return 0;
        if (taxable <= 33333.33) return round2((taxable - 20833.33) * 0.15);
        if (taxable <= 66666.67) return round2(1875.00 + (taxable - 33333.33) * 0.20);
        if (taxable <= 166666.67) return round2(8541.67 + (taxable - 66666.67) * 0.25);
        if (taxable <= 666666.67) return round2(33541.67 + (taxable - 166666.67) * 0.30);
        return round2(183541.67 + (taxable - 666666.67) * 0.35);
    }
};

/**
 * Helper: Fetches HR-approved paid leave applications for an employee within a date range.
 * Automatically overrides missing attendance logs by awarding full day pay for approved paid leaves.
 */
const fetchApprovedPaidLeaves = async (employeeId, start, end) => {
    try {
        const summary = await getLeaveSummaryForPeriod({
            employeeId,
            periodStart: start,
            periodEnd: end
        });

        return {
            totalPaidLeaveDays: summary.paid_leave_days || 0,
            leaveRecords: summary.leaves || []
        };
    } catch (err) {
        console.error('Error fetching approved paid leaves:', err);
        return { totalPaidLeaveDays: 0, leaveRecords: [] };
    }
};

// 1. Statutory settings
router.get('/statutory-settings', cacheResponse(20), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('statutory_settings')
            .select('*')
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        res.json(data || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/statutory-settings', async (req, res) => {
    try {
        const { admin_id: bodyAdminId, ...cleanSettings } = req.body || {};
        const admin_id = bodyAdminId || req.user?.id || null;

        const { data: existing } = await supabase
            .from('statutory_settings')
            .select('id')
            .limit(1)
            .maybeSingle();

        let error;
        if (existing) {
            ({ error } = await supabase
                .from('statutory_settings')
                .update(cleanSettings)
                .eq('id', existing.id));
        } else {
            ({ error } = await supabase
                .from('statutory_settings')
                .insert([cleanSettings]));
        }

        if (error) throw error;

        invalidateStatutorySettingsCache();
        invalidateCache(['/api/payroll/statutory-settings']);
        broadcastPayrollUpdate('STATUTORY_SETTINGS_UPDATED', { admin_id, settings: cleanSettings });
        res.json({ success: true, message: 'Statutory settings updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Holidays
router.get('/holidays', cacheResponse(60), async (req, res) => {
    try {
        let query = supabase.from('holidays').select('*').order('date', { ascending: true });

        const rawStart = req.query.start || req.query.start_date;
        const rawEnd = req.query.end || req.query.end_date;

        if (rawStart && rawEnd) {
            const { start, end } = normalizeDateRange(rawStart, rawEnd);
            query = query.gte('date', start).lte('date', end);
        } else if (rawStart) {
            query = query.gte('date', rawStart);
        } else if (rawEnd) {
            query = query.lte('date', rawEnd);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/holidays', async (req, res) => {
    try {
        const { name, date, type } = req.body;
        if (!name || !date || !type) {
            return res.status(400).json({ error: 'name, date, and type are required.' });
        }

        const { data, error } = await supabase
            .from('holidays')
            .insert([{ name, date, type }])
            .select()
            .single();

        if (error) throw error;

        invalidateCache(['/api/payroll/holidays']);
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/holidays/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const isNumericId = !isNaN(Number(id));
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

        if (!isNumericId && !isUUID) {
            return res.status(400).json({ error: 'Invalid holiday ID format.' });
        }

        const { error } = await supabase.from('holidays').delete().eq('id', id);
        if (error) throw error;

        invalidateCache(['/api/payroll/holidays']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==============================================================================
// 2b. Auto-Generate Deterministic Holidays for a Given Year
//     (fixed-date holidays, National Heroes Day rule, Easter-based Holy Week,
//     and looked-up Chinese New Year. Eidul Fitr / Eidul Adha are intentionally
//     excluded - those are set by NCMF proclamation via moon sighting, not a
//     fixed calendar rule, and must still be added manually each year.)
// ==============================================================================

// Meeus/Jones/Butcher algorithm - computes Easter Sunday for a Gregorian year
function getEasterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function toDateStr(d) {
    return d.toISOString().substring(0, 10);
}

function getLastMondayOfAugust(year) {
    const lastDayOfAug = new Date(Date.UTC(year, 8, 0)); // day 0 of Sept = last day of Aug
    const dow = lastDayOfAug.getUTCDay(); // 0 = Sun ... 6 = Sat
    const diffToMonday = (dow + 6) % 7;
    return addDays(lastDayOfAug, -diffToMonday);
}

// Published Chinese New Year (Spring Festival) dates. These follow the lunisolar
// calendar and cannot be derived by formula, but the dates are published by
// astronomical almanacs years in advance, so a lookup table is reliable.
const CHINESE_NEW_YEAR_DATES = {
    2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26',
    2029: '2029-02-13', 2030: '2030-02-03', 2031: '2031-01-23', 2032: '2032-02-11',
    2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08', 2036: '2036-01-28'
};

function generateDeterministicHolidays(year) {
    const easter = getEasterSunday(year);
    const maundyThursday = toDateStr(addDays(easter, -3));
    const goodFriday = toDateStr(addDays(easter, -2));
    const blackSaturday = toDateStr(addDays(easter, -1));

    const holidays = [
        // A. Regular Holidays
        { name: "New Year's Day", date: `${year}-01-01`, type: 'regular' },
        { name: 'Maundy Thursday', date: maundyThursday, type: 'regular' },
        { name: 'Good Friday', date: goodFriday, type: 'regular' },
        { name: 'Araw ng Kagitingan', date: `${year}-04-09`, type: 'regular' },
        { name: 'Labor Day', date: `${year}-05-01`, type: 'regular' },
        { name: 'Independence Day', date: `${year}-06-12`, type: 'regular' },
        { name: 'National Heroes Day', date: toDateStr(getLastMondayOfAugust(year)), type: 'regular' },
        { name: 'Bonifacio Day', date: `${year}-11-30`, type: 'regular' },
        { name: 'Christmas Day', date: `${year}-12-25`, type: 'regular' },
        { name: 'Rizal Day', date: `${year}-12-30`, type: 'regular' },

        // B. Special (Non-Working) Days
        { name: 'Ninoy Aquino Day', date: `${year}-08-21`, type: 'special_non_working' },
        { name: "All Saints' Day", date: `${year}-11-01`, type: 'special_non_working' },
        { name: 'Feast of the Immaculate Conception of Mary', date: `${year}-12-08`, type: 'special_non_working' },
        { name: 'Last Day of the Year', date: `${year}-12-31`, type: 'special_non_working' },
        { name: 'Black Saturday', date: blackSaturday, type: 'special_non_working' },
        { name: "All Souls' Day", date: `${year}-11-02`, type: 'special_non_working' },
        { name: 'Christmas Eve', date: `${year}-12-24`, type: 'special_non_working' },

        // C. Special (Working) Day
        { name: 'EDSA People Power Revolution Anniversary', date: `${year}-02-25`, type: 'special_working' }
    ];

    if (CHINESE_NEW_YEAR_DATES[year]) {
        holidays.push({ name: 'Chinese New Year', date: CHINESE_NEW_YEAR_DATES[year], type: 'special_non_working' });
    }

    return holidays;
}

// Read-only status check — deliberately does NOT call ensureHolidaysGeneratedForRange.
// The frontend uses this to show HR an explicit "Generate Holidays" reminder the first
// time a year is touched, before the silent auto-generation safety net (wired into
// /preview, GET /holidays, and POST /) has a chance to fill it in behind the scenes.
router.get('/holidays/status', async (req, res) => {
    try {
        const year = parseInt(req.query.year, 10);
        if (!year || year < 2020 || year > 2100) {
            return res.status(400).json({ error: 'A valid year is required.' });
        }

        const { count, error } = await supabase
            .from('holidays')
            .select('id', { count: 'exact', head: true })
            .gte('date', `${year}-01-01`)
            .lte('date', `${year}-12-31`);

        if (error) throw error;

        res.json({ year, generated: (count || 0) > 0, count: count || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==============================================================================
// 2c. Last-resort auto-generation
//     This ONLY runs at the moment a payroll is actually saved (POST /), not
//     while browsing, previewing, or loading the calendar. Those read paths
//     used to also silently trigger this, but that caused a real bug: two
//     concurrent requests (the holiday-rate preview and the explicit status
//     check) could race each other, with the status check reading the table
//     a moment before the preview's silent insert committed — showing HR a
//     "not generated yet" banner and an "Active +X% rate" banner at the same
//     time, for the same year. Now the ONLY ways a year's holidays get
//     created are: (1) HR explicitly clicking "Generate Holidays", or (2)
//     this function, as a final safety net so payroll math is never silently
//     wrong even if that click was skipped somehow.
//
//     Uses an in-flight promise per year (not just a "done" flag) so that if
//     two payroll saves for the same never-generated year land at nearly the
//     same instant, the second one awaits the first's actual insert instead
//     of racing it and creating a duplicate set of holiday rows.
// ==============================================================================
const yearGenerationState = new Map(); // year -> 'done' | Promise

async function ensureHolidaysGeneratedForRange(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return;

    const startYear = parseInt(String(startDateStr).substring(0, 4), 10);
    const endYear = parseInt(String(endDateStr).substring(0, 4), 10);
    if (!startYear || !endYear) return;

    for (let year = startYear; year <= endYear; year++) {
        if (year < 2020 || year > 2100) continue;

        const existingState = yearGenerationState.get(year);
        if (existingState === 'done') continue;
        if (existingState instanceof Promise) {
            await existingState; // another concurrent call is already generating this year - wait for it, don't race it
            continue;
        }

        const generationPromise = (async () => {
            try {
                const { data: existingRows, error: checkError } = await supabase
                    .from('holidays')
                    .select('date')
                    .gte('date', `${year}-01-01`)
                    .lte('date', `${year}-12-31`)
                    .limit(1);

                if (checkError) throw checkError;

                if (existingRows && existingRows.length > 0) {
                    yearGenerationState.set(year, 'done');
                    return;
                }

                const candidates = generateDeterministicHolidays(year);
                const { error: insertError } = await supabase.from('holidays').insert(candidates);
                if (insertError) throw insertError;

                yearGenerationState.set(year, 'done');
                invalidateCache(['/api/payroll/holidays']);
                console.log(`[Holidays] Auto-generated ${candidates.length} DOLE holidays for ${year} (payroll save safety net).`);
            } catch (err) {
                // Never let this break the payroll save it's supporting - worst case,
                // that save just proceeds with whatever holidays already exist.
                yearGenerationState.delete(year); // allow a future attempt to retry, instead of getting stuck
                console.error(`[Holidays] Auto-generation failed for ${year}:`, err.message);
            }
        })();

        yearGenerationState.set(year, generationPromise);
        await generationPromise;
    }
}

router.post('/holidays/generate', async (req, res) => {
    try {
        const year = parseInt(req.body.year, 10);
        if (!year || year < 2020 || year > 2100) {
            return res.status(400).json({ error: 'A valid year is required.' });
        }

        const candidates = generateDeterministicHolidays(year);
        const cnyMissing = !CHINESE_NEW_YEAR_DATES[year];

        const { data: existingRows } = await supabase
            .from('holidays')
            .select('date, name')
            .gte('date', `${year}-01-01`)
            .lte('date', `${year}-12-31`);

        const existingSet = new Set((existingRows || []).map(r => `${r.date}__${r.name}`));
        const toInsert = candidates.filter(h => !existingSet.has(`${h.date}__${h.name}`));

        let inserted = [];
        if (toInsert.length > 0) {
            const { data, error } = await supabase.from('holidays').insert(toInsert).select();
            if (error) throw error;
            inserted = data;
        }

        invalidateCache(['/api/payroll/holidays']);

        res.json({
            success: true,
            year,
            inserted_count: inserted.length,
            inserted,
            skipped_existing: candidates.length - toInsert.length,
            chinese_new_year_generated: !cnyMissing,
            reminder: cnyMissing
                ? `Chinese New Year was NOT generated - ${year} isn't in the lookup table (only 2025-2036 are covered). Add it manually once you have the published date, and add it to CHINESE_NEW_YEAR_DATES for next time. Eidul Fitr and Eidul Adha were also NOT generated - those are set by NCMF proclamation based on moon sighting, not a fixed formula.`
                : 'Eidul Fitr and Eidul Adha were NOT generated - those are set by NCMF proclamation based on moon sighting, not a fixed formula. Add them manually once the annual proclamation confirms the date.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. 13th month pay
router.get('/13th-month/:employee_id', async (req, res) => {
    try {
        const { employee_id } = req.params;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();

        const { data: records, error } = await supabase
            .from('payrolls')
            .select('basic_pay, period_start, remarks')
            .eq('employee_id', employee_id)
            .gte('period_start', `${year}-01-01`)
            .lte('period_start', `${year}-12-31`);

        if (error) throw error;

        const result = aggregate13thMonthPay(records || []);
        res.json({ employee_id, year, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Holiday and payroll preview
router.post('/preview', async (req, res) => {
    try {
        const { employee_id, period_start, period_end } = req.body;
        if (!period_start || !period_end) {
            return res.status(400).json({ error: 'period_start and period_end are required.' });
        }

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        // Fetch holiday calendar for the period
        const { data: holidayList } = await supabase
            .from('holidays')
            .select('*')
            .gte('date', pStart)
            .lte('date', pEnd)
            .order('date', { ascending: true });

        // If no employee_id provided (e.g. batch mode or initial page load), return holiday calendar
        if (!employee_id) {
            const genericItems = (holidayList || []).map(h => ({
                date: h.date,
                holidayName: h.name,
                holidayType: h.type || 'regular',
                pay: 0
            }));
            return res.json({
                items: genericItems,
                totalHolidayPay: 0,
                approvedPaidLeaveDays: 0,
                paidLeaveRecords: [],
                isFactoryWorker: false,
                canOvertime: false
            });
        }

        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .maybeSingle();

        if (!employee) {
            const genericItems = (holidayList || []).map(h => ({
                date: h.date,
                holidayName: h.name,
                holidayType: h.type || 'regular',
                pay: 0
            }));
            return res.json({
                items: genericItems,
                totalHolidayPay: 0,
                approvedPaidLeaveDays: 0,
                paidLeaveRecords: [],
                isFactoryWorker: false,
                canOvertime: false
            });
        }

        const effectiveMonthlySalary = getEffectiveMonthlySalary(employee);
        if (effectiveMonthlySalary <= 0) {
            const genericItems = (holidayList || []).map(h => ({
                date: h.date,
                holidayName: h.name,
                holidayType: h.type || 'regular',
                pay: 0
            }));
            return res.json({
                items: genericItems,
                totalHolidayPay: 0,
                approvedPaidLeaveDays: 0,
                paidLeaveRecords: [],
                isFactoryWorker: false,
                canOvertime: false
            });
        }

        const lookbackStart = shiftDateStr(pStart, -HOLIDAY_LOOKBACK_DAYS);
        const [
            { data: allAttendanceLogs },
            paidLeaveInfo,
            lookbackLeaveInfo,
            { data: lookbackHolidays }
        ] = await Promise.all([
            supabase
                .from('attendances')
                .select('*')
                .eq('employee_id', employee_id)
                .gte('date', lookbackStart)
                .lte('date', pEnd),
            fetchApprovedPaidLeaves(employee_id, pStart, pEnd),
            fetchApprovedPaidLeaves(employee_id, lookbackStart, pEnd),
            supabase.from('holidays').select('*').gte('date', lookbackStart).lte('date', pEnd)
        ]);
        // Period-only view for display; the wider lookback set is used for holiday eligibility only.
        const attendanceLogs = (allAttendanceLogs || []).filter(l => getRecordDateKey(l) >= pStart);
        const paidLeaveDates = getPaidLeaveDates(lookbackLeaveInfo?.leaveRecords);

        const restDays = Array.isArray(employee?.rest_days) && employee.rest_days.length
            ? employee.rest_days
            : [0];

        const empDept = (employee?.department || '').toLowerCase();
        const empShift = (employee?.shift || '').toLowerCase();
        const isFactoryWorker = empDept.includes('factory') || empShift.includes('factory');

        const preview = computeHolidayPayForPeriod({
            periodStart: pStart,
            periodEnd: pEnd,
            monthlySalary: effectiveMonthlySalary,
            holidayList: lookbackHolidays || holidayList || [],
            attendanceLogs: allAttendanceLogs || [],
            paidLeaveDates,
            restDays,
            canOvertime: !isFactoryWorker,
            // Keep the preview identical to what the saved payroll will pay.
            salaryIncludesHolidayPay: !isFactoryWorker,
            // Contractual rates are applied directly without synthetic monthly inflation
            dailyRate: toSafeNumber(employee.daily_rate || employee.daily_pay),
            hourlyRate: toSafeNumber(employee.hourly_rate),
        });

        res.json({
            ...preview,
            approvedPaidLeaveDays: paidLeaveInfo.totalPaidLeaveDays,
            paidLeaveRecords: paidLeaveInfo.leaveRecords,
            isFactoryWorker,
            canOvertime: !isFactoryWorker,
            policyNotice: isFactoryWorker
                ? 'Factory Worker: Fixed schedule 8:00 AM - 5:00 PM. Overtime prohibited per HR policy.'
                : 'Regular Worker: Fixed schedule. Overtime eligible.'
        });
    } catch (err) {
        console.error('Payroll preview error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5. Compute and save payroll
router.get('/', cacheResponse(20), async (req, res) => {
    try {
        let query = supabase.from('payrolls').select('*, employees:employee_id(*)').order('created_at', { ascending: false });

        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }

        if (req.query.month) {
            const year = req.query.year || new Date().getFullYear();
            const monthStr = req.query.month.padStart(2, '0');
            query = query.gte('period_start', `${year}-${monthStr}-01`);
        }

        if (req.query.limit) {
            const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            query = query.limit(limitNum);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const {
            employee_id,
            period_start,
            period_end,
            overtime_hours,
            regular_ot_hours,
            regular_holiday_ot_hours,
            special_holiday_ot_hours,
            late_deductions,
            late_minutes,
            working_days_in_year,
            sss_cash_benefit,
            maternity_leave_days,
            paternity_days,
            solo_parent_days,
            sil_days,
            pieces_produced,
            admin_id,
            apply_deductions,
            deduction_timing,
            pay_frequency = 'weekly' // Options: 'weekly' | 'semi-monthly' | 'monthly'
        } = req.body;

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        if (pay_frequency === 'weekly' && getCutoffSpanDays(pStart, pEnd) > MAX_WEEKLY_CUTOFF_DAYS) {
            return res.status(400).json({
                error: `Weekly payroll cutoff cannot exceed ${MAX_WEEKLY_CUTOFF_DAYS} days (received ${getCutoffSpanDays(pStart, pEnd)}).`
            });
        }

        const { data: existing } = await supabase
            .from('payrolls')
            .select('id')
            .eq('employee_id', employee_id)
            .eq('period_start', pStart)
            .eq('period_end', pEnd)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: 'A payslip for this employee in this pay period already exists.' });
        }

        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .single();

        if (!employee) {
            return res.status(400).json({ error: 'Employee not found.' });
        }

        const { data: terminationLog } = await supabase
            .from('disciplinary_logs')
            .select('id, date, reason')
            .eq('employee_id', employee_id)
            .eq('type', 'Termination')
            .maybeSingle();

        if (terminationLog) {
            return res.status(400).json({
                error: `Standard payroll cannot be processed for separated/terminated personnel (Terminated on ${terminationLog.date}). Use Final Pay / Clearance processing.`
            });
        }

        const department = (employee.department || '').toLowerCase();
        const shiftStr = (employee.shift || '').toLowerCase();
        const isFactory = department.includes('factory') || shiftStr.includes('factory');
        const effectiveMonthlySalary = getEffectiveMonthlySalary(employee);

        if (effectiveMonthlySalary <= 0 && !isFactory) {
            return res.status(400).json({ error: 'Cannot compute payroll: Employee has no salary, daily rate, or piece rate set.' });
        }

        // DOLE Standard Base Rate Formulas: Preserve contractual daily/hourly rates if present
        const empDailyRate = toSafeNumber(employee.daily_rate || employee.daily_pay);
        const annualWorkDays = toSafeNumber(working_days_in_year) || 261;
        const dailyRate = empDailyRate > 0 ? empDailyRate : round2((effectiveMonthlySalary * 12) / annualWorkDays);
        const empHourlyRate = toSafeNumber(employee.hourly_rate);
        const hourlyRate = empHourlyRate > 0 ? empHourlyRate : round2(dailyRate / 8);
        const weeklySalary = empDailyRate > 0 ? round2(empDailyRate * 6) : round2((effectiveMonthlySalary * 12) / 52);

        let basicPay = 0;
        if (isFactory) {
            const pieceRate = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
            basicPay = round2(toSafeNumber(pieces_produced) * pieceRate);
        } else {
            basicPay = weeklySalary;
        }

        // Fetch Holidays, Attendances, HR-Approved Paid Leaves, and Suspensions in parallel
        const lookbackStart = shiftDateStr(pStart, -HOLIDAY_LOOKBACK_DAYS);
        await ensureHolidaysGeneratedForRange(lookbackStart, pEnd);
        const [
            { data: allHolidays },
            { data: allAttendanceLogs },
            paidLeaveInfo,
            lookbackLeaveInfo,
            { data: suspensionLogs }
        ] = await Promise.all([
            supabase.from('holidays').select('*').gte('date', lookbackStart).lte('date', pEnd),
            supabase
                .from('attendances')
                .select('*')
                .eq('employee_id', employee_id)
                .gte('date', lookbackStart)
                .lte('date', pEnd),
            fetchApprovedPaidLeaves(employee_id, pStart, pEnd),
            fetchApprovedPaidLeaves(employee_id, lookbackStart, pEnd),
            supabase
                .from('disciplinary_logs')
                .select('id, date, reason, status')
                .eq('employee_id', employee_id)
                .eq('type', 'Suspension')
        ]);

        // Period-only views drive absences, lateness and the holiday list; the wider lookback set
        // (allHolidays / allAttendanceLogs / paidLeaveDates) is only used for holiday eligibility.
        const holidayList = (allHolidays || []).filter(h => h?.date && String(h.date).substring(0, 10) >= pStart);
        const attendanceLogs = (allAttendanceLogs || []).filter(l => getRecordDateKey(l) >= pStart);
        const paidLeaveDates = getPaidLeaveDates(lookbackLeaveInfo?.leaveRecords);

        const restDays = Array.isArray(employee.rest_days) && employee.rest_days.length
            ? employee.rest_days
            : [0];

        // Holiday pay is computed BEFORE the absence step so the absence step can see which
        // Regular Holidays were forfeited under DOLE Art. 94 (see forfeitedHolidayDates below).
        const { items: holidayBreakdown, totalHolidayPay } = computeHolidayPayForPeriod({
            periodStart: pStart,
            periodEnd: pEnd,
            monthlySalary: effectiveMonthlySalary,
            holidayList: allHolidays || [],
            attendanceLogs: allAttendanceLogs || [],
            paidLeaveDates,
            restDays,
            canOvertime: !isFactory,
            // Non-factory staff are paid a fixed weekly salary that already covers a normal workday.
            salaryIncludesHolidayPay: !isFactory,
            // Contractual daily and hourly rates take precedence to preserve exact compensation terms
            dailyRate,
            hourlyRate,
        });

        // Absence Deduction for Non-Factory Personnel under DOLE "No Work, No Pay" Principle
        let absenceDeduction = 0;
        let absenceNote = '';

        if (!isFactory) {
            const approvedPaidLeaveDays = paidLeaveInfo?.totalPaidLeaveDays || 0;
            const completedAttendanceDates = new Set();
            (attendanceLogs || []).forEach(log => {
                if (log && log.time_in && log.time_out) {
                    const d = log.date || (typeof log.time_in === 'string' ? log.time_in.split('T')[0] : null);
                    if (d) completedAttendanceDates.add(d);
                }
            });

            const daysPresent = req.body.days_worked !== undefined && req.body.days_worked !== null && req.body.days_worked !== ''
                ? toSafeNumber(req.body.days_worked)
                : completedAttendanceDates.size;

            let expectedWorkDays = 0;
            const curDate = new Date(`${pStart}T00:00:00`);
            const endDate = new Date(`${pEnd}T00:00:00`);
            while (curDate <= endDate) {
                const dow = curDate.getDay();
                if (!restDays.includes(dow)) expectedWorkDays++;
                curDate.setDate(curDate.getDate() + 1);
            }
            if (expectedWorkDays === 0) expectedWorkDays = 6;

            // Declared Special Non-Working Days and Regular Holidays are non-working by law; unworked days are not absences
            const forfeitedHolidayDates = new Set(
                (holidayBreakdown || [])
                    .filter(i => i.holidayType === 'regular' && !i.worked && !i.eligible && !i.isRestDay)
                    .map(i => i.date)
            );
            const isNonWorkingHolidayType = (t) => t === 'regular' || t === 'special_non_working';
            const nonWorkingHolidayDates = new Set(
                (holidayList || [])
                    .filter(h => h && h.date && isNonWorkingHolidayType(h.type))
                    .map(h => String(h.date).substring(0, 10))
                    .filter(hDate => !restDays.includes(new Date(`${hDate}T00:00:00`).getDay()))
                    .filter(hDate => !forfeitedHolidayDates.has(hDate))
            );
            let unworkedHolidays = 0;
            let unworkedSpecialNonWorking = 0;
            nonWorkingHolidayDates.forEach(hDate => {
                if (!completedAttendanceDates.has(hDate)) {
                    unworkedHolidays++;
                    const isSpecial = (holidayList || []).some(
                        h => h && String(h.date).substring(0, 10) === hDate && h.type === 'special_non_working'
                    );
                    if (isSpecial) unworkedSpecialNonWorking++;
                }
            });

            const unworkedDays = Math.max(0, expectedWorkDays - daysPresent - approvedPaidLeaveDays - unworkedHolidays);
            if (unworkedDays > 0) {
                absenceDeduction = round2(unworkedDays * dailyRate);
                basicPay = Math.max(0, round2(basicPay - absenceDeduction));
                absenceNote = ` [ABSENT: ${unworkedDays} unworked day(s) (-₱${absenceDeduction.toFixed(2)})]`;
            }
            if (unworkedSpecialNonWorking > 0) {
                absenceNote += ` [${unworkedSpecialNonWorking} Special Non-Working Day(s) not counted as absence]`;
            }
            if (forfeitedHolidayDates.size > 0) {
                absenceNote += ` [${forfeitedHolidayDates.size} Regular Holiday(s) forfeited - absent without pay the workday before]`;
            }
        }

        // Lateness Policy Handling: Evaluates 2-hour policy per shift rather than cumulative period minutes
        const LATE_HOURLY_CONVERSION_MINS = 120;
        let lateMins = 0;
        let perMinuteLateMins = 0;
        let hourlyConvertedLoss = 0;
        let hourlyConvertedShifts = 0;
        let lateDed = 0;
        let tardinessNote = '';

        if (!isFactory) {
            const shiftLateMins = [];
            for (const log of attendanceLogs || []) {
                if (!log || !log.time_in) continue;
                const dateStr = log.date || (typeof log.time_in === 'string' ? log.time_in.split('T')[0] : null);
                if (!dateStr) continue;
                const timeIn = new Date(log.time_in);
                const scheduleStart = new Date(`${dateStr}T08:00:00`);
                if (!isNaN(timeIn.getTime()) && !isNaN(scheduleStart.getTime()) && timeIn > scheduleStart) {
                    const mins = Math.floor((timeIn - scheduleStart) / 60000);
                    if (mins > 0) shiftLateMins.push(mins);
                }
            }

            if (shiftLateMins.length > 0) {
                for (const mins of shiftLateMins) {
                    lateMins += mins;
                    if (mins >= LATE_HOURLY_CONVERSION_MINS) {
                        const workedHours = Math.max(0, 8 - mins / 60);
                        hourlyConvertedLoss += Math.max(0, dailyRate - workedHours * hourlyRate);
                        hourlyConvertedShifts++;
                    } else {
                        perMinuteLateMins += mins;
                    }
                }
            } else {
                // No attendance logs, so only a period total is available and single shifts can't be
                // identified. Never apply the 2-hour rule to a total: deduct per minute instead.
                const providedMins = toSafeNumber(late_minutes);
                if (providedMins > 0) {
                    lateMins = providedMins;
                    perMinuteLateMins = providedMins;
                }
            }
        }

        if (!isFactory && lateMins > 0) {
            hourlyConvertedLoss = round2(hourlyConvertedLoss);
            const perMinuteDed = round2((hourlyRate / 60) * perMinuteLateMins);

            // Hourly-converted shifts reduce basic pay directly; per-minute lateness is a deduction.
            basicPay = Math.max(0, round2(basicPay - hourlyConvertedLoss));
            lateDed = perMinuteDed;

            const parts = [];
            if (perMinuteLateMins > 0) {
                parts.push(`${perMinuteLateMins} min under 2 hrs per shift: per-minute deduction -₱${perMinuteDed.toFixed(2)}`);
            }
            if (hourlyConvertedShifts > 0) {
                parts.push(`${hourlyConvertedShifts} shift(s) 2+ hrs late: converted to hourly rate -₱${hourlyConvertedLoss.toFixed(2)}`);
            }
            tardinessNote = ` [Lateness ${lateMins} mins total - ${parts.join('; ')}]`;
        } else {
            lateDed = round2(toSafeNumber(late_deductions));
        }

        // Suspension Deduction Handling
        let suspensionDeduction = 0;
        let suspensionNote = '';

        if (suspensionLogs && suspensionLogs.length > 0) {
            for (const susp of suspensionLogs) {
                const sStart = susp.date;
                const match = (susp.reason || '').match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
                const sEnd = match ? match[1] : susp.date;

                const oStart = sStart > pStart ? sStart : pStart;
                const oEnd = sEnd < pEnd ? sEnd : pEnd;

                if (oStart <= oEnd) {
                    const days = Math.round((new Date(oEnd) - new Date(oStart)) / (1000 * 60 * 60 * 24)) + 1;
                    if (days >= 7 || (pStart >= sStart && pEnd <= sEnd)) {
                        basicPay = 0;
                        suspensionNote = ` [FULL SUSPENSION: Unpaid period (${sStart} to ${sEnd})]`;
                    } else if (days > 0) {
                        suspensionDeduction = round2(dailyRate * days);
                        basicPay = Math.max(0, round2(basicPay - suspensionDeduction));
                        suspensionNote = ` [SUSPENSION: ${days} unpaid day(s) (-₱${suspensionDeduction.toFixed(2)})]`;
                    }
                }
            }
        }

        // Overtime Computation (DOLE Multipliers)
        let overtimePay = 0;
        if (!isFactory) {
            const regOtHours = toSafeNumber(regular_ot_hours || overtime_hours);
            const regHolOtHours = toSafeNumber(regular_holiday_ot_hours);
            const specHolOtHours = toSafeNumber(special_holiday_ot_hours);

            const regOtPay = regOtHours * hourlyRate * 1.25;                  // 125%
            const regHolOtPay = regHolOtHours * hourlyRate * 2.00 * 1.30;     // 260%
            const specHolOtPay = specHolOtHours * hourlyRate * 1.30 * 1.30;   // 169%

            overtimePay = round2(regOtPay + regHolOtPay + specHolOtPay);
        }


        // Compute HR Approved Paid Leave Pay (Bypasses absence / missing timecard punches)
        const approvedPaidLeaveDays = paidLeaveInfo.totalPaidLeaveDays;
        const paidLeavePay = round2(approvedPaidLeaveDays * dailyRate);

        const paternityPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Paternity', daysTaken: paternity_days, dailyRate }).leavePay;
        const soloParentPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Solo Parent', daysTaken: solo_parent_days, dailyRate }).leavePay;
        const silPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'SIL', daysTaken: sil_days, dailyRate }).leavePay;
        const totalOtherLeavePay = round2(toSafeNumber(paternityPay) + toSafeNumber(soloParentPay) + toSafeNumber(silPay));

        let matDiffPay = 0;
        if (toSafeNumber(maternity_leave_days) > 0) {
            const matResult = calculateMaternityDifferential({
                monthlySalary: effectiveMonthlySalary,
                sssCashBenefit: sss_cash_benefit,
                leaveDays: maternity_leave_days,
            });
            matDiffPay = toSafeNumber(matResult.salaryDifferential);
        }

        const safeBasic = toSafeNumber(basicPay);
        const safeOt = toSafeNumber(overtimePay);
        const safeHoliday = toSafeNumber(totalHolidayPay);
        const safeLeave = toSafeNumber(totalOtherLeavePay);
        const safeMatDiff = toSafeNumber(matDiffPay);
        const safePaidLeavePay = toSafeNumber(paidLeavePay);

        // Combined Gross Pay: Basic + OT + Holiday Pay + Statutory Leaves + Maternity Differential + HR Approved Paid Leaves
        const grossPay = round2(safeBasic + safeOt + safeHoliday + safeLeave + safeMatDiff + safePaidLeavePay);

        // Deductions schedule: prorated contributions apply per cycle for weekly/semi-monthly, or month-end for monthly
        const periodEndDay = new Date(`${pEnd}T00:00:00`).getDate();
        const shouldDeductStatutory = apply_deductions !== undefined
            ? Boolean(apply_deductions)
            : deduction_timing === 'none'
                ? false
                : deduction_timing
                    ? true
                    : (pay_frequency === 'monthly' ? periodEndDay >= 22 : true);

        let sssEE = 0;
        let sssER = 0;
        let sssEC = 0;
        let philHealthEE = 0;
        let philHealthER = 0;
        let pagIbigEE = 0;
        let pagIbigER = 0;

        if (shouldDeductStatutory) {
            const contributionSalaryBase = (isFactory && effectiveMonthlySalary <= 0) ? (grossPay * 4) : effectiveMonthlySalary;

            // Frequency Divisor (Weekly = 4, Semi-Monthly = 2, Monthly = 1)
            const divisor = pay_frequency === 'weekly' ? 4 : (pay_frequency === 'semi-monthly' ? 2 : 1);

            // Live rates & caps from the Statutory Settings screen (falls back to defaults)
            const statRates = await getStatutorySettings();

            // 1. SSS (EE/ER rates and max MSC from settings; EC fee P30/P10)
            const sssMsc = Math.min(contributionSalaryBase, statRates.sss_max_msc);
            sssEE = round2((sssMsc * (statRates.sss_employee_rate / 100)) / divisor);
            sssER = round2((sssMsc * (statRates.sss_employer_rate / 100)) / divisor);
            sssEC = sssMsc >= 15000 ? 30 : 10;

            // 2. PhilHealth (total premium rate split 50/50, salary floor & ceiling from settings)
            const phSalaryBase = Math.min(
                Math.max(contributionSalaryBase, statRates.philhealth_min_salary),
                statRates.philhealth_max_salary
            );
            philHealthEE = round2(((phSalaryBase * (statRates.philhealth_rate / 100)) / 2) / divisor);
            philHealthER = round2(((phSalaryBase * (statRates.philhealth_rate / 100)) / 2) / divisor);

            // 3. Pag-IBIG (EE/ER rates and monthly cap from settings)
            const monthlyPagIbigEE = Math.min(round2(contributionSalaryBase * (statRates.pagibig_employee_rate / 100)), statRates.pagibig_max_contribution);
            const monthlyPagIbigER = Math.min(round2(contributionSalaryBase * (statRates.pagibig_employer_rate / 100)), statRates.pagibig_max_contribution);
            pagIbigEE = round2(monthlyPagIbigEE / divisor);
            pagIbigER = round2(monthlyPagIbigER / divisor);
        }

        const totalStatutoryContributions = round2(sssEE + philHealthEE + pagIbigEE);

        // BIR Taxable Income & Withholding Tax (passed with pay_frequency)
        const taxableGross = Math.max(0, grossPay - safeMatDiff);
        const taxableIncome = Math.max(0, round2(taxableGross - totalStatutoryContributions - lateDed));
        const tax = calculateBIRWithholdingTax(taxableIncome, pay_frequency);

        // DEDUCTION CAP GUARDRAIL: Deductions can never exceed Gross Pay
        const rawDeductions = round2(totalStatutoryContributions + tax + lateDed);
        const totalDeductions = Math.min(rawDeductions, grossPay);
        const netPay = Math.max(0, round2(grossPay - totalDeductions));

        const baseRemarks = shouldDeductStatutory
            ? `2026 Statutory Applied (${pay_frequency.toUpperCase()}) - SSS: ${sssEE.toFixed(2)} (ER: ${sssER.toFixed(2)}, EC: ${sssEC}), PhilHealth: ${philHealthEE.toFixed(2)}, Pag-IBIG: ${pagIbigEE.toFixed(2)}, Tax: ${tax.toFixed(2)}`
            : `Regular Period (No Statutory Deductions) - Tax: ${tax.toFixed(2)}, Late: ${lateDed.toFixed(2)}`;
        const paidLeaveNote = approvedPaidLeaveDays > 0 ? ` [Approved Paid Leave: ${approvedPaidLeaveDays} day(s) (+₱${safePaidLeavePay.toFixed(2)})]` : '';
        const otPolicyNote = isFactory && (toSafeNumber(overtime_hours) > 0 || toSafeNumber(regular_ot_hours) > 0)
            ? ' [Factory Worker: Overtime disallowed per HR policy (₱0.00)]'
            : '';
        const matDiffNote = safeMatDiff > 0 ? ` [Maternity Differential: +₱${safeMatDiff.toFixed(2)}]` : '';
        const remarks = `${baseRemarks}${tardinessNote}${absenceNote}${suspensionNote}${paidLeaveNote}${matDiffNote}${otPolicyNote}`;

        let insertPayload = {
            employee_id,
            period_start: pStart,
            period_end: pEnd,
            basic_pay: safeBasic,
            overtime_pay: isFactory ? 0 : safeOt,
            holiday_pay: safeHoliday,
            holiday_breakdown: holidayBreakdown,
            deductions: totalDeductions,
            sss_deduction: sssEE,
            philhealth_deduction: philHealthEE,
            pagibig_deduction: pagIbigEE,
            tax_deduction: tax,
            remarks,
            net_pay: netPay,
            status: 'Paid'
        };

        const { data: insertedRecord, error: insertError } = await insertPayrollRow(insertPayload);

        if (insertError) throw insertError;
        const insertedPayrollId = insertedRecord?.id;

        const { data: emp } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name')
            .eq('id', employee_id)
            .maybeSingle();

        const avatarUrl = emp?.company_id && emp?.id
            ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
            : null;

        createNotification({
            target: employee_id,
            title: 'New Payslip Available',
            text: `Your payslip for ${pStart} to ${pEnd} is ready (Net Pay: ₱${netPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
            type: 'payroll',
            sender_id: emp?.id,
            company_id: emp?.company_id,
            sender_name: 'HR & Payroll',
            sender_avatar: avatarUrl
        }).catch((err) => console.warn('[PAYROLL_NOTIF_WARN]', err.message));

        if (admin_id) {
            createAuditLog({
                log_name: 'payroll',
                description: `Computed weekly payroll for employee ID ${employee_id}`,
                subject_type: 'App\\Models\\Payroll',
                subject_id: null,
                event: 'created',
                causer_id: admin_id,
                properties: { basic_pay: safeBasic, net_pay: netPay, holiday_pay: safeHoliday, paid_leave_pay: safePaidLeavePay }
            }).catch((err) => console.warn('[PAYROLL_AUDIT_WARN]', err.message));
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('PAYROLL_CREATED', {
            id: insertedPayrollId,
            employee_id,
            gross_pay: grossPay,
            net_pay: netPay,
            period_start: pStart,
            period_end: pEnd,
            pay_frequency: pay_frequency
        });
        res.json({
            success: true,
            message: 'Payroll Computed & Saved Successfully!',
            gross_pay: grossPay,
            net_pay: netPay,
            holiday_pay: safeHoliday,
            paid_leave_pay: safePaidLeavePay,
            approved_paid_leave_days: approvedPaidLeaveDays,
            maternity_differential: safeMatDiff,
            employer_contributions: {
                sss_er: sssER,
                sss_ec: sssEC,
                philhealth_er: philHealthER,
                pagibig_er: pagIbigER,
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Factory batch submission
router.post('/batch', async (req, res) => {
    try {
        const { entries, period_start, period_end, pay_frequency = 'weekly' } = req.body;

        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'No payroll entries were provided for this batch.' });
        }
        if (!period_start || !period_end) {
            return res.status(400).json({ error: 'period_start and period_end are required.' });
        }

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        if (pay_frequency === 'weekly' && getCutoffSpanDays(pStart, pEnd) > MAX_WEEKLY_CUTOFF_DAYS) {
            return res.status(400).json({
                error: `Weekly payroll cutoff cannot exceed ${MAX_WEEKLY_CUTOFF_DAYS} days (received ${getCutoffSpanDays(pStart, pEnd)}).`
            });
        }

        const empIds = entries.map(e => e.employee_id).filter(Boolean);

        // Optimized single-roundtrip prefetch for existing payrolls and employee metadata
        const [{ data: existingRecords }, { data: empList }] = await Promise.all([
            supabase
                .from('payrolls')
                .select('employee_id')
                .in('employee_id', empIds)
                .eq('period_start', pStart)
                .eq('period_end', pEnd),
            supabase
                .from('employees')
                .select('id, company_id, first_name, last_name')
                .in('id', empIds)
        ]);

        const existingSet = new Set((existingRecords || []).map(r => String(r.employee_id)));
        const empMap = new Map((empList || []).map(e => [String(e.id), e]));

        const results = [];
        const skipped = [];
        const asyncTasks = [];

        for (const entry of entries) {
            const employee_id = entry.employee_id;
            if (!employee_id) { skipped.push({ employee_id, reason: 'Missing employee_id' }); continue; }

            if (existingSet.has(String(employee_id))) {
                skipped.push({ employee_id, reason: 'Payslip already exists for this period' });
                continue;
            }

            const grossPay = round2(toSafeNumber(entry.gross_pay));

            // Determine frequency divisor (default to weekly = / 4)
            const frequency = entry.pay_frequency || pay_frequency || 'weekly';
            const divisor = frequency === 'weekly' ? 4 : (frequency === 'semi-monthly' ? 2 : 1);

            // Pro-rate raw monthly deductions (preserve directly if already prorated to avoid double division)
            const isProrated = Boolean(entry.is_prorated);
            const sssDed = isProrated ? round2(toSafeNumber(entry.sss_deduction)) : round2(toSafeNumber(entry.sss_deduction) / divisor);
            const phDed = isProrated ? round2(toSafeNumber(entry.philhealth_deduction)) : round2(toSafeNumber(entry.philhealth_deduction) / divisor);
            const pgbDed = isProrated ? round2(toSafeNumber(entry.pagibig_deduction)) : round2(toSafeNumber(entry.pagibig_deduction) / divisor);
            const taxDed = isProrated ? round2(toSafeNumber(entry.tax_deduction)) : round2(toSafeNumber(entry.tax_deduction) / divisor);

            const rawDeductions = round2(sssDed + phDed + pgbDed + taxDed);

            // DEDUCTION CAP GUARDRAIL: Deductions can never exceed Gross Pay
            const totalDeductions = Math.min(rawDeductions, grossPay);
            const netPay = Math.max(0, round2(grossPay - totalDeductions));

            const opsSummary = Array.isArray(entry.operations_breakdown)
                ? entry.operations_breakdown.map(op => `${op.operation}: ₱${toSafeNumber(op.share).toFixed(2)}`).join(', ')
                : '';

            // Workers with missed days are audited on declared output basis
            const declaredOutput = Array.isArray(entry.declared_output) ? entry.declared_output : [];
            const absenceSummary = entry.is_absent
                ? ` | ABSENT ${toSafeNumber(entry.days_absent)} of ${toSafeNumber(entry.expected_working_days)} day(s), present ${toSafeNumber(entry.days_present)} - paid on declared output${declaredOutput.length > 0
                    ? `: ${declaredOutput.map(d => `${d.operation} ${toSafeNumber(d.declared_quantity)} x ₱${toSafeNumber(d.rate).toFixed(2)} = ₱${toSafeNumber(d.amount).toFixed(2)}`).join(', ')}`
                    : ''
                }`
                : '';

            const remarks = `Factory Batch Payout (${frequency.toUpperCase()}) - Group: ${entry.group || 'N/A'}${opsSummary ? ` | Operations - ${opsSummary}` : ''}${absenceSummary} | SSS: ₱${sssDed.toFixed(2)}, PhilHealth: ₱${phDed.toFixed(2)}, Pag-IBIG: ₱${pgbDed.toFixed(2)}, Tax: ₱${taxDed.toFixed(2)}`;

            let insertPayload = {
                employee_id,
                period_start: pStart,
                period_end: pEnd,
                basic_pay: grossPay,
                overtime_pay: 0,
                deductions: totalDeductions,
                sss_deduction: sssDed,
                philhealth_deduction: phDed,
                pagibig_deduction: pgbDed,
                tax_deduction: taxDed,
                remarks,
                net_pay: netPay,
                status: 'Paid'
            };

            const { data: insertedRec, error: insertError } = await insertPayrollRow(insertPayload);

            if (insertError) {
                skipped.push({ employee_id, reason: insertError.message });
                continue;
            }

            results.push({ id: insertedRec?.id, employee_id, net_pay: netPay });

            const emp = empMap.get(String(employee_id));
            const avatarUrl = emp?.company_id && emp?.id
                ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
                : null;

            asyncTasks.push(
                createNotification({
                    target: employee_id,
                    title: 'New Payslip Available',
                    text: `Your payslip for ${pStart} to ${pEnd} is ready (Net Pay: ₱${netPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
                    type: 'payroll',
                    sender_id: emp?.id,
                    company_id: emp?.company_id,
                    sender_name: 'HR & Payroll',
                    sender_avatar: avatarUrl
                }).catch(() => { })
            );

            if (req.body.admin_id || entry.admin_id) {
                asyncTasks.push(
                    createAuditLog({
                        log_name: 'payroll',
                        description: `Computed factory batch payroll for employee ID ${employee_id}`,
                        subject_type: 'App\\Models\\Payroll',
                        subject_id: null,
                        event: 'created',
                        causer_id: req.body.admin_id || entry.admin_id,
                        properties: { gross_pay: grossPay, net_pay: netPay, group: entry.group }
                    }).catch(() => { })
                );
            }
        }

        // Fire-and-forget notifications and audit logging in parallel
        if (asyncTasks.length > 0) {
            Promise.allSettled(asyncTasks).catch(() => { });
        }

        if (results.length === 0) {
            return res.status(400).json({ error: 'No entries were saved.', skipped });
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('PAYROLL_BATCH_DISTRIBUTED', {
            count: results.length,
            payroll_ids: results.map(r => r.id).filter(Boolean),
            employee_ids: results.map(r => r.employee_id),
            group_name: req.body.group_name || 'Line A',
            period_start: pStart,
            period_end: pEnd
        });
        res.json({
            success: true,
            message: `Factory batch payroll saved for ${results.length} worker(s).`,
            saved: results,
            skipped
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==============================================================================
// 7. Factory Production & Piece-Rate Logs (Enterprise Database Persistence)
// ==============================================================================

router.get('/factory-logs', async (req, res) => {
    try {
        const { group_name, production_group_id, period_start, period_end } = req.query;

        let resolvedGroupId = (production_group_id && isValidUUID(production_group_id)) ? production_group_id : null;
        if (!resolvedGroupId && group_name) {
            const { data: grp } = await supabase.from('production_groups').select('id').ilike('name', group_name.trim()).maybeSingle();
            if (grp?.id) resolvedGroupId = grp.id;
        }

        let query = supabase.from('factory_production_logs').select('*');

        if (resolvedGroupId) {
            query = query.eq('production_group_id', resolvedGroupId);
        }

        if (period_start && period_end) {
            query = query.eq('period_start', period_start).eq('period_end', period_end);
        } else if (period_start) {
            query = query.gte('period_start', period_start);
        }

        let { data, error } = await query.order('created_at', { ascending: true });
        if (error) throw error;

        // Enterprise Fallback: If no records match this exact cutoff period, load group's latest saved batch operations
        if ((!data || data.length === 0) && resolvedGroupId) {
            const { data: latestData } = await supabase
                .from('factory_production_logs')
                .select('*')
                .eq('production_group_id', resolvedGroupId)
                .order('updated_at', { ascending: false })
                .order('period_end', { ascending: false })
                .limit(30);

            if (latestData && latestData.length > 0) {
                const seenOps = new Set();
                const uniqueLatest = [];
                for (const row of latestData) {
                    if (!seenOps.has(row.operation)) {
                        seenOps.add(row.operation);
                        uniqueLatest.push(row);
                    }
                }
                data = uniqueLatest;
            }
        }

        // Map directly into the UI expected schema
        const rows = (data || []).map(r => ({
            id: r.id,
            operation: r.operation,
            stock_no: r.stock_no || 'Formal',
            quantity_in: String(r.quantity_in ?? 0),
            amount: String(r.amount ?? 0),
            assignedEmployeeIds: Array.isArray(r.assigned_worker_ids) ? r.assigned_worker_ids : []
        }));

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Error fetching factory production logs:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/factory-logs', async (req, res) => {
    try {
        const {
            production_group_id,
            group_name,
            period_start,
            period_end,
            rows
        } = req.body;

        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'No factory operation rows provided' });
        }

        let resolvedGroupId = (production_group_id && isValidUUID(production_group_id)) ? production_group_id : null;
        if (!resolvedGroupId && group_name) {
            const { data: grp } = await supabase.from('production_groups').select('id').ilike('name', group_name.trim()).maybeSingle();
            if (grp?.id) resolvedGroupId = grp.id;
        }

        const pStart = period_start || new Date().toISOString().split('T')[0];
        const pEnd = period_end || new Date().toISOString().split('T')[0];

        // Fetch existing rows for this group to resolve existing stable UUIDs
        let existingRows = [];
        if (resolvedGroupId) {
            const { data: dbExisting } = await supabase
                .from('factory_production_logs')
                .select('id, operation, production_group_id, period_start, period_end')
                .eq('production_group_id', resolvedGroupId);
            existingRows = dbExisting || [];
        }

        const existingById = new Map(existingRows.map(r => [r.id, r]));
        const existingByOp = new Map(existingRows.map(r => [(r.operation || '').trim().toLowerCase(), r]));

        const upsertPayloads = rows.map(r => {
            const qty = parseFloat(r.quantity_in) || 0;
            const amt = parseFloat(r.amount) || 0;
            const opName = (r.operation || 'General Operation').trim();

            // Resolve stable UUID so row is edited in place in Supabase (no duplicate rows)
            let targetId = (r.id && isValidUUID(r.id) && existingById.has(r.id)) ? r.id : null;
            if (!targetId && existingByOp.has(opName.toLowerCase())) {
                targetId = existingByOp.get(opName.toLowerCase()).id;
            }

            const payload = {
                production_group_id: resolvedGroupId,
                period_start: pStart,
                period_end: pEnd,
                operation: opName,
                stock_no: r.stock_no || 'Formal',
                quantity_in: qty,
                amount: amt,
                total_amount: parseFloat((qty * amt).toFixed(2)),
                assigned_worker_ids: Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [],
                updated_at: new Date().toISOString()
            };

            if (targetId) {
                payload.id = targetId;
            }

            return payload;
        });

        const { data, error } = await supabase
            .from('factory_production_logs')
            .upsert(upsertPayloads, { onConflict: 'id' })
            .select('*');

        if (error) throw error;

        // Clean up any stale operations removed by the user for this group
        if (resolvedGroupId && existingRows.length > 0) {
            const savedIds = new Set((data || []).map(r => r.id));
            const staleIds = existingRows.filter(er => !savedIds.has(er.id)).map(er => er.id);
            if (staleIds.length > 0) {
                await supabase.from('factory_production_logs').delete().in('id', staleIds);
            }
        }

        const formattedRows = (data || []).map(r => ({
            id: r.id,
            operation: r.operation,
            stock_no: r.stock_no || 'Formal',
            quantity_in: String(r.quantity_in ?? 0),
            amount: String(r.amount ?? 0),
            assignedEmployeeIds: Array.isArray(r.assigned_worker_ids) ? r.assigned_worker_ids : []
        }));

        res.status(200).json({ success: true, count: data.length, data: formattedRows });
    } catch (err) {
        console.error('Error saving factory production logs:', err);
        res.status(500).json({ error: err.message });
    }
});

// Single-row direct update by UUID
router.put('/factory-logs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ error: 'Valid UUID required' });
        }

        const { operation, stock_no, quantity_in, amount, assignedEmployeeIds } = req.body;
        const updateData = { updated_at: new Date().toISOString() };

        if (operation !== undefined) updateData.operation = operation;
        if (stock_no !== undefined) updateData.stock_no = stock_no;
        if (quantity_in !== undefined) updateData.quantity_in = parseFloat(quantity_in) || 0;
        if (amount !== undefined) updateData.amount = parseFloat(amount) || 0;
        if (quantity_in !== undefined || amount !== undefined) {
            const qty = updateData.quantity_in !== undefined ? updateData.quantity_in : parseFloat(quantity_in) || 0;
            const amt = updateData.amount !== undefined ? updateData.amount : parseFloat(amount) || 0;
            updateData.total_amount = parseFloat((qty * amt).toFixed(2));
        }
        if (assignedEmployeeIds !== undefined) {
            updateData.assigned_worker_ids = Array.isArray(assignedEmployeeIds) ? assignedEmployeeIds : [];
        }

        const { data, error } = await supabase
            .from('factory_production_logs')
            .update(updateData)
            .eq('id', id)
            .select('*')
            .single();

        if (error) throw error;

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('FACTORY_LOG_UPDATED', { id: data.id });

        res.json({
            success: true,
            data: {
                id: data.id,
                operation: data.operation,
                stock_no: data.stock_no || 'Formal',
                quantity_in: String(data.quantity_in ?? 0),
                amount: String(data.amount ?? 0),
                assignedEmployeeIds: Array.isArray(data.assigned_worker_ids) ? data.assigned_worker_ids : []
            }
        });
    } catch (err) {
        console.error('Error updating single factory production log:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', cacheResponse(20), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ status: 'error', code: 'INVALID_UUID', message: 'Invalid Payroll ID format.' });
        }

        const { data, error } = await supabase
            .from('payrolls')
            .select('*, employees:employee_id(*)')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Payroll record not found.' });

        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids must be a non-empty array of payroll IDs.' });
        }
        if (ids.length > 200) {
            return res.status(400).json({ error: 'Cannot delete more than 200 records in a single request.' });
        }
        const invalidIds = ids.filter((id) => !isValidUUID(id));
        if (invalidIds.length > 0) {
            return res.status(400).json({ error: `Invalid payroll ID format: ${invalidIds.join(', ')}` });
        }

        const { error, count } = await supabase.from('payrolls').delete({ count: 'exact' }).in('id', ids);
        if (error) throw error;

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('PAYROLL_BULK_DELETED', { ids });
        const deletedCount = count ?? ids.length;
        res.json({ success: true, deleted_count: deletedCount, message: `${deletedCount} payroll record(s) deleted successfully.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ status: 'error', code: 'INVALID_UUID', message: 'Invalid Payroll ID format.' });
        }

        const { error } = await supabase.from('payrolls').delete().eq('id', id);
        if (error) throw error;

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('PAYROLL_DELETED', { id });
        res.json({ success: true, message: 'Payroll record deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;