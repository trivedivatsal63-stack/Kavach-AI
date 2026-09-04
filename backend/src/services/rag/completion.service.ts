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

// Thrown when the caller aborts a streaming completion (Stop button /
// client disconnect). Carries whatever text had streamed so far so the
// caller can persist it as a partial reply instead of dropping it.
export class StreamAborted extends Error {
  partialText: string;
  constructor(partialText: string) {
    super("Stream aborted by caller");
    this.name = "StreamAborted";
    this.partialText = partialText;
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
  messages: ChatMessage[],
  options?: { maxTokens?: number }
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
      // Generous default so reasoning-channel models (or long agentic
      // replies) are not truncated mid-thought into empty `content`.
      // Callers doing cheap classifier work (e.g. search routing) pass a
      // small maxTokens override.
      max_tokens: options?.maxTokens ?? 2048,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{
      message?: {
        content?: string | null;
        // Muse Glimmer (and other reasoning models) may put the chain-of-
        // thought here and leave content empty until the user channel closes.
        reasoning_content?: string | null;
        reasoning?: string | null;
      };
    }>;
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

  // Some reasoning models put chain-of-thought in reasoning_content /
  // reasoning and leave content empty until the user channel closes —
  // fall back so callers still get usable text regardless of central brain.
  const message = data.choices?.[0]?.message;
  const content =
    (message?.content && message.content.trim()) ||
    (message?.reasoning_content && message.reasoning_content.trim()) ||
    (message?.reasoning && message.reasoning.trim()) ||
    "";

  return {
    content,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}

// Streaming variant: LiteLLM Server-Sent Events passthrough (vLLM emits
// OpenAI-compatible SSE; LiteLLM forwards verbatim). Deltas go to onDelta
// as they arrive; the resolved value mirrors completeChat's contract.
// Aborting via `signal` throws StreamAborted carrying streamed-so-far text.
export async function completeChatStream(
  apiKey: string,
  messages: ChatMessage[],
  options?: { maxTokens?: number; onDelta?: (delta: string) => void; signal?: AbortSignal }
): Promise<ChatCompletionResult> {
  let res: Response;
  try {
    res = await fetch(`${ragConfig.litellmBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: ragConfig.chatModel,
        messages,
        max_tokens: options?.maxTokens ?? 2048,
        stream: true,
      }),
      signal: options?.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new StreamAborted("");
    throw err;
  }

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const message =
      (data as { error?: { message?: string } }).error?.message ??
      `LiteLLM returned ${res.status}`;
    throw new CompletionError(res.status, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  const handleData = (raw: string) => {
    const text = raw.trim();
    if (!text || text === "[DONE]") return;
    let chunk: {
      choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    try {
      chunk = JSON.parse(text);
    } catch {
      return;
    }
    const delta =
      chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
    if (delta) {
      content += delta;
      options?.onDelta?.(delta);
    }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
      completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      totalTokens = chunk.usage.total_tokens ?? totalTokens;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) handleData(line.slice(5));
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new StreamAborted(content);
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already closed via abort — harmless.
    }
  }
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (line.startsWith("data:")) handleData(line.slice(5));
    }
  }

  return { content, promptTokens, completionTokens, totalTokens };
}

// Shared by every controller that surfaces a CompletionError to an HTTP
// client (chat.controller.ts, query.controller.ts, conversations.controller.ts)
// — was duplicated identically in the first two before this extraction.
export function mapCompletionErrorStatus(status: number): number {
  if (status === 401) return 401;
  if (status === 402 || status === 429) return 402;
  return 502;
}
