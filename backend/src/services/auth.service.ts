import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../models/prisma";
import { env } from "../config";
import { signJwt } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { USER_ROLE } from "../utils/roles";
import { assertCanAuthenticate } from "./accountStatus.service";
import { issueOtp, consumeOtp } from "./otp.service";
import {
  OTP_PURPOSE,
  parseEmail,
  parseExistingPassword,
  parseName,
  parseOtpCode,
  parseOtpPurpose,
  parsePassword,
  type OtpPurpose,
} from "../utils/authValidation";

export interface AuthUserDto {
  id: string;
  email: string;
  name: string | null;
  creditBalanceUsd: number;
  role: string;
  status: string;
}

export interface AuthResult {
  token: string;
  user: AuthUserDto;
}

export interface OtpChallenge {
  requiresOtp: true;
  email: string;
}

export function toUserDto(user: {
  id: string;
  email: string;
  name: string | null;
  creditBalanceUsd: { toNumber(): number };
  role: string;
  status: string;
}): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    creditBalanceUsd: user.creditBalanceUsd.toNumber(),
    role: user.role,
    status: user.status,
  };
}

function roleForEmail(email: string, existingRole: string): string {
  if (env.superadminEmail && email === env.superadminEmail) {
    return USER_ROLE.SUPERADMIN;
  }
  return existingRole;
}

function sessionFor(user: Parameters<typeof toUserDto>[0]): AuthResult {
  return {
    token: signJwt({ userId: user.id }),
    user: toUserDto(user),
  };
}

export async function signup(input: {
  email: unknown;
  password: unknown;
  name?: unknown;
}): Promise<OtpChallenge> {
  const email = parseEmail(input.email);
  const password = parsePassword(input.password);
  const name = parseName(input.name);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.deletedAt) {
    throw new AppError(409, "An account with that email already exists.");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const payload: Prisma.InputJsonValue = {
    passwordHash,
    name,
  };
  await issueOtp({ email, purpose: OTP_PURPOSE.SIGNUP, payload });
  return { requiresOtp: true, email };
}

export async function login(input: {
  email: unknown;
  password: unknown;
}): Promise<OtpChallenge> {
  const email = parseEmail(input.email);
  const password = parseExistingPassword(input.password);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError(401, "Invalid email or password.");
  }

  const passwordsMatch = await bcrypt.compare(password, user.hashedPassword);
  if (!passwordsMatch) {
    throw new AppError(401, "Invalid email or password.");
  }

  assertCanAuthenticate(user);
  await issueOtp({ email, purpose: OTP_PURPOSE.LOGIN });
  return { requiresOtp: true, email };
}

export async function verifyOtp(input: {
  email: unknown;
  purpose: unknown;
  code: unknown;
}): Promise<AuthResult> {
  const email = parseEmail(input.email);
  const purpose = parseOtpPurpose(input.purpose);
  const code = parseOtpCode(input.code);

  if (purpose === OTP_PURPOSE.RESET) {
    throw new AppError(400, "Use the reset-password endpoint for that code.");
  }

  const payload = await consumeOtp({ email, purpose, code });

  if (purpose === OTP_PURPOSE.SIGNUP) {
    return completeSignup(email, payload);
  }
  return completeLogin(email);
}

async function completeSignup(
  email: string,
  payload: Prisma.JsonValue | null
): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.deletedAt) {
    throw new AppError(409, "An account with that email already exists.");
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof payload.passwordHash !== "string"
  ) {
    throw new AppError(400, "That code is invalid or has expired.");
  }

  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim().slice(0, 80)
      : null;

  const user = await prisma.user.create({
    data: {
      email,
      hashedPassword: payload.passwordHash,
      name,
      role: roleForEmail(email, USER_ROLE.USER),
      emailVerifiedAt: new Date(),
    },
  });
  return sessionFor(user);
}

async function completeLogin(email: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError(400, "That code is invalid or has expired.");
  }
  assertCanAuthenticate(user);

  const nextRole = roleForEmail(email, user.role);
  const fresh = await prisma.user.update({
    where: { id: user.id },
    data: {
      role: nextRole,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });
  return sessionFor(fresh);
}

export async function resendOtp(input: {
  email: unknown;
  purpose: unknown;
}): Promise<OtpChallenge> {
  const email = parseEmail(input.email);
  const purpose = parseOtpPurpose(input.purpose);

  if (purpose === OTP_PURPOSE.SIGNUP) {
    const pending = await prisma.emailOtp.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!pending?.payload) {
      throw new AppError(
        400,
        "Start sign up again to receive a new code."
      );
    }
    await issueOtp({
      email,
      purpose,
      payload: pending.payload as Prisma.InputJsonValue,
    });
    return { requiresOtp: true, email };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt) {
    // Same shape as a real resend so this cannot be used to probe emails.
    return { requiresOtp: true, email };
  }
  if (purpose === OTP_PURPOSE.LOGIN) {
    assertCanAuthenticate(user);
  }
  await issueOtp({ email, purpose });
  return { requiresOtp: true, email };
}

export async function forgotPassword(input: {
  email: unknown;
}): Promise<{ ok: true }> {
  const email = parseEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.deletedAt) {
    try {
      assertCanAuthenticate(user);
      await issueOtp({ email, purpose: OTP_PURPOSE.RESET });
    } catch (err) {
      if (err instanceof AppError && err.status === 429) throw err;
      // Blocked/deleted/mail failures: still return ok so the form cannot
      // be used to discover which emails have accounts.
    }
  }
  return { ok: true };
}

export async function resetPassword(input: {
  email: unknown;
  code: unknown;
  password: unknown;
}): Promise<{ ok: true }> {
  const email = parseEmail(input.email);
  const code = parseOtpCode(input.code);
  const password = parsePassword(input.password, "New password");

  await consumeOtp({ email, purpose: OTP_PURPOSE.RESET, code });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt) {
    throw new AppError(400, "That code is invalid or has expired.");
  }
  assertCanAuthenticate(user);

  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { hashedPassword, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
  });
  return { ok: true };
}

export async function me(userId: string): Promise<AuthUserDto> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new AppError(401, "Invalid or expired token");
  }
  assertCanAuthenticate(user);
  return toUserDto(user);
}

/**
 * Promote SUPERADMIN_EMAIL if set; otherwise the earliest account when the
 * table has no superadmin yet (local-dev bootstrap).
 */
export async function bootstrapSuperadmin(): Promise<void> {
  const configured = env.superadminEmail;
  if (configured) {
    const result = await prisma.user.updateMany({
      where: { email: configured, deletedAt: null },
      data: { role: USER_ROLE.SUPERADMIN },
    });
    if (result.count > 0) {
      console.log(`[auth] Superadmin role granted to ${configured}`);
    }
    return;
  }

  const existing = await prisma.user.count({
    where: { role: USER_ROLE.SUPERADMIN, deletedAt: null },
  });
  if (existing > 0) return;

  const first = await prisma.user.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!first) return;

  await prisma.user.update({
    where: { id: first.id },
    data: { role: USER_ROLE.SUPERADMIN },
  });
  console.log(
    `[auth] No SUPERADMIN_EMAIL set; promoted first user ${first.email} to superadmin`
  );
}

export type { OtpPurpose };
