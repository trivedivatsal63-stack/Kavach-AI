import { AppError } from "../middleware/errorHandler";

export const OTP_PURPOSE = {
  SIGNUP: "signup",
  LOGIN: "login",
  RESET: "reset",
} as const;

export type OtpPurpose = (typeof OTP_PURPOSE)[keyof typeof OTP_PURPOSE];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_LETTER_RE = /[A-Za-z]/;
const PASSWORD_DIGIT_RE = /\d/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseEmail(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AppError(400, "A valid email address is required.");
  }
  const email = normalizeEmail(raw);
  if (!email) {
    throw new AppError(400, "A valid email address is required.");
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new AppError(400, "Enter a valid email address.");
  }
  return email;
}

export function parseExistingPassword(raw: unknown): string {
  if (typeof raw !== "string" || !raw) {
    throw new AppError(400, "Email and password are required.");
  }
  if (raw.length > 128) {
    throw new AppError(400, "Email and password are required.");
  }
  return raw;
}

export function parsePassword(raw: unknown, label = "Password"): string {
  if (typeof raw !== "string") {
    throw new AppError(400, `${label} is required.`);
  }
  const password = raw;
  if (!password) {
    throw new AppError(400, `${label} is required.`);
  }
  if (password.length < 8) {
    throw new AppError(400, `${label} must be at least 8 characters.`);
  }
  if (password.length > 128) {
    throw new AppError(400, `${label} must be at most 128 characters.`);
  }
  if (/\s/.test(password)) {
    throw new AppError(400, `${label} cannot contain spaces.`);
  }
  if (!PASSWORD_LETTER_RE.test(password) || !PASSWORD_DIGIT_RE.test(password)) {
    throw new AppError(
      400,
      `${label} must include at least one letter and one number.`
    );
  }
  return password;
}

export function parseName(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") {
    throw new AppError(400, "Name must be text.");
  }
  const name = raw.trim();
  if (!name) return null;
  if (name.length > 80) {
    throw new AppError(400, "Name must be at most 80 characters.");
  }
  return name;
}

export function parseOtpCode(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AppError(400, "Enter the 6-digit code from your email.");
  }
  const code = raw.trim();
  if (!/^\d{6}$/.test(code)) {
    throw new AppError(400, "Enter the 6-digit code from your email.");
  }
  return code;
}

export function parseOtpPurpose(raw: unknown): OtpPurpose {
  if (
    raw === OTP_PURPOSE.SIGNUP ||
    raw === OTP_PURPOSE.LOGIN ||
    raw === OTP_PURPOSE.RESET
  ) {
    return raw;
  }
  throw new AppError(400, "Invalid verification purpose.");
}
