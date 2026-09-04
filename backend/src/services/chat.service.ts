import { completeChat, completeChatStream, type ChatMessage } from "./rag/completion.service";
import { countTokens, trimHistoryToTokenBudget, type HistoryTurn } from "./rag/tokenizer.service";
import { getLiveSearchContext } from "./liveSearch/liveSearch.service";
import { decideSearchNeed, inferDomain, type SearchDomain } from "./liveSearch/searchDecision.service";
import { formatWebContext } from "./liveSearch/webCitationFormat";
import type { WebCitation } from "./liveSearch/types";
import { CHAT_HISTORY_TOKEN_BUDGET } from "../utils/chat.constants";
import { LIVE_SEARCH_TOKEN_BUDGET_STANDALONE } from "../utils/liveSearch.constants";
import type { PhaseCallback } from "./pipelinePhases";

// General-purpose (non-RAG) conversational chat — no retrieval, no document
// grounding, just a normal multi-turn conversation against the model. Spend
// is attributed the same way RAG chat's is (see chatKeys.service.ts's
// resolveChatKey, called by the shared conversations.controller.ts before
// this is invoked) — this module only builds the prompt and calls LiteLLM.

const SYSTEM_PROMPT =
  "You are HarrierKavach AI's assistant — a helpful, direct conversational AI. " +
  "Answer clearly and concisely. If you don't know something or are unsure, " +
  "say so rather than guessing. " +
  "Answer only the latest question, on its own terms — never repeat, quote, " +
  "or open with a previous turn's refusal, apology, or wording, even when " +
  "the topic looks similar. Each answer starts fresh.";

export interface ChatResult {
  answer: string;
  // Present only when webSearch was requested — see services/liveSearch/.
  webCitations?: WebCitation[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function answerChatMessage(input: {
  apiKey: string;
  question: string;
  /** Prior turns, oldest-first, excluding the new question. */
  history: HistoryTurn[];
  /** true = always search with the raw question.
   *  'auto' (or undefined on conversational paths) = model decides IF
   *  search is needed and rewrites the query from history. false = never. */
  webSearch?: boolean | "auto";
  /** Real-step progress callback for the SSE status timeline. Each phase
   * fires exactly when that work starts — never synthetic. */
  onPhase?: PhaseCallback;
  /** Token deltas for live streaming. When present (with signal), the
   * answer streams via LiteLLM SSE instead of one blocking call. */
  onToken?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<ChatResult> {
  const mode = input.webSearch ?? "auto";

  let searchQuery: string | null = null;
  let domain: SearchDomain = inferDomain(input.question);
  if (mode === true) {
    searchQuery = input.question;
  } else if (mode === "auto") {
    await input.onPhase?.("routing");
    const decision = await decideSearchNeed({
      apiKey: input.apiKey,
      question: input.question,
      history: input.history,
    });
    if (decision.needSearch && decision.rewrittenQuery) {
      searchQuery = decision.rewrittenQuery;
      domain = decision.domain === "none" ? domain : decision.domain;
    } else {
      domain = "none";
    }
  }

  if (searchQuery) await input.onPhase?.("searching");
  const webCitations = searchQuery
    ? await getLiveSearchContext({
        query: searchQuery,
        budgetTokens: LIVE_SEARCH_TOKEN_BUDGET_STANDALONE,
        domain,
      })
    : [];
  const autoSearched = mode === "auto" && searchQuery !== null;
  const webContextTokens =
    webCitations.length > 0 ? await countTokens(formatWebContext(webCitations)) : 0;

  // History's budget shrinks to make room for live search results — same
  // fixed total ceiling as before (CHAT_HISTORY_TOKEN_BUDGET), just
  // reallocated, so stacking web search on top of a long conversation can't
  // blow past what was already a safe, tested allocation.
  const historyBudget = Math.max(0, CHAT_HISTORY_TOKEN_BUDGET - webContextTokens);
  const trimmedHistory = await trimHistoryToTokenBudget(input.history, historyBudget);

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (webCitations.length > 0) {
    messages.push({
      role: "system",
      content:
        `Live web search results for this question (real pages, concise excerpts):\n\n${formatWebContext(webCitations)}\n\n` +
        "Rules: use ONLY facts in excerpts; cite per sentence with [n] (e.g. '... [1]'). " +
        "If excerpts don't contain the answer, say exactly that and stop — do not " +
        "restate any previous turn. Ignore irrelevant results and answer normally. " +
        "Answer only this question, fresh; never echo a prior turn's wording.",
    });
  }
  messages.push(...trimmedHistory, { role: "user", content: input.question });

  await input.onPhase?.("generating");
  const completion =
    input.onToken || input.signal
      ? await completeChatStream(input.apiKey, messages, {
          onDelta: input.onToken,
          signal: input.signal,
        })
      : await completeChat(input.apiKey, messages);

  // Preserve the old contract: forced=true always returns the array (even
  // empty); auto returns it only when a search actually ran, else undefined.
  const returnWebCitations =
    mode === true ? webCitations : autoSearched ? webCitations : undefined;
  return {
    answer: completion.content,
    webCitations: returnWebCitations,
    usage: {
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      totalTokens: completion.totalTokens,
    },
  };
}
