import { useState, useRef, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../utils/api';
import EmployeeAvatar from '../../components/EmployeeAvatar';
import QRCode from '../../components/QRCode';
import { supabase } from '../../supabaseClient';
import { getDisciplinaryCache } from '../../utils/disciplinaryCache';

const CATEGORIES = ['General', 'Government ID', 'Educational', 'Medical', 'Clearance', 'Contract / Agreement'];
const EXPIRABLE_CATEGORIES = ['Government ID', 'Clearance'];
const EXPIRY_WARNING_DAYS = 30;

export default function MyProfile() {
    const queryClient = useQueryClient();

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
    const [showDisableModal, setShowDisableModal] = useState(false);
    const [disableCode, setDisableCode] = useState('');
    const [totpSetupData, setTotpSetupData] = useState(null);
    const [totpVerifyCode, setTotpVerifyCode] = useState('');
    const [totpSubmitting, setTotpSubmitting] = useState(false);
    const [totpBackupCodes, setTotpBackupCodes] = useState([]);
    const [totpStep, setTotpStep] = useState(1); // 1 = QR & Code, 2 = Backup Codes

    const fetchTotpStatus = async (uid) => {
        try {
            const targetId = uid || storedUser?.id || storedUser?.email || '';
            const url = targetId
                ? `/api/auth/totp/status?identifier=${encodeURIComponent(targetId)}`
                : '/api/auth/totp/status';
            const res = await fetchWithAuth(url);
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
        fetchTotpStatus(storedUser?.id || storedUser?.email);
    }, [storedUser?.id, storedUser?.email]);

    const executeTotpSetup = async () => {
        setTotpSubmitting(true);
        try {
            const res = await fetchWithAuth('/api/auth/totp/setup', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to start authenticator setup.');
            }
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
            fetchTotpStatus(storedUser?.id || storedUser?.email);
        } catch (err) {
            toast.error(err.message || 'Invalid code.');
        } finally {
            setTotpSubmitting(false);
        }
    };

    const handleConfirmDisableTotp = async (e) => {
        e?.preventDefault();
        setTotpSubmitting(true);
        try {
            const payload = disableCode.trim() ? { code: disableCode.trim() } : {};
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
            setDisableCode('');
            fetchTotpStatus(storedUser?.id || storedUser?.email);
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

    const initialUser = useMemo(() => {
        if (!storedUser) return null;
        return {
            id: storedUser.id || storedUser.user_id,
            company_id: storedUser.company_id || storedUser.employee_id || storedUser.emp_id || 'CP-MAIN',
            first_name: storedUser.first_name || (storedUser.name ? storedUser.name.split(' ')[0] : ''),
            last_name: storedUser.last_name || (storedUser.name ? storedUser.name.split(' ').slice(1).join(' ') : ''),
            email: storedUser.email || 'N/A',
            phone: storedUser.phone || storedUser.contact_no || '',
            gender: storedUser.gender || 'N/A',
            birth_date: storedUser.birth_date || null,
            address: storedUser.address || '',
            department: storedUser.department || 'Operations',
            job_title: storedUser.job_title || storedUser.position || 'Staff Member',
            status: storedUser.status || 'active',
            is_active: storedUser.is_active ?? true,
            created_at: storedUser.created_at || null,
            avatar_url: storedUser.avatar_url || storedUser.photo_url || null,
            photo_url: storedUser.photo_url || storedUser.avatar_url || null,
            has_registered_biometrics: storedUser.has_registered_biometrics ?? true,
            medical_record_url: storedUser.medical_record_url || null,
        };
    }, [storedUser]);

    const currentUserId = initialUser?.id;
    const cacheStorageKey = currentUserId ? `cpoint_my_profile_cache_${currentUserId}` : 'cpoint_my_profile_cache';

    // Query profile and documents with 0ms SWR session cache scoped strictly to the authenticated user ID
    const initialProfileData = (() => {
        try {
            const cachedRaw = sessionStorage.getItem(cacheStorageKey);
            if (cachedRaw) {
                const cached = JSON.parse(cachedRaw);
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
                    sessionStorage.setItem(cacheStorageKey, JSON.stringify(profileResponse));
                }
            } catch (_) {}
        }
    }, [profileResponse, cacheStorageKey, currentUserId]);

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
            medical_record_url: raw.medical_record_url || initialUser?.medical_record_url || null,
            archived_at: raw.archived_at || initialUser?.archived_at || null,
            separation_date: raw.separation_date || initialUser?.separation_date || null,
            separation_type: raw.separation_type || initialUser?.separation_type || null,
            separation_reason: raw.separation_reason || initialUser?.separation_reason || null,
            separation_notes: raw.separation_notes || initialUser?.separation_notes || null,
            operational_status: raw.operational_status || initialUser?.operational_status || null,
            is_terminated: raw.is_terminated ?? initialUser?.is_terminated ?? false,
        };
    }, [raw, initialUser]);

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

    const documents = profileResponse?.documents || [];
    const disciplinaryLogs = profileResponse?.disciplinary_logs || [];
    const isLoading = isQueryLoading && !profile;
    const [docSearch, setDocSearch] = useState('');
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

    const activeSuspensionLog = disciplinaryLogs.find(l => (l.type === 'Suspension' || l.action_taken === 'Suspension') && l.status !== 'Resolved' && l.status !== 'Overturned' && l.status !== 'Dismissed');
    const activeTerminationLog = disciplinaryLogs.find(l => (l.type === 'Termination' || l.action_taken === 'Termination') && l.status !== 'Resolved' && l.status !== 'Overturned' && l.status !== 'Dismissed');

    const isSuspended = !Boolean(activeTerminationLog) && Boolean(
        activeSuspensionLog ||
        disciplinaryState?.isSuspended ||
        profile?.status === 'suspended' ||
        profile?.operational_status === 'Suspended' ||
        profile?.is_suspended
    );

    const isTerminated = !isSuspended && Boolean(
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

    // Modal & Upload States
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadForm, setUploadForm] = useState({
        title: '',
        category: 'General',
        expiryDate: '',
        file: null
    });

    const resetUploadForm = () => {
        setUploadForm({ title: '', category: 'General', expiryDate: '', file: null });
    };

    const openUploadModal = (file = null) => {
        if (isTerminated) {
            toast.error('Document uploads are disabled for separated/terminated accounts.');
            return;
        }
        if (file) setUploadForm((prev) => ({ ...prev, file, title: prev.title || file.name.replace(/\.[^/.]+$/, '') }));
        setShowUploadModal(true);
    };

    const handleUploadSubmit = async (e) => {
        e.preventDefault();

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
            const formData = new FormData();
            formData.append('employee_id', profile.id);
            formData.append('title', uploadForm.title);
            formData.append('category', uploadForm.category);
            if (uploadForm.expiryDate) formData.append('expiry_date', uploadForm.expiryDate);
            formData.append('file', uploadForm.file);

            const res = await fetchWithAuth('/api/employee-documents', {
                method: 'POST',
                body: formData
            });

            const rawText = await res.text();
            let data = {};
            try {
                data = JSON.parse(rawText);
            } catch {
                console.error('Server response non-JSON:', rawText);
            }

            if (res.ok && (data.success || data.document)) {
                toast.success('Document uploaded successfully!');
                setShowUploadModal(false);
                resetUploadForm();
                queryClient.invalidateQueries({ queryKey: ['myProfile'] });
            } else {
                toast.error(data.message || data.error || `Upload failed with status ${res.status}`);
            }
        } catch (err) {
            console.error('Document upload error:', err);
            toast.error(err.message || 'Error uploading document');
        } finally {
            setIsUploading(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const formatFileSize = (bytes) => {
        if (!bytes) return '';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const getFileMeta = (fileName = '') => {
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        switch (ext) {
            case 'pdf':
                return { icon: 'ti-file-type-pdf', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-100' };
            case 'doc':
            case 'docx':
                return { icon: 'ti-file-type-docx', color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-100' };
            case 'xls':
            case 'xlsx':
                return { icon: 'ti-file-type-xls', color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-100' };
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'heic':
                return { icon: 'ti-photo', color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-100' };
            default:
                return { icon: 'ti-file', color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-100' };
        }
    };

    const isImageFile = (fileName = '') => ['png', 'jpg', 'jpeg', 'heic', 'webp'].includes((fileName.split('.').pop() || '').toLowerCase());

    const getExpiryStatus = (doc) => {
        const expiryDate = doc.expiry_date || doc.expiryDate;
        if (!expiryDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(expiryDate);
        const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) return { level: 'expired', label: `Expired ${Math.abs(daysLeft)}d ago`, daysLeft };
        if (daysLeft <= EXPIRY_WARNING_DAYS) return { level: 'warning', label: `Expires in ${daysLeft}d`, daysLeft };
        return { level: 'valid', label: `Valid · exp. ${formatDate(expiryDate)}`, daysLeft };
    };

    const expiryBadgeStyles = {
        expired: 'bg-rose-50 text-rose-600 border-rose-200',
        warning: 'bg-amber-50 text-amber-600 border-amber-200',
        valid: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    };

    const alerts = useMemo(() => {
        return documents
            .map((doc) => ({ doc, status: getExpiryStatus(doc) }))
            .filter(({ status }) => status && status.level !== 'valid')
            .sort((a, b) => a.status.daysLeft - b.status.daysLeft);
    }, [documents]);

    const filteredDocuments = useMemo(() => {
        const q = docSearch.toLowerCase().trim();
        if (!q) return documents;
        return documents.filter((doc) =>
            (doc.title || '').toLowerCase().includes(q) || (doc.file_name || '').toLowerCase().includes(q)
        );
    }, [documents, docSearch]);

    const showExpiryField = EXPIRABLE_CATEGORIES.includes(uploadForm.category);

    const handleDragEnter = (e) => {
        e.preventDefault();
        if (isTerminated) return;
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
                <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
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
                <div className="fixed inset-0 z-[60] bg-blue-950/20 flex items-center justify-center pointer-events-none">
                    <div className="bg-white rounded-lg shadow-xl border-2 border-dashed border-blue-500 px-10 py-8 flex flex-col items-center">
                        <i className="ti ti-cloud-upload text-4xl text-blue-600 mb-2" />
                        <p className="font-bold text-slate-800 text-sm uppercase tracking-wider">Drop to Upload</p>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">Attach to your documents</p>
                    </div>
                </div>
            )}

            {/* Profile header */}
            <div className="bg-slate-900 rounded-lg p-5 sm:p-7 border border-slate-800 text-white shadow-2xs relative">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
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
                            {isTerminated && (
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-md border ${
                                    isPendingArchive 
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' 
                                        : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                                }`}>
                                    <i className={`ti ${isPendingArchive ? 'ti-clock-pause' : 'ti-circle-x'}`} />
                                    {isPendingArchive ? `Pending Archive (${daysUntilPermanentArchive}d)` : 'Separated'}
                                </span>
                            )}
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-800 text-slate-200 text-xs font-mono font-bold rounded-md border border-slate-700">
                                <i className="ti ti-id text-slate-400" /> {profile?.company_id || 'EMPLOYEE'}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-500/20 text-blue-300 text-xs font-semibold rounded-md border border-blue-500/30">
                                {profile?.department || 'Operations'}
                            </span>
                            {(profile?.department || '').toLowerCase().includes('factory') ? (
                                <>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-500/20 text-amber-300 text-xs font-semibold rounded-md border border-amber-500/30">
                                        Factory (08:00 - 17:00 • No OT)
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-purple-500/20 text-purple-300 text-xs font-semibold rounded-md border border-purple-500/30">
                                        Piece-Rate Production
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-500/20 text-blue-300 text-xs font-semibold rounded-md border border-blue-500/30">
                                        Regular (08:00 - 20:00 • OT Eligible)
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs font-semibold rounded-md border border-emerald-500/30">
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

                    <div className="flex sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
                        {alerts.length > 0 && (
                            <div className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-md text-xs font-semibold">
                                <i className="ti ti-alert-triangle text-amber-400 text-sm" /> {alerts.length} Doc{alerts.length > 1 ? 's' : ''} Need Attention
                            </div>
                        )}
                        {isTerminated ? (
                            <span className="w-full sm:w-auto h-9 px-3.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-not-allowed select-none">
                                <i className="ti ti-lock text-sm" /> Uploads Disabled
                            </span>
                        ) : (
                            <button
                                onClick={() => openUploadModal()}
                                className="w-full sm:w-auto h-9 px-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium transition-colors duration-100 shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <i className="ti ti-upload text-sm" /> Upload Document
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Disciplinary Suspension Notification */}
            {isSuspended && !isPendingArchive && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs">
                    <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-amber-100 text-amber-800 rounded-md shrink-0 mt-0.5">
                            <i className="ti ti-lock-exclamation text-xl" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h4 className="font-bold text-amber-950 text-sm">Disciplinary Suspension Active</h4>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold rounded-md">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                                    Operational Hold
                                </span>
                            </div>
                            <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                                Under DOLE policy ("No Work, No Pay"), gate access and attendance logging are temporarily on hold. You retain access to review your documents and official records.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Pending Archive Clearance Notification */}
            {isPendingArchive && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs">
                    <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-amber-100 text-amber-800 rounded-md shrink-0 mt-0.5">
                            <i className="ti ti-hourglass-empty text-xl animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h4 className="font-bold text-amber-950 text-sm">Account in Clearance Cooldown</h4>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold rounded-md">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                                    {daysUntilPermanentArchive} Days Left
                                </span>
                            </div>
                            <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                                Your employment profile has been queued for archival ({profile?.separation_type || 'Separated'}). 
                                {profile?.separation_reason ? ` Reason: "${profile.separation_reason}".` : ''} 
                                Access to biometrics and turnstiles is restricted during clearance. Historical documents remain accessible.
                            </p>
                        </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                        <span className="text-[11px] font-mono font-medium text-amber-700 bg-amber-100/60 px-2.5 py-1 rounded-md border border-amber-200">
                            Clearance Cooldown: 14 Days
                        </span>
                    </div>
                </div>
            )}

            {/* Personal and employment details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                {/* Personal Information */}
                <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                        <div className="h-9 w-9 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
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
                <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                        <div className="h-9 w-9 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
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
                            <span className="inline-flex items-center px-2.5 py-0.5 bg-emerald-50 text-emerald-700 font-semibold text-[11px] rounded-md border border-emerald-200">
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
                                ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                : profile?.has_registered_biometrics 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                            <i className={`ti ${isMedicalExempt ? 'ti-bandage' : 'ti-fingerprint'} text-lg`} />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Gate Access &amp; Face Scan</h3>
                            <p className="text-[11px] text-slate-500">Badge access, face scan status, and medical exemptions</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                            isMedicalExempt 
                                ? 'bg-amber-50 text-amber-900 border-amber-300' 
                                : profile?.has_registered_biometrics 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                : 'bg-blue-50 text-blue-700 border-blue-200'
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
                        <div className="p-4 rounded-md bg-amber-50/50 border border-amber-200 space-y-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-bold text-amber-950 flex items-center gap-1.5">
                                    <i className="ti ti-first-aid-kit text-amber-700 text-sm" />
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
                            <p className="text-amber-800 text-[11px] font-semibold pt-1 flex items-center gap-1.5">
                                <i className="ti ti-info-circle text-amber-700 shrink-0" />
                                <span>Turnstile Instructions: Your Digital Gate Pass QR is authorized for single-step badge access. The turnstile camera logs an evidentiary snapshot automatically. No facial matching required.</span>
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                            <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                                <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Turnstile Mode</p>
                                <p className="font-bold text-slate-800 flex items-center gap-1">
                                    <i className="ti ti-qrcode text-emerald-600" />
                                    QR-Only (Medical Grace)
                                </p>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                                <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Audit Trail</p>
                                <p className="font-bold text-slate-800 flex items-center gap-1">
                                    <i className="ti ti-camera text-blue-600" />
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
                                    className="h-8 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-medium text-xs shadow-2xs transition-colors duration-100 cursor-pointer flex items-center justify-center"
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
                            <p className="font-bold text-emerald-700 flex items-center gap-1">
                                <i className="ti ti-circle-check text-emerald-600" />
                                Verified &amp; Active
                            </p>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                            <p className="text-slate-400 font-bold uppercase text-[10px] mb-0.5">Clock-in Method</p>
                            <p className="font-bold text-slate-800 flex items-center gap-1">
                                <i className="ti ti-shield-check text-blue-600" />
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
                    <div className="p-4 rounded-md bg-blue-50/50 border border-blue-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <p className="font-bold text-blue-900 flex items-center gap-1.5">
                                <i className="ti ti-scan text-blue-600 text-sm" />
                                Face scan setup required
                            </p>
                            <p className="text-blue-700 mt-0.5">
                                Please complete your face scan setup to enable clocking in at company kiosks.
                            </p>
                        </div>
                        <Link
                            to="/biometric-setup"
                            className="h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium text-xs shadow-2xs text-center shrink-0 transition-colors duration-100 cursor-pointer flex items-center justify-center"
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
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                            <i className="ti ti-shield-lock text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Two-Factor Authentication (2FA)</h3>
                            <p className="text-[11px] text-slate-500">Hardware &amp; app-based TOTP (Google Authenticator, Microsoft Authenticator, 1Password)</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                            totpStatus.enabled 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
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
                        <p className="text-slate-500 mt-0.5 leading-relaxed">
                            {totpStatus.enabled
                                ? `Active protection replaces SMS delays with instant 30-second rotating cryptographic tokens. ${totpStatus.remainingCodes || 0} backup codes available.`
                                : 'Replaces SMS verification. Eliminates telco delivery delays, network carrier fees, and SIM-swapping risks.'}
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
                                    className="h-8 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md font-medium text-xs shadow-2xs transition-colors cursor-pointer"
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
                        <div className="h-9 w-9 rounded-md bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                            <i className="ti ti-scale text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Policy &amp; Incident Reports</h3>
                            <p className="text-[11px] text-slate-500">Documented workplace incidents, written notices, and current standing</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                            isTerminated ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            isSuspended ? 'bg-amber-50 text-amber-800 border-amber-200' :
                            disciplinaryLogs.some(l => l.status === 'Active') ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            'bg-emerald-50 text-emerald-700 border-emerald-200'
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
                    <div className="flex flex-col sm:flex-row items-center gap-3.5 p-4 rounded-md bg-emerald-50/50 border border-emerald-200 text-xs">
                        <div className="w-8 h-8 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
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
                                    className={`p-4 rounded-md border text-xs transition-colors duration-100 ${
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
                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
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
                                                className="h-7 px-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md text-[10px] uppercase transition-colors duration-100 shrink-0 flex items-center justify-center shadow-2xs"
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

            {/* 201 documents */}
            <div className="space-y-4">
                {alerts.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 sm:p-5 shadow-2xs">
                        <div className="flex items-start gap-3">
                            <div className="h-8 w-8 shrink-0 bg-amber-100 text-amber-700 rounded-md flex items-center justify-center">
                                <i className="ti ti-alert-triangle text-base" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs sm:text-sm font-bold text-amber-900">
                                    {alerts.length} document{alerts.length > 1 ? 's need' : ' needs'} renewal
                                </p>
                                <p className="text-xs text-amber-700 font-medium mt-0.5">Please update or submit renewals before the expiry date.</p>
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
                        <div className="mb-5 p-4 rounded-md bg-rose-50 border border-rose-200 flex items-start gap-3.5">
                            <div className="w-8 h-8 rounded-md bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
                                <i className="ti ti-lock text-base font-bold" />
                            </div>
                            <div className="text-xs">
                                <p className="font-bold text-rose-950 uppercase tracking-wide">Personnel Vault Locked · Read-Only Access</p>
                                <p className="text-rose-800/90 mt-0.5 leading-relaxed font-medium">
                                    Official employment contract has concluded. Document uploads and file modifications are disabled. Historical 201 records remain preserved below for your personal reference and clearance requirements.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-md bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100">
                                <i className="ti ti-folders text-lg" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 text-sm sm:text-base">Personnel Documents</h3>
                                <p className="text-xs text-slate-500">Government credentials, contracts, and company clearances</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {documents.length > 0 && (
                                <div className="relative">
                                    <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                                    <input
                                        type="text"
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

                    {documents.length === 0 ? (
                        isTerminated ? (
                            <div className="text-center py-10 bg-slate-50 rounded-md border border-dashed border-slate-200 space-y-2">
                                <i className="ti ti-folder-off text-3xl text-slate-400 block" />
                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">No 201 documents on file</p>
                                    <p className="text-[11px] text-slate-500">Document uploads are locked for separated employee accounts.</p>
                                </div>
                            </div>
                        ) : (
                            <div
                                onClick={() => openUploadModal()}
                                className="text-center py-10 bg-slate-50 rounded-md border-2 border-dashed border-slate-200 space-y-2.5 cursor-pointer hover:border-slate-300 hover:bg-slate-100/50 transition-colors duration-100"
                            >
                                <i className="ti ti-folder-plus text-3xl text-slate-400 block" />
                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">No 201 documents uploaded yet</p>
                                    <p className="text-[11px] text-slate-500">Click here or drag files to upload government IDs and certificates.</p>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); openUploadModal(); }}
                                    className="h-8 px-3 bg-blue-600 text-white hover:bg-blue-700 rounded-md text-xs font-medium transition-colors duration-100 inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
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
                                const fileUrl = doc.file_path?.startsWith('http')
                                    ? doc.file_path
                                    : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/documents/${doc.file_path}`;

                                return (
                                    <div key={doc.id} className="p-3.5 rounded-md border border-slate-200 hover:border-slate-300 transition-colors duration-100 flex items-start gap-3 bg-white">
                                        {isImageFile(doc.file_name) ? (
                                            <div className="h-10 w-10 shrink-0 rounded-md overflow-hidden border border-slate-200">
                                                <img src={fileUrl} alt="" className="h-full w-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className={`h-10 w-10 shrink-0 rounded-md flex items-center justify-center border ${meta.bg} ${meta.color} ${meta.border}`}>
                                                <i className={`ti ${meta.icon} text-lg`} />
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-semibold text-slate-800 truncate" title={doc.title || doc.file_name}>{doc.title || doc.file_name}</p>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                {doc.category && (
                                                    <span className="inline-block px-1.5 py-0.2 bg-slate-100 text-slate-600 font-semibold text-[10px] rounded">
                                                        {doc.category}
                                                    </span>
                                                )}
                                                {status && (
                                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded border text-[10px] font-semibold ${expiryBadgeStyles[status.level]}`}>
                                                        {status.level === 'valid' ? 'Valid' : status.label}
                                                    </span>
                                                )}
                                            </div>
                                            <a
                                                href={fileUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-2 text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1"
                                            >
                                                <i className="ti ti-external-link text-xs" /> View File
                                            </a>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Modal for file upload */}
            {showUploadModal && !isTerminated && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 overflow-y-auto">
                    <div className="bg-white rounded-lg p-5 sm:p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-5 my-auto max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 bg-blue-50 text-blue-600 rounded-md flex items-center justify-center shrink-0 border border-blue-100">
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
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Document Title</label>
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
                                    <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                                    <select
                                        value={uploadForm.category}
                                        onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                                        className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none cursor-pointer"
                                    >
                                        {CATEGORIES.map((cat) => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">
                                        Expiry Date {!showExpiryField && <span className="font-normal text-slate-400">(opt)</span>}
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
                                    {uploadForm.file && isImageFile(uploadForm.file.name) ? (
                                        <div className="flex items-center gap-2.5 justify-center z-0">
                                            <img
                                                src={URL.createObjectURL(uploadForm.file)}
                                                alt=""
                                                className="h-12 w-12 rounded-md object-cover border border-slate-200"
                                            />
                                            <div className="text-left">
                                                <p className="text-xs font-semibold text-slate-800 truncate max-w-[180px]">{uploadForm.file.name}</p>
                                                <p className="text-[10px] text-slate-500">{formatFileSize(uploadForm.file.size)}</p>
                                                <p className="text-[10px] text-blue-600 font-semibold mt-0.5">Tap to change file</p>
                                            </div>
                                        </div>
                                    ) : uploadForm.file ? (
                                        <div className="z-0">
                                            <i className={`ti ${getFileMeta(uploadForm.file.name).icon} text-2xl ${getFileMeta(uploadForm.file.name).color} mb-1 block`} />
                                            <p className="text-xs font-semibold text-slate-800 truncate max-w-[200px] mx-auto">{uploadForm.file.name}</p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">{formatFileSize(uploadForm.file.size)}</p>
                                            <p className="text-[10px] text-blue-600 font-semibold mt-0.5">Tap to change file</p>
                                        </div>
                                    ) : (
                                        <div className="z-0">
                                            <i className="ti ti-cloud-upload text-2xl text-blue-600 mb-1 block" />
                                            <p className="text-xs font-semibold text-slate-700">Tap here to choose file / take photo</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">PDF, Images (JPG, PNG) up to 10MB</p>
                                        </div>
                                    )}
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
                                    className="h-9 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md text-xs font-medium transition-colors duration-100 shadow-2xs flex items-center gap-1.5 cursor-pointer"
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
                                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 flex items-start gap-2">
                                    <i className="ti ti-circle-check text-emerald-600 text-base shrink-0 mt-0.5" />
                                    <div>
                                        <span className="font-bold text-emerald-900 block">Authenticator 2FA Activated</span>
                                        <span className="text-[11px] text-emerald-700 leading-relaxed block mt-0.5">
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
                                Generating a new QR code will replace your existing Google Authenticator key. Once you confirm the new setup, your old 6-digit codes will no longer work.
                            </p>
                            <p className="text-[11px] text-slate-500 font-medium">
                                Do you want to proceed and generate a new QR code?
                            </p>
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
                                    setShowReconfigureModal(false);
                                    executeTotpSetup();
                                }}
                                className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md shadow-2xs cursor-pointer flex items-center gap-1.5"
                            >
                                <span>Proceed to Setup</span>
                                <i className="ti ti-arrow-right text-xs" />
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
                                <div className="h-8 w-8 rounded-md bg-rose-50 text-rose-600 flex items-center justify-center">
                                    <i className="ti ti-alert-triangle text-base" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm">Disable Authenticator 2FA</h3>
                                    <p className="text-[11px] text-slate-500">Deactivate two-factor protection</p>
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
                                Are you sure you want to disable Authenticator 2FA? This will remove two-factor security from your account and return you to standard password login.
                            </p>
                            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-800 flex items-start gap-2">
                                <i className="ti ti-info-circle text-amber-600 text-sm shrink-0 mt-0.5" />
                                <span>If you deleted your Google Authenticator app or switched phones, you can confirm directly below to remove 2FA.</span>
                            </div>
                            <div className="space-y-1 pt-1">
                                <label className="block text-[11px] font-semibold text-slate-600">
                                    Emergency Backup Code or Current Code (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={disableCode}
                                    onChange={(e) => setDisableCode(e.target.value)}
                                    placeholder="e.g. CP-XXXX-XXXX or 6-digit code"
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
                                className="h-8 px-3.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold rounded-md shadow-2xs cursor-pointer flex items-center gap-1.5"
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
        </div>
    );
}