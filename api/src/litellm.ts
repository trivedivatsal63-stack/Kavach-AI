// Talks to LiteLLM's admin API using the proxy master key. This module is
// only ever imported by server-side route handlers in this Express app —
// there is no client bundle here to leak into (unlike the Next.js version,
// which needed the "server-only" package to guard against that).
//
// Endpoints verified against the running instance's own OpenAPI spec
// (GET /openapi.json) and by live testing in earlier phases, re-confirmed
// against the same running instance before this port:
// - POST /key/generate — returns both the raw key ("key") and a hashed,
//   irreversible identifier ("token_id"). We only ever persist token_id.
// - POST /key/delete — its "keys" field explicitly accepts either raw key
//   values OR hashed keys (i.e. token_id); re-confirmed present and
//   documenting hashed-key support on the live instance before this port.
// - GET /key/info and POST /key/update both accept token_id directly
//   (live-tested), despite their docs examples showing a raw key.
// - GET /spend/logs is [DEPRECATED] in favor of /spend/logs/v2, which
//   requires start_date/end_date and accepts api_key=<token_id> (the hash
//   — NOT the raw key; live-tested, this is the one endpoint that only
//   accepts the hash).

const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY;

function requireMasterKey(): string {
  if (!LITELLM_MASTER_KEY) {
    throw new Error("LITELLM_MASTER_KEY is not configured");
  }
  return LITELLM_MASTER_KEY;
}

function authHeaders(masterKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${masterKey}`,
    "Content-Type": "application/json",
  };
}

export interface GeneratedLiteLLMKey {
  key: string;
  tokenId: string;
}

export async function generateLiteLLMKey(
  dashboardUserId: string,
  maxBudget: number
): Promise<GeneratedLiteLLMKey> {
  const masterKey = requireMasterKey();

  const res = await fetch(`${LITELLM_BASE_URL}/key/generate`, {
    method: "POST",
    headers: authHeaders(masterKey),
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
  const masterKey = requireMasterKey();

  const res = await fetch(`${LITELLM_BASE_URL}/key/delete`, {
    method: "POST",
    headers: authHeaders(masterKey),
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
  const masterKey = requireMasterKey();

  const res = await fetch(
    `${LITELLM_BASE_URL}/key/info?key=${encodeURIComponent(tokenId)}`,
    { headers: authHeaders(masterKey) }
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
  const masterKey = requireMasterKey();

  const res = await fetch(`${LITELLM_BASE_URL}/key/update`, {
    method: "POST",
    headers: authHeaders(masterKey),
    body: JSON.stringify({ key: tokenId, max_budget: maxBudget }),
  });

  if (!res.ok) {
    throw new Error(
      `LiteLLM /key/update failed: ${res.status} ${await res.text()}`
    );
  }
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
  const masterKey = requireMasterKey();

  const params = new URLSearchParams({
    api_key: tokenId,
    start_date: "2020-01-01 00:00:00",
    end_date: new Date().toISOString().slice(0, 19).replace("T", " "),
    page_size: "1000",
  });

  const res = await fetch(`${LITELLM_BASE_URL}/spend/logs/v2?${params}`, {
    headers: authHeaders(masterKey),
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
