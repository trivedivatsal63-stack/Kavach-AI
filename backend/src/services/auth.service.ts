import bcrypt from "bcryptjs";
import { prisma } from "../models/prisma";
import { env } from "../config";
import { signJwt } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { USER_ROLE } from "../utils/roles";
import { assertCanAuthenticate } from "./accountStatus.service";

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

export async function signup(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const name = (input.name ?? "").trim();

  if (!email || !password) {
    throw new AppError(400, "Email and password are required.");
  }
  if (password.length < 8) {
    throw new AppError(400, "Password must be at least 8 characters.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, "An account with that email already exists.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      hashedPassword,
      name: name || null,
      role: roleForEmail(email, USER_ROLE.USER),
    },
  });

  return {
    token: signJwt({ userId: user.id }),
    user: toUserDto(user),
  };
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    throw new AppError(400, "Email and password are required.");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError(401, "Invalid email or password.");
  }

  const passwordsMatch = await bcrypt.compare(password, user.hashedPassword);
  if (!passwordsMatch) {
    throw new AppError(401, "Invalid email or password.");
  }

  assertCanAuthenticate(user);

  const nextRole = roleForEmail(email, user.role);
  const fresh =
    nextRole === user.role
      ? user
      : await prisma.user.update({
          where: { id: user.id },
          data: { role: nextRole },
        });

  return {
    token: signJwt({ userId: fresh.id }),
    user: toUserDto(fresh),
  };
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
