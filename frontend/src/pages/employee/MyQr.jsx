import React, { useState, useEffect, useMemo } from 'react';
import QRCode from '../../components/QRCode';
import EmployeeAvatar from '../../components/EmployeeAvatar';

const MyQr = () => {
  const [user] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user')) || {};
    } catch {
      return {};
    }
  });

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const qrValue = user.company_id || (user.id ? String(user.id) : 'CP-EMPLOYEE');
  const employeeName = user.name || `${user.first_name || 'Employee'} ${user.last_name || ''}`.trim();
  const department = user.department || 'Operations';
  const jobTitle = user.job_title || user.role || 'Staff';

  const photoUrl = useMemo(() => {
    if (user?.avatar_url) return user.avatar_url;
    if (user?.biometric_baseline_path) {
      return user.biometric_baseline_path.startsWith('http')
        ? user.biometric_baseline_path
        : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${user.biometric_baseline_path.replace(/^\/+/, '')}`;
    }
    return null;
  }, [user]);

  const formattedDate = currentTime.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  return (
    <div className="w-full max-w-sm sm:max-w-md mx-auto font-sans px-2 sm:px-4 pt-3 sm:pt-4">
      <div className="w-full flex flex-col">

        {/* Employee identity header */}
        <div className="flex items-center justify-between gap-3 w-full mb-5 sm:mb-6 px-1">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* User Avatar */}
            <EmployeeAvatar
              employee={user}
              photoUrl={photoUrl}
              size="w-12 h-12"
              rounded="rounded-full"
              border="ring-2 ring-white"
              shadow="shadow-xs"
              theme="dark"
              textSize="text-base"
            />

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

          {/* Company ID badge */}
          <div className="shrink-0">
            <span className="font-mono text-xs font-bold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 block shadow-2xs">
              {qrValue}
            </span>
          </div>
        </div>

        {/* QR Code card */}
        <div className="w-full bg-white rounded-3xl p-5 sm:p-6 flex flex-col items-center justify-center border border-slate-100 shadow-xs">
          <QRCode
            value={qrValue}
            size={260}
            fgColor="#0f172a"
            bgColor="#ffffff"
            className="rounded-xl"
          />
        </div>

        {/* Date and time footer */}
        <div className="mt-5 sm:mt-6 flex items-center justify-between w-full text-xs text-slate-400 font-medium px-2">
          <span>{formattedDate}</span>
          <span className="font-mono font-bold tabular-nums text-slate-700 text-xs sm:text-sm">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

      </div>
    </div>
  );
};

export default MyQr;
