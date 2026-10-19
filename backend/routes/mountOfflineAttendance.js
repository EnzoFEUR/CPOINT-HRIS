export async function mountOfflineAttendance(app, verifyToken, env = process.env, loadRouter = () => import('./attendanceOffline.js')) {
    // Offline attendance remains local/test-only until authoritative reconciliation is released.
    if (env.OFFLINE_ATTENDANCE_ENABLED !== 'true' || env.NODE_ENV === 'production') return false;
    const { default: router } = await loadRouter();
    app.use('/api/attendance-offline', verifyToken, router);
    return true;
}
