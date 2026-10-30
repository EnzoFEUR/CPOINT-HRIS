import { useState } from 'react';
import { notifAvatarCache } from '../../utils/notificationHelpers';
import ProtectedImage from '../ProtectedImage';
import { privateMediaKey } from '../../utils/privateMedia';

export const NotificationAvatar = ({
  avatarSrc,
  initials,
  visuals,
  size = 'h-11 w-11',
  textClass = 'text-sm',
  badgeClass = 'h-4 w-4 text-[9px] -bottom-1 -right-1',
  ringClass = 'ring-1 ring-slate-900'
}) => {
  const [imageResult, setImageResult] = useState(null);
  const protectedMedia = privateMediaKey(avatarSrc) !== undefined;
  const status = !avatarSrc ? 'failed' : imageResult?.src === avatarSrc
    ? imageResult.status : (!protectedMedia && notifAvatarCache.get(avatarSrc)) || 'loading';

  const handleLoad = () => {
    if (avatarSrc && !protectedMedia) notifAvatarCache.set(avatarSrc, 'loaded');
    setImageResult({ src: avatarSrc, status: 'loaded' });
  };

  const handleError = () => {
    if (avatarSrc && !protectedMedia) notifAvatarCache.set(avatarSrc, 'failed');
    setImageResult({ src: avatarSrc, status: 'failed' });
  };

  const isLoaded = status === 'loaded';
  const isFailed = status === 'failed';

  return (
    <div className={`relative ${size} shrink-0`}>
      <div className={`w-full h-full rounded-md flex items-center justify-center font-black ${textClass} shadow-inner select-none ${visuals.bg}`}>
        <bdi dir="auto">{initials}</bdi>
      </div>
      {avatarSrc && (!isFailed || protectedMedia) && (
        <ProtectedImage
          src={avatarSrc}
          onLoad={handleLoad}
          onError={handleError}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover rounded-md ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } ${isLoaded ? '' : 'transition-opacity duration-100'}`}
        />
      )}
      <span className={`absolute ${badgeClass} rounded-full flex items-center justify-center text-white shadow-sm ${ringClass} ${visuals.badge}`}>
        <i className={`ti ${visuals.icon}`} />
      </span>
    </div>
  );
};

export default NotificationAvatar;
