"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateApiKey, revokeApiKey } from "@/app/actions/apikeys";

export type ApiKeyRow = {
  id: string;
  createdAt: string;
  revokedAt: string | null;
};

export function ApiKeysPanel({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleGenerate() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await generateApiKey();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setRevealedKey(result.key);
      router.refresh();
    });
  }

  function handleRevoke(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeApiKey(id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  async function handleCopy() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
  }

  return (
    <div className="w-full max-w-xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">API Keys</h2>
        <button
          onClick={handleGenerate}
          disabled={isPending}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
        >
          {isPending ? "Working…" : "Generate new key"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {revealedKey && (
        <div className="space-y-2 rounded border border-yellow-600/50 bg-yellow-500/10 p-4">
          <p className="text-sm font-medium">
            Copy this key now — you won&apos;t be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code
              data-testid="revealed-key"
              className="flex-1 overflow-x-auto rounded bg-black/5 px-2 py-1 text-sm dark:bg-white/10"
            >
              {revealedKey}
            </code>
            <button
              onClick={handleCopy}
              className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-black/10 dark:divide-white/10">
        {initialKeys.length === 0 && (
          <li className="py-3 text-sm text-black/60 dark:text-white/60">
            No API keys yet.
          </li>
        )}
        {initialKeys.map((k) => (
          <li
            key={k.id}
            className="flex items-center justify-between py-3 text-sm"
          >
            <div>
              <p>Created {new Date(k.createdAt).toLocaleString()}</p>
              <p
                className={
                  k.revokedAt
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-600 dark:text-green-400"
                }
              >
                {k.revokedAt
                  ? `Revoked ${new Date(k.revokedAt).toLocaleString()}`
                  : "Active"}
              </p>
            </div>
            {!k.revokedAt && (
              <button
                onClick={() => handleRevoke(k.id)}
                disabled={isPending}
                className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
