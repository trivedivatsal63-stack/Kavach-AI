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
import { Badge } from "../components/Badge";
import { Spinner } from "../components/Spinner";
import { KeyTestResult } from "../components/KeyTestResult";
import { CodeBlock } from "../components/CodeBlock";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4001";

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
  const [showGenModal, setShowGenModal] = useState(false);
  const [genName, setGenName] = useState("");
  const [genScope, setGenScope] = useState<"general" | "compliance">("general");
  const [genExpiresIn, setGenExpiresIn] = useState("30d");
  const [lastGenScope, setLastGenScope] = useState<string | null>(null);

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
      const result = await generateKey(token, { scope: genScope, name: genName.trim() || undefined, expiresIn: genExpiresIn });
      setRevealedKey(result.key);
      setLastGenScope(result.scope ?? genScope);
      setShowGenModal(false);
      setGenName("");
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

  const activeKeys = keys.filter((k) => !k.revokedAt).length;
  const totalSpend = usage.reduce((sum, row) => sum + row.totalSpend, 0);

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
                onClick={() => setShowGenModal(true)}
                disabled={busy}
                className="btn-primary"
              >
                Generate new key
              </button>
            </div>
          </div>

          {showGenModal && (
            <div className="border-b border-gray-200 bg-gray-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
              <h3 className="text-sm font-semibold">Generate new API key</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium">Key name
                  <input value={genName} onChange={(e) => setGenName(e.target.value)} placeholder="e.g. WDM compliance prod" className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm dark:bg-black" maxLength={80} />
                </label>
                <label className="text-xs font-medium">Expiration
                  <select value={genExpiresIn} onChange={(e) => setGenExpiresIn(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm dark:bg-black">
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                    <option value="90d">90 days</option>
                    <option value="365d">1 year</option>
                    <option value="never">Never</option>
                  </select>
                </label>
              </div>
              <div className="mt-3">
                <p className="text-xs font-medium">Key type</p>
                <div className="mt-1 flex gap-2">
                  <label className={`flex-1 cursor-pointer rounded-xl border p-3 text-sm ${genScope === "general" ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/30" : "bg-white dark:bg-black"}`}>
                    <input type="radio" className="mr-2" checked={genScope === "general"} onChange={() => setGenScope("general")} /> Normal
                    <span className="block text-xs text-gray-500">For chat, RAG, completions</span>
                  </label>
                  <label className={`flex-1 cursor-pointer rounded-xl border p-3 text-sm ${genScope === "compliance" ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30" : "bg-white dark:bg-black"}`}>
                    <input type="radio" className="mr-2" checked={genScope === "compliance"} onChange={() => setGenScope("compliance")} /> Compliance check
                    <span className="block text-xs text-gray-500">For POST /v1/compliance/query</span>
                  </label>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={handleGenerate} disabled={busy} className="btn-primary">{busy ? "Generating…" : "Generate"}</button>
                <button onClick={() => setShowGenModal(false)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          )}

          {revealedKey && (
            <div className="border-b border-amber-200/60 bg-amber-50/60 p-5 dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="text-sm font-medium">
                Copy this key now — you won&apos;t be able to see it again. {lastGenScope === "compliance" && <span className="text-emerald-700">(Compliance key)</span>}
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
              </div>
              {lastGenScope === "compliance" && (
                <div className="mt-3 space-y-3 rounded-lg border bg-white p-3 dark:bg-black">
                  <p className="text-sm font-semibold">Compliance flow — OpenAI compatible ✓</p>
                  <p className="text-xs text-gray-600">Dedicated endpoint:</p>
                  <CodeBlock code={`curl ${API_BASE_URL}/v1/compliance/query \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"sources":["SEBI","RBI"],"lookbackDays":7}'`} />
                  <p className="text-xs text-gray-600">OpenAI-compatible (same key, no code change):</p>
                  <CodeBlock code={`from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${API_BASE_URL}/v1",\n    api_key="YOUR_KEY",\n)\n\nresp = client.chat.completions.create(\n    model="harrier-compliance",\n    messages=[{"role":"user","content":"check compliance"}],\n)\n\nprint(resp.choices[0].message.content)`} />
                  <p className="text-xs text-gray-500">Both return the same table; OpenAI path returns <code className="rounded bg-gray-100 px-1 dark:bg-neutral-800">choices[0].message.content</code> as JSON + <code className="rounded bg-gray-100 px-1 dark:bg-neutral-800">compliance.table</code>. Works with any OpenAI SDK.</p>
                </div>
              )}
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
              const isExpired = (k as any).expiresAt && new Date((k as any).expiresAt) < new Date();
              return (
              <li
                key={k.id}
                className="flex items-center justify-between gap-4 p-4 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {(k as any).name || <span className="text-gray-400 italic">Unnamed key</span>} { (k as any).scope === "compliance" && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Compliance</span> } {(k as any).scope !== "compliance" && (k as any).scope !== "general" && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs">{(k as any).scope}</span> }
                  </p>
                  <p className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                    {k.id}
                  </p>
                  <p className="mt-1 text-xs">
                    Created {new Date(k.createdAt).toLocaleString()} {(k as any).expiresAt ? <span>· Expires {new Date((k as any).expiresAt).toLocaleDateString()} {isExpired && <span className="text-red-600 font-medium">(Expired)</span>}</span> : <span>· Never expires</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant={k.revokedAt || isExpired ? "danger" : "success"}>
                    {k.revokedAt ? "Revoked" : isExpired ? "Expired" : "Active"}
                  </Badge>
                  {!k.revokedAt && !isExpired && (
                    <button
                      onClick={() => void handleRevoke(k.id)}
                      disabled={busy}
                      className="btn-danger"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            )})}
          </ul>
        </div>

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
