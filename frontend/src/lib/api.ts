const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4001";

export type UserRole = "user" | "superadmin";
export type UserStatus = "active" | "paused" | "blocked";

export interface User {
  id: string;
  email: string;
  name: string | null;
  creditBalanceUsd: number;
  role: UserRole;
  status: UserStatus;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface OtpChallenge {
  requiresOtp: true;
  email: string;
}

export type OtpPurpose = "signup" | "login" | "reset";

export interface ApiKeySummary {
  id: string;
  name: string | null;
  scope: string;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface GeneratedKey {
  id: string;
  key: string;
  name?: string | null;
  scope?: string;
  expiresAt?: string | null;
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
    const message =
      (data as { error?: string }).error ??
      `Request failed with status ${res.status}`;
    // Only clear the dashboard session for real JWT failures — never for
    // downstream "invalid API key" style errors that used to leak as 401.
    if (
      res.status === 401 &&
      token &&
      /missing bearer|invalid or expired token/i.test(message)
    ) {
      window.dispatchEvent(new CustomEvent("kavach:unauthorized"));
    }
    if (res.status === 403 && token && /account has been blocked/i.test(message)) {
      window.dispatchEvent(new CustomEvent("kavach:unauthorized"));
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export function signup(email: string, password: string, name: string) {
  return request<OtpChallenge>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
}

export function login(email: string, password: string) {
  return request<OtpChallenge>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function verifyOtp(email: string, purpose: OtpPurpose, code: string) {
  return request<AuthResponse>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, purpose, code }),
  });
}

export function resendOtp(email: string, purpose: OtpPurpose) {
  return request<OtpChallenge>("/auth/resend-otp", {
    method: "POST",
    body: JSON.stringify({ email, purpose }),
  });
}

export function forgotPassword(email: string) {
  return request<{ ok: true }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(email: string, code: string, password: string) {
  return request<{ ok: true }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ email, code, password }),
  });
}

export function fetchMe(token: string) {
  return request<User>("/auth/me", {}, token);
}

export function listKeys(token: string) {
  return request<ApiKeySummary[]>("/keys", {}, token);
}

export function generateKey(token: string, opts?: { scope?: string; name?: string; expiresIn?: string }) {
  return request<GeneratedKey>("/keys", { method: "POST", body: JSON.stringify(opts ?? {}) }, token);
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
        const message =
          (data as { error?: string }).error ??
          `Request failed with status ${xhr.status}`;
        if (
          xhr.status === 401 &&
          token &&
          /missing bearer|invalid or expired token/i.test(message)
        ) {
          window.dispatchEvent(new CustomEvent("kavach:unauthorized"));
        }
        reject(new ApiError(xhr.status, message));
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

export interface RagChunkDetail {
  id: string;
  documentId: string;
  chunkIndex: number;
  headingPath: string[] | null;
  source: string;
  page: number | null;
  tokenCount: number;
  content: string;
}

export function ragListChunks(token: string, documentId: string) {
  return request<{ chunks: RagChunkDetail[] }>(
    `/rag/documents/${documentId}/chunks`,
    {},
    token
  );
}

// ── Conversations (Chat + RAG Studio) ────────────────────────────────────

export type ConversationMode = "chat" | "rag";

export interface ConversationSummary {
  id: string;
  mode: ConversationMode;
  title: string;
  documentIds: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebCitation {
  url: string;
  title: string;
  excerpt: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: RagCitation[] | null;
  webCitations: WebCitation[] | null;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

export interface SendMessageResponse {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  conversation: ConversationSummary;
  billing?: { costUsd?: number; promptTokens?: number; completionTokens?: number; remainingUsd: number };
}

export function listConversations(token: string, mode: ConversationMode) {
  return request<{ conversations: ConversationSummary[] }>(
    `/conversations?mode=${mode}`,
    {},
    token
  );
}

export function createConversation(
  token: string,
  mode: ConversationMode,
  documentIds?: string[]
) {
  return request<{ conversation: ConversationSummary }>(
    "/conversations",
    {
      method: "POST",
      body: JSON.stringify({
        mode,
        ...(documentIds && documentIds.length > 0 ? { documentIds } : {}),
      }),
    },
    token
  );
}

export function getConversation(token: string, id: string) {
  return request<{ conversation: ConversationDetail }>(
    `/conversations/${id}`,
    {},
    token
  );
}

export function deleteConversation(token: string, id: string) {
  return request<{ id: string }>(
    `/conversations/${id}`,
    { method: "DELETE" },
    token
  );
}

export function sendConversationMessage(
  token: string,
  id: string,
  content: string,
  webSearch?: boolean
) {
  return request<SendMessageResponse>(
    `/conversations/${id}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content, ...(webSearch ? { webSearch: true } : {}) }),
    },
    token
  );
}

// ── Compliance ─────────────────────────────────────────────────────────
export function getComplianceProfile(token: string) {
  return request<{ profiles: any[] }>("/compliance/profile", {}, token);
}
export function createComplianceProfile(token: string, data: any) {
  return request<{ profile: any }>("/compliance/profile", { method: "POST", body: JSON.stringify(data) }, token);
}
export function updateComplianceProfile(token: string, id: string, data: any) {
  return request<{ profile: any }>(`/compliance/profile/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token);
}
export function createComplianceRun(token: string, data: { sources?: string[]; lookbackDays?: number; companyProfileId?: string }) {
  return request<{ run: any }>("/compliance/runs", { method: "POST", body: JSON.stringify(data) }, token);
}
export function getComplianceRun(token: string, id: string) {
  return request<{ run: any; evaluations: any[] }>(`/compliance/runs/${id}`, {}, token);
}
export function getComplianceTable(token: string, id: string) {
  return request<{ run: any; table: any[] }>(`/compliance/runs/${id}/table`, {}, token);
}
export function listComplianceRuns(token: string) {
  return request<{ runs: any[] }>("/compliance/runs", {}, token);
}
export function patchChecklist(token: string, evaluationId: string, checklist: any) {
  return request<{ evaluation: any }>(`/compliance/evaluations/${evaluationId}/checklist`, { method: "PATCH", body: JSON.stringify({ checklist }) }, token);
}

// ── Superadmin ────────────────────────────────────────────────────────────

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  deletedAt: string | null;
  creditBalanceUsd: number;
  createdAt: string;
  apiKeyCount: number;
  conversationCount: number;
  lastActiveAt: string;
}

export interface AdminUserKey {
  id: string;
  kind: "api" | "rag";
  name?: string;
  createdAt: string;
  revokedAt: string | null;
  totalSpend: number;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AdminConversation {
  id: string;
  mode: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
  lastMessage: {
    role: string;
    preview: string;
    createdAt: string;
  } | null;
}

export interface AdminAuditRow {
  id: string;
  adminId: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminUserActivity {
  user: Omit<
    AdminUserSummary,
    "apiKeyCount" | "conversationCount" | "lastActiveAt"
  >;
  keys: AdminUserKey[];
  conversations: AdminConversation[];
  audit: AdminAuditRow[];
}

export function listAdminUsers(
  token: string,
  opts?: { q?: string; includeDeleted?: boolean }
) {
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.includeDeleted) params.set("includeDeleted", "true");
  const qs = params.toString();
  return request<AdminUserSummary[]>(
    `/admin/users${qs ? `?${qs}` : ""}`,
    {},
    token
  );
}

export function getAdminUser(token: string, id: string) {
  return request<AdminUserActivity>(`/admin/users/${id}`, {}, token);
}

export function adminPauseUser(token: string, id: string) {
  return request<AdminUserActivity["user"]>(
    `/admin/users/${id}/pause`,
    { method: "POST" },
    token
  );
}

export function adminUnpauseUser(token: string, id: string) {
  return request<AdminUserActivity["user"]>(
    `/admin/users/${id}/unpause`,
    { method: "POST" },
    token
  );
}

export function adminBlockUser(token: string, id: string) {
  return request<AdminUserActivity["user"]>(
    `/admin/users/${id}/block`,
    { method: "POST" },
    token
  );
}

export function adminUnblockUser(token: string, id: string) {
  return request<AdminUserActivity["user"]>(
    `/admin/users/${id}/unblock`,
    { method: "POST" },
    token
  );
}

export function adminDeleteUser(token: string, id: string) {
  return request<AdminUserActivity["user"]>(
    `/admin/users/${id}/delete`,
    { method: "POST" },
    token
  );
}

export function adminRestoreUser(token: string, id: string) {
  return request<AdminUserActivity["user"]>(
    `/admin/users/${id}/restore`,
    { method: "POST" },
    token
  );
}

export function adminRevokeUserKey(
  token: string,
  userId: string,
  keyId: string,
  kind: "api" | "rag"
) {
  return request<{ id: string; kind: string; revokedAt: string }>(
    `/admin/users/${userId}/keys/${keyId}/revoke`,
    { method: "POST", body: JSON.stringify({ kind }) },
    token
  );
}

export function adminRevokeAllKeys(token: string, userId: string) {
  return request<{ keysRevoked: number }>(
    `/admin/users/${userId}/keys/revoke-all`,
    { method: "POST" },
    token
  );
}
