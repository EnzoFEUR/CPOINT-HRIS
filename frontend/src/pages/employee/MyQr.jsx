import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import QRCode from '../../components/QRCode';
import EmployeeAvatar from '../../components/EmployeeAvatar';
import { fetchWithAuth } from '../../utils/api';
import { supabase } from '../../supabaseClient';
import { getDisciplinaryCache, setDisciplinaryCache, clearDisciplinaryCache } from '../../utils/disciplinaryCache';

const MyQr = () => {
  const [user] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user')) || {};
    } catch {
      return {};
    }
  });

  const [currentTime, setCurrentTime] = useState(new Date());

  // Read initial disciplinary status from cache
  const [disciplinaryState, setDisciplinaryState] = useState(() => getDisciplinaryCache(user?.id));

  // Medical Grace / Biometric Exemption State
  const [medicalExemption, setMedicalExemption] = useState(() => {
    if (!user?.medical_record_url) return null;
    try {
      const parsed = typeof user.medical_record_url === 'string' ? JSON.parse(user.medical_record_url) : user.medical_record_url;
      return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch {
      return null;
    }
  });

  const isMedicalExempt = useMemo(() => {
    if (!medicalExemption?.exempt) return false;
    const today = new Date().toISOString().split('T')[0];
    return !medicalExemption.valid_until || medicalExemption.valid_until >= today;
  }, [medicalExemption]);

  const daysRemaining = useMemo(() => {
    if (!isMedicalExempt || !medicalExemption?.valid_until) return null;
    const diff = Math.ceil((new Date(medicalExemption.valid_until).getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  }, [isMedicalExempt, medicalExemption]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen for disciplinary cache updates
  useEffect(() => {
    const handleSync = (e) => {
      if (!user?.id || e.detail?.userId === user.id) {
        setDisciplinaryState(getDisciplinaryCache(user?.id));
      }
    };
    window.addEventListener('hris_disciplinary_sync', handleSync);
    return () => window.removeEventListener('hris_disciplinary_sync', handleSync);
  }, [user?.id]);

  const checkDisciplinary = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetchWithAuth(`/api/disciplinary?employee_id=${user.id}`);
      if (res.ok) {
        const logs = await res.json();
        const activeTerm = (logs || []).find(l => l.type === 'Termination');
        const activeSusp = (logs || []).find(l => l.type === 'Suspension' && l.status !== 'Resolved');

        if (activeTerm) {
          const statusObj = { type: 'Termination', record: activeTerm };
          setDisciplinaryCache(user.id, statusObj);
          setDisciplinaryState(getDisciplinaryCache(user.id));
        } else if (activeSusp) {
          const statusObj = { type: 'Suspension', record: activeSusp };
          setDisciplinaryCache(user.id, statusObj);
          setDisciplinaryState(getDisciplinaryCache(user.id));
        } else {
          clearDisciplinaryCache(user.id);
          setDisciplinaryState(getDisciplinaryCache(user.id));
        }
      }
    } catch (err) {
      console.warn('Disciplinary sync note:', err.message);
    }
  }, [user?.id]);

  const syncProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetchWithAuth('/api/profile');
      if (res.ok) {
        const data = await res.json();
        const emp = data.employee || data.user || null;
        if (emp?.medical_record_url) {
          try {
            const parsed = typeof emp.medical_record_url === 'string' ? JSON.parse(emp.medical_record_url) : emp.medical_record_url;
            setMedicalExemption(parsed);
          } catch (_) {}
        } else if (emp && emp.medical_record_url === null) {
          setMedicalExemption(null);
        }
      }
    } catch (_) {}
  }, [user?.id]);

  useEffect(() => {
    checkDisciplinary();
    syncProfile();

    if (!user?.id) return;
    const channel = supabase
      .channel(`qr-realtime-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplinary_logs' }, () => {
        checkDisciplinary();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
        checkDisciplinary();
        syncProfile();
      })
      .on('broadcast', { event: 'BIOMETRIC_EXEMPTION_UPDATED' }, ({ payload }) => {
        if (payload?.employee_id === user.id) {
          if (payload.is_exempt && payload.exemption) {
            setMedicalExemption(payload.exemption);
            toast.success('Medical Grace active: Face scan bypassed at kiosk.');
          } else {
            setMedicalExemption(null);
            toast('Medical Grace ended: Standard dual-factor verification restored.');
          }
          syncProfile();
        }
      })
      .on('broadcast', { event: 'BIOMETRICS_RESET' }, ({ payload }) => {
        if (payload?.employee_id === user.id) {
          syncProfile();
        }
      })
      .subscribe();

    const broadcastBus = supabase
      .channel('disciplinary_realtime_sync')
      .on('broadcast', { event: 'DISCIPLINARY_CREATED' }, ({ payload }) => {
        if (payload?.employee_id === user.id) {
          if (payload.type === 'Suspension') {
            const statusObj = { type: 'Suspension', record: payload, isSuspended: true };
            setDisciplinaryCache(user.id, statusObj);
            setDisciplinaryState(statusObj);
          } else if (payload.type === 'Termination') {
            const statusObj = { type: 'Termination', record: payload, isTerminated: true };
            setDisciplinaryCache(user.id, statusObj);
            setDisciplinaryState(statusObj);
          }
          checkDisciplinary();
        }
      })
      .on('broadcast', { event: 'DISCIPLINARY_OVERTURNED' }, ({ payload }) => {
        if (payload?.employee_id === user.id) {
          clearDisciplinaryCache(user.id);
          setDisciplinaryState({ isSuspended: false, isTerminated: false, record: null });
          checkDisciplinary();
        }
      })
      .on('broadcast', { event: 'DISCIPLINARY_RESOLVED' }, ({ payload }) => {
        if (payload?.employee_id === user.id) {
          clearDisciplinaryCache(user.id);
          setDisciplinaryState({ isSuspended: false, isTerminated: false, record: null });
          checkDisciplinary();
        }
      })
      .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, ({ payload }) => {
        if (payload?.employee_id === user.id) {
          clearDisciplinaryCache(user.id);
          setDisciplinaryState({ isSuspended: false, isTerminated: false, record: null });
          checkDisciplinary();
        }
      })
      .subscribe();

    const scannerChannel = supabase
      .channel('scanner_disciplinary_realtime')
      .on('broadcast', { event: 'BIOMETRIC_EXEMPTION_UPDATED' }, ({ payload }) => {
        if (payload?.employee_id === user.id) {
          if (payload.is_exempt && payload.exemption) {
            setMedicalExemption(payload.exemption);
          } else if (!payload.is_exempt) {
            setMedicalExemption(null);
          }
          syncProfile();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(broadcastBus);
      supabase.removeChannel(scannerChannel);
    };
  }, [user?.id, checkDisciplinary, syncProfile]);

  const isSuspended = disciplinaryState.isSuspended || (user?.status === 'inactive' && !disciplinaryState.isTerminated);
  const isTerminated = disciplinaryState.isTerminated;

  const suspensionEndDate = useMemo(() => {
    if (!isSuspended || !disciplinaryState?.record?.reason) return null;
    const match = disciplinaryState.record.reason.match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    return match ? match[1] : null;
  }, [isSuspended, disciplinaryState]);

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
              border={isTerminated ? "ring-2 ring-rose-300" : isSuspended ? "ring-2 ring-orange-300" : "ring-2 ring-white"}
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

          {/* Status / Company ID badge */}
          <div className="shrink-0 flex items-center gap-1.5">
            {isTerminated ? (
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                Separated
              </span>
            ) : isSuspended ? (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                Suspended
              </span>
            ) : isMedicalExempt ? (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 flex items-center gap-1">
                <i className="ti ti-first-aid-kit text-xs text-amber-700" />
                <span>Medical Grace</span>
              </span>
            ) : (
              <span className="font-mono text-xs font-bold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 block shadow-2xs">
                {qrValue}
              </span>
            )}
          </div>
        </div>

        {isTerminated ? (
          <div className="w-full bg-white rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center border border-rose-200 shadow-sm text-center">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mb-4">
              <i className="ti ti-user-x text-2xl" />
            </div>
            <span className="px-2.5 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-bold uppercase tracking-wider rounded-full mb-2">
              Pass Deactivated
            </span>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">Attendance Pass Revoked</h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-xs mt-1.5 font-medium">
              This account has been separated. Operational attendance credentials are permanently closed. You can view your archived payslips on the dashboard.
            </p>
            <div className="mt-5 w-full">
              <Link 
                to="/employee/dashboard" 
                className="w-full py-2.5 bg-slate-900 hover:bg-black text-white font-medium text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                <i className="ti ti-receipt text-sm" />
                <span>View Historical Payslips</span>
              </Link>
            </div>
          </div>
        ) : isSuspended ? (
          <div className="w-full bg-white rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center border border-amber-200 shadow-sm text-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mb-4">
              <i className="ti ti-lock text-2xl" />
            </div>
            <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider rounded-full mb-2">
              Attendance Suspended
            </span>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">Credential Paused</h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-xs mt-1.5 font-medium">
              Attendance tracking is deactivated during your disciplinary suspension. Clock-in is not permitted until reinstated by HR.
            </p>

            {suspensionEndDate && (
              <div className="mt-4 p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-left w-full text-xs">
                <div className="flex items-center justify-between font-bold text-amber-900">
                  <span>Scheduled End:</span>
                  <span className="font-mono">{suspensionEndDate}</span>
                </div>
              </div>
            )}

            <div className="mt-5 w-full space-y-2">
              <Link 
                to="/employee/dashboard?view=disciplinary" 
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                <i className="ti ti-file-text text-sm" />
                <span>Review Disciplinary Notice</span>
              </Link>
              <Link 
                to="/employee/dashboard" 
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                <i className="ti ti-receipt text-sm" />
                <span>View Payslips</span>
              </Link>
            </div>
          </div>
        ) : !disciplinaryState.checked ? (
          <div className="w-full bg-white rounded-3xl p-8 flex flex-col items-center justify-center border border-slate-100 shadow-xs min-h-[290px]">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-3" />
            <span className="text-xs text-slate-400 font-medium">Verifying access...</span>
          </div>
        ) : (
          <div className="w-full bg-white rounded-3xl p-5 sm:p-6 flex flex-col items-center justify-center border border-slate-100 shadow-xs">
            <QRCode
              value={qrValue}
              size={260}
              fgColor="#0f172a"
              bgColor="#ffffff"
              className="rounded-xl"
            />
          </div>
        )}

        {/* Medical Grace Exemption Status Callout */}
        {isMedicalExempt && !isTerminated && !isSuspended && (
          <div className="w-full mt-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-left shadow-2xs">
            <div className="flex items-center gap-2 text-amber-950 font-bold text-xs">
              <i className="ti ti-first-aid-kit text-base text-amber-700 shrink-0" />
              <span>Medical Grace Protocol Active</span>
            </div>
            <p className="text-[11px] text-amber-900/85 mt-1 leading-relaxed font-medium">
              Facial biometric comparison is waived for temporary recovery. Hold this QR badge up to the kiosk camera to record attendance.
            </p>
            {medicalExemption?.valid_until && (
              <div className="mt-2 pt-2 border-t border-amber-200/70 flex items-center justify-between text-[11px] font-mono text-amber-950 font-bold">
                <span>Valid through: {medicalExemption.valid_until}</span>
                {daysRemaining !== null && (
                  <span className="px-2 py-0.5 bg-amber-200/70 text-amber-950 rounded text-[10px] font-sans font-bold">
                    {daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining
                  </span>
                )}
              </div>
            )}
            {medicalExemption?.granted_by && (
              <p className="mt-1.5 text-[10px] text-amber-900/80 font-medium flex items-center gap-1">
                <i className="ti ti-user-check text-amber-700" />
                <span>Authorized by: <strong>{/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(medicalExemption.granted_by) ? 'System Administrator (HR)' : (medicalExemption.granted_by_role ? `${medicalExemption.granted_by} (${medicalExemption.granted_by_role})` : medicalExemption.granted_by)}</strong></span>
              </p>
            )}
          </div>
        )}

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
