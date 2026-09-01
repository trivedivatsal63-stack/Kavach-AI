import { useState } from "react";

export interface CompliancePoint {
  pointIndex: number;
  text: string;
  applicable: string;
  reason: string | null;
  deadline: string | null;
  checklist: { label: string; done: boolean }[] | null;
}
export interface ComplianceRow {
  id: string;
  source: string;
  title: string;
  url: string;
  pdfUrl?: string | null;
  publishedAt: string | null;
  points: CompliancePoint[];
  applicableCount: number;
}

function aggregate(row: ComplianceRow) {
  if (!row.points.length) return { label: "—", tone: "gray", reason: "—", deadline: null as string | null };
  const hasApplicable = row.points.some((p) => p.applicable === "APPLICABLE");
  const hasReview = row.points.some((p) => p.applicable === "REVIEW");
  const label = hasApplicable ? "APPLICABLE" : hasReview ? "REVIEW" : "NOT_APPLICABLE";
  const tone = hasApplicable ? "bg-emerald-100 text-emerald-800 border-emerald-200" : hasReview ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-gray-100 text-gray-600 border-gray-200";
  // pick first meaningful reason/deadline from applicable point else first point
  const primary = row.points.find((p) => p.applicable === label) ?? row.points[0];
  return { label, tone, reason: primary.reason ?? "—", deadline: primary.deadline, primary };
}

export function ComplianceTable({ rows }: { rows: ComplianceRow[] }) {
  const [filter, setFilter] = useState<"ALL" | "APPLICABLE" | "NOT_APPLICABLE" | "REVIEW">("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!rows.length) return <p className="text-sm text-gray-500">No circulars in selected window.</p>;

  const filtered = rows.filter((r) => {
    if (filter === "ALL") return true;
    const agg = aggregate(r).label;
    return agg === filter;
  });

  const counts = {
    ALL: rows.length,
    APPLICABLE: rows.filter((r) => aggregate(r).label === "APPLICABLE").length,
    NOT_APPLICABLE: rows.filter((r) => aggregate(r).label === "NOT_APPLICABLE").length,
    REVIEW: rows.filter((r) => aggregate(r).label === "REVIEW").length,
  };

  return (
    <div className="rounded-xl border bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b bg-gray-50 px-3 py-2 dark:bg-neutral-800">
        {(["ALL", "APPLICABLE", "NOT_APPLICABLE", "REVIEW"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${filter === f ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"}`}
          >
            {f === "ALL" ? "All" : f.replace("_", " ")} ({counts[f]})
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500">{filtered.length} shown</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-white text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 w-[42%]">Circular</th>
              <th className="px-3 py-2">Applicable</th>
              <th className="px-3 py-2 w-[28%]">Why</th>
              <th className="px-3 py-2">Deadline</th>
              <th className="px-3 py-2">Progress</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const agg = aggregate(r);
              const isOpen = expanded === r.id;
              const progress = r.points.length ? `${r.applicableCount}/${r.points.length} pts` : "—";
              return (
                <>
                  <tr key={r.id} className="border-t hover:bg-gray-50/60">
                    <td className="px-3 py-2.5 align-top">
                      <a href={r.pdfUrl ?? r.url} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline line-clamp-2">
                        {r.title}
                      </a>
                      <div className="text-xs text-gray-500">{r.source} · {r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : "—"} · {r.points.length} point{r.points.length !== 1 ? "s" : ""}</div>
                      {r.pdfUrl && r.pdfUrl !== r.url && (
                        <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-blue-600">PDF</a>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${agg.tone}`}>{agg.label}</span>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-gray-700 max-w-[280px] truncate" title={agg.reason}>{agg.reason.slice(0, 110)}{agg.reason.length > 110 ? "…" : ""}</td>
                    <td className="px-3 py-2 align-top text-xs">{agg.deadline ? new Date(agg.deadline).toLocaleDateString() : "—"}</td>
                    <td className="px-3 py-2 align-top text-xs text-gray-600">{progress}</td>
                    <td className="px-3 py-2 align-top">
                      <button onClick={() => setExpanded(isOpen ? null : r.id)} className="rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-gray-100">
                        {isOpen ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-50/50">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="space-y-2">
                          {r.points.length === 0 ? (
                            <p className="text-xs text-gray-500">No points evaluated — raw circular had no extractable text. Open circular link to verify.</p>
                          ) : (
                            r.points.map((p) => (
                              <div key={p.pointIndex} className="rounded-lg border bg-white p-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-gray-500">Pt {p.pointIndex}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.applicable === "APPLICABLE" ? "bg-emerald-100 text-emerald-700" : p.applicable === "REVIEW" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{p.applicable}</span>
                                  <span className="ml-auto text-xs text-gray-400">{p.deadline ? new Date(p.deadline).toLocaleDateString() : "No deadline"}</span>
                                </div>
                                <p className="mt-1 text-xs text-gray-800 line-clamp-3" title={p.text}>{p.text}</p>
                                <p className="mt-1 text-xs text-gray-500">{p.reason}</p>
                                {p.checklist && p.checklist.length > 0 && (
                                  <ul className="mt-2 list-disc pl-4 text-xs text-gray-700">
                                    {p.checklist.slice(0, 3).map((c, i) => (
                                      <li key={i} className={c.done ? "line-through text-gray-400" : ""}>{c.label}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
