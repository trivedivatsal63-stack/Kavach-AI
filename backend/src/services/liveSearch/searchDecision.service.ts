import { completeChat } from "../rag/completion.service";
import type { HistoryTurn } from "../rag/tokenizer.service";

// Model-decided web search routing (step 1 of agentic flow).
// Previously every caller required an explicit `webSearch: true` toggle
// because the small model couldn't reliably decide on its own. With a
// larger agentic central brain this becomes a cheap classifier call:
// decide IF search is needed + rewrite the user query into a
// search-engine-ready form, using recent history for follow-ups.

// Purpose domain drives preferred-site weighting downstream
// (liveSearch.service.ts): finance questions rank market/news outlets,
// people questions rank professional/company sources, tech questions rank
// official docs, everything else is general web.
export type SearchDomain = "finance" | "people" | "tech" | "general" | "none";

export interface SearchDecision {
  needSearch: boolean;
  rewrittenQuery: string;
  domain: SearchDomain;
  reason: string;
}

const ROUTER_SYSTEM_PROMPT =
  "You are a search router for a conversational AI. " +
  "Given the conversation history and the latest user question, decide whether live web search is needed. " +
  "Return JSON ONLY, no other text: " +
  '{"need_search": true|false, "rewritten_query": "...", "domain": "finance|people|tech|general", "reason": "..."}. ' +
  "Set need_search=true when the question needs current/external facts: recent events, news, prices, releases, " +
  "specific people/companies/products, documentation, definitions of named entities, or anything beyond stable general knowledge. " +
  "Definition/explainer questions about a named program, term, person, or product ALWAYS need search " +
  '(e.g. "what is the MATS research program", "define empirical research in <program>"). ' +
  "Set need_search=false for greetings, small talk, math, coding help from context, or questions fully answerable " +
  "from the provided conversation. " +
  "rewritten_query must be a self-contained search-engine query: resolve pronouns and follow-ups using history " +
  '(e.g. "what about renewal terms?" after a contract discussion -> "contract renewal terms <topic>"). ' +
  'For "who is <Name>" person questions, quote the exact full name and append any disambiguating context from ' +
  'history (employer, role, city, domain) — e.g. "who is mohan bangde?" with Harrier in history -> "\\"Mohan Bangde\\" Harrier". ' +
  "For market questions, include the ticker/company plus recency " +
  '(e.g. "why did apple stock go up today" -> "AAPL stock news September 2026"). ' +
  "domain classifies the question purpose: finance (markets, stocks, prices, earnings, economy), " +
  "people (who-is questions about a person), tech (docs, errors, versions, how-to for a product), " +
  "general (everything else needing search). When need_search=false, use domain none and empty rewritten_query. " +
  "Keep reason under 15 words.";

const FINANCE_HINTS = [
  "stock", "stocks", "share", "market", "nasdaq", "nifty", "sensex",
  "price", "pricing", "earnings", "revenue", "ipo", "dividend", "forex",
  "crypto", "bitcoin", "inflation", "interest rate",
];
const PEOPLE_HINTS = ["who is", "who are", "who was", "biography", "linkedin"];
const TECH_HINTS = [
  "documentation", "docs", "error", "exception", "traceback", "how to",
  "install", "version", "changelog", "api reference", "tutorial",
];
const DEFINITION_HINTS = [
  "what is", "what are", "what does", "define", "definition", "meaning of",
  "explain",
];

export function inferDomain(question: string): SearchDomain {
  const q = question.toLowerCase();
  if (FINANCE_HINTS.some((t) => q.includes(t))) return "finance";
  if (PEOPLE_HINTS.some((t) => q.includes(t))) return "people";
  if (TECH_HINTS.some((t) => q.includes(t))) return "tech";
  return "general";
}

function heuristicFallback(question: string): SearchDecision {
  const q = question.toLowerCase();
  const triggers = [
    "latest",
    "recent",
    "today",
    "yesterday",
    "this week",
    "news",
    "price",
    "pricing",
    "release",
    "released",
    "launched",
    "update",
    "current",
    "2025",
    "2026",
    "who is",
    "who are",
    "what is",
    "what are",
    "what does",
    "define",
    "definition",
    "where is",
    "when did",
    "stock",
    "market",
    "election",
    "weather",
    "score",
  ];
  const needSearch = triggers.some((t) => q.includes(t)) || question.includes("?");
  const active = question.trim().length > 0 ? needSearch && question.trim().length > 8 : false;
  return {
    needSearch: active,
    rewrittenQuery: active ? question.trim().slice(0, 300) : "",
    domain: active ? inferDomain(question) : "none",
    reason: "heuristic-fallback",
  };
}

export async function decideSearchNeed(input: {
  apiKey: string;
  question: string;
  history?: HistoryTurn[];
}): Promise<SearchDecision> {
  const question = input.question.trim().slice(0, 2000);
  if (!question) {
    return { needSearch: false, rewrittenQuery: "", domain: "none", reason: "empty-question" };
  }

  const historySlice = (input.history ?? []).slice(-6);
  const historyText =
    historySlice.length > 0
      ? historySlice.map((h) => `${h.role}: ${h.content.slice(0, 500)}`).join("\n")
      : "(no prior turns)";
  const today = new Date().toISOString().slice(0, 10);

  try {
    const result = await completeChat(
      input.apiKey,
      [
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Today is ${today}.\nConversation:\n${historyText}\n\nLatest question: ${question}`,
        },
      ],
      { maxTokens: 200 }
    );
    const raw = result.content.trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return heuristicFallback(question);
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      need_search?: unknown;
      rewritten_query?: unknown;
      domain?: unknown;
      reason?: unknown;
    };
    const needSearch = parsed.need_search === true;
    const rewritten =
      typeof parsed.rewritten_query === "string" && parsed.rewritten_query.trim()
        ? parsed.rewritten_query.trim().slice(0, 300)
        : question.slice(0, 300);
    const domain: SearchDomain =
      parsed.domain === "finance" ||
      parsed.domain === "people" ||
      parsed.domain === "tech" ||
      parsed.domain === "general"
        ? parsed.domain
        : inferDomain(needSearch ? rewritten : question);
    return {
      needSearch,
      rewrittenQuery: needSearch ? rewritten : "",
      domain: needSearch ? domain : "none",
      reason:
        typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : "model-decision",
    };
  } catch (err) {
    console.error("Search router failed, falling back to heuristic:", err);
    return heuristicFallback(question);
  }
}
