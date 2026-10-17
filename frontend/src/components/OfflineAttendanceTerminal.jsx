import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '../supabaseClient';
import PageHeader from './ui/PageHeader';
import { captureOfflineBadge, exportOfflineBackup, getOfflineStorageStatus, importOfflineBackup, listOfflineEvents, MAX_EVENTS, readMeta } from '../utils/offlineAttendanceStore';
import { clearAcceptedOfflineCaptures, enrollOfflineTerminal, offlineApi, offlineDiagnosticText, offlineSyncMessage, refreshOfflineRoster, syncOfflineAttendance } from '../utils/offlineAttendanceSync';
import { isOfflineTestEnabled, offlineTestAvailable, OFFLINE_TEST_CHANGED, setOfflineTestEnabled } from '../utils/offlineAttendanceTestMode.mjs';
import { isAppOffline, subscribeOfflineAccess } from '../utils/offlineAccess.mjs';
import { getStoredUser, subscribeStoredUser } from '../utils/storedUser.mjs';

const terminalRole = () => String(getStoredUser()?.role || '').trim().toLowerCase();

const receiptLabels = {
  pending: 'Saved on device — pending sync',
  syncing: 'Syncing to cloud...',
  needs_review: 'Received — awaiting HR review',
  needs_verification: 'Flagged for HR verification',
  rejected: 'Rejected by HR',
  synced: 'Synchronized & accepted'
};

export default function OfflineAttendanceTerminal({ canProvision = false, operatorEmail = '', alwaysShow = true, onActiveChange }) {
  const [open, setOpen] = useState(alwaysShow);
  const [enrollment, setEnrollment] = useState(null);
  const [events, setEvents] = useState([]);
  const [badge, setBadge] = useState('');
  const [action, setAction] = useState('TIME_IN');
  const [operator, setOperator] = useState(operatorEmail);
  const [site, setSite] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [camera, setCamera] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [testOffline, setTestOffline] = useState(isOfflineTestEnabled);
  const [backupOpen, setBackupOpen] = useState(false);

  const offline = useSyncExternalStore(subscribeOfflineAccess, isAppOffline, isAppOffline);
  const canEnroll = useSyncExternalStore(subscribeStoredUser, terminalRole, terminalRole) === 'admin';

  const sitesQuery = useQuery({
    queryKey: ['offlineAttendanceSites'],
    queryFn: () => offlineApi('/sites'),
    enabled: open && !offline && canEnroll && (canProvision || alwaysShow) && !enrollment,
    staleTime: 60000,
    retry: false,
  });

  const sites = sitesQuery.data?.sites || [];
  const selectedSite = enrollment?.device.site_id || site || (sites.length === 1 ? sites[0] : '');
  const captureLock = useRef(false);
  const syncLock = useRef(false);
  const scanner = useRef(null);
  const badgeInputRef = useRef(null);
  const qrId = React.useId().replace(/:/g, '');

  const reload = useCallback(async () => {
    const [currentEnrollment, currentEvents, lastSyncTime, hold] = await Promise.all([
      readMeta('enrollment'),
      listOfflineEvents(),
      readMeta('last_successful_upload'),
      readMeta('capture_hold')
    ]);
    setEnrollment(currentEnrollment || null);
    setEvents(currentEvents);
    setLastSync(lastSyncTime || null);
    if (hold) setError(hold);
    if (currentEnrollment) {
      setSite(currentEnrollment.device.site_id);
    }
    if (import.meta.env.PROD && navigator.serviceWorker?.controller && globalThis.caches) {
      setOfflineReady(Boolean(await caches.match('/offline-assets.json')));
    }
  }, []);

  const sync = useCallback(async (manual = false, announce = false) => {
    const blocked = syncLock.current
      ? 'Synchronization is already running. Please wait.'
      : isOfflineTestEnabled()
      ? 'Turn off the offline test to synchronize.'
      : !navigator.onLine
      ? 'Reconnect before synchronizing. Captures remain saved.'
      : document.visibilityState !== 'visible'
      ? 'Return to this tab to synchronize.'
      : null;

    if (blocked) {
      if (manual || announce) {
        setMessage(blocked);
        console.info('[OFFLINE_ATTENDANCE_SYNC]', { status: 'skipped', reason: blocked });
      }
      return;
    }

    syncLock.current = true;
    try {
      const result = await syncOfflineAttendance({ manual });
      if (manual || result.error) {
        const diagnostic = result.diagnostic;
        console.info('[OFFLINE_ATTENDANCE_SYNC]', offlineDiagnosticText(diagnostic), {
          status: result.status,
          uploaded: result.count,
          pending: result.pending,
          retry_at: result.retry_at
        });
      }
      if (manual || announce || result.count) setMessage(offlineSyncMessage(result));
      if (result.error) setError(result.error);
      await reload();
    } catch (failure) {
      if (manual || announce || failure.http_status === 403) setError(failure.message);
      await reload().catch(() => {});
    } finally {
      syncLock.current = false;
    }
  }, [reload]);

  useEffect(() => {
    const initialLoad = setTimeout(() => reload().catch(failure => setError(failure.message)), 0);
    const readinessChanged = () => { reload().catch(failure => setError(failure.message)); };
    navigator.serviceWorker?.addEventListener('controllerchange', readinessChanged);

    const attempt = () => { sync(false); };
    attempt();
    const reconnected = () => {
      setMessage('Network connection detected. Checking pending captures...');
      sync(false, true);
    };
    window.addEventListener('online', reconnected);

    const testChanged = () => {
      setTestOffline(isOfflineTestEnabled());
      setError('');
      setMessage('');
      if (isOfflineTestEnabled()) attempt();
      else reconnected();
    };
    window.addEventListener(OFFLINE_TEST_CHANGED, testChanged);
    document.addEventListener('visibilitychange', attempt);
    const timer = setInterval(attempt, 30000);

    const authTimers = new Set();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (!['SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) return;
      const authTimer = setTimeout(() => { authTimers.delete(authTimer); attempt(); }, 0);
      authTimers.add(authTimer);
    });

    return () => {
      clearInterval(timer);
      clearTimeout(initialLoad);
      navigator.serviceWorker?.removeEventListener('controllerchange', readinessChanged);
      subscription.unsubscribe();
      authTimers.forEach(clearTimeout);
      window.removeEventListener('online', reconnected);
      window.removeEventListener(OFFLINE_TEST_CHANGED, testChanged);
      document.removeEventListener('visibilitychange', attempt);
    };
  }, [reload, sync]);

  useEffect(() => {
    onActiveChange?.(open);
    return () => { onActiveChange?.(false); };
  }, [open, onActiveChange]);

  // QR Camera Lifecycle
  useEffect(() => {
    if (!camera || !open) return;
    let disposed = false;
    const reader = new Html5Qrcode(`offline-qr-${qrId}`);
    scanner.current = reader;

    reader.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 240 },
      text => {
        if (!disposed) {
          if (text.trim().length > 100) {
            setError('Badge QR payload exceeds 100 characters. Ask HR to verify.');
          } else {
            setBadge(text.trim());
          }
          setCamera(false);
          badgeInputRef.current?.focus();
        }
      },
      () => {}
    ).then(() => {
      if (disposed && reader.isScanning) reader.stop().catch(() => {});
    }).catch(failure => {
      if (!disposed) {
        setError(`QR camera unavailable: ${failure.message || failure}`);
        setCamera(false);
      }
    });

    return () => {
      disposed = true;
      if (reader.isScanning) {
        reader.stop().then(() => reader.clear()).catch(() => {});
      }
      scanner.current = null;
    };
  }, [camera, open, qrId]);

  async function perform(task) {
    if (captureLock.current) return;
    captureLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
      await reload();
    } catch (failure) {
      setError(failure.message);
    } finally {
      captureLock.current = false;
      setBusy(false);
    }
  }

  const capture = event => {
    event.preventDefault();
    if (!badge.trim()) return;

    perform(async () => {
      const eventId = crypto.randomUUID();
      await captureOfflineBadge({ badge: badge.trim(), action, eventId });
      setBadge('');
      setMessage('Saved on this device — pending sync.');
      sync(false);
      badgeInputRef.current?.focus();
    });
  };

  const cleanupAccepted = () => {
    if (!window.confirm('Remove accepted attendance copies from this device? Pending and disputed captures will stay. Server attendance and terminal authorization will not change.')) return;
    perform(async () => {
      const count = await clearAcceptedOfflineCaptures();
      setMessage(count ? `${count} accepted copies removed from this device. Pending captures remain saved.` : 'No accepted copies could be removed. Synchronize and ask HR to finish reviewing captures.');
    });
  };

  const exportBackup = () => perform(async () => {
    const backup = await exportOfflineBackup(password);
    const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `offline-attendance-${enrollment.device.id}.encrypted.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPassword('');
    setMessage('Encrypted queue backup exported successfully.');
  });

  if (!open) {
    return (
      <button
        type="button"
        className="h-9 px-3.5 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-2"
        onClick={() => setOpen(true)}
      >
        <i className="ti ti-device-watch text-sm text-slate-600" />
        <span>Open Offline Terminal</span>
      </button>
    );
  }

  const pendingCount = events.filter(item => ['pending', 'syncing'].includes(item.status)).length;
  const awaitingHrCount = events.filter(item => ['needs_review', 'needs_verification'].includes(item.status)).length;
  const syncedCount = events.filter(item => item.status === 'synced').length;
  const storageCapacityPct = Math.min(100, (events.length / MAX_EVENTS) * 100);
  const storageStatus = getOfflineStorageStatus(events.length);

  const terminalContent = (
    <div className="space-y-6">
      {/* Production PageHeader */}
      <PageHeader
        breadcrumbs={['Admin', 'Attendance', 'Offline Terminal']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {(offline || testOffline) && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                <i className="ti ti-wifi-off text-xs" />
                <span>{offline ? 'Offline Mode' : 'Simulated Offline'}</span>
              </span>
            )}

            {/* Return or Close */}
            {!alwaysShow ? (
              <button
                type="button"
                onClick={() => { setCamera(false); setOpen(false); }}
                className="h-9 px-3.5 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                Close Terminal
              </button>
            ) : !offline ? (
              <Link
                to={canEnroll ? '/admin/attendance' : '/scanner'}
                className="h-9 px-3.5 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors inline-flex items-center gap-1.5"
              >
                <i className="ti ti-arrow-left text-xs" />
                <span>{canEnroll ? 'Daily Logs' : 'Online scanner'}</span>
              </Link>
            ) : null}
          </div>
        }
      />
      <p role="status" className="text-sm text-ink">{offlineReady ? 'Offline app ready on this browser.' : 'Offline page loading is not ready on this browser. Complete online setup before testing a full outage.'}</p>

      {storageStatus.level !== 'normal' && (
        <div role="alert" className={`rounded-md border p-3 text-xs ${storageStatus.level === 'warning' ? 'bg-warning-subtle text-warning-ink border-warning/20' : 'bg-danger-subtle text-danger-ink border-danger/20'}`}>
          <p className="font-semibold">{storageStatus.level === 'full' ? 'Storage is full. New offline captures are paused.' : `Storage is nearly full. ${storageStatus.remaining} spaces left.`}</p>
          <p className="mt-1">Sync pending captures, ask HR to finish reviews, then remove accepted copies.</p>
        </div>
      )}

      {/* Diagnostic & Error Alert */}
      {error && (
        <div role="alert" className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <i className="ti ti-alert-triangle text-base text-rose-600 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError('')}
            className="text-rose-500 hover:text-rose-700 cursor-pointer"
          >
            <i className="ti ti-x text-sm" />
          </button>
        </div>
      )}

      {/* Success Notification Alert */}
      {message && (
        <div role="status" className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <i className="ti ti-circle-check text-base text-emerald-600 shrink-0" />
            <span className="font-medium">{message}</span>
          </div>
          <button
            type="button"
            onClick={() => setMessage('')}
            className="text-emerald-500 hover:text-emerald-700 cursor-pointer"
          >
            <i className="ti ti-x text-sm" />
          </button>
        </div>
      )}

      {/* Offline Test Simulator Ribbon (Dev / Localhost only) */}
      {offlineTestAvailable() && (
        <div className="p-3.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-slate-100 flex items-center justify-center text-slate-700 border border-slate-200 shrink-0">
              <i className="ti ti-flask text-sm" />
            </div>
            <div>
              <span className="font-bold text-slate-900">Developer Offline Simulator:</span>{' '}
              <span className="text-slate-500">
                {testOffline
                  ? 'Cloud uploads blocked. New punches will stay on this device for testing.'
                  : 'Turn on to test local capture workflows without disconnecting network.'}
              </span>
            </div>
          </div>
          <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={testOffline}
              disabled={busy}
              onChange={e => setOfflineTestEnabled(e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 h-4 w-4"
            />
            <span>Simulate Offline</span>
          </label>
        </div>
      )}

      {/* Enrollment Card (If browser is not enrolled) */}
      {!enrollment && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-2xs p-6 sm:p-8 max-w-lg mx-auto text-center space-y-5 my-8">
          <div className="h-12 w-12 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 flex items-center justify-center mx-auto">
            <i className="ti ti-shield-lock text-2xl" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Terminal Authorization Required</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
              This browser workstation must be authorized by an operator online before capturing offline attendance punches.
            </p>
          </div>

          {canEnroll && !offline ? <form
            className="space-y-4 text-left pt-2"
            onSubmit={event => {
              event.preventDefault();
              perform(async () => {
                await enrollOfflineTerminal(operator, selectedSite);
                setMessage('Terminal workstation successfully enrolled and hardware lease established.');
              });
            }}
          >
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Security Operator Email
              </label>
              <input
                type="email"
                value={operator}
                onChange={e => setOperator(e.target.value)}
                required
                maxLength={254}
                autoComplete="off"
                placeholder="guard@c-point.com"
                className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 shadow-2xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Terminal Deployment Location
              </label>
              <select
                value={selectedSite}
                onChange={e => setSite(e.target.value)}
                required
                disabled={busy || sitesQuery.isFetching}
                className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:border-slate-400 shadow-2xs cursor-pointer"
              >
                <option value="">{sitesQuery.isFetching ? 'Loading locations...' : 'Select deployment site'}</option>
                {sites.map(val => <option key={val} value={val}>{val}</option>)}
              </select>
              {sitesQuery.isError && (
                <p className="text-rose-600 text-[11px] mt-1">{sitesQuery.error.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={busy || testOffline || !navigator.onLine || !selectedSite || !operator.trim()}
              className="w-full h-10 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center justify-center gap-2"
            >
              <i className="ti ti-key text-sm" />
              <span>Authorize & Enroll Workstation</span>
            </button>
          </form> : <p className="text-sm text-ink">Ask Admin to authorize this browser while connected.</p>}
        </div>
      )}

      {/* Main Workstation Interface (When Enrolled) */}
      {enrollment && (
        <div className="space-y-6">
          {/* Top Status Strip */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-2xs grid grid-cols-1 sm:grid-cols-3 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-700 shrink-0">
                <i className="ti ti-building text-base" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Site Location</span>
                <strong className="text-slate-900 text-xs font-semibold">{enrollment.device.site_id}</strong>
              </div>
            </div>

            <div className="pt-3 sm:pt-0 sm:pl-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-700 shrink-0">
                <i className="ti ti-clock text-base" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Hardware Lease Expiry</span>
                <span className="font-mono text-slate-800 text-xs font-semibold">
                  {new Date(enrollment.device.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {new Date(enrollment.device.expires_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>

            <div className="pt-3 sm:pt-0 sm:pl-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-700 shrink-0">
                <i className="ti ti-users text-base" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Approved Local Roster</span>
                <span className="font-mono text-slate-900 text-xs font-bold">
                  {enrollment.roster?.employees?.length || 0} Badges Cached
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Punch Capture Station */}
            <div className="lg:col-span-7 flex flex-col space-y-6">
              {/* Punch Capture Card */}
              <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Record Attendance Punch
                  </h2>
                  <span className="text-[11px] font-mono font-semibold text-slate-500">
                    ECDSA P-256
                  </span>
                </div>

                <div className="p-5 sm:p-6 space-y-5">
                  {/* Action Segmented Switcher */}
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => { setAction('TIME_IN'); badgeInputRef.current?.focus(); }}
                      className={`h-11 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        action === 'TIME_IN'
                          ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <i className="ti ti-login text-base text-emerald-600" />
                      <span>Time In (Arrival)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setAction('TIME_OUT'); badgeInputRef.current?.focus(); }}
                      className={`h-11 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        action === 'TIME_OUT'
                          ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <i className="ti ti-logout text-base text-blue-600" />
                      <span>Time Out (Departure)</span>
                    </button>
                  </div>

                  {/* Badge Entry Form */}
                  <form onSubmit={capture} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                        Employee Badge ID or QR Data
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                          <i className="ti ti-id text-base" />
                        </div>
                        <input
                          ref={badgeInputRef}
                          type="text"
                          value={badge}
                          onChange={e => setBadge(e.target.value)}
                          maxLength={100}
                          required
                          autoFocus
                          autoComplete="off"
                          placeholder="Scan badge QR or enter CP-ID (e.g. CP-1002)..."
                          className="w-full h-11 pl-10 pr-10 rounded-md border border-slate-200 bg-white text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400 shadow-2xs"
                        />
                        {badge && (
                          <button
                            type="button"
                            onClick={() => setBadge('')}
                            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            <i className="ti ti-x text-sm" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* QR Camera Toggle & Viewport */}
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setCamera(prev => !prev)}
                        disabled={busy}
                        className={`w-full h-10 px-4 rounded-md border text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                          camera
                            ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700 shadow-2xs'
                        }`}
                      >
                        <i className={`ti ${camera ? 'ti-camera-off' : 'ti-camera'} text-sm`} />
                        <span>{camera ? 'Close Scanner Camera' : 'Scan With Optical Camera'}</span>
                      </button>

                      {camera && (
                        <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-900 p-3 space-y-2">
                          <div id={`offline-qr-${qrId}`} className="min-h-64 rounded-md overflow-hidden bg-black" />
                          <p className="text-center text-[11px] text-slate-300 font-medium">
                            Position employee QR badge inside the camera frame
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={busy || !badge.trim() || storageStatus.level === 'full'}
                      className="w-full h-11 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <i className="ti ti-check text-base" />
                      <span>Save Provisional {action === 'TIME_IN' ? 'Time In' : 'Time Out'}</span>
                    </button>
                  </form>

                  <p className="text-[11px] text-slate-500 text-center">
                    Captures are cryptographically signed on device and stored locally until synced.
                  </p>
                </div>
              </div>

              {/* Roster & Synchronization Bar */}
              <div className="bg-white rounded-lg shadow-2xs border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy || testOffline || !navigator.onLine}
                    onClick={() => { setError(''); sync(true); }}
                    className="h-9 px-3.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <i className={`ti ti-refresh text-xs ${busy ? 'animate-spin' : ''}`} />
                    <span>Sync Pending Captures</span>
                  </button>

                  <button
                    type="button"
                    disabled={busy || testOffline || !navigator.onLine}
                    onClick={() => perform(async () => {
                      await refreshOfflineRoster();
                      setMessage('Approved employee roster refreshed from central server.');
                    })}
                    className="h-9 px-3.5 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <i className="ti ti-users text-xs" />
                    <span>Refresh Roster</span>
                  </button>
                </div>

                <div className="text-[11px] text-slate-500">
                  Last upload: <strong className="font-mono text-slate-700">{lastSync ? new Date(lastSync).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'None yet'}</strong>
                </div>
              </div>
            </div>

            {/* Right Column: Queue Health, Recent Captures, & Disaster Backup */}
            <div className="lg:col-span-5 flex flex-col space-y-6">
              {/* Storage & Queue Metric Card */}
              <div className="bg-white rounded-lg shadow-2xs border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Terminal Local Queue
                  </h3>
                  <span className="font-mono text-xs font-bold text-slate-900">
                    {events.length} / {MAX_EVENTS} Records
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      storageCapacityPct > 80 ? 'bg-rose-500' : storageCapacityPct > 50 ? 'bg-amber-500' : 'bg-slate-900'
                    }`}
                    style={{ width: `${storageCapacityPct}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-center font-mono text-xs">
                  <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-500 block font-sans font-semibold uppercase tracking-wider">Pending</span>
                    <strong className="text-slate-900 text-sm font-bold">{pendingCount}</strong>
                  </div>
                  <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-500 block font-sans font-semibold uppercase tracking-wider">In Review</span>
                    <strong className="text-slate-900 text-sm font-bold">{awaitingHrCount}</strong>
                  </div>
                  <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-500 block font-sans font-semibold uppercase tracking-wider">Synced</span>
                    <strong className="text-slate-900 text-sm font-bold">{syncedCount}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={cleanupAccepted}
                  disabled={busy || offline || syncedCount === 0}
                  title={offline ? 'Reconnect to remove accepted copies.' : 'Only HR-approved attendance copies can be removed.'}
                  className="w-full rounded-md border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? 'Please wait...' : 'Remove accepted copies'}
                </button>
              </div>

              {/* Recent Local Captures */}
              <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden flex-1 flex flex-col min-h-[300px]">
                <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Recent Captures ({events.slice(-20).length})
                  </h3>
                  <span className="font-mono text-[10px] text-slate-400 font-semibold">PST (UTC+8)</span>
                </div>

                {events.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 flex-1 flex flex-col items-center justify-center">
                    <i className="ti ti-inbox text-3xl mb-1 text-slate-300 block" />
                    <p className="text-xs font-semibold text-slate-600">No punch events recorded yet</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Scanned employee badges will appear here</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 overflow-y-auto max-h-[360px]" aria-label="Recent offline captures">
                    {events.slice(-20).reverse().map(item => {
                      const isTimeIn = item.payload.action === 'TIME_IN';
                      const isPending = ['pending', 'syncing'].includes(item.status);
                      const isAccepted = item.status === 'synced';
                      const isRejected = item.server_received === false || item.status === 'rejected';

                      return (
                        <li
                          key={item.payload.event_id}
                          className="p-3.5 hover:bg-slate-50/70 transition-colors text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                isTimeIn
                                  ? 'bg-slate-900 text-white border-slate-800'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}>
                                {isTimeIn ? 'Time In' : 'Time Out'}
                              </span>
                              <span className="font-mono text-xs font-bold text-slate-900">
                                {new Date(item.payload.captured_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            </div>

                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
                              isAccepted ? 'bg-success-subtle text-success-ink border-success/20' :
                              isRejected ? 'bg-danger-subtle text-danger-ink border-danger/20' :
                              isPending ? 'bg-warning-subtle text-warning-ink border-warning/20' :
                              'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                              {item.server_received === false ? 'Rejected' : receiptLabels[item.status] || 'Needs Attention'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                            <span>Seq #{item.payload.local_sequence || 1}</span>
                            <span>{new Date(item.payload.captured_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>

                          {item.last_error && (
                            <div className="rounded bg-rose-50 border border-rose-200 p-2 text-rose-700 text-[11px]">
                              {item.last_error}
                              {item.retry_at > 0 && ` Automatic retry after ${new Date(item.retry_at).toLocaleTimeString()}.`}
                            </div>
                          )}

                          {(item.last_error || item.last_diagnostic) && (
                            <p className="break-words font-mono text-[10px] text-slate-500 bg-slate-50 p-1.5 rounded border border-slate-200">
                              {offlineDiagnosticText(item.last_diagnostic)}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Encrypted Queue Backup & Disaster Recovery Accordion */}
              <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setBackupOpen(prev => !prev)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-50/80 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <i className="ti ti-lock text-sm text-slate-500" />
                    <span>Encrypted Queue Disaster Backup</span>
                  </div>
                  <i className={`ti ${backupOpen ? 'ti-chevron-up' : 'ti-chevron-down'} text-xs text-slate-400`} />
                </button>

                {backupOpen && (
                  <div className="p-4 border-t border-slate-200 space-y-3 text-xs bg-slate-50/50">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Download AES-GCM encrypted unresolved queue before clearing browser cache. Restore only on this same enrolled browser.
                    </p>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Backup Master Password (12+ characters)
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="new-password"
                        minLength={12}
                        placeholder="Enter 12+ character password..."
                        className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 shadow-2xs"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy || password.length < 12}
                        onClick={exportBackup}
                        className="flex-1 h-9 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center justify-center gap-1.5"
                      >
                        <i className="ti ti-download text-xs" />
                        <span>Export Backup</span>
                      </button>

                      <label className={`flex-1 h-9 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs text-center cursor-pointer inline-flex items-center justify-center gap-1.5 transition-colors ${
                        busy || password.length < 12 ? 'opacity-40 pointer-events-none' : ''
                      }`}>
                        <i className="ti ti-upload text-xs" />
                        <span>Restore Backup</span>
                        <input
                          type="file"
                          accept=".json,application/json"
                          className="hidden"
                          disabled={busy || password.length < 12}
                          onChange={event => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) {
                              perform(async () => {
                                if (file.size > 5_000_000) throw new Error('Backup file exceeds 5MB limit.');
                                const count = await importOfflineBackup(await file.text(), password);
                                setPassword('');
                                setMessage(`${count} signed events verified; missing queue items restored.`);
                              });
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (alwaysShow) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
        <div className="max-w-7xl mx-auto py-6 sm:py-8 px-4 sm:px-6 lg:px-8 font-sans">
          {terminalContent}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-slate-900/40 backdrop-blur-xs p-4 sm:p-6 flex items-center justify-center font-sans">
      <div className="relative w-full max-w-5xl bg-white border border-slate-200 rounded-lg shadow-xl p-6 text-slate-900 my-auto">
        {terminalContent}
      </div>
    </div>
  );
}
