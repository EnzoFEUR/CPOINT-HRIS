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
    <div className="w-full max-w-md mx-auto h-[calc(100dvh-7.5rem)] max-h-[660px] flex flex-col justify-between select-none touch-none overflow-hidden font-sans">
      
      {/* Enterprise Digital Pass Card - Minimal Modern Clean */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden"
      >
        {/* Card Header: Minimal Enterprise Solid Banner */}
        <div className="bg-slate-900 px-4 py-3 sm:px-5 sm:py-3.5 text-white flex items-center justify-between shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-blue-600 text-white font-black text-xs flex items-center justify-center">
              CP
            </div>
            <div>
              <p className="text-xs font-black tracking-wide uppercase leading-none">C-Point Digital Pass</p>
              <p className="text-[10px] text-slate-400 font-medium leading-none mt-1">Official Gate Clearance</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[9px] font-mono text-slate-400 font-bold uppercase tracking-wider">
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
        </div>

        {/* High-Contrast Large Optical QR Display Centerpiece */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 bg-slate-50/60">
          <div className="p-3.5 sm:p-4 bg-white rounded-lg border border-slate-200 shadow-2xs flex items-center justify-center">
            <QRCode
              value={qrValue}
              size={240}
              fgColor="#000000"
              bgColor="#ffffff"
            />
          </div>

          <p className="text-[11px] font-bold text-slate-500 mt-3 text-center">
            Present code to terminal scanner
          </p>
        </div>

        {/* Dynamic Personnel Identification & Schedule Footer */}
        <div className="bg-white p-4 border-t border-slate-200 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm sm:text-base font-black text-slate-900 truncate leading-tight">
                {employeeName}
              </h3>
              <p className="text-xs text-slate-500 font-semibold truncate mt-0.5">
                {jobTitle} &bull; {department}
              </p>
            </div>
            <div className="text-right shrink-0 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none">ID Number</p>
              <p className="text-xs font-mono font-black text-blue-600 leading-none mt-1">{qrValue}</p>
            </div>
          </div>

          {/* Schedule Row */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span className="flex items-center gap-1.5">
              <i className="ti ti-clock text-slate-400" />
              <span>Shift:</span>
              <span className="font-bold text-slate-700">{shift}</span>
            </span>
          </div>
        </div>
      </motion.div>

      {/* Static Navigation Bar */}
      <div className="pt-2 px-1 flex items-center justify-between shrink-0">
        <Link
          to="/employee/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200 tap-active transition-colors"
        >
          <i className="ti ti-arrow-left text-sm" /> Back to Dashboard
        </Link>
        <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">
          #CPOINT-PASS
        </span>
      </div>

    </div>
  );
};

export default MyQr;
