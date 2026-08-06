import { NextResponse } from "next/server";

// Deliberately has no dependencies (no DB, no auth) — its only job is to
// confirm the Next.js server itself is up and serving requests.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
