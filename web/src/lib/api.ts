const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4001";

export interface User {
  id: string;
  email: string;
  name: string | null;
  creditBalanceUsd: number;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ApiKeySummary {
  id: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface GeneratedKey {
  id: string;
  key: string;
  createdAt: string;
}

export interface UsageRow {
  keyId: string;
  createdAt: string;
  revokedAt: string | null;
  totalSpend: number;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface TopUpResponse {
  creditBalanceUsd: number;
  keysUpdated: number;
}

export interface TestKeyResponse {
  reply: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? `Request failed with status ${res.status}`
    );
  }
  return data as T;
}

export function signup(email: string, password: string, name: string) {
  return request<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
}

export function login(email: string, password: string) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function listKeys(token: string) {
  return request<ApiKeySummary[]>("/keys", {}, token);
}

export function generateKey(token: string) {
  return request<GeneratedKey>("/keys", { method: "POST" }, token);
}

export function revokeKey(token: string, id: string) {
  return request<{ id: string; revokedAt: string }>(
    `/keys/${id}`,
    { method: "DELETE" },
    token
  );
}

export function getUsage(token: string) {
  return request<UsageRow[]>("/usage", {}, token);
}

export function topUp(token: string) {
  return request<TopUpResponse>("/credits/topup", { method: "POST" }, token);
}

export function testKey(token: string, apiKey: string, message?: string) {
  return request<TestKeyResponse>(
    "/keys/test",
    { method: "POST", body: JSON.stringify({ apiKey, message }) },
    token
  );
}
