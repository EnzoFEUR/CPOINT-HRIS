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
    <div className="w-full max-w-sm mx-auto h-full max-h-[calc(100dvh-9rem)] sm:max-h-[calc(100dvh-6rem)] flex flex-col items-center justify-center select-none touch-none overscroll-none overflow-hidden font-sans px-2 sm:px-4">

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="w-full flex flex-col items-center"
      >

        {/* ── Employee Identity ── */}
        <div className="flex items-center gap-3 mb-4 w-full">
          <div className="relative w-11 h-11 rounded-full bg-slate-800 text-white font-bold text-sm flex items-center justify-center overflow-hidden ring-2 ring-white shrink-0">
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
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-slate-900 truncate leading-tight">
              {employeeName}
            </h2>
            <p className="text-[11px] text-slate-500 font-medium truncate">
              {jobTitle} &bull; {department}
            </p>
          </div>
          <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 shrink-0">
            {qrValue}
          </span>
        </div>

        {/* ── QR Code ── */}
        <div className="w-full bg-white rounded-2xl p-4 sm:p-5 flex flex-col items-center border border-slate-200/70 shadow-xs">
          <QRCode
            value={qrValue}
            size={240}
            fgColor="#0f172a"
            bgColor="#ffffff"
          />
        </div>

        {/* ── Timestamp ── */}
        <div className="mt-3.5 flex items-center justify-between w-full text-[11px] text-slate-400 font-medium px-1">
          <span>{formattedDate}</span>
          <span className="font-mono font-bold tabular-nums text-slate-600">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

      </motion.div>
    </div>
  );
};

export default MyQr;
