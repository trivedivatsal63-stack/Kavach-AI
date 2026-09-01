import { Router, Request, Response } from "express";
import { prisma } from "../models/prisma";
import { requireAuth } from "../middleware/auth";
import { getOrCreateProfile, listProfiles, updateProfile } from "../services/compliance/profile.service";
import { ingestCirculars, listCircularsForRun } from "../services/compliance/circular.service";
import { evaluateCircularSequential } from "../services/compliance/evaluator.service";
import { resolveChatKey } from "../services/rag/chatKeys.service";
import { findUserByPresentedApiKey } from "../services/keys.service";

export const complianceRouter = Router();

// --- Company profile ---
complianceRouter.get("/compliance/profile", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const profiles = await listProfiles(userId);
  if (profiles.length === 0) {
    const p = await getOrCreateProfile(userId);
    res.json({ profiles: [p] });
    return;
  }
  res.json({ profiles });
});

complianceRouter.post("/compliance/profile", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { name, entityType, wdmSegment, registrations, products, raw } = req.body ?? {};
  const p = await getOrCreateProfile(userId, { name, entityType, wdmSegment, registrations, products, raw });
  res.json({ profile: p });
});

complianceRouter.patch("/compliance/profile/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const p = await updateProfile(userId, req.params.id as string, req.body ?? {});
  res.json({ profile: p });
});

// --- Create compliance run ---
complianceRouter.post("/compliance/runs", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { sources = ["SEBI", "RBI"], lookbackDays = 30, companyProfileId, conversationId } = req.body ?? {};
  let profileId = companyProfileId as unknown as string | undefined;
  if (!profileId) {
    const p = await getOrCreateProfile(userId);
    profileId = p.id;
  }
  // ingest first (non-blocking best effort)
  ingestCirculars(sources as any, lookbackDays).catch(() => {});
  const run = await prisma.complianceRun.create({
    data: { userId, companyProfileId: profileId, conversationId: conversationId ?? null, sources, lookbackDays, status: "running", totalCirculars: 0, completed: 0 },
  });
  // fire-and-forget sequential evaluation
  runEvaluation(run.id).catch(async (e) => {
    await prisma.complianceRun.update({ where: { id: run.id }, data: { status: "failed", error: String(e?.message ?? e) } });
  });
  res.json({ run });
});

async function runEvaluation(runId: string) {
  const run = await prisma.complianceRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const profile = await prisma.companyProfile.findUnique({ where: { id: run.companyProfileId } });
  if (!profile) throw new Error("Profile not found");
  const user = await prisma.user.findUnique({ where: { id: run.userId } });
  if (!user) throw new Error("User not found");
  let rawKey = "";
  try {
    const k = await resolveChatKey(run.userId, Number(user.creditBalanceUsd));
    rawKey = k.rawKey;
  } catch (e) {
    console.warn("[compliance] LiteLLM offline, running heuristic mode", String(e).slice(0, 200));
    rawKey = ""; // triggers heuristic fallback in evaluator
  }
  // ensure circulars ingested
  await ingestCirculars(run.sources as any, run.lookbackDays).catch(() => {});
  const circulars = await listCircularsForRun(run.sources, run.lookbackDays);
  await prisma.complianceRun.update({ where: { id: runId }, data: { totalCirculars: circulars.length } });
  let completed = 0;
  for (const c of circulars) {
    await evaluateCircularSequential(rawKey, profile as any, c as any);
    completed++;
    await prisma.complianceRun.update({ where: { id: runId }, data: { completed, resultTable: { completed, total: circulars.length } as any } });
  }
  await prisma.complianceRun.update({ where: { id: runId }, data: { status: "done", completed } });
}

complianceRouter.get("/compliance/runs", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const runs = await prisma.complianceRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { companyProfile: { select: { name: true } } },
  });
  // enrich with pending count from most recent evaluations per run
  const enriched = await Promise.all(
    runs.map(async (r) => {
      const pending = await prisma.circularEvaluation.count({
        where: { companyProfileId: r.companyProfileId, applicable: "APPLICABLE" },
      });
      return { ...r, pendingApplicable: pending };
    })
  );
  res.json({ runs: enriched });
});

complianceRouter.get("/v1/compliance/runs", async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Missing bearer token" }); return; }
  const user = await findUserByPresentedApiKey(auth.slice(7)).catch(() => null);
  if (!user) { res.status(401).json({ error: "Invalid API key" }); return; }
  const runs = await prisma.complianceRun.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ runs });
});

complianceRouter.get("/v1/compliance/runs/:id/table", async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Missing bearer token" }); return; }
  const user = await findUserByPresentedApiKey(auth.slice(7)).catch(() => null);
  if (!user) { res.status(401).json({ error: "Invalid API key" }); return; }
  const run = await prisma.complianceRun.findUnique({ where: { id: req.params.id as string } });
  if (!run || run.userId !== user.id) { res.status(404).json({ error: "Not found" }); return; }
  const circulars = await prisma.regulatoryCircular.findMany({
    where: { source: { in: run.sources } },
    include: { evaluations: { where: { companyProfileId: run.companyProfileId }, orderBy: { pointIndex: "asc" } } },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });
  const table = circulars.map((c: any) => ({
    id: c.id, source: c.source, title: c.title, url: c.sourceUrl, pdfUrl: c.pdfUrl, publishedAt: c.publishedAt, status: c.status,
    points: c.evaluations.map((e: any) => ({ pointIndex: e.pointIndex, text: e.pointText, applicable: e.applicable, reason: e.reason, deadline: e.deadline, checklist: e.checklist })),
    applicableCount: c.evaluations.filter((e: any) => e.applicable === "APPLICABLE").length,
  }));
  res.json({ run, table });
});

complianceRouter.get("/compliance/runs/:id", requireAuth, async (req: Request, res: Response) => {
  const run = await prisma.complianceRun.findUnique({ where: { id: req.params.id as string } });
  if (!run || run.userId !== req.userId) { res.status(404).json({ error: "Not found" }); return; }
  const evaluations = await prisma.circularEvaluation.findMany({
    where: { companyProfileId: run.companyProfileId },
    include: { circular: true },
    orderBy: [{ circular: { publishedAt: "desc" } }, { pointIndex: "asc" }],
    take: 200,
  });
  res.json({ run, evaluations });
});

complianceRouter.get("/compliance/runs/:id/stream", requireAuth, async (req: Request, res: Response) => {
  const run = await prisma.complianceRun.findUnique({ where: { id: req.params.id as string } });
  if (!run || run.userId !== req.userId) { res.status(404).json({ error: "Not found" }); return; }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  let closed = false;
  req.on("close", () => (closed = true));
  const send = (event: string, data: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // poll every 1s until done
  while (!closed) {
    const cur = await prisma.complianceRun.findUnique({ where: { id: run.id } });
    const evals = await prisma.circularEvaluation.findMany({ where: { companyProfileId: cur!.companyProfileId }, include: { circular: true }, orderBy: { createdAt: "desc" }, take: 50 });
    send("progress", { status: cur!.status, completed: cur!.completed, total: cur!.totalCirculars, evaluations: evals });
    if (cur!.status === "done" || cur!.status === "failed") { send("done", cur); break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  res.end();
});

complianceRouter.get("/compliance/runs/:id/table", requireAuth, async (req: Request, res: Response) => {
  const run = await prisma.complianceRun.findUnique({ where: { id: req.params.id as string } });
  if (!run || run.userId !== req.userId) { res.status(404).json({ error: "Not found" }); return; }
  const circulars = await prisma.regulatoryCircular.findMany({
    where: { source: { in: run.sources } },
    include: { evaluations: { where: { companyProfileId: run.companyProfileId }, orderBy: { pointIndex: "asc" } } },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });
  const table = circulars.map((c: any) => ({
    id: c.id, source: c.source, title: c.title, url: c.sourceUrl, pdfUrl: c.pdfUrl, publishedAt: c.publishedAt, status: c.status,
    points: c.evaluations.map((e: any) => ({ pointIndex: e.pointIndex, text: e.pointText, applicable: e.applicable, reason: e.reason, deadline: e.deadline, checklist: e.checklist })),
    applicableCount: c.evaluations.filter((e: any) => e.applicable === "APPLICABLE").length,
  }));
  res.json({ run, table });
});

complianceRouter.patch("/compliance/evaluations/:id/checklist", requireAuth, async (req: Request, res: Response) => {
  const ev = await prisma.circularEvaluation.findUnique({ where: { id: req.params.id as string }, include: { companyProfile: true } });
  if (!ev || ev.companyProfile.userId !== req.userId) { res.status(404).json({ error: "Not found" }); return; }
  const { checklist } = req.body ?? {};
  const updated = await prisma.circularEvaluation.update({ where: { id: ev.id }, data: { checklist: checklist as any } });
  res.json({ evaluation: updated });
});

// --- Public API key endpoint: POST /v1/compliance/query ---
complianceRouter.post("/v1/compliance/query", async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Missing bearer token" }); return; }
  const rawKey = auth.slice(7);
  const user = await findUserByPresentedApiKey(rawKey).catch(() => null);
  if (!user) { res.status(401).json({ error: "Invalid API key" }); return; }
  // check scope
  const hash = await prisma.apiKey.findUnique({ where: { litellmKeyId: rawKey } }).catch(() => null);
  // allow both: if scope exists and not compliance/general, block
  const keyRow = hash ?? await prisma.apiKey.findFirst({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "desc" } });
  if (keyRow && (keyRow as any).scope && (keyRow as any).scope !== "compliance" && (keyRow as any).scope !== "general") {
    res.status(403).json({ error: "Key scope not allowed for compliance" }); return;
  }
  const { sources = ["SEBI", "RBI"], lookbackDays = 7, companyProfileId } = req.body ?? {};
  let profileId = companyProfileId as string | undefined;
  if (!profileId) {
    const p = await getOrCreateProfile(user.id);
    profileId = p.id;
  }
  await ingestCirculars(sources, lookbackDays).catch(() => {});
  const run = await prisma.complianceRun.create({
    data: { userId: user.id, companyProfileId: profileId, sources, lookbackDays, status: "running", totalCirculars: 0, completed: 0 },
  });
  runEvaluation(run.id).catch(async (e) => {
    await prisma.complianceRun.update({ where: { id: run.id }, data: { status: "failed", error: String(e) } });
  });
  res.json({ runId: run.id, streamUrl: `/compliance/runs/${run.id}/stream`, tableUrl: `/compliance/runs/${run.id}/table` });
});

// Cron helper: daily 24h ingest
let cronStarted = false;
export function startComplianceCron() {
  if (cronStarted) return;
  cronStarted = true;
  const intervalMs = 24 * 3600 * 1000;
  setTimeout(async () => {
    try { await ingestCirculars(["SEBI", "RBI"], 30); } catch {}
  }, 60_000); // warm after 1min
  setInterval(async () => {
    try { await ingestCirculars(["SEBI", "RBI"], 2); } catch {}
  }, intervalMs);
}
