import React, { useState, useEffect } from 'react';
import { notifAvatarCache } from '../../utils/notificationHelpers';

export const NotificationAvatar = ({
  avatarSrc,
  initials,
  visuals,
  size = 'h-11 w-11',
  textClass = 'text-sm',
  badgeClass = 'h-4 w-4 text-[9px] -bottom-1 -right-1',
  ringClass = 'ring-1 ring-slate-900'
}) => {
  const initialStatus = avatarSrc ? notifAvatarCache.get(avatarSrc) : null;
  const [status, setStatus] = useState(() => initialStatus || 'loading');

  useEffect(() => {
    if (!avatarSrc) {
      setStatus('failed');
      return;
    }
    const cached = notifAvatarCache.get(avatarSrc);
    if (cached) setStatus(cached);
    else setStatus('loading');
  }, [avatarSrc]);

  const handleLoad = () => {
    if (avatarSrc) notifAvatarCache.set(avatarSrc, 'loaded');
    setStatus('loaded');
  };

  const handleError = () => {
    if (avatarSrc) notifAvatarCache.set(avatarSrc, 'failed');
    setStatus('failed');
  };

  const isLoaded = status === 'loaded';
  const isFailed = status === 'failed';

  return (
    <div className={`relative ${size} shrink-0`}>
      <div className={`w-full h-full rounded-xl flex items-center justify-center font-black ${textClass} shadow-inner select-none ${visuals.bg}`}>
        {initials}
      </div>
      {avatarSrc && !isFailed && (
        <img
          src={avatarSrc}
          onLoad={handleLoad}
          onError={handleError}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover rounded-xl ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } ${isLoaded ? '' : 'transition-opacity duration-150'}`}
        />
      )}
      <span className={`absolute ${badgeClass} rounded-full flex items-center justify-center text-white shadow-sm ${ringClass} ${visuals.badge}`}>
        <i className={`ti ${visuals.icon}`} />
      </span>
    </div>
  );
};

export default NotificationAvatar;
