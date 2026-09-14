import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { fetchWithAuth } from '../../utils/api';
import { playNotificationChime } from '../../utils/audio';
import { getNotificationVisuals, getNotificationAvatar } from '../../utils/notificationHelpers';
import NotificationAvatar from './NotificationAvatar';
import { getNotificationPermission, subscribeUserToPush, sendTestPush } from '../../utils/pushNotifications';

export const NotificationBell = ({ user }) => {
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [employeeMap, setEmployeeMap] = useState(new Map());
  const [pushStatus, setPushStatus] = useState(() => getNotificationPermission());
  const containerRef = useRef(null);
  const navigate = useNavigate();

  // Load employee directory for avatar lookup on-demand
  useEffect(() => {
    supabase
      .from('employees')
      .select('id, company_id, first_name, last_name, biometric_baseline_path')
      .limit(300)
      .then(({ data, error }) => {
        if (error) {
          console.warn('[NOTIFICATION_AVATAR_DIRECTORY] Error loading employees:', error.message);
          return;
        }
        if (Array.isArray(data)) {
          const map = new Map();
          data.forEach(emp => {
            map.set(emp.id, emp);
            if (emp.company_id) map.set(emp.company_id, emp);
            if (emp.first_name && emp.last_name) {
              const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
              map.set(fullName, emp);
            }
          });
          setEmployeeMap(map);
        }
      });
  }, []);

  // Fetch initial notifications with Supabase fallback
  useEffect(() => {
    if (!user?.id) return;
    let isCancelled = false;

    const loadNotifications = async () => {
      try {
        const res = await fetchWithAuth(`/api/notifications?user_id=${user.id}&role=${user.role}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && !isCancelled) {
            setNotifications(data);
            return;
          }
        }
      } catch {
        // Silent fallback to direct Supabase query
      }

      // Direct Supabase fallback
      try {
        let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(40);
        if (user.role === 'admin') {
          query = query.or(`target.eq.admin,target.eq.${user.id}`);
        } else {
          query = query.eq('target', user.id);
        }
        const { data } = await query;
        if (Array.isArray(data) && !isCancelled) {
          setNotifications(data);
        }
      } catch (dbErr) {
        console.error('[NOTIFICATIONS] Direct DB query error:', dbErr);
      }
    };

    loadNotifications();

    return () => {
      isCancelled = true;
    };
  }, [user?.id, user?.role]);

  // Push subscription sync
  useEffect(() => {
    if (user?.id && getNotificationPermission() === 'granted') {
      subscribeUserToPush(user.id, true).catch(() => {});
    }
  }, [user?.id]);

  const handleNotificationClick = useCallback(async (notif) => {
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    setShowNotifications(false);

    try {
      await fetchWithAuth('/api/notifications/read-all', {
        method: 'PUT',
        body: JSON.stringify({ user_id: user?.id, role: user?.role })
      });
    } catch {
      // Silent fallback
    }

    const visuals = getNotificationVisuals(notif.type);
    let targetPath = visuals.path;
    const userRole = (user?.role || '').toLowerCase();
    const isAdminRole = ['admin', 'superadmin', 'super_admin', 'hr', 'hr_manager'].includes(userRole);

    if (!isAdminRole) {
      if (notif.type === 'disciplinary' || notif.type === 'warning') {
        targetPath = '/employee/dashboard?view=disciplinary';
        window.dispatchEvent(new CustomEvent('open_disciplinary_modal', { detail: notif }));
      } else {
        targetPath = '/employee/dashboard';
      }
    }

    navigate(targetPath);
  }, [user?.id, user?.role, navigate]);

  // Real-time Supabase Broadcast Channel listener
  useEffect(() => {
    if (!user || !user.id) return;

    const broadcastChannel = supabase
      .channel('system-notifications')
      .on('broadcast', { event: 'NEW_NOTIFICATION' }, (payload) => {
        const notif = payload.payload;
        if (notif.target === user.id || (user.role === 'admin' && notif.target === 'admin')) {
          playNotificationChime();
          const visuals = getNotificationVisuals(notif.type);
          const avatar = getNotificationAvatar(notif, employeeMap);

          toast.custom((t) => (
            <div
              onClick={() => {
                toast.dismiss(t.id);
                handleNotificationClick(notif);
              }}
              className="max-w-md w-full bg-slate-900 shadow-2xl rounded-2xl pointer-events-auto flex ring-1 ring-white/10 p-4 gap-3.5 cursor-pointer hover:bg-slate-800 border border-slate-700/50"
            >
              <NotificationAvatar
                avatarSrc={avatar.avatarSrc}
                initials={avatar.initials}
                visuals={visuals}
                size="h-11 w-11"
                textClass="text-sm"
                badgeClass="h-4 w-4 text-[9px] -bottom-1 -right-1"
                ringClass="ring-1 ring-slate-900"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/10 text-white">
                    {visuals.label}
                  </span>
                  <p className="text-xs font-bold text-slate-200 truncate">{notif.title || 'System Notification'}</p>
                </div>
                <p className="text-xs text-slate-300 font-medium mt-1 leading-snug">{notif.text}</p>
              </div>
            </div>
          ), { duration: 6000 });

          setNotifications(prev => [notif, ...prev]);

          window.dispatchEvent(new Event('refresh_dashboard'));
          window.dispatchEvent(new Event('refresh_leaves'));
          window.dispatchEvent(new Event('refresh_attendance'));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(broadcastChannel);
    };
  }, [user, employeeMap, handleNotificationClick]);

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await fetchWithAuth('/api/notifications/read-all', {
        method: 'PUT',
        body: JSON.stringify({ user_id: user?.id, role: user?.role })
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Outside click & Escape listener
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div ref={containerRef} className="relative">
      {/* Notifications Bell */}
      <button
        onClick={() => setShowNotifications(!showNotifications)}
        className={`relative p-2 transition-all rounded-xl tap-active shadow-xs border border-slate-200/50 h-9 w-9 flex items-center justify-center cursor-pointer ${
          showNotifications ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50 bg-slate-100/80'
        }`}
        aria-label="View Notifications"
      >
        <i className="ti ti-bell text-lg"></i>
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-red-500 rounded-full border-2 border-white shadow-xs"></span>
        )}
      </button>

      {/* Notification panel */}
      {showNotifications && (
        <div className="fixed inset-x-4 top-16 sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:mt-3 sm:w-96 bg-white border border-slate-200/80 rounded-2xl shadow-2xl overflow-hidden z-50">
          <div className="p-3.5 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-800 text-xs sm:text-sm">Notifications</h3>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-black rounded-full bg-blue-500 text-white">
                  {unreadCount} new
                </span>
              )}
            </div>
            <button
              onClick={markAllRead}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline uppercase tracking-wider cursor-pointer"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 touch-scroll">
            {notifications.length > 0 ? (
              notifications.map(notif => {
                const visuals = getNotificationVisuals(notif.type);
                const avatar = getNotificationAvatar(notif, employeeMap);
                return (
                  <div
                    key={notif.id}
                    onClick={() => handleNotificationClick(notif)}
                    className={`p-3.5 hover:bg-slate-50/80 transition-colors flex items-start gap-3 cursor-pointer ${
                      !notif.read ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    <NotificationAvatar
                      avatarSrc={avatar.avatarSrc}
                      initials={avatar.initials}
                      visuals={visuals}
                      size="h-9 w-9"
                      textClass="text-xs"
                      badgeClass="h-3.5 w-3.5 text-[8px] -bottom-1 -right-1"
                      ringClass="ring-1 ring-white"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                          {visuals.label}
                        </span>
                        <p className="text-xs font-bold text-slate-800 truncate">{notif.title || 'System Alert'}</p>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
                        {notif.text}
                      </p>
                    </div>
                    {!notif.read ? (
                      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0 shadow-xs" />
                    ) : (
                      <i className="ti ti-chevron-right text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 text-xs" />
                    )}
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center flex flex-col items-center opacity-60">
                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center mb-2">
                  <i className="ti ti-bell-off text-xl text-slate-400"></i>
                </div>
                <span className="text-xs font-bold text-slate-500">No notifications yet</span>
                <p className="text-[10px] text-slate-400 mt-0.5">You're all caught up!</p>
              </div>
            )}
          </div>

          {/* Native Phone Lock-Screen Push Notifications Banner */}
          <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <i className="ti ti-device-mobile-message text-sm"></i>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-800 leading-none">Phone Push Alerts</p>
                <p className="text-[9px] text-slate-500 font-medium truncate mt-0.5">Lock-screen notifications</p>
              </div>
            </div>

            {pushStatus === 'granted' ? (
              <button
                onClick={async () => {
                  await sendTestPush(user?.id);
                }}
                className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[10px] font-bold rounded-lg shadow-2xs transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                title="Send a test notification to your phone"
              >
                <i className="ti ti-bell-ringing text-blue-600"></i>
                Test Buzz
              </button>
            ) : (
              <button
                onClick={async () => {
                  const res = await subscribeUserToPush(user?.id);
                  if (res.success) setPushStatus('granted');
                }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg shadow-sm shadow-blue-600/30 transition-all flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <i className="ti ti-bell-plus"></i>
                Enable
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(NotificationBell);
