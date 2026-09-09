export function getTerminationCooldown(terminatedAt, cooldownDays = 30) {
  if (!terminatedAt) return { inCooldown: false, remainingDays: 0 };

  const startDate = new Date(terminatedAt);
  const expiryDate = new Date(startDate);
  expiryDate.setDate(startDate.getDate() + cooldownDays);

  const today = new Date();
  const diffTime = expiryDate - today;
  const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return {
    inCooldown: remainingDays > 0,
    remainingDays: Math.max(0, remainingDays),
    expiryDate: expiryDate.toLocaleDateString(),
  };
}