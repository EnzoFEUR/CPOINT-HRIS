export function isBiometricSetupTestAccess(user, env = import.meta.env, hostname = globalThis.location?.hostname, now = Date.now()) {
    if (env?.DEV !== true || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return false;
    if (!user?.id || user.id !== env.VITE_TEST_BIOMETRIC_SETUP_EMPLOYEE_ID) return false;
    const expiry = Date.parse(env.VITE_TEST_BIOMETRIC_SETUP_EXPIRES_AT);
    // Only navigation is waived; enrollment and server attendance authorization remain authoritative.
    return Number.isFinite(expiry) && now < expiry;
}
