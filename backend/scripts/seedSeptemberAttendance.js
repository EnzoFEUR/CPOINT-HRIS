import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://lzqshktnrvtlattdiwxf.supabase.co').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper to pad numbers with leading zeros
const pad = (n) => String(n).padStart(2, '0');

// Generates an ISO string with +08:00 offset preserved
function formatManilaISO(year, month, day, hour, minute, second = 0) {
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`;
}

// Random integer between min and max inclusive
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Float between min and max rounded to 2 decimals
function randomFloat(min, max) {
    return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

async function seedSeptemberAttendance() {
    console.log('========================================================================');
    console.log(' C-POINT HRIS — SEPTEMBER 2026 REALISTIC ATTENDANCE SEEDER');
    console.log('========================================================================');
    console.log(`Connecting to: ${SUPABASE_URL}`);

    // 1. Fetch active employees
    const { data: employees, error: empErr } = await supabase
        .from('employees')
        .select('id, first_name, last_name, company_id, department, job_title, status, is_active')
        .eq('is_active', true)
        .neq('status', 'terminated');

    if (empErr) {
        console.error('Failed to fetch employees:', empErr);
        process.exit(1);
    }

    console.log(`Found ${employees.length} active eligible employee(s) for attendance generation.\n`);

    const year = 2026;
    const month = 9; // September
    const daysInMonth = 30;

    // Define custom realistic attendance profiles per employee
    // Absence dates and late dates mapped by company_id or id
    const employeeProfiles = {
        'CP-2026-017': { // ray Joson (Factory, Cutter)
            workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat (Sunday 0 is rest day)
            absentDays: [16], // Absent on Wednesday, Sept 16
            lateDays: [4, 25], // Late on Friday Sept 4, Friday Sept 25
            overtimeDays: [11, 18], // OT on Fridays Sept 11, Sept 18
        },
        'CP-2026-019': { // Ray Joson (Factory, Cutter)
            workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
            absentDays: [10, 24], // Absent on Thu Sept 10, Thu Sept 24
            lateDays: [8, 22], // Late on Tue Sept 8, Tue Sept 22
            overtimeDays: [12, 19], // OT on Saturdays
        },
        'CP-2026-020': { // Raygener Joson (Factory, Sapatero)
            workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
            absentDays: [21], // Absent on Mon Sept 21
            lateDays: [15], // Late on Tue Sept 15
            overtimeDays: [5, 12, 26], // OT on Saturdays
        },
        'CP-2026-014': { // peter valdez (HR/Admin, admin)
            workDays: [1, 2, 3, 4, 5], // Mon-Fri (Weekends off)
            absentDays: [18], // Absent on Fri Sept 18
            lateDays: [8], // Late on Tue Sept 8
            overtimeDays: [],
        },
        'CP-2026-018': { // Kore my 1 @$_ And only tan (Retail)
            workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
            absentDays: [9, 23], // Absent on Wed Sept 9, Wed Sept 23
            lateDays: [12], // Late on Sat Sept 12
            overtimeDays: [30], // Month-end OT
        },
        'security': { // Terminal Guard
            workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
            absentDays: [14], // Absent on Mon Sept 14
            lateDays: [2, 17],
            overtimeDays: [],
        },
        'admin': { // System Administrator
            workDays: [1, 2, 3, 4, 5], // Mon-Fri
            absentDays: [7], // Absent on Mon Sept 7
            lateDays: [14],
            overtimeDays: [15],
        }
    };

    const attendanceRecords = [];

    // Query existing attendances for September 2026 to avoid overwriting manually logged live records
    const { data: existingLogs } = await supabase
        .from('attendances')
        .select('id, employee_id, date')
        .gte('date', '2026-09-01')
        .lte('date', '2026-09-30');

    const existingMap = new Set((existingLogs || []).map(l => `${l.employee_id}__${l.date}`));
    console.log(`Preserving ${existingMap.size} already existing attendance record(s) in September 2026.`);

    for (const emp of employees) {
        // Skip suspended employees if their status is suspended
        if (emp.status === 'suspended') {
            console.log(`Skipping suspended employee: ${emp.first_name} ${emp.last_name}`);
            continue;
        }

        const profileKey = emp.company_id || (emp.department === 'Security' ? 'security' : 'admin');
        const profile = employeeProfiles[profileKey] || {
            workDays: emp.department === 'Factory' ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5],
            absentDays: [15],
            lateDays: [8],
            overtimeDays: []
        };

        let empPresentCount = 0;
        let empLateCount = 0;
        let empAbsentCount = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `2026-09-${pad(day)}`;
            const dateObj = new Date(year, month - 1, day);
            const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday

            // Check if working day
            if (!profile.workDays.includes(dayOfWeek)) {
                // Rest Day (e.g. Sunday) - skip
                continue;
            }

            // If already logged in database, don't overwrite
            if (existingMap.has(`${emp.id}__${dateStr}`)) {
                continue;
            }

            const isAbsent = profile.absentDays.includes(day);
            const isLate = profile.lateDays.includes(day);
            const isOvertime = profile.overtimeDays.includes(day);

            if (isAbsent) {
                // Realistic Absent Record
                attendanceRecords.push({
                    employee_id: emp.id,
                    date: dateStr,
                    time_in: null,
                    time_out: null,
                    status: 'Absent',
                    time_in_photo: null,
                    time_out_photo: null,
                    liveness_confidence: null,
                    liveness_verified: false,
                    liveness_confidence_out: null,
                    liveness_verified_out: false,
                    scanned_from_ip: '192.168.1.100',
                    created_at: formatManilaISO(year, month, day, 9, 0, 0),
                    updated_at: formatManilaISO(year, month, day, 17, 0, 0),
                });
                empAbsentCount++;
            } else if (isLate) {
                // Realistic Late Record (Clock-in between 08:14 and 08:42 AM)
                const inHour = 8;
                const inMin = randomInt(14, 42);
                const inSec = randomInt(5, 55);

                const outHour = 17;
                const outMin = randomInt(5, 25);
                const outSec = randomInt(10, 50);

                const livenessIn = randomFloat(0.92, 0.98);
                const livenessOut = randomFloat(0.90, 0.97);

                attendanceRecords.push({
                    employee_id: emp.id,
                    date: dateStr,
                    time_in: formatManilaISO(year, month, day, inHour, inMin, inSec),
                    time_out: formatManilaISO(year, month, day, outHour, outMin, outSec),
                    status: 'Late',
                    time_in_photo: `attendance/in-${emp.company_id || 'CP'}-${Date.now() + day * 1000}.jpg`,
                    time_out_photo: `attendance/out-${emp.company_id || 'CP'}-${Date.now() + day * 1000 + 500}.jpg`,
                    liveness_confidence: livenessIn,
                    liveness_verified: true,
                    liveness_confidence_out: livenessOut,
                    liveness_verified_out: true,
                    scanned_from_ip: '192.168.1.102',
                    created_at: formatManilaISO(year, month, day, inHour, inMin, inSec),
                    updated_at: formatManilaISO(year, month, day, outHour, outMin, outSec),
                });
                empLateCount++;
                empPresentCount++;
            } else if (isOvertime) {
                // Realistic Overtime Record (Clock out at 18:30 - 19:30 PM)
                const inHour = 7;
                const inMin = randomInt(45, 55);
                const inSec = randomInt(10, 50);

                const outHour = randomInt(18, 19);
                const outMin = randomInt(15, 45);
                const outSec = randomInt(10, 50);

                const livenessIn = randomFloat(0.95, 0.99);
                const livenessOut = randomFloat(0.92, 0.98);

                attendanceRecords.push({
                    employee_id: emp.id,
                    date: dateStr,
                    time_in: formatManilaISO(year, month, day, inHour, inMin, inSec),
                    time_out: formatManilaISO(year, month, day, outHour, outMin, outSec),
                    status: 'Present',
                    time_in_photo: `attendance/in-${emp.company_id || 'CP'}-${Date.now() + day * 1000}.jpg`,
                    time_out_photo: `attendance/out-${emp.company_id || 'CP'}-${Date.now() + day * 1000 + 500}.jpg`,
                    liveness_confidence: livenessIn,
                    liveness_verified: true,
                    liveness_confidence_out: livenessOut,
                    liveness_verified_out: true,
                    scanned_from_ip: '192.168.1.102',
                    created_at: formatManilaISO(year, month, day, inHour, inMin, inSec),
                    updated_at: formatManilaISO(year, month, day, outHour, outMin, outSec),
                });
                empPresentCount++;
            } else {
                // Realistic Standard Present Record (Clock-in between 07:42 and 07:58 AM, Out 17:02 - 17:18 PM)
                const inHour = 7;
                const inMin = randomInt(42, 58);
                const inSec = randomInt(5, 55);

                const outHour = 17;
                const outMin = randomInt(2, 18);
                const outSec = randomInt(10, 55);

                const livenessIn = randomFloat(0.94, 0.99);
                const livenessOut = randomFloat(0.91, 0.98);

                attendanceRecords.push({
                    employee_id: emp.id,
                    date: dateStr,
                    time_in: formatManilaISO(year, month, day, inHour, inMin, inSec),
                    time_out: formatManilaISO(year, month, day, outHour, outMin, outSec),
                    status: 'Present',
                    time_in_photo: `attendance/in-${emp.company_id || 'CP'}-${Date.now() + day * 1000}.jpg`,
                    time_out_photo: `attendance/out-${emp.company_id || 'CP'}-${Date.now() + day * 1000 + 500}.jpg`,
                    liveness_confidence: livenessIn,
                    liveness_verified: true,
                    liveness_confidence_out: livenessOut,
                    liveness_verified_out: true,
                    scanned_from_ip: '192.168.1.102',
                    created_at: formatManilaISO(year, month, day, inHour, inMin, inSec),
                    updated_at: formatManilaISO(year, month, day, outHour, outMin, outSec),
                });
                empPresentCount++;
            }
        }

        console.log(`Generated profile for ${emp.first_name} ${emp.last_name} (${emp.job_title}): Present: ${empPresentCount}, Late: ${empLateCount}, Absent: ${empAbsentCount}`);
    }

    console.log(`\nTotal records to insert/upsert: ${attendanceRecords.length}`);

    // Insert in batches of 50 to avoid payload size limit
    const BATCH_SIZE = 50;
    let insertedCount = 0;

    for (let i = 0; i < attendanceRecords.length; i += BATCH_SIZE) {
        const batch = attendanceRecords.slice(i, i + BATCH_SIZE);
        const { error: insertErr } = await supabase
            .from('attendances')
            .upsert(batch, { onConflict: 'employee_id,date' });

        if (insertErr) {
            console.error(`Batch insert error at index ${i}:`, insertErr);
            process.exit(1);
        }
        insertedCount += batch.length;
        process.stdout.write(`Inserted ${insertedCount}/${attendanceRecords.length} records...\r`);
    }

    console.log(`\nSuccessfully seeded ${insertedCount} attendance records for September 2026!`);
    console.log('========================================================================\n');
}

seedSeptemberAttendance().catch((err) => {
    console.error('Seeding process encountered an unhandled error:', err);
    process.exit(1);
});
