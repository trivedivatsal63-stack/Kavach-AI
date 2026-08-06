import { useState, type FormEvent } from "react";
import { testKey, ApiError, type TestKeyResponse } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { KeyTestResult } from "../components/KeyTestResult";

const DEFAULT_MESSAGE = "Say hello in one sentence.";

export function TestKeyPage() {
  const { token } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [result, setResult] = useState<TestKeyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !apiKey.trim()) return;
    setResult(null);
    setError(null);
    setPending(true);
    try {
      const res = await testKey(token, apiKey.trim(), message.trim() || undefined);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to test key.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Layout>
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg space-y-6">
          <div>
            <h1 className="text-2xl font-semibold">Test an API key</h1>
            <p className="mt-1 text-sm text-gray-500">
              Send a real prompt through any key and see the model&apos;s
              actual response — no curl or Postman needed.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="apiKey" className="text-sm font-medium">
                API key
              </label>
              <input
                id="apiKey"
                type="text"
                required
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="message" className="text-sm font-medium">
                Test message
              </label>
              <input
                id="message"
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
              />
            </div>
            <button
              type="submit"
              disabled={pending || !apiKey.trim()}
              className="w-full rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
            >
              {pending ? "Testing… (this hits a live model, may take a moment)" : "Test"}
            </button>
          </form>

          {(result || error) && <KeyTestResult result={result} error={error} />}
        </div>
      </div>
    </Layout>
  );
}
