const EMPLOYEE_LIST_FIELDS = `id company_id first_name last_name email role job_title position department status employment_status is_active
    archived_at separation_date separation_reason created_at updated_at shift production_group_id production_groups production_group_name production_group
    group factory_group line factory_line line_assignment assigned_line section sub_department work_center
    daily_rate hourly_rate monthly_salary salary phone phone_number has_registered_biometrics biometric_baseline_path
    avatar_url photo_url photo profile_picture image_url requires_password_change is_terminated is_suspended operational_status
    active_suspension termination_record suspension_reason`.split(/\s+/);

export function employeeListRecord(employee) {
    if (!employee) return null;
    return Object.fromEntries(EMPLOYEE_LIST_FIELDS.filter(key => Object.hasOwn(employee, key)).map(key => [key, employee[key]]));
}

export function payrollListRecord(payroll) {
    return { ...payroll, employees: employeeListRecord(payroll.employees) };
}

const invalid = message => Object.assign(new Error(message), { status: 400 });
export function parseListQuery(query = {}) {
    const integer = (value, fallback, max) => {
        if (value === undefined) return fallback;
        if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
            throw invalid('Page and limit must be positive integers within the supported range.');
        }
        return Number(value);
    };
    const text = (value, fallback, max) => {
        if (value === undefined) return fallback;
        if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw invalid('Invalid list filter.');
        return value.trim();
    };
    const status = text(query.status, 'Active', 40);
    if (!['Active', 'All', 'Suspended', 'Terminated', 'Pending Termination', 'Separated', 'Salaried', 'Piece-Rate', 'Docs Awaiting Review'].includes(status)) {
        throw invalid('Invalid directory status filter.');
    }
    return { page: integer(query.page, 1, 1_000_000), limit: integer(query.limit, 100, 100),
        search: text(query.search, '', 160), department: text(query.department, 'All', 100), status };
}

const suspended = e => Boolean(e.operational_status === 'Suspended' || e.is_suspended || e.status === 'suspended');
const terminated = e => !suspended(e) && Boolean(e.operational_status === 'Terminated' || e.is_terminated || e.status === 'terminated' || (e.archived_at && e.status !== 'active'));
const factory = e => (e.department || '').toLowerCase().includes('factory');

export function employeeDirectoryPage(employees, pending, filters, now = new Date()) {
    const visible = employees.filter(e => {
        const role = (e.role || e.job_title || '').toLowerCase();
        const name = `${e.first_name || ''} ${e.last_name || ''}`.trim().toLowerCase();
        const email = (e.email || '').toLowerCase();
        if (role.includes('admin') || role.includes('security') || name.includes('terminal guard') || name.includes('system admin') ||
            ['guard@c-point.com', 'admin@c-point.com'].includes(email)) return false;
        if (!terminated(e)) return true;
        const date = e.archived_at || e.separation_date || e.updated_at;
        return !date || now.getTime() - new Date(date).getTime() < 14 * 86400_000;
    });
    const counts = { all: visible.length, active: 0, suspended: 0, pendingTermination: 0, salaried: 0, pieceRate: 0, pendingDocs: 0 };
    for (const e of visible) {
        counts[terminated(e) ? 'pendingTermination' : suspended(e) ? 'suspended' : 'active']++;
        counts[factory(e) ? 'pieceRate' : 'salaried']++;
        if (pending[e.id]?.total > 0) counts.pendingDocs++;
    }
    const search = filters.search.toLowerCase();
    const rows = visible.filter(e => {
        switch (filters.status) {
            case 'Active': if (suspended(e) || terminated(e)) return false; break;
            case 'Suspended': if (!suspended(e)) return false; break;
            case 'Terminated': case 'Pending Termination': case 'Separated': if (!terminated(e)) return false; break;
            case 'Salaried': if (factory(e)) return false; break;
            case 'Piece-Rate': if (!factory(e)) return false; break;
            case 'Docs Awaiting Review': if (!(pending[e.id]?.total > 0)) return false; break;
        }
        if (filters.department !== 'All' && e.department !== filters.department) return false;
        return !search || [`${e.first_name || ''} ${e.last_name || ''}`.trim(), e.company_id, e.email, e.job_title]
            .some(value => String(value || '').toLowerCase().includes(search));
    }).sort((a, b) => Number(terminated(a)) - Number(terminated(b)) ||
        (a.last_name || '').trim().localeCompare((b.last_name || '').trim(), undefined, { sensitivity: 'base' }) ||
        (a.first_name || '').trim().localeCompare((b.first_name || '').trim(), undefined, { sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id)));
    const totalPages = Math.max(1, Math.ceil(rows.length / filters.limit));
    const page = Math.min(filters.page, totalPages);
    const data = rows.slice((page - 1) * filters.limit, page * filters.limit).map(employeeListRecord);
    return { success: true, data, docPendingCounts: Object.fromEntries(data.filter(e => pending[e.id]).map(e => [e.id, pending[e.id]])),
        meta: { page, limit: filters.limit, total: rows.length, totalPages, counts,
            departments: ['All', ...new Set(visible.map(e => e.department).filter(Boolean))] } };
}

// shortcut: derived directory status needs the full workforce; move it into a database view before very large deployments.
export async function readAllRows(makeQuery) {
    const rows = [];
    const ids = new Set();
    const batchSize = 500;
    let expectedTotal;
    for (let offset = 0; ; ) {
        const { data, error, count } = await makeQuery().range(offset, offset + batchSize - 1);
        if (error) throw error;
        if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 || data.length > batchSize ||
            (expectedTotal !== undefined && expectedTotal !== count)) throw new Error('The list changed or could not be loaded completely. Retry.');
        expectedTotal = count;
        for (const row of data) {
            if (row.id == null || ids.has(String(row.id))) throw new Error('The list changed while loading. Retry.');
            ids.add(String(row.id));
        }
        rows.push(...data);
        if (rows.length === count) return rows;
        if (data.length === 0 || rows.length > count) throw new Error('The list could not be loaded completely.');
        offset += data.length;
    }
}
