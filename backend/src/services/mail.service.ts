import nodemailer from "nodemailer";
import { env } from "../config";

function resolvedHost(): string {
  if (env.smtpHost) return env.smtpHost;
  const user = env.smtpUser.toLowerCase();
  if (user.endsWith("@gmail.com") || user.endsWith("@googlemail.com")) {
    return "smtp.gmail.com";
  }
  return "";
}

function resolvedFrom(): string {
  if (env.smtpFrom.includes("@")) return env.smtpFrom;
  if (env.smtpUser.includes("@")) {
    const label = env.smtpFrom || "Kavach";
    return `${label} <${env.smtpUser}>`;
  }
  return "";
}

function smtpReady(): boolean {
  return Boolean(resolvedHost() && resolvedFrom().includes("@"));
}

export function smtpStatus(): string {
  if (!smtpReady()) {
    return "disabled (set SMTP_HOST and SMTP_FROM, or SMTP_USER for Gmail)";
  }
  return `enabled via ${resolvedHost()}`;
}

function transporter() {
  const pass = env.smtpPass.replace(/\s+/g, "");
  const user = env.smtpUser.trim();
  return nodemailer.createTransport({
    host: resolvedHost(),
    port: env.smtpPort,
    secure: env.smtpSecure || env.smtpPort === 465,
    auth: user || pass ? { user, pass } : undefined,
  });
}

export async function sendOtpEmail(input: {
  to: string;
  purpose: string;
  code: string;
}): Promise<void> {
  const subject =
    input.purpose === "reset"
      ? "Your Kavach password reset code"
      : input.purpose === "signup"
        ? "Verify your Kavach email"
        : "Your Kavach login code";

  const body =
    `Your 6-digit code is ${input.code}.\n\n` +
    `It expires in 10 minutes. If you did not request this, you can ignore this email.`;

  if (!smtpReady()) {
    console.warn(
      `[mail] SMTP is not configured (${smtpStatus()}). OTP for ${input.purpose} ${input.to}: ${input.code}`
    );
    return;
  }

  try {
    await transporter().sendMail({
      from: resolvedFrom(),
      to: input.to,
      subject,
      text: body,
      html: `<p>Your 6-digit code is <strong style="font-size:18px;letter-spacing:0.2em">${input.code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
    });
  } catch (err) {
    console.error("[mail] Failed to send OTP email:", err);
    throw err;
  }
}
