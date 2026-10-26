export const getRole = (user) => {
  const role = typeof user?.role === 'string' ? user.role.trim().toLowerCase() : '';
  if (role === 'guard' || role === 'security_guard') return 'security';
  return role === 'hr_manager' ? 'hr' : role;
};

// Display fields must not determine access or redirect users into restricted routes.
export const isSecurity = (user) => getRole(user) === 'security';

export const isAdmin = (user) => ['admin', 'hr'].includes(getRole(user));

export const needsProfileCompletion = (user) => {
  if (!user) return false;
  if (isAdmin(user) || isSecurity(user)) return false;
  const birthDate = user.birth_date ? String(user.birth_date).trim() : '';
  const address = user.address ? String(user.address).trim() : '';
  const phone = user.phone ? String(user.phone).trim() : '';
  const emergencyName = user.emergency_contact_name ? String(user.emergency_contact_name).trim() : '';
  return !birthDate || !address || !phone || !emergencyName;
};
