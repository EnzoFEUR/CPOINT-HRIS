import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../utils/api';
import EmployeeAvatar from '../../components/EmployeeAvatar';
import { supabase } from '../../supabaseClient';
import { getDisciplinaryCache } from '../../utils/disciplinaryCache';

export default function MyProfile() {
    const queryClient = useQueryClient();
    const initialUser = (() => {
        try {
            const raw = localStorage.getItem('user');
            if (raw && raw !== 'undefined') {
                const u = JSON.parse(raw);
                return {
                    id: u.id || u.user_id,
                    company_id: u.company_id || u.employee_id || u.emp_id || 'CP-MAIN',
                    first_name: u.first_name || (u.name ? u.name.split(' ')[0] : ''),
                    last_name: u.last_name || (u.name ? u.name.split(' ').slice(1).join(' ') : ''),
                    email: u.email || 'N/A',
                    phone: u.phone || u.contact_no || '',
                    gender: u.gender || 'N/A',
                    birth_date: u.birth_date || null,
                    address: u.address || '',
                    department: u.department || 'Operations',
                    job_title: u.job_title || u.position || 'Staff Member',
                    status: u.status || 'active',
                    is_active: u.is_active ?? true,
                    created_at: u.created_at || null,
                    avatar_url: u.avatar_url || u.photo_url || null,
                    photo_url: u.photo_url || u.avatar_url || null,
                    has_registered_biometrics: u.has_registered_biometrics ?? true,
                };
            }
        } catch { }
        return null;
    })();

    // Query profile
    const { data: profileResponse, isLoading: isQueryLoading } = useQuery({
        queryKey: ['myProfile'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/profile');
            const data = await res.json();
            return data;
        },
        initialData: initialUser ? { success: true, user: initialUser } : undefined,
        staleTime: 60000,
    });

    const raw = profileResponse?.employee || profileResponse?.user || profileResponse?.data?.employee || profileResponse?.data?.user || profileResponse?.data || profileResponse || {};
    
    const profile = useMemo(() => {
        if (!raw || typeof raw !== 'object' || !raw.id) return initialUser;
        return {
            id: raw.id || raw.user_id,
            company_id: raw.company_id || raw.employee_id || raw.emp_id || raw.id || 'CP-MAIN',
            first_name: raw.first_name || raw.firstname || (raw.name ? raw.name.split(' ')[0] : ''),
            last_name: raw.last_name || raw.lastname || (raw.name ? raw.name.split(' ').slice(1).join(' ') : ''),
            email: raw.email || raw.user?.email || 'N/A',
            phone: raw.phone || raw.contact_no || raw.phone_number || raw.mobile || '',
            gender: raw.gender || raw.sex || 'N/A',
            birth_date: raw.birth_date || raw.dob || raw.birthdate || null,
            address: raw.address || raw.home_address || raw.present_address || '',
            department: raw.department?.name || raw.department || raw.dept || 'Operations',
            job_title: raw.job_title || raw.position || raw.designation || raw.role || 'Staff Member',
            status: raw.status || initialUser?.status || 'active',
            is_active: raw.is_active ?? initialUser?.is_active ?? true,
            created_at: raw.created_at || raw.hire_date || raw.date_joined || null,
            avatar_url: raw.avatar_url || raw.photo_url || raw.photo || raw.profile_picture || raw.image_url || null,
            photo_url: raw.photo_url || raw.avatar_url || raw.photo || raw.profile_picture || raw.image_url || null,
            has_registered_biometrics: raw.has_registered_biometrics ?? true,
        };
    }, [raw, initialUser]);

    const disciplinaryLogs = profileResponse?.disciplinary_logs || [];
    const isLoading = isQueryLoading && !profile;

    // Disciplinary status and sync
    const [disciplinaryState, setDisciplinaryState] = useState(() => getDisciplinaryCache(initialUser?.id));

    useEffect(() => {
        const handleSync = (e) => {
            if (!profile?.id || e.detail?.userId === profile.id) {
                setDisciplinaryState(getDisciplinaryCache(profile?.id));
            }
        };
        window.addEventListener('hris_disciplinary_sync', handleSync);
        return () => window.removeEventListener('hris_disciplinary_sync', handleSync);
    }, [profile?.id]);

    useEffect(() => {
        if (!profile?.id) return;
        const channel = supabase
            .channel(`myprofile-realtime-${profile.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplinary_logs', filter: `employee_id=eq.${profile.id}` }, () => {
                queryClient.invalidateQueries({ queryKey: ['myProfile'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${profile.id}` }, () => {
                queryClient.invalidateQueries({ queryKey: ['myProfile'] });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [profile?.id, queryClient]);

    const isTerminated = 
        profile?.status === 'inactive' || 
        profile?.status === 'terminated' || 
        profile?.is_active === false || 
        Boolean(disciplinaryState?.isTerminated);

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    if (isLoading && !profile) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-400 font-bold tracking-widest uppercase text-xs">Loading Profile...</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-5 pb-20 px-4 sm:px-6 font-sans relative">
            {/* Profile header */}
            <div className="bg-slate-900 rounded-xl p-5 sm:p-7 border border-slate-800 text-white shadow-xs relative">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
                    <div className="relative h-24 w-24 sm:h-28 sm:w-28 shrink-0">
                        <EmployeeAvatar
                            employee={profile}
                            size="h-24 w-24 sm:h-28 sm:w-28"
                            rounded="rounded-xl"
                            border="border-2 border-slate-700"
                            shadow="shadow-xs"
                            theme="dark"
                            textSize="text-3xl sm:text-4xl"
                        />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
                            {isTerminated && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-500/20 text-rose-300 text-xs font-semibold rounded border border-rose-500/30">
                                    <i className="ti ti-circle-x" /> Separated
                                </span>
                            )}
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-800 text-slate-200 text-xs font-mono font-bold rounded border border-slate-700">
                                <i className="ti ti-id text-slate-400" /> {profile?.company_id || 'EMPLOYEE'}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-500/20 text-blue-300 text-xs font-semibold rounded border border-blue-500/30">
                                {profile?.department || 'Operations'}
                            </span>
                            {(profile?.department || '').toLowerCase().includes('factory') ? (
                                <>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-500/20 text-amber-300 text-xs font-semibold rounded border border-amber-500/30">
                                        Factory (08:00 - 17:00 • No OT)
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-purple-500/20 text-purple-300 text-xs font-semibold rounded border border-purple-500/30">
                                        Piece-Rate Production
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-500/20 text-blue-300 text-xs font-semibold rounded border border-blue-500/30">
                                        Regular (08:00 - 20:00 • OT Eligible)
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs font-semibold rounded border border-emerald-500/30">
                                        Salaried Monthly
                                    </span>
                                </>
                            )}
                        </div>

                        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
                            {profile?.first_name} {profile?.last_name}
                        </h1>
                        <p className="text-slate-300 font-medium text-xs sm:text-sm mt-0.5">
                            {profile?.job_title || 'Staff Member'}
                        </p>

                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-3 text-xs font-medium text-slate-400">
                            <span className="flex items-center gap-1.5">
                                <i className="ti ti-mail text-slate-400 text-sm" /> {profile?.email || 'N/A'}
                            </span>
                            {profile?.phone && (
                                <span className="flex items-center gap-1.5 font-mono">
                                    <i className="ti ti-phone text-slate-400 text-sm" /> {profile.phone}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Personal and employment details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                {/* Personal Information */}
                <div className="bg-white rounded-xl p-5 sm:p-6 shadow-xs border border-slate-200 space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                        <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                            <i className="ti ti-user text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Personal Details</h3>
                            <p className="text-[11px] text-slate-500">Government identity and contact details</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5 text-xs">
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">First Name</p>
                            <p className="font-semibold text-slate-900">{profile?.first_name || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Last Name</p>
                            <p className="font-semibold text-slate-900">{profile?.last_name || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Gender</p>
                            <p className="font-semibold text-slate-900 capitalize">{profile?.gender || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Birth Date</p>
                            <p className="font-mono font-semibold text-slate-900">{formatDate(profile?.birth_date)}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Email Address</p>
                            <p className="font-semibold text-slate-900 truncate">{profile?.email || 'N/A'}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Home Address</p>
                            <p className="font-semibold text-slate-900">{profile?.address || 'No address registered'}</p>
                        </div>
                    </div>
                </div>

                {/* Employment & Payroll Details */}
                <div className="bg-white rounded-xl p-5 sm:p-6 shadow-xs border border-slate-200 space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                        <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                            <i className="ti ti-briefcase text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Employment & Payroll</h3>
                            <p className="text-[11px] text-slate-500">Organizational role and compensation scheme</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5 text-xs">
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Company ID</p>
                            <p className="font-mono font-semibold text-slate-900">{profile?.company_id || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Department</p>
                            <p className="font-semibold text-slate-900">{profile?.department || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Role / Title</p>
                            <p className="font-semibold text-slate-900">{profile?.job_title || profile?.role || 'Staff'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Date Joined</p>
                            <p className="font-mono font-semibold text-slate-900">{formatDate(profile?.created_at)}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Employment Status</p>
                            <span className="inline-flex items-center px-2.5 py-0.5 bg-emerald-50 text-emerald-700 font-semibold text-[11px] rounded border border-emerald-200">
                                Active Full-Time
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Compliance & Disciplinary Standing */}
            <div className="bg-white rounded-xl p-5 sm:p-6 shadow-xs border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                            <i className="ti ti-scale text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Compliance & Disciplinary Records</h3>
                            <p className="text-[11px] text-slate-500">Official DOLE due process records, written warnings, and standing</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                            isTerminated ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            disciplinaryState?.isSuspended ? 'bg-amber-50 text-amber-800 border-amber-200' :
                            disciplinaryLogs.some(l => l.status === 'Active') ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                            <i className={`ti ${
                                isTerminated ? 'ti-circle-x' :
                                disciplinaryState?.isSuspended ? 'ti-clock-pause' :
                                disciplinaryLogs.some(l => l.status === 'Active') ? 'ti-alert-triangle' :
                                'ti-circle-check'
                            }`} />
                            {isTerminated ? 'Separated' :
                             disciplinaryState?.isSuspended ? 'Suspension Active' :
                             disciplinaryLogs.some(l => l.status === 'Active') ? 'Action Required' :
                             'Good Standing'}
                        </span>
                    </div>
                </div>

                {disciplinaryLogs.length === 0 ? (
                    <div className="flex flex-col sm:flex-row items-center gap-3.5 p-4 rounded-xl bg-emerald-50/50 border border-emerald-200 text-xs">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            <i className="ti ti-shield-check text-base" />
                        </div>
                        <div className="flex-1 text-center sm:text-left">
                            <p className="font-bold text-emerald-900">Clean Disciplinary Standing</p>
                            <p className="text-emerald-700 mt-0.5">
                                You currently have no disciplinary infractions, warnings, or sanctions on file. Your account is in full compliance with company policies and DOLE standards.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {disciplinaryLogs.map((log) => {
                            const isOverturnedOrResolved = log.status === 'Resolved' || log.status === 'Overturned';
                            const isResolvedTermination = log.type === 'Termination' && isOverturnedOrResolved;
                            const isReinstatedNote = (log.reason || '').includes('[REINSTATED') || (log.reason || '').includes('[EXONERATED') || (log.reason || '').includes('[CLEARED');

                            return (
                                <div
                                    key={log.id}
                                    className={`p-4 rounded-xl border text-xs transition-all ${
                                        isResolvedTermination
                                            ? 'bg-emerald-50/30 border-emerald-200'
                                            : log.status === 'Active'
                                            ? 'bg-rose-50/30 border-rose-200'
                                            : log.status === 'Acknowledged'
                                            ? 'bg-blue-50/30 border-blue-200'
                                            : 'bg-slate-50/70 border-slate-200'
                                    }`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200/60">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border flex items-center gap-1 ${
                                                isResolvedTermination
                                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                                    : log.type === 'Termination'
                                                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                                                    : log.type === 'Suspension'
                                                    ? 'bg-orange-100 text-orange-800 border-orange-300'
                                                    : 'bg-amber-100 text-amber-800 border-amber-300'
                                            }`}>
                                                <i className={`ti ${
                                                    isResolvedTermination ? 'ti-circle-check' :
                                                    log.type === 'Termination' ? 'ti-ban' :
                                                    log.type === 'Suspension' ? 'ti-player-pause' : 'ti-alert-triangle'
                                                }`} />
                                                {isResolvedTermination ? 'Termination (Revoked / Restored)' : log.type}
                                            </span>

                                            <span className="text-slate-500 font-medium flex items-center gap-1">
                                                <i className="ti ti-calendar text-xs" />
                                                {formatDate(log.date || log.created_at)}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
                                                log.status === 'Resolved' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                                                log.status === 'Overturned' ? 'bg-teal-100 text-teal-800 border-teal-300' :
                                                log.status === 'Acknowledged' ? 'bg-blue-100 text-blue-800 border-blue-300' :
                                                'bg-rose-100 text-rose-800 border-rose-300'
                                            }`}>
                                                {log.status === 'Resolved' && <i className="ti ti-circle-check" />}
                                                {log.status === 'Overturned' && <i className="ti ti-shield-check" />}
                                                {log.status === 'Acknowledged' && <i className="ti ti-checks" />}
                                                {log.status === 'Active' && <i className="ti ti-alert-triangle" />}
                                                <span>
                                                    {log.status === 'Resolved' ? 'Resolved' :
                                                     log.status === 'Overturned' ? 'Cleared' :
                                                     log.status === 'Acknowledged' ? 'Acknowledged' :
                                                     'Action Required'}
                                                </span>
                                            </span>
                                        </div>
                                    </div>

                                    <p className="mt-2 text-slate-700 leading-relaxed whitespace-pre-line font-medium">
                                        {log.reason || 'No details provided.'}
                                    </p>

                                    {log.status === 'Active' && (
                                        <div className="mt-2.5 pt-2 border-t border-rose-200/60 flex items-center justify-between gap-2 text-[11px] text-rose-700">
                                            <span className="flex items-center gap-1">
                                                <i className="ti ti-alert-circle text-sm" /> Formal acknowledgment required under DOLE due process.
                                            </span>
                                            <Link
                                                to="/employee/dashboard"
                                                className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-[10px] uppercase transition-colors shrink-0"
                                            >
                                                Review Notice
                                            </Link>
                                        </div>
                                    )}

                                    {log.status === 'Acknowledged' && (
                                        <div className="mt-2 pt-2 border-t border-blue-100 text-[11px] text-blue-700 font-medium flex items-center gap-1">
                                            <i className="ti ti-checks text-sm" />
                                            <span>Receipt formally acknowledged on employee portal.</span>
                                        </div>
                                    )}

                                    {isReinstatedNote && (
                                        <div className="mt-2 pt-2 border-t border-emerald-100 text-[11px] text-emerald-800 font-bold flex items-center gap-1">
                                            <i className="ti ti-check text-sm" />
                                            <span>Sanction revoked and operational standing restored.</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}