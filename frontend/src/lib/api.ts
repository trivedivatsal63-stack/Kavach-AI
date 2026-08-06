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

// ── RAG (Build Your Own RAG) ─────────────────────────────────────────────

export interface RagDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: "queued" | "processing" | "indexed" | "failed";
  error: string | null;
  embeddingModel: string;
  chunkCount: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface RagCitation {
  chunkId: string;
  documentId: string;
  source: string;
  page: number | null;
  headingPath: string[] | null;
  excerpt: string;
  score: number;
}

export interface RagChatResponse {
  answer: string;
  citations: RagCitation[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export interface RagKeySummary {
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
  spend: number;
}

export interface RagCreatedKey {
  id: string;
  key: string;
  name: string;
  createdAt: string;
}

// Upload sends the raw file bytes with the filename in x-filename (the JSON
// request helper always sets Content-Type: application/json, which the
// backend's express.raw route would reject).
export async function ragUpload(
  token: string,
  file: File
): Promise<{ document: RagDocument }> {
  return ragUploadWithProgress(token, file);
}

export const RAG_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const RAG_ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown"];

export function ragFileError(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!RAG_ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return "Unsupported file type. Allowed: PDF, DOCX, TXT, Markdown.";
  }
  if (file.size > RAG_MAX_UPLOAD_BYTES) {
    return "File exceeds the 25 MB upload limit.";
  }
  if (file.size === 0) {
    return "File is empty.";
  }
  return null;
}

export interface RagUploadProgress {
  loaded: number;
  total: number;
}

// XHR-based upload so we can report real upload progress (fetch has no
// upload progress events).
export function ragUploadWithProgress(
  token: string,
  file: File,
  onProgress?: (progress: RagUploadProgress) => void
): Promise<{ document: RagDocument }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/rag/documents`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total });
      }
    };
    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as { document: RagDocument });
      } else {
        reject(
          new ApiError(
            xhr.status,
            (data as { error?: string }).error ??
              `Request failed with status ${xhr.status}`
          )
        );
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload."));
    xhr.send(file);
  });
}

export function ragListDocuments(token: string) {
  return request<{ documents: RagDocument[] }>("/rag/documents", {}, token);
}

export function ragDeleteDocument(token: string, id: string) {
  return request<{ id: string }>(
    `/rag/documents/${id}`,
    { method: "DELETE" },
    token
  );
}

export function ragChat(
  token: string,
  question: string,
  documentIds?: string[]
) {
  return request<RagChatResponse>(
    "/rag/chat",
    {
      method: "POST",
      body: JSON.stringify({
        question,
        ...(documentIds && documentIds.length > 0 ? { documentIds } : {}),
      }),
    },
    token
  );
}

export function ragCreateKey(token: string, name: string) {
  return request<RagCreatedKey>(
    "/rag/keys",
    { method: "POST", body: JSON.stringify({ name }) },
    token
  );
}

export function ragListKeys(token: string) {
  return request<{ keys: RagKeySummary[] }>("/rag/keys", {}, token);
}

export function ragRevokeKey(token: string, id: string) {
  return request<{ id: string; revokedAt: string }>(
    `/rag/keys/${id}`,
    { method: "DELETE" },
    token
  );
}
