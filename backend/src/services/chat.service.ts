import { completeChat, type ChatMessage } from "./rag/completion.service";
import { countTokens, trimHistoryToTokenBudget, type HistoryTurn } from "./rag/tokenizer.service";
import { getLiveSearchContext } from "./liveSearch/liveSearch.service";
import { formatWebContext } from "./liveSearch/webCitationFormat";
import type { WebCitation } from "./liveSearch/types";
import { CHAT_HISTORY_TOKEN_BUDGET } from "../utils/chat.constants";
import { LIVE_SEARCH_TOKEN_BUDGET_STANDALONE } from "../utils/liveSearch.constants";

// General-purpose (non-RAG) conversational chat — no retrieval, no document
// grounding, just a normal multi-turn conversation against the model. Spend
// is attributed the same way RAG chat's is (see chatKeys.service.ts's
// resolveChatKey, called by the shared conversations.controller.ts before
// this is invoked) — this module only builds the prompt and calls LiteLLM.

const SYSTEM_PROMPT =
  "You are HarrierKavach AI's assistant — a helpful, direct conversational AI. " +
  "Answer clearly and concisely. If you don't know something or are unsure, " +
  "say so rather than guessing.";

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
  /** Explicit opt-in only — never triggered automatically. See
   * services/liveSearch/ for why: this model is too small to reliably
   * decide on its own when it needs current information. */
  webSearch?: boolean;
}): Promise<ChatResult> {
  const webSearch = input.webSearch ?? false;

  const webCitations = webSearch
    ? await getLiveSearchContext({
        query: input.question,
        budgetTokens: LIVE_SEARCH_TOKEN_BUDGET_STANDALONE,
      })
    : [];
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
        "If excerpts don't contain the answer, say so. Ignore irrelevant results and answer normally.",
    });
  }
  messages.push(...trimmedHistory, { role: "user", content: input.question });

  const completion = await completeChat(input.apiKey, messages);

  return {
    answer: completion.content,
    webCitations: webSearch ? webCitations : undefined,
    usage: {
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      totalTokens: completion.totalTokens,
    },
  };
}
