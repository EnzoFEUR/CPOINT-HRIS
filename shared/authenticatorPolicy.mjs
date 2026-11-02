export const BACKUP_CODE_MAX_LENGTH = 39;

export function normalizeAuthenticatorCode(value) {
    return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function isAuthenticatorBackupCode(value) {
    const code = normalizeAuthenticatorCode(value);
    return /^CP-[A-F0-9]{4}-[A-F0-9]{4}$/.test(code) || /^CP2-[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/.test(code);
}
