import { createHash, randomInt, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../models/prisma";
import { AppError } from "../middleware/errorHandler";
import { type OtpPurpose } from "../utils/authValidation";
import { sendOtpEmail } from "./mail.service";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(email: string, purpose: string, code: string): string {
  return createHash("sha256")
    .update(`${email}:${purpose}:${code}`)
    .digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function issueOtp(input: {
  email: string;
  purpose: OtpPurpose;
  payload?: Prisma.InputJsonValue;
}): Promise<void> {
  const recent = await prisma.emailOtp.findFirst({
    where: { email: input.email, purpose: input.purpose },
    orderBy: { createdAt: "desc" },
  });
  if (
    recent &&
    !recent.consumedAt &&
    Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    throw new AppError(
      429,
      "Wait a minute before requesting another code."
    );
  }

  await prisma.emailOtp.updateMany({
    where: {
      email: input.email,
      purpose: input.purpose,
      consumedAt: null,
    },
    data: { consumedAt: new Date() },
  });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.emailOtp.create({
    data: {
      email: input.email,
      purpose: input.purpose,
      codeHash: hashCode(input.email, input.purpose, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      payload: input.payload,
    },
  });

  try {
    await sendOtpEmail({ to: input.email, purpose: input.purpose, code });
  } catch {
    throw new AppError(
      502,
      "Could not send the verification email. Try again shortly."
    );
  }
}

export async function consumeOtp(input: {
  email: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<Prisma.JsonValue | null> {
  const row = await prisma.emailOtp.findFirst({
    where: {
      email: input.email,
      purpose: input.purpose,
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!row || row.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, "That code is invalid or has expired.");
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await prisma.emailOtp.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    throw new AppError(
      400,
      "Too many incorrect attempts. Request a new code."
    );
  }

  const ok = hashesMatch(
    row.codeHash,
    hashCode(input.email, input.purpose, input.code)
  );
  if (!ok) {
    await prisma.emailOtp.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError(400, "That code is incorrect.");
  }

  await prisma.emailOtp.update({
    where: { id: row.id },
    data: { consumedAt: new Date() },
  });
  return row.payload;
}
