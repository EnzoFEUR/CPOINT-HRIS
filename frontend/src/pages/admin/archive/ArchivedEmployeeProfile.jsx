import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { supabase } from '../../../supabaseClient';
import { fetchWithAuth } from '../../../utils/api';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// ---------- helpers ----------

const AVATAR_PALETTE = [
  { bg: 'bg-blue-500/20', text: 'text-blue-300', ring: 'ring-blue-500/30' },
  { bg: 'bg-violet-500/20', text: 'text-violet-300', ring: 'ring-violet-500/30' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-300', ring: 'ring-emerald-500/30' },
  { bg: 'bg-amber-500/20', text: 'text-amber-300', ring: 'ring-amber-500/30' },
  { bg: 'bg-rose-500/20', text: 'text-rose-300', ring: 'ring-rose-500/30' },
];

function getInitials(first, last) {
  const a = (first || '').trim()[0] || '';
  const b = (last || '').trim()[0] || '';
  return (a + b).toUpperCase() || '—';
}

function paletteFor(seed) {
  const s = (seed || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[s % AVATAR_PALETTE.length];
}

function formatDate(value, opts) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, opts || { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function pick(obj, keys, fallback = null) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback;
}

function docIcon(name = '') {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['pdf'].includes(ext)) return { icon: 'ti-file-type-pdf', color: 'text-rose-500 bg-rose-50' };
  if (['doc', 'docx'].includes(ext)) return { icon: 'ti-file-type-doc', color: 'text-blue-500 bg-blue-50' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { icon: 'ti-file-type-xls', color: 'text-emerald-500 bg-emerald-50' };
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return { icon: 'ti-photo', color: 'text-violet-500 bg-violet-50' };
  return { icon: 'ti-file-text', color: 'text-slate-500 bg-slate-100' };
}

function StatCard({ icon, label, children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className="flex items-center gap-3.5 p-4 rounded-xl bg-slate-50/70 border border-slate-200/60">
      <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${tones[tone]}`}>
        <i className={`ti ${icon} text-xl`}></i>
      </div>
      <div className="min-w-0">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">{label}</span>
        <div className="text-sm font-bold text-slate-800 mt-0.5 truncate">{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
        <i className={`ti ${icon} text-2xl text-slate-400`}></i>
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {hint && <p className="text-xs text-slate-400 mt-1 max-w-sm">{hint}</p>}
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-10 w-36 bg-slate-200 rounded-xl" />
      <div className="h-44 bg-slate-900/10 rounded-2xl" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 bg-slate-200 rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-slate-200 rounded-2xl" />
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'ti-user' },
  { id: 'documents', label: 'Documents', icon: 'ti-folder' },
  { id: 'payroll', label: 'Payroll', icon: 'ti-cash' },
  { id: 'leave', label: 'Leave', icon: 'ti-beach' },
  { id: 'disciplinary', label: 'Disciplinary', icon: 'ti-shield-exclamation' },
  { id: 'attendance', label: 'Attendance', icon: 'ti-qrcode' },
];

export default function ArchivedEmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [documents, setDocuments] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [disciplinary, setDisciplinary] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 });

  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    fetchArchivedEmployeeData();
  }, [id]);

  const fetchArchivedEmployeeData = async () => {
    setLoading(true);
    setNotFound(false);

    try {
      const { data: empData, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();

      if (empError || !empData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setEmployee(empData);

      const [docsRes, payrollRes, leaveRes, discRes, attRes] = await Promise.all([
        supabase.from('employee_documents').select('*').eq('employee_id', id),
        supabase.from('payrolls').select('*').eq('employee_id', id),
        supabase.from('leave_requests').select('*').eq('employee_id', id),
        supabase.from('disciplinary_logs').select('*').eq('employee_id', id),
        supabase.from('attendances').select('*').eq('employee_id', id),
      ]);

      setDocuments(docsRes.data || []);
      setPayroll(payrollRes.data || []);
      setLeaves(leaveRes.data || []);
      setDisciplinary(discRes.data || []);
      setAttendance(attRes.data || []);
    } catch (err) {
      console.error('Error fetching archived profile:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const getCompanyId = () => {
    if (!employee) return 'N/A';
    return (
      employee.company_id ||
      employee.employee_no ||
      employee.employee_id ||
      employee.emp_id ||
      employee.emp_no ||
      employee.id_number ||
      'N/A'
    );
  };

  const handleRestore = async () => {
    if (!employee) return;
    setIsRestoring(true);
    try {
      const targetId = employee.id;

      // Primary: Call the enterprise restore endpoint
      let restoredSuccessfully = false;
      try {
        const res = await fetchWithAuth(`/api/employees/${targetId}/restore`, {
          method: 'POST'
        });
        if (res.ok) {
          const resData = await res.json();
          if (resData.success) {
            restoredSuccessfully = true;
          }
        }
      } catch (apiErr) {
        console.warn('API restore failed, falling back to direct Supabase restore:', apiErr);
      }

      // Fallback if backend route was not reached
      if (!restoredSuccessfully) {
        const user = JSON.parse(localStorage.getItem('user'));
        const { data, error: updateError } = await supabase
          .from('employees')
          .update({
            status: 'active',
            is_active: true,
            archived_at: null,
            separation_reason: null,
            separation_type: null,
            separation_date: null,
            separation_notes: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetId)
          .select();

        if (updateError) throw updateError;
        if (!data || data.length === 0) {
          throw new Error('No rows updated. Please check Row Level Security (RLS) policies.');
        }

        // Fix: Properly resolve all active/pending/under review disciplinary logs
        await supabase
          .from('disciplinary_logs')
          .update({ status: 'Resolved' })
          .eq('employee_id', targetId)
          .in('status', ['Active', 'Action Required', 'Pending', 'Under Review']);

        if (user?.id) {
          await supabase.from('activity_log').insert({
            log_name: 'employees',
            description: `Restored employee ${employee.first_name} ${employee.last_name} to Active status.`,
            subject_type: 'App\\Models\\Employee',
            subject_id: targetId,
            event: 'restored',
            causer_id: user.id,
            properties: { previous_status: employee.status },
          }).catch(() => {});
        }

        // Realtime broadcast to Gate Scanner & Admin
        try {
          const channel = supabase.channel('disciplinary-updates');
          await channel.send({
            type: 'broadcast',
            event: 'EMPLOYEE_RESTORED',
            payload: { employee_id: targetId, timestamp: new Date().toISOString() }
          });
        } catch (_) {}
      }

      toast.success(`${employee.first_name} ${employee.last_name} restored successfully.`);
      setShowRestoreModal(false);
      navigate('/admin/archive');
    } catch (err) {
      toast.error(err.message || 'Failed to restore employee');
    } finally {
      setIsRestoring(false);
    }
  };

  const downloadAllDocuments = async () => {
    if (documents.length === 0) {
      toast.error('No documents available to export.');
      return;
    }

    setDownloadingZip(true);
    setZipProgress({ done: 0, total: documents.length });
    const zip = new JSZip();
    const folder = zip.folder(`201_File_${getCompanyId()}`);

    try {
      let done = 0;
      for (const doc of documents) {
        if (doc.file_url) {
          const response = await fetch(doc.file_url);
          const blob = await response.blob();
          const fileName = doc.file_name || doc.document_name || `document_${doc.id}.pdf`;
          folder.file(fileName, blob);
        }
        done += 1;
        setZipProgress({ done, total: documents.length });
      }

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `201_Archive_${getCompanyId()}_${employee.last_name}.zip`);
    } catch (err) {
      toast.error('Failed to generate ZIP archive: ' + err.message);
    } finally {
      setDownloadingZip(false);
      setZipProgress({ done: 0, total: 0 });
    }
  };

  const clearanceInfo = useMemo(() => {
    if (!employee) return null;
    return employee.clearance_cleared
      ? { label: 'Cleared', tone: 'emerald', icon: 'ti-circle-check' }
      : { label: 'Pending Clearance', tone: 'amber', icon: 'ti-clock' };
  }, [employee]);

  if (loading) return <SkeletonBlock />;

  if (notFound || !employee) {
    return (
      <div className="p-6">
        <div className="bg-white border border-slate-200 rounded-2xl py-16 px-6 text-center max-w-md mx-auto shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4">
            <i className="ti ti-user-off text-2xl text-rose-500"></i>
          </div>
          <h2 className="text-slate-800 font-bold mb-1">Archived record not found</h2>
          <p className="text-slate-400 text-sm mb-6">
            This employee record may have been permanently removed or updated.
          </p>
          <button
            onClick={() => navigate('/admin/archive')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <i className="ti ti-arrow-left"></i> Back to Archive
          </button>
        </div>
      </div>
    );
  }

  const avatar = paletteFor(getCompanyId());

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          onClick={() => navigate('/admin/archive')}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-colors w-fit"
        >
          <i className="ti ti-arrow-left text-sm"></i> Back to Archive Directory
        </button>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowRestoreModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-emerald-600/20"
          >
            <i className="ti ti-rotate-clockwise text-sm"></i> Restore Employee
          </button>

          <button
            onClick={downloadAllDocuments}
            disabled={downloadingZip || documents.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-600/20"
          >
            <i className={`ti ${downloadingZip ? 'ti-loader-2 animate-spin' : 'ti-file-zip'} text-sm`}></i>
            {downloadingZip
              ? `Compressing ${zipProgress.done}/${zipProgress.total}…`
              : `Download All Documents (${documents.length})`}
          </button>
        </div>
      </div>

      {/* Hero Banner Header - Matched to Active Employee Profile UI */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {employee.avatar_url || employee.photo_url ? (
              <img
                src={employee.avatar_url || employee.photo_url}
                alt={`${employee.first_name} ${employee.last_name}`}
                className="w-20 h-20 rounded-2xl object-cover ring-4 ring-white/10 shadow-lg shrink-0"
              />
            ) : (
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center font-bold text-2xl ring-4 ${avatar.bg} ${avatar.text} ${avatar.ring} shrink-0`}>
                {getInitials(employee.first_name, employee.last_name)}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-white/10 text-slate-300 border border-white/10">
                  {getCompanyId()}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                  <i className="ti ti-archive text-xs"></i> Archived Personnel
                </span>
                {employee.department && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {employee.department}
                  </span>
                )}
                {employee.wage_structure && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {employee.wage_structure}
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold capitalize tracking-tight">
                {employee.first_name} {employee.last_name}
              </h1>

              <p className="text-slate-400 text-xs sm:text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{employee.position || employee.job_title || 'Former Employee'}</span>
                {employee.email && (
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <i className="ti ti-mail text-slate-400"></i> {employee.email}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Quick Stats Grid */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 shadow-sm">
        <StatCard icon="ti-building" label="Department">
          {employee.department || 'Not on file'}
        </StatCard>
        <StatCard icon="ti-briefcase" label="Position">
          {employee.position || employee.job_title || 'Not on file'}
        </StatCard>
        <StatCard icon="ti-calendar-off" label="Separation Date" tone="rose">
          {formatDate(employee.separation_date) || 'Not on file'}
        </StatCard>
        <StatCard icon={clearanceInfo.icon} label="Clearance Status" tone={clearanceInfo.tone}>
          {clearanceInfo.label}
        </StatCard>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 flex gap-2 overflow-x-auto">
        {TABS.map((tab) => {
          const count = {
            documents: documents.length,
            payroll: payroll.length,
            leave: leaves.length,
            disciplinary: disciplinary.length,
            attendance: attendance.length,
          }[tab.id];

          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all ${
                active
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <i className={`ti ${tab.icon} text-base`}></i>
              {tab.label}
              {typeof count === 'number' && count > 0 && (
                <span
                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                    active ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab Panel Content */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[350px]">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Personal Details Section Card */}
            <div className="border border-slate-200/80 rounded-2xl p-6 bg-slate-50/40 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <i className="ti ti-user text-lg text-slate-400"></i>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Personal Details</h3>
                  <p className="text-xs text-slate-400">Core identity and contact records</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs">
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">First Name</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.first_name || '—'}</span>
                </div>
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Last Name</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.last_name || '—'}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Email Address</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.email || 'Not on file'}</span>
                </div>
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Company ID</span>
                  <span className="font-mono font-semibold text-slate-800 text-sm mt-0.5 block">{getCompanyId()}</span>
                </div>
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Contact Phone</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.phone || employee.contact_no || 'Not on file'}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Archived Timestamp</span>
                  <span className="font-semibold text-slate-700 text-xs mt-0.5 block">{formatDateTime(employee.archived_at) || 'Not on file'}</span>
                </div>
              </div>
            </div>

            {/* Payroll & Job Specs at Separation */}
            <div className="border border-slate-200/80 rounded-2xl p-6 bg-slate-50/40 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <i className="ti ti-briefcase text-lg text-slate-400"></i>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Payroll &amp; Job Specs</h3>
                  <p className="text-xs text-slate-400">Employment parameters prior to exit</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs">
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Department</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.department || 'Not on file'}</span>
                </div>
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Job Title</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.position || employee.job_title || 'Not on file'}</span>
                </div>
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Work Schedule</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.work_schedule || employee.schedule || 'Standard Schedule'}</span>
                </div>
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Overtime Status</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.overtime_eligible ? 'Eligible' : 'Not Eligible'}</span>
                </div>

                <div className="col-span-2 p-3 bg-emerald-50/60 border border-emerald-200/60 rounded-xl space-y-1">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-emerald-700 block">Wage Structure</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-black text-emerald-800">
                      ₱{Number(employee.daily_rate || employee.salary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      <span className="text-xs font-normal text-emerald-600"> /day</span>
                    </span>
                    {employee.hourly_rate && (
                      <span className="text-xs font-bold text-emerald-700">
                        ₱{Number(employee.hourly_rate).toFixed(2)} /hr
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Separation Records Card (Full Width) */}
            <div className="col-span-1 md:col-span-2 border border-rose-200/80 rounded-2xl p-6 bg-rose-50/30 space-y-4">
              <div className="flex items-center justify-between border-b border-rose-200/80 pb-3">
                <div className="flex items-center gap-2">
                  <i className="ti ti-door-exit text-lg text-rose-500"></i>
                  <h3 className="font-bold text-slate-800 text-sm">Separation &amp; Clearance File</h3>
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full ${
                    employee.rehire_eligible !== false
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  <i className={`ti ${employee.rehire_eligible !== false ? 'ti-check' : 'ti-x'}`}></i>
                  {employee.rehire_eligible !== false ? 'Eligible for Rehire' : 'Not Eligible for Rehire'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Separation Type</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{employee.separation_type || 'Not specified'}</span>
                </div>
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Separation Date</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{formatDate(employee.separation_date) || 'Not on file'}</span>
                </div>
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Clearance Status</span>
                  <span className="font-semibold text-slate-800 text-sm mt-0.5 block">{clearanceInfo.label}</span>
                </div>
                <div className="col-span-1 md:col-span-3">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 block">Recorded Exit Remarks</span>
                  <p className="text-slate-700 text-xs bg-white/80 p-3 rounded-xl border border-slate-200/80 mt-1">
                    {employee.separation_reason || 'No specific separation remarks recorded.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-sm border-b pb-2">Archived 201 File Documents</h3>
            {documents.length === 0 ? (
              <EmptyState icon="ti-folder-open" title="No 201 documents uploaded" hint="Files added to this employee's 201 folder before archiving will appear here." />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {documents.map((doc) => {
                  const name = doc.document_name || doc.file_name || 'Untitled document';
                  const meta = docIcon(doc.file_name || doc.document_name || '');
                  return (
                    <div key={doc.id} className="p-3.5 rounded-xl border border-slate-200/80 hover:border-slate-300 bg-slate-50/50 flex items-center justify-between gap-3 transition-all">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.color}`}>
                          <i className={`ti ${meta.icon} text-xl`}></i>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">{name}</p>
                          {doc.created_at && <p className="text-[11px] text-slate-400">Uploaded {formatDate(doc.created_at)}</p>}
                        </div>
                      </div>
                      <a href={doc.file_url} target="_blank" rel="noreferrer" className="shrink-0 p-2 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-bold transition-colors">
                        View
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'payroll' && (
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-sm border-b pb-2">Historical Payroll Ledgers</h3>
            {payroll.length === 0 ? (
              <EmptyState icon="ti-cash-off" title="No payroll history found" hint="Historical paychecks executed prior to archiving will show up here." />
            ) : (
              <div className="divide-y divide-slate-100">
                {payroll.map((p) => {
                  const period = pick(p, ['period_label', 'period', 'pay_period']) || [formatDate(pick(p, ['period_start', 'start_date'])), formatDate(pick(p, ['period_end', 'end_date']))].filter(Boolean).join(' – ') || 'Pay period';
                  const amount = pick(p, ['net_pay', 'amount', 'total']);
                  return (
                    <div key={p.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                          <i className="ti ti-cash text-lg"></i>
                        </div>
                        <p className="text-xs font-bold text-slate-800">{period}</p>
                      </div>
                      <p className="text-sm font-extrabold text-slate-800">
                        {amount != null ? (typeof amount === 'number' ? `₱${amount.toLocaleString()}` : amount) : '—'}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'leave' && (
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-sm border-b pb-2">Leave Application Archive</h3>
            {leaves.length === 0 ? (
              <EmptyState icon="ti-beach-off" title="No leave records found" />
            ) : (
              <div className="divide-y divide-slate-100">
                {leaves.map((l) => (
                  <div key={l.id} className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                        <i className="ti ti-beach text-lg"></i>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800 capitalize">{pick(l, ['leave_type', 'type'], 'Leave')}</p>
                        <p className="text-[11px] text-slate-400">{formatDate(pick(l, ['start_date', 'date_from']))} – {formatDate(pick(l, ['end_date', 'date_to']))}</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-slate-500 capitalize">{pick(l, ['status'], 'recorded')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'disciplinary' && (
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-sm border-b pb-2">Disciplinary &amp; Compliance Incidents</h3>
            {disciplinary.length === 0 ? (
              <EmptyState icon="ti-shield-check" title="No disciplinary records on file" hint="A completely clean compliance history." />
            ) : (
              <div className="space-y-2">
                {disciplinary.map((d) => (
                  <div key={d.id} className="p-3.5 rounded-xl border border-rose-100 bg-rose-50/20 flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                      <i className="ti ti-alert-triangle text-lg"></i>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">{pick(d, ['incident_type', 'type'], 'Incident')}</span>
                        <span className="text-[10px] text-slate-400">• {formatDate(pick(d, ['date', 'created_at']))}</span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">{pick(d, ['description', 'notes', 'remarks']) || 'No description attached.'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'attendance' && (
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-sm border-b pb-2">Historical Clock Logs</h3>
            {attendance.length === 0 ? (
              <EmptyState icon="ti-qrcode" title="No attendance logs found" />
            ) : (
              <div className="divide-y divide-slate-100">
                {attendance.map((a) => (
                  <div key={a.id} className="py-2.5 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">{formatDate(pick(a, ['date', 'log_date', 'created_at']))}</span>
                    <span className="font-mono text-slate-500">{pick(a, ['time_in', 'check_in'], '—')} → {pick(a, ['time_out', 'check_out'], '—')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Restore Modal */}
      <AnimatePresence>
        {showRestoreModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/80 backdrop-blur-md" onClick={() => !isRestoring && setShowRestoreModal(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-white rounded-2xl w-full max-w-md p-6 text-center z-10 shadow-2xl">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-md">
                <i className="ti ti-rotate-clockwise text-3xl" />
              </div>

              <h2 className="text-xl font-black text-slate-800 mb-2">Restore Employee?</h2>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                <strong className="text-slate-800">{employee.first_name} {employee.last_name}</strong> ({getCompanyId()}) will be moved back to active status in the employee directory.
              </p>

              <div className="flex gap-3">
                <button onClick={() => setShowRestoreModal(false)} disabled={isRestoring} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-colors">
                  Cancel
                </button>
                <button onClick={handleRestore} disabled={isRestoring} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2">
                  {isRestoring ? <i className="ti ti-loader animate-spin text-base" /> : 'Restore Employee'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}