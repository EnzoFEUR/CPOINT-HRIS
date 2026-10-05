import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../../supabaseClient';

function getCompanyId(emp) {
  if (!emp) return 'N/A';
  return (
    emp.company_id ||
    emp.employee_no ||
    emp.employee_id ||
    emp.emp_id ||
    emp.emp_no ||
    emp.id_number ||
    'N/A'
  );
}

function getAvatarUrl(emp) {
  if (!emp) return null;
  const photoPath =
    emp.biometric_baseline_path ||
    (emp.company_id && emp.id ? `face-baselines/${emp.company_id}/${emp.id}.jpg` : null);
  if (!photoPath) return null;
  return `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${photoPath.replace(/^\/+/, '')}`;
}

function isTerminatedStatus(emp) {
  if (!emp) return false;
  const status = (emp.status || emp.operational_status || '').toLowerCase();
  return status === 'terminated' || status === 'inactive' || emp.is_active === false;
}

function getTerminationCooldown(terminatedAt, cooldownDays = 30) {
  if (!terminatedAt) return { inCooldown: false, remainingDays: 0 };

  const startDate = new Date(terminatedAt);
  const expiryDate = new Date(startDate);
  expiryDate.setDate(startDate.getDate() + cooldownDays);

  const today = new Date();
  const diffTime = expiryDate - today;
  const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return {
    inCooldown: remainingDays > 0,
    remainingDays: Math.max(0, remainingDays),
  };
}

export default function EmployeeArchive() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchArchivedEmployees();

    // Subscribe to realtime employee changes
    const channel = supabase
      .channel('employee-archive-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
        fetchArchivedEmployees();
      })
      .on('broadcast', { event: 'EMPLOYEE_TERMINATED' }, () => {
        fetchArchivedEmployees();
      })
      .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, () => {
        fetchArchivedEmployees();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

const PENDING_TERMINATION_DAYS = 14; // Must match the Employee Directory's pending-termination window

const fetchArchivedEmployees = async () => {
  setLoading(true);
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('*, production_groups(name)') // Joins production_groups table
      .or('status.ilike.terminated,status.ilike.inactive,is_active.eq.false')
      .neq('status', 'suspended') // Suspended is a temporary, reversible state — exclude it from the terminated/inactive archive
      .order('updated_at', { ascending: false });

    if (error) throw error;

    // Recently-terminated employees stay in the Employee Directory under "Pending Termination"
    // for PENDING_TERMINATION_DAYS — don't surface them here until that window has elapsed.
    const now = Date.now();
    const fullyArchived = (data || []).filter((emp) => {
      const ts = emp.archived_at || emp.separation_date || emp.updated_at;
      if (!ts) return true; // no timestamp to judge by — show it rather than silently hide it
      const elapsedDays = (now - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
      return elapsedDays >= PENDING_TERMINATION_DAYS;
    });

    setEmployees(fullyArchived);
  } catch (err) {
    console.error('Error fetching archived employees:', err);
    toast.error('Failed to load archived employees');
  } finally {
    setLoading(false);
  }
};

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const name = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
      const companyId = getCompanyId(emp).toLowerCase();
      const dept = (emp.department || '').toLowerCase();
      const lineGroup = (emp.line_group || emp.line_assignment || emp.shoe_production_station || '').toLowerCase();
      const compMode = (emp.compensation_mode || emp.pay_type || '').toLowerCase();
      const query = searchQuery.toLowerCase();

      return (
        name.includes(query) ||
        companyId.includes(query) ||
        dept.includes(query) ||
        lineGroup.includes(query) ||
        compMode.includes(query)
      );
    });
  }, [employees, searchQuery]);

  const handleExportCSV = () => {
    if (filteredEmployees.length === 0) {
      toast.error('No employee records available to export.');
      return;
    }

    const headers = [
      'Company ID',
      'First Name',
      'Last Name',
      'Email',
      'Department',
      'Station / Line',
      'Compensation Mode',
      'Status'
    ];
    
    const rows = filteredEmployees.map((emp) => [
      `"${getCompanyId(emp)}"`,
      `"${emp.first_name || ''}"`,
      `"${emp.last_name || ''}"`,
      `"${emp.email || emp.email_address || ''}"`,
      `"${emp.department || ''}"`,
      `"${emp.line_group || emp.line_assignment || emp.shoe_production_station || ''}"`,
      `"${emp.compensation_mode || emp.pay_type || ''}"`,
      `"${emp.status || emp.operational_status || 'TERMINATED'}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Terminated_Employees_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Title Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-slate-900 text-white flex items-center justify-center text-base shadow-2xs">
            <i className="ti ti-archive"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Employee Archive</h1>
            <p className="text-xs text-slate-500">
              Records of terminated personnel.
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[240px]">
            <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
            <input
              type="text"
              placeholder="Search archive..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-8 pr-3 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 focus:outline-none focus:border-accent transition-colors duration-100 placeholder:text-slate-400 shadow-2xs"
            />
          </div>

          <button
            onClick={handleExportCSV}
            className="h-9 inline-flex items-center gap-1.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold transition-colors duration-100 shadow-2xs cursor-pointer"
          >
            <i className="ti ti-download text-sm"></i>
            EXPORT CSV
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Company ID</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Station / Line</th>
                <th className="py-3 px-4">Compensation Mode</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <i className="ti ti-loader animate-spin text-2xl mb-2 inline-block"></i>
                    <p className="text-xs font-medium">Loading archived records...</p>
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="w-10 h-10 bg-slate-50 rounded-md flex items-center justify-center mx-auto mb-2 text-slate-400 border border-slate-200">
                      <i className="ti ti-archive-off text-xl"></i>
                    </div>
                    <p className="text-xs font-semibold text-slate-700">No terminated employees found</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Try adjusting your search terms.</p>
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const initials = `${emp.first_name?.[0] || ''}${emp.last_name?.[0] || ''}`.toUpperCase() || 'EM';
                  const avatarUrl = getAvatarUrl(emp);
                  const inactive = isTerminatedStatus(emp);
                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/60 transition-colors duration-100 group">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {avatarUrl ? (
                            <img
                              src={avatarUrl}
                              alt={`${emp.first_name} ${emp.last_name}`}
                              className={`w-8 h-8 rounded-md object-cover shadow-2xs ${inactive ? 'grayscale opacity-60' : ''}`}
                            />
                          ) : (
                            <div
                              className={`w-8 h-8 rounded-md font-bold text-xs flex items-center justify-center shadow-2xs ${
                                inactive ? 'bg-slate-400 text-slate-100' : 'bg-slate-900 text-white'
                              }`}
                            >
                              {initials}
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-slate-800 capitalize text-xs">
                              {emp.first_name} {emp.last_name}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {emp.email || emp.email_address || '—'}
                              
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 text-xs font-bold">
                        {getCompanyId(emp)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-slate-100 text-slate-700 font-medium text-xs border border-slate-200">
                          {emp.department || '—'}
                        </span>
                      </td>
                      {/* Station / Line */}
                        <td className="py-3 px-4 text-slate-600 text-xs font-medium">
                        {emp.line_group || emp.line_assignment || emp.shoe_production_station || emp.station || emp.job_title || '—'}
                        </td>

                        {/* Compensation Mode */}
                        <td className="py-3 px-4 text-slate-600 text-xs font-medium">
                        {
                            emp.compensation_mode || 
                            emp.wage_structure || 
                            (Number(emp.daily_rate) > 0 ? 'Daily Rate' : 
                            Number(emp.hourly_rate) > 0 ? 'Hourly Rate' : '—')
                        }
                        </td>
                    <td className="py-3 px-4">
                    {(() => {
                        const { inCooldown, remainingDays } = getTerminationCooldown(emp.updated_at || emp.created_at, 30);
                        
                        if (inCooldown) {
                        return (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-warning-subtle text-warning-ink border border-warning/20" title="In 30-day clearance cooldown">
                            <i className="ti ti-clock-hour-4 text-xs animate-pulse" />
                            Cooldown ({remainingDays}d left)
                            </span>
                        );
                        }

                        return (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-danger-subtle text-danger-ink border border-danger/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                            Archived / Locked
                        </span>
                        );
                    })()}
                    </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => navigate(`/admin/archive/${emp.id}`)}
                          className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md bg-accent-subtle hover:bg-accent-subtle text-accent text-xs font-semibold transition-colors duration-100 cursor-pointer shadow-2xs"
                        >
                          <i className="ti ti-eye text-xs"></i>
                          VIEW
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}