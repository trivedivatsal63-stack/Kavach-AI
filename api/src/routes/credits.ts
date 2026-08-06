import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { updateLiteLLMKeyBudget } from "../litellm";

export const creditsRouter = Router();
creditsRouter.use(requireAuth);

// Stub top-up amount. In place of real payment processing (e.g. Razorpay,
// Stripe) — no card details, no payment intent, just simulates a
// successful top-up so the credit -> real-budget wiring can be tested.
const MOCK_TOP_UP_AMOUNT_USD = 10;

creditsRouter.post("/topup", async (req, res) => {
  const userId = req.userId!;

  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { creditBalanceUsd: { increment: MOCK_TOP_UP_AMOUNT_USD } },
    });
    const newBalance = updatedUser.creditBalanceUsd.toNumber();

    // Keep every active key's real LiteLLM budget in sync with the new
    // balance — the DB number alone means nothing without this.
    const activeKeys = await prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
    });
    await Promise.all(
      activeKeys.map((k) => updateLiteLLMKeyBudget(k.litellmKeyId, newBalance))
    );

    res.json({ creditBalanceUsd: newBalance, keysUpdated: activeKeys.length });
  } catch (err) {
    console.error("POST /credits/topup failed:", err);
    res.status(500).json({ error: "Failed to top up credits." });
  }
});
