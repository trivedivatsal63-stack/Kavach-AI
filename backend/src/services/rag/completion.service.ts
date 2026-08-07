import { ragConfig } from "../../config/rag";

// Chat completion against LiteLLM for RAG answers. Uses the caller-supplied
// key as the bearer (never the master key) so spend/budget are attributed
// to exactly the key presented.

export class RagCompletionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RagCompletionError";
    this.status = status;
  }
}

export interface ChatCompletionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function completeChat(
  apiKey: string,
  system: string,
  user: string
): Promise<ChatCompletionResult> {
  const res = await fetch(`${ragConfig.litellmBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ragConfig.chatModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
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
    throw new RagCompletionError(res.status, message);
  }

  return {
    content: data.choices?.[0]?.message?.content ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}
