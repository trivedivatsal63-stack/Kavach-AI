/**
 * LiteLLM admin + inference client.
 * LiteLLM sits in front of vLLM and is the source of truth for keys, budgets, and spend.
 */

import { env } from "../config";
import { AppError } from "../middleware/errorHandler";

function masterKey(): string {
  return env.litellmMasterKey();
}

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function litellmFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(`${env.litellmBaseUrl}${path}`, init);
  } catch (err) {
    const cause =
      err instanceof Error && "cause" in err
        ? String((err as { cause?: unknown }).cause)
        : String(err);
    throw new AppError(
      503,
      `Cannot reach LiteLLM at ${env.litellmBaseUrl}. Start Docker inference first (docker compose up -d). (${cause})`
    );
  }
}

export interface GeneratedLiteLLMKey {
  key: string;
  tokenId: string;
}

export async function generateLiteLLMKey(
  dashboardUserId: string,
  maxBudget: number
): Promise<GeneratedLiteLLMKey> {
  const res = await litellmFetch(`/key/generate`, {
    method: "POST",
    headers: authHeaders(masterKey()),
    body: JSON.stringify({
      max_budget: maxBudget,
      metadata: { dashboard_user_id: dashboardUserId },
    }),
  });

  if (!res.ok) {
    throw new Error(
      `LiteLLM /key/generate failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as { key?: unknown; token_id?: unknown };
  if (typeof data.key !== "string" || typeof data.token_id !== "string") {
    throw new Error("LiteLLM /key/generate response missing key or token_id");
  }

  return { key: data.key, tokenId: data.token_id };
}

export async function revokeLiteLLMKey(tokenId: string): Promise<void> {
  const res = await litellmFetch(`/key/delete`, {
    method: "POST",
    headers: authHeaders(masterKey()),
    body: JSON.stringify({ keys: [tokenId] }),
  });

  if (!res.ok) {
    throw new Error(
      `LiteLLM /key/delete failed: ${res.status} ${await res.text()}`
    );
  }
}

export interface LiteLLMKeyInfo {
  spend: number;
  maxBudget: number | null;
}

export async function getLiteLLMKeyInfo(
  tokenId: string
): Promise<LiteLLMKeyInfo | null> {
  const res = await litellmFetch(
    `/key/info?key=${encodeURIComponent(tokenId)}`,
    { headers: authHeaders(masterKey()) }
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `LiteLLM /key/info failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as {
    info?: { spend?: unknown; max_budget?: unknown };
    spend?: unknown;
    max_budget?: unknown;
  };
  const info = data.info ?? data;
  return {
    spend: typeof info.spend === "number" ? info.spend : 0,
    maxBudget: typeof info.max_budget === "number" ? info.max_budget : null,
  };
}

export async function updateLiteLLMKeyBudget(
  tokenId: string,
  maxBudget: number
): Promise<void> {
  const res = await litellmFetch(`/key/update`, {
    method: "POST",
    headers: authHeaders(masterKey()),
    body: JSON.stringify({ key: tokenId, max_budget: maxBudget }),
  });

  if (!res.ok) {
    throw new Error(
      `LiteLLM /key/update failed: ${res.status} ${await res.text()}`
    );
  }
}

export interface TestKeyResult {
  ok: boolean;
  status: number;
  reply?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  errorMessage?: string;
}

/** Uses the caller-supplied key (not the master key) — mirrors a real client. */
export async function testLiteLLMKey(
  apiKey: string,
  message: string
): Promise<TestKeyResult> {
  const res = await litellmFetch(`/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.chatModel,
      messages: [{ role: "user", content: message }],
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMessage =
      (data as { error?: { message?: string } })?.error?.message ??
      `LiteLLM returned ${res.status}`;
    return { ok: false, status: res.status, errorMessage };
  }

  const choice = (
    data as { choices?: Array<{ message?: { content?: string } }> }
  ).choices?.[0];
  const usage = (
    data as {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    }
  ).usage;

  return {
    ok: true,
    status: res.status,
    reply: choice?.message?.content ?? "",
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
  };
}

export interface KeyUsageSummary {
  totalSpend: number;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
}

const EMPTY_USAGE: KeyUsageSummary = {
  totalSpend: 0,
  totalRequests: 0,
  promptTokens: 0,
  completionTokens: 0,
};

export async function getLiteLLMKeyUsage(
  tokenId: string
): Promise<KeyUsageSummary> {
  const params = new URLSearchParams({
    api_key: tokenId,
    start_date: "2020-01-01 00:00:00",
    end_date: new Date().toISOString().slice(0, 19).replace("T", " "),
    page_size: "1000",
  });

  const res = await litellmFetch(`/spend/logs/v2?${params}`, {
    headers: authHeaders(masterKey()),
  });

  if (!res.ok) {
    throw new Error(
      `LiteLLM /spend/logs/v2 failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as unknown;
  const logs: Array<{
    spend?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  }> = Array.isArray(data)
    ? data
    : ((data as { data?: unknown[] }).data ?? []);

  return logs.reduce<KeyUsageSummary>(
    (acc, log) => ({
      totalSpend: acc.totalSpend + (log.spend ?? 0),
      totalRequests: acc.totalRequests + 1,
      promptTokens: acc.promptTokens + (log.prompt_tokens ?? 0),
      completionTokens: acc.completionTokens + (log.completion_tokens ?? 0),
    }),
    { ...EMPTY_USAGE }
  );
}
