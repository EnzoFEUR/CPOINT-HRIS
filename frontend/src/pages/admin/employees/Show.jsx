import React, { useState, useMemo, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import QRCode from '../../../components/QRCode';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import { getShoeRoleDetails, parseProductionGroup } from '../../../utils/factoryRoles';

const formatAuthorizer = (authorizer, role) => {
    if (!authorizer) return 'System Administrator (HR)';
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authorizer);
    if (isUuid) {
        return role ? `System Administrator (${role})` : 'System Administrator (HR)';
    }
    if (role && !authorizer.toLowerCase().includes(role.toLowerCase())) {
        return `${authorizer} (${role})`;
    }
    return authorizer;
};

export default function Show() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Modals State
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [isReinstateModalOpen, setIsReinstateModalOpen] = useState(false);
    const [isReinstating, setIsReinstating] = useState(false);

    const handleReinstate = async () => {
        if (!employee) return;
        setIsReinstating(true);

        // 0ms Optimistic UI updates
        queryClient.setQueryData(['employeeDetails', id], (old) => {
            if (!old) return old;
            return {
                ...old,
                data: {
                    ...old.data,
                    status: 'active',
                    is_active: true,
                    archived_at: null,
                    separation_reason: null,
                    separation_type: null,
                    separation_date: null,
                    separation_notes: null,
                    operational_status: 'Active',
                    is_suspended: false,
                    is_terminated: false
                }
            };
        });

        queryClient.setQueryData(['adminEmployees'], (old) => {
            if (!Array.isArray(old)) return old;
            return old.map(e => String(e.id) === String(id) ? {
                ...e,
                status: 'active',
                is_active: true,
                archived_at: null,
                operational_status: 'Active',
                is_suspended: false,
                is_terminated: false
            } : e);
        });

        window.dispatchEvent(new CustomEvent('hris_disciplinary_sync', { detail: { userId: employee.id } }));

        try {
            const res = await fetchWithAuth(`/api/employees/${employee.id}/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Reinstated from pending termination review' })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to reinstate employee');
            }

            toast.success(`${employee.first_name} ${employee.last_name} has been reinstated to Active standing.`);
            setIsReinstateModalOpen(false);

            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
            window.dispatchEvent(new CustomEvent('hris_disciplinary_sync', { detail: { userId: employee.id } }));
        } catch (err) {
            toast.error(err.message || 'Failed to reinstate employee');
            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        } finally {
            setIsReinstating(false);
        }
    };

    // Temporary credentials state for unregistered accounts
    const [showTempPassword, setShowTempPassword] = useState(true);
    const [copiedKey, setCopiedKey] = useState(null);
    const [isResettingPassword, setIsResettingPassword] = useState(false);

    // Biometric Security & Medical Grace Protocol State
    const [isExemptionModalOpen, setIsExemptionModalOpen] = useState(false);
    const [isSubmittingExemption, setIsSubmittingExemption] = useState(false);
    const [isResettingBiometrics, setIsResettingBiometrics] = useState(false);
    const [exemptionForm, setExemptionForm] = useState({
        reason: 'Physical facial injury / surgical bandages per physician certification',
        cert_ref: '',
        duration_days: 14,
        document_url: ''
    });

    const handleEnableExemption = async (e) => {
        if (e) e.preventDefault();
        if (!employee) return;
        setIsSubmittingExemption(true);
        try {
            const validUntil = new Date(Date.now() + Number(exemptionForm.duration_days) * 86400000).toISOString().split('T')[0];
            const res = await fetchWithAuth(`/api/employees/${employee.id}/biometric-exemption`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'enable',
                    reason: exemptionForm.reason,
                    cert_ref: exemptionForm.cert_ref,
                    valid_until: validUntil,
                    document_url: exemptionForm.document_url
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to activate medical exemption');
            }
            toast.success('Medical Grace Exemption activated. QR-Only attendance mode is now active.');
            setIsExemptionModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        } catch (err) {
            toast.error(err.message || 'Failed to activate medical exemption');
        } finally {
            setIsSubmittingExemption(false);
        }
    };

    const handleRevokeExemption = async () => {
        if (!employee) return;
        if (!window.confirm(`Revoke Medical Grace Exemption for ${employee.first_name} ${employee.last_name}? Dual-factor biometric verification (QR + Face) will be re-enforced immediately at the kiosk.`)) return;
        setIsSubmittingExemption(true);
        try {
            const res = await fetchWithAuth(`/api/employees/${employee.id}/biometric-exemption`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'revoke' })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to revoke medical exemption');
            }
            toast.success('Medical Grace Exemption revoked. Dual-factor biometrics restored.');
            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        } catch (err) {
            toast.error(err.message || 'Failed to revoke exemption');
        } finally {
            setIsSubmittingExemption(false);
        }
    };

    const handleExtendExemption = async (daysToAdd = 7) => {
        if (!employee || !medicalExemption) return;
        setIsSubmittingExemption(true);
        try {
            const currentValidUntil = medicalExemption.valid_until ? new Date(medicalExemption.valid_until) : new Date();
            const baseTime = currentValidUntil.getTime() > Date.now() ? currentValidUntil.getTime() : Date.now();
            const newValidUntil = new Date(baseTime + Number(daysToAdd) * 86400000).toISOString().split('T')[0];

            const res = await fetchWithAuth(`/api/employees/${employee.id}/biometric-exemption`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'enable',
                    reason: medicalExemption.reason || 'Extended recovery period per medical observation',
                    cert_ref: medicalExemption.cert_ref || 'EXTENSION_REQUEST',
                    valid_until: newValidUntil,
                    document_url: medicalExemption.document_url || ''
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to extend medical grace duration');
            }
            toast.success(`Medical Grace extended by +${daysToAdd} days (Valid through ${newValidUntil}).`);
            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        } catch (err) {
            toast.error(err.message || 'Failed to extend exemption');
        } finally {
            setIsSubmittingExemption(false);
        }
    };

    const handleResetBiometrics = async () => {
        if (!employee) return;
        if (!window.confirm(`Are you sure you want to shred ${employee.first_name} ${employee.last_name}'s enrolled facial baseline? The employee will be required to re-enroll a fresh facial scan at the kiosk upon recovery.`)) return;
        setIsResettingBiometrics(true);
        try {
            const res = await fetchWithAuth(`/api/employees/${employee.id}/reset-biometrics`, {
                method: 'POST'
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to reset biometric profile');
            }
            toast.success('Biometric profile shredded. Employee can now re-enroll a fresh facial scan.');
            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        } catch (err) {
            toast.error(err.message || 'Failed to reset biometrics');
        } finally {
            setIsResettingBiometrics(false);
        }
    };

    const copyToClipboard = (text, key) => {
        if (!text) return;
        navigator.clipboard.writeText(String(text));
        setCopiedKey(key);
        toast.success(`${key === 'password' ? 'Password' : key === 'email' ? 'Email' : 'Company ID'} copied!`);
        setTimeout(() => setCopiedKey(null), 2000);
    };

    const copyAllCredentials = () => {
        if (!employee) return;
        const text = `C-POINT HRIS Account Credentials\nName: ${employee.first_name || ''} ${employee.last_name || ''}\nCompany ID: ${employee.company_id || ''}\nEmail: ${employee.email || ''}\nTemporary Password: ${employee.temp_password || 'Emp-1234'}\nLogin Portal: ${window.location.origin}/login`;
        navigator.clipboard.writeText(text);
        setCopiedKey('all');
        toast.success('Onboarding credentials copied to clipboard!');
        setTimeout(() => setCopiedKey(null), 2000);
    };

    const handleResetTempPassword = async () => {
        if (!window.confirm('Generate a new temporary password for this unregistered employee?')) return;
        setIsResettingPassword(true);
        try {
            const res = await fetchWithAuth(`/api/employees/${id}/reset-temp-password`, {
                method: 'POST'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                queryClient.setQueryData(['employeeDetails', id], (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        data: {
                            ...old.data,
                            temp_password: data.temp_password,
                            requires_password_change: true
                        }
                    };
                });
                queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
                toast.success('New temporary password generated!');
            } else {
                toast.error(data.error || 'Failed to generate temporary password');
            }
        } catch {
            toast.error('Network error. Failed to generate temporary password');
        } finally {
            setIsResettingPassword(false);
        }
    };

    // Pre-populate employee from cache if available
    const cachedEmp = useMemo(() => {
        const cachedList = queryClient.getQueryData(['adminEmployees']);
        if (Array.isArray(cachedList)) {
            const found = cachedList.find(e => String(e.id) === String(id));
            if (found) {
                return {
                    ...found,
                    name: found.name || `${found.first_name || ''} ${found.last_name || ''}`.trim()
                };
            }
        }
        return null;
    }, [queryClient, id]);

    // Query employee details and 201 documents
    const { data: employeeData, isLoading: isEmpLoading } = useQuery({
        queryKey: ['employeeDetails', id],
        queryFn: async () => {
            const res = await fetchWithAuth(`/api/employees/${id}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load employee');
            const emp = data.data;
            emp.name = emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
            return {
                data: emp,
                documents: data.documents || []
            };
        },
        enabled: Boolean(id && id !== 'undefined'),
        staleTime: 30_000,
        gcTime: 300_000,
    });

    const employee = employeeData?.data || cachedEmp || null;
    const isLoading = isEmpLoading && !employee;

    // Memoized disciplinary logs
    const disciplinaryLogs = useMemo(() => Array.isArray(employee?.disciplinary_logs) ? employee.disciplinary_logs : [], [employee?.disciplinary_logs]);

    // Parse Medical Exemption and Biometric Metadata
    const medicalExemption = useMemo(() => {
        if (!employee?.medical_record_url) return null;
        try {
            const parsed = JSON.parse(employee.medical_record_url);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch {
            return null;
        }
    }, [employee?.medical_record_url]);

    const isMedicalExemptActive = useMemo(() => {
        if (!medicalExemption?.exempt) return false;
        const today = new Date().toISOString().split('T')[0];
        return !medicalExemption.valid_until || medicalExemption.valid_until >= today;
    }, [medicalExemption]);

    const daysRemaining = useMemo(() => {
        if (!isMedicalExemptActive || !medicalExemption?.valid_until) return null;
        const diff = Math.ceil((new Date(medicalExemption.valid_until).getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
        return Math.max(0, diff);
    }, [isMedicalExemptActive, medicalExemption]);

    // Subscribe to live employee, disciplinary, and biometric changes (Real-time 0ms sync)
    useEffect(() => {
        if (!id || id === 'undefined') return;

        const handleSync = () => {
            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        };

        window.addEventListener('hris_disciplinary_sync', handleSync);

        const channel = supabase
            .channel(`admin-live-employee-${id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${id}` }, handleSync)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplinary_logs', filter: `employee_id=eq.${id}` }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_STATUS_UPDATED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_RESOLVED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_OVERTURNED' }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_TERMINATED' }, handleSync)
            .on('broadcast', { event: 'BIOMETRIC_EXEMPTION_UPDATED' }, handleSync)
            .on('broadcast', { event: 'BIOMETRICS_RESET' }, handleSync)
            .subscribe();

        const syncChannel = supabase
            .channel(`dashboard-disciplinary-sync-${id}`)
            .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_RESOLVED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_STATUS_UPDATED' }, handleSync)
            .on('broadcast', { event: 'BIOMETRIC_EXEMPTION_UPDATED' }, handleSync)
            .on('broadcast', { event: 'BIOMETRICS_RESET' }, handleSync)
            .subscribe();

        const scannerChannel = supabase
            .channel('scanner_disciplinary_realtime')
            .on('broadcast', { event: 'BIOMETRIC_EXEMPTION_UPDATED' }, (payload) => {
                if (payload?.payload?.employee_id === id) {
                    handleSync();
                }
            })
            .on('broadcast', { event: 'BIOMETRICS_RESET' }, (payload) => {
                if (payload?.payload?.employee_id === id) {
                    handleSync();
                }
            })
            .subscribe();

        return () => {
            window.removeEventListener('hris_disciplinary_sync', handleSync);
            supabase.removeChannel(channel);
            supabase.removeChannel(syncChannel);
            supabase.removeChannel(scannerChannel);
        };
    }, [id, queryClient]);

    const printCard = () => {
        window.print();
    };

    const handleDelete = async () => {
        if (!employee) return;
        setIsDeleting(true);

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const response = await fetchWithAuth(`/api/employees/${employee.id}`, {
                method: 'DELETE',
                body: JSON.stringify({ admin_id: user?.id })
            });
            const resData = await response.json();
            if (resData.success) {
                toast.success('Employee deleted permanently.');
                queryClient.setQueryData(['adminEmployees'], (oldData) => {
                    return oldData ? oldData.filter(emp => emp.id !== employee.id) : [];
                });
                navigate('/admin/employees');
            } else {
                toast.error('Failed: ' + resData.error);
            }
        } catch (err) {
            toast.error('Network Error. Failed to delete employee.');
        } finally {
            setIsDeleting(false);
            setIsDeleteModalOpen(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    // Unconditional hook declarations complete - now safe for conditional early return
    if (isLoading || !employee) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Profile...</p>
            </div>
        );
    }

    const isFactory = employee?.department?.toLowerCase().includes('factory');
    const shoeRole = isFactory ? getShoeRoleDetails(employee?.job_title) : null;
    const prodGroup = isFactory ? parseProductionGroup(employee?.shift) : null;
    const dailyRate = Number(
        employee.daily_rate ?? 
        (employee.monthly_salary ? Number(employee.monthly_salary) / 26 : 0)
    );
    const hourlyRate = Number(
        employee.hourly_rate ?? 
        (dailyRate ? dailyRate / 8 : 0)
    );
    const isTerminated = employee.operational_status === 'Terminated' || employee.is_terminated;
    const isSuspended = !isTerminated && (employee.operational_status === 'Suspended' || employee.is_suspended);

    // Termination cooldown: a separated employee stays visually flagged (grayed
    // out) but not yet finalized for this many days after their effective
    // separation date - a reversible window before the record is treated as
    // permanent. Change this single constant to adjust the window company-wide.
    const TERMINATION_COOLDOWN_DAYS = 30;
    const separationDateRaw = employee.termination_record?.date || employee.separation_date || null;
    const daysSinceSeparation = separationDateRaw
        ? Math.floor((Date.now() - new Date(separationDateRaw).getTime()) / (1000 * 60 * 60 * 24))
        : null;
    const isInCooldown = isTerminated && daysSinceSeparation !== null && daysSinceSeparation < TERMINATION_COOLDOWN_DAYS;
    const cooldownDaysRemaining = isInCooldown ? TERMINATION_COOLDOWN_DAYS - daysSinceSeparation : 0;
    const isPendingRegistration = Boolean(
        employee?.requires_password_change && 
        !isTerminated
    );
    const employeeFullName = employee?.name || `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim();

    return (
        <>
            <style>{`
                @media print {
                    body * { visibility: hidden; }
                    #qr-print-card, #qr-print-card * { visibility: visible; }
                    #qr-print-card {
                        position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 20px;
                        box-shadow: none !important; border: none !important;
                    }
                    .no-print, header, nav, aside { display: none !important; }
                }
            `}</style>
            
            <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans relative">
                
                {/* Top navigation */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link to="/admin/employees" className="px-3.5 py-2 bg-white text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-50 transition-colors shadow-xs border border-slate-200 flex items-center gap-1.5">
                        <i className="ti ti-arrow-left text-sm" /> Back to Directory
                    </Link>
                    
                    <div className="flex flex-wrap gap-2 sm:gap-2.5">
                        {isTerminated && (
                            <button
                                type="button"
                                onClick={() => setIsReinstateModalOpen(true)}
                                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer touch-manipulation"
                                title="Reinstate employee to active operational status"
                            >
                                <i className="ti ti-rotate-clockwise text-base" />
                                <span>Reinstate Employee</span>
                            </button>
                        )}

                        {/* Document Vault link (201 documents now live here, not inline on the profile) */}
                        <Link to={`/admin/documents?employee_id=${employee.id}`} className="px-3.5 py-2 bg-white text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-50 transition-colors shadow-xs border border-slate-200 flex items-center gap-1.5">
                            <i className="ti ti-folders text-slate-500 text-base" /> Documents
                        </Link>

                        <button onClick={() => setIsPrintModalOpen(true)} className="px-3.5 py-2 bg-white text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-50 transition-colors shadow-xs border border-slate-200 flex items-center gap-1.5 cursor-pointer">
                            <i className="ti ti-qrcode text-slate-500 text-base" /> Print Badge
                        </button>

                        <Link to={`/admin/employees/${employee.id}/edit`} className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg transition-colors shadow-xs flex items-center gap-1.5">
                            <i className="ti ti-pencil text-base" /> Edit Profile
                        </Link>

                        <button onClick={() => { setDeleteConfirmText(''); setIsDeleteModalOpen(true); }} className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs rounded-lg transition-colors border border-rose-200 flex items-center gap-1.5 cursor-pointer">
                            <i className="ti ti-trash text-base" /> Delete
                        </button>
                    </div>
                </div>

                {/* Profile banner */}
                <div className="bg-slate-900 rounded-xl p-5 sm:p-7 border border-slate-800 text-white shadow-xs relative">
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
                        <div className={`relative h-24 w-24 sm:h-28 sm:w-28 shrink-0 transition-all duration-500 ${isInCooldown ? 'grayscale opacity-60' : ''}`}>
                            <EmployeeAvatar
                                employee={employee}
                                size="h-24 w-24 sm:h-28 sm:w-28"
                                rounded="rounded-xl"
                                border="border-2 border-slate-700"
                                shadow="shadow-xs"
                                theme="dark"
                                textSize="text-3xl sm:text-4xl"
                            />
                            {isTerminated ? (
                                <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-extrabold uppercase ring-2 ring-slate-900 flex items-center gap-1 shadow-xs">
                                    <i className="ti ti-x" /> Terminated
                                </span>
                            ) : isSuspended ? (
                                <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-extrabold uppercase ring-2 ring-slate-900 flex items-center gap-1 shadow-xs">
                                    <i className="ti ti-clock-pause" /> Suspended
                                </span>
                            ) : null}
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-800 text-slate-200 text-xs font-mono font-bold rounded border border-slate-700">
                                    <i className="ti ti-id text-slate-400" /> {employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-EMPLOYEE')}
                                </span>

                                {/* Status badge */}
                                {isTerminated ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-500/20 text-rose-300 text-xs font-bold rounded border border-rose-500/40">
                                        <i className="ti ti-circle-x text-sm text-rose-400" /> Terminated / Separated
                                    </span>
                                ) : isSuspended ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-500/20 text-amber-300 text-xs font-bold rounded border border-amber-500/40">
                                        <i className="ti ti-alert-triangle text-sm text-amber-400" /> Suspended · Operational Hold
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs font-semibold rounded border border-emerald-500/30">
                                        Active Personnel
                                    </span>
                                )}

                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-500/20 text-blue-300 text-xs font-semibold rounded border border-blue-500/30">
                                    {employee.department || 'General'}
                                </span>
                                {isFactory ? (
                                    <>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-500/20 text-amber-300 text-xs font-semibold rounded border border-amber-500/30">
                                            <i className={`ti ${shoeRole?.icon || 'ti-shoe'}`} />
                                            {shoeRole ? shoeRole.label : (employee.job_title || 'Shoe Craft')}
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-500/20 text-amber-300 text-xs font-semibold rounded border border-amber-500/30">
                                            <i className="ti ti-users" />
                                            {employee?.production_groups?.name || prodGroup}
                                            {employee?.production_groups?.code ? ` (${employee.production_groups.code})` : ''}
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-purple-500/20 text-purple-300 text-xs font-semibold rounded border border-purple-500/30">
                                            Group Piece-Rate (Pool)
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
                                {employee.first_name} {employee.last_name}
                            </h1>
                            <p className="text-slate-300 font-medium text-xs sm:text-sm mt-0.5">
                                {employee.job_title || 'Staff Member'}
                            </p>

                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-3 text-xs font-medium text-slate-400">
                                <span className="flex items-center gap-1.5">
                                    <i className="ti ti-mail text-slate-400 text-sm" /> {employee.email}
                                </span>
                                {employee.phone && (
                                    <span className="flex items-center gap-1.5 font-mono">
                                        <i className="ti ti-phone text-slate-400 text-sm" /> {employee.phone}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Temporary credentials for unregistered accounts */}
                {isPendingRegistration && (
                    <div className="bg-amber-500/10 border-2 border-amber-300 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-amber-200/80">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                                    <i className="ti ti-key text-xl" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-extrabold text-amber-950 text-base sm:text-lg">
                                            Account Pending Initial Registration
                                        </h3>
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-200 text-amber-900 border border-amber-300">
                                            Unregistered
                                        </span>
                                    </div>
                                    <p className="text-xs text-amber-800/90 font-medium mt-0.5">
                                        This employee has not signed in yet. Their temporary password remains preserved below until first login.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={copyAllCredentials}
                                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className={`ti ${copiedKey === 'all' ? 'ti-check' : 'ti-copy'} text-sm`} />
                                    <span>{copiedKey === 'all' ? 'Credentials Copied!' : 'Copy Onboarding Info'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResetTempPassword}
                                    disabled={isResettingPassword}
                                    title="Generate a fresh temporary password"
                                    className="px-3 py-2 bg-white hover:bg-amber-50 active:scale-95 text-amber-900 font-bold text-xs rounded-xl border border-amber-300 shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                    <i className={`ti ${isResettingPassword ? 'ti-loader animate-spin' : 'ti-refresh'} text-sm text-amber-700`} />
                                    <span className="hidden sm:inline">New Temp Pass</span>
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                            {/* Email */}
                            <div className="bg-white p-3.5 rounded-xl border border-amber-200/80 flex flex-col justify-between space-y-2">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Login Email</p>
                                    <p className="font-bold text-xs text-slate-800 truncate mt-0.5" title={employee.email}>
                                        {employee.email}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(employee.email, 'email')}
                                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 self-start cursor-pointer"
                                >
                                    <i className={`ti ${copiedKey === 'email' ? 'ti-check text-emerald-600' : 'ti-copy'} text-xs`} />
                                    <span>{copiedKey === 'email' ? 'Copied' : 'Copy Email'}</span>
                                </button>
                            </div>

                            {/* Company ID */}
                            <div className="bg-white p-3.5 rounded-xl border border-amber-200/80 flex flex-col justify-between space-y-2">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Company ID</p>
                                    <p className="font-mono font-black text-sm text-slate-900 mt-0.5">
                                        {employee.company_id || employee.id}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(employee.company_id || employee.id, 'company_id')}
                                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 self-start cursor-pointer"
                                >
                                    <i className={`ti ${copiedKey === 'company_id' ? 'ti-check text-emerald-600' : 'ti-copy'} text-xs`} />
                                    <span>{copiedKey === 'company_id' ? 'Copied' : 'Copy ID'}</span>
                                </button>
                            </div>

                            {/* Temporary Password */}
                            <div className="bg-white p-3.5 rounded-xl border border-amber-300 ring-2 ring-amber-400/20 flex flex-col justify-between space-y-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Temporary Password</p>
                                    <button
                                        type="button"
                                        onClick={() => setShowTempPassword(!showTempPassword)}
                                        className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                        title={showTempPassword ? 'Hide Password' : 'Show Password'}
                                    >
                                        <i className={`ti ${showTempPassword ? 'ti-eye-off' : 'ti-eye'} text-sm`} />
                                    </button>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-black text-base text-amber-950 tracking-wider">
                                        {showTempPassword ? (employee.temp_password || 'Emp-1234') : '••••••••'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(employee.temp_password || 'Emp-1234', 'password')}
                                        className="px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[11px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                        <i className={`ti ${copiedKey === 'password' ? 'ti-check text-emerald-600' : 'ti-copy'} text-xs`} />
                                        <span>{copiedKey === 'password' ? 'Copied' : 'Copy'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2 border-t border-amber-200/60 flex items-center gap-2 text-[11px] text-amber-800/80 font-medium">
                            <i className="ti ti-info-circle text-amber-700 shrink-0 text-sm" />
                            <span>
                                Once the employee registers by logging in and configuring their personal password, this temporary password will be wiped and will automatically disappear from this profile.
                            </span>
                        </div>
                    </div>
                )}

                {/* Status alert banner */}
                {isTerminated && (
                    <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 border border-rose-200">
                                <i className="ti ti-ban text-xl" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-rose-900 text-sm sm:text-base">Administrative Separation & Account Termination</h4>
                                    <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase rounded ${isInCooldown ? 'bg-amber-200/80 text-amber-900' : 'bg-rose-200/80 text-rose-900'}`}>
                                        {isInCooldown ? `Cooldown · ${cooldownDaysRemaining}d Left` : 'DOLE Separated · Finalized'}
                                    </span>
                                </div>
                                <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                                    {employee.termination_record?.reason || 'This employee account has been officially separated from active roster. Portal access and attendance permissions are deactivated.'}
                                </p>
                                <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-rose-700 font-medium">
                                    {employee.termination_record?.date && (
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-calendar-event" /> Effective Date: <strong className="text-rose-900">{employee.termination_record.date}</strong>
                                        </span>
                                    )}
                                    {isInCooldown && (
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-hourglass-low" /> <strong className="text-rose-900">{cooldownDaysRemaining} day{cooldownDaysRemaining === 1 ? '' : 's'}</strong> remaining in the reversible cooldown window.
                                        </span>
                                    )}
                                    <span className="flex items-center gap-1">
                                        <i className="ti ti-lock" /> Biometric Pass Revoked
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <i className="ti ti-file-off" /> Document Vault Uploads Locked (Audit-Only)
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="shrink-0 self-stretch sm:self-center flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setIsReinstateModalOpen(true)}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold rounded-lg shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer touch-manipulation"
                            >
                                <i className="ti ti-rotate-clockwise text-sm" /> Reinstate Employee
                            </button>
                            <Link
                                to={`/admin/documents?employee_id=${employee.id}`}
                                className="px-3.5 py-2 bg-white hover:bg-rose-100 text-rose-800 text-xs font-bold rounded-lg border border-rose-300 shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                            >
                                <i className="ti ti-folders text-sm" /> Review Documents
                            </Link>
                        </div>
                    </div>
                )}

                {isSuspended && (
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200">
                                <i className="ti ti-alert-triangle text-xl" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-amber-900 text-sm sm:text-base">Active Disciplinary Suspension</h4>
                                    <span className="px-2 py-0.5 bg-amber-200/80 text-amber-900 text-[10px] font-extrabold uppercase rounded">Operational Hold</span>
                                </div>
                                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                                    {employee.active_suspension?.reason || 'This employee is currently serving an active disciplinary suspension.'}
                                </p>
                                <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-amber-700 font-medium">
                                    {employee.active_suspension?.date && (
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-calendar-time" /> Served Date: <strong className="text-amber-900">{employee.active_suspension.date}</strong>
                                        </span>
                                    )}
                                    <span className="flex items-center gap-1">
                                        <i className="ti ti-qrcode" /> QR Scanner Attendance Locked
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <i className="ti ti-shield-half" /> Auto-Restores Upon Expiry
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="shrink-0 self-stretch sm:self-center">
                            <Link
                                to="/admin/disciplinary"
                                className="px-3.5 py-2 bg-white hover:bg-amber-100 text-amber-900 text-xs font-bold rounded-lg border border-amber-300 shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                            >
                                <i className="ti ti-gavel text-sm" /> Disciplinary Logs
                            </Link>
                        </div>
                    </div>
                )}

                {!isTerminated && !isSuspended && employee?.past_suspensions_count > 0 && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 sm:p-4 flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                                <i className="ti ti-history text-sm" />
                            </div>
                            <div>
                                <span className="font-bold text-slate-800">Prior Disciplinary History:</span>{' '}
                                <span className="text-slate-600">
                                    This employee has previously served <strong>{employee.past_suspensions_count}</strong> {employee.past_suspensions_count === 1 ? 'suspension' : 'suspensions'}. All terms have concluded and account is currently in <strong>Good Standing</strong>.
                                </span>
                            </div>
                        </div>
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded shrink-0 border border-emerald-200">
                            Active / Cleared
                        </span>
                    </div>
                )}

                {/* Personal and payroll details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">

                    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className="h-10 w-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
                                <i className="ti ti-user text-xl" />
                            </div>
                            <div>
                                <h3 className="text-base font-black text-slate-800">Personal Details</h3>
                                <p className="text-xs text-slate-400 font-medium">Core identity & access role</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">First Name</p>
                                <p className="font-extrabold text-slate-800 text-sm">{employee.first_name || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Last Name</p>
                                <p className="font-extrabold text-slate-800 text-sm">{employee.last_name || 'N/A'}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Email Address</p>
                                <p className="font-extrabold text-slate-800 text-sm">{employee.email}</p>
                            </div>
                            <div>
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Role Privilege</p>
                                <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 font-black text-[11px] rounded-md uppercase border border-slate-200">
                                    {employee.role || 'employee'}
                                </span>
                            </div>
                            <div>
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Company ID</p>
                                <p className="font-mono font-extrabold text-slate-800 text-sm">{employee.company_id || employee.id}</p>
                            </div>
                            <div className="col-span-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-0.5">Account Status</p>
                                    <p className="text-xs text-slate-500 font-medium">
                                        {isPendingRegistration ? 'Awaiting initial employee login & password setup' : 'Account active and personal password configured'}
                                    </p>
                                </div>
                                <span className={`px-2.5 py-1 rounded-md text-[11px] font-black uppercase border ${
                                    isPendingRegistration 
                                        ? 'bg-amber-50 text-amber-800 border-amber-200' 
                                        : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                }`}>
                                    {isPendingRegistration ? 'Pending Setup' : 'Registered'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center border ${isFactory ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                }`}>
                                <i className={`ti ${isFactory ? 'ti-building-factory-2' : 'ti-cash-banknote'} text-xl`} />
                            </div>
                            <div>
                                <h3 className="text-base font-black text-slate-800">Payroll & Job Specs</h3>
                                <p className="text-xs text-slate-400 font-medium">Departmental salary scheme</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Department</p>
                                    <span className={`inline-flex items-center gap-1 font-extrabold text-sm ${isFactory ? 'text-amber-700' : 'text-slate-800'}`}>
                                        {employee.department || 'General'}
                                    </span>
                                </div>
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">{isFactory ? 'Shoe Production Station' : 'Job Title'}</p>
                                    <p className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
                                        {isFactory && <i className={`ti ${shoeRole?.icon || 'ti-shoe'} text-amber-600`} />}
                                        {employee.job_title || 'N/A'}
                                    </p>
                                </div>
                                <div className="pt-2 border-t border-slate-100">
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">
                                        {isFactory ? 'Line / Group Assignment' : 'Work Schedule'}
                                    </p>
                                    <p className="font-mono font-extrabold text-slate-800 text-xs">
                                        {isFactory
                                            ? `${employee?.production_groups?.name || prodGroup}${employee?.production_groups?.target_output_pairs ? ` · ${employee.production_groups.target_output_pairs} pairs/day quota` : ' (Shoe Craft)'}`
                                            : '08:00 AM – 08:00 PM'}
                                    </p>
                                </div>
                                <div className="pt-2 border-t border-slate-100">
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Overtime Status</p>
                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                        isFactory ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-blue-100 text-blue-800 border border-blue-200'
                                    }`}>
                                        {isFactory ? 'No Overtime (Prohibited)' : 'Overtime Eligible'}
                                    </span>
                                </div>
                            </div>

                            <div className={`p-4 rounded-xl border ${isFactory ? 'bg-amber-50/80 border-amber-200' : 'bg-emerald-50/80 border-emerald-200'}`}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[11px] font-black uppercase tracking-wider ${isFactory ? 'text-amber-900' : 'text-slate-500'}`}>
                                        {isFactory ? 'Factory Compensation Model' : 'Wage Structure'}
                                    </span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider border ${isFactory ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                        }`}>
                                        {isFactory ? 'Group Piece-Rate' : 'Daily & Hourly Wage'}
                                    </span>
                                </div>

                                {isFactory ? (
                                    <div className="space-y-1.5 pt-1">
                                        <div className="text-lg sm:text-xl font-black text-amber-900 tracking-tight flex items-center gap-1.5">
                                            <i className="ti ti-box-multiple text-amber-600 text-xl" />
                                            Group Production Batch Pool
                                        </div>
                                        <p className="text-xs text-amber-800 leading-relaxed font-medium">
                                            Compensation is calculated based on completed pairs of shoes produced by the 6-worker team ({shoeRole?.stage || 'Assembly'}) upon QA inspection.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-2 pt-1">
                                        <div className="flex items-baseline justify-between gap-4">
                                            <div>
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Daily Rate</span>
                                                <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-baseline gap-1">
                                                    <span className="text-emerald-600 text-xl font-bold">₱</span>
                                                    {dailyRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    <span className="text-xs font-bold text-slate-400 uppercase">/ day</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Hourly Rate</span>
                                                <div className="text-lg sm:text-xl font-black text-slate-700 tracking-tight flex items-baseline justify-end gap-1">
                                                    <span className="text-emerald-600 text-base font-bold">₱</span>
                                                    {hourlyRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    <span className="text-xs font-bold text-slate-400 uppercase">/ hr</span>
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-slate-500 font-medium pt-1 border-t border-slate-200/60">
                                            Standard DOLE 8-hour workday (Daily Rate ÷ 8).
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-[11px] pt-1">
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-0.5">Date Joined</p>
                                    <p className="font-bold text-slate-700">{formatDate(employee.created_at)}</p>
                                </div>
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-0.5">Last Updated</p>
                                    <p className="font-bold text-slate-700">{formatDateTime(employee.updated_at)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Biometric Authentication & Medical Exemption Card */}
                <div className="bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 p-5 sm:p-8 relative overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5 sm:mb-6">
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div className={`h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl flex items-center justify-center border ${
                                isMedicalExemptActive
                                    ? 'bg-amber-50 text-amber-700 border-amber-200/70'
                                    : employee?.has_registered_biometrics
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
                                    : 'bg-slate-50 text-slate-600 border-slate-200/70'
                            }`}>
                                <i className={`ti ${isMedicalExemptActive ? 'ti-first-aid-kit' : 'ti-face-id'} text-xl sm:text-2xl`} />
                            </div>
                            <div>
                                <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">
                                    Biometric Authentication
                                </h3>
                                <p className="text-xs text-slate-500 font-medium">
                                    Facial recognition verification and medical grace protocol
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-3 py-1 text-xs font-bold rounded-xl border uppercase tracking-wider ${
                                isMedicalExemptActive
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : employee?.has_registered_biometrics
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}>
                                {isMedicalExemptActive
                                    ? 'Medical Exemption Active'
                                    : employee?.has_registered_biometrics
                                    ? 'Enrolled'
                                    : 'Not Enrolled'}
                            </span>
                        </div>
                    </div>

                    {isMedicalExemptActive ? (
                        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 sm:p-5 text-xs text-slate-700 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-amber-200/60">
                                <div>
                                    <h4 className="font-bold text-amber-950 text-sm flex items-center gap-1.5">
                                        <i className="ti ti-first-aid-kit text-amber-700 text-base" />
                                        Medical Grace Exemption Active (QR-Only Clock-In)
                                    </h4>
                                    <p className="text-amber-900/80 mt-0.5">
                                        Facial recognition verification is temporarily bypassed. Clock-in requires QR badge only, and the kiosk takes an audit photo.
                                    </p>
                                </div>
                                {daysRemaining !== null && (
                                    <span className="px-2.5 py-1 rounded-md bg-amber-200/70 text-amber-900 font-bold text-xs shrink-0 self-start sm:self-auto">
                                        {daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-1">
                                <div>
                                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Valid Until</span>
                                    <span className="font-bold text-slate-800">{formatDate(medicalExemption?.valid_until)}</span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Medical Ref / Cert ID</span>
                                    <span className="font-mono font-bold text-slate-800">{medicalExemption?.cert_ref || 'N/A'}</span>
                                </div>
                                <div>
                                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Authorized By</span>
                                    <span className="font-bold text-slate-800 flex items-center gap-1.5 mt-0.5">
                                        <i className="ti ti-user-check text-slate-500 text-sm" />
                                        {formatAuthorizer(medicalExemption?.granted_by, medicalExemption?.granted_by_role)}
                                    </span>
                                    {medicalExemption?.granted_at && (
                                        <span className="text-[10px] text-slate-400 font-mono block">
                                            on {formatDate(medicalExemption.granted_at)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {medicalExemption?.reason && (
                                <div className="pt-1">
                                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Reason</span>
                                    <p className="text-slate-700 italic">{medicalExemption.reason}</p>
                                </div>
                            )}

                            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200/60">
                                <button
                                    type="button"
                                    onClick={() => handleExtendExemption(7)}
                                    disabled={isSubmittingExemption}
                                    className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 active:scale-95 text-amber-900 font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    +7 Days Extension
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRevokeExemption}
                                    disabled={isSubmittingExemption}
                                    className="px-3 py-1.5 bg-white hover:bg-slate-100 active:scale-95 text-slate-700 font-bold rounded-lg border border-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    Revoke Exemption
                                </button>
                                {employee?.has_registered_biometrics && (
                                    <button
                                        type="button"
                                        onClick={handleResetBiometrics}
                                        disabled={isResettingBiometrics}
                                        className="px-3 py-1.5 bg-white hover:bg-rose-50 active:scale-95 text-rose-700 font-bold rounded-lg border border-rose-200 transition-colors cursor-pointer disabled:opacity-50 ml-auto"
                                    >
                                        {isResettingBiometrics ? 'Resetting...' : 'Reset Biometrics'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : employee?.has_registered_biometrics ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                            <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200">
                                    <i className="ti ti-check text-lg" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-800 text-sm">Facial Biometrics Registered</h4>
                                    <p className="text-slate-500 mt-0.5 leading-relaxed">
                                        Dual-factor authentication (QR badge + facial recognition) is required at the gate kiosk.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto">
                                <button
                                    type="button"
                                    onClick={() => setIsExemptionModalOpen(true)}
                                    className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 active:scale-95 text-amber-800 font-bold rounded-lg border border-amber-200 transition-colors text-xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="ti ti-first-aid-kit text-sm" />
                                    <span>Grant Medical Grace</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResetBiometrics}
                                    disabled={isResettingBiometrics}
                                    className="px-3.5 py-2 bg-white hover:bg-slate-100 active:scale-95 text-slate-700 font-bold rounded-lg border border-slate-200 transition-colors text-xs cursor-pointer disabled:opacity-50"
                                >
                                    {isResettingBiometrics ? 'Resetting...' : 'Reset Biometrics'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                            <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-lg bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                                    <i className="ti ti-user-scan text-lg" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-800 text-sm">Biometric Profile Pending Enrollment</h4>
                                    <p className="text-slate-500 mt-0.5 leading-relaxed">
                                        No facial template registered yet. The employee will be enrolled during their first scan at the gate kiosk.
                                    </p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setIsExemptionModalOpen(true)}
                                className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 active:scale-95 text-amber-800 font-bold rounded-lg border border-amber-200 transition-colors text-xs flex items-center gap-1.5 cursor-pointer shrink-0 self-stretch sm:self-auto justify-center"
                            >
                                <i className="ti ti-first-aid-kit text-sm" />
                                <span>Grant Medical Grace</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Disciplinary & Compliance Records */}
                <div className="bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 p-5 sm:p-8 relative overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5 sm:mb-6">
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div className="h-10 w-10 sm:h-12 sm:w-12 bg-amber-50 text-amber-700 rounded-xl sm:rounded-2xl flex items-center justify-center border border-amber-200/70">
                                <i className="ti ti-scale text-xl sm:text-2xl" />
                            </div>
                            <div>
                                <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">
                                    Disciplinary & Compliance Records
                                </h3>
                                <p className="text-xs text-slate-500 font-medium">
                                    DOLE due process logs, written warnings, suspensions, and clearances
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-3 py-1 text-xs font-black rounded-xl border uppercase tracking-wider ${
                                isTerminated ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                isSuspended ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                disciplinaryLogs.some(l => l.status === 'Active') ? 'bg-amber-50 text-amber-800 border-amber-200' :
                                'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}>
                                {isTerminated ? 'Separated' :
                                 isSuspended ? 'Suspended' :
                                 disciplinaryLogs.some(l => l.status === 'Active') ? 'Active Notice' :
                                 'Good Standing'}
                            </span>

                            <Link
                                to={`/admin/disciplinary?search=${encodeURIComponent(employeeFullName || employee.first_name || '')}`}
                                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5"
                            >
                                <i className="ti ti-gavel text-sm" /> Disciplinary Hub
                            </Link>
                        </div>
                    </div>

                    {disciplinaryLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-10 px-4 bg-emerald-50/40 rounded-xl sm:rounded-2xl border border-dashed border-emerald-200">
                            <div className="h-12 w-12 sm:h-14 sm:w-14 bg-white text-emerald-600 rounded-2xl flex items-center justify-center border border-emerald-100 shadow-xs mb-3">
                                <i className="ti ti-shield-check text-2xl sm:text-3xl" />
                            </div>
                            <h4 className="text-sm sm:text-base font-black text-slate-800 mb-1">Clean Compliance Standing</h4>
                            <p className="text-xs sm:text-sm text-slate-500 font-medium max-w-md">
                                This employee currently has zero disciplinary infractions, warnings, or sanctions on record. Account is in full compliance with company policies and DOLE standards.
                            </p>
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
                                        className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                                            isResolvedTermination
                                                ? 'bg-emerald-50/30 border-emerald-200'
                                                : log.status === 'Active'
                                                ? 'bg-rose-50/30 border-rose-200'
                                                : log.status === 'Acknowledged'
                                                ? 'bg-blue-50/30 border-blue-200'
                                                : 'bg-slate-50/70 border-slate-200'
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/60">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider border flex items-center gap-1.5 ${
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

                                                {log.severity && (
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${
                                                        log.severity === 'Critical' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                        log.severity === 'High' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                                        log.severity === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                        'bg-blue-50 text-blue-700 border-blue-200'
                                                    }`}>
                                                        {log.severity} Severity
                                                    </span>
                                                )}

                                                <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                                                    <i className="ti ti-calendar text-xs" />
                                                    {formatDate(log.date || log.created_at)}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider border flex items-center gap-1 ${
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

                                        <div className="mt-3 text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
                                            <p className="whitespace-pre-line">{log.reason || 'No specific description recorded.'}</p>
                                        </div>

                                        {log.status === 'Acknowledged' && (
                                            <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-blue-700 font-medium flex items-center gap-1.5">
                                                <i className="ti ti-file-certificate text-sm" />
                                                <span>Acknowledged by employee via portal.</span>
                                            </div>
                                        )}
                                        {isReinstatedNote && (
                                            <div className="mt-2.5 pt-2 border-t border-emerald-100 text-[11px] text-emerald-800 font-bold flex items-center gap-1.5">
                                                <i className="ti ti-check text-sm" />
                                                <span>Record cleared and active standing restored.</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

            </div>

            {/* Delete confirmation modal */}
            
                {isDeleteModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                        <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
                            <div className="w-14 h-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border-4 border-red-100">
                                <i className="ti ti-alert-triangle text-2xl" />
                            </div>
                            <h2 className="text-xl font-black text-slate-800">Delete Employee Profile?</h2>
                            <p className="text-xs text-slate-500">
                                Type <strong className="text-slate-800">{employeeFullName}</strong> to confirm deletion.
                            </p>
                            <input
                                type="text"
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="Type full name..."
                                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-center font-bold text-xs"
                            />
                            <div className="flex gap-2">
                                <button onClick={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }} className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs cursor-pointer">
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleteConfirmText.trim().toLowerCase() !== employeeFullName.toLowerCase() || isDeleting}
                                    className="flex-1 py-2.5 bg-red-600 disabled:bg-slate-300 text-white font-bold rounded-xl text-xs cursor-pointer disabled:cursor-not-allowed transition-colors"
                                >
                                    {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            

            {/* Print QR badge modal */}
            
                {isPrintModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity no-print"
                            onClick={() => setIsPrintModalOpen(false)}
                        />
                        <div 
                            initial={{ scale: 0.95, y: 40, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 40, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            id="qr-print-card"
                            className="relative bg-white rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 text-center shadow-2xl w-full max-w-md border border-slate-200 z-10"
                        >
                            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
                                <div className="text-left">
                                    <h1 className="text-lg sm:text-xl font-black text-slate-900 uppercase tracking-wider">C-Point Official ID</h1>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Biometric Gate Pass</p>
                                </div>
                                <span className="px-3 py-1 bg-slate-900 text-white font-mono text-xs font-black rounded-lg">
                                    {employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS')}
                                </span>
                            </div>

                            <div className="flex justify-center mb-6">
                                <div className="p-4 bg-white border-2 border-slate-200/80 rounded-2xl flex items-center justify-center shadow-sm">
                                    <QRCode 
                                        value={employee.company_id || (employee.id ? String(employee.id) : 'CP-EMPLOYEE')} 
                                        size={240}
                                        fgColor="#0f172a"
                                        bgColor="#ffffff"
                                        level="H"
                                        margin={2}
                                        className="rounded-lg"
                                    />
                                </div>
                            </div>

                            <div className="mb-6">
                                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight truncate">{employee.name}</h2>
                                <p className="text-indigo-600 font-black uppercase text-xs sm:text-sm tracking-widest mt-1.5">{employee.job_title ?? 'STAFF'}</p>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-0.5">{employee.department ? employee.department + ' Department' : 'Operations'}</p>
                            </div>

                            <div className="no-print flex gap-2.5 sm:gap-3">
                                <button type="button" onClick={() => setIsPrintModalOpen(false)} className="flex-1 py-3 sm:py-3.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition tap-active text-xs sm:text-sm">
                                    Close
                                </button>
                                <button type="button" onClick={printCard} className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-3.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-indigo-600 shadow-xl shadow-slate-900/20 transition tap-active text-xs sm:text-sm">
                                    <i className="ti ti-printer text-base sm:text-lg" /> Print Badge
                                </button>
                            </div>
                        </div>
                    </div>      
                )}
            
            {/* Reinstatement Confirmation Modal */}
            {isReinstateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div 
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                        onClick={() => !isReinstating && setIsReinstateModalOpen(false)}
                    />
                    <div className="relative bg-white rounded-3xl p-6 sm:p-7 text-center shadow-2xl w-full max-w-md border border-slate-200 z-10 space-y-4">
                        <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-200">
                            <i className="ti ti-rotate-clockwise text-2xl" />
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Reinstate Employee</h3>
                            <p className="text-xs text-slate-500 font-medium mt-1">
                                Restore <strong className="text-slate-900">{employee.name || `${employee.first_name} ${employee.last_name}`}</strong> ({employee.company_id || 'N/A'}) to active operational standing.
                            </p>
                        </div>

                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 text-left text-xs space-y-2 text-slate-600">
                            <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                                <span className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">Current Standing</span>
                                <span className="px-2 py-0.5 bg-slate-200 text-slate-700 text-[10px] font-bold rounded">Pending Termination</span>
                            </div>
                            <p className="text-[11px] leading-relaxed">
                                Reinstatement will revoke the separation notice, clear the pending archive cooldown, unblock gate attendance scanner permissions, and return this record to the operational workforce directory.
                            </p>
                        </div>

                        <div className="flex gap-2.5 pt-1">
                            <button
                                type="button"
                                onClick={() => setIsReinstateModalOpen(false)}
                                disabled={isReinstating}
                                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleReinstate}
                                disabled={isReinstating}
                                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-xl text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                                {isReinstating ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        <span>Reinstating...</span>
                                    </>
                                ) : (
                                    <>
                                        <i className="ti ti-rotate-clockwise text-sm" />
                                        <span>Confirm Reinstatement</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Medical Grace Exemption Modal */}
            {isExemptionModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div 
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                        onClick={() => !isSubmittingExemption && setIsExemptionModalOpen(false)}
                    />
                    <div className="relative bg-white rounded-3xl p-6 sm:p-7 shadow-2xl w-full max-w-lg border border-slate-200 z-10 space-y-5">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                                <div className="w-11 h-11 bg-amber-50 text-amber-700 rounded-2xl flex items-center justify-center border border-amber-200">
                                    <i className="ti ti-first-aid-kit text-2xl" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-900">
                                        Biometric Medical Grace Exemption
                                    </h3>
                                    <p className="text-xs text-slate-500 font-medium">
                                        Temporary physical trauma & facial dressing protocol
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsExemptionModalOpen(false)}
                                disabled={isSubmittingExemption}
                                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
                            >
                                <i className="ti ti-x text-sm" />
                            </button>
                        </div>

                        <form onSubmit={handleEnableExemption} className="space-y-4 text-xs">
                            <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 leading-relaxed font-medium">
                                <p className="font-bold flex items-center gap-1.5 text-amber-950 mb-0.5">
                                    <i className="ti ti-info-circle text-base text-amber-600" />
                                    How this protocol functions:
                                </p>
                                <span>
                                    Enabling Medical Grace allows <strong className="text-amber-950">{employeeFullName}</strong> to clock in/out using their QR code without triggering Euclidean facial distance or eye-blink rejections. The kiosk camera will still capture a high-resolution snapshot for evidentiary verification.
                                </span>
                            </div>

                            <div>
                                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                                    Clinical Reason / Trauma Description <span className="text-rose-500">*</span>
                                </label>
                                <textarea
                                    required
                                    rows={2}
                                    value={exemptionForm.reason}
                                    onChange={(e) => setExemptionForm({ ...exemptionForm, reason: e.target.value })}
                                    placeholder="e.g., Facial lacerations and gauze dressing following road accident per attending physician..."
                                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                                        Medical Cert / Ref ID <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={exemptionForm.cert_ref}
                                        onChange={(e) => setExemptionForm({ ...exemptionForm, cert_ref: e.target.value })}
                                        placeholder="e.g., MC-2026-DR-SANTOS-88"
                                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-slate-800 text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                                        Exemption Duration
                                    </label>
                                    <select
                                        value={exemptionForm.duration_days}
                                        onChange={(e) => setExemptionForm({ ...exemptionForm, duration_days: Number(e.target.value) })}
                                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all outline-none"
                                    >
                                        <option value={7}>7 Days (Minor injury / swelling)</option>
                                        <option value={14}>14 Days (Standard trauma / sutures)</option>
                                        <option value={30}>30 Days (Major trauma / fracture recovery)</option>
                                        <option value={60}>60 Days (Extended reconstructive care)</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                                    Document Link / Vault File URL (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={exemptionForm.document_url}
                                    onChange={(e) => setExemptionForm({ ...exemptionForm, document_url: e.target.value })}
                                    placeholder="e.g., /admin/documents?employee_id=... or Medical Certificate scan"
                                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all outline-none"
                                />
                            </div>

                            <div className="flex gap-2.5 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsExemptionModalOpen(false)}
                                    disabled={isSubmittingExemption}
                                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingExemption}
                                    className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold rounded-xl text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                    {isSubmittingExemption ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            <span>Activating Protocol...</span>
                                        </>
                                    ) : (
                                        <>
                                            <i className="ti ti-shield-check text-sm" />
                                            <span>Authorize Medical Grace</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </>
    );
}