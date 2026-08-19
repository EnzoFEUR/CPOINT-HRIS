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

  const formattedDate = currentTime.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  return (
    <div className="w-full max-w-sm sm:max-w-md mx-auto h-full flex flex-col justify-start select-none touch-none overscroll-none overflow-hidden font-sans px-2 sm:px-4 pt-3 sm:pt-4">

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-full flex flex-col"
      >

        {/* ── Employee Identity Header Row ── */}
        <div className="flex items-center justify-between gap-3 w-full mb-5 sm:mb-6 px-1">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* User Avatar */}
            <div className="relative w-12 h-12 rounded-full bg-slate-900 text-white font-bold text-base flex items-center justify-center overflow-hidden ring-2 ring-white shadow-xs shrink-0">
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

            {/* Name & Job Title */}
            <div className="min-w-0 flex-1">
              <h2 className="text-base sm:text-lg font-black text-slate-900 truncate leading-tight">
                {employeeName}
              </h2>
              <p className="text-xs text-slate-500 font-semibold truncate mt-0.5">
                {jobTitle} &middot; {department}
              </p>
            </div>
          </div>

          {/* Company ID Badge Pill */}
          <div className="shrink-0">
            <span className="font-mono text-xs font-bold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 block shadow-2xs">
              {qrValue}
            </span>
          </div>
        </div>

        {/* ── High-Contrast Large Optical QR Card ── */}
        <div className="w-full bg-white rounded-3xl p-5 sm:p-6 flex flex-col items-center justify-center border border-slate-100 shadow-xs">
          <QRCode
            value={qrValue}
            size={260}
            fgColor="#0f172a"
            bgColor="#ffffff"
            className="rounded-xl"
          />
        </div>

        {/* ── Date & Real-Time Sync Footer ── */}
        <div className="mt-5 sm:mt-6 flex items-center justify-between w-full text-xs text-slate-400 font-medium px-2">
          <span>{formattedDate}</span>
          <span className="font-mono font-bold tabular-nums text-slate-700 text-xs sm:text-sm">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

      </motion.div>
    </div>
  );
};

export default MyQr;
