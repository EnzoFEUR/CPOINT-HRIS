export async function readOfflineAvailability(request) {
  try {
    const status = await request('/availability');
    if (typeof status?.enabled !== 'boolean' || typeof status?.ready !== 'boolean' || (status.ready && !status.enabled)) throw new Error('The server did not confirm offline attendance availability.');
    return status;
  } catch (error) {
    if (error.http_status === 404) return { enabled: false, ready: false, code: 'OFFLINE_BACKEND_UPDATE_REQUIRED' };
    throw error;
  }
}

export function offlineAvailabilityMessage(status, error) {
  if (error) return 'Cannot check offline attendance availability. Reconnect and retry.';
  if (!status) return 'Checking offline attendance availability…';
  if (status.ready) return '';
  if (status.code === 'OFFLINE_DISABLED') return 'Offline attendance is disabled on the backend.';
  if (status.code === 'OFFLINE_CONFIG_REQUIRED') return 'Offline attendance requires backend site and lease configuration.';
  if (status.code === 'OFFLINE_SCHEMA_NOT_READY') return 'Offline attendance requires the production database migration.';
  return 'The backend needs the matching offline attendance update.';
}
