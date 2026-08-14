import { ragConfig } from "../../config/rag";

// Chat completion against LiteLLM — shared by RAG answers and general chat
// (services/chat.service.ts). Uses the caller-supplied key as the bearer
// (never the master key) so spend/budget are attributed to exactly the key
// presented. Despite the `rag/` directory, nothing in this file is
// RAG-specific — it's a generic messages-array completion call.

export class CompletionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CompletionError";
    this.status = status;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function completeChat(
  apiKey: string,
  messages: ChatMessage[]
): Promise<ChatCompletionResult> {
  const res = await fetch(`${ragConfig.litellmBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ragConfig.chatModel,
      messages,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  if (!res.ok) {
    const message =
      data.error?.message ?? `LiteLLM returned ${res.status}`;
    throw new CompletionError(res.status, message);
  }

  return {
    content: data.choices?.[0]?.message?.content ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}

// Shared by every controller that surfaces a CompletionError to an HTTP
// client (chat.controller.ts, query.controller.ts, conversations.controller.ts)
// — was duplicated identically in the first two before this extraction.
export function mapCompletionErrorStatus(status: number): number {
  if (status === 401) return 401;
  if (status === 402 || status === 429) return 402;
  return 502;
}
