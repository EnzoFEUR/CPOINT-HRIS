const CACHE_MAX_AGE = 5 * 60 * 1000;

export function readDashboardCache(browser, key, now = Date.now()) {
    try {
        const cached = JSON.parse(browser.sessionStorage.getItem(key));
        if (!cached?.data || !Number.isFinite(cached.updatedAt) || cached.updatedAt <= 0 || now < cached.updatedAt || now - cached.updatedAt > CACHE_MAX_AGE) return undefined;
        return cached;
    } catch { return undefined; }
}

export function writeDashboardCache(browser, key, data, updatedAt) {
    try { browser.sessionStorage.setItem(key, JSON.stringify({ data, updatedAt })); }
    catch { /* Storage is optional; the query cache remains authoritative. */ }
}

export async function dashboardResponse(response) {
    if (!response.ok) {
        const error = new Error(`Unable to load employee records (${response.status}). Please retry.`);
        error.status = response.status;
        throw error;
    }
    const body = await response.json();
    if (body?.error || body?.success === false) throw new Error('Employee records are unavailable. Please retry.');
    return body;
}

export async function fetchDashboardData(request, userId, signal) {
    signal?.throwIfAborted();
    const id = encodeURIComponent(userId);
    const response = await request(`/api/dashboard/employee/${id}`, { signal });
    if (![404, 405].includes(response.status)) {
        const result = await dashboardResponse(response);
        if (!Array.isArray(result.attendanceData) || !Array.isArray(result.discData) || !Array.isArray(result.leaveData) || (result.employee || result.shiftData?.[0])?.id !== userId) throw new Error('Employee dashboard returned incomplete records. Please retry.');
        return result;
    }
    // Only an unavailable legacy route warrants fallback; auth/outage/abort never do.
    const missing = await response.json().catch(() => null);
    if (missing?.code === 'EMPLOYEE_NOT_FOUND') return dashboardResponse(response);
    signal?.throwIfAborted();
    const [attendanceData, payrollData, discData, leaveData, profile] = await Promise.all([
        `/api/attendance?employee_id=${id}`, `/api/payroll?employee_id=${id}&limit=12`,
        `/api/disciplinary?employee_id=${id}`, `/api/leaves?employee_id=${id}`, `/api/employees/${id}`,
    ].map(async url => dashboardResponse(await request(url, { signal }))));
    const employee = profile?.data || profile;
    if (employee?.id !== userId) throw new Error('Employee dashboard returned incomplete records. Please retry.');
    return { attendanceData, payrollData, discData, leaveData, employee, shiftData: employee ? [employee] : [] };
}

export function getDashboardPayrolls(latest, history) {
    // A successful history response is authoritative, including an empty list after deletion.
    const raw = history !== undefined ? history : latest;
    const value = raw?.data ?? raw;
    const rows = Array.isArray(value) ? value : value?.id ? [value] : [];
    const time = value => Date.parse(value || '') || 0;
    return [...new Map(rows.filter(Boolean).map(row => [row.id || `${row.period_start}_${row.period_end}`, row])).values()].sort((a, b) =>
        time(b.period_end || b.period_start) - time(a.period_end || a.period_start) || time(b.created_at) - time(a.created_at));
}

export function targetsDashboardEmployee(payload, userId, column = 'employee_id') {
    if (Array.isArray(payload?.employee_ids)) return payload.employee_ids.some(id => String(id) === String(userId));
    const ids = [payload?.[column], payload?.new?.[column], payload?.old?.[column]].filter(id => id !== undefined && id !== null);
    // Deletes may contain only the row ID; reconcile rather than guess its owner.
    return !ids.length || ids.some(id => String(id) === String(userId));
}

export function createDashboardRefresh(refresh) {
    let timer, running = false, dirty = false, historyDirty = false, disposed = false;
    const schedule = (includeHistory = false) => {
        if (disposed) return;
        dirty = true;
        historyDirty ||= includeHistory === true;
        if (timer || running) return;
        timer = setTimeout(async () => {
            const refreshHistory = historyDirty;
            timer = null; dirty = false; historyDirty = false; running = true;
            try { await refresh(refreshHistory); }
            catch { /* Query errors are rendered by the dashboard. */ }
            finally { running = false; if (dirty && !disposed) schedule(); }
        }, 150);
    };
    return { refresh: schedule, cancel: () => { disposed = true; clearTimeout(timer); } };
}

export async function acknowledgeDashboardNotices(request, ids) {
    const results = await Promise.allSettled(ids.map(async id => {
        const response = await request(`/api/disciplinary/${encodeURIComponent(id)}/acknowledge`, { method: 'PUT' });
        if (!response.ok) throw new Error('Acknowledgement failed.');
    }));
    const acknowledged = results.filter(result => result.status === 'fulfilled').length;
    return { acknowledged, failed: results.length - acknowledged };
}
