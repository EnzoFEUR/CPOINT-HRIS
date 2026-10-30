import { fetchWithAuth } from './api';
import { supabase } from '../supabaseClient';
import { attendanceConnectionSignal } from './offlineAttendanceTestMode.mjs';
import { applyServerReceipts, claimSync, finishSync, getDeviceKeys, listOfflineEvents, nextSyncRecord, readMeta, removeAcceptedOfflineEvents, retryDelay, saveEnrollment, validateReceiptIds, writeMeta } from './offlineAttendanceStore';

const BASE = '/api/attendance-offline';
const owner = globalThis.crypto?.randomUUID?.() || `terminal-${Date.now()}`;
let running;
let cleaning = false;

async function pendingResult(status, count = 0) {
  const pending = (await listOfflineEvents()).filter(item => ['pending', 'syncing'].includes(item.status));
  return { status, count, pending: pending.length, retry_at: pending.length ? Math.min(...pending.map(item => item.retry_at || 0)) : null, error: pending.find(item => item.last_error)?.last_error, diagnostic: pending.find(item => item.last_diagnostic)?.last_diagnostic };
}

export function offlineSyncMessage(result) {
  if (result.status === 'busy') return 'Terminal storage is busy. Captures remain saved on this device.';
  if (result.status === 'failed') return `No captures were uploaded. ${result.pending} remain pending; review the error below.`;
  if (result.count) return `${result.count} captures received for HR review. ${result.pending} still pending.`;
  if (result.pending) return `${result.pending} captures remain pending. ${result.retry_at ? `Automatic retry after ${new Date(result.retry_at).toLocaleTimeString()}.` : 'Waiting to retry.'}`;
  return 'No pending captures to upload.';
}

export function offlineDiagnosticText(diagnostic) {
  const fields = { Step: diagnostic?.stage, Code: diagnostic?.database_code, Reason: diagnostic?.reason_code, Constraint: diagnostic?.constraint, Reference: diagnostic?.request_id };
  return Object.entries(fields).filter(([, value]) => typeof value === 'string' && value).map(([label, value]) => `${label}: ${value}`).join(' · ') || 'Details not available yet. Retry after the displayed time.';
}

export async function offlineApi(path, options = {}) {
  const connectionSignal = attendanceConnectionSignal();
  const response = await fetchWithAuth(`${BASE}${path}`, { ...options, signal: AbortSignal.any([connectionSignal, options.signal || AbortSignal.timeout(30000)]) });
  let body;
  try {
    body = await response.json();
  } catch {
    body = { error: `Server returned ${response.status} (${response.statusText || 'offline endpoint unavailable'}).` };
  }
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || 'Offline attendance request failed.'), { http_status: response.status, code: body.code });
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

export async function clearAcceptedOfflineCaptures() {
  if (running || cleaning) throw new Error('Synchronization or cleanup is running. Please wait.');
  attendanceConnectionSignal();
  cleaning = true;
  try {
    const enrollment = await readMeta('enrollment');
    if (!enrollment) throw new Error('This terminal has not been enrolled.');
    const ids = (await listOfflineEvents()).filter(item => item.status === 'synced' && item.server_received === true && item.payload.device_id === enrollment.device.id).map(item => item.payload.event_id);
    if (!ids.length) return 0;
    const receipts = [];
    // Four bounded read requests at a time; no local deletion until every response succeeds.
    for (let offset = 0; offset < ids.length; offset += 200) {
      const groups = [];
      for (let start = offset; start < Math.min(offset + 200, ids.length); start += 50) groups.push(ids.slice(start, start + 50));
      const results = await Promise.all(groups.map(async batch => {
        const response = await offlineApi(`/devices/${encodeURIComponent(enrollment.device.id)}/events?ids=${encodeURIComponent(batch.join(','))}`);
        validateReceiptIds(response.results, batch);
        return response.results;
      }));
      receipts.push(...results.flat());
    }
    const refreshed = await refreshOfflineRoster();
    return await removeAcceptedOfflineEvents({ deviceId: enrollment.device.id, rosterVersion: refreshed.roster.version, receipts });
  } finally { cleaning = false; }
}

export function syncOfflineAttendance({ manual = false } = {}) {
  if (running) return running;
  if (cleaning) return pendingResult('busy');
  running = (async () => {
    attendanceConnectionSignal();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sign in online to synchronize this terminal. Pending captures remain safely stored.');
    // Authenticated roster request proves reachability and current terminal approval.
    const retry = await readMeta('sync_retry');
    if (!manual && ((retry?.held && /revoked|Only the assigned operator/i.test(retry.error || '')) || retry?.retry_at > Date.now())) return pendingResult('waiting');
    const enrollment = await readMeta('enrollment');
    if (!enrollment) throw new Error('This terminal has not been enrolled.');
    try {
      // Old valid captures must remain uploadable after the capture lease expires.
      await offlineApi(`/devices/${encodeURIComponent(enrollment.device.id)}/status`);
      await writeMeta('last_server_contact', new Date().toISOString());
      await writeMeta('sync_retry', { attempts: 0, retry_at: 0 });
    } catch (error) {
      const attempts = (retry?.attempts || 0) + 1;
      const held = error.http_status === 403 && error.code !== 'SECOND_FACTOR_REQUIRED' && /revoked|Only the assigned operator/i.test(error.message);
      await writeMeta('sync_retry', { attempts, retry_at: Date.now() + retryDelay(attempts), held, error: error.message, code: error.code });
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
    if (!batch?.length) {
      if (batch) await finishSync(owner, batch);
      const result = await pendingResult(batch === null ? 'busy' : 'waiting');
      if (!result.pending && batch !== null) result.status = 'empty';
      return result;
    }
    try {
      const response = await offlineApi('/sync', { method: 'POST', body: JSON.stringify({ device_id: enrollment.device.id, events: batch.map(({ payload, signature }) => ({ payload, signature })) }) });
      if (!Array.isArray(response.results)) throw new Error('Server did not acknowledge the uploaded events.');
      validateReceiptIds(response.results, batch.map(item => item.payload.event_id));
      await finishSync(owner, batch, response.results);
      const outcomes = batch.map(item => nextSyncRecord(item, response.results));
      const count = outcomes.filter(item => item.server_received === true).length;
      if (count) await writeMeta('last_successful_upload', new Date().toISOString());
      const result = await pendingResult(count ? 'received' : 'failed', count);
      result.error ||= outcomes.find(item => item.server_received === false)?.reason_code;
      return result;
    } catch (error) {
      await finishSync(owner, batch, [], error.message);
      throw error;
    }
  })().finally(() => { running = null; });
  return running;
}
