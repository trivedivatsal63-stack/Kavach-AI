import { retrieve } from "./retrieval.service";
import { completeChat } from "./completion.service";
import { countTokens } from "./tokenizer.service";
import { formatContext } from "./citationFormat";
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

// Cached for the process lifetime, not hardcoded — if SYSTEM_PROMPT's wording
// ever changes, the next process restart re-measures it automatically rather
// than the token budget silently drifting from what's actually being sent.
let cachedSystemPromptTokens: number | null = null;
async function getSystemPromptTokenCount(): Promise<number> {
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
}): Promise<RagChatResult> {
  // What retrieve()'s token-budget cutoff needs to know: how many tokens
  // this call's prompt scaffolding already commits, before any chunk content
  // is added. Measured with an empty Context placeholder so the wrapper
  // template's own tokens are counted alongside the real question text.
  const systemTokens = await getSystemPromptTokenCount();
  const wrapperTokens = await countTokens(`Context:\n\n\nQuestion:\n${input.question}`);
  const reservedTokens = systemTokens + wrapperTokens;

  const citations: Citation[] = await retrieve({
    userId: input.userId,
    query: input.question,
    documentIds: input.documentIds,
    reservedTokens,
  });

  if (citations.length === 0) {
    return {
      answer:
        "I couldn't find anything relevant in your documents for that question.",
      citations: [],
      usage: null,
    };
  }

  const context = formatContext(citations);

  const completion = await completeChat(
    input.apiKey,
    SYSTEM_PROMPT,
    `Context:\n${context}\n\nQuestion:\n${input.question}`
  );

  return {
    answer: completion.content,
    citations,
    usage: {
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      totalTokens: completion.totalTokens,
    },
  };
}
