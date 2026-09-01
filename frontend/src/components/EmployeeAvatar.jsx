import React, { useState, useEffect, useMemo } from 'react';

// Global in-memory cache to remember loaded/failed URLs across component mounts and re-renders
const urlStatusCache = new Map();

/**
 * Enterprise-grade EmployeeAvatar Component
 * - Zero Pop: Stylized fallback initials are rendered immediately at paint frame 0.
 * - Zero Flicker: In-memory URL cache preserves loaded status across component re-renders.
 * - Stable Identity: Module-scoped component prevents unmounting on parent state updates.
 */
export const EmployeeAvatar = ({
    employee = null,
    firstName = '',
    lastName = '',
    name = '',
    companyId = '',
    employeeId = '',
    photoUrl = '',
    avatarUrl = '',
    department = '',
    size = 'h-12 w-12',
    textSize = '',
    rounded = 'rounded-xl',
    theme = 'auto', // 'auto', 'indigo', 'blue', 'amber', 'emerald', 'purple', 'cyan', 'red', 'dark', 'gradient'
    border = 'border border-slate-200',
    shadow = 'shadow-inner',
    className = '',
    showOnlineStatus = false,
    isOnline = false,
}) => {
    // 1. Resolve Name and Initials
    const resolvedFirstName = firstName || employee?.first_name || '';
    const resolvedLastName = lastName || employee?.last_name || '';
    const resolvedName = name || employee?.name || `${resolvedFirstName} ${resolvedLastName}`.trim();

    const initials = useMemo(() => {
        if (resolvedFirstName && resolvedLastName) {
            return `${resolvedFirstName.charAt(0)}${resolvedLastName.charAt(0)}`.toUpperCase();
        }
        if (resolvedName) {
            const parts = resolvedName.trim().split(' ').filter(Boolean);
            if (parts.length > 1) {
                return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
            }
            if (parts.length === 1) {
                return parts[0].slice(0, 2).toUpperCase();
            }
        }
        if (resolvedFirstName) {
            return resolvedFirstName.slice(0, 2).toUpperCase();
        }
        return 'EM';
    }, [resolvedFirstName, resolvedLastName, resolvedName]);

    // 2. Resolve Avatar Image Source URL
    const resolvedAvatarSrc = useMemo(() => {
        const rawPhoto = photoUrl || avatarUrl || employee?.avatar_url || employee?.photo_url || employee?.photo || employee?.profile_picture || employee?.image_url || employee?.biometric_baseline_path;
        if (rawPhoto) {
            if (rawPhoto.startsWith('http') || rawPhoto.startsWith('data:')) {
                return rawPhoto;
            }
            return `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${rawPhoto.replace(/^\/+/, '')}`;
        }
        return null;
    }, [photoUrl, avatarUrl, employee]);

    // 3. Resolve Loading State from Global Cache
    const initialStatus = resolvedAvatarSrc ? urlStatusCache.get(resolvedAvatarSrc) : null;
    const [imgStatus, setImgStatus] = useState(() => initialStatus || 'loading');

    // Keep status in sync if avatarSrc changes
    useEffect(() => {
        if (!resolvedAvatarSrc) {
            setImgStatus('failed');
            return;
        }
        const cached = urlStatusCache.get(resolvedAvatarSrc);
        if (cached) {
            setImgStatus(cached);
        } else {
            setImgStatus('loading');
        }
    }, [resolvedAvatarSrc]);

    const handleLoad = () => {
        if (resolvedAvatarSrc) {
            urlStatusCache.set(resolvedAvatarSrc, 'loaded');
        }
        setImgStatus('loaded');
    };

    const handleError = () => {
        if (resolvedAvatarSrc) {
            urlStatusCache.set(resolvedAvatarSrc, 'failed');
        }
        setImgStatus('failed');
    };

    // 4. Resolve Visual Theme
    const resolvedDept = (department || employee?.department || '').toLowerCase();
    const isFactory = resolvedDept.includes('factory') || resolvedDept.includes('plant') || resolvedDept.includes('warehouse');

    const themeClass = useMemo(() => {
        if (theme === 'auto') {
            return isFactory ? 'bg-amber-50 text-amber-800' : 'bg-indigo-50 text-indigo-800';
        }
        switch (theme) {
            case 'amber': return 'bg-amber-50 text-amber-800';
            case 'blue': return 'bg-blue-50 text-blue-800';
            case 'indigo': return 'bg-indigo-50 text-indigo-800';
            case 'emerald': return 'bg-emerald-50 text-emerald-800';
            case 'purple': return 'bg-purple-50 text-purple-800';
            case 'cyan': return 'bg-cyan-50 text-cyan-800';
            case 'red': return 'bg-red-50 text-red-800';
            case 'dark': return 'bg-slate-900 text-white';
            case 'gradient': return 'bg-indigo-600 text-white';
            default: return 'bg-slate-100 text-slate-800';
        }
    }, [theme, isFactory]);

    // 5. Resolve Text Size
    const resolvedTextSize = useMemo(() => {
        if (textSize) return textSize;
        if (size.includes('h-9') || size.includes('h-8') || size.includes('w-9')) return 'text-xs';
        if (size.includes('h-10') || size.includes('w-10')) return 'text-xs sm:text-sm';
        if (size.includes('h-11') || size.includes('h-12') || size.includes('w-12')) return 'text-sm';
        if (size.includes('h-14') || size.includes('h-16') || size.includes('w-16')) return 'text-base sm:text-lg';
        if (size.includes('h-24') || size.includes('h-28') || size.includes('h-32') || size.includes('h-36')) return 'text-3xl sm:text-4xl';
        return 'text-sm';
    }, [textSize, size]);

    const isLoaded = imgStatus === 'loaded';
    const isFailed = imgStatus === 'failed';

    return (
        <div 
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); return false; }}
            style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
            className={`relative ${size} ${rounded} overflow-hidden shrink-0 ${border} ${shadow} ${themeClass} flex items-center justify-center select-none ${className}`}
        >
            {/* Fallback initial letters - always present at paint time to eliminate pop */}
            <span className={`font-black ${resolvedTextSize} tracking-wide select-none pointer-events-none`}>
                {initials}
            </span>

            {/* Photo overlay with zero-flash cache resolution & anti-save protections */}
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

            {/* Transparent security overlay to block image dragging/saving/inspection */}
            <div 
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); return false; }}
                onDragStart={(e) => e.preventDefault()}
                className="absolute inset-0 z-10 pointer-events-auto bg-transparent select-none"
            />
        </div>
    );
};

export default EmployeeAvatar;
