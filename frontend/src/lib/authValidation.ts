const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return "A valid email address is required.";
  if (value.length > 254 || !EMAIL_RE.test(value)) {
    return "Enter a valid email address.";
  }
  return null;
}

export function validatePassword(
  password: string,
  label = "Password"
): string | null {
  if (!password) return `${label} is required.`;
  if (password.length < 8) return `${label} must be at least 8 characters.`;
  if (password.length > 128) return `${label} must be at most 128 characters.`;
  if (/\s/.test(password)) return `${label} cannot contain spaces.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return `${label} must include at least one letter and one number.`;
  }
  return null;
}

export function validatePasswordConfirm(
  password: string,
  confirm: string
): string | null {
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

export function validateOtp(code: string): string | null {
  if (!/^\d{6}$/.test(code.trim())) {
    return "Enter the 6-digit code from your email.";
  }
  return null;
}

export function validateName(name: string): string | null {
  if (name.trim().length > 80) return "Name must be at most 80 characters.";
  return null;
}
