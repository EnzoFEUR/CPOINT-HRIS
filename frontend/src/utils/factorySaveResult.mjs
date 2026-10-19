export function factorySaveResult(response, result) {
    if (!response.ok || result?.success !== true || !Array.isArray(result.data)) throw new Error(result?.error || result?.message || 'Factory records were not saved to the server. Keep this form open and retry when connected.');
    return result.data;
}
