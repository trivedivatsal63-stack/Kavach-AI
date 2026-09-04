import { retrieve } from "./retrieval.service";
import { completeChat, completeChatStream } from "./completion.service";
import type { PhaseCallback } from "../pipelinePhases";
import { countTokens, trimHistoryToTokenBudget, type HistoryTurn } from "./tokenizer.service";
import { formatContext } from "./citationFormat";
import { getLiveSearchContext } from "../liveSearch/liveSearch.service";
import { decideSearchNeed } from "../liveSearch/searchDecision.service";
import { formatWebContext } from "../liveSearch/webCitationFormat";
import { RAG_HISTORY_TOKEN_BUDGET } from "../../utils/chat.constants";
import { LIVE_SEARCH_TOKEN_BUDGET_WITH_RAG } from "../../utils/liveSearch.constants";
import type { Citation, RagChatResult } from "../../models/rag/types";

// Retrieval-augmented answer: search the user's vectors, stuff the top
// chunks into the prompt, generate through LiteLLM with the caller's key.
// The key's max_budget is the user's credit balance (kept in sync upstream),
// so generating an answer consumes the same credit pool as any other key.

const SYSTEM_PROMPT =
  "You are a document-assistant answering questions strictly from the user's " +
  "uploaded documents. Answer using ONLY facts explicitly stated in the " +
  "numbered context chunks below — never fill a gap from your own general " +
  "knowledge or training data, even if you are confident it's correct. This " +
  "matters especially for legal, regulatory, and financial documents, where a " +
  "plausible-sounding but wrong number or section reference is worse than no " +
  "answer at all. " +
  "The chunks vary in relevance — trust the highest-match ones and ignore " +
  "unrelated ones. Do not blend details from chunks that cover different " +
  "sections, clauses, or provisions into one composite answer: only combine " +
  "information across chunks when they are actually discussing the same " +
  "provision. If the chunks that mention your topic are really about a " +
  "different section, treat that as context not containing the answer, not as " +
  "raw material to stitch one together. " +
  "If the retrieved context doesn't clearly and fully support an answer, say so " +
  "plainly, in your own words, instead of guessing, extrapolating, or hedging " +
  "with a number anyway — a direct 'the retrieved documents don't contain that' " +
  "is the right answer in that case, not a best-effort guess. " +
  "When you do answer, name the exact section, clause, or provision number as " +
  "it appears in the context — never invent, approximate, or 'round' a section " +
  "number to one that sounds right. " +
  "Citation and reference entries (footnotes, bibliographies, publisher names, " +
  "journal details) are NOT answers: never present a publisher or a reference " +
  "string as the author or title of a document. " +
  "Cite your sources with [n] matching the numbered context. Keep the answer " +
  "concise.";

// Appended to SYSTEM_PROMPT only when webSearch was requested. Additive —
// the base prompt's "ONLY from uploaded documents" guarantee stays intact
// for every caller that doesn't ask for web search; this just widens it for
// the ones that explicitly did.
const WEB_SEARCH_ADDENDUM =
  " You also have live web search results below, each marked [n] (web) " +
  "alongside the document context (if any). They are real, current pages " +
  "fetched just for this question, extracted to concise text. " +
  "Rules: use ONLY facts explicitly in [n] excerpts for web-sourced claims; " +
  "cite with [n] per factual sentence (e.g. '... [2]'). " +
  "If excerpts don't contain the answer, say so — don't guess from training " +
  "data. Keep document and web facts distinct — don't blend them as one " +
  "source. If documents alone answer, ignore web results.";

// Cached for the process lifetime, not hardcoded — if SYSTEM_PROMPT's wording
// ever changes, the next process restart re-measures it automatically rather
// than the token budget silently drifting from what's actually being sent.
// Two variants cached separately since the web-search addendum changes the
// prompt actually sent.
let cachedSystemPromptTokens: number | null = null;
let cachedSystemPromptWithWebTokens: number | null = null;
async function getSystemPromptTokenCount(withWeb: boolean): Promise<number> {
  if (withWeb) {
    if (cachedSystemPromptWithWebTokens === null) {
      cachedSystemPromptWithWebTokens = await countTokens(
        SYSTEM_PROMPT + WEB_SEARCH_ADDENDUM
      );
    }
    return cachedSystemPromptWithWebTokens;
  }
  if (cachedSystemPromptTokens === null) {
    cachedSystemPromptTokens = await countTokens(SYSTEM_PROMPT);
  }
  return cachedSystemPromptTokens;
}

export async function answerQuestion(input: {
  userId: string;
  question: string;
  apiKey: string;
  documentIds?: string[];
  /** Prior turns in the conversation, oldest-first, excluding the new
   * question. Optional — omitted/empty for the public /v1/rag/query API,
   * which has no conversation concept. */
  history?: HistoryTurn[];
  /** true = always search with the raw question. 'auto' = model decides IF
   * search is needed + rewrites the query from history. false = never. */
  webSearch?: boolean | "auto";
  /** Real-step progress callback for the SSE status timeline. */
  onPhase?: PhaseCallback;
  /** Token deltas for live streaming (with signal, streams via LiteLLM SSE). */
  onToken?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<RagChatResult> {
  const mode = input.webSearch ?? "auto";

  let searchQuery: string | null = null;
  if (mode === true) {
    searchQuery = input.question;
  } else if (mode === "auto") {
    await input.onPhase?.("routing");
    const decision = await decideSearchNeed({
      apiKey: input.apiKey,
      question: input.question,
      history: input.history ?? [],
    });
    if (decision.needSearch && decision.rewrittenQuery) {
      searchQuery = decision.rewrittenQuery;
    }
  }
  const webSearch = searchQuery !== null;

  // What retrieve()'s token-budget cutoff needs to know: how many tokens
  // this call's prompt scaffolding already commits, before any chunk content
  // is added. Measured with an empty Context placeholder so the wrapper
  // template's own tokens are counted alongside the real question text.
  // History gets its own small, fixed budget (RAG_HISTORY_TOKEN_BUDGET) —
  // retrieved chunks are the primary value here and must not get starved
  // out of the 2048-token window by a long conversation.
  const systemTokens = await getSystemPromptTokenCount(webSearch);
  const wrapperTokens = await countTokens(`Context:\n\n\nQuestion:\n${input.question}`);
  const trimmedHistory = await trimHistoryToTokenBudget(
    input.history ?? [],
    RAG_HISTORY_TOKEN_BUDGET
  );
  const historyTokens = trimmedHistory.length > 0
    ? await countTokens(trimmedHistory.map((h) => h.content).join("\n"))
    : 0;

  // Live search runs before retrieve() so its real (measured, not assumed)
  // token cost can be folded into reservedTokens up front — retrieve()'s own
  // budget walk needs to know everything already spoken for, not just
  // history/system/question, or it could still overflow the window.
  // searchQuery is the rewritten form when mode='auto', raw when forced.
  if (searchQuery) await input.onPhase?.("searching");
  const webCitations = searchQuery
    ? await getLiveSearchContext({
        query: searchQuery,
        budgetTokens: LIVE_SEARCH_TOKEN_BUDGET_WITH_RAG,
      })
    : [];
  const webContextTokens =
    webCitations.length > 0 ? await countTokens(formatWebContext(webCitations)) : 0;

  const reservedTokens = systemTokens + wrapperTokens + historyTokens + webContextTokens;

  await input.onPhase?.("retrieving");
  const citations: Citation[] = await retrieve({
    userId: input.userId,
    query: input.question,
    documentIds: input.documentIds,
    reservedTokens,
  });

  if (citations.length === 0 && webCitations.length === 0) {
    return {
      answer: webSearch
        ? "I couldn't find anything relevant in your documents or in a live web search for that question."
        : "I couldn't find anything relevant in your documents for that question.",
      citations: [],
      webCitations: webSearch ? [] : undefined,
      usage: null,
    };
  }

  const docContext = citations.length > 0 ? formatContext(citations) : "";
  // Web citations are numbered continuing on from the document citations so
  // the model's [n] scheme stays one single sequence across both sources.
  const webContext =
    webCitations.length > 0 ? formatWebContext(webCitations, citations.length) : "";
  const context = [docContext, webContext].filter(Boolean).join("\n\n");

  await input.onPhase?.("generating");
  const completion =
    input.onToken || input.signal
      ? await completeChatStream(
          input.apiKey,
          [
            {
              role: "system",
              content: webSearch ? SYSTEM_PROMPT + WEB_SEARCH_ADDENDUM : SYSTEM_PROMPT,
            },
            ...trimmedHistory,
            { role: "user", content: `Context:\n${context}\n\nQuestion:\n${input.question}` },
          ],
          { onDelta: input.onToken, signal: input.signal }
        )
      : await completeChat(input.apiKey, [
    {
      role: "system",
      content: webSearch ? SYSTEM_PROMPT + WEB_SEARCH_ADDENDUM : SYSTEM_PROMPT,
    },
    ...trimmedHistory,
    { role: "user", content: `Context:\n${context}\n\nQuestion:\n${input.question}` },
  ]);

  return {
    answer: completion.content,
    citations,
    webCitations: webSearch ? webCitations : undefined,
    usage: {
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      totalTokens: completion.totalTokens,
    },
  };
}
