import { completeChat } from "../rag/completion.service";
import { countTokens } from "../rag/tokenizer.service";
import { extractTextFromUrl } from "../../jobs/regulatory/extractor";
import { prisma } from "../../models/prisma";

interface CompanyProfile {
  id: string;
  entityType: string;
  wdmSegment: boolean;
  registrations: string[];
  products: string[];
  raw?: any;
}

interface ExtractedPoint {
  index: number;
  text: string;
  obligation?: string;
  deadlineRaw?: string;
}

const EXTRACT_SYSTEM = `You are a regulatory circular parser. Extract every normative point from the circular text. Return ONLY valid JSON array, no markdown, no explanation. Each item: {"index": number 1-based, "text": "verbatim or concise normative sentence", "obligation": "disclosure|filing|compliance|reporting|payment|other", "deadlineRaw": "date string or null"}. If circular has no clear points, return single item covering whole circular. Keep text under 300 chars per point.`;

const CLASSIFY_SYSTEM = `You are a WDM compliance analyst for Harrier Kavach. Given company profile and a single circular point, decide applicability. Return ONLY JSON object, no markdown: {"decision":"APPLICABLE|NOT_APPLICABLE|REVIEW","reason":"1-line why","deadline":"YYYY-MM-DD or null","obligationType":"same as obligation","checklist":["action 1","action 2"]}. Rules: WDM = Wholesale Debt Market participant in G-Sec/Corp Bonds/CP/NDS-OM/debt securities. If point mentions debt market, WDM, G-Sec, corporate bonds, debt securities, NDS-OM, SEBI debt regulations, then APPLICABLE else NOT_APPLICABLE. Be conservative.`;

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    return null;
  }
}

function truncateForContext(text: string, maxTokens = 5000): string {
  return text.slice(0, maxTokens * 4);
}

// Heuristic fallback when Harrier LLM is unavailable — keeps demo usable
const WDM_KEYWORDS = [
  "wdm", "wholesale debt", "g-sec", "gsec", "government securit", "corporate bond", "debt securit", "debt market",
  "nds-om", "nds om", "corporate debt", "commercial paper", "debenture", "ncd", "bond", "debt instrument",
];
const DEADLINE_RE = /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2})/i;

function heuristicDeadline(text: string): string | null {
  const m = text.match(DEADLINE_RE);
  return m ? m[1] : null;
}

function heuristicApplicable(text: string, profile: CompanyProfile): { decision: string; reason: string } {
  const lower = text.toLowerCase();
  const hit = WDM_KEYWORDS.find((k) => lower.includes(k));
  // also match any product name from profile
  const productHit = (profile.products || []).find((p) => lower.includes(p.toLowerCase().split(" ")[0]));
  if (hit || productHit) {
    return { decision: "APPLICABLE", reason: `Mentions "${hit ?? productHit}" — relevant to WDM (${profile.entityType})` };
  }
  // If source is SEBI/RBI debt circular title contains debt/bond — keep conservative
  if (lower.includes("sebi") && lower.includes("debt")) return { decision: "APPLICABLE", reason: `SEBI debt regulation — likely applicable to WDM` };
  return { decision: "NOT_APPLICABLE", reason: `No WDM/debt keyword found — not applicable to ${profile.entityType}` };
}

function fallbackExtractPoints(text: string): ExtractedPoint[] {
  // Heuristic: split by double newline or numbered clauses, but cap at 3 to avoid dump
  const parts = text
    .split(/\n\s*\n|(?=\d+\.\s)|(?=•\s)/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 60 && !/^HO\/\d/.test(s) && s.split(" ").length > 8)
    .slice(0, 3);
  if (parts.length <= 1) return [{ index: 1, text: text.slice(0, 500).replace(/\s+/g, " ").trim(), obligation: "other", deadlineRaw: heuristicDeadline(text) ?? undefined }];
  return parts.map((p, i) => ({ index: i + 1, text: p.slice(0, 500), obligation: "other", deadlineRaw: heuristicDeadline(p) ?? undefined }));
}

export async function extractPoints(apiKey: string, circularText: string): Promise<ExtractedPoint[]> {
  const trimmed = truncateForContext(circularText, 5000);
  // Fast-path: if no API key or empty, skip LLM
  if (!apiKey) return fallbackExtractPoints(trimmed);
  try {
    const { content } = await completeChat(apiKey, [
      { role: "system", content: EXTRACT_SYSTEM },
      { role: "user", content: `Circular text:\n${trimmed}` },
    ]);
    const parsed = safeJsonParse(content);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((p: any, i: number) => ({ index: p.index ?? i + 1, text: String(p.text ?? "").slice(0, 800), obligation: p.obligation, deadlineRaw: p.deadlineRaw }));
    }
  } catch (e) {
    console.warn("[compliance] extractPoints LLM unavailable, using heuristic fallback", String((e as Error)?.message ?? e).slice(0, 200));
  }
  return fallbackExtractPoints(trimmed);
}

export async function classifyPoint(
  apiKey: string,
  profile: CompanyProfile,
  point: ExtractedPoint
): Promise<{ decision: string; reason: string; deadline: Date | null; obligationType: string; checklist: { label: string; done: boolean }[] }> {
  const profileText = JSON.stringify({ entityType: profile.entityType, wdmSegment: profile.wdmSegment, registrations: profile.registrations, products: profile.products, description: profile.raw?.description ?? "" });
  if (apiKey) {
    try {
      const { content } = await completeChat(apiKey, [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: `Company profile: ${profileText}\nPoint ${point.index}: ${point.text}\nObligation: ${point.obligation ?? "other"}\nDeadline raw: ${point.deadlineRaw ?? "null"}` },
      ]);
      const parsed = safeJsonParse(content);
      if (parsed && parsed.decision) {
        const decision = String(parsed.decision).toUpperCase().includes("NOT") ? "NOT_APPLICABLE" : String(parsed.decision).toUpperCase().includes("REVIEW") ? "REVIEW" : "APPLICABLE";
        let deadline: Date | null = null;
        if (parsed.deadline && parsed.deadline !== "null") {
          const d = new Date(String(parsed.deadline));
          if (!isNaN(d.getTime())) deadline = d;
        }
        const checklist: { label: string; done: boolean }[] = Array.isArray(parsed.checklist)
          ? parsed.checklist.slice(0, 3).map((l: string) => ({ label: String(l).slice(0, 200), done: false }))
          : [{ label: point.text.slice(0, 120), done: false }];
        return { decision, reason: String(parsed.reason ?? "").slice(0, 500), deadline, obligationType: String(parsed.obligationType ?? point.obligation ?? "other"), checklist };
      }
    } catch (e) {
      console.warn("[compliance] classifyPoint LLM unavailable, heuristic fallback", String((e as Error)?.message ?? e).slice(0, 200));
    }
  }
  // Heuristic fallback — gives real APPLICABLE/NOT_APPLICABLE without LLM
  const h = heuristicApplicable(point.text, profile);
  let deadline: Date | null = null;
  const raw = point.deadlineRaw ?? heuristicDeadline(point.text);
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) deadline = d;
  }
  const checklist = h.decision === "APPLICABLE"
    ? [{ label: `Review obligation: ${point.text.slice(0, 80)}`, done: false }, { label: deadline ? `Comply by ${deadline.toLocaleDateString()}` : "Check deadline in circular", done: false }]
    : [{ label: "No action required", done: false }];
  return { decision: h.decision, reason: h.reason + " (heuristic — LLM offline)", deadline, obligationType: point.obligation ?? "other", checklist };
}

export async function evaluateCircularSequential(
  apiKey: string,
  profile: CompanyProfile,
  circular: { id: string; sourceUrl: string; title: string; pdfUrl: string | null; rawText: string | null },
  onPoint?: (point: ExtractedPoint, result: Awaited<ReturnType<typeof classifyPoint>>) => Promise<void>
): Promise<void> {
  let text = circular.rawText;
  if (!text) {
    text = await extractTextFromUrl(circular.sourceUrl, circular.pdfUrl);
    if (text) await prisma.regulatoryCircular.update({ where: { id: circular.id }, data: { rawText: text, status: "parsed" } });
  }
  if (!text) {
    text = circular.title;
  }
  // ensure within token budget (8192 - reserved 2500)
  const tokens = await countTokens(text!).catch(() => Math.ceil(text!.length / 4));
  if (tokens > 5500) text = truncateForContext(text!, 5500);

  const points = await extractPoints(apiKey, text);
  for (const p of points) {
    const result = await classifyPoint(apiKey, profile, p);
    await prisma.circularEvaluation.upsert({
      where: { circularId_companyProfileId_pointIndex: { circularId: circular.id, companyProfileId: profile.id, pointIndex: p.index } },
      create: {
        circularId: circular.id,
        companyProfileId: profile.id,
        pointIndex: p.index,
        pointText: p.text,
        summary: p.text,
        applicable: result.decision,
        reason: result.reason,
        deadline: result.deadline,
        obligationType: result.obligationType,
        checklist: result.checklist as any,
      },
      update: {
        pointText: p.text,
        applicable: result.decision,
        reason: result.reason,
        deadline: result.deadline,
        obligationType: result.obligationType,
        checklist: result.checklist as any,
      },
    });
    if (onPoint) await onPoint(p, result);
  }
  await prisma.regulatoryCircular.update({ where: { id: circular.id }, data: { status: "evaluated" } }).catch(() => {});
}
