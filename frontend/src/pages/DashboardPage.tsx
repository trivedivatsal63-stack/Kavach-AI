import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listKeys,
  generateKey,
  renameKey,
  revokeKey,
  getUsage,
  topUp,
  testKey,
  ApiError,
  KEY_EXPIRY_PRESETS,
  expiryIsoFromDays,
  type ApiKeySummary,
  type KeyStatus,
  type UsageRow,
  type TestKeyResponse,
} from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { Badge } from "../components/Badge";
import { Spinner } from "../components/Spinner";
import { KeyTestResult } from "../components/KeyTestResult";

export function DashboardPage() {
  const { token, user, updateUser } = useAuth();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedMeta, setRevealedMeta] = useState<{
    name: string;
    keyPrefix: string;
    expiresAt: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<TestKeyResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testPending, setTestPending] = useState(false);
  // Generate modal
  const [showGenerate, setShowGenerate] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [expiryDays, setExpiryDays] = useState<number | null>(30);
  // Inline rename + revoke confirm
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);

  const spendByKeyId = new Map(usage.map((u) => [u.keyId, u]));

  const refresh = useCallback(async () => {
    if (!token) return;
    const [keysResult, usageResult] = await Promise.all([
      listKeys(token),
      getUsage(token),
    ]);
    setKeys(keysResult);
    setUsage(usageResult);
  }, [token]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function handleGenerate() {
    if (!token) return;
    setError(null);
    setCopied(false);
    setBusy(true);
    setTestResult(null);
    setTestError(null);
    try {
      const trimmed = keyName.trim();
      const result = await generateKey(token, {
        ...(trimmed ? { name: trimmed } : {}),
        ...(expiryDays != null ? { expiresAt: expiryIsoFromDays(expiryDays) as string } : {}),
      });
      setRevealedKey(result.key);
      setRevealedMeta({
        name: result.name,
        keyPrefix: result.keyPrefix,
        expiresAt: result.expiresAt,
      });
      setShowGenerate(false);
      setKeyName("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate key.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    if (!token) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    setError(null);
    try {
      const updated = await renameKey(token, id, trimmed);
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, name: updated.name } : k)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to rename key.");
    } finally {
      setRenamingId(null);
    }
  }

  async function handleRevoke(id: string) {
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      await revokeKey(token, id);
      setRevokeTarget(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke key.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTopUp() {
    if (!token || !user) return;
    setError(null);
    setBusy(true);
    try {
      const result = await topUp(token);
      updateUser({ ...user, creditBalanceUsd: result.creditBalanceUsd });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to top up credits.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
  }

  async function handleTestRevealedKey() {
    if (!token || !revealedKey) return;
    setTestResult(null);
    setTestError(null);
    setTestPending(true);
    try {
      const result = await testKey(token, revealedKey);
      setTestResult(result);
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : "Failed to test key.");
    } finally {
      setTestPending(false);
    }
  }

  const activeKeys = keys.filter((k) => !k.revokedAt).length;
  const totalSpend = usage.reduce((sum, row) => sum + row.totalSpend, 0);

  function statusBadgeVariant(status: KeyStatus): "success" | "warning" | "danger" | "info" {
    switch (status) {
      case "active":
        return "success";
      case "expiring-soon":
        return "warning";
      case "expired":
      case "revoked":
        return "danger";
    }
  }

  function statusLabel(status: KeyStatus): string {
    switch (status) {
      case "active":
        return "Active";
      case "expiring-soon":
        return "Expiring soon";
      case "expired":
        return "Expired";
      case "revoked":
        return "Revoked";
    }
  }

  function expiryText(expiresAt: string | null): string {
    if (!expiresAt) return "Never expires";
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return `Expired ${new Date(expiresAt).toLocaleDateString()}`;
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
  }

  if (loading || !user) {
    return (
      <Layout>
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500">
          <Spinner />
          Loading…
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome, {user.name || user.email}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage keys, credits and usage for your API access.
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="card p-5">
            <div className="flex items-start justify-between">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Credit balance
              </p>
              <button
                onClick={handleTopUp}
                disabled={busy}
                className="btn-secondary px-3 py-1 text-xs"
              >
                {busy ? "Working…" : "+ $10 mock top-up"}
              </button>
            </div>
            <p
              data-testid="credit-balance"
              className="mt-2 text-3xl font-bold tracking-tight"
            >
              ${user.creditBalanceUsd.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Stub payment — updates every key&apos;s real LiteLLM budget.
            </p>
          </div>

          <div className="card p-5">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Active API keys
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight">
              {activeKeys}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {keys.length - activeKeys > 0
                ? `${keys.length - activeKeys} revoked`
                : "No revoked keys"}
            </p>
          </div>

          <div className="card p-5">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Total spend
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight">
              ${totalSpend.toFixed(4)}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Across all keys (live from LiteLLM)
            </p>
          </div>
        </div>

        {/* API keys */}
        <div className="card">
          <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-neutral-800">
            <div>
              <h2 className="text-base font-semibold">API keys</h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Keys minted in LiteLLM with a budget equal to your balance.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/test" className="link text-xs">
                Test an API key
              </Link>
              <button
                onClick={() => setShowGenerate(true)}
                disabled={busy}
                className="btn-primary"
              >
                Generate new key
              </button>
            </div>
          </div>

          {revealedKey && (
            <div className="border-b border-amber-200/60 bg-amber-50/60 p-5 dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="text-sm font-medium">
                {revealedMeta?.name ?? "New key"} ·{" "}
                <span className="font-mono text-xs">{revealedMeta?.keyPrefix}</span>
                {revealedMeta?.expiresAt
                  ? ` · expires ${new Date(revealedMeta.expiresAt).toLocaleDateString()}`
                  : " · never expires"}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Copy this key now — you won&apos;t be able to see it again.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code
                  data-testid="revealed-key"
                  className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-sm dark:bg-black"
                >
                  {revealedKey}
                </code>
                <button onClick={handleCopy} className="btn-secondary">
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={handleTestRevealedKey}
                  disabled={testPending}
                  className="btn-primary"
                >
                  {testPending ? "Testing…" : "Test this key"}
                </button>
                <button
                  onClick={() => {
                    setRevealedKey(null);
                    setRevealedMeta(null);
                  }}
                  className="btn-ghost"
                >
                  Dismiss
                </button>
              </div>
              {(testResult || testError) && (
                <div className="mt-3">
                  <KeyTestResult result={testResult} error={testError} />
                </div>
              )}
            </div>
          )}

          <ul className="divide-y divide-gray-100 dark:divide-neutral-800">
            {keys.length === 0 && (
              <li className="p-5 text-sm text-gray-500 dark:text-gray-400">
                No API keys yet. Generate your first one above.
              </li>
            )}
            {keys.map((k) => {
              const spend = spendByKeyId.get(k.id)?.totalSpend;
              return (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-4 p-4 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    {renamingId === k.id ? (
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value.slice(0, 60))}
                        onBlur={() => void handleRename(k.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleRename(k.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        autoFocus
                        className="input max-w-xs py-1 text-sm"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          if (k.status === "revoked") return;
                          setRenamingId(k.id);
                          setRenameValue(k.name);
                        }}
                        title={k.status === "revoked" ? k.name : "Click to rename"}
                        className="truncate font-medium text-gray-900 dark:text-gray-100"
                      >
                        {k.name}
                      </button>
                    )}
                    <p className="mt-0.5 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                      {k.keyPrefix || k.id}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                      Created {new Date(k.createdAt).toLocaleDateString()} ·{" "}
                      {expiryText(k.expiresAt)}
                      {spend != null && spend > 0 && (
                        <> · ${spend.toFixed(4)} spent</>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant={statusBadgeVariant(k.status)}>
                      {statusLabel(k.status)}
                    </Badge>
                    {(k.status === "active" || k.status === "expiring-soon") && (
                      <button
                        onClick={() => setRevokeTarget(k)}
                        disabled={busy}
                        className="btn-danger"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Generate modal */}
        {showGenerate && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => !busy && setShowGenerate(false)}
          >
            <div
              className="card w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-semibold">Generate API key</h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Named, optionally expiring, shown once.
              </p>
              <label className="label mt-4" htmlFor="key-name">
                Name
              </label>
              <input
                id="key-name"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value.slice(0, 60))}
                placeholder="e.g. Production server"
                className="input"
                autoFocus
              />
              <p className="label mt-4">Expires</p>
              <div className="flex flex-wrap gap-2">
                {KEY_EXPIRY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setExpiryDays(p.days)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      expiryDays === p.days
                        ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-neutral-700 dark:text-gray-300 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowGenerate(false)}
                  disabled={busy}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={busy}
                  className="btn-primary"
                >
                  {busy ? "Generating…" : "Generate key"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Revoke confirm */}
        {revokeTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => !busy && setRevokeTarget(null)}
          >
            <div
              className="card w-full max-w-sm p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-semibold">Revoke key?</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {revokeTarget.name}
                </span>{" "}
                <span className="font-mono text-xs">{revokeTarget.keyPrefix}</span>{" "}
                will stop working immediately. This cannot be undone.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setRevokeTarget(null)}
                  disabled={busy}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleRevoke(revokeTarget.id)}
                  disabled={busy}
                  className="btn-danger px-4 py-2"
                >
                  {busy ? "Revoking…" : "Revoke key"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Usage */}
        <div className="card overflow-hidden">
          <div className="border-b border-gray-100 p-5 dark:border-neutral-800">
            <h2 className="text-base font-semibold">Usage</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Pulled live from LiteLLM — no local ledger.
            </p>
          </div>
          {usage.length === 0 ? (
            <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
              No usage yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 dark:border-neutral-800 dark:text-gray-400">
                    <th className="px-5 py-3 font-medium">Key created</th>
                    <th className="px-5 py-3 font-medium">Spend</th>
                    <th className="px-5 py-3 font-medium">Requests</th>
                    <th className="px-5 py-3 font-medium">Prompt tokens</th>
                    <th className="px-5 py-3 font-medium">Completion tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((row) => (
                    <tr
                      key={row.keyId}
                      className="border-b border-gray-100 last:border-0 dark:border-neutral-800"
                    >
                      <td className="px-5 py-3">
                        {new Date(row.createdAt).toLocaleString()}
                        {row.revokedAt && (
                          <span className="ml-2 text-xs text-red-500">
                            (revoked)
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-medium">
                        ${row.totalSpend.toFixed(4)}
                      </td>
                      <td className="px-5 py-3">{row.totalRequests}</td>
                      <td className="px-5 py-3">{row.promptTokens}</td>
                      <td className="px-5 py-3">{row.completionTokens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
