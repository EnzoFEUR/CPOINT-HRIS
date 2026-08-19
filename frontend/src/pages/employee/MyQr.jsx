import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
    <div className="w-full max-w-md mx-auto h-[calc(100dvh-7.5rem)] max-h-[660px] flex flex-col justify-between select-none touch-none overflow-hidden font-sans">
      
      {/* Corporate Digital Credential Card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden"
      >
        {/* Personnel Header: Corporate Badge Style */}
        <div className="p-4 sm:p-5 bg-white border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="relative w-12 h-12 rounded-xl bg-slate-900 text-white font-black text-lg flex items-center justify-center shrink-0 overflow-hidden border border-slate-200">
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
              <h2 className="text-base sm:text-lg font-black text-slate-900 truncate leading-tight">
                {employeeName}
              </h2>
              <p className="text-xs text-slate-500 font-semibold truncate mt-0.5">
                {jobTitle} &bull; {department}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="font-mono text-xs font-black bg-slate-100 text-slate-800 px-2.5 py-1 rounded-md border border-slate-200 block">
              {qrValue}
            </span>
          </div>
        </div>

        {/* High-Contrast Large Optical Scanner Surface */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 bg-slate-50/40">
          <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-center">
            <QRCode
              value={qrValue}
              size={250}
              fgColor="#000000"
              bgColor="#ffffff"
            />
          </div>

          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-3.5 text-center">
            Terminal Optical Scan
          </p>
        </div>

        {/* Corporate Status & Schedule Row */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-slate-900 text-white border-t border-slate-800 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-1.5 text-slate-300">
            <i className="ti ti-clock-hour-4 text-blue-400 text-sm" />
            <span className="font-medium text-[11px] sm:text-xs">{shift}</span>
          </div>

          <div className="font-mono text-[11px] sm:text-xs font-bold text-slate-300">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </motion.div>

      {/* Static Minimal Navigation Bar */}
      <div className="pt-2 px-1 flex items-center justify-between shrink-0">
        <Link
          to="/employee/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200 tap-active transition-colors"
        >
          <i className="ti ti-arrow-left text-sm" /> Back to Dashboard
        </Link>
        <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">
          Verified Credential
        </span>
      </div>

    </div>
  );
};

export default MyQr;
