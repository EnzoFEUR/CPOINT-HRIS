import dotenv from 'dotenv';
import { supabase } from './supabaseClient.js';

dotenv.config();

const seedSpecificAugustAttendance = async () => {
  console.log('===============================================================');
  console.log('Seeding Realistic August 1-15, 2026 Attendance for CP-2026-004 & CP-2026-006');
  console.log('===============================================================');

  // 1. Fetch both target employees
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, company_id, first_name, last_name, shift, department')
    .in('company_id', ['CP-2026-004', 'CP-2026-006']);

  if (empErr) {
    throw new Error(`Failed to fetch target employees: ${empErr.message}`);
  }

  if (!employees || employees.length === 0) {
    throw new Error('Target employees CP-2026-004 and CP-2026-006 not found in database.');
  }

  const emp004 = employees.find(e => e.company_id === 'CP-2026-004');
  const emp006 = employees.find(e => e.company_id === 'CP-2026-006');

  if (!emp004 || !emp006) {
    throw new Error(`Could not find both employees. Found: ${employees.map(e => e.company_id).join(', ')}`);
  }

  const targetIds = [emp004.id, emp006.id];

  // 2. Clear existing August 1 - 15 attendance logs for these 2 employees
  console.log(`Clearing existing records for ${emp004.first_name} (${emp004.company_id}) and ${emp006.first_name} (${emp006.company_id})...`);
  const { error: delErr } = await supabase
    .from('attendances')
    .delete()
    .in('employee_id', targetIds)
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-15');

  if (delErr) {
    console.warn('Warning during deletion:', delErr.message);
  } else {
    console.log('Old August 1-15 records cleared successfully.');
  }

  // 3. Build realistic schedules for August 1 to 15, 2026
  // Helper to format ISO timestamp in Asia/Manila (+08:00)
  const formatTs = (dateStr, hour, minute, second = 0) => {
    const h = String(hour).padStart(2, '0');
    const m = String(minute).padStart(2, '0');
    const s = String(second).padStart(2, '0');
    return `${dateStr}T${h}:${m}:${s}+08:00`;
  };

  const records = [];

  // =================================================================
  // CP-2026-004 (Rodge Granado) - Morning Shift (Call time 08:00 AM)
  // Work days: Aug 1 (Sat OT), Aug 3-7 (Mon-Fri), Aug 11-15 (Tue-Sat)
  // Aug 10: Absent (Sick / Unplanned)
  // Aug 5 & 12: Late
  // Aug 3, 6, 12, 14: Overtime
  // =================================================================
  const photo004 = `face-baselines/${emp004.company_id}/${emp004.id}.jpg`;

  const schedule004 = [
    // Aug 1 (Sat): Special Saturday Production Overtime
    { day: 1, type: 'present', in: [7, 48, 12], out: [16, 15, 45], note: 'Saturday Production Shift (8.5h)' },
    // Aug 2 (Sun): Rest Day - Skipped
    // Aug 3 (Mon): On-time + Light Overtime
    { day: 3, type: 'present', in: [7, 51, 30], out: [17, 30, 15], note: 'On-time + 1.5h Overtime (9.6h)' },
    // Aug 4 (Tue): On-time
    { day: 4, type: 'present', in: [7, 45, 10], out: [17, 0, 22], note: 'Standard 8h Shift + 1h pack' },
    // Aug 5 (Wed): LATE (Traffic delay on EDSA)
    { day: 5, type: 'late', in: [8, 38, 45], out: [17, 35, 10], note: 'Late 38 minutes' },
    // Aug 6 (Thu): Heavy Machine Run (Heavy Overtime)
    { day: 6, type: 'present', in: [7, 53, 20], out: [19, 45, 0], note: 'Heavy Production Overtime +3.75h (11.8h)' },
    // Aug 7 (Fri): On-time Friday
    { day: 7, type: 'present', in: [7, 49, 15], out: [17, 5, 30], note: 'Regular Friday Shift' },
    // Aug 8 (Sat): Rest Day - Skipped
    // Aug 9 (Sun): Rest Day - Skipped
    // Aug 10 (Mon): ABSENT (Fever / Medical recovery)
    { day: 10, type: 'absent', note: 'Unplanned Sick Absence' },
    // Aug 11 (Tue): Back to work on-time
    { day: 11, type: 'present', in: [7, 42, 55], out: [17, 10, 40], note: 'Punctual resumption' },
    // Aug 12 (Wed): LATE + Extended Overtime catch-up
    { day: 12, type: 'late', in: [8, 26, 10], out: [18, 45, 50], note: 'Late 26 mins, caught up with +1.75h Overtime' },
    // Aug 13 (Thu): On-time
    { day: 13, type: 'present', in: [7, 47, 30], out: [17, 2, 10], note: 'Standard Shift' },
    // Aug 14 (Fri): Friday Overtime Dispatch
    { day: 14, type: 'present', in: [7, 55, 40], out: [18, 30, 20], note: 'Friday Overtime +1.5h' },
    // Aug 15 (Sat): Weekend Half-day Overtime
    { day: 15, type: 'present', in: [7, 58, 12], out: [12, 30, 45], note: 'Saturday Half-day Overtime (4.5h)' }
  ];

  for (const s of schedule004) {
    const dayStr = String(s.day).padStart(2, '0');
    const dateStr = `2026-08-${dayStr}`;

    if (s.type === 'absent') {
      records.push({
        employee_id: emp004.id,
        date: dateStr,
        time_in: null,
        time_out: null,
        status: 'Absent',
        time_in_photo: null,
        time_out_photo: null,
        liveness_confidence: 0,
        liveness_verified: false,
        liveness_confidence_out: null,
        liveness_verified_out: false,
        scanned_from_ip: '::1'
      });
    } else {
      const timeInISO = formatTs(dateStr, s.in[0], s.in[1], s.in[2]);
      const timeOutISO = formatTs(dateStr, s.out[0], s.out[1], s.out[2]);
      const confidenceIn = +(0.93 + Math.random() * 0.05).toFixed(4);
      const confidenceOut = +(0.92 + Math.random() * 0.06).toFixed(4);

      records.push({
        employee_id: emp004.id,
        date: dateStr,
        time_in: timeInISO,
        time_out: timeOutISO,
        status: s.type === 'late' ? 'Late' : 'Present',
        time_in_photo: photo004,
        time_out_photo: photo004,
        liveness_confidence: confidenceIn,
        liveness_verified: true,
        liveness_confidence_out: confidenceOut,
        liveness_verified_out: true,
        scanned_from_ip: '::1'
      });
    }
  }

  // =================================================================
  // CP-2026-006 (Raygener Joson) - Swing/Mid Shift (Call time 14:00 / 2:00 PM)
  // Work days: Aug 1 (Sat), Aug 3-5, Aug 7-8, Aug 10-15
  // Aug 6: Absent (Personal / Family emergency)
  // Aug 4 & 13: Late
  // Aug 7 & 11: Extended Night Overtime
  // =================================================================
  const photo006 = `face-baselines/${emp006.company_id}/${emp006.id}.jpg`;

  const schedule006 = [
    // Aug 1 (Sat): Retail Weekend Rush
    { day: 1, type: 'present', in: [13, 48, 22], out: [22, 15, 30], note: 'Saturday Retail Peak Shift (8.45h)' },
    // Aug 2 (Sun): Rest Day - Skipped
    // Aug 3 (Mon): Punctual Start
    { day: 3, type: 'present', in: [13, 52, 10], out: [22, 8, 45], note: 'Standard Swing Shift' },
    // Aug 4 (Tue): LATE (Transit delay)
    { day: 4, type: 'late', in: [14, 42, 35], out: [22, 30, 15], note: 'Late 42 minutes' },
    // Aug 5 (Wed): On-time
    { day: 5, type: 'present', in: [13, 45, 50], out: [22, 10, 20], note: 'Standard Shift' },
    // Aug 6 (Thu): ABSENT (Emergency leave)
    { day: 6, type: 'absent', note: 'Unplanned Personal Emergency Absence' },
    // Aug 7 (Fri): Friday Night Store Extended Overtime
    { day: 7, type: 'present', in: [13, 50, 15], out: [23, 45, 50], note: 'Friday Extended Overtime +1.75h (9.9h)' },
    // Aug 8 (Sat): Saturday Shift
    { day: 8, type: 'present', in: [13, 55, 30], out: [22, 20, 10], note: 'Saturday Standard Shift' },
    // Aug 9 (Sun): Rest Day - Skipped
    // Aug 10 (Mon): Punctual
    { day: 10, type: 'present', in: [13, 41, 12], out: [22, 5, 40], note: 'Punctual Swing Shift' },
    // Aug 11 (Tue): Night Stock Inventory Overtime
    { day: 11, type: 'present', in: [13, 49, 25], out: [23, 59, 10], note: 'Inventory Count Overtime +2h (10.2h)' },
    // Aug 12 (Wed): Standard Swing
    { day: 12, type: 'present', in: [13, 56, 40], out: [22, 12, 30], note: 'Standard Shift' },
    // Aug 13 (Thu): LATE (Heavy rain / commute)
    { day: 13, type: 'late', in: [14, 46, 15], out: [22, 45, 0], note: 'Late 46 minutes' },
    // Aug 14 (Fri): On-time Friday
    { day: 14, type: 'present', in: [13, 51, 30], out: [22, 10, 45], note: 'Standard Friday Shift' },
    // Aug 15 (Sat): Weekend Shift
    { day: 15, type: 'present', in: [13, 47, 50], out: [22, 30, 20], note: 'Saturday Shift (8.7h)' }
  ];

  for (const s of schedule006) {
    const dayStr = String(s.day).padStart(2, '0');
    const dateStr = `2026-08-${dayStr}`;

    if (s.type === 'absent') {
      records.push({
        employee_id: emp006.id,
        date: dateStr,
        time_in: null,
        time_out: null,
        status: 'Absent',
        time_in_photo: null,
        time_out_photo: null,
        liveness_confidence: 0,
        liveness_verified: false,
        liveness_confidence_out: null,
        liveness_verified_out: false,
        scanned_from_ip: '::1'
      });
    } else {
      const timeInISO = formatTs(dateStr, s.in[0], s.in[1], s.in[2]);
      const timeOutISO = formatTs(dateStr, s.out[0], s.out[1], s.out[2]);
      const confidenceIn = +(0.94 + Math.random() * 0.05).toFixed(4);
      const confidenceOut = +(0.93 + Math.random() * 0.05).toFixed(4);

      records.push({
        employee_id: emp006.id,
        date: dateStr,
        time_in: timeInISO,
        time_out: timeOutISO,
        status: s.type === 'late' ? 'Late' : 'Present',
        time_in_photo: photo006,
        time_out_photo: photo006,
        liveness_confidence: confidenceIn,
        liveness_verified: true,
        liveness_confidence_out: confidenceOut,
        liveness_verified_out: true,
        scanned_from_ip: '::1'
      });
    }
  }

  console.log(`Generated ${records.length} realistic attendance records.`);

  // 4. Insert into Supabase attendances table
  const { data: insertedData, error: insErr } = await supabase
    .from('attendances')
    .insert(records)
    .select('id, employee_id, date, status, time_in, time_out');

  if (insErr) {
    throw new Error(`Failed to insert attendance records: ${insErr.message}`);
  }

  console.log(`Successfully inserted ${insertedData.length} records into Supabase!`);
  console.log('===============================================================');
  console.log(`CP-2026-004 (${emp004.first_name} ${emp004.last_name}):`);
  console.log(`  - 10 Present/OT days`);
  console.log(`  - 2 Late days (Aug 5, Aug 12)`);
  console.log(`  - 1 Absent day (Aug 10)`);
  console.log(`  - 2 Rest Days (Aug 2, Aug 9)`);
  console.log(`CP-2026-006 (${emp006.first_name} ${emp006.last_name}):`);
  console.log(`  - 10 Present/OT days`);
  console.log(`  - 2 Late days (Aug 4, Aug 13)`);
  console.log(`  - 1 Absent day (Aug 6)`);
  console.log(`  - 2 Rest Days (Aug 2, Aug 9)`);
  console.log('===============================================================');
};

seedSpecificAugustAttendance().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
