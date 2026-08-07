import { prisma } from "../models/prisma";
import { pool } from "../models/rag/pool";
import { isUuid } from "../utils/uuid";

/**
 * Local/dev cleanup: User.id is UUID going forward. Rows created with the
 * old cuid() default cannot mint valid JWTs under the UUID auth rules, so
 * remove them (ApiKey cascades via Prisma). RAG tables have no FK to User —
 * clear matching user_id rows best-effort.
 */
export async function purgeLegacyNonUuidUsers(): Promise<void> {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const legacy = users.filter((u) => !isUuid(u.id));
  if (legacy.length === 0) return;

  const ids = legacy.map((u) => u.id);
  console.warn(
    `[db] Removing ${ids.length} legacy non-UUID user(s) (${legacy
      .map((u) => u.email)
      .join(", ")}). Sign up again to get a UUID user id.`
  );

  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  await Promise.allSettled([
    pool.query(`DELETE FROM rag_chat_keys WHERE user_id = ANY($1::text[])`, [ids]),
    pool.query(`DELETE FROM rag_keys WHERE user_id = ANY($1::text[])`, [ids]),
    pool.query(
      `UPDATE rag_documents SET deleted_at = now(), status = 'failed', error = 'User migrated to UUID auth.'
       WHERE user_id = ANY($1::text[]) AND deleted_at IS NULL`,
      [ids]
    ),
  ]);
}
