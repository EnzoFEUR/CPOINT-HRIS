// Keep an operation ID after an unknown outcome so a retry cannot apply the action twice.
export function createDisciplinaryMutation(request) {
    const pending = new Map();
    return async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : {};
        const key = options.method + ':' + url;
        const fingerprint = JSON.stringify(body);
        let operation = pending.get(key);
        if (!operation || operation.fingerprint !== fingerprint) {
            operation = { fingerprint, id: crypto.randomUUID() };
            pending.set(key, operation);
        }
        const response = await request(url, { ...options, body: JSON.stringify({ ...body, operation_id: operation.id }) });
        if ((response.ok || response.status >= 400 && response.status < 500 && response.status !== 429) && pending.get(key) === operation) pending.delete(key);
        return response;
    };
}
