export const PASSWORD_REUSE_MESSAGE = 'Choose a new password. You cannot reuse your current password.';

export const isPasswordReuseError = error => error?.code === 'same_password' || error?.code === 'PASSWORD_REUSED';
