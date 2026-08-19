import dotenv from 'dotenv';
import { supabase } from './supabaseClient.js';

dotenv.config();

const employees = [
  {
    id: 'b6d33bc8-50eb-4c41-a912-da7c4bf65d28',
    company_id: 'CP-2026-004',
    name: 'Rodge Granado',
    department: 'Factory',
    shift: 'Morning',
    callTime: '08:00',
    endTime: '17:00'
  },
  {
    id: 'a76cd891-3587-4421-9902-02c0a3f4e177',
    company_id: 'CP-2026-005',
    name: 'Ray Ass',
    department: 'Logistics',
    shift: 'Morning',
    callTime: '08:00',
    endTime: '17:00'
  },
  {
    id: '4f34f487-2526-4c09-aeda-52a5576daed3',
    company_id: 'CP-2026-006',
    name: 'Raygener Joson',
    department: 'Retail',
    shift: 'Swing',
    callTime: '14:00',
    endTime: '22:00'
  },
  {
    id: '4b9d7d1d-ca69-4099-9482-9b580658aad3',
    company_id: 'CP-2026-007',
    name: 'Raygener Joson (Staff)',
    department: 'Retail',
    shift: 'Morning',
    callTime: '08:00',
    endTime: '17:00'
  }
];

// Define daily profiles for each employee for the whole month of August 2026 (Aug 1 to Aug 31)
const seedAttendance = async () => {
  console.log('--- Starting August 2026 Attendance & Work Schedule Seeding ---');

  // Clear existing attendance for August 2026
  console.log('Cleaning up existing August 2026 attendances...');
  const { error: delErr } = await supabase
    .from('attendances')
    .delete()
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-31');

  if (delErr) console.warn('Delete warning:', delErr.message);

  const records = [];

  // Helper to construct ISO timestamp with Asia/Manila offset (+08:00)
  const makeTimestamp = (dateStr, timeStr) => {
    return `${dateStr}T${timeStr}:00+08:00`;
  };

  // Helper for random integer in range [min, max]
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // August 2026 days (1 to 31)
  for (let day = 1; day <= 31; day++) {
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `2026-08-${dayStr}`;
    const dateObj = new Date(`2026-08-${dayStr}T00:00:00+08:00`);
    const dayOfWeek = dateObj.getDay(); // 0 = Sun, 6 = Sat

    // Process each employee
    for (const emp of employees) {
      const photoPath = `face-baselines/${emp.company_id}/${emp.id}.jpg`;
      const isSunday = dayOfWeek === 0;
      const isSaturday = dayOfWeek === 6;

      // Sundays are Rest Days for all
      if (isSunday) continue;

      let isWorking = true;
      let isLate = false;
      let isOvertime = false;
      let isAbsent = false;
      let inTimeStr = '';
      let outTimeStr = '';

      // --- EMPLOYEE 1: Rodge Granado (Factory / Morning Shift) ---
      if (emp.company_id === 'CP-2026-004') {
        if (isSaturday) {
          // Works selected Saturday overtime shifts (Aug 1, Aug 15)
          if (day === 1 || day === 15) {
            inTimeStr = `07:55`;
            outTimeStr = `15:30`; // 7.5 hrs Sat OT
          } else {
            isWorking = false;
          }
        } else if (day === 14) {
          // Sick Leave / Absent on Friday Aug 14
          isAbsent = true;
        } else if (day === 11) {
          // Late on Tuesday Aug 11 (traffic delay)
          isLate = true;
          inTimeStr = `08:38`;
          outTimeStr = `18:30`; // 1.5 hrs OT
        } else if (day === 26) {
          // Late on Wednesday Aug 26
          isLate = true;
          inTimeStr = `08:24`;
          outTimeStr = `17:15`;
        } else {
          // Regular day with frequent factory overtime (Tue/Thu)
          const inMin = randInt(45, 58);
          inTimeStr = `07:${String(inMin).padStart(2, '0')}`;

          if ([4, 6, 12, 18, 25, 27].includes(day)) {
            // High Overtime day (2 to 3.5 hrs OT)
            const outHour = randInt(19, 20);
            const outMin = randInt(10, 45);
            outTimeStr = `${String(outHour).padStart(2, '0')}:${String(outMin).padStart(2, '0')}`;
          } else {
            // Regular out
            const outMin = randInt(5, 20);
            outTimeStr = `17:${String(outMin).padStart(2, '0')}`;
          }
        }
      }

      // --- EMPLOYEE 2: Ray Ass (Logistics / Morning Shift) ---
      else if (emp.company_id === 'CP-2026-005') {
        if (isSaturday) {
          // Works weekend delivery on Aug 8 & Aug 22
          if (day === 8 || day === 22) {
            inTimeStr = `07:50`;
            outTimeStr = `16:00`;
          } else {
            isWorking = false;
          }
        } else if (day === 6 || day === 17) {
          // Absent on Aug 6 and Aug 17
          isAbsent = true;
        } else if (day === 4) {
          // Late on Aug 4 (Delivery dispatch delay)
          isLate = true;
          inTimeStr = `08:28`;
          outTimeStr = `17:30`;
        } else if (day === 12) {
          // Late on Aug 12
          isLate = true;
          inTimeStr = `08:42`;
          outTimeStr = `17:30`;
        } else if (day === 18) {
          // Late on Aug 18
          isLate = true;
          inTimeStr = `08:35`;
          outTimeStr = `17:40`;
        } else if (day === 27) {
          // Late on Aug 27
          isLate = true;
          inTimeStr = `08:25`;
          outTimeStr = `17:15`;
        } else {
          // Regular day
          const inMin = randInt(50, 59);
          inTimeStr = `07:${String(inMin).padStart(2, '0')}`;

          if ([7, 14, 21, 28].includes(day)) {
            // Friday warehouse inventory OT (2 to 2.5 hrs)
            const outMin = randInt(15, 45);
            outTimeStr = `19:${String(outMin).padStart(2, '0')}`;
          } else {
            const outMin = randInt(5, 25);
            outTimeStr = `17:${String(outMin).padStart(2, '0')}`;
          }
        }
      }

      // --- EMPLOYEE 3: Raygener Joson (Retail / Swing Shift 14:00 - 22:00) ---
      else if (emp.company_id === 'CP-2026-006') {
        if (isSaturday) {
          // Retail store open on Saturdays (Aug 1, 8, 15, 22, 29)
          inTimeStr = `13:48`;
          outTimeStr = `22:30`;
        } else if (day === 10 || day === 24) {
          // Absent on Aug 10 & Aug 24
          isAbsent = true;
        } else if (day === 5) {
          // Late on Aug 5
          isLate = true;
          inTimeStr = `14:35`;
          outTimeStr = `23:00`; // 1 hr OT
        } else if (day === 13) {
          // Late on Aug 13
          isLate = true;
          inTimeStr = `14:40`;
          outTimeStr = `22:30`;
        } else if (day === 28) {
          // Late on Aug 28
          isLate = true;
          inTimeStr = `14:30`;
          outTimeStr = `23:30`; // 1.5 hrs OT
        } else {
          // Regular Swing shift
          const inMin = randInt(45, 58);
          inTimeStr = `13:${String(inMin).padStart(2, '0')}`;

          if ([7, 14, 21].includes(day)) {
            // Friday Night closing OT
            const outMin = randInt(30, 55);
            outTimeStr = `23:${String(outMin).padStart(2, '0')}`;
          } else {
            const outMin = randInt(5, 20);
            outTimeStr = `22:${String(outMin).padStart(2, '0')}`;
          }
        }
      }

      // --- EMPLOYEE 4: Raygener Joson Staff (Retail / Morning Shift 08:00 - 17:00) ---
      else if (emp.company_id === 'CP-2026-007') {
        if (isSaturday) {
          isWorking = false;
        } else if (day === 13) {
          // Absent on Aug 13
          isAbsent = true;
        } else if (day === 7) {
          // Late on Aug 7
          isLate = true;
          inTimeStr = `08:45`;
          outTimeStr = `18:00`;
        } else if (day === 21) {
          // Late on Aug 21
          isLate = true;
          inTimeStr = `08:32`;
          outTimeStr = `17:45`;
        } else {
          // Regular day
          const inMin = randInt(48, 59);
          inTimeStr = `07:${String(inMin).padStart(2, '0')}`;

          if ([14, 28].includes(day)) {
            // Friday OT
            outTimeStr = `18:30`;
          } else {
            const outMin = randInt(2, 15);
            outTimeStr = `17:${String(outMin).padStart(2, '0')}`;
          }
        }
      }

      // If not scheduled or rest day
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

  console.log(`Generated ${records.length} realistic August 2026 attendance records.`);

  // Insert in batches of 50
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error: insErr } = await supabase.from('attendances').insert(batch);
    if (insErr) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, insErr.message);
    } else {
      console.log(`Batch ${i / batchSize + 1} (${batch.length} records) inserted successfully.`);
    }
  }

  console.log('--- August 2026 Attendance Seeding Completed Successfully ---');
};

seedAttendance().catch(err => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
