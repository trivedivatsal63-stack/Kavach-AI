"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateLiteLLMKey, revokeLiteLLMKey } from "@/lib/litellm";

export type GenerateKeyResult = { key: string } | { error: string };

export async function generateApiKey(): Promise<GenerateKeyResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated." };
  }

  try {
    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
    });
    // The key's real spending cap in LiteLLM is set from the user's
    // current credit balance, not litellm/config.yaml's static default —
    // that's what makes the balance an actual enforcement mechanism.
    const maxBudget = dbUser.creditBalanceUsd.toNumber();

    const { key, tokenId } = await generateLiteLLMKey(
      session.user.id,
      maxBudget
    );
    await prisma.apiKey.create({
      data: {
        userId: session.user.id,
        litellmKeyId: tokenId,
      },
    });
    revalidatePath("/dashboard");
    // The raw key is returned here and only here — it is never written to
    // our database, so this is the one and only chance to show it.
    return { key };
  } catch (err) {
    console.error("generateApiKey failed:", err);
    return { error: "Failed to generate key." };
  }
}

export type RevokeKeyResult = { ok: true } | { error: string };

export async function revokeApiKey(apiKeyId: string): Promise<RevokeKeyResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated." };
  }

  const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!apiKey || apiKey.userId !== session.user.id) {
    return { error: "Key not found." };
  }
  if (apiKey.revokedAt) {
    return { error: "Key already revoked." };
  }

  try {
    await revokeLiteLLMKey(apiKey.litellmKeyId);
    await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date() },
    });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    console.error("revokeApiKey failed:", err);
    return { error: "Failed to revoke key." };
  }
}
