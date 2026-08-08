import { ragConfig } from "../../config/rag";

// Real per-text token counts via vLLM's own /tokenize endpoint. Qwen2.5 uses
// its own BPE vocabulary — a generic tokenizer can't approximate it
// accurately enough for a hard budget cutoff whose entire purpose is never
// overflowing the model's real context window. Confirmed: LiteLLM's own
// /utils/token_counter falls back to a generic "openai_tokenizer" for
// self-hosted models like this one and measured ~15% UNDER the real count on
// realistic text — using it here would risk silently recreating the exact
// context-overflow bug this module exists to prevent.
//
// Deliberate, narrow exception to "always go through LiteLLM" (see
// README/docker-compose.yml): this is a stateless, non-billable vocabulary
// lookup, not an inference call, and doesn't touch spend/budget tracking.
// Nothing here should be read as license to call vLLM directly for anything
// else — every actual chat completion still goes through LiteLLM, unchanged
// (see completion.service.ts).
export async function countTokens(text: string): Promise<number> {
  const res = await fetch(`${ragConfig.vllmBaseUrl}/tokenize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ragConfig.chatModel, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`vLLM /tokenize failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { count: number };
  return data.count;
}
