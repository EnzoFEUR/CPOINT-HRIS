import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../supabaseClient';
import { isAdmin } from '../utils/userAccess.mjs';
import { subscribeAttendanceActivity } from '../utils/attendanceActivity.mjs';

const toastId = 'admin-attendance-activity';
const recordedTime = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' });

export default function AttendanceActivity({ user }) {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const context = useRef({ pathname, navigate });
    const queryClient = useQueryClient();
    const userId = user?.id;
    const eligible = isAdmin(user);

    useEffect(() => {
        context.current = { pathname, navigate };
        if (pathname.startsWith('/admin/attendance')) toast.dismiss(toastId);
    }, [pathname, navigate]);

    useEffect(() => {
        if (!userId || !eligible) return;
        const stop = subscribeAttendanceActivity({
            client: supabase,
            canNotify: () => document.visibilityState === 'visible' && !context.current.pathname.startsWith('/admin/attendance'),
            onRefresh: () => {
                for (const key of ['adminAttendance', 'attendanceCalendar', 'adminDashboardOverview', 'attendanceToday']) {
                    void queryClient.invalidateQueries({ queryKey: [key] });
                }
            },
            onActivity: ({ count, timeIn, timeOut, latest }) => {
                toast.custom(t => (
                    <div className="w-[min(360px,calc(100vw-32px))] rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-lg">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-semibold text-slate-900">Attendance recorded</p>
                                <p className="mt-1 break-words">{count === 1 ? `${latest.name} timed ${latest.action === 'TIME_IN' ? 'in' : 'out'}` : `${timeIn} time-in · ${timeOut} time-out`}</p>
                                <p className="mt-1 text-xs text-slate-500">{count > 1 ? `${count} records · Latest ` : ''}{recordedTime.format(new Date(latest.occurred_at))} PHT</p>
                            </div>
                            <button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Dismiss attendance activity" onClick={() => toast.dismiss(t.id)}>
                                <span className="text-xl" aria-hidden="true">×</span>
                            </button>
                        </div>
                        <button type="button" className="mt-3 min-h-11 rounded-md px-2 font-medium text-accent hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => { toast.dismiss(t.id); context.current.navigate('/admin/attendance'); }}>View attendance</button>
                    </div>
                ), { id: toastId, duration: 5000, position: 'bottom-right', ariaProps: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
            },
        });
        return () => { stop(); toast.dismiss(toastId); };
    }, [userId, eligible, queryClient]);

    return null;
}
