import { describe, expect, it } from "vitest";
import {
  parseEmail,
  parseOtpCode,
  parsePassword,
} from "./authValidation";
import { AppError } from "../middleware/errorHandler";

function messageOf(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (err) {
    return err instanceof AppError ? err.message : String(err);
  }
}

describe("authValidation", () => {
  it("rejects malformed emails", () => {
    expect(messageOf(() => parseEmail("not-an-email"))).toMatch(/valid email/i);
    expect(parseEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("requires a letter and a number in new passwords", () => {
    expect(messageOf(() => parsePassword("short"))).toMatch(/8 characters/i);
    expect(messageOf(() => parsePassword("lettersonly"))).toMatch(/letter and one number/i);
    expect(messageOf(() => parsePassword("12345678"))).toMatch(/letter and one number/i);
    expect(parsePassword("ValidPass1")).toBe("ValidPass1");
  });

  it("accepts only a 6-digit OTP", () => {
    expect(messageOf(() => parseOtpCode("12ab56"))).toMatch(/6-digit/i);
    expect(parseOtpCode(" 042187 ")).toBe("042187");
  });
});
