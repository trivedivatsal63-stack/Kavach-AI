import type { TestKeyResponse } from "../lib/api";

export function KeyTestResult({
  result,
  error,
}: {
  result: TestKeyResponse | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded border border-red-600/50 bg-red-500/10 p-3 text-sm">
        <p className="font-medium text-red-700 dark:text-red-400">
          Test failed
        </p>
        <p className="mt-1 text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="space-y-2 rounded border border-green-600/50 bg-green-500/10 p-3 text-sm">
        <p className="font-medium text-green-700 dark:text-green-400">
          Model replied
        </p>
        <p className="whitespace-pre-wrap">{result.reply}</p>
        <p className="text-xs text-gray-500">
          {result.latencyMs}ms
          {result.promptTokens != null && result.completionTokens != null && (
            <>
              {" · "}
              {result.promptTokens} prompt + {result.completionTokens}{" "}
              completion tokens
            </>
          )}
        </p>
      </div>
    );
  }

  return null;
}
