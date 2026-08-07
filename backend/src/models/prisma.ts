import { PrismaClient } from "@prisma/client";
import { env } from "../config";

/** Explicit URL so Prisma never silently falls back when dotenv is late. */
export const prisma = new PrismaClient({
  datasources: {
    db: { url: env.databaseUrl },
  },
});

export async function assertDatabaseConnection(): Promise<void> {
  await prisma.$queryRawUnsafe("SELECT 1");
}
