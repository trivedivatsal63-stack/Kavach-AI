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
      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-10 sm:px-6">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Test an API key
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Send a real prompt through any key and see the model&apos;s
              response — no curl or Postman needed.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="card space-y-4 p-6">
            <div>
              <label htmlFor="apiKey" className="label">
                API key
              </label>
              <input
                id="apiKey"
                type="text"
                required
                placeholder="sk-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input font-mono"
              />
            </div>
            <div>
              <label htmlFor="message" className="label">
                Test message
              </label>
              <input
                id="message"
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="input"
              />
            </div>
            <button
              type="submit"
              disabled={pending || !apiKey.trim()}
              className="btn-primary w-full"
            >
              {pending
                ? "Testing… (live model, may take a moment)"
                : "Run test"}
            </button>
          </form>

          {(result || error) && (
            <KeyTestResult result={result} error={error} />
          )}
        </div>
      </div>
    </Layout>
  );
}
