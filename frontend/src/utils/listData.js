export async function fetchEmployeeRoster(fetchApi, signal) {
    const response = await fetchApi('/api/employees?view=roster', { signal });
    const body = await response.json();
    signal?.throwIfAborted();
    if (!response.ok) throw Object.assign(new Error(body.error || 'Unable to load employee records.'), { status: response.status });
    if (!Array.isArray(body.data)) throw new Error('Employee records could not be verified.');
    return body.data;
}

export async function fetchCompleteList(fetchApi, endpoint, signal) {
    const rows = [];
    const ids = new Set();
    let expectedTotal;
    for (let page = 1; ; page++) {
        signal?.throwIfAborted();
        const [path, query = ''] = endpoint.split('?');
        const params = new URLSearchParams(query);
        params.set('page', String(page));
        params.set('limit', '100');
        const response = await fetchApi(`${path}?${params}`, { signal });
        const body = await response.json();
        signal?.throwIfAborted();
        if (!response.ok) throw Object.assign(new Error(body.error || 'Unable to load records.'), { status: response.status });
        const { meta, data } = body || {};
        if (!Array.isArray(data) || !meta || meta.page !== page || !Number.isSafeInteger(meta.total) || meta.total < 0 ||
            !Number.isSafeInteger(meta.limit) || meta.limit < 1 || meta.limit > 100 ||
            meta.totalPages !== Math.max(1, Math.ceil(meta.total / meta.limit)) ||
            data.length !== Math.min(meta.limit, Math.max(0, meta.total - (page - 1) * meta.limit))) {
            throw new Error('The complete list could not be verified. Refresh and try again.');
        }
        if (expectedTotal !== undefined && expectedTotal !== meta.total) throw new Error('Records changed while loading. Refresh and try again.');
        expectedTotal = meta.total;
        for (const row of data) {
            if (row.id == null || ids.has(String(row.id))) throw new Error('Records changed while loading. Refresh and try again.');
            ids.add(String(row.id));
            rows.push(row);
        }
        if (page === meta.totalPages) return rows;
    }
}
