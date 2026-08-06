"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { topUpCredits } from "@/app/actions/credits";

export function CreditsPanel({ balance }: { balance: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleTopUp() {
    setError(null);
    startTransition(async () => {
      const result = await topUpCredits();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="w-full max-w-xl space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-black/60 dark:text-white/60">
            Credit balance
          </p>
          <p className="text-2xl font-semibold">${balance.toFixed(2)}</p>
        </div>
        <button
          onClick={handleTopUp}
          disabled={isPending}
          className="rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20"
        >
          {isPending ? "Adding…" : "+ $10 (mock top-up)"}
        </button>
      </div>
      <p className="text-xs text-black/50 dark:text-white/50">
        Stub only — simulates a successful payment. No real charge, no
        Razorpay/Stripe integration yet. Raises this balance and every
        active key&apos;s real LiteLLM max_budget to match.
      </p>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
