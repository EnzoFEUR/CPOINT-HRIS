import { useState, useRef, useMemo, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../utils/api';
import { readProfileCache, writeProfileCache, clearProfileCache } from '../../utils/browserPrivacy.mjs';
import EmployeeAvatar from '../../components/EmployeeAvatar';
import QRCode from '../../components/QRCode';
import { supabase } from '../../supabaseClient';
import { getDisciplinaryCache, setDisciplinaryCache, clearDisciplinaryCache } from '../../utils/disciplinaryCache';
import bannerCover from '../../assets/employee-cover.jpg';
import useEmployeeDocuments from '../../utils/useEmployeeDocuments';
import useDocumentRequests from '../../utils/useDocumentRequests';
import { openEmployeeDocument, uploadEmployeeDocument } from '../../utils/documentApi';
import { DOCUMENT_STATUSES, formatDocumentSize, getDocumentStatus, getDocumentExpiry, formatCleanDocumentFileName } from '../../utils/documentUtils';
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPES, getDocumentType } from '../../../../shared/documentTypes.mjs';
import { formatPhDisplay } from '../../utils/phoneUtils';
import DocumentThumbnail from '../../components/DocumentThumbnail';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import PhilippineAddressSelector from '../../components/PhilippineAddressSelector';

const CATEGORIES = ['General', 'Government ID', 'Educational', 'Medical', 'Clearance', 'Contract / Agreement'];
const EXPIRABLE_CATEGORIES = ['Government ID', 'Clearance'];

export default function MyProfile() {
    const queryClient = useQueryClient();
    const location = useLocation();

    // Reactive current user from storage to instantly sync if session changes
    const [storedUser, setStoredUser] = useState(() => {
        try {
            const raw = localStorage.getItem('user');
            if (raw && raw !== 'undefined') return JSON.parse(raw);
        } catch { }
        return null;
    });

    useEffect(() => {
        const handleSync = () => {
            try {
                const raw = localStorage.getItem('user');
                if (raw && raw !== 'undefined') {
                    const parsed = JSON.parse(raw);
                    setStoredUser((prev) => (prev?.id !== parsed?.id ? parsed : prev));
                }
            } catch {}
        };
        window.addEventListener('storage', handleSync);
        return () => window.removeEventListener('storage', handleSync);
    }, []);

    // Two-Factor Authentication (TOTP) state
    const [totpStatus, setTotpStatus] = useState(() => {
        try {
            const raw = localStorage.getItem('user');
            if (raw && raw !== 'undefined') {
                const parsed = JSON.parse(raw);
                return {
                    enabled: Boolean(parsed?.totp_enabled || parsed?.has_totp),
                    loading: false,
                    remainingCodes: parsed?.totp_backup_codes_count || 0
                };
            }
        } catch {}
        return { enabled: false, loading: false, remainingCodes: 0 };
    });
    const [showTotpModal, setShowTotpModal] = useState(false);
    const [showReconfigureModal, setShowReconfigureModal] = useState(false);
    const [reconfigurePassword, setReconfigurePassword] = useState('');
    const [showDisableModal, setShowDisableModal] = useState(false);
    const [disablePassword, setDisablePassword] = useState('');
    const [disableCode, setDisableCode] = useState('');
    const [totpSetupData, setTotpSetupData] = useState(null);
    const [totpVerifyCode, setTotpVerifyCode] = useState('');
    const [totpSubmitting, setTotpSubmitting] = useState(false);
    const [totpBackupCodes, setTotpBackupCodes] = useState([]);
    const [totpStep, setTotpStep] = useState(1); // 1 = QR & Code, 2 = Backup Codes

    const fetchTotpStatus = async () => {
        try {
            const res = await fetchWithAuth('/api/auth/totp/status');
            const data = await res.json();
            if (res.ok && data.success) {
                setTotpStatus({
                    enabled: Boolean(data.enabled),
                    loading: false,
                    remainingCodes: data.backupCodesRemaining || 0
                });

                // Synchronize to stored user for 0ms future reloads
                try {
                    const raw = localStorage.getItem('user');
                    if (raw && raw !== 'undefined') {
                        const parsed = JSON.parse(raw);
                        parsed.totp_enabled = Boolean(data.enabled);
                        parsed.has_totp = Boolean(data.enabled);
                        parsed.totp_backup_codes_count = data.backupCodesRemaining || 0;
                        localStorage.setItem('user', JSON.stringify(parsed));
                    }
                } catch {}
            } else {
                setTotpStatus((prev) => ({ ...prev, loading: false }));
            }
        } catch (_) {
            setTotpStatus((prev) => ({ ...prev, loading: false }));
        }
    };

    // Auto-fetch TOTP status on component mount and whenever user identity changes
    useEffect(() => {
        fetchTotpStatus();
    }, [storedUser?.id, storedUser?.email]);

    const executeTotpSetup = async (pwd = '') => {
        setTotpSubmitting(true);
        try {
            const bodyPayload = pwd ? JSON.stringify({ password: pwd }) : undefined;
            const res = await fetchWithAuth('/api/auth/totp/setup', {
                method: 'POST',
                headers: bodyPayload ? { 'Content-Type': 'application/json' } : undefined,
                body: bodyPayload
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to start authenticator setup.');
            }
            setShowReconfigureModal(false);
            setReconfigurePassword('');
            setTotpSetupData(data);
            setTotpVerifyCode('');
            setTotpStep(1);
            setShowTotpModal(true);
        } catch (err) {
            toast.error(err.message || 'Setup error');
        } finally {
            setTotpSubmitting(false);
        }
    };

    const handleStartTotpSetup = () => {
        if (totpStatus.enabled) {
            setReconfigurePassword('');
            setShowReconfigureModal(true);
        } else {
            executeTotpSetup();
        }
    };

    const handleConfirmTotp = async (e) => {
        e?.preventDefault();
        if (totpVerifyCode.trim().length !== 6) {
            toast.error('Please enter the 6-digit confirmation code.');
            return;
        }
        setTotpSubmitting(true);
        try {
            const res = await fetchWithAuth('/api/auth/totp/enable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: totpVerifyCode.trim() })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to verify confirmation code.');
            }
            toast.success('Google Authenticator 2FA activated!');
            setTotpBackupCodes(data.backupCodes || []);
            setTotpStep(2);
            fetchTotpStatus();
        } catch (err) {
            toast.error(err.message || 'Invalid code.');
        } finally {
            setTotpSubmitting(false);
        }
    };

    const handleConfirmDisableTotp = async (e) => {
        e?.preventDefault();
        if (!disablePassword.trim() && !disableCode.trim()) {
            toast.error('Please enter your account password or emergency code.');
            return;
        }
        setTotpSubmitting(true);
        try {
            const payload = {
                password: disablePassword.trim() || undefined,
                code: disableCode.trim() || undefined
            };
            const res = await fetchWithAuth('/api/auth/totp/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to disable 2FA.');
            }
            toast.success('Authenticator 2FA has been disabled.');
            setShowDisableModal(false);
            setDisablePassword('');
            setDisableCode('');
            await fetchTotpStatus();
        } catch (err) {
            toast.error(err.message || 'Error disabling 2FA.');
        } finally {
            setTotpSubmitting(false);
        }
    };

    const handleDownloadBackupCodes = () => {
        const content = `C-POINT HRIS EMERGENCY RECOVERY BACKUP CODES\nGenerated: ${new Date().toLocaleString()}\nAccount: ${storedUser?.email || 'Admin'}\n\nEach code can only be used ONCE.\n\n${totpBackupCodes.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nKeep these codes in a secure, confidential place.`;
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `cpoint-backup-codes-${storedUser?.company_id || 'recovery'}.txt`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success('Backup codes downloaded.');
    };

const normalizeJobTitle = (title, isAdmin) => {
    if (!title || /super\s*admin/i.test(title)) {
        return isAdmin ? 'Admin' : 'Staff Member';
    }
    return title;
};

    const initialUser = useMemo(() => {
        if (!storedUser) return null;
        const isInitAdmin = storedUser.role === 'admin' || storedUser.email === 'admin@c-point.com';
        return {
            id: storedUser.id || storedUser.user_id,
            company_id: storedUser.company_id || storedUser.employee_id || storedUser.emp_id || 'CP-MAIN',
            first_name: storedUser.first_name || (storedUser.name ? storedUser.name.split(' ')[0] : ''),
            last_name: storedUser.last_name || (storedUser.name ? storedUser.name.split(' ').slice(1).join(' ') : ''),
            email: storedUser.email || 'N/A',
            phone: storedUser.phone || storedUser.contact_no || '',
            sex: storedUser.sex || storedUser.gender || 'N/A',
            gender: storedUser.sex || storedUser.gender || 'N/A',
            birth_date: storedUser.birth_date || null,
            address: storedUser.address || '',
            department: storedUser.department || 'Operations',
            job_title: normalizeJobTitle(storedUser.job_title || storedUser.position, isInitAdmin),
            status: storedUser.status || 'active',
            is_active: storedUser.is_active ?? true,
            created_at: storedUser.created_at || null,
            date_hired: storedUser.date_hired || null,
            avatar_url: storedUser.avatar_url || storedUser.photo_url || null,
            photo_url: storedUser.photo_url || storedUser.avatar_url || null,
            has_registered_biometrics: storedUser.has_registered_biometrics ?? true,
            medical_record_url: storedUser.medical_record_url || null,
            role: storedUser.role || (storedUser.email === 'admin@c-point.com' ? 'admin' : 'employee'),
        };
    }, [storedUser]);

    const currentUserId = initialUser?.id;
    const cacheStorageKey = currentUserId ? `cpoint_my_profile_cache_${currentUserId}` : 'cpoint_my_profile_cache';

    // Auto-heal legacy session cache if it contains deprecated 'Super Admin'
    useEffect(() => {
        try {
            const rawUser = localStorage.getItem('user');
            if (rawUser && /super\s*admin/i.test(rawUser)) {
                const parsed = JSON.parse(rawUser);
                if (parsed.job_title && /super\s*admin/i.test(parsed.job_title)) {
                    parsed.job_title = 'Admin';
                }
                if (parsed.role && /super\s*admin/i.test(parsed.role)) {
                    parsed.role = 'admin';
                }
                localStorage.setItem('user', JSON.stringify(parsed));
            }
            if (cacheStorageKey) {
                const cached = sessionStorage.getItem(cacheStorageKey);
                if (cached) {
                    sessionStorage.removeItem(cacheStorageKey);
                }
            }
        } catch (_) {}
    }, [cacheStorageKey]);

    // Query profile and documents with an in-memory SWR cache scoped strictly to the authenticated user ID
    const initialProfileData = (() => {
        try {
            const cached = readProfileCache(cacheStorageKey);
            if (cached) {
                const cachedId = cached?.user?.id || cached?.employee?.id || cached?.data?.id || cached?.id;
                // Strict validation: Only accept cache if it precisely matches the current user
                if (!currentUserId || !cachedId || cachedId === currentUserId) {
                    return cached;
                }
            }
        } catch (_) {}
        return initialUser ? { success: true, user: initialUser, documents: [] } : undefined;
    })();

    const { data: profileResponse, isLoading: isQueryLoading } = useQuery({
        queryKey: ['myProfile', currentUserId || 'session'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/profile');
            const data = await res.json();
            return data;
        },
        initialData: initialProfileData,
        staleTime: 60000,
    });

    useEffect(() => {
        if (profileResponse && (profileResponse.user || profileResponse.employee || profileResponse.data)) {
            try {
                const fetchedId = profileResponse?.user?.id || profileResponse?.employee?.id || profileResponse?.data?.id;
                if (!currentUserId || !fetchedId || fetchedId === currentUserId) {
                    writeProfileCache(cacheStorageKey, profileResponse);
                }
            } catch (_) {}
        }
    }, [profileResponse, cacheStorageKey, currentUserId]);

    const raw = useMemo(() => profileResponse?.employee || profileResponse?.user || profileResponse?.data?.employee || profileResponse?.data?.user || profileResponse?.data || profileResponse || {}, [profileResponse]);
    
    const isAdminAccount = useMemo(() => {
        const role = String(raw?.role || raw?.user?.role || storedUser?.role || initialUser?.role || '').toLowerCase();
        const email = String(raw?.email || storedUser?.email || initialUser?.email || '').toLowerCase();
        const jobTitle = String(raw?.job_title || raw?.position || storedUser?.job_title || '').toLowerCase();
        return role === 'admin' || email === 'admin@c-point.com' || jobTitle.includes('admin');
    }, [raw, storedUser, initialUser]);

    const profile = useMemo(() => {
        if (!raw || typeof raw !== 'object' || !raw.id) return initialUser;
        return {
            id: raw.id || raw.user_id,
            company_id: raw.company_id || raw.employee_id || raw.emp_id || raw.id || 'CP-MAIN',
            first_name: raw.first_name || raw.firstname || (raw.name ? raw.name.split(' ')[0] : ''),
            last_name: raw.last_name || raw.lastname || (raw.name ? raw.name.split(' ').slice(1).join(' ') : ''),
            email: raw.email || raw.user?.email || 'N/A',
            phone: raw.phone || raw.contact_no || raw.phone_number || raw.mobile || '',
            sex: raw.sex || raw.gender || 'N/A',
            gender: raw.gender || raw.sex || 'N/A',
            birth_date: raw.birth_date || raw.dob || raw.birthdate || null,
            address: raw.address || raw.home_address || raw.present_address || '',
            department: raw.department?.name || raw.department || raw.dept || 'Operations',
            job_title: normalizeJobTitle(raw.job_title || raw.position || raw.designation, isAdminAccount),
            status: raw.status || initialUser?.status || 'active',
            is_active: raw.is_active ?? initialUser?.is_active ?? true,
            created_at: raw.created_at || null,
            date_hired: raw.date_hired || null,
            avatar_url: raw.avatar_url || raw.photo_url || raw.photo || raw.profile_picture || raw.image_url || null,
            photo_url: raw.photo_url || raw.avatar_url || raw.photo || raw.profile_picture || raw.image_url || null,
            has_registered_biometrics: raw.has_registered_biometrics ?? true,
            medical_record_url: raw.medical_record_url || initialUser?.medical_record_url || null,
            archived_at: raw.archived_at || initialUser?.archived_at || null,
            separation_date: raw.separation_date || initialUser?.separation_date || null,
            separation_type: raw.separation_type || initialUser?.separation_type || null,
            separation_reason: raw.separation_reason || initialUser?.separation_reason || null,
            separation_notes: raw.separation_notes || initialUser?.separation_notes || null,
            operational_status: raw.operational_status || initialUser?.operational_status || null,
            is_terminated: raw.is_terminated ?? initialUser?.is_terminated ?? false,
            role: raw.role || raw.user?.role || initialUser?.role || storedUser?.role || (isAdminAccount ? 'admin' : 'employee'),
        };
    }, [raw, initialUser, storedUser, isAdminAccount]);

    // Medical grace protocol state
    const medicalExemption = useMemo(() => {
        const rawUrl = profile?.medical_record_url;
        if (!rawUrl) return null;
        try {
            const parsed = typeof rawUrl === 'string' ? JSON.parse(rawUrl) : rawUrl;
            if (parsed && typeof parsed === 'object' && parsed.type === 'MEDICAL_GRACE_EXEMPTION') {
                return parsed;
            }
            return null;
        } catch {
            return null;
        }
    }, [profile?.medical_record_url]);

    const isMedicalExempt = useMemo(() => {
        if (!medicalExemption?.expires_at) return false;
        return new Date(medicalExemption.expires_at).getTime() > Date.now();
    }, [medicalExemption]);

    const daysRemaining = useMemo(() => {
        if (!isMedicalExempt || !medicalExemption?.expires_at) return 0;
        return Math.max(0, Math.ceil((new Date(medicalExemption.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    }, [isMedicalExempt, medicalExemption]);

    const disciplinaryLogs = isAdminAccount ? [] : (profileResponse?.disciplinary_logs || []);
    const isLoading = isQueryLoading && !profile;
    const [docSearch, setDocSearch] = useState('');
    const [docStatus, setDocStatus] = useState('all');
    const [docCategory, setDocCategory] = useState('All');
    const [docSort, setDocSort] = useState('newest');
    const [openingDocument, setOpeningDocument] = useState(null);
    const documentQuery = useEmployeeDocuments({ employeeId: profile?.id, actorId: currentUserId, enabled: Boolean(profile?.id) && !isAdminAccount, status: docStatus, category: docCategory, sort: docSort, search: docSearch });
    const documents = useMemo(() => isAdminAccount ? [] : documentQuery.documents, [isAdminAccount, documentQuery.documents]);
    const requestQuery = useDocumentRequests({ employeeId: profile?.id, actorId: currentUserId, enabled: Boolean(profile?.id) && !isAdminAccount });
    const activeRequests = isAdminAccount ? [] : (requestQuery.requests || []).filter(r => ['pending', 'submitted'].includes(r.status));
    useEffect(() => {
        if (location.hash !== '#documents' || !profile?.id) return;
        const frame = requestAnimationFrame(() => document.getElementById('documents')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        return () => cancelAnimationFrame(frame);
    }, [location.hash, profile?.id]);
    const [activePreviewDoc, setActivePreviewDoc] = useState(null);
    const handleOpenDocument = (docOrId) => {
        if (typeof docOrId === 'object' && docOrId !== null) {
            setActivePreviewDoc(docOrId);
            return;
        }
        const found = documents.find(d => d.id === docOrId);
        if (found) {
            setActivePreviewDoc(found);
        } else {
            setActivePreviewDoc({ id: docOrId });
        }
    };
    const fileInputRef = useRef(null);
    const dragCounter = useRef(0);
    const [isDraggingFile, setIsDraggingFile] = useState(false);

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
            .on('broadcast', { event: 'PROFILE_UPDATED' }, (payload) => {
                const targetId = payload?.payload?.employee_id;
                if (!targetId || targetId === profile.id) {
                    queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                }
            })
            .on('broadcast', { event: 'EMPLOYEE_UPDATED' }, (payload) => {
                const targetId = payload?.payload?.employee_id;
                if (!targetId || targetId === profile.id) {
                    queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                }
            })
            .on('broadcast', { event: 'EMPLOYEE_SUSPENDED' }, (payload) => {
                const targetId = payload?.payload?.employee_id || payload?.payload?.employeeId;
                if (!targetId || targetId === profile.id) {
                    setDisciplinaryCache(profile.id, { type: 'Suspension', record: payload?.payload, isSuspended: true, isTerminated: false });
                    setDisciplinaryState(getDisciplinaryCache(profile.id));
                    queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                }
            })
            .on('broadcast', { event: 'EMPLOYEE_TERMINATED' }, (payload) => {
                const targetId = payload?.payload?.employee_id || payload?.payload?.employeeId;
                if (!targetId || targetId === profile.id) {
                    setDisciplinaryCache(profile.id, { type: 'Termination', record: payload?.payload, isSuspended: false, isTerminated: true });
                    setDisciplinaryState(getDisciplinaryCache(profile.id));
                    queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                }
            })
            .on('broadcast', { event: 'DISCIPLINARY_OVERTURNED' }, (payload) => {
                const targetId = payload?.payload?.employee_id || payload?.payload?.employeeId;
                if (!targetId || targetId === profile.id) {
                    clearDisciplinaryCache(profile.id);
                    setDisciplinaryState({ isSuspended: false, isTerminated: false, record: null });
                    queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                }
            })
            .on('broadcast', { event: 'DISCIPLINARY_RESOLVED' }, (payload) => {
                const targetId = payload?.payload?.employee_id || payload?.payload?.employeeId;
                if (!targetId || targetId === profile.id) {
                    clearDisciplinaryCache(profile.id);
                    setDisciplinaryState({ isSuspended: false, isTerminated: false, record: null });
                    queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                }
            })
            .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, (payload) => {
                const targetId = payload?.payload?.employee_id || payload?.payload?.employeeId;
                if (!targetId || targetId === profile.id) {
                    clearDisciplinaryCache(profile.id);
                    setDisciplinaryState({ isSuspended: false, isTerminated: false, record: null });
                    queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                }
            })
            .on('broadcast', { event: 'BIOMETRIC_EXEMPTION_UPDATED' }, () => {
                queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                toast.success('Biometric protocol updated');
            })
            .on('broadcast', { event: 'BIOMETRICS_RESET' }, () => {
                queryClient.invalidateQueries({ queryKey: ['myProfile'] });
                toast.success('Biometrics baseline reset by HR');
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [profile?.id, queryClient]);

    // Live activity sync for administrative sessions
    useEffect(() => {
        if (!isAdminAccount || !profile?.id) return;
        const channel = supabase
            .channel(`admin-profile-activity-${profile.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_log' }, () => {
                queryClient.invalidateQueries({ queryKey: ['myProfile'] });
            })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [isAdminAccount, profile?.id, queryClient]);

    const activeSuspensionLog = disciplinaryLogs.find(l => (l.type === 'Suspension' || l.action_taken === 'Suspension') && l.status !== 'Resolved' && l.status !== 'Overturned' && l.status !== 'Dismissed');
    const activeTerminationLog = disciplinaryLogs.find(l => (l.type === 'Termination' || l.action_taken === 'Termination') && l.status !== 'Resolved' && l.status !== 'Overturned' && l.status !== 'Dismissed');

    const isSuspended = !isAdminAccount && !Boolean(activeTerminationLog) && Boolean(
        activeSuspensionLog ||
        disciplinaryState?.isSuspended ||
        profile?.status === 'suspended' ||
        profile?.operational_status === 'Suspended' ||
        profile?.is_suspended
    );

    const isTerminated = !isAdminAccount && !isSuspended && Boolean(
        activeTerminationLog ||
        Boolean(profile?.archived_at) ||
        Boolean(profile?.is_terminated) ||
        profile?.operational_status === 'Terminated' ||
        profile?.status === 'terminated' || 
        (profile?.status === 'inactive' && Boolean(profile?.archived_at || profile?.separation_type)) ||
        Boolean(disciplinaryState?.isTerminated)
    );

    const isPendingArchive = Boolean(isTerminated && (profile?.archived_at || profile?.separation_date));
    const daysUntilPermanentArchive = useMemo(() => {
        if (!isPendingArchive) return 0;
        const refDate = new Date(profile?.archived_at || profile?.separation_date || Date.now());
        const targetDate = new Date(refDate.getTime() + 14 * 24 * 60 * 60 * 1000);
        return Math.max(0, Math.ceil((targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    }, [isPendingArchive, profile?.archived_at, profile?.separation_date]);

    // Admin Password Management State & Handlers with Multi-Factor OTP & Brute-Force Defense
    const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [passwordOtp, setPasswordOtp] = useState('');
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [isSendingOtp, setIsSendingOtp] = useState(false);
    const [otpCooldown, setOtpCooldown] = useState(0);
    const [otpError, setOtpError] = useState('');
    const [attemptsRemaining, setAttemptsRemaining] = useState(null);

    useEffect(() => {
        if (otpCooldown <= 0) return;
        const interval = setInterval(() => {
            setOtpCooldown((prev) => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(interval);
    }, [otpCooldown]);

    const handleRequestPasswordOtp = async () => {
        if (isSendingOtp || otpCooldown > 0) return;
        setIsSendingOtp(true);
        setOtpError('');
        try {
            const res = await fetchWithAuth('/api/profile/request-password-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || data.error || 'Failed to dispatch verification code.');
            }
            toast.success(data.message || 'Verification code dispatched to your corporate email.');
            setOtpCooldown(data.cooldown || 60);
        } catch (err) {
            setOtpError(err.message || 'Failed to send verification code.');
            toast.error(err.message || 'Failed to send verification code.');
        } finally {
            setIsSendingOtp(false);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setOtpError('');
        if (!currentPassword.trim() || !newPassword.trim()) {
            toast.error('Please enter both current and new passwords.');
            return;
        }
        if (newPassword.length < 8) {
            toast.error('New password must be at least 8 characters long.');
            return;
        }
        if (newPassword.trim() === currentPassword.trim()) {
            toast.error('New password must be different from current password.');
            return;
        }
        if (newPassword !== confirmNewPassword) {
            toast.error('New passwords do not match.');
            return;
        }
        if (!passwordOtp.trim()) {
            toast.error('Please enter the 6-digit verification code from your email or Google Authenticator.');
            return;
        }

        setIsChangingPassword(true);
        try {
            const res = await fetchWithAuth('/api/profile/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_password: currentPassword.trim(),
                    new_password: newPassword.trim(),
                    otp: passwordOtp.trim()
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                if (data.remainingAttempts !== undefined) {
                    setAttemptsRemaining(data.remainingAttempts);
                }
                throw new Error(data.message || 'Failed to update password.');
            }
            toast.success(data.message || 'Password updated successfully.');
            setShowChangePasswordModal(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmNewPassword('');
            setPasswordOtp('');
            setOtpError('');
            setAttemptsRemaining(null);
        } catch (err) {
            setOtpError(err.message || 'Failed to change password.');
            toast.error(err.message || 'Failed to change password.');
        } finally {
            setIsChangingPassword(false);
        }
    };

    // Personal Details Edit State & Handlers
    const [showEditPersonalModal, setShowEditPersonalModal] = useState(false);
    const [isSavingPersonal, setIsSavingPersonal] = useState(false);
    const [personalForm, setPersonalForm] = useState({
        first_name: '',
        last_name: '',
        sex: '',
        gender: '',
        birth_date: '',
        address: ''
    });

    const maxBirthDate = useMemo(() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 15);
        return d.toISOString().split('T')[0];
    }, []);

    const openEditPersonalModal = () => {
        if (isTerminated) {
            toast.error('Profile modifications are disabled for separated/terminated accounts.');
            return;
        }
        const currentSex = profile?.sex || profile?.gender;
        setPersonalForm({
            first_name: profile?.first_name || '',
            last_name: profile?.last_name || '',
            sex: currentSex && currentSex !== 'N/A' ? currentSex : '',
            gender: currentSex && currentSex !== 'N/A' ? currentSex : '',
            birth_date: profile?.birth_date ? profile.birth_date.split('T')[0] : '',
            address: profile?.address || ''
        });
        setShowEditPersonalModal(true);
    };

    const handleSavePersonalDetails = async (e) => {
        e.preventDefault();
        setIsSavingPersonal(true);
        try {
            const selectedSex = personalForm.sex || personalForm.gender || null;
            const payload = {
                first_name: (personalForm.first_name || '').trim(),
                last_name: (personalForm.last_name || '').trim(),
                sex: selectedSex,
                gender: selectedSex,
                birth_date: personalForm.birth_date || null,
                address: (personalForm.address || '').trim() || null
            };

            const res = await fetchWithAuth('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to update personal details.');
            }

            const updatedEmp = data.employee || data.user;
            queryClient.setQueryData(['myProfile'], (old) => {
                if (!old) return old;
                return {
                    ...old,
                    employee: { ...(old.employee || {}), ...updatedEmp },
                    user: { ...(old.user || {}), ...updatedEmp }
                };
            });

            try {
                const rawUser = localStorage.getItem('user');
                if (rawUser) {
                    const parsed = JSON.parse(rawUser);
                    parsed.first_name = updatedEmp.first_name;
                    parsed.last_name = updatedEmp.last_name;
                    parsed.sex = updatedEmp.sex || updatedEmp.gender;
                    parsed.gender = updatedEmp.sex || updatedEmp.gender;
                    parsed.birth_date = updatedEmp.birth_date;
                    parsed.address = updatedEmp.address;
                    localStorage.setItem('user', JSON.stringify(parsed));
                }
                sessionStorage.removeItem(cacheStorageKey);
                clearProfileCache(cacheStorageKey);
            } catch (_) {}

            queryClient.invalidateQueries({ queryKey: ['myProfile'] });
            toast.success('Personal details securely updated.');
            setShowEditPersonalModal(false);
        } catch (err) {
            toast.error(err.message || 'Failed to save personal details.');
        } finally {
            setIsSavingPersonal(false);
        }
    };

    // Modal & Upload States
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedDocTypeId, setSelectedDocTypeId] = useState('tin');
    const [uploadForm, setUploadForm] = useState({
        title: '',
        category: 'Government ID',
        documentType: 'BIR Form 1902 / 2316 (TIN Document)',
        requestId: null,
        expiryDate: '',
        file: null
    });

    const resetUploadForm = () => {
        setSelectedDocTypeId('tin');
        setUploadForm({
            title: '',
            category: 'Government ID',
            documentType: 'BIR Form 1902 / 2316 (TIN Document)',
            requestId: null,
            expiryDate: '',
            file: null
        });
    };

    const openUploadModal = (file = null) => {
        if (isAdminAccount) {
            toast.error('Document uploads are disabled for administrator governance accounts.');
            return;
        }
        if (isTerminated) {
            toast.error('Document uploads are disabled for separated/terminated accounts.');
            return;
        }
        const defaultType = DOCUMENT_TYPES[0];
        setSelectedDocTypeId(defaultType.id);
        const suggestedTitle = file ? file.name.replace(/\.[^/.]+$/, '') : `${defaultType.label} - ${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
        setUploadForm({
            title: suggestedTitle,
            category: defaultType.category,
            documentType: defaultType.label,
            requestId: null,
            expiryDate: '',
            file: file || null
        });
        setShowUploadModal(true);
    };

    const openUploadForRequest = (req) => {
        if (isTerminated) {
            toast.error('Document uploads are disabled for separated/terminated accounts.');
            return;
        }
        const matched = getDocumentType(req.document_type);
        setSelectedDocTypeId(matched.id !== 'unknown' ? matched.id : 'unknown');
        setUploadForm({
            title: `${req.document_type} - ${profile?.first_name || ''} ${profile?.last_name || ''}`.trim(),
            category: req.category || (matched.id !== 'unknown' ? matched.category : 'Other'),
            documentType: req.document_type,
            requestId: req.id,
            expiryDate: '',
            file: null
        });
        setShowUploadModal(true);
    };

    const handleUploadDocTypeChange = (typeId) => {
        setSelectedDocTypeId(typeId);
        const meta = getDocumentType(typeId);
        if (meta) {
            setUploadForm(prev => ({
                ...prev,
                category: meta.category,
                documentType: meta.label,
                title: prev.requestId ? prev.title : `${meta.label} - ${profile?.first_name || ''} ${profile?.last_name || ''}`.trim()
            }));
        }
    };

    const handleUploadSubmit = async (e) => {
        e.preventDefault();

        if (isAdminAccount) {
            toast.error('Document uploads are disabled for administrator governance accounts.');
            return;
        }

        if (isTerminated) {
            toast.error('Document uploads are disabled for separated/terminated accounts.');
            return;
        }

        if (!profile?.id) {
            toast.error('User profile not loaded properly. Please refresh.');
            return;
        }

        if (!uploadForm.file || !uploadForm.title.trim()) {
            toast.error('Please fill in the title and select a file');
            return;
        }

        setIsUploading(true);
        try {
            const resolvedTitle = uploadForm.title.trim();
            const cleanFileName = formatCleanDocumentFileName(resolvedTitle, uploadForm.file.name);
            const renamedFile = uploadForm.file.name === cleanFileName ? uploadForm.file : new File([uploadForm.file], cleanFileName, { type: uploadForm.file.type });

            await uploadEmployeeDocument({
                employeeId: profile.id,
                file: renamedFile,
                title: resolvedTitle,
                category: uploadForm.category,
                documentType: uploadForm.documentType,
                requestId: uploadForm.requestId,
                expiryDate: uploadForm.expiryDate || null
            });
            toast.success(uploadForm.requestId ? 'Requested document submitted to HR for review!' : 'Document submitted for review.');
            setShowUploadModal(false);
            resetUploadForm();
            documentQuery.refresh();
            requestQuery.refresh();
            queryClient.invalidateQueries({ queryKey: ['myProfile'] });
        } catch (err) {
            console.error('Document upload error:', err);
            toast.error(err.message || 'Error uploading document');
        } finally {
            setIsUploading(false);
        }
    };

    const formatDate = (dateString, dateOnly = false) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            ...(dateOnly ? { timeZone: 'UTC' } : {})
        });
    };

    const formatFileSize = formatDocumentSize;

    const getFileMeta = (fileName = '') => {
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        switch (ext) {
            case 'pdf':
                return { icon: 'ti-file-type-pdf', color: 'text-danger-ink', bg: 'bg-danger-subtle', border: 'border-danger/20' };
            case 'doc':
            case 'docx':
                return { icon: 'ti-file-type-docx', color: 'text-accent', bg: 'bg-accent-subtle', border: 'border-accent/20' };
            case 'xls':
            case 'xlsx':
                return { icon: 'ti-file-type-xls', color: 'text-ink', bg: 'bg-surface-muted', border: 'border-line' };
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'heic':
                return { icon: 'ti-photo', color: 'text-accent', bg: 'bg-accent-subtle', border: 'border-accent/20' };
            default:
                return { icon: 'ti-file', color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-100' };
        }
    };

    const isImageFile = (fileName = '') => ['png', 'jpg', 'jpeg', 'heic', 'webp'].includes((fileName.split('.').pop() || '').toLowerCase());

    const getExpiryStatus = getDocumentExpiry;

    const expiryBadgeStyles = {
        expired: 'bg-danger-subtle text-danger-ink border-danger/20',
        warning: 'bg-warning-subtle text-warning-ink border-warning/20',
        valid: 'bg-surface-muted text-ink border-line',
    };

    const alerts = useMemo(() => {
        if (isAdminAccount) return [];
        return documents
            .map((doc) => ({ doc, status: getDocumentExpiry(doc) }))
            .filter(({ status }) => status && status.level !== 'valid')
            .sort((a, b) => a.status.daysLeft - b.status.daysLeft);
    }, [documents, isAdminAccount]);

    const filteredDocuments = useMemo(() => {
        if (isAdminAccount) return [];
        const q = docSearch.toLowerCase().trim();
        return documents.filter((doc) =>
            (doc.title || '').toLowerCase().includes(q) || (doc.file_name || '').toLowerCase().includes(q)
        ).sort((a, b) => docSort === 'oldest' ? new Date(a.created_at) - new Date(b.created_at) : new Date(b.created_at) - new Date(a.created_at));
    }, [documents, docSearch, docSort, isAdminAccount]);

    const showExpiryField = EXPIRABLE_CATEGORIES.includes(uploadForm.category);

    const handleDragEnter = (e) => {
        e.preventDefault();
        if (isTerminated || isAdminAccount) return;
        if (e.dataTransfer.types?.includes('Files')) {
            dragCounter.current += 1;
            setIsDraggingFile(true);
        }
    };
    const handleDragLeave = (e) => {
        e.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setIsDraggingFile(false);
        }
    };
    const handleDragOver = (e) => e.preventDefault();
    const handleDrop = (e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDraggingFile(false);
        if (isAdminAccount) return;
        if (isTerminated) {
            toast.error('Document uploads are disabled for separated/terminated accounts.');
            return;
        }
        const file = e.dataTransfer.files?.[0];
        if (file) openUploadModal(file);
    };

    if (isLoading && !profile) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-accent rounded-full animate-spin" />
                <p className="text-slate-400 font-bold tracking-widest uppercase text-xs">Loading Profile...</p>
            </div>
        );
    }

    return (
        <div
            className="max-w-5xl mx-auto space-y-5 pb-20 px-4 sm:px-6 font-sans relative"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {isDraggingFile && (
                <div className="fixed inset-0 z-[60] bg-slate-900/20 flex items-center justify-center pointer-events-none">
                    <div className="bg-white rounded-lg shadow-xl border-2 border-dashed border-accent px-10 py-8 flex flex-col items-center">
                        <i className="ti ti-cloud-upload text-4xl text-accent mb-2" />
                        <p className="font-bold text-slate-800 text-sm uppercase tracking-wider">Drop to Upload</p>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">Attach to your documents</p>
                    </div>
                </div>
            )}

            {/* Profile header */}
            <div className="bg-slate-900 rounded-lg p-5 sm:p-7 border border-slate-800 text-white shadow-2xs relative">
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
                    <div className="relative h-24 w-24 sm:h-28 sm:w-28 shrink-0">
                        <EmployeeAvatar
                            employee={profile}
                            size="h-24 w-24 sm:h-28 sm:w-28"
                            rounded="rounded-lg"
                            border="border border-slate-700"
                            shadow="shadow-2xs"
                            theme="dark"
                            textSize="text-3xl sm:text-4xl"
                        />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
                            {isAdminAccount ? (
                                <>
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-800 text-slate-200 text-xs font-mono font-bold rounded-md border border-slate-700">
                                        <i className="ti ti-shield-lock text-accent" /> {profile?.company_id || 'CP-MAIN'}
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent/20 text-accent-on-dark text-xs font-semibold rounded-md border border-accent/30">
                                        <i className="ti ti-crown" /> {profile?.job_title || profile?.role || 'Admin'}
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-800 text-slate-300 text-xs font-semibold rounded-md border border-slate-700">
                                        {profile?.department || 'IT Operations'}
                                    </span>
                                </>
                            ) : (
                                <>
                                    {isTerminated && (
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-md border ${
                                            isPendingArchive 
                                                ? 'bg-warning/20 text-warning border-warning/30' 
                                                : 'bg-danger/20 text-danger border-danger/30'
                                        }`}>
                                            <i className={`ti ${isPendingArchive ? 'ti-clock-pause' : 'ti-circle-x'}`} />
                                            {isPendingArchive ? `Pending Archive (${daysUntilPermanentArchive}d)` : 'Separated'}
                                        </span>
                                    )}
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-800 text-slate-200 text-xs font-mono font-bold rounded-md border border-slate-700">
                                        <i className="ti ti-id text-slate-400" /> {profile?.company_id || 'EMPLOYEE'}
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent/20 text-accent-on-dark text-xs font-semibold rounded-md border border-accent/30">
                                        {profile?.department || 'Operations'}
                                    </span>
                                    {(profile?.department || '').toLowerCase().includes('factory') ? (
                                        <>
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-warning/20 text-warning text-xs font-semibold rounded-md border border-warning/30">
                                                Factory (08:00 - 17:00 • No OT)
                                            </span>
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent/20 text-accent-on-dark text-xs font-semibold rounded-md border border-accent/30">
                                                Piece-Rate Production
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent/20 text-accent-on-dark text-xs font-semibold rounded-md border border-accent/30">
                                                Regular (08:00 - 20:00 • OT Eligible)
                                            </span>
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-surface-muted text-ink text-xs font-semibold rounded-md border border-line">
                                                Salaried Monthly
                                            </span>
                                        </>
                                    )}
                                </>
                            )}
                        </div>

                        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
                            {profile?.first_name} {profile?.last_name}
                        </h1>
                        <p className="text-slate-300 font-medium text-xs sm:text-sm mt-0.5">
                            {profile?.job_title || (isAdminAccount ? 'Admin' : 'Staff Member')}
                        </p>

                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-3 text-xs font-medium text-slate-400">
                            <span className="flex items-center gap-1.5">
                                <i className="ti ti-mail text-slate-400 text-sm" /> {profile?.email || 'N/A'}
                            </span>
                            {profile?.phone && (
                                <span className="flex items-center gap-1.5 font-mono">
                                    <i className="ti ti-phone text-slate-400 text-sm" /> {formatPhDisplay(profile.phone)}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
                        {isAdminAccount ? (
                            <div className="w-full sm:w-auto h-9 px-3.5 bg-slate-800/90 text-slate-200 border border-slate-700 rounded-md text-xs font-semibold shadow-2xs flex items-center justify-center gap-2 select-none">
                            </div>
                        ) : (
                            <>
                                {alerts.length > 0 && (
                                    <div className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-warning/20 text-warning border border-warning/30 rounded-md text-xs font-semibold">
                                        <i className="ti ti-alert-triangle text-warning text-sm" /> {alerts.length} Doc{alerts.length > 1 ? 's' : ''} Need Attention
                                    </div>
                                )}
                                {isTerminated ? (
                                    <span className="w-full sm:w-auto h-9 px-3.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-not-allowed select-none">
                                        <i className="ti ti-lock text-sm" /> Uploads Disabled
                                    </span>
                                ) : (
                                    <button
                                        onClick={() => openUploadModal()}
                                        className="w-full sm:w-auto h-9 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium transition-colors duration-100 shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                                    >
                                        <i className="ti ti-upload text-sm" /> Upload Document
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Disciplinary Suspension Notification */}
            {!isAdminAccount && isSuspended && !isPendingArchive && (
                <div className="bg-warning-subtle border border-warning/20 rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs">
                    <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-warning-subtle text-warning-ink rounded-md shrink-0 mt-0.5">
                            <i className="ti ti-lock-exclamation text-xl" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h4 className="font-bold text-warning-ink text-sm">Disciplinary Suspension Active</h4>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-warning-subtle text-warning-ink border border-warning/20 text-xs font-semibold rounded-md">
                                    <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                                    Operational Hold
                                </span>
                            </div>
                            <p className="text-xs text-warning-ink mt-1 leading-relaxed">
                                Under DOLE policy ("No Work, No Pay"), gate access and attendance logging are temporarily on hold. You retain access to review your documents and official records.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Pending Archive Clearance Notification */}
            {!isAdminAccount && isPendingArchive && (
                <div className="bg-warning-subtle border border-warning/20 rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs">
                    <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-warning-subtle text-warning-ink rounded-md shrink-0 mt-0.5">
                            <i className="ti ti-hourglass-empty text-xl animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h4 className="font-bold text-warning-ink text-sm">Account in Clearance Cooldown</h4>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-warning-subtle text-warning-ink border border-warning/20 text-xs font-semibold rounded-md">
                                    <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                                    {daysUntilPermanentArchive} Days Left
                                </span>
                            </div>
                            <p className="text-xs text-warning-ink mt-1 leading-relaxed">
                                Your employment profile has been queued for archival ({profile?.separation_type || 'Separated'}). 
                                {profile?.separation_reason ? ` Reason: "${profile.separation_reason}".` : ''} 
                                Access to biometrics and turnstiles is restricted during clearance. Historical documents remain accessible.
                            </p>
                        </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                        <span className="text-[11px] font-mono font-medium text-warning-ink bg-warning-subtle/60 px-2.5 py-1 rounded-md border border-warning/20">
                            Clearance Cooldown: 14 Days
                        </span>
                    </div>
                </div>
            )}

            {isAdminAccount ? (
                <>
                    {/* Admin Section 1: Personal Identity & Administrative Governance Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                        {/* Personal Information */}
                        <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                                <div className="flex items-center gap-2.5">
                                    <div className="h-9 w-9 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20">
                                        <i className="ti ti-user-shield text-lg" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-sm">Administrative Identity</h3>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={openEditPersonalModal}
                                    className="h-7 px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-md border border-slate-200 transition-colors duration-100 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                >
                                    <i className="ti ti-edit text-xs" /> Edit Details
                                </button>
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
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Contact Phone</p>
                                    <p className="font-mono font-semibold text-slate-900">{formatPhDisplay(profile?.phone) || 'Not configured'}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Sex</p>
                                    <p className="font-semibold text-slate-900 capitalize">{profile?.sex || profile?.gender || 'N/A'}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Corporate Email</p>
                                    <p className="font-semibold text-slate-900 truncate flex items-center gap-1.5">
                                        <i className="ti ti-mail text-slate-400" />
                                        {profile?.email || 'N/A'}
                                    </p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Residential Address</p>
                                    <p className="font-semibold text-slate-900">{profile?.address || 'No address registered'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Administrative Governance & System Assignment */}
                        <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                                <div className="h-9 w-9 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200">
                                    <i className="ti ti-shield-check text-lg" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm">System Governance</h3>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3.5 text-xs">
                                <div>
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Admin ID</p>
                                    <p className="font-mono font-semibold text-slate-900">{profile?.company_id || 'CP-MAIN'}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Department</p>
                                    <p className="font-semibold text-slate-900">{profile?.department || 'IT Operations'}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Administrative Role</p>
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/20 text-accent-on-dark font-semibold text-[11px] rounded-md border border-accent/30">
                                        <i className="ti ti-shield-lock" /> {profile?.job_title || profile?.role || 'Admin'}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Security Clearance</p>
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-muted text-ink font-semibold text-[11px] rounded-md border border-line">
                                        Tier 0 · Executive
                                    </span>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Governance Status</p>
                                    <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-md border border-slate-200">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-slate-900">Active Privileged Account</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Admin Section 2: Security Credentials & Two-Factor Authentication */}
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <div className={`h-9 w-9 rounded-md flex items-center justify-center border ${
                                    totpStatus.enabled ? 'bg-surface-muted text-ink border-line' : 'bg-slate-100 text-slate-700 border-slate-200'
                                }`}>
                                <i className="ti ti-shield-lock text-lg" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">Administrative Authentication &amp; 2FA</h3>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                                    totpStatus.enabled ? 'bg-surface-muted text-ink border-line' : 'bg-slate-100 text-slate-700 border-slate-300'
                                }`}>
                                    <i className={`ti ${totpStatus.enabled ? 'ti-circle-check' : 'ti-alert-circle'}`} />
                                    {totpStatus.enabled ? 'Enabled & Active' : 'Not Configured'}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 2FA Card */}
                            <div className="p-4 rounded-md bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-3 text-xs">
                                <div>
                                    <p className="font-bold text-slate-900 flex items-center gap-1.5">
                                        <i className="ti ti-device-mobile text-slate-500" />
                                        Two-Factor Authenticator (TOTP)
                                    </p>
                                    {totpStatus.enabled && (
                                        <p className="text-slate-600 mt-1 leading-relaxed">
                                            Your administrative session is protected with offline TOTP codes (Google Authenticator).
                                        </p>
                                    )}
                                </div>
                                <div className="pt-2 flex items-center gap-2">
                                    {totpStatus.enabled ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => setShowReconfigureModal(true)}
                                                disabled={totpSubmitting}
                                                className="h-8 px-3 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-md font-medium text-xs shadow-2xs transition-colors cursor-pointer"
                                            >
                                                Reconfigure
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDisableCode('');
                                                    setShowDisableModal(true);
                                                }}
                                                disabled={totpSubmitting}
                                                className="h-8 px-3 bg-danger-subtle hover:bg-danger-subtle text-danger-ink border border-danger/20 rounded-md font-medium text-xs shadow-2xs transition-colors cursor-pointer"
                                            >
                                                Disable 2FA
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleStartTotpSetup}
                                            disabled={totpSubmitting}
                                            className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold text-xs shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
                                        >
                                            <i className="ti ti-qrcode text-sm" />
                                            <span>Setup Authenticator</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Password Management Card */}
                            <div className="p-4 rounded-md bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-3 text-xs">
                                <div>
                                    <p className="font-bold text-slate-900 flex items-center gap-1.5">
                                        <i className="ti ti-key text-slate-500" />
                                        Administrative Password
                                    </p>
                                </div>
                                <div className="pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowChangePasswordModal(true)}
                                        className="h-8 px-3.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-md font-semibold text-xs shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
                                    >
                                        <i className="ti ti-lock-password text-sm" />
                                        <span>Update Password</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Admin Section 4: Recent Administrative Activity Audit */}
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <div className="h-9 w-9 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20">
                                    <i className="ti ti-activity text-lg" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">Recent Administrative Activity</h3>
                                </div>
                            </div>
                            <Link
                                to="/admin/audit-logs"
                                className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
                            >
                                <span>Full Audit Trail</span>
                                <i className="ti ti-arrow-right text-xs" />
                            </Link>
                        </div>

                        {profileResponse?.recent_activity?.length > 0 ? (
                            <div className="divide-y divide-slate-100 text-xs">
                                {profileResponse.recent_activity.map((act) => (
                                    <div key={act.id} className="py-2.5 flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2.5 min-w-0">
                                            <div className="w-7 h-7 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                                                <i className="ti ti-terminal text-sm" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-semibold text-slate-900 truncate">
                                                    {act.description || act.event || 'System Action'}
                                                </p>
                                                <p className="text-[11px] text-slate-500 font-mono">
                                                    {act.subject_type || 'System'}{act.subject_id ? ` · ${String(act.subject_id).slice(0, 8)}...` : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                                            {formatDate(act.created_at)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-4 rounded-md bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                                <i className="ti ti-shield-check text-2xl text-slate-400 mb-1 block" />
                                <p className="font-semibold text-slate-700">Audit Logging Active</p>
                                <p className="text-[11px] text-slate-500 mt-0.5">All administrative transactions, record modifications, and privilege grants are immutably captured.</p>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <>
                    {/* Personal and employment details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                {/* Personal Information */}
                <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                            <div className="h-9 w-9 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20">
                                <i className="ti ti-user text-lg" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 text-sm">Personal Details</h3>
                            </div>
                        </div>
                        {!isTerminated && (
                            <button
                                type="button"
                                onClick={openEditPersonalModal}
                                className="h-7 px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-md border border-slate-200 transition-colors duration-100 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                            >
                                <i className="ti ti-edit text-xs" /> Edit Details
                            </button>
                        )}
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
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Sex</p>
                            <p className="font-semibold text-slate-900 capitalize">{profile?.sex || profile?.gender || 'N/A'}</p>
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
                            <div className="mb-0.5">
                                <p className="text-slate-500 font-semibold uppercase text-[10px]">Residential Address</p>
                            </div>
                            <p className="font-semibold text-slate-900">
                                {profile?.address || 'No address registered'}
                            </p>
                        </div>
                        <div className="col-span-2 pt-2 border-t border-slate-100">
                            <div className="mb-0.5">
                                <p className="text-slate-500 font-semibold uppercase text-[10px]">Emergency Contact</p>
                            </div>
                            {profile?.emergency_contact_name ? (
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-semibold text-slate-900">
                                    <span>{profile.emergency_contact_name}</span>
                                    {profile.emergency_contact_relationship && (
                                        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-normal">
                                            {profile.emergency_contact_relationship}
                                        </span>
                                    )}
                                    {profile.emergency_contact_phone && (
                                        <span className="font-mono text-xs text-slate-600">
                                            +63 {profile.emergency_contact_phone}
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400 italic">No emergency contact designated</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Employment & Payroll Details */}
                <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                        <div className="h-9 w-9 rounded-md bg-surface-muted text-ink flex items-center justify-center border border-line">
                            <i className="ti ti-briefcase text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Employment & Payroll</h3>
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
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Date hired</p>
                            <p className="font-mono font-semibold text-slate-900">{formatDate(profile?.date_hired, true)}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Employment Status</p>
                            <span className="inline-flex items-center px-2.5 py-0.5 bg-surface-muted text-ink font-semibold text-[11px] rounded-md border border-line">
                                Active Full-Time
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Biometric Authentication & Gate Access */}
            <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                        <div className={`h-9 w-9 rounded-md flex items-center justify-center border ${
                            isMedicalExempt 
                                ? 'bg-warning-subtle text-warning-ink border-warning/20' 
                                : profile?.has_registered_biometrics 
                                ? 'bg-surface-muted text-ink border-line' 
                                : 'bg-accent-subtle text-accent border-accent/20'
                        }`}>
                            <i className={`ti ${isMedicalExempt ? 'ti-bandage' : 'ti-fingerprint'} text-lg`} />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Gate Access &amp; Face Scan</h3>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                            isMedicalExempt 
                                ? 'bg-warning-subtle text-warning-ink border-warning/20' 
                                : profile?.has_registered_biometrics 
                                ? 'bg-surface-muted text-ink border-line' 
                                : 'bg-accent-subtle text-accent border-accent/20'
                        }`}>
                            <i className={`ti ${
                                isMedicalExempt ? 'ti-shield-check' :
                                profile?.has_registered_biometrics ? 'ti-circle-check' : 'ti-alert-circle'
                            }`} />
                            {isMedicalExempt 
                                ? `Medical Grace Active (${daysRemaining}d Left)` 
                                : profile?.has_registered_biometrics 
                                ? 'Dual-Factor Active' 
                                : 'Setup Required'}
                        </span>
                    </div>
                </div>

                {isMedicalExempt ? (
                    <div className="space-y-3">
                        <div className="p-4 rounded-md bg-warning-subtle/50 border border-warning/20 space-y-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-bold text-warning-ink flex items-center gap-1.5">
                                    <i className="ti ti-first-aid-kit text-warning-ink text-sm" />
                                    Medical Grace Protocol Active
                                </span>
                                <span className="font-mono text-slate-600 font-semibold">
                                    Valid Through: {new Date(medicalExemption.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                            </div>
                            <p className="text-slate-700 leading-relaxed font-medium">
                                Authorized Reason: <strong className="text-slate-900">{medicalExemption.reason}</strong>
                                {medicalExemption.notes ? ` — ${medicalExemption.notes}` : ''}
                            </p>
                            {medicalExemption.granted_by && (
                                <p className="text-slate-500 text-[11px] font-medium flex items-center gap-1.5">
                                    <i className="ti ti-user-check text-slate-400" />
                                    <span>Authorized by: <strong className="text-slate-700">{/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(medicalExemption.granted_by) ? 'System Administrator (HR)' : (medicalExemption.granted_by_role ? `${medicalExemption.granted_by} (${medicalExemption.granted_by_role})` : medicalExemption.granted_by)}</strong></span>
                                </p>
                            )}
                            <p className="text-warning-ink text-[11px] font-semibold pt-1 flex items-center gap-1.5">
                                <i className="ti ti-info-circle text-warning-ink shrink-0" />
                                <span>Turnstile Instructions: Your Digital Gate Pass QR is authorized for single-step badge access. The turnstile camera logs an evidentiary snapshot automatically. No facial matching required.</span>
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                            <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                                <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Turnstile Mode</p>
                                <p className="font-bold text-slate-800 flex items-center gap-1">
                                    <i className="ti ti-qrcode text-ink" />
                                    QR-Only (Medical Grace)
                                </p>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                                <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Audit Trail</p>
                                <p className="font-bold text-slate-800 flex items-center gap-1">
                                    <i className="ti ti-camera text-accent" />
                                    Camera Snapshot Logged
                                </p>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-md border border-slate-200 flex items-center justify-between">
                                <div>
                                    <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Digital Pass</p>
                                    <p className="font-bold text-slate-800">Ready to Scan</p>
                                </div>
                                <Link
                                    to="/employee/qr"
                                    className="h-8 px-3 bg-warning hover:bg-warning-ink text-white rounded-md font-medium text-xs shadow-2xs transition-colors duration-100 cursor-pointer flex items-center justify-center"
                                >
                                    View QR
                                </Link>
                            </div>
                        </div>
                    </div>
                ) : profile?.has_registered_biometrics ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                            <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Face Scan</p>
                            <p className="font-bold text-ink flex items-center gap-1">
                                <i className="ti ti-circle-check text-ink" />
                                Verified &amp; Active
                            </p>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                            <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Clock-in Method</p>
                            <p className="font-bold text-slate-800 flex items-center gap-1">
                                <i className="ti ti-shield-check text-accent" />
                                Badge + Face Scan
                            </p>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-md border border-slate-200 flex items-center justify-between">
                            <div>
                                <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Digital Badge</p>
                                <p className="font-bold text-slate-800">Ready to use</p>
                            </div>
                            <Link
                                to="/employee/qr"
                                className="h-8 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-medium text-xs shadow-2xs transition-colors duration-100 cursor-pointer flex items-center justify-center"
                            >
                                View badge
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 rounded-md bg-accent-subtle/50 border border-accent/20 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <p className="font-bold text-accent-strong flex items-center gap-1.5">
                                <i className="ti ti-scan text-accent text-sm" />
                                Face scan setup required
                            </p>
                            <p className="text-accent mt-0.5">
                                Please complete your face scan setup to enable clocking in at company kiosks.
                            </p>
                        </div>
                        <Link
                            to="/biometric-setup"
                            className="h-8 px-4 bg-accent hover:bg-accent-hover text-white rounded-md font-medium text-xs shadow-2xs text-center shrink-0 transition-colors duration-100 cursor-pointer flex items-center justify-center"
                        >
                            Set up face scan
                        </Link>
                    </div>
                )}
            </div>

            {/* Two-Factor Authentication (Google Authenticator TOTP) */}
            <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                        <div className={`h-9 w-9 rounded-md flex items-center justify-center border ${
                            totpStatus.enabled 
                                ? 'bg-surface-muted text-ink border-line' 
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                            <i className="ti ti-shield-lock text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Two-Factor Authentication (2FA)</h3>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                            totpStatus.enabled 
                                ? 'bg-surface-muted text-ink border-line' 
                                : 'bg-slate-100 text-slate-700 border-slate-300'
                        }`}>
                            <i className={`ti ${totpStatus.enabled ? 'ti-circle-check' : 'ti-alert-circle'}`} />
                            {totpStatus.enabled ? 'Enabled & Active' : 'Not Configured'}
                        </span>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-md bg-slate-50 border border-slate-200 text-xs">
                    <div>
                        <p className="font-bold text-slate-900">
                            {totpStatus.enabled 
                                ? 'Your account is secured with Time-Based One-Time Passwords (TOTP).'
                                : 'Protect your administrative and workplace access with instant, offline 2FA codes.'}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {totpStatus.enabled ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setShowReconfigureModal(true)}
                                    disabled={totpSubmitting}
                                    className="h-8 px-3 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-md font-medium text-xs shadow-2xs transition-colors cursor-pointer"
                                >
                                    Reconfigure
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDisableCode('');
                                        setShowDisableModal(true);
                                    }}
                                    disabled={totpSubmitting}
                                    className="h-8 px-3 bg-danger-subtle hover:bg-danger-subtle text-danger-ink border border-danger/20 rounded-md font-medium text-xs shadow-2xs transition-colors cursor-pointer"
                                >
                                    Disable 2FA
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={handleStartTotpSetup}
                                disabled={totpSubmitting}
                                className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold text-xs shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
                            >
                                <i className="ti ti-qrcode text-sm" />
                                <span>Setup Authenticator</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Compliance & Disciplinary Standing */}
            <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-md bg-warning-subtle text-warning-ink flex items-center justify-center border border-warning/20">
                            <i className="ti ti-scale text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Policy &amp; Incident Reports</h3>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                            isTerminated ? 'bg-danger-subtle text-danger-ink border-danger/20' :
                            isSuspended ? 'bg-warning-subtle text-warning-ink border-warning/20' :
                            disciplinaryLogs.some(l => l.status === 'Active') ? 'bg-danger-subtle text-danger-ink border-danger/20' :
                            'bg-surface-muted text-ink border-line'
                        }`}>
                            <i className={`ti ${
                                isTerminated ? 'ti-circle-x' :
                                isSuspended ? 'ti-clock-pause' :
                                disciplinaryLogs.some(l => l.status === 'Active') ? 'ti-alert-triangle' :
                                'ti-circle-check'
                            }`} />
                            {isTerminated ? 'Separated' :
                             isSuspended ? 'Suspension Active' :
                             disciplinaryLogs.some(l => l.status === 'Active') ? 'Action Required' :
                             'Good Standing'}
                        </span>
                    </div>
                </div>

                {disciplinaryLogs.length === 0 ? (
                    <div className="flex flex-col sm:flex-row items-center gap-3.5 p-4 rounded-md bg-surface-muted border border-line text-xs">
                        <div className="w-8 h-8 rounded-md bg-surface-muted text-ink flex items-center justify-center shrink-0">
                            <i className="ti ti-shield-check text-base" />
                        </div>
                        <div className="flex-1 text-center sm:text-left">
                            <p className="font-bold text-ink">Clean Disciplinary Standing</p>
                            <p className="text-ink mt-0.5">
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
                                    className={`p-4 rounded-md border text-xs transition-colors duration-100 ${
                                        isResolvedTermination
                                            ? 'bg-success-subtle/30 border-success/20'
                                            : log.status === 'Active'
                                            ? 'bg-danger-subtle/30 border-danger/20'
                                            : log.status === 'Acknowledged'
                                            ? 'bg-accent-subtle/30 border-accent/20'
                                            : 'bg-slate-50/70 border-slate-200'
                                    }`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200/60">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
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

                                            <span className="text-slate-500 font-medium flex items-center gap-1">
                                                <i className="ti ti-calendar text-xs" />
                                                {formatDate(log.date || log.created_at)}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
                                                log.status === 'Resolved' ? 'bg-success-subtle text-success-ink border-success/20' :
                                                log.status === 'Overturned' ? 'bg-success-subtle text-success-ink border-success/20' :
                                                log.status === 'Acknowledged' ? 'bg-accent-subtle text-accent-strong border-accent/20' :
                                                'bg-danger-subtle text-danger-ink border-danger/20'
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
                                        <div className="mt-2.5 pt-2 border-t border-danger/60 flex items-center justify-between gap-2 text-[11px] text-danger-ink">
                                            <span className="flex items-center gap-1">
                                                <i className="ti ti-alert-circle text-sm" /> Formal acknowledgment required under DOLE due process.
                                            </span>
                                            <Link
                                                to="/employee/dashboard"
                                                className="h-7 px-2.5 bg-danger hover:bg-danger-ink text-white font-semibold rounded-md text-[10px] uppercase transition-colors duration-100 shrink-0 flex items-center justify-center shadow-2xs"
                                            >
                                                Review Notice
                                            </Link>
                                        </div>
                                    )}

                                    {log.status === 'Acknowledged' && (
                                        <div className="mt-2 pt-2 border-t border-accent/20 text-[11px] text-accent font-medium flex items-center gap-1">
                                            <i className="ti ti-checks text-sm" />
                                            <span>Receipt formally acknowledged on employee portal.</span>
                                        </div>
                                    )}

                                    {isReinstatedNote && (
                                        <div className="mt-2 pt-2 border-t border-success/20 text-[11px] text-success-ink font-bold flex items-center gap-1">
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

            {/* Employee documents */}
            <div id="documents" className="space-y-4 scroll-mt-20">
                {documentQuery.error && (
                    <div role="alert" className="rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger-ink">
                        {documentQuery.error.message} <button type="button" onClick={() => documentQuery.refetch()} className="ml-2 font-semibold underline">Retry</button>
                    </div>
                )}

                {/* Active Document Requests from HR */}
                {activeRequests.length > 0 && !isTerminated && (
                    <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-4 sm:p-5 shadow-2xs space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <div className="h-8 w-8 shrink-0 bg-amber-100 text-amber-700 rounded-md flex items-center justify-center border border-amber-200">
                                    <i className="ti ti-mail-forward text-base" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-xs sm:text-sm font-bold text-amber-900">
                                            Action Required: {activeRequests.length} Document{activeRequests.length > 1 ? 's' : ''} Requested by HR
                                        </h4>
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-200/80 text-amber-800">
                                            Compliance Hold
                                        </span>
                                    </div>
                                    <p className="text-xs text-amber-800 font-medium mt-0.5">
                                        Please upload the missing personnel documents below to fulfill your statutory document requirements.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                            {activeRequests.map(req => (
                                <div
                                    key={req.id}
                                    className="p-3 bg-white rounded-lg border border-amber-200/80 flex items-start justify-between gap-3 shadow-2xs"
                                >
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-bold text-xs text-slate-900">{req.document_type}</span>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${
                                                req.priority === 'urgent'
                                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                    : req.priority === 'high'
                                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                                            }`}>
                                                {req.priority}
                                            </span>
                                        </div>
                                        {req.due_date && (
                                            <p className="text-[11px] text-amber-800 font-medium">
                                                Due: <strong>{req.due_date}</strong>
                                            </p>
                                        )}
                                        {req.notes && (
                                            <p className="text-[11px] text-slate-600 italic">
                                                &quot;{req.notes}&quot;
                                            </p>
                                        )}
                                        {req.status === 'submitted' && (
                                            <span className="inline-flex text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                                Submitted · Under HR Review
                                            </span>
                                        )}
                                    </div>

                                    {req.status === 'pending' && (
                                        <button
                                            type="button"
                                            onClick={() => openUploadForRequest(req)}
                                            className="h-7 px-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded transition-colors shadow-2xs flex items-center gap-1 shrink-0 cursor-pointer"
                                        >
                                            <i className="ti ti-upload text-xs" />
                                            <span>Upload</span>
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {alerts.length > 0 && (
                    <div className="bg-warning-subtle border border-warning/20 rounded-lg p-4 sm:p-5 shadow-2xs">
                        <div className="flex items-start gap-3">
                            <div className="h-8 w-8 shrink-0 bg-warning-subtle text-warning-ink rounded-md flex items-center justify-center">
                                <i className="ti ti-alert-triangle text-base" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs sm:text-sm font-bold text-warning-ink">
                                    {alerts.length} document{alerts.length > 1 ? 's need' : ' needs'} renewal
                                </p>
                                <p className="text-xs text-warning-ink font-medium mt-0.5">Please update or submit renewals before the expiry date.</p>
                                <div className="flex flex-wrap gap-2 mt-2.5">
                                    {alerts.map(({ doc, status }) => (
                                        <span
                                            key={doc.id}
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold ${expiryBadgeStyles[status.level]}`}
                                        >
                                            <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : 'ti-clock'} text-xs`} />
                                            {doc.title || doc.file_name} · {status.label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200">
                    {/* Separation notice */}
                    {isTerminated && (
                        <div className="mb-5 p-4 rounded-md bg-danger-subtle border border-danger/20 flex items-start gap-3.5">
                            <div className="w-8 h-8 rounded-md bg-danger-subtle text-danger-ink flex items-center justify-center shrink-0 border border-danger/20">
                                <i className="ti ti-lock text-base font-bold" />
                            </div>
                            <div className="text-xs">
                                <p className="font-bold text-danger-ink uppercase tracking-wide">Personnel Vault Locked · Read-Only Access</p>
                                <p className="text-danger-ink/90 mt-0.5 leading-relaxed font-medium">
                                    Official employment contract has concluded. Document uploads and file modifications are disabled. Historical records remain preserved below for your personal reference and clearance requirements.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20">
                                <i className="ti ti-folders text-lg" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 text-sm sm:text-base">Personnel Documents</h3>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <select aria-label="Document review status" value={docStatus} onChange={e => setDocStatus(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs">
                                {DOCUMENT_STATUSES.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}
                            </select>
                            <select aria-label="Document category" value={docCategory} onChange={e => setDocCategory(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs">
                                {['All', ...new Set([...CATEGORIES, 'Contract', 'Certificate', 'Performance', 'Other'])].map(category => <option key={category}>{category}</option>)}
                            </select>
                            <select aria-label="Document sort order" value={docSort} onChange={e => setDocSort(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs">
                                <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
                            </select>
                            {(documents.length > 0 || docSearch) && (
                                <div className="relative">
                                    <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                                    <input
                                        type="text"
                                        maxLength={200}
                                        placeholder="Search files..."
                                        value={docSearch}
                                        onChange={(e) => setDocSearch(e.target.value)}
                                        className="h-8 pl-7 pr-3 bg-slate-50 border border-slate-200 rounded-md outline-none focus:bg-white focus:border-slate-400 font-medium text-xs text-slate-800 transition-colors duration-100 w-36 sm:w-48"
                                    />
                                </div>
                            )}
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md font-mono text-xs font-semibold whitespace-nowrap">
                                {filteredDocuments.length} File{filteredDocuments.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>

                    {documentQuery.isPending ? <p className="py-8 text-center text-xs text-slate-500">Loading documents…</p> : documents.length === 0 && (docStatus !== 'all' || docCategory !== 'All' || docSearch.trim()) ? (
                        <p className="py-8 text-center text-xs text-slate-500">No documents match these filters.</p>
                    ) : documents.length === 0 ? (
                        isTerminated ? (
                            <div className="text-center py-10 bg-slate-50 rounded-md border border-dashed border-slate-200 space-y-2">
                                <i className="ti ti-folder-off text-3xl text-slate-400 block" />
                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">No documents on file</p>
                                    <p className="text-[11px] text-slate-500">Document uploads are locked for separated employee accounts.</p>
                                </div>
                            </div>
                        ) : isAdminAccount ? (
                            <div className="text-center py-10 bg-slate-50 rounded-md border border-slate-200 space-y-2">
                                <i className="ti ti-shield-lock text-3xl text-slate-400 block" />
                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">Administrative Governance Account</p>
                                    <p className="text-[11px] text-slate-500">Personnel 201 compliance documents are not applicable to administrator profiles.</p>
                                </div>
                            </div>
                        ) : (
                            <div
                                onClick={() => openUploadModal()}
                                className="text-center py-10 bg-slate-50 rounded-md border-2 border-dashed border-slate-200 space-y-2.5 cursor-pointer hover:border-slate-300 hover:bg-slate-100/50 transition-colors duration-100"
                            >
                                <i className="ti ti-folder-plus text-3xl text-slate-400 block" />
                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">No documents uploaded yet</p>
                                    <p className="text-[11px] text-slate-500">Click here or drag files to upload government IDs and certificates.</p>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); openUploadModal(); }}
                                    className="h-8 px-3 bg-accent text-white hover:bg-accent-hover rounded-md text-xs font-medium transition-colors duration-100 inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                >
                                    <i className="ti ti-upload" /> Upload First Document
                                </button>
                            </div>
                        )
                    ) : filteredDocuments.length === 0 ? (
                        <div className="text-center py-10 bg-slate-50 rounded-md border border-dashed border-slate-200">
                            <i className="ti ti-file-search text-3xl text-slate-400 block mb-1" />
                            <p className="font-semibold text-slate-600 text-xs">No files match "{docSearch}"</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                            {filteredDocuments.map((doc) => {
                                const meta = getFileMeta(doc.file_name || doc.title);
                                const status = getExpiryStatus(doc);
                                const review = getDocumentStatus(doc);

                                return (
                                    <div key={doc.id} className="p-3.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-all duration-100 flex items-start gap-3 bg-white hover:shadow-2xs">
                                        <DocumentThumbnail
                                            document={doc}
                                            size="md"
                                            onPreview={() => handleOpenDocument(doc)}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p
                                                className="text-xs font-semibold text-slate-800 truncate cursor-pointer hover:text-accent transition-colors"
                                                title={doc.title || doc.file_name}
                                                onClick={() => handleOpenDocument(doc)}
                                            >
                                                {doc.title || doc.file_name}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                <span className={`rounded-md border px-1.5 text-[10px] font-semibold ${review.className}`}>{review.label}</span>
                                                {doc.category && (
                                                    <span className="inline-block px-1.5 py-0.2 bg-surface-muted text-ink-muted font-semibold text-[10px] rounded-md border border-line">
                                                        {doc.category}
                                                    </span>
                                                )}
                                                {status && (
                                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md border text-[10px] font-semibold ${expiryBadgeStyles[status.level]}`}>
                                                        {status.level === 'valid' ? 'Valid' : status.label}
                                                    </span>
                                                )}
                                            </div>
                                            {review.key === 'rejected' && doc.rejection_reason && <p className="mt-1 text-xs text-danger-ink">{doc.rejection_reason}</p>}
                                            <p className="mt-1 text-[10px] text-slate-400 font-mono truncate" title={doc.file_name}>
                                                {doc.file_name} · {formatFileSize(doc.file_size)}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {documentQuery.hasNextPage && <button type="button" disabled={documentQuery.isFetchingNextPage} onClick={() => documentQuery.fetchNextPage()} className="mt-4 rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold">{documentQuery.isFetchingNextPage ? 'Loading…' : 'Load more documents'}</button>}
                </div>
            </div>
            </>
            )}

            {/* Edit Personal Details Modal */}
            {showEditPersonalModal && !isTerminated && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 overflow-y-auto">
                    <div className="bg-white rounded-lg p-5 sm:p-6 max-w-lg w-full shadow-xl border border-slate-200 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20">
                                    <i className="ti ti-edit text-base" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">Edit Personal Details</h3>
                                    <p className="text-[11px] text-slate-500">Update verified personal and residential details.</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => !isSavingPersonal && setShowEditPersonalModal(false)}
                                className="h-8 w-8 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        <form onSubmit={handleSavePersonalDetails} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                <div>
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                        First Name <span className="text-danger-ink">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={personalForm.first_name}
                                        onChange={(e) => setPersonalForm({ ...personalForm, first_name: e.target.value })}
                                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                        Last Name <span className="text-danger-ink">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={personalForm.last_name}
                                        onChange={(e) => setPersonalForm({ ...personalForm, last_name: e.target.value })}
                                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                <div>
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                        Sex
                                    </label>
                                    <select
                                        value={personalForm.sex || personalForm.gender}
                                        onChange={(e) => setPersonalForm({ ...personalForm, sex: e.target.value, gender: e.target.value })}
                                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs cursor-pointer"
                                    >
                                        <option value="">Select Sex</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                        Date of Birth
                                    </label>
                                    <input
                                        type="date"
                                        max={maxBirthDate}
                                        min="1920-01-01"
                                        value={personalForm.birth_date}
                                        onChange={(e) => setPersonalForm({ ...personalForm, birth_date: e.target.value })}
                                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 font-mono transition-colors shadow-2xs"
                                    />
                                </div>
                            </div>

                            <div>
                                <PhilippineAddressSelector
                                    value={personalForm.address}
                                    onChange={(nextAddress) => setPersonalForm(prev => ({ ...prev, address: nextAddress }))}
                                    idPrefix="profile_edit_address"
                                />
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-2">
                                    <i className="ti ti-shield-check text-accent" />
                                    <span>Encrypted with strict XSS sanitization and enterprise access controls.</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                                <button
                                    type="button"
                                    disabled={isSavingPersonal}
                                    onClick={() => setShowEditPersonalModal(false)}
                                    className="h-8 px-3.5 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-md border border-slate-200 transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSavingPersonal}
                                    className="h-8 px-4 bg-accent hover:bg-accent-strong text-white text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                                >
                                    {isSavingPersonal ? (
                                        <>
                                            <i className="ti ti-loader animate-spin" /> Saving...
                                        </>
                                    ) : (
                                        <>
                                            <i className="ti ti-check" /> Save Changes
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal for file upload */}
            {showUploadModal && !isTerminated && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 overflow-y-auto">
                    <div className="bg-white rounded-lg p-5 sm:p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-5 my-auto max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 bg-accent-subtle text-accent rounded-md flex items-center justify-center shrink-0 border border-accent/20">
                                    <i className="ti ti-file-upload text-base" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">Upload Document</h3>
                                    <p className="text-[11px] text-slate-500">Attach file to your permanent HR record</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => { if (!isUploading) { setShowUploadModal(false); resetUploadForm(); } }}
                                disabled={isUploading}
                                className="h-7 w-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors duration-100 shrink-0 cursor-pointer"
                            >
                                <i className="ti ti-x text-xs" />
                            </button>
                        </div>

                        <form onSubmit={handleUploadSubmit} className="space-y-3.5">
                            {uploadForm.requestId && (
                                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-950 flex items-start gap-2.5">
                                    <i className="ti ti-alert-circle text-amber-600 text-sm mt-0.5 shrink-0" />
                                    <div className="text-xs">
                                        <div className="font-bold">Fulfilling HR Document Request</div>
                                        <div className="text-[11px] text-amber-800 mt-0.5">
                                            Submitting file for <span className="font-semibold underline">{uploadForm.documentType}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Document Type
                                </label>
                                <select
                                    value={selectedDocTypeId}
                                    onChange={(e) => handleUploadDocTypeChange(e.target.value)}
                                    className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none cursor-pointer bg-white"
                                >
                                    {DOCUMENT_CATEGORIES.map((cat) => {
                                        const types = DOCUMENT_TYPES.filter(t => t.category === cat);
                                        if (types.length === 0) return null;
                                        return (
                                            <optgroup key={cat} label={cat}>
                                                {types.map((type) => (
                                                    <option key={type.id} value={type.id}>
                                                        {type.label} {type.is201Required ? '(Required Document)' : ''}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        );
                                    })}
                                </select>
                                {(() => {
                                    const currentMeta = getDocumentType(selectedDocTypeId);
                                    if (!currentMeta?.description) return null;
                                    return (
                                        <p className="text-[11px] text-slate-500 mt-1">
                                            {currentMeta.description}
                                        </p>
                                    );
                                })()}
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">Document Title</label>
                                <input
                                    type="text"
                                    placeholder="e.g. SSS E-1 Form, Pag-IBIG MID, Valid ID"
                                    value={uploadForm.title}
                                    onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                                    className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                                    <input
                                        type="text"
                                        value={uploadForm.category}
                                        readOnly
                                        className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-500 bg-slate-50 cursor-not-allowed"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Expiry Date {(() => {
                                            const currentMeta = getDocumentType(selectedDocTypeId);
                                            return currentMeta?.requiresExpiry ? (
                                                <span className="font-semibold text-amber-600">(Recommended)</span>
                                            ) : (
                                                <span className="font-normal text-slate-400">(Optional)</span>
                                            );
                                        })()}
                                    </label>
                                    <input
                                        type="date"
                                        value={uploadForm.expiryDate}
                                        onChange={(e) => setUploadForm({ ...uploadForm, expiryDate: e.target.value })}
                                        className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Select File</label>
                                <div className="relative border-2 border-dashed border-slate-200 rounded-md p-4 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors duration-100 cursor-pointer overflow-hidden min-h-[110px] flex items-center justify-center">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                setUploadForm((prev) => ({
                                                    ...prev,
                                                    file,
                                                    title: prev.title || file.name.replace(/\.[^/.]+$/, '')
                                                }));
                                            }
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            e.target.value = null;
                                        }}
                                        className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer"
                                    />
                                    {(() => {
                                        if (!uploadForm.file) {
                                            return (
                                                <div className="z-0 py-1">
                                                    <i className="ti ti-cloud-upload text-2xl text-accent mb-1 block" />
                                                    <p className="text-xs font-semibold text-slate-700">Tap here to choose file / take photo</p>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">PDF, Images (JPG, PNG, WebP) up to 10MB</p>
                                                </div>
                                            );
                                        }

                                        const cleanPreviewName = formatCleanDocumentFileName(
                                            uploadForm.title || uploadForm.documentType || 'document',
                                            uploadForm.file.name
                                        );
                                        const isImage = isImageFile(uploadForm.file.name);
                                        const isPdf = uploadForm.file.type === 'application/pdf' || uploadForm.file.name.toLowerCase().endsWith('.pdf');

                                        return (
                                            <div className="w-full flex items-center gap-3 text-left z-0 p-1">
                                                <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center shadow-2xs">
                                                    {isImage ? (
                                                        <img
                                                            src={URL.createObjectURL(uploadForm.file)}
                                                            alt="Preview"
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : isPdf ? (
                                                        <div className="flex flex-col items-center justify-center text-rose-600">
                                                            <i className="ti ti-file-type-pdf text-2xl leading-none" />
                                                            <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">PDF</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center justify-center text-slate-500">
                                                            <i className={`ti ${getFileMeta(uploadForm.file.name).icon} text-2xl leading-none ${getFileMeta(uploadForm.file.name).color}`} />
                                                            <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">FILE</span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                                                            <i className="ti ti-wand text-[10px]" />
                                                            Auto-renamed to
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 font-medium">({formatFileSize(uploadForm.file.size)})</span>
                                                    </div>
                                                    <p className="text-xs font-bold text-slate-800 font-mono truncate" title={cleanPreviewName}>
                                                        {cleanPreviewName}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 truncate mt-0.5" title={uploadForm.file.name}>
                                                        Original: {uploadForm.file.name}
                                                    </p>
                                                    <p className="text-[10px] text-accent font-semibold mt-1">Tap to change file</p>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => { setShowUploadModal(false); resetUploadForm(); }}
                                    disabled={isUploading}
                                    className="h-9 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors duration-100 disabled:opacity-50 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isUploading || !uploadForm.file}
                                    className="h-9 px-4 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-md text-xs font-medium transition-colors duration-100 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    {isUploading ? (
                                        <>
                                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <i className="ti ti-upload" /> Submit Document
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Authenticator Setup & Backup Codes Modal */}
            {showTotpModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                    <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="h-9 w-9 rounded-md bg-slate-900 text-white flex items-center justify-center shadow-2xs">
                                    <i className="ti ti-shield-lock text-lg" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm">
                                        {totpStep === 1 ? 'Configure Google Authenticator' : 'Emergency Backup Codes'}
                                    </h3>
                                    <p className="text-[11px] text-slate-500">
                                        {totpStep === 1 ? 'Scan QR code with your authenticator app' : 'Store these codes in a secure location'}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowTotpModal(false)}
                                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
                            >
                                <i className="ti ti-x text-lg" />
                            </button>
                        </div>

                        {totpStep === 1 && totpSetupData && (
                            <div className="p-5 sm:p-6 space-y-4">
                                <div className="flex justify-center p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                    <QRCode value={totpSetupData.uri} size={160} />
                                </div>

                                <div className="space-y-1">
                                    <label className="block text-[11px] font-semibold text-slate-600">
                                        Secret Key (Manual Entry)
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            readOnly
                                            value={totpSetupData.secret}
                                            className="w-full h-8 px-2.5 bg-slate-100 border border-slate-200 rounded-md text-xs font-mono font-semibold text-slate-800 select-all"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                navigator.clipboard.writeText(totpSetupData.secret);
                                                toast.success('Secret key copied to clipboard');
                                            }}
                                            className="h-8 px-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md shadow-2xs shrink-0 cursor-pointer"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>

                                <form onSubmit={handleConfirmTotp} className="space-y-3 pt-2 border-t border-slate-100">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-800 mb-1">
                                            Enter 6-digit confirmation code:
                                        </label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={6}
                                            placeholder="000000"
                                            value={totpVerifyCode}
                                            onChange={(e) => setTotpVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            className="w-full h-10 text-center font-mono font-bold text-lg tracking-widest bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-slate-500 shadow-2xs"
                                            autoFocus
                                        />
                                    </div>

                                    <div className="flex items-center justify-end gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setShowTotpModal(false)}
                                            className="h-9 px-3.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-md text-xs font-medium cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={totpSubmitting || totpVerifyCode.length !== 6}
                                            className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-2xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                                        >
                                            {totpSubmitting ? (
                                                <>
                                                    <i className="ti ti-loader-2 animate-spin text-sm" />
                                                    <span>Verifying...</span>
                                                </>
                                            ) : (
                                                <span>Confirm &amp; Enable</span>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}

                        {totpStep === 2 && (
                            <div className="p-5 sm:p-6 space-y-4">
                                <div className="p-3 bg-surface-muted border border-line rounded-md text-xs text-ink flex items-start gap-2">
                                    <i className="ti ti-circle-check text-ink text-base shrink-0 mt-0.5" />
                                    <div>
                                        <span className="font-bold text-ink block">Authenticator 2FA Activated</span>
                                        <span className="text-[11px] text-ink leading-relaxed block mt-0.5">
                                            Save these 8 single-use emergency backup recovery codes. If you lose access to your authenticator app, each code can be used once to regain access.
                                        </span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 p-3 bg-slate-100 rounded-md border border-slate-200 font-mono text-xs font-bold text-slate-900">
                                    {totpBackupCodes.map((code, idx) => (
                                        <div key={idx} className="p-1.5 bg-white rounded border border-slate-200 text-center tracking-wider">
                                            {code}
                                        </div>
                                    ))}
                                </div>

                                <div className="flex items-center justify-between pt-2">
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handleDownloadBackupCodes}
                                            className="h-8 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md shadow-2xs flex items-center gap-1 cursor-pointer"
                                        >
                                            <i className="ti ti-download text-xs" />
                                            <span>Download .txt</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                navigator.clipboard.writeText(totpBackupCodes.join('\n'));
                                                toast.success('Backup codes copied');
                                            }}
                                            className="h-8 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md shadow-2xs flex items-center gap-1 cursor-pointer"
                                        >
                                            <i className="ti ti-copy text-xs" />
                                            <span>Copy All</span>
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setShowTotpModal(false)}
                                        className="h-8 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md shadow-2xs cursor-pointer"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Reconfigure Confirmation Modal */}
            {showReconfigureModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                    <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 rounded-md bg-slate-100 text-slate-800 flex items-center justify-center">
                                    <i className="ti ti-refresh text-base" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm">Reconfigure 2FA</h3>
                                    <p className="text-[11px] text-slate-500">Pair a new authenticator device</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowReconfigureModal(false)}
                                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <p className="text-xs text-slate-600 leading-relaxed">
                                Generating a new QR code will replace your existing Google Authenticator key. For security, please confirm your account password.
                            </p>
                            <div className="space-y-1 pt-1">
                                <label className="block text-[11px] font-semibold text-slate-700">
                                    Account Password (Required)
                                </label>
                                <input
                                    type="password"
                                    value={reconfigurePassword}
                                    onChange={(e) => setReconfigurePassword(e.target.value)}
                                    placeholder="Enter your current password"
                                    className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-300 focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                />
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowReconfigureModal(false)}
                                className="h-8 px-3 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-md shadow-2xs cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!reconfigurePassword.trim()) {
                                        toast.error('Please enter your account password.');
                                        return;
                                    }
                                    executeTotpSetup(reconfigurePassword.trim());
                                }}
                                disabled={totpSubmitting}
                                className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-md shadow-2xs cursor-pointer flex items-center gap-1.5"
                            >
                                {totpSubmitting ? (
                                    <>
                                        <i className="ti ti-loader-2 animate-spin text-xs" />
                                        <span>Verifying...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Proceed to Setup</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Disable 2FA Confirmation Modal */}
            {showDisableModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                    <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 rounded-md bg-danger-subtle text-danger-ink flex items-center justify-center">
                                    <i className="ti ti-alert-triangle text-base" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm">Disable Authenticator 2FA</h3>
                                    <p className="text-[11px] text-slate-500">Step-up security verification</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDisableModal(false)}
                                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            <p className="text-xs text-slate-600 leading-relaxed">
                                Enter your account password or emergency backup code to confirm deactivation.
                            </p>
                            <div className="space-y-1">
                                <label className="block text-[11px] font-semibold text-slate-700">
                                    Account Password (Recommended)
                                </label>
                                <input
                                    type="password"
                                    value={disablePassword}
                                    onChange={(e) => setDisablePassword(e.target.value)}
                                    placeholder="Enter your account password"
                                    className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-300 focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                />
                            </div>
                            <div className="relative flex py-0.5 items-center">
                                <div className="grow border-t border-slate-200"></div>
                                <span className="shrink mx-2 text-[10px] uppercase font-bold text-slate-400">or</span>
                                <div className="grow border-t border-slate-200"></div>
                            </div>
                            <div className="space-y-1">
                                <label className="block text-[11px] font-semibold text-slate-700">
                                    Emergency Backup Code or Token
                                </label>
                                <input
                                    type="text"
                                    value={disableCode}
                                    onChange={(e) => setDisableCode(e.target.value)}
                                    placeholder="e.g. CP-XXXX-XXXX or 6-digit token"
                                    className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-300 focus:outline-hidden focus:ring-1 focus:ring-slate-900 font-mono"
                                />
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowDisableModal(false)}
                                disabled={totpSubmitting}
                                className="h-8 px-3 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-md shadow-2xs cursor-pointer"
                            >
                                Keep 2FA
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDisableTotp}
                                disabled={totpSubmitting}
                                className="h-8 px-3.5 bg-danger hover:bg-danger-ink disabled:opacity-50 text-white text-xs font-semibold rounded-md shadow-2xs cursor-pointer flex items-center gap-1.5"
                            >
                                {totpSubmitting ? (
                                    <>
                                        <i className="ti ti-loader-2 animate-spin text-xs" />
                                        <span>Disabling...</span>
                                    </>
                                ) : (
                                    <span>Confirm &amp; Disable</span>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Change Administrative Password Modal */}
            {showChangePasswordModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 overflow-y-auto">
                    <div className="bg-white rounded-lg p-5 sm:p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20">
                                    <i className="ti ti-key text-base" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">Change Password</h3>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => !isChangingPassword && setShowChangePasswordModal(false)}
                                className="h-8 w-8 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    Current Password <span className="text-danger-ink">*</span>
                                </label>
                                <input
                                    type="password"
                                    required
                                    autoComplete="current-password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    placeholder="Enter current password"
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    New Password <span className="text-danger-ink">*</span>
                                </label>
                                <input
                                    type="password"
                                    required
                                    minLength={8}
                                    autoComplete="new-password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Enter new password (min. 8 characters)"
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    Confirm New Password <span className="text-danger-ink">*</span>
                                </label>
                                <input
                                    type="password"
                                    required
                                    minLength={8}
                                    autoComplete="new-password"
                                    value={confirmNewPassword}
                                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                                    placeholder="Re-enter new password"
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                                />
                            </div>

                            {/* Multi-Factor Verification & Anti-Brute-Force Shield */}
                            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                                        <i className="ti ti-shield-lock text-accent text-sm" />
                                        <span>Multi-Factor Verification</span>
                                    </div>
                                </div>
                                <p className="text-[11px] text-slate-500 leading-relaxed">
                                    Enter the 6-digit code sent to your email or from your Google Authenticator app.
                                </p>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        required
                                        maxLength={14}
                                        value={passwordOtp}
                                        onChange={(e) => setPasswordOtp(e.target.value.toUpperCase())}
                                        placeholder="e.g. 123456 or CP-XXXX"
                                        className="flex-1 h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 font-mono transition-colors shadow-2xs"
                                    />
                                    <button
                                        type="button"
                                        disabled={isSendingOtp || otpCooldown > 0}
                                        onClick={handleRequestPasswordOtp}
                                        className="h-9 px-3 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 text-xs font-semibold rounded-md border border-slate-300 transition-colors shrink-0 shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        {isSendingOtp ? (
                                            <>
                                                <i className="ti ti-loader-2 animate-spin text-xs" />
                                                <span>Sending...</span>
                                            </>
                                        ) : otpCooldown > 0 ? (
                                            <>
                                                <i className="ti ti-clock text-xs" />
                                                <span>Resend ({otpCooldown}s)</span>
                                            </>
                                        ) : (
                                            <>
                                                <i className="ti ti-mail-forward text-xs" />
                                                <span>Send Email Code</span>
                                            </>
                                        )}
                                    </button>
                                </div>

                                {attemptsRemaining !== null && attemptsRemaining < 5 && (
                                    <div className="p-2 rounded-md bg-warning-subtle border border-warning/20 text-[11px] text-warning-ink flex items-center gap-1.5 font-medium">
                                        <i className="ti ti-shield-alert text-sm" />
                                        <span>Brute-force shield: {attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining before 15-min lockout.</span>
                                    </div>
                                )}

                                {otpError && (
                                    <div className="p-2 rounded-md bg-danger-subtle border border-danger/20 text-[11px] text-danger-ink flex items-center gap-1.5 font-medium">
                                        <i className="ti ti-alert-circle text-sm" />
                                        <span>{otpError}</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                                <button
                                    type="button"
                                    disabled={isChangingPassword}
                                    onClick={() => setShowChangePasswordModal(false)}
                                    className="h-8 px-3.5 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-md border border-slate-200 transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isChangingPassword}
                                    className="h-8 px-4 bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-white text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                                >
                                    {isChangingPassword ? (
                                        <>
                                            <i className="ti ti-loader-2 animate-spin text-xs" />
                                            <span>Updating...</span>
                                        </>
                                    ) : (
                                        <>
                                            <i className="ti ti-check text-xs" />
                                            <span>Update Password</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <DocumentPreviewModal
                isOpen={Boolean(activePreviewDoc)}
                onClose={() => setActivePreviewDoc(null)}
                document={activePreviewDoc}
                isAdmin={false}
            />
        </div>
    );
}
