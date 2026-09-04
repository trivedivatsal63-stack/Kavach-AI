import { completeChat } from "../rag/completion.service";
import type { HistoryTurn } from "../rag/tokenizer.service";

// Model-decided web search routing (step 1 of agentic flow).
// Previously every caller required an explicit `webSearch: true` toggle
// because the small model couldn't reliably decide on its own. With a
// larger agentic central brain this becomes a cheap classifier call:
// decide IF search is needed + rewrite the user query into a
// search-engine-ready form, using recent history for follow-ups.

export interface SearchDecision {
  needSearch: boolean;
  rewrittenQuery: string;
  reason: string;
}

const ROUTER_SYSTEM_PROMPT =
  "You are a search router for a conversational AI. " +
  "Given the conversation history and the latest user question, decide whether live web search is needed. " +
  "Return JSON ONLY, no other text: " +
  '{"need_search": true|false, "rewritten_query": "...", "reason": "..."}. ' +
  "Set need_search=true when the question needs current/external facts: recent events, news, prices, releases, " +
  "specific people/companies/products, documentation, or anything beyond stable general knowledge. " +
  "Set need_search=false for greetings, small talk, math, coding help from context, or questions fully answerable " +
  "from the provided conversation. " +
  "rewritten_query must be a self-contained search-engine query: resolve pronouns and follow-ups using history " +
  '(e.g. "what about renewal terms?" after a contract discussion -> "contract renewal terms <topic>"). ' +
  'For "who is <Name>" person questions, quote the exact full name and append any disambiguating context from ' +
  'history (employer, role, city, domain) — e.g. "who is mohan bangde?" with Harrier in history -> "\\"Mohan Bangde\\" Harrier". ' +
  "When need_search=false, rewritten_query may be empty. Keep reason under 15 words.";

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
    "what is the",
    "where is",
    "when did",
    "stock",
    "election",
    "weather",
    "score",
  ];
  const needSearch = triggers.some((t) => q.includes(t)) || question.includes("?");
  return {
    needSearch: question.trim().length > 0 ? needSearch && question.trim().length > 8 : false,
    rewrittenQuery: needSearch ? question.trim().slice(0, 300) : "",
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
    return { needSearch: false, rewrittenQuery: "", reason: "empty-question" };
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
      reason?: unknown;
    };
    const needSearch = parsed.need_search === true;
    const rewritten =
      typeof parsed.rewritten_query === "string" && parsed.rewritten_query.trim()
        ? parsed.rewritten_query.trim().slice(0, 300)
        : question.slice(0, 300);
    return {
      needSearch,
      rewrittenQuery: needSearch ? rewritten : "",
      reason:
        typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : "model-decision",
    };
  } catch (err) {
    console.error("Search router failed, falling back to heuristic:", err);
    return heuristicFallback(question);
  }
}
