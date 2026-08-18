import { prisma } from "../models/prisma";
import { pool } from "../models/rag/pool";
import { Prisma } from "@prisma/client";
import { AppError } from "../middleware/errorHandler";
import { isUuid } from "../utils/uuid";
import {
  ADMIN_ACTION,
  isSuperadmin,
  USER_ROLE,
  USER_STATUS,
} from "../utils/roles";
import {
  revokeLiteLLMKey,
  updateLiteLLMKeyBudget,
  getLiteLLMKeyUsage,
} from "./litellm.service";
import { listRagKeys } from "./rag/keys.service";

type AdminAction = (typeof ADMIN_ACTION)[keyof typeof ADMIN_ACTION];

async function loadTarget(id: string) {
  if (!isUuid(id)) {
    throw new AppError(400, "Invalid user id.");
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError(404, "User not found.");
  }
  return user;
}

function assertCanManage(
  adminId: string,
  target: { id: string; role: string; deletedAt: Date | null },
  opts?: { allowDeleted?: boolean }
) {
  if (target.id === adminId) {
    throw new AppError(400, "You cannot perform this action on your own account.");
  }
  if (isSuperadmin(target.role)) {
    throw new AppError(403, "Cannot modify another superadmin.");
  }
  if (target.deletedAt && !opts?.allowDeleted) {
    throw new AppError(409, "This account has already been deleted.");
  }
}

async function audit(input: {
  adminId: string;
  targetUserId: string;
  action: AdminAction;
  detail?: Record<string, unknown>;
}) {
  await prisma.adminAuditLog.create({
    data: {
      adminId: input.adminId,
      targetUserId: input.targetUserId,
      action: input.action,
      detail:
        input.detail === undefined
          ? undefined
          : (input.detail as Prisma.InputJsonValue),
    },
  });
}

async function liveLiteLLMTokenIds(userId: string): Promise<string[]> {
  const apiKeys = await prisma.apiKey.findMany({
    where: { userId, revokedAt: null },
    select: { litellmKeyId: true },
  });
  const ragKeys = await listRagKeys(userId);
  const chat = await pool.query<{ token_id: string }>(
    `SELECT token_id FROM rag_chat_keys WHERE user_id = $1`,
    [userId]
  );
  return [
    ...apiKeys.map((k) => k.litellmKeyId),
    ...ragKeys.filter((k) => !k.revokedAt).map((k) => k.tokenId),
    ...chat.rows.map((r) => r.token_id),
  ];
}

async function freezeLiveKeys(userId: string): Promise<void> {
  const ids = await liveLiteLLMTokenIds(userId);
  await Promise.all(
    ids.map((tokenId) => updateLiteLLMKeyBudget(tokenId, 0).catch(() => {}))
  );
}

async function restoreLiveKeyBudgets(
  userId: string,
  maxBudget: number
): Promise<void> {
  const ids = await liveLiteLLMTokenIds(userId);
  await Promise.all(
    ids.map((tokenId) =>
      updateLiteLLMKeyBudget(tokenId, maxBudget).catch(() => {})
    )
  );
}

async function revokeEveryKey(userId: string): Promise<number> {
  const apiKeys = await prisma.apiKey.findMany({
    where: { userId, revokedAt: null },
  });
  const ragKeys = (await listRagKeys(userId)).filter((k) => !k.revokedAt);
  const chat = await pool.query<{ token_id: string }>(
    `SELECT token_id FROM rag_chat_keys WHERE user_id = $1`,
    [userId]
  );

  const tokenIds = [
    ...apiKeys.map((k) => k.litellmKeyId),
    ...ragKeys.map((k) => k.tokenId),
    ...chat.rows.map((r) => r.token_id),
  ];
  await Promise.all(
    tokenIds.map((tokenId) => revokeLiteLLMKey(tokenId).catch(() => {}))
  );

  if (apiKeys.length > 0) {
    await prisma.apiKey.updateMany({
      where: { id: { in: apiKeys.map((k) => k.id) } },
      data: { revokedAt: new Date() },
    });
  }
  if (ragKeys.length > 0) {
    await pool.query(
      `UPDATE rag_keys SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  }
  if (chat.rows.length > 0) {
    await pool.query(`DELETE FROM rag_chat_keys WHERE user_id = $1`, [userId]);
  }

  return tokenIds.length;
}

function userSummary(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  deletedAt: Date | null;
  creditBalanceUsd: { toNumber(): number };
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    deletedAt: user.deletedAt,
    creditBalanceUsd: user.creditBalanceUsd.toNumber(),
    createdAt: user.createdAt,
  };
}

export async function listUsers(query: {
  q?: string;
  includeDeleted?: boolean;
}) {
  const q = query.q?.trim().toLowerCase();
  const users = await prisma.user.findMany({
    where: {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { apiKeys: true, conversations: true } },
      conversations: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { updatedAt: true },
      },
    },
  });

  return users.map((user) => ({
    ...userSummary(user),
    apiKeyCount: user._count.apiKeys,
    conversationCount: user._count.conversations,
    lastActiveAt: user.conversations[0]?.updatedAt ?? user.createdAt,
  }));
}

export async function getUserActivity(id: string) {
  const user = await loadTarget(id);

  const [apiKeys, ragKeys, conversations, auditLogs] = await Promise.all([
    prisma.apiKey.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
    }),
    listRagKeys(id),
    prisma.conversation.findMany({
      where: { userId: id },
      orderBy: { updatedAt: "desc" },
      take: 40,
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { role: true, content: true, createdAt: true },
        },
      },
    }),
    prisma.adminAuditLog.findMany({
      where: { targetUserId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const apiKeyActivity = await Promise.all(
    apiKeys.map(async (k) => {
      const usage = await getLiteLLMKeyUsage(k.litellmKeyId).catch(() => ({
        totalSpend: 0,
        totalRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
      }));
      return {
        id: k.id,
        kind: "api" as const,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
        ...usage,
      };
    })
  );

  const ragKeyActivity = await Promise.all(
    ragKeys.map(async (k) => {
      const usage = await getLiteLLMKeyUsage(k.tokenId).catch(() => ({
        totalSpend: 0,
        totalRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
      }));
      return {
        id: k.id,
        kind: "rag" as const,
        name: k.name,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
        ...usage,
      };
    })
  );

  return {
    user: userSummary(user),
    keys: [...apiKeyActivity, ...ragKeyActivity],
    conversations: conversations.map((c) => ({
      id: c.id,
      mode: c.mode,
      title: c.title,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
      messageCount: c._count.messages,
      lastMessage: c.messages[0]
        ? {
            role: c.messages[0].role,
            preview: c.messages[0].content.slice(0, 180),
            createdAt: c.messages[0].createdAt,
          }
        : null,
    })),
    audit: auditLogs.map((row) => ({
      id: row.id,
      adminId: row.adminId,
      action: row.action,
      detail: row.detail,
      createdAt: row.createdAt,
    })),
  };
}

export async function pauseUser(adminId: string, id: string) {
  const target = await loadTarget(id);
  assertCanManage(adminId, target);
  if (target.status === USER_STATUS.PAUSED) {
    throw new AppError(409, "This account is already paused.");
  }
  if (target.status === USER_STATUS.BLOCKED) {
    throw new AppError(409, "Unblock this account before pausing it.");
  }

  await freezeLiveKeys(id);
  const updated = await prisma.user.update({
    where: { id },
    data: { status: USER_STATUS.PAUSED },
  });
  await audit({ adminId, targetUserId: id, action: ADMIN_ACTION.PAUSE });
  return userSummary(updated);
}

export async function unpauseUser(adminId: string, id: string) {
  const target = await loadTarget(id);
  assertCanManage(adminId, target);
  if (target.status !== USER_STATUS.PAUSED) {
    throw new AppError(409, "This account is not paused.");
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status: USER_STATUS.ACTIVE },
  });
  await restoreLiveKeyBudgets(id, updated.creditBalanceUsd.toNumber());
  await audit({ adminId, targetUserId: id, action: ADMIN_ACTION.UNPAUSE });
  return userSummary(updated);
}

export async function blockUser(adminId: string, id: string) {
  const target = await loadTarget(id);
  assertCanManage(adminId, target);
  if (target.status === USER_STATUS.BLOCKED) {
    throw new AppError(409, "This account is already blocked.");
  }

  const revoked = await revokeEveryKey(id);
  const updated = await prisma.user.update({
    where: { id },
    data: { status: USER_STATUS.BLOCKED },
  });
  await audit({
    adminId,
    targetUserId: id,
    action: ADMIN_ACTION.BLOCK,
    detail: { keysRevoked: revoked },
  });
  return userSummary(updated);
}

export async function unblockUser(adminId: string, id: string) {
  const target = await loadTarget(id);
  assertCanManage(adminId, target);
  if (target.status !== USER_STATUS.BLOCKED) {
    throw new AppError(409, "This account is not blocked.");
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status: USER_STATUS.ACTIVE },
  });
  await audit({ adminId, targetUserId: id, action: ADMIN_ACTION.UNBLOCK });
  return userSummary(updated);
}

export async function softDeleteUser(adminId: string, id: string) {
  const target = await loadTarget(id);
  assertCanManage(adminId, target);
  const revoked = await revokeEveryKey(id);
  const updated = await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), status: USER_STATUS.BLOCKED },
  });
  await audit({
    adminId,
    targetUserId: id,
    action: ADMIN_ACTION.SOFT_DELETE,
    detail: { keysRevoked: revoked },
  });
  return userSummary(updated);
}

export async function restoreUser(adminId: string, id: string) {
  const target = await loadTarget(id);
  assertCanManage(adminId, target, { allowDeleted: true });
  if (!target.deletedAt) {
    throw new AppError(409, "This account is not deleted.");
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { deletedAt: null, status: USER_STATUS.ACTIVE, role: USER_ROLE.USER },
  });
  await audit({ adminId, targetUserId: id, action: ADMIN_ACTION.RESTORE });
  return userSummary(updated);
}

export async function revokeUserKey(
  adminId: string,
  userId: string,
  keyId: string,
  kind: "api" | "rag"
) {
  const target = await loadTarget(userId);
  assertCanManage(adminId, target, { allowDeleted: true });
  if (!isUuid(keyId)) {
    throw new AppError(400, "Invalid key id.");
  }

  if (kind === "api") {
    const apiKey = await prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!apiKey || apiKey.userId !== userId) {
      throw new AppError(404, "Key not found.");
    }
    if (apiKey.revokedAt) {
      throw new AppError(409, "Key already revoked.");
    }
    await revokeLiteLLMKey(apiKey.litellmKeyId).catch(() => {});
    const updated = await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    await audit({
      adminId,
      targetUserId: userId,
      action: ADMIN_ACTION.REVOKE_KEY,
      detail: { kind, keyId },
    });
    return { id: updated.id, kind, revokedAt: updated.revokedAt };
  }

  const rag = await pool.query<{
    id: string;
    user_id: string;
    token_id: string;
    revoked_at: Date | null;
  }>(
    `SELECT id, user_id, token_id, revoked_at FROM rag_keys WHERE id = $1`,
    [keyId]
  );
  const row = rag.rows[0];
  if (!row || row.user_id !== userId) {
    throw new AppError(404, "Key not found.");
  }
  if (row.revoked_at) {
    throw new AppError(409, "Key already revoked.");
  }
  await revokeLiteLLMKey(row.token_id).catch(() => {});
  const updated = await pool.query<{ id: string; revoked_at: Date }>(
    `UPDATE rag_keys SET revoked_at = now() WHERE id = $1
     RETURNING id, revoked_at`,
    [keyId]
  );
  await audit({
    adminId,
    targetUserId: userId,
    action: ADMIN_ACTION.REVOKE_KEY,
    detail: { kind, keyId },
  });
  return {
    id: updated.rows[0].id,
    kind,
    revokedAt: updated.rows[0].revoked_at,
  };
}

export async function revokeAllUserKeys(adminId: string, userId: string) {
  const target = await loadTarget(userId);
  assertCanManage(adminId, target, { allowDeleted: true });
  const revoked = await revokeEveryKey(userId);
  await audit({
    adminId,
    targetUserId: userId,
    action: ADMIN_ACTION.REVOKE_ALL_KEYS,
    detail: { keysRevoked: revoked },
  });
  return { keysRevoked: revoked };
}
