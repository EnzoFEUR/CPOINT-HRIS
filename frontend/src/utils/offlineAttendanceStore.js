import { canonicalEvent, validateEvent } from '../../../shared/offlineAttendance.mjs';

const DB_NAME = 'cpoint_offline_attendance_v1';
export const MAX_EVENTS = 2000;
const encoder = new TextEncoder();
let database;

export const encodeBase64Url = (value) => btoa(Array.from(new Uint8Array(value), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const decodeBase64Url = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) return reject(new Error('Secure browser storage is unavailable. Use HTTPS on an approved terminal.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta');
      request.result.createObjectStore('events', { keyPath: 'payload.event_id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = null; };
      resolve(request.result);
    };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error('Close other terminal tabs before updating offline storage.')); };
  });
  return database;
}

// Resolve only after commit: a successful request alone does not prove durable capture.
async function transaction(stores, mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Offline storage could not be committed.'));
    const fail = error => { reject(error); tx.abort(); };
    try { run(tx, value => { result = value; }, fail); } catch (error) { fail(error); }
  });
}

export const readMeta = (key) => transaction(['meta'], 'readonly', (tx, done) => {
  tx.objectStore('meta').get(key).onsuccess = event => done(event.target.result);
});
export const writeMeta = (key, value) => transaction(['meta'], 'readwrite', tx => { tx.objectStore('meta').put(value, key); });
export const listOfflineEvents = () => transaction(['events'], 'readonly', (tx, done) => {
  tx.objectStore('events').getAll().onsuccess = event => done(event.target.result.sort((a, b) => a.payload.local_sequence - b.payload.local_sequence));
});

export function getOfflineStorageStatus(count) {
  return { remaining: Math.max(0, MAX_EVENTS - count), level: count >= MAX_EVENTS ? 'full' : count >= 1900 ? 'critical' : count >= 1600 ? 'warning' : 'normal' };
}

export async function getDeviceKeys() {
  const existing = await readMeta('keys');
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const created = { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey) };
  return transaction(['meta'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('meta');
    store.get('keys').onsuccess = event => {
      const keys = event.target.result || created;
      if (!event.target.result) store.put(keys, 'keys');
      done(keys);
    };
  });
}

export async function saveEnrollment(response) {
  if (!response?.device?.id || !Array.isArray(response.roster?.employees) || !response.server_time || !response.roster.version) throw new Error('Invalid terminal approval response.');
  const { device, roster, server_time } = response;
  const enrollment = {
    device: { id: device.id, operator_id: device.operator_id, company_scope: device.company_scope, site_id: device.site_id, expires_at: device.expires_at },
    roster: { version: roster.version, generated_at: roster.generated_at, expires_at: roster.expires_at, employees: roster.employees.map(({ id, company_id, first_name, last_name }) => ({ id, company_id, first_name, last_name })), attendance: (roster.attendance || []).map(({ employee_id, date, time_in, time_out }) => ({ employee_id, date, time_in, time_out })) },
    server_time, anchor_local_time: new Date().toISOString(),
  };
  await transaction(['meta'], 'readwrite', tx => {
    const store = tx.objectStore('meta');
    store.get('enrollment').onsuccess = event => {
      if (event.target.result && event.target.result.device.id !== device.id) { tx.abort(); return; }
      store.put(enrollment, 'enrollment');
    };
  });
}

export function checkEnrollment(enrollment, now = Date.now()) {
  if (!enrollment?.device || !enrollment.roster) throw new Error('Enroll this terminal online before capturing badges.');
  const localAnchor = Date.parse(enrollment.anchor_local_time);
  const serverAnchor = Date.parse(enrollment.server_time);
  if (!Number.isFinite(localAnchor) || !Number.isFinite(serverAnchor) || now < localAnchor - 60000) throw new Error('Terminal clock changed. Reconnect before capturing badges.');
  const estimatedServerTime = serverAnchor + now - localAnchor;
  if (![enrollment.device.expires_at, enrollment.roster.expires_at].every(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > estimatedServerTime)) throw new Error('Terminal approval or roster expired. Reconnect before capturing badges.');
  return enrollment;
}

const workDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
const workDate = value => workDateFormatter.format(new Date(value));

export function canRemoveAcceptedCapture(item, receipt, enrollment) {
  if (item.status !== 'synced' || item.server_received !== true || receipt?.status !== 'synced' || receipt.event_id !== item.payload.event_id || item.payload.device_id !== enrollment.device.id || !['TIME_IN', 'TIME_OUT'].includes(item.payload.action) || !Number.isFinite(Date.parse(receipt.received_at))) return false;
  const captured = Date.parse(item.payload.captured_at);
  const snapshotTime = Date.parse(enrollment.server_time);
  if (!Number.isFinite(captured) || !Number.isFinite(snapshotTime) || captured > snapshotTime) return false;
  if (workDate(captured) !== workDate(snapshotTime) && snapshotTime - captured > 18 * 3600000) return true;
  const field = item.payload.action === 'TIME_IN' ? 'time_in' : 'time_out';
  // Keep recent evidence unless the refreshed snapshot preserves duplicate-punch checks.
  return enrollment.roster.attendance?.some(row => row.employee_id === item.payload.employee_id && Date.parse(row[field]) === captured) === true;
}

export async function removeAcceptedOfflineEvents({ deviceId, rosterVersion, receipts }) {
  if (!Array.isArray(receipts) || receipts.length > MAX_EVENTS) throw new Error('Invalid cleanup confirmations.');
  validateReceiptIds(receipts, receipts.map(receipt => receipt.event_id));
  return transaction(['meta', 'events'], 'readwrite', (tx, done, fail) => {
    const meta = tx.objectStore('meta');
    meta.get('enrollment').onsuccess = approved => {
      meta.get('sync_lease').onsuccess = lease => {
        const store = tx.objectStore('events');
        store.getAll().onsuccess = existing => {
          try {
            const enrollment = checkEnrollment(approved.target.result);
            if (enrollment.device.id !== deviceId || enrollment.roster.version !== rosterVersion) throw new Error('Terminal approval changed. Refresh and retry cleanup.');
            if (lease.target.result?.until > Date.now()) throw new Error('Synchronization is running. Wait before removing accepted copies.');
            const confirmations = new Map(receipts.map(receipt => [receipt.event_id, receipt]));
            const removable = existing.target.result.filter(item => canRemoveAcceptedCapture(item, confirmations.get(item.payload.event_id), enrollment));
            removable.forEach(item => store.delete(item.payload.event_id));
            if (removable.length) meta.put({ count: removable.length, completed_at: new Date().toISOString() }, 'last_cleanup');
            done(removable.length);
          } catch (error) { fail(error); }
        };
      };
    };
  });
}

export function assertOfflinePunchAllowed(events, attendance, employeeId, action, capturedAt) {
  const punches = new Map(attendance.filter(row => row.employee_id === employeeId).map(row => [row.date, { ...row }]));
  const openPunches = at => [...punches.values()].filter(row => row.time_in && !row.time_out && Date.parse(row.time_in) <= Date.parse(at) && Date.parse(at) - Date.parse(row.time_in) <= 18 * 3600000);
  const captures = events.filter(item => item.status !== 'rejected' && item.payload.employee_id === employeeId).sort((a, b) => Date.parse(a.payload.captured_at) - Date.parse(b.payload.captured_at));
  for (const { payload } of captures) {
    const open = payload.action === 'TIME_OUT' ? openPunches(payload.captured_at) : [];
    const date = open.length === 1 ? open[0].date : workDate(payload.captured_at);
    const punch = punches.get(date) || { date };
    const field = payload.action === 'TIME_IN' ? 'time_in' : 'time_out';
    if (!punch[field]) punch[field] = payload.captured_at;
    punches.set(date, punch);
  }
  const today = workDate(capturedAt);
  const punch = punches.get(today);
  if (action === 'TIME_OUT' && openPunches(capturedAt).length === 1) return;
  if (punch?.time_out || (action === 'TIME_OUT' && [...punches.values()].some(row => row.time_out && workDate(row.time_out) === today))) {
    throw new Error('You have already completed your attendance for this workday. Ask HR if a correction is needed.');
  }
  if (action === 'TIME_IN' && (punch?.time_in || openPunches(capturedAt).length)) {
    throw new Error('You have already timed in. Choose Time out when your shift ends.');
  }
}

export async function captureOfflineBadge({ badge, action, eventId = crypto.randomUUID() }) {
  const hold = await readMeta('capture_hold');
  if (hold) throw new Error(hold);
  if (typeof badge !== 'string' || !badge.trim() || badge.length > 100) throw new Error('Enter a valid badge ID.');
  const enrollment = checkEnrollment(await readMeta('enrollment'));
  const employee = enrollment.roster.employees.find(item => item.company_id === badge.trim());
  if (!employee) throw new Error('Badge is not in this approved terminal roster. Ask HR to verify it.');
  if (!['TIME_IN', 'TIME_OUT'].includes(action)) throw new Error('Choose Time in or Time out.');
  const keys = await readMeta('keys');
  if (!keys?.privateKey || !keys?.publicKey || keys.privateKey.extractable !== false) throw new Error('Terminal signing key is unavailable. Use the manual attendance procedure and contact HR.');
  const sequence = await transaction(['meta', 'events'], 'readwrite', (tx, done, fail) => {
    tx.objectStore('events').count().onsuccess = event => {
      if (event.target.result >= MAX_EVENTS) { fail(new Error('Storage is full. Sync pending captures, ask HR to complete reviews, then remove accepted copies.')); return; }
      const store = tx.objectStore('meta');
      store.get('sequence').onsuccess = response => {
        const next = (response.target.result || 0) + 1;
        store.put(next, 'sequence');
        done(next);
      };
    };
  });
  const now = new Date();
  const payload = {
    event_id: eventId, device_id: enrollment.device.id, employee_id: employee.id,
    company_scope: enrollment.device.company_scope, site_id: enrollment.device.site_id,
    action, captured_at: now.toISOString(), capture_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    captured_local_offset_minutes: -now.getTimezoneOffset(), server_time_anchor: enrollment.server_time,
    local_sequence: sequence, roster_snapshot_version: enrollment.roster.version,
    event_schema_version: 1, capture_method: 'offline_badge',
  };
  validateEvent(payload);
  const signature = encodeBase64Url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, encoder.encode(canonicalEvent(payload))));
  const record = { payload, signature, status: 'pending', attempts: 0, retry_at: 0 };
  await transaction(['meta', 'events'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('events');
    tx.objectStore('meta').get('enrollment').onsuccess = approved => {
      store.getAll().onsuccess = event => {
        try {
          if (event.target.result.length >= MAX_EVENTS) throw new Error('Storage is full. Sync pending captures, ask HR to complete reviews, then remove accepted copies.');
          assertOfflinePunchAllowed(event.target.result, approved.target.result?.roster.attendance || [], employee.id, action, payload.captured_at);
          store.add(record);
        } catch (error) { fail(error); }
      };
    };
  });
  return record;
}

export async function claimSync(owner, now = Date.now()) {
  return transaction(['meta', 'events'], 'readwrite', (tx, done) => {
    const meta = tx.objectStore('meta');
    meta.get('sync_lease').onsuccess = event => {
      if (event.target.result?.until > now && event.target.result.owner !== owner) { done(null); return; }
      meta.put({ owner, until: now + 90000 }, 'sync_lease');
      const store = tx.objectStore('events');
      store.getAll().onsuccess = response => {
        const batch = response.target.result.filter(item => ['pending', 'syncing'].includes(item.status) && (item.retry_at || 0) <= now).sort((a, b) => a.payload.local_sequence - b.payload.local_sequence).slice(0, 10);
        batch.forEach(item => store.put({ ...item, status: 'syncing' }));
        done(batch);
      };
    };
  });
}

export const retryDelay = (attempts, random = Math.random()) => Math.min(300000, 2000 * 2 ** Math.min(attempts, 8)) * (0.75 + random * 0.5);

export function nextSyncRecord(item, results, now = Date.now(), random = Math.random()) {
  const result = results.find(result => result.event_id === item.payload.event_id);
  const receiptTime = result?.acknowledged_at || result?.received_at;
  if (['needs_review', 'needs_verification', 'rejected', 'synced'].includes(result?.status) && typeof receiptTime === 'string' && Number.isFinite(Date.parse(receiptTime))) {
    return { ...item, status: result.status, received_at: result.received_at, acknowledged_at: result.acknowledged_at, reason_code: result.reason_code, attendance_reference: result.attendance_reference, server_received: true, retry_at: 0, last_error: null, last_diagnostic: null };
  }
  if (result?.status === 'error' && [400, 403, 409].includes(result.http_status)) {
    return { ...item, status: 'rejected', reason_code: String(result.error || `UPLOAD_${result.http_status}`), server_received: false, retry_at: 0, last_error: null, last_diagnostic: result.diagnostic || null };
  }
  const attempts = (item.attempts || 0) + 1;
  return { ...item, status: 'pending', attempts, retry_at: now + retryDelay(attempts, random), last_error: result?.error || item.last_error || 'Server did not confirm this capture. It remains saved for retry.', last_diagnostic: result?.diagnostic || item.last_diagnostic || null };
}

export async function finishSync(owner, batch, results = [], errorMessage) {
  await transaction(['meta', 'events'], 'readwrite', tx => {
    const meta = tx.objectStore('meta');
    meta.get('sync_lease').onsuccess = lease => {
      if (lease.target.result?.owner !== owner) return;
      const store = tx.objectStore('events');
      for (const item of batch) {
        store.put(nextSyncRecord(errorMessage ? { ...item, last_error: errorMessage } : item, results));
      }
      meta.delete('sync_lease');
    };
  });
}

export function validateReceiptIds(results, ids) {
  if (!Array.isArray(results)) throw new Error('Server did not return event receipts.');
  const seen = new Set();
  for (const result of results) {
    if (!result || !ids.includes(result.event_id) || seen.has(result.event_id)) throw new Error('Server returned mismatched or duplicate event receipts.');
    seen.add(result.event_id);
  }
}

export async function applyServerReceipts(results, ids) {
  validateReceiptIds(results, ids);
  await transaction(['events'], 'readwrite', tx => {
    const store = tx.objectStore('events');
    for (const result of results) {
      store.get(result.event_id).onsuccess = event => {
        const item = event.target.result;
        if (!item?.server_received) return;
        const updated = nextSyncRecord(item, [result]);
        if (updated.server_received && ['needs_review', 'needs_verification', 'rejected', 'synced'].includes(updated.status) && typeof (result.received_at || result.acknowledged_at) === 'string' && Number.isFinite(Date.parse(result.received_at || result.acknowledged_at))) store.put(updated);
      };
    }
  });
}

async function backupKey(password, salt, usage) {
  if (password.length < 12) throw new Error('Use a backup password of at least 12 characters.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, key, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function exportOfflineBackup(password) {
  const enrollment = await readMeta('enrollment');
  if (!enrollment) throw new Error('No enrolled terminal to back up.');
  const events = (await listOfflineEvents()).filter(item => item.status !== 'synced');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(password, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify({ device_id: enrollment.device.id, events })));
  return JSON.stringify({ version: 1, salt: encodeBase64Url(salt), iv: encodeBase64Url(iv), ciphertext: encodeBase64Url(ciphertext) });
}

export async function importOfflineBackup(text, password) {
  if (text.length > 5_000_000) throw new Error('Backup is too large.');
  const envelope = JSON.parse(text);
  if (envelope.version !== 1) throw new Error('Unsupported backup version.');
  const key = await backupKey(password, decodeBase64Url(envelope.salt), ['decrypt']);
  let backup;
  try { backup = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64Url(envelope.iv) }, key, decodeBase64Url(envelope.ciphertext)))); }
  catch { throw new Error('Backup password is incorrect or the backup is damaged.'); }
  const enrollment = await readMeta('enrollment');
  const keys = await readMeta('keys');
  if (!keys || backup.device_id !== enrollment?.device.id || !Array.isArray(backup.events) || backup.events.length > MAX_EVENTS) throw new Error('Restore this backup on its original enrolled terminal.');
  for (const item of backup.events) {
    validateEvent(item.payload);
    if (item.payload.device_id !== enrollment.device.id || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, decodeBase64Url(item.signature), encoder.encode(canonicalEvent(item.payload)))) throw new Error('Backup contains an invalid signed event.');
  }
  await transaction(['meta', 'events'], 'readwrite', tx => {
    const store = tx.objectStore('events');
    store.getAll().onsuccess = response => {
      const existing = response.target.result;
      const ids = new Set(existing.map(item => item.payload.event_id));
      const added = backup.events.filter(item => !ids.has(item.payload.event_id));
      if (existing.length + added.length > MAX_EVENTS) { tx.abort(); return; }
      added.forEach(item => store.add({ payload: item.payload, signature: item.signature, status: 'pending', attempts: 0, retry_at: 0 }));
      const meta = tx.objectStore('meta');
      meta.get('sequence').onsuccess = sequence => meta.put(Math.max(sequence.target.result || 0, ...backup.events.map(item => item.payload.local_sequence)), 'sequence');
    };
  });
  return backup.events.length;
}
