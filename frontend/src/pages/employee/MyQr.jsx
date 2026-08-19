import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import QRCode from '../../components/QRCode';

const MyQr = () => {
  const [user] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user')) || {};
    } catch {
      return {};
    }
  });

  const [currentTime, setCurrentTime] = useState(new Date());

  // Live real-time clock for pass security verification
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const qrValue = user.company_id || (user.id ? String(user.id) : 'CP-EMPLOYEE');
  const employeeName = user.name || `${user.first_name || 'Employee'} ${user.last_name || ''}`.trim();
  const department = user.department || 'Operations';
  const jobTitle = user.job_title || user.role || 'Staff';
  const shift = user.shift || 'Morning Shift (08:00 - 17:00)';
  const avatarLetter = (user.first_name || employeeName || 'E').charAt(0).toUpperCase();

  const photoUrl = user.company_id && user.id
    ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${user.company_id}/${user.id}.jpg`
    : null;

  return (
    <div className="w-full max-w-sm mx-auto h-[calc(100dvh-7.5rem)] flex items-center justify-center select-none touch-none overflow-hidden font-sans p-2">
      
      {/* Clean Minimalist & Open Display (Uncramped, No Heavy Outer Box) */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="w-full flex flex-col items-center justify-center text-center"
      >
        {/* Personnel Header: Clean, Breathable, Minimal */}
        <div className="flex flex-col items-center mb-4 sm:mb-5">
          <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-900 text-white font-black text-xl flex items-center justify-center overflow-hidden border-2 border-white shadow-md mb-2.5">
            {photoUrl ? (
              <img
                src={photoUrl}
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                alt={employeeName}
                className="w-full h-full object-cover"
              />
            ) : null}
            <span style={{ display: photoUrl ? 'none' : 'flex' }}>
              {avatarLetter}
            </span>
          </div>

          <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-tight">
            {employeeName}
          </h2>
          <p className="text-xs text-slate-500 font-semibold mt-0.5">
            {jobTitle} &bull; {department}
          </p>

          <span className="inline-block mt-2 font-mono text-xs font-black text-slate-700 bg-slate-100 px-3 py-1 rounded-full border border-slate-200/80">
            {qrValue}
          </span>
        </div>

        {/* Large, Pure Optical QR Code */}
        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-center">
          <QRCode
            value={qrValue}
            size={240}
            fgColor="#000000"
            bgColor="#ffffff"
          />
        </div>

        {/* Schedule & Real-Time Sync Footer */}
        <div className="mt-4 sm:mt-5 flex items-center gap-3 text-xs text-slate-400 font-medium">
          <span className="flex items-center gap-1.5 text-slate-500">
            <i className="ti ti-clock-hour-4 text-slate-400" />
            <span>{shift}</span>
          </span>
          <span>&bull;</span>
          <span className="font-mono font-bold text-slate-700">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

      </motion.div>

    </div>
  );
};

export default MyQr;
