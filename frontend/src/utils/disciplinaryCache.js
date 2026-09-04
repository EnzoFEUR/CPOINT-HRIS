/**
 * Helper for caching and synchronizing employee disciplinary status across views.
 */

const CACHE_KEY = (userId) => `hris_disciplinary_${userId}`;
const LEGACY_KEY = (userId) => `disciplinary_${userId}`;

export function getDisciplinaryCache(userId) {
  if (!userId) {
    return { type: null, record: null, isSuspended: false, isTerminated: false, checked: false };
  }

  try {
    let raw = localStorage.getItem(CACHE_KEY(userId));
    if (!raw) raw = localStorage.getItem(LEGACY_KEY(userId));

    if (raw) {
      const parsed = JSON.parse(raw);
      const isTerminated = parsed.type === 'Termination' || parsed.status === 'Terminated';
      const isSuspended = parsed.type === 'Suspension' || parsed.status === 'Suspended';
      return {
        type: isTerminated ? 'Termination' : isSuspended ? 'Suspension' : 'Clean',
        record: parsed.record || null,
        isSuspended,
        isTerminated,
        checked: true
      };
    }
  } catch (e) {
    console.warn('Error reading disciplinary cache:', e);
  }

  // Fallback check against stored user status
  try {
    const rawUser = localStorage.getItem('user');
    if (rawUser) {
      const u = JSON.parse(rawUser);
      if (u && (u.status === 'inactive' || u.is_active === false || u.status === 'terminated')) {
        const isTerm = Boolean(u.is_terminated || u.status === 'terminated' || u.status === 'inactive');
        return {
          type: isTerm ? 'Termination' : 'Suspension',
          record: null,
          isSuspended: !isTerm,
          isTerminated: isTerm,
          checked: true
        };
      }
    }
  } catch (e) {}

  return { type: null, record: null, isSuspended: false, isTerminated: false, checked: false };
}

export function setDisciplinaryCache(userId, statusObj) {
  if (!userId) return;
  try {
    const payload = {
      type: statusObj?.type || 'Clean',
      record: statusObj?.record || null,
      updatedAt: Date.now()
    };
    const serialized = JSON.stringify(payload);
    localStorage.setItem(CACHE_KEY(userId), serialized);
    localStorage.setItem(LEGACY_KEY(userId), serialized);

    window.dispatchEvent(new CustomEvent('hris_disciplinary_sync', {
      detail: { userId, ...payload }
    }));
  } catch (e) {
    console.warn('Error setting disciplinary cache:', e);
  }
}

export function clearDisciplinaryCache(userId) {
  if (!userId) return;
  try {
    const payload = { type: 'Clean', record: null, updatedAt: Date.now() };
    const serialized = JSON.stringify(payload);
    localStorage.setItem(CACHE_KEY(userId), serialized);
    localStorage.setItem(LEGACY_KEY(userId), serialized);

    window.dispatchEvent(new CustomEvent('hris_disciplinary_sync', {
      detail: { userId, ...payload }
    }));
  } catch (e) {
    console.warn('Error clearing disciplinary cache:', e);
  }
}
