import { retrieve } from "./retrieval";
import { completeChat } from "./litellm";
import type { Citation, RagChatResult } from "../types";

// Retrieval-augmented answer: search the user's vectors, stuff the top
// chunks into the prompt, generate through LiteLLM with the caller's key.
// The key's max_budget is the user's credit balance (kept in sync upstream),
// so generating an answer consumes the same credit pool as any other key.

const SYSTEM_PROMPT =
  "You are a document-assistant. Answer the user's question using ONLY the " +
  "provided context. If the context does not contain the answer, say so " +
  "clearly instead of guessing. Cite your sources with [n] matching the " +
  "bracketed numbers in the context. Keep the answer concise.";

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
      return `[${i + 1}] ${location}\n${c.excerpt}`;
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
