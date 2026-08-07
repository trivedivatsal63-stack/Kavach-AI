import { prisma } from "../models/prisma";
import { updateLiteLLMKeyBudget } from "./litellm.service";

/** Stub top-up — replaces real payment processing for local/dev. */
const MOCK_TOP_UP_AMOUNT_USD = 10;

export async function topUp(userId: string) {
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { creditBalanceUsd: { increment: MOCK_TOP_UP_AMOUNT_USD } },
  });
  const newBalance = updatedUser.creditBalanceUsd.toNumber();

  const activeKeys = await prisma.apiKey.findMany({
    where: { userId, revokedAt: null },
  });
  await Promise.all(
    activeKeys.map((k) => updateLiteLLMKeyBudget(k.litellmKeyId, newBalance))
  );

  return { creditBalanceUsd: newBalance, keysUpdated: activeKeys.length };
}
