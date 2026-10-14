import { fetchWithAuth } from './api';
import { supabase } from '../supabaseClient';
import { attendanceConnectionSignal } from './offlineAttendanceTestMode.mjs';
import { applyServerReceipts, claimSync, finishSync, getDeviceKeys, listOfflineEvents, nextSyncRecord, readMeta, retryDelay, saveEnrollment, validateReceiptIds, writeMeta } from './offlineAttendanceStore';

const BASE = '/api/attendance-offline';
const owner = globalThis.crypto?.randomUUID?.() || `terminal-${Date.now()}`;
let running;

export async function offlineApi(path, options = {}) {
  const connectionSignal = attendanceConnectionSignal();
  const response = await fetchWithAuth(`${BASE}${path}`, { ...options, signal: AbortSignal.any([connectionSignal, options.signal || AbortSignal.timeout(30000)]) });
  let body;
  try {
    body = await response.json();
  } catch {
    body = { error: `Server returned ${response.status} (${response.statusText || 'offline endpoint unavailable'}).` };
  }
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || 'Offline attendance request failed.'), { http_status: response.status });
  return body.data || body;
}

export async function enrollOfflineTerminal(operatorEmail, siteId) {
  const keys = await getDeviceKeys();
  const existing = await readMeta('enrollment');
  const path = existing ? `/devices/${encodeURIComponent(existing.device.id)}/renew` : '/devices';
  const operator = existing ? { operator_id: existing.device.operator_id } : { operator_email: operatorEmail.trim().toLowerCase() };
  const response = await offlineApi(path, { method: 'POST', body: JSON.stringify({ public_key: keys.publicJwk, ...operator, site_id: siteId }) });
  await saveEnrollment(response);
  await writeMeta('capture_hold', null);
  await writeMeta('sync_retry', { attempts: 0, retry_at: 0 });
  await navigator.storage?.persist?.();
  return response;
}

export async function refreshOfflineRoster() {
  const enrollment = await readMeta('enrollment');
  if (!enrollment) throw new Error('This terminal has not been enrolled.');
  const response = await offlineApi(`/devices/${encodeURIComponent(enrollment.device.id)}/roster`);
  await saveEnrollment(response);
  return response;
}

export function syncOfflineAttendance({ manual = false } = {}) {
  if (running) return running;
  running = (async () => {
    attendanceConnectionSignal();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sign in online to synchronize this terminal. Pending captures remain safely stored.');
    // Authenticated roster request proves reachability and current terminal approval.
    const retry = await readMeta('sync_retry');
    if (!manual && (retry?.held || retry?.retry_at > Date.now())) return { count: 0 };
    const enrollment = await readMeta('enrollment');
    if (!enrollment) throw new Error('This terminal has not been enrolled.');
    try {
      // Old valid captures must remain uploadable after the capture lease expires.
      await offlineApi(`/devices/${encodeURIComponent(enrollment.device.id)}/status`);
      await writeMeta('last_server_contact', new Date().toISOString());
      await writeMeta('sync_retry', { attempts: 0, retry_at: 0 });
    } catch (error) {
      const attempts = (retry?.attempts || 0) + 1;
      await writeMeta('sync_retry', { attempts, retry_at: Date.now() + retryDelay(attempts), held: error.http_status === 403, error: error.message });
      if (error.http_status === 403 && /revoked/i.test(error.message)) await writeMeta('capture_hold', 'This terminal was revoked. Captures are locked; existing signed records remain available for encrypted backup and HR recovery.');
      throw error;
    }
    const reviewEvents = (await listOfflineEvents()).filter(item => item.server_received && ['needs_review', 'needs_verification'].includes(item.status));
    if (reviewEvents.length) {
      const cursor = (await readMeta('receipt_cursor') || 0) % reviewEvents.length;
      const awaitingReview = [...reviewEvents.slice(cursor), ...reviewEvents.slice(0, cursor)].slice(0, 50);
      const ids = awaitingReview.map(item => item.payload.event_id);
      const receipts = await offlineApi(`/devices/${encodeURIComponent(enrollment.device.id)}/events?ids=${encodeURIComponent(ids.join(','))}`);
      await applyServerReceipts(receipts.results, ids);
      await writeMeta('receipt_cursor', (cursor + awaitingReview.length) % reviewEvents.length);
    }
    const batch = await claimSync(owner);
    if (!batch?.length) { if (batch) await finishSync(owner, batch); return { count: 0 }; }
    try {
      const response = await offlineApi('/sync', { method: 'POST', body: JSON.stringify({ device_id: enrollment.device.id, events: batch.map(({ payload, signature }) => ({ payload, signature })) }) });
      if (!Array.isArray(response.results)) throw new Error('Server did not acknowledge the uploaded events.');
      validateReceiptIds(response.results, batch.map(item => item.payload.event_id));
      await finishSync(owner, batch, response.results);
      await writeMeta('last_sync', new Date().toISOString());
      return { count: batch.filter(item => nextSyncRecord(item, response.results).server_received === true).length };
    } catch (error) {
      await finishSync(owner, batch);
      throw error;
    }
  })().finally(() => { running = null; });
  return running;
}
