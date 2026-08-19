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
    <div className="w-full max-w-sm sm:max-w-md mx-auto h-[calc(100dvh-7.5rem)] flex items-center justify-center select-none touch-none overflow-hidden font-sans p-1">
      
      {/* Perfectly Centered Corporate Digital Credential Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden max-h-full"
      >
        {/* Personnel Header: Corporate Badge Style */}
        <div className="p-3.5 sm:p-4 bg-white border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-900 text-white font-black text-base sm:text-lg flex items-center justify-center shrink-0 overflow-hidden border border-slate-200">
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

            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-900 truncate leading-tight">
                {employeeName}
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-500 font-semibold truncate mt-0.5">
                {jobTitle} &bull; {department}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="font-mono text-xs font-black bg-slate-100 text-slate-800 px-2 sm:px-2.5 py-1 rounded-md border border-slate-200 block">
              {qrValue}
            </span>
          </div>
        </div>

        {/* High-Contrast Large Optical Scanner Surface */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 bg-slate-50/40 min-h-0">
          <div className="p-3 sm:p-4 bg-white rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-center">
            <QRCode
              value={qrValue}
              size={240}
              fgColor="#000000"
              bgColor="#ffffff"
            />
          </div>

          <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2.5 sm:mt-3 text-center">
            Terminal Optical Scan
          </p>
        </div>

        {/* Corporate Status & Schedule Row */}
        <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 bg-slate-900 text-white border-t border-slate-800 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-1.5 text-slate-300 min-w-0">
            <i className="ti ti-clock-hour-4 text-blue-400 text-sm shrink-0" />
            <span className="font-medium text-[10px] sm:text-xs truncate">{shift}</span>
          </div>

          <div className="font-mono text-[10px] sm:text-xs font-bold text-slate-300 shrink-0 ml-2">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </motion.div>

    </div>
  );
};

export default MyQr;
