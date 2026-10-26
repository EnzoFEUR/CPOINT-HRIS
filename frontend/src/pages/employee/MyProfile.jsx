import { getArchiveReviewDaysRemaining, getSeparationLabel, isFinalVoluntarySeparation } from '../../../../shared/employmentExit.mjs';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { getActiveMedicalGrace, hasRegisteredFace, medicalGraceDaysRemaining } from '../../../../shared/medicalGrace.mjs';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../utils/api';
import { readProfileCache, writeProfileCache, clearProfileCache } from '../../utils/browserPrivacy.mjs';
import EmployeeAvatar from '../../components/EmployeeAvatar';
import QRCode from '../../components/QRCode';
import { supabase } from '../../supabaseClient';
import { getDisciplinaryCache, setDisciplinaryCache, clearDisciplinaryCache } from '../../utils/disciplinaryCache';
import bannerCover from '../../assets/employee-cover.jpg';
import { sanitizePersonnelText } from '../../../../shared/personnelInput.mjs';
import { PASSWORD_REUSE_MESSAGE, isPasswordReuseError } from '../../../../shared/passwordPolicy.mjs';
import { formatPhDisplay } from '../../utils/phoneUtils';
import { useOtpCooldown } from '../../utils/useOtpCooldown';
import PhilippineAddressSelector from '../../components/PhilippineAddressSelector';


export default function MyProfile() {
    const queryClient = useQueryClient();

    // Reactive current user from storage to instantly sync if session changes
    const [storedUser, setStoredUser] = useState(() => {
        try {
            const raw = localStorage.getItem('user');
            if (raw && raw !== 'undefined') return JSON.parse(raw);
        } catch { /* Best-effort browser cache or fallback lookup. */ }
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
            } catch { /* Best-effort browser cache or fallback lookup. */ }
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
        } catch { /* Best-effort browser cache or fallback lookup. */ }
        return { enabled: false, loading: false, remainingCodes: 0 };
    });
    const [showTotpModal, setShowTotpModal] = useState(false);
    const [showReconfigureModal, setShowReconfigureModal] = useState(false);
    const [reconfigurePassword, setReconfigurePassword] = useState('');
    const [reconfigureCode, setReconfigureCode] = useState('');
    const [managementOtpSending, setManagementOtpSending] = useState(false);
    const { cooldown: managementCooldown, isCooldown: managementIsCooldown, startCooldown: startManagementCooldown } = useOtpCooldown('authenticator_manage_dest_email_' + (storedUser?.email || 'self'));
    const [showDisableModal, setShowDisableModal] = useState(false);
    const [disablePassword, setDisablePassword] = useState('');
    const [disableCode, setDisableCode] = useState('');
    const [totpSetupData, setTotpSetupData] = useState(null);
    const [totpVerifyCode, setTotpVerifyCode] = useState('');
    const [totpSubmitting, setTotpSubmitting] = useState(false);
    const [totpBackupCodes, setTotpBackupCodes] = useState([]);
    const [totpStep, setTotpStep] = useState(1); // 1 = QR & Code, 2 = Backup Codes

    const fetchTotpStatus = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/auth/totp/status');
            const data = await res.json();
            if (res.ok && data.success) {
                setTotpStatus({
                    enabled: Boolean(data.enabled),
                    requiresReenrollment: Boolean(data.requiresReenrollment),
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
                } catch { /* Best-effort browser cache or fallback lookup. */ }
            } else {
                setTotpStatus((prev) => ({ ...prev, loading: false }));
            }
        } catch {
            setTotpStatus((prev) => ({ ...prev, loading: false }));
        }
    }, []);

    // Auto-fetch TOTP status on component mount and whenever user identity changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetches authenticator status asynchronously; browser flags never grant access.
        fetchTotpStatus();
    }, [storedUser?.id, storedUser?.email, fetchTotpStatus]);

    const executeTotpSetup = async (pwd = '') => {
        setTotpSubmitting(true);
        try {
            const bodyPayload = JSON.stringify({ password: pwd, code: reconfigureCode });
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
            setReconfigureCode('');
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
        setReconfigurePassword('');
        setReconfigureCode('');
        setShowReconfigureModal(true);
    };

    const sendManagementOtp = async () => {
        if (managementOtpSending || managementIsCooldown) return;
        setManagementOtpSending(true);
        try {
            const res = await fetchWithAuth('/api/auth/otp/send', { method: 'POST', body: JSON.stringify({ email: storedUser?.email, purpose: 'authenticator_manage' }) });
            const data = await res.json();
            if (!res.ok) { if (data.retry_after) startManagementCooldown(data.retry_after); throw new Error(data.error || 'Unable to send verification email.'); }
            startManagementCooldown(data.cooldown || 60);
            toast.success('Verification email sent.');
        } catch (error) { toast.error(error.message); }
        finally { setManagementOtpSending(false); }
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
        if (!disablePassword || !disableCode.trim()) {
            toast.error('Enter your password and an authenticator, backup, or emailed code.');
            return;
        }
        setTotpSubmitting(true);
        try {
            const payload = {
                password: disablePassword || undefined,
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
            has_registered_biometrics: hasRegisteredFace(storedUser),
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
        } catch { /* Best-effort browser cache or fallback lookup. */ }
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
        } catch { /* Best-effort browser cache or fallback lookup. */ }
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
            } catch { /* Best-effort browser cache or fallback lookup. */ }
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
            has_registered_biometrics: hasRegisteredFace(raw),
            medical_record_url: Object.hasOwn(raw, 'medical_record_url') ? raw.medical_record_url : initialUser?.medical_record_url || null,
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
    const [medicalClock, setMedicalClock] = useState(() => Date.now());
    useEffect(() => { const timer = setInterval(() => setMedicalClock(Date.now()), 60_000); return () => clearInterval(timer); }, []);
    const medicalExemption = getActiveMedicalGrace(profile, medicalClock);
    const isMedicalExempt = Boolean(medicalExemption);
    const daysRemaining = medicalGraceDaysRemaining(medicalExemption, medicalClock) ?? 0;

    const disciplinaryLogs = isAdminAccount ? [] : (profileResponse?.disciplinary_logs || []);
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

    useEffect(() => {
        if (!profile?.id) return;
        const channel = supabase.channel('employment-exit-' + profile.id, { config: { private: true } })
            .on('broadcast', { event: 'EXIT_CHANGED' }, () => queryClient.invalidateQueries({ queryKey: ['myProfile', profile.id] }))
            .subscribe(status => {
                if (status === 'SUBSCRIBED') queryClient.invalidateQueries({ queryKey: ['myProfile', profile.id] });
            });
        return () => { supabase.removeChannel(channel); };
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

    const isSuspended = !isAdminAccount && !activeTerminationLog && Boolean(
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

    const isPendingArchive = isTerminated && (getArchiveReviewDaysRemaining(profile) ?? 0) > 0;
    const daysUntilPermanentArchive = isTerminated ? (getArchiveReviewDaysRemaining(profile) ?? 0) : 0;

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
    const passwordReused = Boolean(currentPassword && newPassword && currentPassword.trim() === newPassword.trim());

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
        if (passwordReused) {
            toast.error(PASSWORD_REUSE_MESSAGE, { id: 'password-reused' });
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
                throw new Error(isPasswordReuseError(data) ? PASSWORD_REUSE_MESSAGE : data.message || 'Failed to update password.');
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
            } catch { /* Best-effort browser cache or fallback lookup. */ }

            queryClient.invalidateQueries({ queryKey: ['myProfile'] });
            toast.success('Personal details securely updated.');
            setShowEditPersonalModal(false);
        } catch (err) {
            toast.error(err.message || 'Failed to save personal details.');
        } finally {
            setIsSavingPersonal(false);
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
        >


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
                            {!isAdminAccount && isTerminated && isFinalVoluntarySeparation(profile) && (
                <div role="status" className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
                    <p className="font-semibold">{getSeparationLabel(profile)} · Records-only account</p>
                    <p className="text-xs mt-1">Your separation is recorded in the employee archive. Attendance and new employment transactions are disabled; permitted historical records and your exit case remain accessible. Final pay and retirement pay are processed separately.</p>
                </div>
            )}

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
                                            {isPendingArchive ? `Archive review (${daysUntilPermanentArchive}d)` : getSeparationLabel(profile)}
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
                        <p className="text-slate-300 font-medium text-xs sm:text-sm mt-0.5 [overflow-wrap:anywhere]">
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

                    <div className="flex flex-wrap sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
                        {isAdminAccount ? (
                            <div className="w-full sm:w-auto h-9 px-3.5 bg-slate-800/90 text-slate-200 border border-slate-700 rounded-md text-xs font-semibold shadow-2xs flex items-center justify-center gap-2 select-none">
                            </div>
                        ) : (
                            <>
                                <Link to="/employee/documents" className="w-full sm:w-auto h-9 px-3.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5"><i className="ti ti-folders text-sm" aria-hidden="true" />Personnel Documents</Link>
                                <Link to="/employee/employment-exit" title="Retirement requests, resignation notices and case history" className="w-full sm:w-auto h-9 px-3.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5"><i className="ti ti-door-exit text-sm" aria-hidden="true" />Employment Exit</Link>
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
                                <h4 className="font-bold text-warning-ink text-sm">Archive Review Pending</h4>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-warning-subtle text-warning-ink border border-warning/20 text-xs font-semibold rounded-md">
                                    <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                                    {daysUntilPermanentArchive} Days Left
                                </span>
                            </div>
                            <p className="text-xs text-warning-ink mt-1 leading-relaxed">
                                Your employment profile has been queued for archival ({profile?.separation_type || 'Separated'}). 
                                {profile?.separation_reason ? ` Reason: "${profile.separation_reason}".` : ''} 
                                Operational access is disabled because separation has been recorded. This internal archive review does not postpone final pay or employment-record requests. Historical documents remain accessible.
                            </p>
                        </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                        <span className="text-[11px] font-mono font-medium text-warning-ink bg-warning-subtle/60 px-2.5 py-1 rounded-md border border-warning/20">
                            Internal archive review window
                        </span>
                    </div>
                </div>
            )}

            {isAdminAccount ? (
                <>
                    {/* Admin Section 1: Personal Identity & Administrative Governance Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                        {/* Personal Information */}
                        <div className="min-w-0 [overflow-wrap:anywhere] bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
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
                                    <p className="font-semibold text-slate-900 break-words [overflow-wrap:anywhere]"><bdi>{profile?.first_name || 'N/A'}</bdi></p>
                                </div>
                                <div>
                                    <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Last Name</p>
                                    <p className="font-semibold text-slate-900 break-words [overflow-wrap:anywhere]"><bdi>{profile?.last_name || 'N/A'}</bdi></p>
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
                <div className="min-w-0 [overflow-wrap:anywhere] bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
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
                            <p className="font-semibold text-slate-900 break-words [overflow-wrap:anywhere]"><bdi>{profile?.first_name || 'N/A'}</bdi></p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Last Name</p>
                            <p className="font-semibold text-slate-900 break-words [overflow-wrap:anywhere]"><bdi>{profile?.last_name || 'N/A'}</bdi></p>
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
                                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 font-semibold text-slate-900 [&>span]:min-w-0 [&>span]:max-w-full">
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
                <div className="min-w-0 [overflow-wrap:anywhere] bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
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
                                    Valid Through: {new Date(medicalExemption.valid_until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                                        maxLength={100}
                                        value={personalForm.first_name}
                                        onChange={(e) => setPersonalForm({ ...personalForm, first_name: sanitizePersonnelText(e.target.value) })}
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
                                        maxLength={100}
                                        value={personalForm.last_name}
                                        onChange={(e) => setPersonalForm({ ...personalForm, last_name: sanitizePersonnelText(e.target.value) })}
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
                                    <h3 className="font-bold text-slate-900 text-sm">{totpStatus.enabled ? 'Reconfigure 2FA' : 'Set Up Authenticator'}</h3>
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
                                Confirm your password to pair an authenticator. Replacing an active authenticator also requires a verification code.
                                {totpStatus.requiresReenrollment && ' For security, pair your device again. Your old authenticator setup was not imported.'}
                            </p>
                            <div className="space-y-1 pt-1">
                                <label className="block text-[11px] font-semibold text-slate-700">
                                    Account Password (Required)
                                </label>
                                <input maxLength={1024}
                                    type="password"
                                    value={reconfigurePassword}
                                    onChange={(e) => setReconfigurePassword(e.target.value)}
                                    placeholder="Enter your current password"
                                    className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-300 focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                />
                            </div>
                            {totpStatus.enabled && <div className="space-y-2">
                                <label htmlFor="reconfigure-verification-code" className="block text-[11px] font-semibold text-slate-700">Authenticator, backup, or emailed code</label>
                                <input id="reconfigure-verification-code" value={reconfigureCode} onChange={e => setReconfigureCode(e.target.value)} maxLength={20} autoComplete="one-time-code" className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-300" />
                                <button type="button" disabled={managementOtpSending || managementIsCooldown} onClick={sendManagementOtp} className="text-xs font-semibold underline disabled:opacity-50">{managementIsCooldown ? 'Resend in ' + managementCooldown + 's' : 'Email me a verification code'}</button>
                            </div>}
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
                                    if (totpStatus.enabled && !reconfigureCode.trim()) { toast.error('Enter a verification code.'); return; }
                                    executeTotpSetup(reconfigurePassword);
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
                                Enter your password and an authenticator, backup, or emailed verification code to confirm deactivation.
                            </p>
                            <div className="space-y-1">
                                <label className="block text-[11px] font-semibold text-slate-700">
                                    Account Password (Required)
                                </label>
                                <input maxLength={1024}
                                    type="password"
                                    value={disablePassword}
                                    onChange={(e) => setDisablePassword(e.target.value)}
                                    placeholder="Enter your account password"
                                    className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-300 focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                />
                            </div>
                            <div className="relative flex py-0.5 items-center">
                                <div className="grow border-t border-slate-200"></div>
                                <span className="shrink mx-2 text-[10px] uppercase font-bold text-slate-400">and</span>
                                <div className="grow border-t border-slate-200"></div>
                            </div>
                            <div className="space-y-1">
                                <label className="block text-[11px] font-semibold text-slate-700">
                                    Authenticator, Backup, or Emailed Code (Required)
                                </label>
                                <input maxLength={14}
                                    type="text"
                                    value={disableCode}
                                    onChange={(e) => setDisableCode(e.target.value)}
                                    placeholder="e.g. CP-XXXX-XXXX or 6-digit token"
                                    className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-300 focus:outline-hidden focus:ring-1 focus:ring-slate-900 font-mono"
                                />
                                <button type="button" disabled={managementOtpSending || managementIsCooldown} onClick={sendManagementOtp} className="text-xs font-semibold underline disabled:opacity-50">{managementIsCooldown ? 'Resend in ' + managementCooldown + 's' : 'Email me a verification code'}</button>
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
                                    maxLength={1024}
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
                                    maxLength={1024}
                                    aria-invalid={passwordReused}
                                    aria-describedby={passwordReused ? 'password-reuse-warning' : undefined}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Enter new password (min. 8 characters)"
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                                />
                                {passwordReused && <p id="password-reuse-warning" role="status" className="mt-1 text-xs text-danger-ink">{PASSWORD_REUSE_MESSAGE}</p>}
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
                                    maxLength={1024}
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
                                    disabled={isChangingPassword || passwordReused}
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


        </div>
    );
}
