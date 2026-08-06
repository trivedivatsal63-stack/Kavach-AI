import type { TestKeyResponse } from "../lib/api";
import { Badge } from "./Badge";

export function KeyTestResult({
  result,
  error,
}: {
  result: TestKeyResponse | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900/60 dark:bg-red-950/40">
        <div className="flex items-center gap-2">
          <Badge variant="danger">Failed</Badge>
        </div>
        <p className="mt-2 text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/40">
        <div className="flex items-center gap-2">
          <Badge variant="success">Model replied</Badge>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-gray-800 dark:text-gray-200">
          {result.reply}
        </p>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
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
