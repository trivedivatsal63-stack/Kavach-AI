import { useEffect, useState } from "react";
import { createComplianceProfile, getComplianceProfile, updateComplianceProfile, createComplianceRun, getComplianceTable, listComplianceRuns } from "../../lib/api";
import { ComplianceTable } from "./ComplianceTable";
import type { ComplianceRow } from "./ComplianceTable";

export function ComplianceFlow({ token, initialRunId, onClose }: { token: string; initialRunId?: string | null; onClose?: () => void }) {
  const [step, setStep] = useState<"intro" | "sources" | "profile" | "running" | "done">("intro");
  const [sources, setSources] = useState<string[]>(["SEBI", "RBI"]);
  const [profile, setProfile] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [_runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number; status: string } | null>(null);
  const [rows, setRows] = useState<ComplianceRow[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    if (step === "profile") {
      getComplianceProfile(token).then((r) => {
        const p = r.profiles[0];
        setProfile(p);
        setEdit(p ? { name: p.name, entityType: p.entityType, wdmSegment: p.wdmSegment, registrations: p.registrations.join(", "), products: p.products.join(", ") } : { name: "WDM Desk", entityType: "WDM participant (Wholesale Debt Market)", wdmSegment: true, registrations: "SEBI-Registered Intermediary - WDM", products: "G-Sec, Corporate Bonds, Commercial Paper, NDS-OM" });
      });
    }
  }, [step, token]);

  useEffect(() => {
    if (step === "intro") {
      listComplianceRuns(token).then((r) => setHistory(r.runs)).catch(() => {});
    }
  }, [step, token]);

  useEffect(() => {
    if (initialRunId) {
      setStep("done");
      setRunId(initialRunId);
      getComplianceTable(token, initialRunId).then((t) => {
        setProgress({ completed: t.run.completed, total: t.run.totalCirculars, status: t.run.status });
        setRows(t.table as ComplianceRow[]);
      }).catch(() => {});
    }
  }, [initialRunId, token]);

  async function startRun() {
    // save profile if edited
    if (profile && edit) {
      await updateComplianceProfile(token, profile.id, {
        name: edit.name,
        entityType: edit.entityType,
        wdmSegment: edit.wdmSegment,
        registrations: edit.registrations.split(",").map((s: string) => s.trim()).filter(Boolean),
        products: edit.products.split(",").map((s: string) => s.trim()).filter(Boolean),
      }).catch(() => {});
    } else if (!profile && edit) {
      const r = await createComplianceProfile(token, {
        name: edit.name, entityType: edit.entityType, wdmSegment: edit.wdmSegment,
        registrations: edit.registrations.split(",").map((s: string) => s.trim()).filter(Boolean),
        products: edit.products.split(",").map((s: string) => s.trim()).filter(Boolean),
      });
      setProfile(r.profile);
    }
    setStep("running");
    const res = await createComplianceRun(token, { sources, lookbackDays: 30, companyProfileId: profile?.id });
    setRunId(res.run.id);
    poll(res.run.id);
  }

  async function poll(id: string) {
    const es = new EventSource(`${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4001"}/compliance/runs/${id}/stream`, {} as any);
    // EventSource doesn't send Authorization header; fallback to polling table
    es.onerror = () => es.close();
    // poll via fetch every 2s because SSE requires auth header (we use polling)
    es.close();
    const interval = setInterval(async () => {
      try {
        const t = await getComplianceTable(token, id);
        setProgress({ completed: t.run.completed, total: t.run.totalCirculars, status: t.run.status });
        setRows(t.table as ComplianceRow[]);
        if (t.run.status === "done" || t.run.status === "failed") {
          clearInterval(interval);
          setStep("done");
        }
      } catch {}
    }, 2000);
    // initial
    try {
      const t = await getComplianceTable(token, id);
      setProgress({ completed: t.run.completed, total: t.run.totalCirculars, status: t.run.status });
      setRows(t.table as ComplianceRow[]);
    } catch {}
  }

  if (step === "intro") {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm dark:bg-neutral-900">
        <h3 className="text-lg font-semibold">Compliance check — For company only</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          This check is company-scoped. It evaluates recent SEBI/RBI (and optionally NSE/MCA) circulars point-by-point against your company profile (WDM for this client) to decide applicability, reason, deadline and checklist.
        </p>
        <p className="mt-2 text-xs text-gray-500">We will check each circular sequentially (one at a time) due to context window limits, then show a table. A scoped API key can be generated for your system to consume the same stream.</p>
        <button onClick={() => setStep("sources")} className="mt-4 rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white">Continue</button>
        {history.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold">Recent checks — visit daily to see what to do</h4>
            <p className="text-xs text-gray-500">Runs are saved. Reloading keeps history, and the same data is fetchable via your compliance API key on another platform (<code className="rounded bg-gray-100 px-1 dark:bg-neutral-800">GET /v1/compliance/runs</code>).</p>
            <ul className="mt-2 space-y-1">
              {history.slice(0, 5).map((h: any) => (
                <li key={h.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                  <span>{new Date(h.createdAt).toLocaleString()} · {h.sources?.join(", ")} · {h.status} · {h.completed}/{h.totalCirculars} · {h.pendingApplicable ?? "?"} applicable</span>
                  <button onClick={() => { setRunId(h.id); getComplianceTable(token, h.id).then((t) => { setRows(t.table as ComplianceRow[]); setProgress({ completed: t.run.completed, total: t.run.totalCirculars, status: t.run.status }); setStep("done"); }); }} className="rounded-full border px-2 py-1 text-xs">View</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (step === "sources") {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm dark:bg-neutral-900">
        <h3 className="text-sm font-semibold">Select regulatory sources</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {["SEBI", "RBI", "NSE", "MCA"].map((s) => (
            <label key={s} className={`rounded-full border px-3 py-1.5 text-xs font-medium cursor-pointer ${sources.includes(s) ? "bg-gray-900 text-white" : "bg-white"} ${s === "NSE" || s === "MCA" ? "opacity-50" : ""}`}>
              <input type="checkbox" className="mr-1" checked={sources.includes(s)} onChange={(e) => setSources((prev) => e.target.checked ? [...prev, s] : prev.filter((x) => x !== s))} disabled={s === "NSE" || s === "MCA"} /> {s} {(s === "NSE" || s === "MCA") && "(soon)"}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">Main focus: SEBI + RBI. NSE/MCA stubbed.</p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setStep("profile")} className="rounded-full bg-gray-900 px-5 py-2 text-sm text-white">Next — Company profile</button>
          <button onClick={() => setStep("intro")} className="rounded-full border px-5 py-2 text-sm">Back</button>
        </div>
      </div>
    );
  }
  if (step === "profile") {
    if (!edit) return <p className="text-sm p-4">Loading profile…</p>;
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm dark:bg-neutral-900">
        <h3 className="text-sm font-semibold">Company profile (prefilled WDM — Edit if needed)</h3>
        <div className="mt-3 grid gap-3">
          <label className="text-xs">Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></label>
          <label className="text-xs">Entity type<input value={edit.entityType} onChange={(e) => setEdit({ ...edit, entityType: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></label>
          <label className="text-xs">Registrations (comma-separated)<input value={edit.registrations} onChange={(e) => setEdit({ ...edit, registrations: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></label>
          <label className="text-xs">Products (comma-separated)<input value={edit.products} onChange={(e) => setEdit({ ...edit, products: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></label>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={startRun} className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white">Run compliance check (past 30 days, then daily)</button>
          <button onClick={() => setStep("sources")} className="rounded-full border px-5 py-2 text-sm">Back</button>
        </div>
      </div>
    );
  }
  if (step === "running") {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm dark:bg-neutral-900">
        <h3 className="text-sm font-semibold">Checking circulars sequentially…</h3>
        <p className="mt-1 text-xs text-gray-500">{progress ? `${progress.completed}/${progress.total || "?"} circulars — ${progress.status}` : "Starting…"}</p>
        <div className="mt-3 h-2 w-full rounded-full bg-gray-100"><div className="h-2 rounded-full bg-emerald-600 transition-all" style={{ width: `${progress && progress.total ? Math.round((progress.completed / progress.total) * 100) : 5}%` }} /></div>
        {rows.length > 0 && <div className="mt-4"><ComplianceTable rows={rows} /></div>}
        <p className="mt-2 text-xs text-gray-400">Sequential 1-by-1 due to context window — results stream one by one.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Compliance results</h3>
        {onClose && <button onClick={onClose} className="text-xs text-gray-500">Close</button>}
      </div>
      <p className="mt-1 text-xs text-gray-500">{progress ? `${progress.completed}/${progress.total} circulars evaluated` : ""} — Table below. Generate a scoped API key in Dashboard → Keys → Compliance for your system.</p>
      <div className="mt-4"><ComplianceTable rows={rows} /></div>
      <button onClick={() => { setStep("intro"); setRows([]); setRunId(null); }} className="mt-4 rounded-full border px-4 py-2 text-xs">Run again</button>
    </div>
  );
}
