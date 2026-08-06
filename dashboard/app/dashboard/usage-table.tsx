export type UsageRow = {
  id: string;
  createdAt: string;
  revokedAt: string | null;
  totalSpend: number;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
};

// Plain server-rendered table — no client state, just pulled fresh from
// LiteLLM's /spend/logs/v2 on every page load (see app/dashboard/page.tsx).
export function UsageTable({ rows }: { rows: UsageRow[] }) {
  return (
    <div className="w-full max-w-xl space-y-3">
      <h2 className="text-lg font-semibold">Usage</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          No API keys yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10">
                <th className="py-2 pr-3 font-medium">Key created</th>
                <th className="py-2 pr-3 font-medium">Spend</th>
                <th className="py-2 pr-3 font-medium">Requests</th>
                <th className="py-2 pr-3 font-medium">Prompt tokens</th>
                <th className="py-2 font-medium">Completion tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-black/5 dark:border-white/5"
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
  );
}
