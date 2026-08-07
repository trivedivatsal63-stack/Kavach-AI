import bcrypt from "bcryptjs";
import { prisma } from "../models/prisma";
import { signJwt } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

export interface AuthUserDto {
  id: string;
  email: string;
  name: string | null;
  creditBalanceUsd: number;
}

export interface AuthResult {
  token: string;
  user: AuthUserDto;
}

function toUserDto(user: {
  id: string;
  email: string;
  name: string | null;
  creditBalanceUsd: { toNumber(): number };
}): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    creditBalanceUsd: user.creditBalanceUsd.toNumber(),
  };
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
    data: { email, hashedPassword, name: name || null },
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

  return {
    token: signJwt({ userId: user.id }),
    user: toUserDto(user),
  };
}
