import React, { useState, useEffect, useMemo } from 'react';
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

  // Strict viewport scroll lock and instant scroll-to-top on mount
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyTouchAction = document.body.style.touchAction;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalOverscroll = document.body.style.overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      clearInterval(timer);
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.touchAction = originalBodyTouchAction;
      document.body.style.overscrollBehavior = originalOverscroll;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.overscrollBehavior = '';
    };
  }, []);

  const qrValue = user.company_id || (user.id ? String(user.id) : 'CP-EMPLOYEE');
  const employeeName = user.name || `${user.first_name || 'Employee'} ${user.last_name || ''}`.trim();
  const department = user.department || 'Operations';
  const jobTitle = user.job_title || user.role || 'Staff';
  const shift = user.shift || 'Morning Shift (08:00 - 17:00)';
  const avatarLetter = (user.first_name || employeeName || 'E').charAt(0).toUpperCase();

  const photoUrl = useMemo(() => {
    if (user?.biometric_baseline_path) {
      return user.biometric_baseline_path.startsWith('http')
        ? user.biometric_baseline_path
        : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${user.biometric_baseline_path.replace(/^\/+/, '')}`;
    }
    return user?.company_id && user?.id
      ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${user.company_id}/${user.id}.jpg`
      : null;
  }, [user]);

  return (
    <div className="w-full max-w-sm mx-auto h-full max-h-[calc(100dvh-9rem)] sm:max-h-[calc(100dvh-6rem)] flex flex-col items-center justify-center select-none touch-none overscroll-none overflow-hidden font-sans p-1">

      {/* Vertical ID Smart Badge Card */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-full max-w-[320px] sm:max-w-[340px] bg-white rounded-[1.75rem] border border-slate-200/90 shadow-xl shadow-slate-900/5 p-4 sm:p-5 flex flex-col items-center text-center relative overflow-hidden"
      >
        {/* Top Lanyard Notch Detail */}
        <div className="w-10 h-1 bg-slate-200 rounded-full mb-3" />

        {/* Top Micro-Header */}
        <div className="flex items-center justify-between w-full px-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
          <span>Security Pass</span>
          <span className="font-mono text-slate-600 font-bold">{qrValue}</span>
        </div>

        {/* Centered Employee Portrait Avatar */}
        <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-slate-900 text-white font-black text-lg flex items-center justify-center overflow-hidden ring-4 ring-slate-100 shadow-sm my-1">
          {photoUrl ? (
            <img
              src={photoUrl}
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              alt={employeeName}
              className="w-full h-full object-cover"
            />
          ) : null}
          <span
            className="w-full h-full flex items-center justify-center"
            style={{ display: photoUrl ? 'none' : 'flex' }}
          >
            {avatarLetter}
          </span>
        </div>

        {/* Personnel Name & Role */}
        <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-tight mt-1.5 truncate max-w-full">
          {employeeName}
        </h2>
        <p className="text-[11px] sm:text-xs text-slate-500 font-semibold truncate max-w-full mt-0.5">
          {jobTitle} &bull; {department}
        </p>

        {/* Subtle Dashed Separator */}
        <div className="w-full border-t border-dashed border-slate-200/90 my-3" />

        {/* Optical QR Code */}
        <div className="p-2 bg-slate-50/60 rounded-xl border border-slate-100 flex items-center justify-center">
          <QRCode
            value={qrValue}
            size={200}
            fgColor="#0f172a"
            bgColor="#ffffff"
            className="rounded-lg"
          />
        </div>

        {/* Badge Footer: Shift & Live Clock */}
        <div className="mt-3.5 pt-2.5 border-t border-slate-100 w-full flex items-center justify-between text-[10px] sm:text-[11px] text-slate-400 font-medium px-1">
          <span className="truncate max-w-[150px] text-left">{shift}</span>
          <span className="font-mono font-bold tabular-nums text-slate-700 shrink-0 ml-2">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

      </motion.div>
    </div>
  );
};

export default MyQr;
