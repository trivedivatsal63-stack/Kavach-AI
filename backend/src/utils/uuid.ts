import { randomUUID } from "crypto";

/** RFC 4122 UUID v1–v5 (case-insensitive). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function newUuid(): string {
  return randomUUID();
}
