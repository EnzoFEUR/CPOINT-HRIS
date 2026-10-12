import { supabase } from '../supabaseClient.js';
import { getChargeableLateMinutes, calculateTardiness, DEFAULT_WORK_POLICY, DEFAULT_REST_DAYS } from '../../shared/workPolicy.mjs';

async function seedEnzoAttendance() {
    console.log('--- Seeding Enzo Narte Attendance (7 Days) ---');

    // 1. Fetch Enzo Narte
    const { data: employee, error: empErr } = await supabase
        .from('employees')
        .select('*')
        .ilike('last_name', '%narte%')
        .single();

    if (empErr || !employee) {
        console.error('Error fetching employee Enzo Narte:', empErr);
        process.exit(1);
    }

    console.log(`Employee found: ${employee.first_name} ${employee.last_name} (${employee.company_id || employee.id})`);
    console.log(`Department: ${employee.department} | Shift: ${employee.shift} | Role: ${employee.role}`);

    // 2. Define exactly 7 working days with realistic hours and tardiness
    // Call time: 08:00 AM, Grace period: 15 min (up to 08:15 AM)
    const records = [
        {
            employee_id: employee.id,
            date: '2026-10-02',
            time_in: '2026-10-02T07:53:14+08:00',
            time_out: '2026-10-02T17:15:20+08:00',
            status: 'Present',
            time_in_photo: 'attendance/in-CP-2026-022-1791267426656.jpg',
            time_out_photo: null,
            liveness_confidence: 0.96,
            liveness_verified: true,
            liveness_confidence_out: 0.95,
            liveness_verified_out: true,
            scanned_from_ip: '192.168.1.102',
            created_at: '2026-10-02T07:53:14+08:00',
            updated_at: '2026-10-02T17:15:20+08:00'
        },
        {
            employee_id: employee.id,
            date: '2026-10-05',
            time_in: '2026-10-05T08:06:45+08:00',
            time_out: '2026-10-05T17:22:10+08:00',
            status: 'Present',
            time_in_photo: 'attendance/in-CP-2026-022-1791267426656.jpg',
            time_out_photo: null,
            liveness_confidence: 0.95,
            liveness_verified: true,
            liveness_confidence_out: 0.96,
            liveness_verified_out: true,
            scanned_from_ip: '192.168.1.102',
            created_at: '2026-10-05T08:06:45+08:00',
            updated_at: '2026-10-05T17:22:10+08:00'
        },
        {
            employee_id: employee.id,
            date: '2026-10-06',
            time_in: '2026-10-06T08:28:18+08:00',
            time_out: '2026-10-06T17:35:40+08:00',
            status: 'Late',
            time_in_photo: 'attendance/in-CP-2026-022-1791267426656.jpg',
            time_out_photo: null,
            liveness_confidence: 0.94,
            liveness_verified: true,
            liveness_confidence_out: 0.95,
            liveness_verified_out: true,
            scanned_from_ip: '192.168.1.102',
            created_at: '2026-10-06T08:28:18+08:00',
            updated_at: '2026-10-06T17:35:40+08:00'
        },
        {
            employee_id: employee.id,
            date: '2026-10-07',
            time_in: '2026-10-07T07:48:30+08:00',
            time_out: '2026-10-07T17:08:50+08:00',
            status: 'Present',
            time_in_photo: 'attendance/in-CP-2026-022-1791267426656.jpg',
            time_out_photo: null,
            liveness_confidence: 0.97,
            liveness_verified: true,
            liveness_confidence_out: 0.96,
            liveness_verified_out: true,
            scanned_from_ip: '192.168.1.102',
            created_at: '2026-10-07T07:48:30+08:00',
            updated_at: '2026-10-07T17:08:50+08:00'
        },
        {
            employee_id: employee.id,
            date: '2026-10-08',
            time_in: '2026-10-08T08:03:50+08:00',
            time_out: '2026-10-08T17:18:25+08:00',
            status: 'Present',
            time_in_photo: 'attendance/in-CP-2026-022-1791267426656.jpg',
            time_out_photo: null,
            liveness_confidence: 0.96,
            liveness_verified: true,
            liveness_confidence_out: 0.95,
            liveness_verified_out: true,
            scanned_from_ip: '192.168.1.102',
            created_at: '2026-10-08T08:03:50+08:00',
            updated_at: '2026-10-08T17:18:25+08:00'
        },
        {
            employee_id: employee.id,
            date: '2026-10-09',
            time_in: '2026-10-09T08:21:30+08:00',
            time_out: '2026-10-09T17:42:15+08:00',
            status: 'Late',
            time_in_photo: 'attendance/in-CP-2026-022-1791267426656.jpg',
            time_out_photo: null,
            liveness_confidence: 0.95,
            liveness_verified: true,
            liveness_confidence_out: 0.94,
            liveness_verified_out: true,
            scanned_from_ip: '192.168.1.102',
            created_at: '2026-10-09T08:21:30+08:00',
            updated_at: '2026-10-09T17:42:15+08:00'
        },
        {
            employee_id: employee.id,
            date: '2026-10-12',
            time_in: '2026-10-12T07:56:05+08:00',
            time_out: '2026-10-12T17:05:40+08:00',
            status: 'Present',
            time_in_photo: 'attendance/in-CP-2026-022-1791267426656.jpg',
            time_out_photo: null,
            liveness_confidence: 0.96,
            liveness_verified: true,
            liveness_confidence_out: 0.95,
            liveness_verified_out: true,
            scanned_from_ip: '192.168.1.102',
            created_at: '2026-10-12T07:56:05+08:00',
            updated_at: '2026-10-12T17:05:40+08:00'
        }
    ];

    // Clean any prior attendance for Enzo on these dates before insert
    const dates = records.map(r => r.date);
    await supabase.from('attendances')
        .delete()
        .eq('employee_id', employee.id)
        .in('date', dates);

    // 3. Insert records
    const { data: inserted, error: insertErr } = await supabase
        .from('attendances')
        .insert(records)
        .select('*');

    if (insertErr) {
        console.error('Failed to insert attendances:', insertErr);
        process.exit(1);
    }

    console.log(`\nSuccessfully seeded ${inserted.length} attendance records for Enzo Narte:`);
    inserted.forEach(r => {
        const lateMins = getChargeableLateMinutes(r, DEFAULT_WORK_POLICY, DEFAULT_REST_DAYS);
        console.log(`- Date: ${r.date} | In: ${r.time_in.slice(11, 16)} | Out: ${r.time_out.slice(11, 16)} | Status: ${r.status.padEnd(7)} | Chargeable Late: ${lateMins}m`);
    });

    const tardiness = calculateTardiness(inserted, DEFAULT_WORK_POLICY, DEFAULT_REST_DAYS);
    console.log(`\nSummary: 7 Days Worked | 5 Present | 2 Late (${tardiness.minutes} total minutes late)`);
    process.exit(0);
}

seedEnzoAttendance();
