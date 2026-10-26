import { useState, useMemo } from 'react';

// Global in-memory cache to remember loaded/failed URLs across component mounts and re-renders
const urlStatusCache = new Map();

// Scalable blank profile silhouette (Facebook / modern enterprise default profile standard)
export const BlankProfilePhoto = ({ className = 'w-full h-full select-none pointer-events-none' }) => (
    <svg
        viewBox="0 0 100 100"
        fill="currentColor"
        className={className}
        aria-hidden="true"
    >
        <circle cx="50" cy="38" r="18" />
        <path d="M 0 100 L 0 92 C 12 72, 30 64, 50 64 C 70 64, 88 72, 100 92 L 100 100 Z" />
    </svg>
);

/**
 * Employee avatar component with photo support and Facebook-style blank profile photo fallback.
 */
export const EmployeeAvatar = ({
    employee = null,
    firstName = '',
    lastName = '',
    name = '',
    employeeName = '',
    companyId = '',
    employeeId = '',
    photoUrl = '',
    avatarUrl = '',
    size = 'h-12 w-12',
    rounded = 'rounded-md',
    theme = 'auto', // 'auto', 'indigo', 'blue', 'amber', 'emerald', 'purple', 'cyan', 'red', 'dark', 'gradient'
    border = 'border border-slate-200',
    shadow = 'shadow-inner',
    className = '',
}) => {
    // 1. Resolve Name
    const resolvedFirstName = firstName || employee?.first_name || '';
    const resolvedLastName = lastName || employee?.last_name || '';
    const resolvedName = name || employeeName || employee?.name || employee?.employee_name || `${resolvedFirstName} ${resolvedLastName}`.trim();

    // 2. Resolve Avatar Image Source URL
    const resolvedAvatarSrc = useMemo(() => {
        const rawPhoto = photoUrl || avatarUrl || employee?.avatar_url || employee?.photo_url || employee?.photo || employee?.profile_picture || employee?.image_url || employee?.biometric_baseline_path;
        if (rawPhoto) {
            const safePhoto = typeof rawPhoto === 'string' ? rawPhoto.trim() : '';
            if (!safePhoto) return null;
            if (safePhoto.startsWith('http') || safePhoto.startsWith('data:')) {
                return safePhoto;
            }
            return `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${safePhoto.replace(/^\/+/, '')}`;
        }
        const cId = companyId || employee?.company_id;
        const eId = employeeId || employee?.id;
        if (cId && eId) {
            return `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${cId}/${eId}.jpg`;
        }
        return null;
    }, [photoUrl, avatarUrl, employee, companyId, employeeId]);

    // 3. Resolve Loading State from Global Cache
    const [imageResult, setImageResult] = useState(null);
    const imgStatus = !resolvedAvatarSrc ? 'failed' : imageResult?.src === resolvedAvatarSrc
        ? imageResult.status : urlStatusCache.get(resolvedAvatarSrc) || 'loading';

    const handleLoad = () => {
        if (resolvedAvatarSrc) {
            urlStatusCache.set(resolvedAvatarSrc, 'loaded');
        }
        setImageResult({ src: resolvedAvatarSrc, status: 'loaded' });
    };

    const handleError = () => {
        if (resolvedAvatarSrc) {
            urlStatusCache.set(resolvedAvatarSrc, 'failed');
        }
        setImageResult({ src: resolvedAvatarSrc, status: 'failed' });
    };

    // 4. Resolve Visual Theme for Blank Profile Background & Silhouette
    const themeClass = useMemo(() => {
        if (theme === 'dark') {
            return 'bg-slate-800 text-slate-500';
        }
        if (theme === 'gradient') {
            return 'bg-accent/15 text-accent';
        }
        return 'bg-slate-200 text-slate-400';
    }, [theme]);

    const isLoaded = imgStatus === 'loaded';
    const isFailed = imgStatus === 'failed';

    return (
        <div 
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); return false; }}
            style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
            className={`relative ${size} ${rounded} overflow-hidden shrink-0 ${border} ${shadow} ${themeClass} flex items-center justify-center select-none ${className}`}
            title={resolvedName || 'Employee profile'}
            aria-label={resolvedName || 'Employee profile'}
        >
            {/* Blank profile photo fallback (Facebook style) */}
            <BlankProfilePhoto className="w-full h-full select-none pointer-events-none" />

            {/* Photo */}
            {resolvedAvatarSrc && !isFailed && (
                <img
                    src={resolvedAvatarSrc}
                    onLoad={handleLoad}
                    onError={handleError}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); return false; }}
                    draggable={false}
                    alt={resolvedName || 'Employee'}
                    style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', pointerEvents: 'none' }}
                    className={`absolute inset-0 w-full h-full object-cover pointer-events-none select-none ${
                        isLoaded ? 'opacity-100' : 'opacity-0'
                    } ${isLoaded ? '' : 'transition-opacity duration-150'}`}
                    loading="lazy"
                />
            )}

            {/* Overlay to prevent drag */}
            <div 
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); return false; }}
                onDragStart={(e) => e.preventDefault()}
                className="absolute inset-0 z-10 pointer-events-auto bg-transparent select-none"
            />
        </div>
    );
};

export default EmployeeAvatar;
