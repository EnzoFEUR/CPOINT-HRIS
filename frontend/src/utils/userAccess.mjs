export const getRole = (user) => (user?.role || '').toLowerCase();

export const isSecurity = (user) => {
  if (!user) return false;
  const r = getRole(user);
  const dept = (user?.department || '').toLowerCase();
  const title = (user?.job_title || user?.position || '').toLowerCase();
  return (
    r === 'security' ||
    r === 'guard' ||
    r === 'security_guard' ||
    dept === 'security' ||
    title.includes('security') ||
    title.includes('guard') ||
    title.includes('gate attendant')
  );
};

export const isAdmin = (user) => {
  if (!user) return false;
  const r = getRole(user);
  const dept = (user?.department || '').toLowerCase();
  return (
    r === 'admin' ||
    r === 'hr' ||
    r === 'hr_manager' ||
    dept === 'administration' ||
    dept === 'human resources'
  );
};

export const needsProfileCompletion = (user) => {
  if (!user) return false;
  if (isAdmin(user) || isSecurity(user)) return false;
  const birthDate = user.birth_date ? String(user.birth_date).trim() : '';
  const address = user.address ? String(user.address).trim() : '';
  const phone = user.phone ? String(user.phone).trim() : '';
  const emergencyName = user.emergency_contact_name ? String(user.emergency_contact_name).trim() : '';
  return !birthDate || !address || !phone || !emergencyName;
};
