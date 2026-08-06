import { retrieve } from "./retrieval";
import { completeChat } from "./litellm";
import type { Citation, RagChatResult } from "../types";

// Retrieval-augmented answer: search the user's vectors, stuff the top
// chunks into the prompt, generate through LiteLLM with the caller's key.
// The key's max_budget is the user's credit balance (kept in sync upstream),
// so generating an answer consumes the same credit pool as any other key.

const SYSTEM_PROMPT =
  "You are a document-assistant answering questions about the user's uploaded " +
  "documents. Use ONLY the provided context. The numbered chunks vary in " +
  "relevance — trust the highest-match chunks and ignore unrelated ones. " +
  "Citation and reference entries (footnotes, bibliographies, publisher names, " +
  "journal details) are NOT answers: never present a publisher or a reference " +
  "string as the author or title of a document. If the context does not contain " +
  "the answer, say you couldn't find it in the documents instead of guessing. " +
  "Cite your sources with [n] matching the numbered context. Keep the answer " +
  "concise.";

export async function answerQuestion(input: {
  userId: string;
  question: string;
  apiKey: string;
  documentIds?: string[];
  limit?: number;
}): Promise<RagChatResult> {
  const citations: Citation[] = await retrieve({
    userId: input.userId,
    query: input.question,
    documentIds: input.documentIds,
    limit: input.limit,
  });

  if (citations.length === 0) {
    return {
      answer:
        "I couldn't find anything relevant in your documents for that question.",
      citations: [],
      usage: null,
    };
  }

  const context = citations
    .map((c, i) => {
      const location = [
        c.source,
        ...(c.headingPath && c.headingPath.length > 0 ? c.headingPath : []),
      ].join(" > ");
      const match = Math.round(c.score * 100);
      return `[${i + 1}] ${location} — match ${match}%\n${c.excerpt}`;
    })
    .join("\n\n");

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
