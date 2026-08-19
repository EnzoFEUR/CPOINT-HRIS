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

  return (
    <div className="w-full max-w-sm mx-auto h-[calc(100dvh-7.5rem)] max-h-[620px] flex items-center justify-center select-none touch-none overflow-hidden font-sans p-1">
      
      {/* Enterprise Digital Pass Card - Perfectly Centered & Static */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden max-h-full"
      >
        {/* Card Header: Enterprise Solid Banner */}
        <div className="bg-slate-900 px-4 py-3 sm:px-5 sm:py-3.5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 text-white font-black text-xs flex items-center justify-center shadow-xs">
              CP
            </div>
            <div>
              <p className="text-[11px] font-black tracking-wider uppercase leading-none">C-Point Digital ID</p>
              <p className="text-[9px] text-slate-400 font-medium leading-none mt-1">Official Gate Pass</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
        </div>

        {/* High-Contrast Optical QR Centerpiece */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-5 bg-white min-h-0">
          
          {/* Stark White Target Container */}
          <div className="relative p-3.5 sm:p-4 bg-slate-50/70 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-center">
            {/* Viewfinder Target Corner Brackets in Corporate Slate Tone */}
            <span className="absolute top-1.5 left-1.5 w-3 h-3 border-t-2 border-l-2 border-slate-400 rounded-tl-xs" />
            <span className="absolute top-1.5 right-1.5 w-3 h-3 border-t-2 border-r-2 border-slate-400 rounded-tr-xs" />
            <span className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b-2 border-l-2 border-slate-400 rounded-bl-xs" />
            <span className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b-2 border-r-2 border-slate-400 rounded-br-xs" />

            <div className="bg-white p-2 rounded-lg">
              <QRCode
                value={qrValue}
                size={210}
                fgColor="#000000"
                bgColor="#ffffff"
                className="rounded-md"
              />
            </div>
          </div>

          {/* Screen Brightness Cue in Refined Gray Tone */}
          <div className="flex items-center gap-1.5 mt-2.5 text-[10px] font-bold text-slate-500 bg-slate-100/90 px-3 py-1 rounded-full border border-slate-200/80">
            <i className="ti ti-sun text-slate-500 text-xs" />
            <span>Maximize brightness for instant scan</span>
          </div>
        </div>

        {/* Personnel Identification & Schedule Footer: Refined Grayish Tone */}
        <div className="bg-slate-50/80 p-3.5 sm:p-4 border-t border-slate-200/90 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0 flex-1 pr-2">
              <h3 className="text-sm sm:text-base font-black text-slate-900 truncate leading-tight">
                {employeeName}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 font-semibold truncate mt-0.5">
                {jobTitle} &bull; {department}
              </p>
            </div>
            
            {/* Grayish ID Badge */}
            <div className="text-right shrink-0 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">ID Code</p>
              <p className="text-xs font-mono font-black text-slate-800 leading-none mt-1">{qrValue}</p>
            </div>
          </div>

          {/* Schedule & Timing in Neutral Slate */}
          <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px] sm:text-[11px] font-medium text-slate-500">
            <span className="flex items-center gap-1 truncate">
              <i className="ti ti-calendar-time text-slate-400 shrink-0" />
              <span className="truncate">{shift}</span>
            </span>
            <span className="font-mono font-bold text-slate-600 shrink-0 ml-2">
              Gate Clearance
            </span>
          </div>
        </div>
      </motion.div>

    </div>
  );
};

export default MyQr;
