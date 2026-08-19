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

  return (
    <div className="w-full max-w-sm mx-auto h-[calc(100dvh-7.5rem)] max-h-[640px] flex flex-col justify-between select-none touch-none overflow-hidden font-sans">
      
      {/* Enterprise Digital Pass Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="flex-1 bg-white rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-900/5 flex flex-col overflow-hidden relative"
      >
        {/* Card Header: Enterprise Badge Info */}
        <div className="bg-slate-900 px-4 py-3 sm:px-5 sm:py-3.5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white font-black text-xs flex items-center justify-center shadow-xs">
              CP
            </div>
            <div>
              <p className="text-[11px] font-black tracking-wider uppercase leading-none">C-Point Digital ID</p>
              <p className="text-[9px] text-slate-400 font-medium leading-none mt-1">Official Gate Pass</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-wider">Active</span>
          </div>
        </div>

        {/* High-Contrast Optical QR Scanner Centerpiece */}
        <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-4 bg-slate-50/50">
          
          {/* QR Target Frame Container (Stark White Background for 100% Optical Sensor Contrast) */}
          <div className="relative p-3 sm:p-4 bg-white rounded-2xl border-2 border-slate-100 shadow-sm flex items-center justify-center">
            {/* Viewfinder Target Corner Brackets */}
            <span className="absolute top-1.5 left-1.5 w-3.5 h-3.5 border-t-2 border-l-2 border-blue-600 rounded-tl-md" />
            <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 border-t-2 border-r-2 border-blue-600 rounded-tr-md" />
            <span className="absolute bottom-1.5 left-1.5 w-3.5 h-3.5 border-b-2 border-l-2 border-blue-600 rounded-bl-md" />
            <span className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5 border-b-2 border-r-2 border-blue-600 rounded-br-md" />

            <QRCode
              value={qrValue}
              size={185}
              fgColor="#000000"
              bgColor="#ffffff"
              className="rounded-lg"
            />
          </div>

          {/* Quick Screen Brightness Hint */}
          <div className="flex items-center gap-1.5 mt-2.5 text-[10px] font-bold text-slate-500 bg-white/80 px-2.5 py-1 rounded-full border border-slate-200/60 shadow-2xs">
            <i className="ti ti-sun text-amber-500 text-xs" />
            <span>Set high brightness for instant scan</span>
          </div>
        </div>

        {/* Personnel Identification & Schedule Footer */}
        <div className="bg-white p-3.5 sm:p-4 border-t border-slate-100 shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="min-w-0 flex-1 pr-2">
              <h3 className="text-sm sm:text-base font-black text-slate-900 truncate leading-tight">
                {employeeName}
              </h3>
              <p className="text-[11px] text-slate-500 font-semibold truncate mt-0.5">
                {jobTitle} &bull; {department}
              </p>
            </div>
            <div className="text-right shrink-0 bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200/60">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">ID Code</p>
              <p className="text-xs font-mono font-black text-blue-600 leading-none mt-1">{qrValue}</p>
            </div>
          </div>

          {/* Real-time Verification Bar */}
          <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-medium text-slate-400">
            <span className="flex items-center gap-1">
              <i className="ti ti-calendar-time text-slate-500" />
              {shift}
            </span>
            <span className="font-mono font-bold text-slate-600">
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Static Non-intrusive Navigation Bar */}
      <div className="pt-2 px-1 flex items-center justify-between shrink-0">
        <Link
          to="/employee/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200 tap-active transition-colors"
        >
          <i className="ti ti-arrow-left text-sm" /> Back to Dashboard
        </Link>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          Secured Pass
        </span>
      </div>

    </div>
  );
};

export default MyQr;
