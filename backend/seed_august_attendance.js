import dotenv from 'dotenv';
import { supabase } from './supabaseClient.js';

dotenv.config();

/**
 * Seed August 2026 Attendance Records for Days 1 to 15
 */
const seedAugustAttendance = async () => {
  console.log('=== Starting August 1 - 15, 2026 Attendance Seeding ===');

  // 1. Fetch real active employees from the database
  const { data: dbEmployees, error: empErr } = await supabase
    .from('employees')
    .select('*')
    .not('company_id', 'is', null);

  if (empErr) {
    throw new Error(`Failed to fetch employees: ${empErr.message}`);
  }

  if (!dbEmployees || dbEmployees.length === 0) {
    throw new Error('No active employees found with valid company_id.');
  }

  console.log(`Found ${dbEmployees.length} active employees to seed attendance for.`);

  // 2. Clean up existing attendances for August 2026 (Aug 1 to Aug 31)
  console.log('Cleaning up existing August 2026 attendances...');
  const { error: delErr } = await supabase
    .from('attendances')
    .delete()
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-31');

  if (delErr) {
    console.warn('Delete warning:', delErr.message);
  } else {
    console.log('Existing August attendance cleared.');
  }

  const records = [];

  // Helper to construct ISO timestamp with Asia/Manila offset (+08:00)
  const makeTimestamp = (dateStr, timeStr) => {
    return `${dateStr}T${timeStr}:00+08:00`;
  };

  // Helper for random integer in range [min, max]
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // 3. Generate attendance records strictly for August 1 to August 15, 2026
  const START_DAY = 1;
  const END_DAY = 15;

  for (let day = START_DAY; day <= END_DAY; day++) {
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `2026-08-${dayStr}`;
    const dateObj = new Date(`2026-08-${dayStr}T00:00:00+08:00`);
    const dayOfWeek = dateObj.getDay(); // 0 = Sun, 6 = Sat

    const isSunday = dayOfWeek === 0;
    const isSaturday = dayOfWeek === 6;

    // Sundays are rest days for all staff
    if (isSunday) continue;

    for (const emp of dbEmployees) {
      const photoPath = `face-baselines/${emp.company_id}/${emp.id}.jpg`;
      const shift = emp.shift || 'Morning';
      const dept = (emp.department || 'General').toLowerCase();

      let isWorking = true;
      let isLate = false;
      let isAbsent = false;
      let inTimeStr = '';
      let outTimeStr = '';

      if (isSaturday) {
        // Factory / Logistics work select Saturday morning overtime shifts (Aug 1, Aug 8, Aug 15)
        if (dept.includes('factory') || dept.includes('logistics') || dept.includes('retail')) {
          if (day === 1 || day === 8 || day === 15) {
            inTimeStr = shift === 'Swing' ? '13:50' : '07:55';
            outTimeStr = shift === 'Swing' ? '22:00' : '15:30';
          } else {
            isWorking = false;
          }
        } else {
          isWorking = false;
        }
      } else {
        // Weekday Attendance logic based on shift
        if (shift === 'Swing') {
          // Swing Shift: 14:00 - 22:00
          if (day === 5 || day === 13) {
            // Occasional late arrival
            isLate = true;
            const inMin = randInt(35, 45);
            inTimeStr = `14:${String(inMin).padStart(2, '0')}`;
            outTimeStr = `22:30`;
          } else if (day === 10 && dept.includes('retail')) {
            // Occasional absent
            isAbsent = true;
          } else {
            // On-time swing shift
            const inMin = randInt(42, 57);
            inTimeStr = `13:${String(inMin).padStart(2, '0')}`;
            
            if (day === 7 || day === 14) {
              // Friday closing OT
              outTimeStr = `23:${String(randInt(15, 45)).padStart(2, '0')}`;
            } else {
              outTimeStr = `22:${String(randInt(5, 25)).padStart(2, '0')}`;
            }
          }
        } else if (shift === 'Night') {
          // Night Shift: 22:00 - 06:00
          if (day === 4 || day === 11) {
            isLate = true;
            inTimeStr = `22:${String(randInt(32, 45)).padStart(2, '0')}`;
            outTimeStr = `06:30`;
          } else {
            inTimeStr = `21:${String(randInt(45, 58)).padStart(2, '0')}`;
            outTimeStr = `06:${String(randInt(5, 20)).padStart(2, '0')}`;
          }
        } else {
          // Morning Shift: 08:00 - 17:00
          if (day === 4 || day === 11) {
            // Occasional late on Tue/Thu
            isLate = true;
            const inMin = randInt(32, 48);
            inTimeStr = `08:${String(inMin).padStart(2, '0')}`;
            outTimeStr = `17:45`;
          } else if (day === 14 && dept.includes('factory')) {
            // Occasional leave/absent on Aug 14
            isAbsent = true;
          } else {
            // On-time morning
            const inMin = randInt(45, 58);
            inTimeStr = `07:${String(inMin).padStart(2, '0')}`;

            if ([4, 6, 12].includes(day)) {
              // Overtime days (1.5 to 2.5 hrs OT)
              const outHour = randInt(18, 19);
              const outMin = randInt(15, 45);
              outTimeStr = `${String(outHour).padStart(2, '0')}:${String(outMin).padStart(2, '0')}`;
            } else {
              const outMin = randInt(5, 20);
              outTimeStr = `17:${String(outMin).padStart(2, '0')}`;
            }
          }
        }
      }

      if (!isWorking && !isAbsent) continue;

      if (isAbsent) {
        records.push({
          employee_id: emp.id,
          date: dateStr,
          time_in: null,
          time_out: null,
          status: 'Absent',
          time_in_photo: null,
          time_out_photo: null,
          liveness_confidence: 0,
          liveness_verified: false,
          scanned_from_ip: '127.0.0.1'
        });
      } else {
        const timeInISO = makeTimestamp(dateStr, inTimeStr);
        const timeOutISO = makeTimestamp(dateStr, outTimeStr);
        const status = isLate ? 'Late' : 'Present';

        records.push({
          employee_id: emp.id,
          date: dateStr,
          time_in: timeInISO,
          time_out: timeOutISO,
          status: status,
          time_in_photo: photoPath,
          time_out_photo: photoPath,
          liveness_confidence: (0.92 + Math.random() * 0.07),
          liveness_verified: true,
          scanned_from_ip: '127.0.0.1'
        });
      }
    }
  }

  console.log(`Generated ${records.length} realistic attendance records for August 1 to 15, 2026.`);

  // 4. Batch insert records into Supabase attendances
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error: insErr } = await supabase.from('attendances').insert(batch);
    if (insErr) {
      console.error(`Error inserting batch ${Math.floor(i / batchSize) + 1}:`, insErr.message);
    } else {
      console.log(`Batch ${Math.floor(i / batchSize) + 1} (${batch.length} records) inserted successfully.`);
    }
  }

  console.log('=== August 1 - 15, 2026 Attendance Seeding Complete ===');
};

seedAugustAttendance().catch(err => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
