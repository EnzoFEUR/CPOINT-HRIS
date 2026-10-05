import React, { useState, useMemo, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import QRCode from '../../../components/QRCode';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import ActionMenu from '../../../components/ui/ActionMenu';
import { getShoeRoleDetails, parseProductionGroup } from '../../../utils/factoryRoles';
import bannerCover from '../../../assets/employee-cover.jpg';
import MonthlyWorkCalendar from '../../../components/attendance/MonthlyWorkCalendar';
import { computeDisciplinaryStanding } from '../../../utils/disciplinaryStanding';

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

const SEPARATION_DEFAULTS = {
    'Resignation': 'Voluntary Resignation',
    'End of Contract': 'Contract Expiration',
    'Retirement': 'Statutory Retirement (DOLE Art. 302)',
    'Authorized Cause': 'Redundancy / Authorized Cause (DOLE Art. 298)',
    'Just Cause': 'Serious Misconduct / Just Cause (DOLE Art. 297)',
    'Mutual Agreement': 'Mutual Separation Agreement'
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
    const [removalMode, setRemovalMode] = useState('archive'); // 'archive' | 'purge'
    const [separationType, setSeparationType] = useState('Resignation');
    const [separationReason, setSeparationReason] = useState('Voluntary Resignation');
    const [separationDate, setSeparationDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [separationNotes, setSeparationNotes] = useState('');
    const [isArchiving, setIsArchiving] = useState(false);
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
        if (!window.confirm(`Remove medical exemption for ${employee.first_name} ${employee.last_name}? Standard biometric verification will be required.`)) return;
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

    const handleArchiveEmployee = async () => {
        if (!employee) return;
        setIsArchiving(true);

        const nowIso = new Date().toISOString();
        const effectiveDate = separationDate || nowIso.split('T')[0];

        // 0ms Optimistic UI updates
        queryClient.setQueryData(['employeeDetails', id], (old) => {
            if (!old) return old;
            return {
                ...old,
                data: {
                    ...old.data,
                    status: 'terminated',
                    is_active: false,
                    archived_at: nowIso,
                    separation_type: separationType,
                    separation_reason: separationReason,
                    separation_date: effectiveDate,
                    separation_notes: separationNotes,
                    operational_status: 'Terminated',
                    is_terminated: true,
                    is_suspended: false,
                    termination_record: {
                        date: effectiveDate,
                        reason: separationReason,
                        type: separationType,
                        authorizer: 'System Administrator (HR)'
                    }
                }
            };
        });

        queryClient.setQueryData(['adminEmployees'], (old) => {
            if (!Array.isArray(old)) return old;
            return old.map(e => String(e.id) === String(id) ? {
                ...e,
                status: 'terminated',
                is_active: false,
                archived_at: nowIso,
                separation_type: separationType,
                separation_reason: separationReason,
                separation_date: effectiveDate,
                operational_status: 'Terminated',
                is_terminated: true,
                is_suspended: false
            } : e);
        });

        window.dispatchEvent(new CustomEvent('hris_disciplinary_sync', { detail: { userId: employee.id } }));

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await fetchWithAuth(`/api/employees/${employee.id}/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    separation_type: separationType,
                    separation_reason: separationReason,
                    separation_date: effectiveDate,
                    separation_notes: separationNotes,
                    admin_id: user?.id
                })
            });

            const resData = await res.json();
            if (!res.ok || !resData.success) {
                throw new Error(resData.error || 'Failed to archive employee');
            }

            toast.success(`${employeeFullName} successfully separated and preserved in Archive Vault.`);
            setIsDeleteModalOpen(false);

            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        } catch (err) {
            toast.error(err.message || 'Failed to archive employee');
            queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        } finally {
            setIsArchiving(false);
        }
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
                <div className="w-12 h-12 border-4 border-slate-200 border-t-accent rounded-full animate-spin" />
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
    const isSuspended = employee.operational_status === 'Suspended' || employee.is_suspended || employee.status === 'suspended';
    const isTerminated = !isSuspended && (employee.operational_status === 'Terminated' || employee.is_terminated || employee.status === 'terminated' || (Boolean(employee.archived_at) && employee.status !== 'active'));

    const standing = useMemo(() => computeDisciplinaryStanding({
        isTerminated,
        isSuspended,
        status: employee?.status,
        operational_status: employee?.operational_status,
        disciplinaryLogs
    }), [isTerminated, isSuspended, employee?.status, employee?.operational_status, disciplinaryLogs]);

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
                    <Link to="/admin/employees" className="h-8 px-3 bg-white text-slate-700 font-semibold text-xs rounded-md hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 transition-colors duration-100 shadow-2xs border border-slate-200 flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950">
                        <i className="ti ti-arrow-left text-sm" /> Back to Directory
                    </Link>
                    
                    <div className="flex items-center gap-1.5">
                        {/* Secondary Actions */}
                        <Link to={`/admin/documents?employee_id=${employee.id}`} className="h-8 px-3 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 hover:text-slate-900 font-semibold text-xs rounded-md transition-colors duration-100 shadow-2xs border border-slate-200 flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950">
                            <i className="ti ti-folders text-slate-500 text-sm" />
                            <span className="hidden sm:inline">Documents</span>
                        </Link>

                        <button onClick={() => setIsPrintModalOpen(true)} className="h-8 px-3 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 hover:text-slate-900 font-semibold text-xs rounded-md transition-colors duration-100 shadow-2xs border border-slate-200 flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950">
                            <i className="ti ti-qrcode text-slate-500 text-sm" />
                            <span className="hidden sm:inline">Print Badge</span>
                        </button>

                        {/* Primary Action CTA */}
                        <Link to={`/admin/employees/${employee.id}/edit`} className="h-8 px-3.5 bg-accent hover:bg-accent-hover active:bg-accent-hover text-white font-semibold text-xs rounded-md transition-colors duration-100 shadow-2xs flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
                            <i className="ti ti-pencil text-sm" />
                            <span>Edit Profile</span>
                        </Link>

                        {/* Administrative & Lifecycle Overflow Action Menu */}
                        <ActionMenu
                            align="right"
                            title="More employee actions"
                            items={[
                                ...(isTerminated ? [
                                    {
                                        label: 'Reinstate Employee',
                                        icon: 'ti-rotate-clockwise text-success-ink',
                                        onClick: () => setIsReinstateModalOpen(true),
                                    },
                                    { divider: true },
                                    {
                                        label: 'Purge Record',
                                        icon: 'ti-trash',
                                        destructive: true,
                                        onClick: () => {
                                            setRemovalMode('purge');
                                            setDeleteConfirmText('');
                                            setIsDeleteModalOpen(true);
                                        }
                                    }
                                ] : [
                                    {
                                        label: 'Offboard / Archive',
                                        icon: 'ti-archive',
                                        destructive: true,
                                        onClick: () => {
                                            setRemovalMode('archive');
                                            setDeleteConfirmText('');
                                            setIsDeleteModalOpen(true);
                                        }
                                    }
                                ])
                            ]}
                        />
                    </div>
                </div>

                {/* Profile banner */}
                <div className="bg-slate-900 rounded-lg p-5 sm:p-6 border border-slate-800 text-white shadow-2xs relative">
                    {/* Cover photo. Phones: top band that fades downward. sm and up: right-side panel that fades leftward.
                        Both resolve into the banner surface (#0f172a), so there is no seam at any width. */}
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden rounded-t-[7px] sm:inset-y-0 sm:left-auto sm:right-0 sm:h-auto sm:w-2/5 sm:rounded-none sm:rounded-r-[7px] lg:w-[38%]"
                    >
                        <img
                            src={bannerCover}
                            alt=""
                            decoding="async"
                            draggable={false}
                            className={`h-full w-full select-none object-cover object-[50%_16%] transition-[filter] duration-500 ${isTerminated ? 'grayscale' : 'saturate-[0.6]'}`}
                        />
                        <div className="absolute inset-0 bg-slate-900/50" />
                        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(15,23,42,0)_0%,rgba(15,23,42,0.55)_60%,#0f172a_100%)] sm:hidden" />
                        <div className="absolute inset-0 hidden bg-[linear-gradient(to_right,#0f172a_0%,rgba(15,23,42,0.92)_18%,rgba(15,23,42,0.4)_60%,rgba(15,23,42,0)_100%)] sm:block" />
                    </div>

                    <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
                        <div className={`relative h-24 w-24 sm:h-28 sm:w-28 shrink-0 transition-all duration-500 ${isInCooldown ? 'grayscale opacity-60' : ''}`}>
                            <EmployeeAvatar
                                employee={employee}
                                size="h-24 w-24 sm:h-28 sm:w-28"
                                rounded="rounded-lg"
                                border="border-2 border-slate-700"
                                shadow="shadow-2xs"
                                theme="dark"
                                textSize="text-3xl sm:text-4xl"
                            />
                            {isTerminated ? (
                                <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-md bg-danger text-white text-[10px] font-semibold uppercase ring-2 ring-slate-900 flex items-center gap-1 shadow-2xs">
                                    <i className="ti ti-x" /> Terminated
                                </span>
                            ) : isSuspended ? (
                                <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-md bg-warning text-white text-[10px] font-semibold uppercase ring-2 ring-slate-900 flex items-center gap-1 shadow-2xs">
                                    <i className="ti ti-clock-pause" /> Suspended
                                </span>
                            ) : null}
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-800 text-slate-200 text-xs font-mono font-medium rounded border border-slate-700">
                                    <i className="ti ti-id text-slate-400" /> {employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-EMPLOYEE')}
                                </span>

                                {/* Status badge */}
                                {isTerminated ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-danger/20 text-danger text-xs font-semibold rounded border border-danger/40">
                                        <i className="ti ti-circle-x text-sm text-danger" /> Terminated / Separated
                                    </span>
                                ) : isSuspended ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-warning/20 text-warning text-xs font-semibold rounded border border-warning/40">
                                        <i className="ti ti-alert-triangle text-sm text-warning" /> Suspended · Operational Hold
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 bg-surface-muted text-ink text-xs font-semibold rounded border border-line">
                                        Active Personnel
                                    </span>
                                )}

                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent/20 text-accent-on-dark text-xs font-semibold rounded border border-accent/30">
                                    {employee.department || 'General'}
                                </span>
                                {isFactory ? (
                                    <>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-warning/20 text-warning text-xs font-semibold rounded border border-warning/30">
                                            <i className={`ti ${shoeRole?.icon || 'ti-shoe'}`} />
                                            {shoeRole ? shoeRole.label : (employee.job_title || 'Shoe Craft')}
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-warning/20 text-warning text-xs font-semibold rounded border border-warning/30">
                                            <i className="ti ti-users" />
                                            {employee?.production_groups?.name || prodGroup}
                                            {employee?.production_groups?.code ? ` (${employee.production_groups.code})` : ''}
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent/20 text-accent-on-dark text-xs font-semibold rounded border border-accent/30">
                                            Group Piece-Rate (Pool)
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent/20 text-accent-on-dark text-xs font-semibold rounded border border-accent/30">
                                            Regular (08:00 - 20:00 • OT Eligible)
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-surface-muted text-ink text-xs font-semibold rounded border border-line">
                                            Salaried Monthly
                                        </span>
                                    </>
                                )}
                            </div>

                            <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight truncate">
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
                    <div className="bg-warning/10 border border-warning/20 rounded-lg p-4 sm:p-5 shadow-2xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-warning/80">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-md bg-warning text-white flex items-center justify-center shrink-0 shadow-2xs">
                                    <i className="ti ti-key text-lg" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-semibold text-warning-ink text-base sm:text-lg">
                                            Account Pending Initial Registration
                                        </h3>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-warning-subtle text-warning-ink border border-warning/20">
                                            Unregistered
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={copyAllCredentials}
                                    className="h-8 px-3 bg-warning hover:bg-warning-ink text-white font-medium text-xs rounded-md shadow-2xs transition-colors duration-100 flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className={`ti ${copiedKey === 'all' ? 'ti-check' : 'ti-copy'} text-sm`} />
                                    <span>{copiedKey === 'all' ? 'Credentials Copied' : 'Copy Onboarding Info'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResetTempPassword}
                                    disabled={isResettingPassword}
                                    title="Generate a fresh temporary password"
                                    className="h-8 px-3 bg-white hover:bg-warning-subtle text-warning-ink font-medium text-xs rounded-md border border-warning/20 shadow-2xs transition-colors duration-100 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                    <i className={`ti ${isResettingPassword ? 'ti-loader animate-spin' : 'ti-refresh'} text-sm text-warning-ink`} />
                                    <span className="hidden sm:inline">New Temp Pass</span>
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                            {/* Email */}
                            <div className="bg-white p-3 rounded-md border border-warning/80 flex flex-col justify-between space-y-2">
                                <div>
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Login Email</p>
                                    <p className="font-semibold text-xs text-slate-800 truncate mt-0.5" title={employee.email}>
                                        {employee.email}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(employee.email, 'email')}
                                    className="text-[11px] font-semibold text-accent hover:text-accent flex items-center gap-1 self-start cursor-pointer transition-colors duration-100"
                                >
                                    <i className={`ti ${copiedKey === 'email' ? 'ti-check text-ink' : 'ti-copy'} text-xs`} />
                                    <span>{copiedKey === 'email' ? 'Copied' : 'Copy Email'}</span>
                                </button>
                            </div>

                            {/* Company ID */}
                            <div className="bg-white p-3 rounded-md border border-warning/80 flex flex-col justify-between space-y-2">
                                <div>
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Company ID</p>
                                    <p className="font-mono font-semibold text-sm text-slate-900 mt-0.5">
                                        {employee.company_id || employee.id}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(employee.company_id || employee.id, 'company_id')}
                                    className="text-[11px] font-semibold text-accent hover:text-accent flex items-center gap-1 self-start cursor-pointer transition-colors duration-100"
                                >
                                    <i className={`ti ${copiedKey === 'company_id' ? 'ti-check text-ink' : 'ti-copy'} text-xs`} />
                                    <span>{copiedKey === 'company_id' ? 'Copied' : 'Copy ID'}</span>
                                </button>
                            </div>

                            {/* Temporary Password */}
                            <div className="bg-white p-3 rounded-md border border-warning/20 flex flex-col justify-between space-y-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-[10px] font-semibold text-warning-ink uppercase tracking-wider">Temporary Password</p>
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
                                    <span className="font-mono font-semibold text-base text-warning-ink tracking-wider">
                                        {showTempPassword ? (employee.temp_password || 'Emp-1234') : '••••••••'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(employee.temp_password || 'Emp-1234', 'password')}
                                        className="h-7 px-2.5 bg-warning-subtle hover:bg-warning-subtle text-warning-ink font-medium text-xs rounded transition-colors duration-100 flex items-center gap-1 cursor-pointer"
                                    >
                                        <i className={`ti ${copiedKey === 'password' ? 'ti-check text-ink' : 'ti-copy'} text-xs`} />
                                        <span>{copiedKey === 'password' ? 'Copied' : 'Copy'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Status alert banner */}
                {isTerminated && (
                    <div className="bg-danger-subtle border border-danger/20 rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5">
                            <div className="w-8 h-8 rounded-md bg-danger-subtle text-danger-ink flex items-center justify-center shrink-0 border border-danger/20">
                                <i className="ti ti-ban text-lg" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="font-semibold text-danger-ink text-sm sm:text-base">Administrative Separation & Account Termination</h4>
                                    <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded ${isInCooldown ? 'bg-warning-subtle/80 text-warning-ink' : 'bg-danger-subtle/80 text-danger-ink'}`}>
                                        {isInCooldown ? `Cooldown · ${cooldownDaysRemaining}d Left` : 'DOLE Separated · Finalized'}
                                    </span>
                                </div>
                                <p className="text-xs text-danger-ink mt-1 leading-relaxed">
                                    {employee.termination_record?.reason || 'This employee account has been officially separated from active roster. Portal access and attendance permissions are deactivated.'}
                                </p>
                                <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-danger-ink font-medium">
                                    {employee.termination_record?.date && (
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-calendar-event" /> Effective Date: <strong className="text-danger-ink font-semibold">{employee.termination_record.date}</strong>
                                        </span>
                                    )}
                                    {isInCooldown && (
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-hourglass-low" /> <strong className="text-danger-ink font-semibold">{cooldownDaysRemaining} day{cooldownDaysRemaining === 1 ? '' : 's'}</strong> remaining in the reversible cooldown window.
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
                                className="h-8 px-3 bg-success hover:bg-success-ink text-white text-xs font-medium rounded-md shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100 cursor-pointer touch-manipulation"
                            >
                                <i className="ti ti-rotate-clockwise text-sm" /> Reinstate Employee
                            </button>
                            <Link
                                to={`/admin/documents?employee_id=${employee.id}`}
                                className="h-8 px-3 bg-white hover:bg-danger-subtle text-danger-ink text-xs font-medium rounded-md border border-danger/20 shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100"
                            >
                                <i className="ti ti-folders text-sm" /> Review Documents
                            </Link>
                        </div>
                    </div>
                )}

                {isSuspended && (
                    <div className="bg-warning-subtle border border-warning/20 rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5">
                            <div className="w-8 h-8 rounded-md bg-warning-subtle text-warning-ink flex items-center justify-center shrink-0 border border-warning/20">
                                <i className="ti ti-alert-triangle text-lg" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="font-semibold text-warning-ink text-sm sm:text-base">Active Disciplinary Suspension</h4>
                                    <span className="px-2 py-0.5 bg-warning-subtle/80 text-warning-ink text-[10px] font-semibold uppercase rounded">Operational Hold</span>
                                </div>
                                <p className="text-xs text-warning-ink mt-1 leading-relaxed">
                                    {employee.active_suspension?.reason || 'This employee is currently serving an active disciplinary suspension.'}
                                </p>
                                <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-warning-ink font-medium">
                                    {employee.active_suspension?.date && (
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-calendar-time" /> Served Date: <strong className="text-warning-ink font-semibold">{employee.active_suspension.date}</strong>
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
                                className="h-8 px-3 bg-white hover:bg-warning-subtle text-warning-ink text-xs font-medium rounded-md border border-warning/20 shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100"
                            >
                                <i className="ti ti-gavel text-sm" /> Disciplinary Logs
                            </Link>
                        </div>
                    </div>
                )}

                {!isTerminated && !isSuspended && standing.tierCode !== 'CLEAN' && (
                    <div className={`border rounded-md px-3.5 py-2.5 sm:px-4 flex items-center justify-between gap-3 text-xs ${standing.bannerClass}`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-6 h-6 rounded bg-white/80 border border-black/5 flex items-center justify-center shrink-0 shadow-2xs">
                                <i className={`ti ${standing.icon} text-sm`} />
                            </div>
                            <span className="font-bold text-slate-900 truncate">{standing.title}</span>
                        </div>
                        <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border shrink-0 ${standing.badgeClass}`}>
                            {standing.badgeLabel}
                        </span>
                    </div>
                )}

                {/* Personal and payroll details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">

                    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className="h-8 w-8 bg-accent-subtle text-accent rounded-md flex items-center justify-center border border-accent/20">
                                <i className="ti ti-user text-lg" />
                            </div>
                            <div>
                                <h3 className="text-sm sm:text-base font-semibold text-slate-900">Personal Details</h3>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                                <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">First Name</p>
                                <p className="font-semibold text-slate-800 text-sm">{employee.first_name || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">Last Name</p>
                                <p className="font-semibold text-slate-800 text-sm">{employee.last_name || 'N/A'}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">Email Address</p>
                                <p className="font-semibold text-slate-800 text-sm">{employee.email}</p>
                            </div>
                            <div>
                                <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">Role Privilege</p>
                                <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 font-semibold text-[11px] rounded-md uppercase border border-slate-200">
                                    {employee.role || 'employee'}
                                </span>
                            </div>
                            <div>
                                <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">Company ID</p>
                                <p className="font-mono font-semibold text-slate-800 text-sm">{employee.company_id || employee.id}</p>
                            </div>
                            <div className="col-span-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                                <div>
                                    <p className="font-semibold text-slate-400 uppercase tracking-wider mb-0.5 text-[10px]">Account Status</p>
                                    <span className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase border ${
                                        isPendingRegistration 
                                            ? 'bg-warning-subtle text-warning-ink border-warning/20' 
                                            : 'bg-surface-muted text-ink border-line'
                                    }`}>
                                        {isPendingRegistration ? 'Pending Setup' : 'Registered'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className={`h-8 w-8 rounded-md flex items-center justify-center border ${isFactory ? 'bg-warning-subtle text-warning-ink border-warning/20' : 'bg-surface-muted text-ink border-line'
                                }`}>
                                <i className={`ti ${isFactory ? 'ti-building-factory-2' : 'ti-cash-banknote'} text-lg`} />
                            </div>
                            <div>
                                <h3 className="text-sm sm:text-base font-semibold text-slate-900">Payroll & Job Specs</h3>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                    <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">Department</p>
                                    <span className={`inline-flex items-center gap-1 font-semibold text-sm ${isFactory ? 'text-warning-ink' : 'text-slate-800'}`}>
                                        {employee.department || 'General'}
                                    </span>
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">{isFactory ? 'Shoe Production Station' : 'Job Title'}</p>
                                    <p className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                                        {isFactory && <i className={`ti ${shoeRole?.icon || 'ti-shoe'} text-ink-subtle`} />}
                                        {employee.job_title || 'N/A'}
                                    </p>
                                </div>
                                <div className="pt-2 border-t border-slate-100">
                                    <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">
                                        {isFactory ? 'Line / Group Assignment' : 'Work Schedule'}
                                    </p>
                                    <p className="font-mono font-semibold text-slate-800 text-xs">
                                        {isFactory
                                            ? `${employee?.production_groups?.name || prodGroup}${employee?.production_groups?.target_output_pairs ? ` · ${employee.production_groups.target_output_pairs} pairs/day quota` : ' (Shoe Craft)'}`
                                            : '08:00 AM – 08:00 PM'}
                                    </p>
                                </div>
                                <div className="pt-2 border-t border-slate-100">
                                    <p className="font-semibold text-slate-400 uppercase tracking-wider mb-1 text-[10px]">Overtime Status</p>
                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                        isFactory ? 'bg-warning-subtle text-warning-ink border border-warning/20' : 'bg-accent-subtle text-accent-strong border border-accent/20'
                                    }`}>
                                        {isFactory ? 'No Overtime (Prohibited)' : 'Overtime Eligible'}
                                    </span>
                                </div>
                            </div>

                            <div className={`p-3.5 rounded-md border ${isFactory ? 'bg-warning-subtle/80 border-warning/20' : 'bg-surface-muted border-line'}`}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[11px] font-semibold uppercase tracking-wider ${isFactory ? 'text-warning-ink' : 'text-slate-500'}`}>
                                        {isFactory ? 'Factory Compensation Model' : 'Wage Structure'}
                                    </span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold uppercase tracking-wider border ${isFactory ? 'bg-warning-subtle text-warning-ink border-warning/20' : 'bg-surface-muted text-ink border-line'
                                        }`}>
                                        {isFactory ? 'Group Piece-Rate' : 'Daily & Hourly Wage'}
                                    </span>
                                </div>

                                {isFactory ? (
                                    <div className="space-y-1.5 pt-1">
                                        <div className="text-base sm:text-lg font-semibold text-warning-ink tracking-tight flex items-center gap-1.5">
                                            <i className="ti ti-box-multiple text-warning-ink text-lg" />
                                            Group Production Batch Pool
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2 pt-1">
                                        <div className="flex items-baseline justify-between gap-4">
                                            <div>
                                                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Daily Rate</span>
                                                <div className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight flex items-baseline gap-1">
                                                    <span className="text-ink text-lg font-bold">₱</span>
                                                    {dailyRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    <span className="text-xs font-medium text-slate-400 uppercase">/ day</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Hourly Rate</span>
                                                <div className="text-base sm:text-lg font-semibold text-slate-700 tracking-tight flex items-baseline justify-end gap-1">
                                                    <span className="text-ink text-sm font-bold">₱</span>
                                                    {hourlyRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    <span className="text-xs font-medium text-slate-400 uppercase">/ hr</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-[11px] pt-1">
                                <div>
                                    <p className="font-semibold text-slate-400 uppercase tracking-wider mb-0.5 text-[10px]">Date Joined</p>
                                    <p className="font-semibold text-slate-700">{formatDate(employee.created_at)}</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-400 uppercase tracking-wider mb-0.5 text-[10px]">Last Updated</p>
                                    <p className="font-semibold text-slate-700">{formatDateTime(employee.updated_at)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Monthly Work Days & Attendance Audit Section */}
                <MonthlyWorkCalendar
                    employeeId={employee?.id || id}
                    employeeName={employee?.name || `${employee?.first_name || ''} ${employee?.last_name || ''}`}
                    isEmployeeView={false}
                />

                {/* Biometric Authentication & Medical Exemption Card */}
                <div className="bg-white rounded-lg shadow-2xs border border-slate-200 p-5 sm:p-6 relative overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                        <div className="flex items-center gap-3">
                            <div className={`h-8 w-8 rounded-md flex items-center justify-center border ${
                                isMedicalExemptActive
                                    ? 'bg-warning-subtle text-warning-ink border-warning/70'
                                    : employee?.has_registered_biometrics
                                    ? 'bg-surface-muted text-ink border-line'
                                    : 'bg-slate-50 text-slate-600 border-slate-200/70'
                            }`}>
                                <i className={`ti ${isMedicalExemptActive ? 'ti-first-aid-kit' : 'ti-face-id'} text-lg`} />
                            </div>
                            <div>
                                <h3 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight">
                                    Biometric Authentication
                                </h3>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md border uppercase tracking-wider ${
                                isMedicalExemptActive
                                    ? 'bg-warning-subtle text-warning-ink border-warning/20'
                                    : employee?.has_registered_biometrics
                                    ? 'bg-surface-muted text-ink border-line'
                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}>
                                {isMedicalExemptActive
                                    ? 'Medical Exemption Active'
                                    : employee?.has_registered_biometrics
                                    ? 'Registered'
                                    : 'Not Registered'}
                            </span>
                        </div>
                    </div>

                    {isMedicalExemptActive ? (
                        <div className="bg-warning-subtle/70 border border-warning/20 rounded-md p-4 text-xs text-slate-700 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-warning/60">
                                <div>
                                    <h4 className="font-semibold text-warning-ink text-sm flex items-center gap-1.5">
                                        <i className="ti ti-first-aid-kit text-warning-ink text-base" />
                                        Medical Grace Exemption Active (QR-Only Clock-In)
                                    </h4>
                                    <p className="text-warning-ink/80 mt-0.5">
                                        Facial recognition verification is temporarily bypassed. Clock-in requires QR badge only, and the kiosk takes an audit photo.
                                    </p>
                                </div>
                                {daysRemaining !== null && (
                                    <span className="px-2 py-0.5 rounded bg-warning-subtle/70 text-warning-ink font-semibold text-xs shrink-0 self-start sm:self-auto">
                                        {daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-1">
                                <div>
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Valid Until</span>
                                    <span className="font-semibold text-slate-800">{formatDate(medicalExemption?.valid_until)}</span>
                                </div>
                                <div>
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Medical Ref / Cert ID</span>
                                    <span className="font-mono font-semibold text-slate-800">{medicalExemption?.cert_ref || 'N/A'}</span>
                                </div>
                                <div>
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Authorized By</span>
                                    <span className="font-semibold text-slate-800 flex items-center gap-1.5 mt-0.5">
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
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Reason</span>
                                    <p className="text-slate-700 italic">{medicalExemption.reason}</p>
                                </div>
                            )}

                            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-warning/60">
                                <button
                                    type="button"
                                    onClick={() => handleExtendExemption(7)}
                                    disabled={isSubmittingExemption}
                                    className="h-8 px-3 bg-warning-subtle hover:bg-warning-subtle text-warning-ink font-medium text-xs rounded-md transition-colors duration-100 cursor-pointer disabled:opacity-50"
                                >
                                    +7 Days Extension
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRevokeExemption}
                                    disabled={isSubmittingExemption}
                                    className="h-8 px-3 bg-white hover:bg-slate-100 text-slate-700 font-medium text-xs rounded-md border border-slate-200 transition-colors duration-100 cursor-pointer disabled:opacity-50"
                                >
                                    Revoke Exemption
                                </button>
                                {employee?.has_registered_biometrics && (
                                    <button
                                        type="button"
                                        onClick={handleResetBiometrics}
                                        disabled={isResettingBiometrics}
                                        className="h-8 px-3 bg-white hover:bg-danger-subtle text-danger-ink font-medium text-xs rounded-md border border-danger/20 transition-colors duration-100 cursor-pointer disabled:opacity-50 ml-auto"
                                    >
                                        {isResettingBiometrics ? 'Resetting...' : 'Reset Biometrics'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : employee?.has_registered_biometrics ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-md bg-surface-muted text-ink flex items-center justify-center shrink-0 border border-line">
                                    <i className="ti ti-check text-base" />
                                </div>
                                <div>
                                    <h4 className="font-semibold text-slate-800 text-sm">Face scan registered</h4>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto">
                                <button
                                    type="button"
                                    onClick={() => setIsExemptionModalOpen(true)}
                                    className="h-8 px-3 bg-warning-subtle hover:bg-warning-subtle text-warning-ink font-medium rounded-md border border-warning/20 transition-colors duration-100 text-xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="ti ti-first-aid-kit text-sm" />
                                    <span>Grant medical exemption</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResetBiometrics}
                                    disabled={isResettingBiometrics}
                                    className="h-8 px-3 bg-white hover:bg-slate-100 text-slate-700 font-medium rounded-md border border-slate-200 transition-colors duration-100 text-xs cursor-pointer disabled:opacity-50"
                                >
                                    {isResettingBiometrics ? 'Resetting...' : 'Reset face scan'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-md bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                                    <i className="ti ti-user-scan text-base" />
                                </div>
                                <div>
                                    <h4 className="font-semibold text-slate-800 text-sm">Face scan not registered</h4>
                                    <p className="text-slate-500 mt-0.5 leading-relaxed">
                                        No face scan registered yet. The employee can register during their first scan at the kiosk.
                                    </p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setIsExemptionModalOpen(true)}
                                className="h-8 px-3 bg-warning-subtle hover:bg-warning-subtle text-warning-ink font-medium rounded-md border border-warning/20 transition-colors duration-100 text-xs flex items-center gap-1.5 cursor-pointer shrink-0 self-stretch sm:self-auto justify-center"
                            >
                                <i className="ti ti-first-aid-kit text-sm" />
                                <span>Grant medical exemption</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Disciplinary & Compliance Records */}
                <div className="bg-white rounded-lg shadow-2xs border border-slate-200 p-5 sm:p-6 relative overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                        <div className="flex items-center gap-3">
                            <div className="h-8 w-8 bg-warning-subtle text-warning-ink rounded-md flex items-center justify-center border border-warning/70">
                                <i className="ti ti-scale text-lg" />
                            </div>
                            <div>
                                <h3 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight">
                                    Disciplinary & Compliance Records
                                </h3>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md border uppercase tracking-wider ${standing.badgeClass}`}>
                                {standing.badgeLabel}
                            </span>

                            <Link
                                to={`/admin/disciplinary?search=${encodeURIComponent(employeeFullName || employee.first_name || '')}`}
                                className="h-8 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md transition-colors duration-100 shadow-2xs flex items-center gap-1.5"
                            >
                                <i className="ti ti-gavel text-sm" /> Disciplinary Hub
                            </Link>
                        </div>
                    </div>

                    {disciplinaryLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-8 px-4 bg-surface-muted rounded-md border border-dashed border-line">
                            <div className="h-10 w-10 bg-white text-ink rounded-md flex items-center justify-center border border-line shadow-2xs mb-2">
                                <i className="ti ti-shield-check text-2xl" />
                            </div>
                            <h4 className="text-sm font-semibold text-slate-900 mb-1">
                                {isTerminated ? 'Clean Record upon Separation' : 'Good Standing'}
                            </h4>
                            <p className="text-xs text-slate-500 font-medium max-w-md">
                                {isTerminated
                                    ? 'Employment ended in good standing with zero violations on record.'
                                    : 'Clean record with zero warnings or violations on file. Account is in good standing.'
                                }
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {!isTerminated && !isSuspended && standing.tierCode !== 'CLEAN' && (
                                <div className={`p-3.5 rounded-md border text-xs flex items-start gap-2.5 mb-3.5 ${standing.bannerClass}`}>
                                    <i className={`ti ${standing.icon} text-base shrink-0 mt-0.5`} />
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-bold">{standing.title}</p>
                                            <span className="text-[10px] font-mono uppercase opacity-75">[{standing.levelName}]</span>
                                        </div>
                                        <p className="opacity-90 mt-0.5 leading-relaxed">{standing.description}</p>
                                    </div>
                                </div>
                            )}
                            {disciplinaryLogs.map((log) => {
                                const isOverturnedOrResolved = log.status === 'Resolved' || log.status === 'Overturned';
                                const isResolvedTermination = log.type === 'Termination' && isOverturnedOrResolved;
                                const isReinstatedNote = (log.reason || '').includes('[REINSTATED') || (log.reason || '').includes('[EXONERATED') || (log.reason || '').includes('[CLEARED');

                                return (
                                    <div
                                        key={log.id}
                                        className={`p-4 rounded-md border transition-colors duration-100 ${
                                            isResolvedTermination
                                                ? 'bg-success-subtle/30 border-success/20'
                                                : log.status === 'Active'
                                                ? 'bg-danger-subtle/30 border-danger/20'
                                                : log.status === 'Acknowledged'
                                                ? 'bg-accent-subtle/30 border-accent/20'
                                                : 'bg-slate-50/70 border-slate-200'
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/60">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider border flex items-center gap-1.5 ${
                                                    isResolvedTermination
                                                        ? 'bg-success-subtle text-success-ink border-success/20'
                                                        : log.type === 'Termination'
                                                        ? 'bg-danger-subtle text-danger-ink border-danger/20'
                                                        : log.type === 'Suspension'
                                                        ? 'bg-warning-subtle text-warning-ink border-warning/20'
                                                        : 'bg-warning-subtle text-warning-ink border-warning/20'
                                                }`}>
                                                    <i className={`ti ${
                                                        isResolvedTermination ? 'ti-circle-check' :
                                                        log.type === 'Termination' ? 'ti-ban' :
                                                        log.type === 'Suspension' ? 'ti-player-pause' : 'ti-alert-triangle'
                                                    }`} />
                                                    {isResolvedTermination ? 'Termination (Revoked / Restored)' : log.type}
                                                </span>

                                                {log.severity && (
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${
                                                        log.severity === 'Critical' ? 'bg-danger-subtle text-danger-ink border-danger/20' :
                                                        log.severity === 'High' ? 'bg-warning-subtle text-warning-ink border-warning/20' :
                                                        log.severity === 'Medium' ? 'bg-warning-subtle text-warning-ink border-warning/20' :
                                                        'bg-accent-subtle text-accent border-accent/20'
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
                                                <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border flex items-center gap-1.5 ${
                                                    log.status === 'Resolved' ? 'bg-success-subtle text-success-ink border-success/20' :
                                                    log.status === 'Overturned' ? 'bg-success-subtle text-success-ink border-success/20' :
                                                    log.status === 'Acknowledged' ? 'bg-accent-subtle text-accent border-accent/20' :
                                                    'bg-danger-subtle text-danger-ink border-danger/20'
                                                }`}>
                                                    {log.status !== 'Resolved' && log.status !== 'Overturned' && (
                                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                                            log.status === 'Acknowledged' ? 'bg-accent' :
                                                            'bg-danger'
                                                        }`} />
                                                    )}
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
                                            <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-accent font-medium flex items-center gap-1.5">
                                                <i className="ti ti-file-certificate text-sm" />
                                                <span>Acknowledged by employee via portal.</span>
                                            </div>
                                        )}
                                        {isReinstatedNote && (
                                            <div className="mt-2.5 pt-2 border-t border-success/20 text-[11px] text-success-ink font-semibold flex items-center gap-1.5">
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

            {/* Enterprise Removal & Archival Modal */}
            {isDeleteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70">
                    <div 
                        className="absolute inset-0"
                        onClick={() => {
                            if (!isArchiving && !isDeleting) {
                                setIsDeleteModalOpen(false);
                                setDeleteConfirmText('');
                            }
                        }}
                    />
                    <div className="relative bg-white rounded-lg max-w-xl w-full p-5 sm:p-6 shadow-xl border border-slate-200 z-10 text-left space-y-4 max-h-[92vh] overflow-y-auto">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-4 pb-2 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 border ${
                                    removalMode === 'archive' 
                                        ? 'bg-accent-subtle border-accent/20 text-accent' 
                                        : 'bg-danger-subtle border-danger/20 text-danger-ink'
                                }`}>
                                    <i className={`ti ${removalMode === 'archive' ? 'ti-archive' : 'ti-alert-triangle'} text-lg`} />
                                </div>
                                <div>
                                    <h2 className="text-base font-semibold text-slate-900 leading-snug">
                                        {removalMode === 'archive' ? 'Employee Separation & Archival' : 'Forensic Record Purge'}
                                    </h2>
                                    <p className="text-xs text-slate-500 font-medium">
                                        Personnel: <strong className="text-slate-800 font-semibold">{employeeFullName}</strong> <span className="font-mono text-slate-400">({employee.company_id || 'No ID'})</span>
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsDeleteModalOpen(false);
                                    setDeleteConfirmText('');
                                }}
                                disabled={isArchiving || isDeleting}
                                className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors duration-100 cursor-pointer"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        {/* Segmented Control / Tabs */}
                        <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-md gap-1 border border-slate-200/80">
                            <button
                                type="button"
                                onClick={() => setRemovalMode('archive')}
                                className={`h-8 px-3 rounded font-medium text-xs transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer ${
                                    removalMode === 'archive'
                                        ? 'bg-white text-accent shadow-2xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                <i className="ti ti-shield-check text-sm" />
                                <span>DOLE Archive</span>
                                <span className="hidden sm:inline-block px-1.5 py-0.5 bg-accent-subtle text-accent text-[10px] font-semibold rounded uppercase">Standard</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setRemovalMode('purge')}
                                className={`h-8 px-3 rounded font-medium text-xs transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer ${
                                    removalMode === 'purge'
                                        ? 'bg-danger text-white shadow-2xs'
                                        : 'text-danger-ink hover:text-danger-ink'
                                }`}
                            >
                                <i className="ti ti-trash text-sm" />
                                <span>Forensic Purge</span>
                                <span className="hidden sm:inline-block px-1.5 py-0.5 bg-danger-subtle text-danger-ink text-[10px] font-semibold rounded uppercase">Danger</span>
                            </button>
                        </div>

                        {/* Mode 1: DOLE Archive */}
                        {removalMode === 'archive' && (
                            <div className="space-y-4">
                                <div className="bg-accent-subtle/70 border border-accent/80 rounded-md p-3 text-xs text-accent-strong space-y-1">
                                    <div className="flex items-center gap-1.5 font-semibold text-accent-strong">
                                        <i className="ti ti-shield-check text-base text-accent" />
                                        <span>Statutory Compliance & Digital Revocation</span>
                                    </div>
                                    <p className="text-[11px] text-accent-strong leading-relaxed font-normal">
                                        Retains 201 records, biometric timestamps, BIR 2316 tax history, and payslips in cold storage per DOLE labor regulations. Real-time access to gate scanners and portal accounts is permanently severed immediately.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                            Separation Classification
                                        </label>
                                        <select
                                            value={separationType}
                                            onChange={(e) => {
                                                const newType = e.target.value;
                                                setSeparationType(newType);
                                                if (SEPARATION_DEFAULTS[newType]) {
                                                    setSeparationReason(SEPARATION_DEFAULTS[newType]);
                                                }
                                            }}
                                            className="h-9 w-full px-3 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-slate-400"
                                        >
                                            <option value="Resignation">Voluntary Resignation</option>
                                            <option value="End of Contract">End of Contract / Fixed Term</option>
                                            <option value="Retirement">Statutory Retirement</option>
                                            <option value="Authorized Cause">Authorized Cause (DOLE Art. 298)</option>
                                            <option value="Just Cause">Just Cause (DOLE Art. 297)</option>
                                            <option value="Mutual Agreement">Mutual Separation Agreement</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                            Effective Separation Date
                                        </label>
                                        <input
                                            type="date"
                                            value={separationDate}
                                            onChange={(e) => setSeparationDate(e.target.value)}
                                            className="h-9 w-full px-3 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-slate-400"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                        Primary Reason / DOLE Statutory Ground
                                    </label>
                                    <input
                                        type="text"
                                        value={separationReason}
                                        onChange={(e) => setSeparationReason(e.target.value)}
                                        placeholder="e.g. Voluntary Resignation, End of Contract..."
                                        className="h-9 w-full px-3 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-slate-400"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                        Exit Clearance & Handover Remarks (Optional)
                                    </label>
                                    <textarea
                                        rows={2}
                                        value={separationNotes}
                                        onChange={(e) => setSeparationNotes(e.target.value)}
                                        placeholder="Note company ID return, laptop handover, clearance status..."
                                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-slate-400 resize-none"
                                    />
                                </div>

                                <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-md border border-slate-200/70 text-center">
                                    <div className="space-y-0.5">
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase">Face scan</span>
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger-ink">
                                            <i className="ti ti-lock text-xs" /> Revoked (0ms)
                                        </span>
                                    </div>
                                    <div className="space-y-0.5 border-x border-slate-200">
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase">Portal Auth</span>
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger-ink">
                                            <i className="ti ti-user-x text-xs" /> Signed Out
                                        </span>
                                    </div>
                                    <div className="space-y-0.5">
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase">Grace Cooldown</span>
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-warning-ink">
                                            <i className="ti ti-hourglass-low text-xs" /> 14 Days Review
                                        </span>
                                    </div>
                                </div>

                                <div className="flex gap-2.5 pt-2">
                                    <button 
                                        type="button"
                                        onClick={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}
                                        disabled={isArchiving}
                                        className="h-9 flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-md text-xs transition-colors duration-100 cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleArchiveEmployee}
                                        disabled={isArchiving}
                                        className="h-9 flex-1 bg-accent hover:bg-accent-hover text-white font-medium rounded-md text-xs transition-colors duration-100 shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                    >
                                        {isArchiving ? (
                                            <>
                                                <i className="ti ti-loader-2 animate-spin text-sm" />
                                                <span>Processing Archive...</span>
                                            </>
                                        ) : (
                                            <>
                                                <i className="ti ti-archive text-sm" />
                                                <span>Separate & Archive Employee</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Mode 2: Purge Tab */}
                        {removalMode === 'purge' && (
                            <div className="space-y-4">
                                <div className="bg-danger-subtle border border-danger/20 rounded-md p-3 text-xs text-danger-ink space-y-1.5">
                                    <div className="flex items-center gap-1.5 font-semibold text-danger-ink">
                                        <i className="ti ti-alert-triangle text-base text-danger-ink" />
                                        <span>Permanent Record & Account Deletion</span>
                                    </div>
                                    <p className="text-[11px] text-danger-ink leading-relaxed font-normal">
                                        This permanently deletes the employee record, along with all attendance logs, payslips, leave requests, uploaded documents, and saved face scan photos. <strong>This action cannot be undone.</strong>
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-xs text-slate-600 font-medium">
                                        To confirm permanent deletion, type the employee's full name below:
                                    </p>
                                    <div 
                                        onClick={() => setDeleteConfirmText(employeeFullName)}
                                        className="p-2 bg-slate-100 hover:bg-slate-200 rounded font-mono text-center font-medium text-slate-800 text-xs border border-slate-200 select-all cursor-pointer transition-colors duration-100 flex items-center justify-center gap-1.5"
                                        title="Click to auto-fill for quick testing"
                                    >
                                        <span>{employeeFullName}</span>
                                        <span className="text-[10px] text-slate-400 font-normal">(click to auto-fill)</span>
                                    </div>
                                    <input
                                        type="text"
                                        value={deleteConfirmText}
                                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                                        placeholder="Type full name to confirm..."
                                        className="h-9 w-full px-3.5 bg-white border border-slate-200 rounded-md text-center font-semibold text-xs text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-danger"
                                    />
                                </div>

                                <div className="flex gap-2.5 pt-2">
                                    <button 
                                        type="button"
                                        onClick={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}
                                        disabled={isDeleting}
                                        className="h-9 flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-md text-xs transition-colors duration-100 cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={deleteConfirmText.trim().toLowerCase() !== employeeFullName.toLowerCase() || isDeleting}
                                        className="h-9 flex-1 bg-danger hover:bg-danger-ink disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium rounded-md text-xs transition-colors duration-100 flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        {isDeleting ? (
                                            <>
                                                <i className="ti ti-loader-2 animate-spin text-sm" />
                                                <span>Deleting records...</span>
                                            </>
                                        ) : (
                                            <>
                                                <i className="ti ti-trash text-sm" />
                                                <span>Delete permanently</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
            

            {/* Print QR badge modal */}
            
                {isPrintModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-950/70 transition-opacity no-print"
                            onClick={() => setIsPrintModalOpen(false)}
                        />
                        <div 
                            initial={{ scale: 0.98, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.98, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            id="qr-print-card"
                            className="relative bg-white rounded-lg p-6 sm:p-7 text-center shadow-xl w-full max-w-md border border-slate-200 z-10"
                        >
                            <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100">
                                <div className="text-left">
                                    <h1 className="text-base font-semibold text-slate-900 uppercase tracking-wider">C-Point Official ID</h1>
                                    <p className="text-[11px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Gate pass</p>
                                </div>
                                <span className="h-6 px-2.5 inline-flex items-center bg-slate-900 text-white font-mono text-xs font-semibold rounded-md">
                                    {employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS')}
                                </span>
                            </div>

                            <div className="flex justify-center mb-5">
                                <div className="p-4 bg-white border border-slate-200 rounded-md flex items-center justify-center shadow-2xs">
                                    <QRCode 
                                        value={employee.company_id || (employee.id ? String(employee.id) : 'CP-EMPLOYEE')} 
                                        size={220}
                                        fgColor="#0f172a"
                                        bgColor="#ffffff"
                                        level="H"
                                        margin={2}
                                        className="rounded-sm"
                                    />
                                </div>
                            </div>

                            <div className="mb-5">
                                <h2 className="text-xl font-bold text-slate-900 tracking-tight leading-tight truncate">{employee.name}</h2>
                                <p className="text-accent font-medium uppercase text-xs tracking-wider mt-1">{employee.job_title ?? 'STAFF'}</p>
                                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mt-0.5">{employee.department ? employee.department + ' Department' : 'Operations'}</p>
                            </div>

                            <div className="no-print flex gap-2">
                                <button type="button" onClick={() => setIsPrintModalOpen(false)} className="flex-1 h-9 px-3 bg-slate-100 text-slate-700 font-medium rounded-md hover:bg-slate-200 transition-colors duration-100 text-xs">
                                    Close
                                </button>
                                <button type="button" onClick={printCard} className="flex-1 h-9 px-3 flex items-center justify-center gap-2 bg-slate-900 text-white font-medium rounded-md hover:bg-accent transition-colors duration-100 text-xs">
                                    <i className="ti ti-printer text-sm" /> Print Badge
                                </button>
                            </div>
                        </div>
                    </div>      
                )}
            
            {/* Reinstatement Confirmation Modal */}
            {isReinstateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div 
                        className="absolute inset-0 bg-slate-950/70 transition-opacity"
                        onClick={() => !isReinstating && setIsReinstateModalOpen(false)}
                    />
                    <div className="relative bg-white rounded-lg p-6 text-center shadow-xl w-full max-w-md border border-slate-200 z-10 space-y-4">
                        <div className="w-10 h-10 bg-surface-muted text-ink rounded-md flex items-center justify-center mx-auto border border-line">
                            <i className="ti ti-rotate-clockwise text-xl" />
                        </div>

                        <div>
                            <h3 className="text-base font-semibold text-slate-900">Reinstate Employee</h3>
                            <p className="text-xs text-slate-500 font-medium mt-1">
                                Restore <strong className="text-slate-900">{employee.name || `${employee.first_name} ${employee.last_name}`}</strong> ({employee.company_id || 'N/A'}) to active operational standing.
                            </p>
                        </div>

                        <div className="bg-slate-50 rounded-md p-3.5 border border-slate-200 text-left text-xs space-y-2 text-slate-600">
                            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                                <span className="font-medium text-slate-400 uppercase text-[10px] tracking-wider">Current Standing</span>
                                <span className="px-2 py-0.5 bg-slate-200 text-slate-700 text-[10px] font-medium rounded">Pending Termination</span>
                            </div>
                            <p className="text-[11px] leading-relaxed">
                                Reinstatement will revoke the separation notice, clear the pending archive cooldown, unblock gate attendance scanner permissions, and return this record to the operational workforce directory.
                            </p>
                        </div>

                        <div className="flex gap-2 pt-1">
                            <button
                                type="button"
                                onClick={() => setIsReinstateModalOpen(false)}
                                disabled={isReinstating}
                                className="flex-1 h-9 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-md text-xs transition-colors duration-100 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleReinstate}
                                disabled={isReinstating}
                                className="flex-1 h-9 px-3 bg-ink-subtle hover:bg-ink-subtle text-white font-medium rounded-md text-xs transition-colors duration-100 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                                {isReinstating ? (
                                    <>
                                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
                        className="absolute inset-0 bg-slate-950/70 transition-opacity"
                        onClick={() => !isSubmittingExemption && setIsExemptionModalOpen(false)}
                    />
                    <div className="relative bg-white rounded-lg p-6 shadow-xl w-full max-w-lg border border-slate-200 z-10 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-warning-subtle text-warning-ink rounded-md flex items-center justify-center border border-warning/20">
                                    <i className="ti ti-first-aid-kit text-xl" />
                                </div>
                                <div>
                                    <h3 className="text-base font-semibold text-slate-900">
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
                                className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors duration-100 cursor-pointer"
                            >
                                <i className="ti ti-x text-sm" />
                            </button>
                        </div>

                        <form onSubmit={handleEnableExemption} className="space-y-4 text-xs">
                            <div className="p-3 bg-warning-subtle rounded-md border border-warning/20 text-warning-ink leading-relaxed font-medium">
                                <p className="font-semibold flex items-center gap-1.5 text-warning-ink mb-0.5">
                                    <i className="ti ti-info-circle text-base text-warning-ink" />
                                    How this protocol functions:
                                </p>
                                <span>
                                    Enabling Medical Grace allows <strong className="text-warning-ink">{employeeFullName}</strong> to clock in/out using their QR code without triggering Euclidean facial distance or eye-blink rejections. The kiosk camera will still capture a high-resolution snapshot for evidentiary verification.
                                </span>
                            </div>

                            <div>
                                <label className="block font-medium text-slate-700 uppercase tracking-wider mb-1">
                                    Clinical Reason / Trauma Description <span className="text-danger-ink">*</span>
                                </label>
                                <textarea
                                    required
                                    rows={2}
                                    value={exemptionForm.reason}
                                    onChange={(e) => setExemptionForm({ ...exemptionForm, reason: e.target.value })}
                                    placeholder="e.g., Facial lacerations and gauze dressing following road accident per attending physician..."
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md font-medium text-slate-800 text-xs focus:ring-1 focus:ring-warning focus:bg-white transition-colors duration-100 outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-medium text-slate-700 uppercase tracking-wider mb-1">
                                        Medical Cert / Ref ID <span className="text-danger-ink">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={exemptionForm.cert_ref}
                                        onChange={(e) => setExemptionForm({ ...exemptionForm, cert_ref: e.target.value })}
                                        placeholder="e.g., MC-2026-DR-SANTOS-88"
                                        className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-md font-mono font-medium text-slate-800 text-xs focus:ring-1 focus:ring-warning focus:bg-white transition-colors duration-100 outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block font-medium text-slate-700 uppercase tracking-wider mb-1">
                                        Exemption Duration
                                    </label>
                                    <select
                                        value={exemptionForm.duration_days}
                                        onChange={(e) => setExemptionForm({ ...exemptionForm, duration_days: Number(e.target.value) })}
                                        className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-md font-medium text-slate-800 text-xs focus:ring-1 focus:ring-warning focus:bg-white transition-colors duration-100 outline-none"
                                    >
                                        <option value={7}>7 Days (Minor injury / swelling)</option>
                                        <option value={14}>14 Days (Standard trauma / sutures)</option>
                                        <option value={30}>30 Days (Major trauma / fracture recovery)</option>
                                        <option value={60}>60 Days (Extended reconstructive care)</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block font-medium text-slate-700 uppercase tracking-wider mb-1">
                                    Document Link / Vault File URL (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={exemptionForm.document_url}
                                    onChange={(e) => setExemptionForm({ ...exemptionForm, document_url: e.target.value })}
                                    placeholder="e.g., /admin/documents?employee_id=... or Medical Certificate scan"
                                    className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-md font-medium text-slate-800 text-xs focus:ring-1 focus:ring-warning focus:bg-white transition-colors duration-100 outline-none"
                                />
                            </div>

                            <div className="flex gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setIsExemptionModalOpen(false)}
                                    disabled={isSubmittingExemption}
                                    className="flex-1 h-9 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-md text-xs transition-colors duration-100 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingExemption}
                                    className="flex-1 h-9 px-3 bg-warning hover:bg-warning-ink text-white font-medium rounded-md text-xs transition-colors duration-100 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                    {isSubmittingExemption ? (
                                        <>
                                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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