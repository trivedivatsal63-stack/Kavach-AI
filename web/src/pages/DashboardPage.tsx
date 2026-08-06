import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listKeys,
  generateKey,
  revokeKey,
  getUsage,
  topUp,
  testKey,
  ApiError,
  type ApiKeySummary,
  type UsageRow,
  type TestKeyResponse,
} from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { KeyTestResult } from "../components/KeyTestResult";

export function DashboardPage() {
  const { token, user, updateUser } = useAuth();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<TestKeyResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testPending, setTestPending] = useState(false);

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
      const result = await generateKey(token);
      setRevealedKey(result.key);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate key.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      await revokeKey(token, id);
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

  if (loading || !user) {
    return (
      <Layout>
        <div className="flex flex-1 items-center justify-center px-4 py-16">
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-1 flex-col items-center gap-10 px-4 py-16">
        <h1 className="text-2xl font-semibold">Welcome, {user.email}</h1>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Credit balance + top-up */}
        <div className="w-full max-w-xl space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Credit balance</p>
              <p data-testid="credit-balance" className="text-2xl font-semibold">
                ${user.creditBalanceUsd.toFixed(2)}
              </p>
            </div>
            <button
              onClick={handleTopUp}
              disabled={busy}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
            >
              {busy ? "Working…" : "+ $10 (mock top-up)"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Stub only — simulates a successful payment. No real charge, no
            Razorpay/Stripe integration yet. Raises this balance and every
            active key&apos;s real LiteLLM max_budget to match.
          </p>
        </div>

        {/* API keys */}
        <div className="w-full max-w-xl space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">API Keys</h2>
              <Link to="/test" className="text-xs underline text-gray-500">
                Test an API key
              </Link>
            </div>
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
            >
              {busy ? "Working…" : "Generate new key"}
            </button>
          </div>

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
                  className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={handleTestRevealedKey}
                  disabled={testPending}
                  className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-gray-700"
                >
                  {testPending ? "Testing…" : "Test this key"}
                </button>
              </div>
              {(testResult || testError) && (
                <KeyTestResult result={testResult} error={testError} />
              )}
            </div>
          )}

          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {keys.length === 0 && (
              <li className="py-3 text-sm text-gray-500">No API keys yet.</li>
            )}
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between py-3 text-sm">
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
                    disabled={busy}
                    className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-gray-700"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Usage — pulled live from LiteLLM via GET /usage, no local ledger */}
        <div className="w-full max-w-xl space-y-3">
          <h2 className="text-lg font-semibold">Usage</h2>
          {usage.length === 0 ? (
            <p className="text-sm text-gray-500">No API keys yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="py-2 pr-3 font-medium">Key created</th>
                    <th className="py-2 pr-3 font-medium">Spend</th>
                    <th className="py-2 pr-3 font-medium">Requests</th>
                    <th className="py-2 pr-3 font-medium">Prompt tokens</th>
                    <th className="py-2 font-medium">Completion tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((row) => (
                    <tr
                      key={row.keyId}
                      className="border-b border-gray-100 dark:border-gray-900"
                    >
                      <td className="py-2 pr-3">
                        {new Date(row.createdAt).toLocaleDateString()}
                        {row.revokedAt && (
                          <span className="ml-1 text-red-600 dark:text-red-400">
                            (revoked)
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">${row.totalSpend.toFixed(4)}</td>
                      <td className="py-2 pr-3">{row.totalRequests}</td>
                      <td className="py-2 pr-3">{row.promptTokens}</td>
                      <td className="py-2">{row.completionTokens}</td>
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
