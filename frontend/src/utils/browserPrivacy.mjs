const profileCache = new Map();
export const readProfileCache = key => profileCache.get(key);
export const writeProfileCache = (key, value) => profileCache.set(key, value);
export const clearProfileCache = key => profileCache.delete(key);

export function minimalLoginSession(value = {}) {
  const employee = value.employeeData;
  const state = { email: value.email, step: value.step, otpMethod: value.otpMethod, expiresAt: value.expiresAt };
  if (typeof value.challengeId === 'string' && /^[a-f0-9]{32}$/.test(value.challengeId)) state.challengeId = value.challengeId;
  if (employee && typeof employee === 'object') {
    state.employeeData = {};
    for (const key of ['id', 'company_id', 'email', 'first_name', 'last_name', 'role', 'requires_password_change']) {
      if (employee[key] !== undefined) state.employeeData[key] = employee[key];
    }
    state.employeeData.hasTotp = Boolean(employee.hasTotp || employee.totp_enabled || employee.has_totp || employee._auth_metadata?.totp_enabled);
    state.employeeData.has_registered_biometrics = Boolean(employee.has_registered_biometrics || employee._auth_metadata?.has_registered_biometrics);
  }
  return state;
}

export function writeLoginSession(storage, value) {
  storage.setItem('cpoint_login_2fa_session', JSON.stringify(minimalLoginSession(value)));
}
