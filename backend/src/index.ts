import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config";
import { assertDatabaseConnection, prisma } from "./models/prisma";
import { ensureSchema } from "./models/rag/pool";
import { markInterruptedAsFailed } from "./services/rag/documents.service";
import { pingQdrant } from "./services/rag/qdrant.service";
import { purgeLegacyNonUuidUsers } from "./jobs/purgeLegacyUsers";
import { bootstrapSuperadmin } from "./services/auth.service";
import { smtpStatus } from "./services/mail.service";
import { startComplianceCron } from "./routes/compliance.routes";

async function bootstrap() {
  try {
    await assertDatabaseConnection();
    await ensureSchema();
    await purgeLegacyNonUuidUsers();
    await bootstrapSuperadmin();
    await markInterruptedAsFailed();
    console.log(`[db] Connected to Postgres (${maskDbUrl(env.databaseUrl)})`);
  } catch (err) {
    console.error("[db] Postgres connection FAILED:", err);
    console.error(
      "[db] Check backend/.env DATABASE_URL (use 127.0.0.1), that the postgres service is running, and that database \"dashboard\" exists."
    );
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }

  try {
    await pingQdrant();
    console.log("[rag] Qdrant reachable");
  } catch (err) {
    console.warn(
      `[rag] Qdrant not running on ${env.qdrantUrl} — RAG unavailable; auth/keys still work.`
    );
    console.warn(String(err));
  }

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`API listening on port ${env.port}`);
    console.log(`LiteLLM gateway expected at ${env.litellmBaseUrl}`);
    console.log(`[mail] SMTP ${smtpStatus()}`);
    startComplianceCron();
    console.log(`[compliance] Cron started (24h)`);
  });
}

function maskDbUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(invalid DATABASE_URL)";
  }
}

void bootstrap();
