"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { updateLiteLLMKeyBudget } from "@/lib/litellm";

// Stub top-up amount. In place of real payment processing (e.g. Razorpay,
// Stripe) — no card details, no payment intent, just simulates a
// successful top-up so the credit -> real-budget wiring can be tested.
const MOCK_TOP_UP_AMOUNT_USD = 10;

export type TopUpResult = { newBalance: number } | { error: string };

export async function topUpCredits(): Promise<TopUpResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated." };
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        creditBalanceUsd: { increment: MOCK_TOP_UP_AMOUNT_USD },
      },
    });
    const newBalance = updatedUser.creditBalanceUsd.toNumber();

    // Keep every active key's real LiteLLM budget in sync with the new
    // balance — the DB number alone means nothing without this.
    const activeKeys = await prisma.apiKey.findMany({
      where: { userId: session.user.id, revokedAt: null },
    });
    await Promise.all(
      activeKeys.map((k) =>
        updateLiteLLMKeyBudget(k.litellmKeyId, newBalance)
      )
    );

    revalidatePath("/dashboard");
    return { newBalance };
  } catch (err) {
    console.error("topUpCredits failed:", err);
    return { error: "Failed to top up credits." };
  }
}
